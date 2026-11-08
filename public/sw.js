const CACHE = "ditzz-finance-shell-v17";
const SHELL = ["/", "/style.css", "/app.js", "/manifest.webmanifest", "/app-icon.svg"];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); }
    return response;
  }).catch(() => caches.match(event.request).then(cached => cached || caches.match("/"))));
});

self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch { data = { body: event.data ? event.data.text() : "Ada pengingat baru." }; }

  const title = data.title || "DITZZ FINANCE";
  const body = data.body || data.message || "Ada informasi baru dari DITZZ FINANCE.";
  const detail = data.detail || data.details || "";
  const options = {
    body: detail ? `${body}\n\n${detail}` : body,
    icon: "/app-icon-192.png",
    badge: "/app-icon-192.png",
    tag: data.tag || `ditzz-finance-${Date.now()}`,
    renotify: true,
    silent: false,
    vibrate: [180, 90, 180],
    requireInteraction: true,
    timestamp: Date.now(),
    dir: "auto",
    lang: "id-ID",
    data: { url: data.url || "/", detail, payload: data },
    actions: [{ action: "open", title: "Buka aplikasi" }]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(event.notification.data && event.notification.data.url || "/", self.location.origin);
  if (target.origin !== self.location.origin) target.href = self.location.origin + "/";
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const client of list) { if (new URL(client.url).origin === self.location.origin) return client.focus(); }
    return clients.openWindow(target.href);
  }));
});
