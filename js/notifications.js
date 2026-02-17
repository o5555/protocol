const PushNotifications = {
    _userId: null,
    _prompted: false,

    async init(userId) {
        this._userId = userId;

        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            return;
        }

        const permission = Notification.permission;
        if (permission === 'granted') {
            await this._subscribe();
        } else if (permission === 'default' && !localStorage.getItem('push_prompt_dismissed')) {
            this._showPrompt();
        }
    },

    _showPrompt() {
        if (this._prompted) return;
        this._prompted = true;

        const banner = document.createElement('div');
        banner.id = 'push-prompt';
        banner.className = 'mx-4 mt-4 p-4 bg-oura-card border border-oura-border rounded-2xl flex items-start gap-3';
        banner.innerHTML = `
            <div class="text-2xl mt-0.5">&#128276;</div>
            <div class="flex-1 min-w-0">
                <p class="text-sm text-white font-medium">Enable notifications</p>
                <p class="text-xs text-oura-muted mt-1">Get notified when your leaderboard is ready.</p>
                <button id="push-enable-btn" class="mt-3 px-4 py-2 bg-oura-accent text-black text-sm font-semibold rounded-xl">
                    Enable
                </button>
            </div>
            <button id="push-dismiss-btn" class="text-oura-muted hover:text-white p-1">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                </svg>
            </button>
        `;

        // Insert at top of app section content
        const appContent = document.getElementById('app-content');
        if (appContent) {
            appContent.insertBefore(banner, appContent.firstChild);
        }

        document.getElementById('push-enable-btn')?.addEventListener('click', () => {
            this.requestPermission();
        });

        document.getElementById('push-dismiss-btn')?.addEventListener('click', () => {
            banner.remove();
            localStorage.setItem('push_prompt_dismissed', 'true');
        });
    },

    async requestPermission() {
        try {
            const result = await Notification.requestPermission();
            const banner = document.getElementById('push-prompt');

            if (result === 'granted') {
                if (banner) banner.remove();
                await this._subscribe();
            } else {
                if (banner) banner.remove();
                localStorage.setItem('push_prompt_dismissed', 'true');
            }
        } catch (err) {
            console.warn('[push] Permission request failed:', err);
        }
    },

    async _subscribe() {
        try {
            const registration = await navigator.serviceWorker.ready;

            // Check for existing subscription first
            let subscription = await registration.pushManager.getSubscription();

            if (!subscription) {
                // Get VAPID public key from server
                const response = await fetch('/api/push/vapid-key');
                const { publicKey } = await response.json();

                if (!publicKey) {
                    console.warn('[push] No VAPID public key available');
                    return;
                }

                subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: this._urlBase64ToUint8Array(publicKey)
                });
            }

            // Send subscription to server
            await fetch('/api/push/subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    subscription: subscription.toJSON(),
                    userId: this._userId
                })
            });
        } catch (err) {
            console.warn('[push] Subscription failed:', err);
        }
    },

    _urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; i++) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }
};
