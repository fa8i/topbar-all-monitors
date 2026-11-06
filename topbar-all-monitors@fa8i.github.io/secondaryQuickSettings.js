import GObject from 'gi://GObject';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

const UnsafeModeIndicator = GObject.registerClass(
class UnsafeModeIndicator extends SystemIndicator {
    _init() {
        super._init();
        const indicator = this._addIndicator();
        indicator.icon_name = 'channel-insecure-symbolic';
        global.context.bind_property('unsafe-mode', indicator, 'visible',
            GObject.BindingFlags.SYNC_CREATE);
    }
});

// Match the native GNOME 50/51 indicator and menu ordering. Load modules first,
// then construct native widgets synchronously inside the panel's signal scope.
// The upstream async initializer otherwise creates unowned subscriptions after
// Panel._init() has already returned.
const implementations = [
    ['_system', 'system', 'Indicator'],
    ['_camera', 'camera', 'Indicator'],
    ['_volumeOutput', 'volume', 'OutputIndicator'],
    ['_volumeInput', 'volume', 'InputIndicator'],
    ['_brightness', 'brightness', 'Indicator'],
    ['_remoteAccess', 'remoteAccess', 'RemoteAccessApplet'],
    ['_location', 'location', 'Indicator'],
    ['_thunderbolt', 'thunderbolt', 'Indicator'],
    ['_nightLight', 'nightLight', 'Indicator'],
    ['_darkMode', 'darkMode', 'Indicator'],
    ['_doNotDisturb', 'doNotDisturb', 'Indicator'],
    ['_backlight', 'backlight', 'Indicator'],
    ['_powerProfiles', 'powerProfiles', 'Indicator'],
    ['_rfkill', 'rfkill', 'Indicator'],
    ['_autoRotate', 'autoRotate', 'Indicator'],
    ['_backgroundApps', 'backgroundApps', 'Indicator'],
];

export const SecondaryQuickSettings = GObject.registerClass(
class SecondaryQuickSettings extends Main.panel.statusArea.quickSettings.constructor {
    constructor(scope) {
        super();
        this._scope = scope;
        this._cancelled = false;
    }

    async _setupIndicators() {
        const definitions = [...implementations];
        if (Config.HAVE_NETWORKMANAGER)
            definitions.push(['_network', 'network', 'Indicator']);
        if (Config.HAVE_BLUETOOTH)
            definitions.push(['_bluetooth', 'bluetooth', 'Indicator']);
        const modules = await Promise.all(definitions.map(([, module]) =>
            import(`resource:///org/gnome/shell/ui/status/${module}.js`)));
        const network = Config.HAVE_NETWORKMANAGER
            ? await import('./secondaryNetwork.js') : null;
        if (this._cancelled)
            return;

        this._scope.run(() => {
            this._network = null;
            this._bluetooth = null;
            definitions.forEach(([field, , name], index) => {
                this[field] = field === '_network'
                    ? new network.SecondaryNetwork(this._scope)
                    : new modules[index][name]();
            });
            this._unsafeMode = new UnsafeModeIndicator();

            const indicators = [
                '_remoteAccess', '_camera', '_volumeInput', '_location',
                '_brightness', '_thunderbolt', '_nightLight', '_network',
                '_darkMode', '_doNotDisturb', '_backlight', '_bluetooth',
                '_rfkill', '_autoRotate', '_volumeOutput', '_unsafeMode',
                '_powerProfiles', '_system',
            ];
            indicators.forEach(field => {
                if (this[field])
                    this._indicators.add_child(this[field]);
            });

            const sibling = this.menu.getFirstItem();
            for (const field of ['_system', '_volumeOutput', '_volumeInput', '_brightness'])
                this._addItemsBefore(this[field].quickSettingsItems, sibling, 2);
            for (const field of [
                '_camera', '_remoteAccess', '_thunderbolt', '_location',
                '_network', '_bluetooth', '_powerProfiles', '_nightLight',
                '_darkMode', '_doNotDisturb', '_backlight', '_rfkill',
                '_autoRotate', '_unsafeMode',
            ]) {
                if (this[field])
                    this._addItemsBefore(this[field].quickSettingsItems, sibling);
            }
            this._backgroundApps.quickSettingsItems.forEach(item =>
                this.menu.addItem(item, 2));
        });
    }

    destroy() {
        this._cancelled = true;
        super.destroy();
    }
});
