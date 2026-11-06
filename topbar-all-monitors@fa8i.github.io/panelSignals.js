// Native panel components assume that they live for the whole Shell session.
// Give their ordinary connections to shared services a secondary-panel owner.
// Only synchronous construction/callback execution is intercepted; original
// methods are restored before returning to the Shell main loop.
const originalMethod = Symbol('originalMethod');

function underlying(method) {
    return method[originalMethod] ?? method;
}

export class PanelSignals {
    constructor(getEmitters, isConnected, shouldTrack = () => true, sources = null, asyncInit = null) {
        this._getEmitters = getEmitters;
        this._isConnected = isConnected;
        this._shouldTrack = shouldTrack;
        this._connections = [];
        this._managedConnections = new Map();
        this._sources = new Set();
        this._sourceApi = sources;
        this._asyncInit = asyncInit;
        this._pending = new Set();
        this._defaultOwner = {};
        this._closed = false;
    }

    run(callback, extraEmitters = []) {
        if (this._closed)
            return undefined;

        const restore = [];
        const emitters = new Set([...this._getEmitters(), ...extraEmitters]);
        const scope = this;
        let managed = 0;
        try {
            if (this._asyncInit?.prototype) {
                const {prototype, createCancellable} = this._asyncInit;
                const descriptor = Object.getOwnPropertyDescriptor(prototype, 'init_async');
                const init = underlying(prototype.init_async);
                const own = promise => {
                    const then = promise.then;
                    Object.defineProperty(promise, 'then', {configurable: true,
                        value(onSuccess, onError) {
                            const wrap = handler => typeof handler === 'function'
                                ? value => scope.run(() => handler(value)) : handler;
                            return own(then.call(this, wrap(onSuccess), wrap(onError)));
                        }});
                    Object.defineProperty(promise, 'catch', {configurable: true,
                        value(onError) { return this.then(undefined, onError); }});
                    return promise;
                };
                const wrapper = function (priority, cancellable = null, ...args) {
                    // Keep caller cancellation as well as the panel's lifetime.
                    const owned = createCancellable();
                    const cancelledId = cancellable?.connect(() => owned.cancel());
                    scope._pending.add(owned);
                    const settled = () => {
                        scope._pending.delete(owned);
                        if (cancelledId)
                            cancellable.disconnect(cancelledId);
                    };
                    if (typeof args.at(-1) === 'function') {
                        const handler = args.pop();
                        return init.call(this, priority, owned, ...args, (...values) => {
                            settled();
                            scope.run(() => handler(...values));
                        });
                    }
                    const promise = init.call(this, priority, owned, ...args);
                    promise.then(settled, settled);
                    return own(promise);
                };
                wrapper[originalMethod] = init;
                Object.defineProperty(prototype, 'init_async', {
                    configurable: descriptor?.configurable ?? true,
                    enumerable: descriptor?.enumerable ?? false,
                    writable: true, value: wrapper,
                });
                restore.push(() => descriptor
                    ? Object.defineProperty(prototype, 'init_async', descriptor)
                    : delete prototype.init_async);
            }
            if (this._sourceApi) {
                const {api} = this._sourceApi;
                for (const name of ['timeout_add', 'timeout_add_once', 'idle_add', 'idle_add_once']) {
                    if (typeof api[name] !== 'function')
                        continue;
                    const method = underlying(api[name]);
                    const descriptor = Object.getOwnPropertyDescriptor(api, name);
                    const wrapper = function (...args) {
                        const handler = args.pop();
                        let id;
                        id = method.call(this, ...args, (...values) => {
                            scope._sources.delete(id);
                            const result = scope.run(() => handler(...values));
                            if (!name.endsWith('_once') && result)
                                scope._sources.add(id);
                            return result;
                        });
                        scope._sources.add(id);
                        return id;
                    };
                    wrapper[originalMethod] = method;
                    Object.defineProperty(api, name, {
                        configurable: descriptor?.configurable ?? true,
                        enumerable: descriptor?.enumerable ?? false,
                        writable: true, value: wrapper,
                    });
                    restore.push(() => descriptor
                        ? Object.defineProperty(api, name, descriptor) : delete api[name]);
                }
            }
            for (const emitter of emitters) {
                if (typeof emitter?.connect !== 'function' ||
                    typeof emitter?.disconnect !== 'function')
                    continue;

                const replace = (name, wrapper) => {
                    const descriptor = Object.getOwnPropertyDescriptor(emitter, name);
                    Object.defineProperty(emitter, name, {
                        configurable: true, writable: true, value: wrapper,
                    });
                    restore.push(() => {
                        if (descriptor)
                            Object.defineProperty(emitter, name, descriptor);
                        else
                            delete emitter[name];
                    });
                };

                for (const name of ['connect', 'connect_after']) {
                    if (typeof emitter[name] !== 'function')
                        continue;
                    const connect = underlying(emitter[name]);
                    const wrapper = function (signal, handler) {
                        if (managed || typeof signal !== 'string' ||
                            signal === 'destroy' || !scope._shouldTrack(this))
                            return connect.call(this, signal, handler);

                        const id = connect.call(this, signal, function (...args) {
                            return scope.run(() => handler.apply(this, args), args);
                        });
                        scope._connections.push([this, id]);
                        return id;
                    };
                    wrapper[originalMethod] = connect;
                    replace(name, wrapper);
                }

                // Retain native ownership, and also detach these subscriptions
                // when the panel closes (some native owners outlive their menu).
                // Avoid recording SignalTracker's internal connections twice.
                for (const name of ['connectObject', 'connect_object']) {
                    if (typeof emitter[name] !== 'function')
                        continue;
                    const connect = underlying(emitter[name]);
                    const wrapper = function (...args) {
                        const last = args.at(-1);
                        const owner = typeof last === 'object' && last !== null
                            ? last : scope._defaultOwner;
                        if (owner === scope._defaultOwner)
                            args.push(owner);
                        for (let i = 0; i < args.length - 1; i++) {
                            if (typeof args[i] !== 'function')
                                continue;
                            const handler = args[i];
                            args[i] = function (...values) {
                                return scope.run(() => handler.apply(this, values), values);
                            };
                        }
                        if (!scope._managedConnections.has(this))
                            scope._managedConnections.set(this, new Set());
                        scope._managedConnections.get(this).add(owner);
                        managed++;
                        try {
                            return connect.apply(this, args);
                        } finally {
                            managed--;
                        }
                    };
                    wrapper[originalMethod] = connect;
                    replace(name, wrapper);
                }
            }
            return callback();
        } finally {
            for (const undo of restore.reverse())
                undo();
        }
    }

    close() {
        this._closed = true;
        for (const cancellable of this._pending)
            cancellable.cancel();
        this._pending.clear();
        for (const id of this._sources)
            this._sourceApi.remove(id);
        this._sources.clear();
        for (const [emitter, owners] of this._managedConnections) {
            for (const owner of owners)
                emitter.disconnectObject(owner);
        }
        this._managedConnections.clear();
        for (const [emitter, id] of this._connections.reverse()) {
            if (this._isConnected(emitter, id))
                emitter.disconnect(id);
        }
        this._connections = [];
    }

    async runAsync(operation, onSuccess) {
        if (this._closed)
            return undefined;
        const cancellable = this._asyncInit.createCancellable();
        this._pending.add(cancellable);
        try {
            const value = await operation(cancellable);
            if (this._closed)
                return undefined;
            return this.run(() => onSuccess(value));
        } catch (error) {
            if (!this._closed)
                throw error;
            return undefined;
        } finally {
            this._pending.delete(cancellable);
        }
    }
}
