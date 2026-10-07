/**
 * Browser fetch property descriptor compatibility helper.
 * Ensures window.fetch descriptor is configurable and writable so third-party
 * extensions or testing tools can safely wrap fetch without throwing TypeErrors.
 */
(function initFetchCompatibility() {
  if (typeof window === 'undefined') return;
  try {
    const win = window as any;
    const _origFetch = win.fetch;
    let currentFetch: any = typeof _origFetch === 'function' ? _origFetch.bind(win) : _origFetch;

    // Walk prototype chain of window to ensure any 'fetch' getter has a corresponding setter
    let proto: any = win;
    while (proto) {
      try {
        const desc = Object.getOwnPropertyDescriptor(proto, 'fetch');
        if (desc && !desc.set && desc.configurable) {
          Object.defineProperty(proto, 'fetch', {
            get: function () {
              return currentFetch;
            },
            set: function (fn) {
              currentFetch = fn;
            },
            configurable: true,
            enumerable: true,
          });
        }
      } catch {}
      proto = Object.getPrototypeOf(proto);
    }

    // Ensure window own property 'fetch' has getter and setter so window.fetch = fn never throws
    try {
      const winDesc = Object.getOwnPropertyDescriptor(win, 'fetch');
      if (!winDesc || (!winDesc.set && winDesc.configurable !== false)) {
        Object.defineProperty(win, 'fetch', {
          get: function () {
            return currentFetch;
          },
          set: function (fn) {
            currentFetch = fn;
          },
          configurable: true,
          enumerable: true,
        });
      }
    } catch {}

    // Suppress unhandled errors originating from third-party browser extensions
    if (typeof win.addEventListener === 'function') {
      win.addEventListener(
        'error',
        (event: any) => {
          if (
            event &&
            event.filename &&
            (event.filename.startsWith('chrome-extension://') ||
              event.filename.startsWith('moz-extension://') ||
              event.filename.startsWith('safari-extension://'))
          ) {
            if (typeof event.preventDefault === 'function') {
              event.preventDefault();
            }
          }
        },
        true
      );
    }
  } catch {}
})();

