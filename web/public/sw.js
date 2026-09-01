/*
 * The service worker. Sixty lines, no build step, no dependency.
 *
 * It exists for two reasons. Chrome will not offer to install a web app without
 * one, and a planner you cannot open on a train is not much of a planner.
 *
 * Three rules, and the split between them is the whole design:
 *
 *   /api      network only. This is the data, and a stale answer here is worse
 *             than an error — you would tick off a task that no longer exists.
 *             Offline means the app says so, not that it lies.
 *   /assets   cache first. Vite gives every build a content hash, so a name
 *             that is in the cache can never be the wrong file.
 *   the shell network first, cache as the fallback. index.html is NOT
 *             content-hashed, so caching it first would pin the app to whatever
 *             build was installed and no deploy would ever reach the phone.
 */
const VERSION = 'planner-v1'
const SHELL = '/index.html'

self.addEventListener('install', (e) => {
  // Take over as soon as this one is ready rather than waiting for every tab to
  // close, which on a phone can be never.
  self.skipWaiting()
  e.waitUntil(caches.open(VERSION).then((c) => c.add(SHELL)).catch(() => {}))
})

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // Anything from an older version is a different app.
    for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key)
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (e) => {
  const { request } = e
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // The data. Never served from a cache; see the file comment.
  if (url.pathname.startsWith('/api/')) return

  // Uploads are content-addressed, so a hit is always the right bytes.
  const immutable = url.pathname.startsWith('/assets/')
    || url.pathname.startsWith('/brand/')
    || url.pathname.startsWith('/uploads/')

  if (immutable) {
    e.respondWith((async () => {
      const hit = await caches.match(request)
      if (hit) return hit
      const res = await fetch(request)
      if (res.ok) (await caches.open(VERSION)).put(request, res.clone())
      return res
    })())
    return
  }

  // Everything else is a navigation: the app shell, whatever the path.
  if (request.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(request)
        if (res.ok) (await caches.open(VERSION)).put(SHELL, res.clone())
        return res
      } catch {
        return (await caches.match(SHELL)) || Response.error()
      }
    })())
  }
})
