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

// A timer this far past due is not worth waking someone for, and must not be
// retried for ever. See the catch at the bottom for what "for ever" cost us.
const STALE_AFTER_MS = 60 * 60 * 1000

/**
 * VAPID KEYS ARE STORED AS BASE64URL AND IMPORTED AS JWK. Not the same thing,
 * and getting it wrong is silent: importVapidKeys() hands its arguments
 * straight to crypto.importKey('jwk', ...), which needs a JsonWebKey OBJECT.
 * Passing the base64url STRINGS out of the environment throws a TypeError
 * inside the request handler, which Deno turns into a bare 500 "Internal
 * Server Error" with no clue in it. That shipped, and cost 1439 consecutive
 * failed pushes over six hours before net._http_response gave it away.
 *
 * The public key is the uncompressed P-256 point - 0x04, then X, then Y, 65
 * bytes - so x and y are just slices of it. The private JWK needs x and y too,
 * not only d: a JWK describes the whole key pair position on the curve, and
 * importKey rejects a private EC JWK that omits them.
 */
function b64urlToBytes(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
function bytesToB64url(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function vapidJwks(pub: string, priv: string) {
  const raw = b64urlToBytes(pub)
  if (raw.length !== 65 || raw[0] !== 4) {
    throw new Error(`VAPID_PUBLIC_KEY is not an uncompressed P-256 point (got ${raw.length} bytes, first byte ${raw[0]})`)
  }
  const x = bytesToB64url(raw.subarray(1, 33))
  const y = bytesToB64url(raw.subarray(33, 65))
  // No key_ops: importVapidKeys asks for ['verify'] and ['sign'] separately,
  // and a key_ops in the JWK that does not cover what is asked for is rejected.
  return {
    publicKey: { kty: 'EC', crv: 'P-256', x, y, ext: true },
    privateKey: { kty: 'EC', crv: 'P-256', x, y, d: priv, ext: true }
  }
}

Deno.serve(async () => {
  // EVERYTHING IS INSIDE THIS TRY. An uncaught throw here does not reach
  // net._http_response as anything readable - Deno answers a bare 500 with
  // the string "Internal Server Error", and the actual cause is invisible
  // from SQL. That is precisely how a key-import TypeError hid for six hours.
  // Catching it and answering with the message means the next failure is one
  // query away from being understood.
  try {
    return await handle()
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('send-timer-push failed:', message)
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    })
  }
})

async function handle(): Promise<Response> {
  const db = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false }
  })

  // Due and not yet sent, within a WINDOW. The lower bound is not fussiness:
  // without it, a timer the function can never send - because of a bad key, a
  // bad deploy, anything - stays due for ever and is retried every 15 seconds
  // until someone notices. It is bounded now, so a broken hour costs an hour
  // of retries and then stops. A rest timer an hour late is not worth sending
  // anyway; the set is long over.
  const now = Date.now()
  const { data: timers, error } = await db
    .from('rest_timers')
    .select('id, user_id, fire_at, label')
    .eq('fired', false)
    .lte('fire_at', new Date(now).toISOString())
    .gte('fire_at', new Date(now - STALE_AFTER_MS).toISOString())
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
      vapidJwks(VAPID_PUBLIC, VAPID_PRIVATE),
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
