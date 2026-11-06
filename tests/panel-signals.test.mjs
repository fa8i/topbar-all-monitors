import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL(
    '../topbar-all-monitors@fa8i.github.io/panelSignals.js', import.meta.url
), 'utf8').replace('export class', 'class');
const PanelSignals = vm.runInNewContext(`${source}\nPanelSignals`);

class Emitter {
    handlers = new Map();
    nextId = 1;
    connect(name, callback) {
        const id = this.nextId++;
        this.handlers.set(id, {name, callback});
        return id;
    }
    connectObject(name, callback, owner) {
        const id = this.connect(name, callback);
        this.handlers.get(id).owner = owner;
        owner.ids ??= [];
        owner.ids.push(id);
    }
    disconnectObject(owner) {
        for (const [id, handler] of this.handlers) {
            if (handler.owner === owner)
                this.handlers.delete(id);
        }
    }
    disconnect(id) { assert.equal(this.handlers.delete(id), true); }
    emit(name, ...args) {
        for (const handler of [...this.handlers.values()]) {
            if (handler.name === name)
                handler.callback(this, ...args);
        }
    }
}

const scopeFor = emitter => new PanelSignals(
    () => [emitter], (object, id) => object.handlers.has(id));

test('closing one panel removes its subscriptions and preserves other owners', () => {
    const emitter = new Emitter();
    const connect = emitter.connect;
    let primary = 0;
    let secondary = 0;
    emitter.connect('changed', () => primary++);
    const scope = scopeFor(emitter);
    scope.run(() => emitter.connect('changed', () => secondary++));
    assert.equal(emitter.connect, connect);
    assert.equal(Object.hasOwn(emitter, 'connect'), false);
    emitter.emit('changed');
    assert.equal(secondary, 1);
    scope.close();
    scope.close();
    emitter.emit('changed');
    assert.equal(primary, 2);
    assert.equal(secondary, 1);
});

test('subscriptions to sources added later belong to the same panel', () => {
    const tray = new Emitter();
    const source = new Emitter();
    let count = 0;
    const scope = scopeFor(tray);
    scope.run(() => tray.connect('source-added', (_tray, item) => {
        item.connect('count', () => count++);
    }));
    tray.emit('source-added', source);
    assert.equal(Object.hasOwn(source, 'connect'), false);
    source.emit('count');
    assert.equal(count, 1);
    scope.close();
    source.emit('count');
    assert.equal(count, 1);
    assert.equal(source.handlers.size, 0);
});

test('managed subscriptions are detached before native owners are destroyed', () => {
    const emitter = new Emitter();
    const owner = {ids: []};
    const scope = scopeFor(emitter);
    scope.run(() => emitter.connectObject('changed', () => {}, owner));
    assert.equal(emitter.handlers.size, 1);
    assert.equal(emitter.handlers.get(owner.ids[0]).owner, owner);
    scope.close();
    assert.equal(emitter.handlers.size, 0);
});

test('temporary methods are restored if native initialization throws', () => {
    const emitter = new Emitter();
    const connect = emitter.connect;
    const scope = scopeFor(emitter);
    assert.throws(() => scope.run(() => {
        emitter.connect('changed', () => {});
        throw new Error('initialization failed');
    }), /initialization failed/);
    assert.equal(emitter.connect, connect);
    assert.equal(Object.hasOwn(emitter, 'connectObject'), false);
    scope.close();
    assert.equal(emitter.handlers.size, 0);
});

test('nested execution of different panels does not steal subscriptions', () => {
    const emitter = new Emitter();
    const first = scopeFor(emitter);
    const second = scopeFor(emitter);
    let calls = 0;
    first.run(() => second.run(() => emitter.connect('changed', () => calls++)));
    first.close();
    emitter.emit('changed');
    assert.equal(calls, 1);
    second.close();
    assert.equal(emitter.handlers.size, 0);
});

test('managed connections without an explicit owner get a panel-local owner', () => {
    const emitter = new Emitter();
    const scope = scopeFor(emitter);
    scope.run(() => emitter.connectObject('changed', () => {}));
    assert.equal(emitter.handlers.size, 1);
    scope.close();
    assert.equal(emitter.handlers.size, 0);
});

test('pending native timers are cancelled and callbacks retain panel ownership', () => {
    let nextId = 1;
    const pending = new Map();
    const api = {timeout_add_once(_priority, _interval, callback) {
        const id = nextId++;
        pending.set(id, callback);
        return id;
    }};
    const original = api.timeout_add_once;
    const emitter = new Emitter();
    const scope = new PanelSignals(() => [emitter],
        (object, id) => object.handlers.has(id), () => true,
        {api, remove: id => pending.delete(id)});
    scope.run(() => api.timeout_add_once(0, 100, () => {
        emitter.connect('changed', () => {});
        api.timeout_add_once(0, 100, () => assert.fail('cancelled timer fired'));
    }));
    assert.equal(api.timeout_add_once, original);
    const [id, callback] = pending.entries().next().value;
    pending.delete(id);
    callback();
    assert.equal(emitter.handlers.size, 1);
    assert.equal(pending.size, 1);
    scope.close();
    assert.equal(pending.size, 0);
    assert.equal(emitter.handlers.size, 0);
    assert.equal(api.timeout_add_once, original);
});

test('late proxy completion is cancelled without calling a destroyed consumer', async () => {
    let resolve;
    let cancellable;
    const init = (_priority, cancel) => {
        cancellable = cancel;
        return new Promise(done => { resolve = done; });
    };
    const prototype = {};
    Object.defineProperty(prototype, 'init_async', {
        configurable: true, get: () => init,
    });
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'init_async');
    const scope = new PanelSignals(() => [], () => false, () => true, null, {
        prototype, createCancellable: () => ({cancelled: false,
            cancel() { this.cancelled = true; }}),
    });
    let calls = 0;
    const result = scope.run(() => prototype.init_async(0).then(() => calls++));
    assert.deepEqual(Object.getOwnPropertyDescriptor(prototype, 'init_async'), descriptor);
    scope.close();
    assert.equal(cancellable.cancelled, true);
    resolve(true);
    await result;
    assert.equal(calls, 0);
    assert.equal(scope._pending.size, 0);
});

test('a late async service result never updates retired widgets or gets force-disposed', async () => {
    let resolve;
    let cancelled = false;
    let updates = 0;
    const scope = new PanelSignals(() => [], () => false, () => true, null, {
        createCancellable: () => ({cancel() { cancelled = true; }}),
    });
    const pending = scope.runAsync(() => new Promise(done => { resolve = done; }), () => updates++);
    scope.close();
    resolve({run_dispose() { assert.fail('service objects must not be force-disposed'); }});
    await pending;
    assert.equal(cancelled, true);
    assert.equal(updates, 0);
    assert.equal(scope._pending.size, 0);
});

test('async service continuations register their connections in the owning panel', async () => {
    const emitter = new Emitter();
    const scope = new PanelSignals(() => [emitter], (object, id) => object.handlers.has(id),
        () => true, null, {createCancellable: () => ({cancel() {}})});
    await scope.runAsync(() => Promise.resolve(emitter), source => source.connect('changed', () => {}));
    assert.equal(emitter.handlers.size, 1);
    scope.close();
    assert.equal(emitter.handlers.size, 0);
});
