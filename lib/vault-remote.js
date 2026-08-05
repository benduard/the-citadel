/**
 * THE REMOTE VAULT - the Supabase half of host.js's storage seam.
 *
 * host.js's Store object is the seam ("one seam to swap; Supabase later
 * touches no tile"). This file is what it swaps to, once someone is signed
 * in. Same two tables sync.sql already created:
 *   vault_slots (user_id, slot, data)  - one row per tile, primary key
 *                                        (user_id, slot). Matches host.js's
 *                                        Store.saveData/loadData exactly.
 *   ledger (user_id, key, date, ...)   - one row per key per day. A same-day
 *                                        re-report REPLACES that row rather
 *                                        than stacking a second, mirroring
 *                                        Store.appendLedger. Done as
 *                                        select-then-update-or-insert so a
 *                                        board whose table predates the
 *                                        unique index behaves the same.
 *
 * Signed out, or the CDN script hasn't loaded: every function here resolves
 * to the same "nothing happened yet" values host.js already treats as
 * first-run / no-op, so host.js's fallback to localStorage never needs a
 * special case for "remote isn't ready".
 */
;(function () {
  'use strict'

  // Never swallow a failure in silence. A vault write that did not land must be
  // visible somewhere, or the board lies with a calm face.
  function warn(what, err) {
    try { console.warn('[vault] ' + what, err || '') } catch (e) {}
  }

  var client = null
  function getClient() {
    if (client) return client
    if (!window.supabase || typeof window.supabase.createClient !== 'function') return null
    if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) return null
    // These are already supabase-js's defaults - stated outright so a future
    // library upgrade changing its defaults can never quietly turn either
    // one off underneath this board. persistSession keeps the session in
    // this browser's storage across restarts; autoRefreshToken renews it in
    // the background so being signed in does not depend on a browser tab
    // staying open continuously.
    client = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    })
    return client
  }

  function getSession() {
    var c = getClient()
    if (!c) return Promise.resolve(null)
    return c.auth.getSession().then(function (r) {
      return (r && r.data && r.data.session) || null
    }).catch(function (e) { warn('session check failed', e); return null })
  }

  function getUserId() {
    return getSession().then(function (s) { return (s && s.user && s.user.id) || null })
  }

  // Set right before THIS code calls signOut(), so a SIGNED_OUT event can
  // tell "you asked to leave" apart from "the session just dropped out from
  // under you" (an expired refresh token, storage the OS quietly cleared,
  // Supabase revoking it server-side). Supabase's own event has no such flag
  // - both look identical to it - so the caller has to remember its own intent.
  var expectingSignOut = false

  /**
   * ONE Supabase subscription, fanned out to every subscriber here.
   *
   * This must not be one subscription per caller. `expectingSignOut` is a
   * single value, and clearing it inside a per-caller handler means the
   * FIRST handler to run consumes it and every later one sees a deliberate
   * sign-out as an unexpected one. Both host.js and library.js subscribe, so
   * that is not hypothetical: it made every Sign out claim the session had
   * dropped on its own. Computing it once here, and clearing only after
   * everyone has been told, is what keeps the answer the same for all of them.
   */
  var authSubscribers = []
  var authWired = false

  function onAuthChange(cb) {
    var c = getClient()
    if (!c) return
    authSubscribers.push(cb)
    if (authWired) return
    authWired = true
    c.auth.onAuthStateChange(function (event, session) {
      var unexpected = event === 'SIGNED_OUT' && !expectingSignOut
      authSubscribers.forEach(function (fn) {
        try { fn(session, event, unexpected) } catch (e) { warn('auth subscriber threw', e) }
      })
      if (event === 'SIGNED_OUT') expectingSignOut = false
    })
  }

  function signInWithEmail(email) {
    var c = getClient()
    if (!c) return Promise.reject(new Error('Supabase not loaded'))
    return c.auth.signInWithOtp({
      email: email,
      options: { emailRedirectTo: window.location.origin }
    })
  }

  /**
   * The same email carries a clickable link AND a 6-digit code. The link
   * opens whatever the OS treats as "the browser" - on iOS that is Safari,
   * even when this board is installed as a home-screen app, because a link
   * tapped in Mail has no way to know a separate standalone copy exists. The
   * code has no such problem: it is typed into whichever window is already
   * open, so it is the one path that always lands in the right place.
   */
  function verifyCode(email, token) {
    var c = getClient()
    if (!c) return Promise.reject(new Error('Supabase not loaded'))
    return c.auth.verifyOtp({ email: email, token: token, type: 'email' })
  }

  function signOut() {
    var c = getClient()
    if (!c) return Promise.resolve()
    expectingSignOut = true
    return c.auth.signOut()
  }

  /**
   * Give this account a password, IN ADDITION to the emailed code.
   *
   * WHY A BOARD WITH NO PASSWORD SCREEN HAS THIS. Signing in here is a code in
   * an email, and that is still the way a human gets in - nothing below changes
   * that. But an automation cannot read an inbox. The wearable inlet
   * (supabase/wearable.sql) is an iPhone Shortcut that has to prove it is Ruben
   * once every morning with no one watching, and a password grant is the only
   * sign-in Supabase offers that a Shortcut can complete on its own.
   *
   * So the password exists for the Shortcut, not for you. It lives in the
   * Shortcut on the phone, next to the health data it is already reading, and
   * it buys nothing an attacker could not already do with that unlocked phone.
   *
   * Must be called from a signed-in session: Supabase changes the password of
   * whoever is holding the session, which is exactly the scoping we want. There
   * is no admin key here and no way to touch another account.
   *
   * Resolves { ok:true } or { ok:false, reason }.
   */
  function setPassword(password) {
    var c = getClient()
    if (!c) return Promise.resolve({ ok: false, reason: 'Sign in is not available on this board.' })
    if (typeof password !== 'string' || password.length < 12) {
      // Longer than Supabase's own floor of 6 on purpose. This one is typed
      // once into a Shortcut and never again, so there is no convenience to
      // trade away by making it long.
      return Promise.resolve({ ok: false, reason: 'Use at least 12 characters. You only ever type it once.' })
    }
    return getSession().then(function (session) {
      if (!session || !session.user) {
        return { ok: false, reason: 'Not signed in. Sign in first, then set the password.' }
      }
      return c.auth.updateUser({ password: password }).then(function (r) {
        if (r && r.error) { warn('set password failed', r.error); return { ok: false, reason: r.error.message } }
        return { ok: true, email: session.user.email || null }
      })
    }).catch(function (e) { warn('set password threw', e); return { ok: false, reason: 'Could not reach the vault.' } })
  }

  function loadSlot(id) {
    var c = getClient()
    if (!c) return Promise.resolve(null)
    return getUserId().then(function (uid) {
      if (!uid) return null
      return c.from('vault_slots').select('data').eq('user_id', uid).eq('slot', id).maybeSingle()
        .then(function (r) {
          if (r && r.error) { warn('slot load failed: ' + id, r.error); return null }
          return (r && r.data && r.data.data != null) ? r.data.data : null
        })
        .catch(function (e) { warn('slot load threw: ' + id, e); return null })
    })
  }

  function saveSlot(id, data) {
    var c = getClient()
    if (!c) return Promise.resolve(false)
    return getUserId().then(function (uid) {
      if (!uid) return false
      return c.from('vault_slots').upsert({
        user_id: uid,
        slot: id,
        data: data,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,slot' }).then(function (r) {
        if (r.error) { warn('slot save failed: ' + id, r.error); return false }
        return true
      }).catch(function (e) { warn('slot save threw: ' + id, e); return false })
    })
  }

  function appendLedger(tileId, stream) {
    var c = getClient()
    if (!c) return Promise.resolve(false)
    if (!stream || typeof stream !== 'object') return Promise.resolve(false)
    var value = Number(stream.value)
    if (!isFinite(value)) return Promise.resolve(false)
    var key = String(stream.key || '').trim()
    var date = String(stream.date || '').trim()
    if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return Promise.resolve(false)

    return getUserId().then(function (uid) {
      if (!uid) return false

      // THE CORE SHAPE is what sync.sql actually ships: key, value, date,
      // source. The tile spec's report() also carries label / kind /
      // goalDirection, and the local ledger keeps them, so sync.sql grew
      // matching columns. A board whose tables predate that has the core
      // columns only - so write the rich row, and if Postgres says a column
      // is missing, write the core row instead rather than losing the log.
      var core = {
        user_id: uid,
        key: key,
        value: value,
        date: date,
        source: 'manual', // a human tapped a tile. the mentor writes 'auto'.
        logged: new Date().toISOString()
      }
      var rich = {}
      for (var k in core) { if (Object.prototype.hasOwnProperty.call(core, k)) rich[k] = core[k] }
      rich.label = typeof stream.label === 'string' ? stream.label : key
      rich.kind = typeof stream.kind === 'string' ? stream.kind : 'measure'
      rich.goal_direction = stream.goalDirection === 'up' || stream.goalDirection === 'down' ? stream.goalDirection : 'neutral'
      rich.tile = tileId

      // PGRST204 is PostgREST's "column not found in schema cache": the signal
      // that this board is on the older ledger. Anything else is a real error.
      function missingColumn(err) {
        return !!err && (err.code === 'PGRST204' || /column .* does not exist|find the '.*' column/i.test(err.message || ''))
      }

      // 23505 = unique violation. Two taps in the same second both read "no
      // row yet" and both insert; the loser must become an update, not an
      // error, or a tapped number silently fails to land.
      function isDuplicate(err) { return !!err && err.code === '23505' }

      function put(existingId) {
        function write(row) {
          return existingId
            ? c.from('ledger').update(row).eq('id', existingId).eq('user_id', uid)
            : c.from('ledger').insert(row)
        }
        function asUpdate(row) {
          return c.from('ledger').update(row)
            .eq('user_id', uid).eq('key', key).eq('date', date)
            .then(function (r) {
              if (r.error) { warn('ledger write failed', r.error); return false }
              return true
            })
        }
        return write(rich).then(function (r) {
          if (!r.error) return true
          if (isDuplicate(r.error)) return asUpdate(rich)
          if (!missingColumn(r.error)) { warn('ledger write failed', r.error); return false }
          return write(core).then(function (r2) {
            if (!r2.error) return true
            if (isDuplicate(r2.error)) return asUpdate(core)
            warn('ledger write failed', r2.error)
            return false
          })
        })
      }

      return c.from('ledger').select('id').eq('user_id', uid).eq('key', key).eq('date', date).maybeSingle()
        .then(function (r) {
          if (r && r.error) { warn('ledger lookup failed', r.error); return false }
          return put(r && r.data ? r.data.id : null)
        })
        .catch(function (e) { warn('ledger write threw', e); return false })
    })
  }

  function readLedger() {
    var c = getClient()
    if (!c) return Promise.resolve([])
    return getUserId().then(function (uid) {
      if (!uid) return []
      return c.from('ledger').select('*').eq('user_id', uid).order('date', { ascending: false })
        .then(function (r) {
          if (r && r.error) { warn('ledger read failed', r.error); return [] }
          if (!r || !Array.isArray(r.data)) return []
          // Hand back the SAME shape the local ledger uses. Two shapes
          // depending on who is signed in would make every reader branch.
          return r.data.map(function (row) {
            return {
              key: row.key,
              label: row.label == null ? row.key : row.label,
              value: row.value,
              date: row.date,
              kind: row.kind == null ? 'measure' : row.kind,
              goalDirection: row.goal_direction == null ? 'neutral' : row.goal_direction,
              tile: row.tile,
              source: row.source,
              logged: row.logged
            }
          })
        })
        .catch(function (e) { warn('ledger read threw', e); return [] })
    })
  }

  // ── One-time migration: local vault data -> this account. ──────────────────
  function localTileIds() {
    var ids = []
    try {
      for (var i = 0; i < window.localStorage.length; i++) {
        var k = window.localStorage.key(i)
        if (k && k.indexOf('v:tile:') === 0) ids.push(k.slice('v:tile:'.length))
      }
    } catch (e) {}
    return ids
  }

  function hasLocalData() {
    if (localTileIds().length) return true
    try { return !!window.localStorage.getItem('v:ledger') } catch (e) { return false }
  }

  /**
   * Carry this device's data into the signed-in account.
   *
   * A slot the account ALREADY holds is never overwritten. Uploading this
   * laptop's projects over the ones the account already has would delete work
   * silently, and the house rule is the opposite: if something already exists,
   * say so and ask. So a collision is skipped and reported back, and the
   * caller tells the human which tiles were left alone.
   *
   * Resolves { uploaded:[ids], skipped:[ids], slotsOk:boolean,
   * ledgerFailed:number, ok:boolean }.
   *
   * slotsOk and ledgerFailed are reported apart on purpose. A tile slot that
   * fails is worth blocking on and retrying. A ledger row that fails usually
   * never will not: a legacy row with a broken date or a non-numeric value is
   * rejected by the same guards on every attempt, so letting one of those
   * decide the whole migration meant the offer came back forever with no way
   * to answer it. The caller blocks on slotsOk and merely mentions the rows.
   */
  function migrateLocalData() {
    var ids = localTileIds()

    var slotJobs = ids.map(function (id) {
      var data = null
      try { data = JSON.parse(window.localStorage.getItem('v:tile:' + id)) } catch (e) { data = null }
      if (data == null) return Promise.resolve({ id: id, state: 'empty', ok: true })

      return loadSlot(id).then(function (remote) {
        if (remote != null) return { id: id, state: 'skipped', ok: true }
        return saveSlot(id, data).then(function (ok) {
          return { id: id, state: ok ? 'uploaded' : 'failed', ok: ok }
        })
      })
    })

    var ledgerRows = []
    try { ledgerRows = JSON.parse(window.localStorage.getItem('v:ledger') || '[]') } catch (e) { ledgerRows = [] }
    // A ledger row is one key on one day, and re-reporting a day replaces it,
    // so these are safe to send: they land as the same day they already were.
    var ledgerJobs = Array.isArray(ledgerRows)
      ? ledgerRows.map(function (row) { return appendLedger(row.tile, row) })
      : []

    return Promise.all([Promise.all(slotJobs), Promise.all(ledgerJobs)]).then(function (both) {
      var slots = both[0]
      var ledgerFailed = both[1].filter(function (ok) { return ok === false }).length
      var slotsOk = slots.every(function (s) { return s.ok })
      return {
        uploaded: slots.filter(function (s) { return s.state === 'uploaded' }).map(function (s) { return s.id }),
        skipped: slots.filter(function (s) { return s.state === 'skipped' }).map(function (s) { return s.id }),
        slotsOk: slotsOk,
        ledgerFailed: ledgerFailed,
        ok: slotsOk && ledgerFailed === 0
      }
    })
  }

  /**
   * EVERYTHING THIS ACCOUNT HOLDS, in one object, for keeping on your own
   * machine. The emergency protocol: if the Supabase project is ever deleted,
   * suspended, or lost, this file is the whole board.
   *
   * Reads every vault_slot and every ledger row for the signed-in user. Both
   * queries are the same RLS-scoped reads loadSlot/readLedger already do -
   * auth.uid() = user_id is enforced in Postgres, so this cannot reach
   * anyone else's rows even if it tried.
   *
   * Resolves { ok, exportedAt, userId, email, slots, ledger, counts } or
   * { ok:false, reason } - never a partial object dressed as a complete one,
   * because a backup you cannot trust is worse than no backup. If either
   * query fails the whole export fails and says so.
   */
  function exportEverything() {
    var c = getClient()
    if (!c) return Promise.resolve({ ok: false, reason: 'Sign in is not available on this board.' })
    return getSession().then(function (session) {
      if (!session || !session.user) {
        return { ok: false, reason: 'Not signed in. Signed out, everything already lives on this device.' }
      }
      var uid = session.user.id
      return Promise.all([
        c.from('vault_slots').select('slot,data,updated_at').eq('user_id', uid),
        c.from('ledger').select('*').eq('user_id', uid).order('date', { ascending: true })
      ]).then(function (res) {
        var slotsRes = res[0], ledgerRes = res[1]
        if (slotsRes && slotsRes.error) { warn('export: slots read failed', slotsRes.error); return { ok: false, reason: 'Could not read your tiles.' } }
        if (ledgerRes && ledgerRes.error) { warn('export: ledger read failed', ledgerRes.error); return { ok: false, reason: 'Could not read your ledger.' } }
        var slots = (slotsRes && slotsRes.data) || []
        var ledger = (ledgerRes && ledgerRes.data) || []
        return {
          ok: true,
          exportedAt: new Date().toISOString(),
          userId: uid,
          email: session.user.email || null,
          slots: slots,
          ledger: ledger,
          counts: { slots: slots.length, ledger: ledger.length }
        }
      }).catch(function (e) { warn('export threw', e); return { ok: false, reason: 'Could not reach the vault.' } })
    })
  }

  /* ---------------- rest-timer push ----------------
     Three small writes, all RLS-scoped to the signed-in user the same way
     every other write in this file is. */

  /**
   * Store this device's push subscription. Upserted on endpoint, because the
   * endpoint IS the device: re-enabling on a phone that already subscribed
   * must update its row, not add a second one that would send every
   * notification twice.
   */
  function savePushSubscription(sub) {
    var c = getClient()
    if (!c) return Promise.resolve({ ok: false, reason: 'Sign in is not available on this board.' })
    if (!sub) return Promise.resolve({ ok: false, reason: 'No subscription to save.' })
    return getSession().then(function (session) {
      if (!session || !session.user) {
        return { ok: false, reason: 'Not signed in. A timer has to live in your vault to survive the phone locking.' }
      }
      var raw = typeof sub.toJSON === 'function' ? sub.toJSON() : sub
      var keys = raw.keys || {}
      if (!raw.endpoint || !keys.p256dh || !keys.auth) {
        return { ok: false, reason: 'That subscription came back incomplete, so nothing was saved.' }
      }
      return c.from('push_subscriptions').upsert({
        endpoint: raw.endpoint,
        user_id: session.user.id,
        p256dh: keys.p256dh,
        auth: keys.auth,
        user_agent: (navigator && navigator.userAgent) ? navigator.userAgent.slice(0, 300) : null
      }, { onConflict: 'endpoint' }).then(function (res) {
        if (res && res.error) { warn('save push subscription failed', res.error); return { ok: false, reason: 'Could not save it to your vault.' } }
        return { ok: true }
      })
    }).catch(function (e) { warn('save push subscription threw', e); return { ok: false, reason: 'Could not reach the vault.' } })
  }

  function removePushSubscription(endpoint) {
    var c = getClient()
    if (!c || !endpoint) return Promise.resolve({ ok: true })
    return c.from('push_subscriptions').delete().eq('endpoint', endpoint).then(function (res) {
      if (res && res.error) { warn('remove push subscription failed', res.error); return { ok: false, reason: 'Could not remove it.' } }
      return { ok: true }
    }).catch(function (e) { warn('remove push subscription threw', e); return { ok: false, reason: 'Could not reach the vault.' } })
  }

  /**
   * Schedule one rest-timer push, `seconds` from now.
   *
   * The time is computed here and stored absolute, so a slow write or a phone
   * that sleeps mid-request cannot shift when it fires.
   */
  function scheduleRestPush(seconds, label) {
    var c = getClient()
    if (!c) return Promise.resolve({ ok: false, reason: 'Sign in is not available on this board.' })
    var secs = Number(seconds)
    if (!isFinite(secs) || secs <= 0) return Promise.resolve({ ok: false, reason: 'That is not a length of time.' })
    return getSession().then(function (session) {
      if (!session || !session.user) return { ok: false, reason: 'Not signed in.' }
      return c.from('rest_timers').insert({
        user_id: session.user.id,
        fire_at: new Date(Date.now() + secs * 1000).toISOString(),
        label: label || null
      }).then(function (res) {
        if (res && res.error) { warn('schedule rest push failed', res.error); return { ok: false, reason: 'Could not schedule it.' } }
        return { ok: true }
      })
    }).catch(function (e) { warn('schedule rest push threw', e); return { ok: false, reason: 'Could not reach the vault.' } })
  }

  /**
   * Is there a rest timer still counting down for the signed-in user? Reads
   * the same rest_timers row scheduleRestPush() wrote.
   *
   * WHY THIS EXISTS. The on-screen countdown in the tile is plain in-memory
   * JS state - always was, before push existed at all - so closing the app
   * (or iOS evicting it in the background) has always thrown it away with no
   * trace it ever ran. That was invisible before, because there was nowhere
   * else the real end time lived. Now there is: scheduleRestPush() already
   * stores an ABSOLUTE fire_at, so reopening the app can read that back and
   * resume an honest countdown instead of just... not being there.
   *
   * Scoped to the account, not the device, on purpose: a timer started on the
   * phone that has alerts on is just as real when checked from a browser tab
   * that does not.
   *
   * Resolves { ok:true, timer:{ fireAt, label } | null } or { ok:false }.
   * null is a real, common answer - no error, just nothing counting down -
   * and is not conflated with ok:false, which means the read itself failed.
   */
  function getActiveRestTimer() {
    var c = getClient()
    if (!c) return Promise.resolve({ ok: false })
    return getSession().then(function (session) {
      if (!session || !session.user) return { ok: true, timer: null }
      return c.from('rest_timers')
        .select('fire_at,label')
        .eq('user_id', session.user.id)
        .eq('fired', false)
        .gt('fire_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .then(function (res) {
          if (res && res.error) { warn('read active rest timer failed', res.error); return { ok: false } }
          var row = res && res.data && res.data[0]
          return { ok: true, timer: row ? { fireAt: row.fire_at, label: row.label } : null }
        })
    }).catch(function (e) { warn('read active rest timer threw', e); return { ok: false } })
  }

  // Is the vault even reachable? False means the Supabase script never loaded
  // (blocked, offline, CDN down), which is NOT the same as being signed out -
  // and the difference has to be sayable, or a signed-in person silently gets
  // shown this device's local board as if it were their account.
  function isAvailable() { return !!getClient() }

  window.VitalityRemote = {
    isAvailable: isAvailable,
    getSession: getSession,
    onAuthChange: onAuthChange,
    signInWithEmail: signInWithEmail,
    verifyCode: verifyCode,
    signOut: signOut,
    setPassword: setPassword,
    loadSlot: loadSlot,
    saveSlot: saveSlot,
    appendLedger: appendLedger,
    readLedger: readLedger,
    hasLocalData: hasLocalData,
    migrateLocalData: migrateLocalData,
    exportEverything: exportEverything,
    savePushSubscription: savePushSubscription,
    removePushSubscription: removePushSubscription,
    scheduleRestPush: scheduleRestPush,
    getActiveRestTimer: getActiveRestTimer
  }
})()
