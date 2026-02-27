/**
 * EM Flow — Service Worker
 *
 * Features:
 *   - App shell caching for offline support
 *   - Push notification handling
 *   - Background sync for failed requests (future)
 *   - Cache-first strategy for static assets
 *   - Network-first strategy for API calls
 */

const CACHE_NAME = "em-flow-v1";
const APP_SHELL = ["/", "/index.html"];

// ── Install: Cache app shell ──
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL).catch(() => {
        // Non-critical: some assets may not cache during dev
      });
    })
  );
  self.skipWaiting();
});

// ── Activate: Clean old caches ──
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// ── Fetch: Network-first for API, cache-first for assets ──
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== "GET") return;

  // Skip API calls and Supabase requests — always network
  if (
    url.pathname.includes("/functions/") ||
    url.hostname.includes("supabase") ||
    url.pathname.startsWith("/make-server")
  ) {
    return;
  }

  // For navigation requests, try network first, then cache
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match("/index.html");
      })
    );
    return;
  }

  // For static assets: stale-while-revalidate
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((response) => {
          // Only cache successful responses for same-origin
          if (response.ok && url.origin === self.location.origin) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, clone);
            });
          }
          return response;
        })
        .catch(() => cached);

      return cached || fetchPromise;
    })
  );
});

// ── Push Notification handler ──
self.addEventListener("push", (event) => {
  let data = { title: "EM Flow", body: "Queue update", tag: "queue-update" };

  try {
    if (event.data) {
      data = { ...data, ...event.data.json() };
    }
  } catch {
    // Use defaults if JSON parse fails
  }

  const options = {
    body: data.body,
    icon: "/icon-192.png",
    badge: "/icon-72.png",
    tag: data.tag || "queue-update",
    vibrate: [200, 100, 200],
    requireInteraction: data.tag === "your-turn",
    data: data,
    actions: [],
  };

  // Add action buttons for "your turn" notifications
  if (data.tag === "your-turn") {
    options.actions = [
      { action: "view", title: "View Status" },
      { action: "dismiss", title: "Dismiss" },
    ];
    options.requireInteraction = true;
  }

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// ── Notification click handler ──
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  let targetUrl = "/";

  if (data.entryId) {
    targetUrl = `/status/${data.entryId}`;
  } else if (data.url) {
    targetUrl = data.url;
  }

  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      // Focus existing window if available
      for (const client of clients) {
        if (client.url.includes(targetUrl) && "focus" in client) {
          return client.focus();
        }
      }
      // Otherwise open new window
      return self.clients.openWindow(targetUrl);
    })
  );
});
