/**
 * THE SERVICE WORKER. It exists for exactly one reason: to be awake when the
 * page is not, so a rest timer can still reach you with the phone locked.
 *
 * IT MUST SIT AT THE REPO ROOT. A service worker can only control pages at or
 * below its own path, so one served from /lib/ could never receive a push for
 * the board at /. Moving this file breaks push silently - the registration
 * still succeeds, it just never controls anything.
 *
 * THERE IS DELIBERATELY NO CACHING HERE. This board has no offline story, and
 * a worker that starts caching would begin serving stale tiles the moment one
 * is edited - a whole class of "why is my change not showing" that is much
 * worse than having no offline mode. If offline is ever wanted it is its own
 * piece of work, decided on purpose.
 */

// A new worker replaces the old one immediately rather than waiting for every
// tab to close. Without these two, a fixed worker can sit unused for days.
self.addEventListener('install', function (e) { self.skipWaiting() })
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()) })

self.addEventListener('push', function (event) {
  // NEVER let a malformed payload swallow the notification. On iOS a push that
  // arrives and shows nothing counts against the site and can cost the
  // subscription outright, so anything unparseable still shows something true.
  var data = {}
  try { data = event.data ? event.data.json() : {} } catch (e) { data = {} }

  var title = data.title || 'Rest is up'
  var body = data.body || 'Back to it.'

  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      icon: '/icons/icon-192.png',
      badge: '/icons/favicon-32.png',
      // Same tag means a second timer replaces the first rather than stacking
      // two "rest is up" notifications from one session.
      tag: data.tag || 'rest-timer',
      renotify: true,
      requireInteraction: false,
      vibrate: [40, 80, 40],
      data: { url: data.url || '/' }
    })
  )
})

self.addEventListener('notificationclick', function (event) {
  event.notification.close()
  var target = (event.notification.data && event.notification.data.url) || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      // Focus the board if it is already open - opening a second copy of a
      // single-page board is never what was wanted.
      for (var i = 0; i < list.length; i++) {
        var c = list[i]
        if (c.url.indexOf(self.registration.scope) === 0 && 'focus' in c) return c.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(target)
    })
  )
})
