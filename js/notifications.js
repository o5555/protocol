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
        banner.style.cssText = 'padding-top: env(safe-area-inset-top, 0px);';
        banner.className = 'mx-4 mt-2 mb-2 bg-oura-card/95 backdrop-blur-xl border border-oura-border/50 rounded-2xl overflow-hidden';
        banner.innerHTML = `
            <div class="px-4 py-3 flex items-center gap-3">
                <div class="w-9 h-9 rounded-xl bg-oura-accent/15 flex items-center justify-center flex-shrink-0">
                    <svg class="w-5 h-5 text-oura-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"/>
                    </svg>
                </div>
                <div class="flex-1 min-w-0">
                    <p class="text-sm text-white font-medium leading-tight">Enable notifications</p>
                    <p class="text-xs text-oura-muted mt-0.5 leading-tight">Know when your leaderboard is ready</p>
                </div>
                <button id="push-dismiss-btn" class="text-oura-muted p-1 flex-shrink-0">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                </button>
            </div>
            <div class="px-4 pb-3 flex gap-2">
                <button id="push-enable-btn" class="px-4 py-1.5 bg-oura-accent text-black text-xs font-semibold rounded-full">
                    Allow
                </button>
                <button id="push-dismiss-btn-2" class="px-4 py-1.5 bg-white/10 text-white/70 text-xs font-medium rounded-full">
                    Not now
                </button>
            </div>
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

        document.getElementById('push-dismiss-btn-2')?.addEventListener('click', () => {
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
