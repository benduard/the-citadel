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
    client = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY)
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

  function onAuthChange(cb) {
    var c = getClient()
    if (!c) return
    c.auth.onAuthStateChange(function (event, session) { cb(session, event) })
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
    return c.auth.signOut()
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
   * Resolves { uploaded:[ids], skipped:[ids], ok:boolean }.
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
      var ledgerOk = both[1].every(function (ok) { return ok !== false })
      return {
        uploaded: slots.filter(function (s) { return s.state === 'uploaded' }).map(function (s) { return s.id }),
        skipped: slots.filter(function (s) { return s.state === 'skipped' }).map(function (s) { return s.id }),
        ok: ledgerOk && slots.every(function (s) { return s.ok })
      }
    })
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
    loadSlot: loadSlot,
    saveSlot: saveSlot,
    appendLedger: appendLedger,
    readLedger: readLedger,
    hasLocalData: hasLocalData,
    migrateLocalData: migrateLocalData
  }
})()
