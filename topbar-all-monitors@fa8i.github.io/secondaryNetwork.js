import GObject from 'gi://GObject';
import NM from 'gi://NM';
import Polkit from 'gi://Polkit';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Network from 'resource:///org/gnome/shell/ui/status/network.js';

// Keep native network widgets and captive-portal handling. Unlike the upstream
// initializer, each await is bounded by the secondary panel's lifetime, and
// the continuation registers its connections inside that panel's scope.
export const SecondaryNetwork = GObject.registerClass(
class SecondaryNetwork extends Network.Indicator {
    constructor(scope) {
        super();
        this._scope = scope;
    }

    async _getClient() {
        // The native constructor invokes this before the subclass constructor
        // has returned from super(). Let it assign the panel's scope first.
        await Promise.resolve();
        return this._scope.runAsync(cancellable => NM.Client.new_async(cancellable), client => {
            this._client = client;
            this.quickSettingsItems.forEach(toggle => toggle.setClient(client));
            client.bind_property('nm-running', this, 'visible', GObject.BindingFlags.SYNC_CREATE);

            const NativePortal = Main.panel.statusArea.quickSettings._network?._portalHandler?.constructor;
            if (!NativePortal)
                throw new Error('The native network portal handler is not initialized');
            this._portalHandler = new NativePortal(client.connectivityCheckUri);
            this._portalHandler.connect('recheck', (_handler, path) => {
                this._scope.runAsync(cancellable => client.check_connectivity_async(cancellable), state => {
                    if (state >= NM.ConnectivityState.FULL)
                        this._portalHandler.removeConnection(path);
                }).catch(logError);
            });
            client.connectObject(
                'notify::primary-connection', () => this._syncMainConnection(),
                'notify::activating-connection', () => this._syncMainConnection(),
                'notify::connectivity', () => this._syncConnectivity(), this);
            this._syncMainConnection();

            return this._scope.runAsync(cancellable => Polkit.Permission.new(
                'org.freedesktop.NetworkManager.network-control', null, cancellable), permission => {
                this._configPermission = permission;
                this.quickSettingsItems.forEach(toggle => permission.bind_property(
                    'allowed', toggle, 'reactive', GObject.BindingFlags.SYNC_CREATE));
            }).catch(error => {
                log(`No permission to control network connections: ${error}`);
                this._configPermission = null;
            });
        });
    }
});
