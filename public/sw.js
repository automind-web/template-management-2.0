/* Service worker: push-уведомления и открытие задачи по нажатию. Кэширования нет — кабинет всегда актуален. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
function safeUrl(path) {
  try {
    const url = new URL(path || "/notifications", self.location.origin);
    return url.origin === self.location.origin ? url.href : new URL("/notifications", self.location.origin).href;
  } catch { return new URL("/notifications", self.location.origin).href; }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    Promise.all([self.registration.showNotification(data.title || "Уведомление", {
      body: data.body || "",
      tag: data.tag,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: safeUrl(data.url) },
    }), self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      clients.forEach((client) => client.postMessage({ type: "notification" }));
    })]),
  );
});

/* Права проверяются заново: открывается страница сайта, сервер решает, доступна ли задача. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = safeUrl(event.notification.data?.url);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (new URL(client.url).origin === self.location.origin && "focus" in client) {
          return client.navigate(url).then(() => client.focus());
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
