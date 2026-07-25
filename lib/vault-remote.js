/**
 * THE REMOTE VAULT - the Supabase half of host.js's storage seam.
 *
 * host.js's Store object is the seam ("one seam to swap; Supabase later
 * touches no tile"). This file is what it swaps to, once someone is signed
 * in. Same two tables sync.sql already created:
 *   vault_slots (user_id, slot, data)  - one row per tile, primary key
 *                                        (user_id, slot). Matches host.js's
 *                                        Store.saveData/loadData exactly.
 *   ledger (user_id, key, date, ...)   - no unique constraint in the schema,
 *                                        so a same-day re-report is done here
 *                                        as select-then-update-or-insert,
 *                                        mirroring Store.appendLedger's
 *                                        "replace this key+date" rule.
 *
 * Signed out, or the CDN script hasn't loaded: every function here resolves
 * to the same "nothing happened yet" values host.js already treats as
 * first-run / no-op, so host.js's fallback to localStorage never needs a
 * special case for "remote isn't ready".
 */
;(function () {
  'use strict'

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
    }).catch(function () { return null })
  }

  function getUserId() {
    return getSession().then(function (s) { return (s && s.user && s.user.id) || null })
  }

  function onAuthChange(cb) {
    var c = getClient()
    if (!c) return
    c.auth.onAuthStateChange(function (event, session) { cb(session) })
  }

  function signInWithEmail(email) {
    var c = getClient()
    if (!c) return Promise.reject(new Error('Supabase not loaded'))
    return c.auth.signInWithOtp({
      email: email,
      options: { emailRedirectTo: window.location.origin }
    })
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
        .then(function (r) { return (r && r.data && r.data.data != null) ? r.data.data : null })
        .catch(function () { return null })
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
      }, { onConflict: 'user_id,slot' }).then(function (r) { return !r.error })
        .catch(function () { return false })
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
      var row = {
        user_id: uid,
        key: key,
        label: typeof stream.label === 'string' ? stream.label : key,
        value: value,
        date: date,
        kind: typeof stream.kind === 'string' ? stream.kind : 'measure',
        source: 'manual',
        logged: new Date().toISOString()
      }
      return c.from('ledger').select('id').eq('user_id', uid).eq('key', key).eq('date', date).maybeSingle()
        .then(function (r) {
          if (r && r.data && r.data.id) {
            return c.from('ledger').update(row).eq('id', r.data.id).then(function (u) { return !u.error })
          }
          return c.from('ledger').insert(row).then(function (u) { return !u.error })
        })
        .catch(function () { return false })
    })
  }

  function readLedger() {
    var c = getClient()
    if (!c) return Promise.resolve([])
    return getUserId().then(function (uid) {
      if (!uid) return []
      return c.from('ledger').select('*').eq('user_id', uid).order('date', { ascending: false })
        .then(function (r) { return (r && Array.isArray(r.data)) ? r.data : [] })
        .catch(function () { return [] })
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

  function migrateLocalData() {
    var jobs = localTileIds().map(function (id) {
      var data = null
      try { data = JSON.parse(window.localStorage.getItem('v:tile:' + id)) } catch (e) { data = null }
      return data == null ? Promise.resolve(true) : saveSlot(id, data)
    })

    var ledgerRows = []
    try { ledgerRows = JSON.parse(window.localStorage.getItem('v:ledger') || '[]') } catch (e) { ledgerRows = [] }
    if (Array.isArray(ledgerRows)) {
      ledgerRows.forEach(function (row) { jobs.push(appendLedger(row.tile, row)) })
    }

    return Promise.all(jobs)
  }

  window.VitalityRemote = {
    getSession: getSession,
    onAuthChange: onAuthChange,
    signInWithEmail: signInWithEmail,
    signOut: signOut,
    loadSlot: loadSlot,
    saveSlot: saveSlot,
    appendLedger: appendLedger,
    readLedger: readLedger,
    hasLocalData: hasLocalData,
    migrateLocalData: migrateLocalData
  }
})()
