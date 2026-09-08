/**
 * THE SERVICE WORKER. It exists for exactly one reason: to be awake when the
 * page is not, so the board can still reach you with the phone locked. Two
 * things send through it - the rest timer (supabase/functions/send-timer-push)
 * and reminders (send-reminder-push) - and this file does not care which:
 * it shows whatever the payload says, with no opinion of its own.
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

  /**
   * THE FALLBACK IS NEUTRAL, AND IT USED TO SAY "Rest is up".
   *
   * That was true while the rest timer was the only thing that pushed. It is
   * not any more: a reminder arriving with a payload this worker could not
   * parse would have announced itself as a rest timer, which is a made-up
   * sentence on a locked phone and exactly the kind of small lie the house
   * rules forbid. When the payload is unreadable the only honest thing to say
   * is that the board wants you, and nothing about why.
   */
  var title = data.title || 'The Citadel'
  var body = data.body || ''

  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      icon: '/icons/icon-192.png',
      badge: '/icons/favicon-32.png',
      // The sender decides what replaces what. The rest timer sends one fixed
      // tag, so a second timer replaces the first rather than stacking two
      // "rest is up" notifications from one session; a reminder sends its own
      // id, so two different reminders at 07:00 both appear and the same one
      // arriving twice does not.
      tag: data.tag || 'rest-timer',
      renotify: true,
      // Stays on screen until it is tapped, for a reminder that asked to. The
      // tile is honest that iOS largely ignores this; Android honours it.
      requireInteraction: !!data.sticky,
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
