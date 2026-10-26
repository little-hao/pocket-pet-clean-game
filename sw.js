const CACHE_PREFIX = "pocket-pet-shell-";
const CACHE_NAME = `${CACHE_PREFIX}0.2.0`;
const SCOPE_URL = new URL(self.registration.scope);
const SHELL_URL = SCOPE_URL.href;

async function cacheInitialAppShell() {
  const response = await fetch(new Request(SHELL_URL, { cache: "reload" }));
  if (!response.ok) throw new Error("无法缓存应用入口");

  const cache = await caches.open(CACHE_NAME);
  await cache.put(SHELL_URL, response.clone());

  const html = await response.text();
  const assetUrls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => new URL(match[1], SCOPE_URL).href)
    .filter((url) => url.startsWith(SCOPE_URL.href));
  await Promise.all(assetUrls.map((url) => cache.add(url)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheInitialAppShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CACHE_APP_SHELL" || !Array.isArray(event.data.urls)) {
    return;
  }

  const urls = event.data.urls.filter((candidate) => {
    try {
      const url = new URL(candidate);
      return url.origin === SCOPE_URL.origin && url.pathname.startsWith(SCOPE_URL.pathname);
    } catch {
      return false;
    }
  });

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(
        urls.map((url) => cache.add(new Request(url, { cache: "reload" }))),
      ),
    ),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== SCOPE_URL.origin || !url.pathname.startsWith(SCOPE_URL.pathname)) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put(SHELL_URL, copy));
          }
          return response;
        })
        .catch(async () =>
          (await caches.match(request, { ignoreVary: true })) ??
          (await caches.match(SHELL_URL, { ignoreVary: true })) ??
          Response.error(),
        ),
    );
    return;
  }

  event.respondWith(
    // Vite preview adds a Vary header to module assets. The install-time
    // request and the browser's later module request can therefore carry
    // different request headers even though they identify the same local
    // file. Same-origin URLs are already checked above, so matching the
    // versioned cache by URL here is the intended rule.
    caches.match(request, { ignoreVary: true }).then(async (cached) => {
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) {
        const copy = response.clone();
        void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    }),
  );
});
