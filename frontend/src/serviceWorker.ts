/**
 * Service Worker management, registration, and PWA utilities.
 */

const isLocalhost = Boolean(
  window.location.hostname === 'localhost' ||
    window.location.hostname === '[::1]' ||
    window.location.hostname.match(
      /^127(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/
    )
);

type Config = {
  onSuccess?: (registration: ServiceWorkerRegistration) => void;
  onUpdate?: (registration: ServiceWorkerRegistration) => void;
};

export function register(config?: Config): void {
  if ('serviceWorker' in navigator && (process.env.NODE_ENV === 'production' || isLocalhost)) {
    const publicUrl = new URL(window.location.href);
    if (publicUrl.origin !== window.location.origin) {
      return;
    }

    window.addEventListener('load', () => {
      const swUrl = `/sw.js`;

      if (isLocalhost) {
        checkValidServiceWorker(swUrl, config);
        navigator.serviceWorker.ready.then(() => {
          console.log('App is being served cache-first by a service worker');
        });
      } else {
        registerValidSW(swUrl, config);
      }
    });
  }
}

function registerValidSW(swUrl: string, config?: Config) {
  navigator.serviceWorker
    .register(swUrl)
    .then((registration) => {
      registration.onupdatefound = () => {
        const installingWorker = registration.installing;
        if (installingWorker == null) {
          return;
        }
        installingWorker.onstatechange = () => {
          if (installingWorker.state === 'installed') {
            if (navigator.serviceWorker.controller) {
              console.log('New content is available and will be used when all tabs are closed.');
              if (config && config.onUpdate) {
                config.onUpdate(registration);
              }
            } else {
              console.log('Content is cached for offline use.');
              if (config && config.onSuccess) {
                config.onSuccess(registration);
              }
            }
          }
        };
      };
    })
    .catch((error) => {
      console.error('Error during service worker registration:', error);
    });
}

function checkValidServiceWorker(swUrl: string, config?: Config) {
  fetch(swUrl, {
    headers: { 'Service-Worker': 'script' },
  })
    .then((response) => {
      const contentType = response.headers.get('content-type');
      if (
        response.status === 404 ||
        (contentType != null && contentType.indexOf('javascript') === -1)
      ) {
        navigator.serviceWorker.ready.then((registration) => {
          registration.unregister().then(() => {
            window.location.reload();
          });
        });
      } else {
        registerValidSW(swUrl, config);
      }
    })
    .catch(() => {
      console.log('No internet connection found. App is running in offline mode.');
    });
}

export function unregister(): void {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready
      .then((registration) => {
        registration.unregister();
      })
      .catch((error) => {
        console.error(error.message);
      });
  }
}

/**
 * PWA install prompt support.
 *
 * Browsers fire a `beforeinstallprompt` event when the app is installable.
 * We capture and defer it so the UI can trigger the native install prompt
 * later (e.g. from a button in the app).
 */

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

type InstallStateListener = (canInstall: boolean) => void;

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installInitialized = false;
const installStateListeners = new Set<InstallStateListener>();

function notifyInstallState(): void {
  const canInstall = deferredPrompt !== null;
  installStateListeners.forEach((listener) => {
    try {
      listener(canInstall);
    } catch (err) {
      console.error('Error in install state listener:', err);
    }
  });
}

/**
 * Start listening for the `beforeinstallprompt` and `appinstalled` events.
 * Safe to call multiple times; listeners are only attached once.
 */
export function initInstallPrompt(): void {
  if (installInitialized || typeof window === 'undefined') {
    return;
  }
  installInitialized = true;

  window.addEventListener('beforeinstallprompt', (event: Event) => {
    // Prevent the mini-infobar from appearing on mobile
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notifyInstallState();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notifyInstallState();
  });
}

/**
 * Whether the app can currently be installed (a deferred prompt is available).
 */
export function canInstall(): boolean {
  return deferredPrompt !== null;
}

/**
 * Trigger the native install prompt. Resolves to the user's choice outcome,
 * or null if no prompt is available.
 */
export async function install(): Promise<'accepted' | 'dismissed' | null> {
  if (!deferredPrompt) {
    return null;
  }

  const promptEvent = deferredPrompt;
  // The prompt can only be used once
  deferredPrompt = null;

  try {
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    notifyInstallState();
    return choice.outcome;
  } catch (err) {
    console.error('Failed to show install prompt:', err);
    notifyInstallState();
    return null;
  }
}

/**
 * Subscribe to changes in install availability. Returns an unsubscribe function.
 */
export function onInstallStateChange(listener: InstallStateListener): () => void {
  installStateListeners.add(listener);
  return () => {
    installStateListeners.delete(listener);
  };
}

/**
 * Request notification permissions and register push notifications for credential expiry
 */
export async function subscribeToCredentialExpiryPush(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('Push messaging is not supported in this browser.');
    return null;
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    console.log('Notification permission not granted');
    return null;
  }

  const registration = await navigator.serviceWorker.ready;
  try {
    const existing = await registration.pushManager.getSubscription();
    if (existing) return existing;

    // Use a placeholder applicationServerKey if not provided in environment
    return await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: new Uint8Array([
        0x04, 0x5a, 0x3b, 0x1c, 0x4f, 0x6e, 0x8a, 0x9b, 0x2c, 0x3d, 0x4e, 0x5f, 0x6a, 0x7b, 0x8c, 0x9d,
        0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80, 0x90, 0xa0, 0xb0, 0xc0, 0xd0, 0xe0, 0xf0, 0x01,
        0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x11, 0x12,
        0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x21, 0x22, 0x23, 0x24
      ]),
    });
  } catch (err) {
    console.error('Failed to subscribe to push notifications:', err);
    return null;
  }
}
