/**
 * send-reminder-push - the half of a reminder that runs while the phone is
 * locked. pg_cron calls this every minute (see supabase/reminders.sql); it
 * finds reminders whose local time has come, pushes to every device that user
 * subscribed, and stamps them so they cannot go twice.
 *
 * IT IS A SEPARATE FUNCTION FROM send-timer-push ON PURPOSE. The rest timer is
 * the thing Ruben trusts mid-set, and it already survived one outage caused by
 * a change made next door to it (vault/decisions.md, "Code shipped ahead of
 * its migration"). Sharing a function would mean a bad reminder deploy takes
 * the rest alert down with it. They share the plumbing that is genuinely
 * shared - the VAPID keys, push_subscriptions, sw.js - and nothing else.
 *
 * THE CLOCK IS THE PERSON'S, NOT THE SERVER'S. Nothing here stores an absolute
 * moment to fire. It stores 07:00 plus a timezone, and every tick asks "what
 * time is it where he is, and is it past 07:00 yet". That is why the reminder
 * does not drift an hour when the clocks change, and why it is still 07:00
 * when he lands somewhere else and the tile re-syncs the new zone.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2'
import * as webpush from 'jsr:@negrel/webpush@0.3'
// The rule - is this one due right now - lives in plain JavaScript next door
// so that node can run the REAL thing rather than a second copy of it that is
// asserted to look similar. See due.mjs for why that distinction is the whole
// point, and tools/reminders.test.js for what it buys.
import { dueKey } from './due.mjs'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com'

// A push service is entitled to tell us a subscription is dead. These two mean
// exactly that, and the only correct response is to delete the row - retrying
// forever against a 410 is how a subscriptions table fills with corpses.
const GONE = new Set([404, 410])

// Same VAPID key handling as send-timer-push, and for the same hard-won
// reason: importVapidKeys() hands its arguments to crypto.importKey('jwk'),
// which needs JWK OBJECTS. Passing the base64url strings straight out of the
// environment throws inside the handler and Deno answers a bare 500 with
// nothing in it. That cost six hours once. See send-timer-push/index.ts.
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
  return {
    publicKey: { kty: 'EC', crv: 'P-256', x, y, ext: true },
    privateKey: { kty: 'EC', crv: 'P-256', x, y, d: priv, ext: true }
  }
}

type Reminder = {
  user_id: string
  id: string
  title: string
  body: string | null
  at_time: string
  tz: string
  repeat: string
  days: number[] | null
  on_date: string | null
  enabled: boolean
  sticky: boolean
  last_fired_key: string | null
  updated_at: string
}


Deno.serve(async (req) => {
  // EVERYTHING IS INSIDE THIS TRY, for the reason send-timer-push spells out:
  // an uncaught throw reaches SQL as a bare 500 with the cause invisible.
  try {
    return await handle(req)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('send-reminder-push failed:', message)
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    })
  }
})

async function handle(_req: Request): Promise<Response> {
  const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })

  // EVERY ENABLED REMINDER, and the filtering happens here in JS rather than in
  // SQL. It has to: "is it 07:00 yet" is a different question in every row's
  // own timezone, and Postgres would need the same Intl work in plpgsql to
  // answer it. The set is small - one person's reminders - and the partial
  // index makes reading it cheap.
  const { data, error } = await db
    .from('reminders')
    .select('user_id, id, title, body, at_time, tz, repeat, days, on_date, enabled, sticky, last_fired_key, updated_at')
    .eq('enabled', true)
    .limit(1000)

  if (error) {
    console.error('reading reminders failed:', error.message)
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    })
  }

  const now = Date.now()
  const rows = (data ?? []) as unknown as Reminder[]
  const due = rows
    .map(r => ({ r, key: dueKey(r, now) }))
    .filter((x): x is { r: Reminder; key: string } => x.key !== null)

  if (due.length === 0) {
    return new Response(JSON.stringify({ ok: true, considered: rows.length, sent: 0 }), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const appServer = await webpush.ApplicationServer.new({
    contactInformation: VAPID_SUBJECT,
    vapidKeys: await webpush.importVapidKeys(vapidJwks(VAPID_PUBLIC, VAPID_PRIVATE), { extractable: false })
  })

  // One read of the subscriptions per user, not per reminder. Two reminders at
  // 07:00 is an ordinary morning and there is no reason to ask twice.
  const subsByUser = new Map<string, { endpoint: string; p256dh: string; auth: string }[]>()
  async function subsFor(userId: string) {
    const hit = subsByUser.get(userId)
    if (hit) return hit
    const { data: subs } = await db
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('user_id', userId)
    const list = subs ?? []
    subsByUser.set(userId, list)
    return list
  }

  let sent = 0
  let dropped = 0

  for (const { r, key } of due) {
    for (const s of await subsFor(r.user_id)) {
      try {
        const subscriber = appServer.subscribe({
          endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth }
        })
        await subscriber.pushTextMessage(JSON.stringify({
          // HIS WORDS, NOT MINE. The title and body are exactly what he typed
          // into the tile. Nothing here decorates them, appends to them, or
          // invents a cheerful sentence when the body is empty. A reminder
          // that says something he did not write is not his reminder.
          title: r.title,
          body: r.body || '',
          // Per reminder, so two different ones at 07:00 both appear. The same
          // reminder arriving twice replaces itself, which is what a tag is
          // for.
          tag: 'reminder:' + r.id,
          sticky: !!r.sticky,
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
          // reminder unstamped to be retried every minute for the next hour.
          console.error('push failed for', s.endpoint.slice(0, 40), status ?? e)
        }
      }
    }

    // STAMPED WHETHER OR NOT A DEVICE TOOK IT, for the same reason the rest
    // timer marks itself fired: the alternative is retrying every minute of
    // the grace window because one subscription is broken.
    //
    // A one-off also switches itself off. That is belt and braces - the rule
    // 'once' only ever matches its own date, so it could not come round again
    // - but a switched-off row is one the tile can honestly show as sent, and
    // one fewer row the next tick has to look at.
    const patch: Record<string, unknown> = { last_fired_key: key }
    if (r.repeat === 'once') patch.enabled = false

    // updated_at is deliberately NOT touched here. It records when the RULE
    // was last written, and dueKey() compares it against the occurrence to
    // decide whether an occurrence predates its own rule. Bumping it on every
    // send would make that comparison meaningless.
    const { error: stampErr } = await db.from('reminders')
      .update(patch).eq('user_id', r.user_id).eq('id', r.id)
    if (stampErr) console.error('stamping reminder failed:', r.id, stampErr.message)
  }

  return new Response(JSON.stringify({ ok: true, considered: rows.length, due: due.length, sent, dropped }), {
    headers: { 'Content-Type': 'application/json' }
  })
}
