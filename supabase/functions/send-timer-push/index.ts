/**
 * send-timer-push - the half of the rest timer that runs when the phone is
 * locked. pg_cron calls this every 15 seconds (see supabase/push.sql); it
 * finds timers whose time has come, pushes to every device that user has
 * subscribed, and marks them fired.
 *
 * WHY A DENO-NATIVE WEB PUSH LIBRARY. Web push is not just an HTTP POST: the
 * payload is encrypted to the device's own keys (RFC 8291) and the request is
 * signed with VAPID (RFC 8292). @negrel/webpush does both against Deno's own
 * WebCrypto. The npm `web-push` package is built on Node's crypto and only
 * runs here through a compatibility layer, which is a lot of surface to carry
 * for one function.
 *
 * WHY NOT FIREBASE. It would mean a second vendor, a second console and a
 * second set of credentials next to Supabase, for one feature. Web Push is a
 * standard and every browser this board targets speaks it directly.
 *
 * THE SERVICE ROLE KEY IS USED ON PURPOSE. Cron is not a signed-in user, so
 * RLS would hide every row from it. This function must read timers across all
 * users, which is exactly what that key is for - and it never leaves the
 * server.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2'
import * as webpush from 'jsr:@negrel/webpush@0.3'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com'

// A push service is entitled to tell us a subscription is dead. These two mean
// exactly that, and the only correct response is to delete the row - retrying
// forever against a 410 is how a subscriptions table fills with corpses.
const GONE = new Set([404, 410])

Deno.serve(async () => {
  const db = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false }
  })

  // Due and not yet sent. `lte(now)` rather than a window: if the function was
  // down for a minute, the timers it missed are still due and should still
  // fire rather than being skipped for being slightly stale.
  const { data: timers, error } = await db
    .from('rest_timers')
    .select('id, user_id, fire_at, label')
    .eq('fired', false)
    .lte('fire_at', new Date().toISOString())
    .order('fire_at', { ascending: true })
    .limit(200)

  if (error) {
    console.error('reading timers failed:', error.message)
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    })
  }
  if (!timers || timers.length === 0) {
    return new Response(JSON.stringify({ ok: true, sent: 0 }), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const appServer = await webpush.ApplicationServer.new({
    contactInformation: VAPID_SUBJECT,
    vapidKeys: await webpush.importVapidKeys(
      { publicKey: VAPID_PUBLIC, privateKey: VAPID_PRIVATE },
      { extractable: false }
    )
  })

  let sent = 0
  let dropped = 0

  for (const t of timers) {
    const { data: subs } = await db
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('user_id', t.user_id)

    for (const s of subs ?? []) {
      try {
        const subscriber = appServer.subscribe({
          endpoint: s.endpoint,
          keys: { p256dh: s.p256dh, auth: s.auth }
        })
        await subscriber.pushTextMessage(JSON.stringify({
          title: 'Rest is up',
          body: t.label ? `${t.label} - back to it.` : 'Back to it.',
          tag: 'rest-timer',
          url: '/'
        }), {})
        sent++
      } catch (e) {
        const status = (e as { statusCode?: number })?.statusCode
        if (status && GONE.has(status)) {
          await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint)
          dropped++
        } else {
          // One bad device must not stop the others, and must not leave the
          // timer unfired to be retried every 15 seconds forever.
          console.error('push failed for', s.endpoint.slice(0, 40), status ?? e)
        }
      }
    }

    // Marked fired whether or not a device took it. The alternative is a timer
    // that retries every tick for the rest of time because one subscription is
    // broken - a notification that is already late is not worth that.
    await db.from('rest_timers').update({ fired: true }).eq('id', t.id)
  }

  return new Response(JSON.stringify({ ok: true, timers: timers.length, sent, dropped }), {
    headers: { 'Content-Type': 'application/json' }
  })
})
