/**
 * REST-TIMER PUSH, the browser half.
 *
 * A rest timer that only lives in the page dies the moment the phone locks:
 * JavaScript stops, setTimeout never fires. Surviving that needs a service
 * worker to be woken by a push from outside the phone - which is what this
 * arranges, and what supabase/functions/send-timer-push sends.
 *
 * THE PUBLIC KEY IS NOT A SECRET. It is handed to the push service by the
 * browser at subscribe time, so it has to be in the page, exactly like
 * SUPABASE_ANON_KEY. The PRIVATE key lives only in Supabase's secrets and
 * never touches this repo (see .env.local, which is gitignored).
 *
 * WHAT IT DOES NOT DO: it never asks for permission on load. A permission
 * prompt nobody invited is how a site gets permanently blocked, and iOS in
 * particular only gives one chance. Everything here runs from an explicit tap.
 */
;(function () {
  'use strict'

  var VAPID_PUBLIC = 'BPewYpzXlUPqGsUqmqrMH87twEsxzPYPnt2Vlt79TKrdYEEucFCrzGtpktDstkFDmDEG4PcEyyqFVBsDmm1Xnq0'

  function warn() {
    try { console.warn.apply(console, ['[push]'].concat([].slice.call(arguments))) } catch (e) {}
  }

  // base64url -> Uint8Array. applicationServerKey will not take the string.
  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - base64String.length % 4) % 4)
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
    var raw = window.atob(base64)
    var out = new Uint8Array(raw.length)
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
    return out
  }

  function b64(buf) {
    return window.btoa(String.fromCharCode.apply(null, new Uint8Array(buf)))
  }

  /**
   * Can this browser do it at all, and if not, say WHICH reason - the fixes
   * are completely different and a single "not supported" would send someone
   * hunting the wrong thing.
   *
   * The iOS case is the one worth naming: Safari only allows push for a site
   * added to the home screen, so in a normal Safari tab this is unavailable no
   * matter how new the phone is.
   */
  function support() {
    if (!('serviceWorker' in navigator)) return { ok: false, why: 'This browser has no service worker support, so nothing can run while the app is closed.' }
    if (!('PushManager' in window)) return { ok: false, why: 'This browser cannot receive push notifications.' }
    if (!('Notification' in window)) return { ok: false, why: 'This browser cannot show notifications.' }
    var iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
              (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    var standalone = window.matchMedia('(display-mode: standalone)').matches ||
                     window.navigator.standalone === true
    if (iOS && !standalone) {
      return { ok: false, why: 'On iPhone this only works from the home screen icon. Share, then Add to Home Screen, and turn it on from there.' }
    }
    return { ok: true }
  }

  function register() {
    return navigator.serviceWorker.register('/sw.js', { scope: '/' })
  }

  /**
   * Turn it on. Resolves { ok } or { ok:false, reason }.
   *
   * Order matters: permission FIRST, then subscribe. Subscribing before the
   * permission is granted throws in some browsers and, worse, can burn the
   * one prompt iOS gives.
   */
  function enable() {
    var s = support()
    if (!s.ok) return Promise.resolve({ ok: false, reason: s.why })
    if (!window.VitalityRemote || !window.VitalityRemote.isAvailable()) {
      return Promise.resolve({ ok: false, reason: 'The vault is not reachable, and a timer has to be stored to survive the phone locking.' })
    }

    return Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') {
        return { ok: false, reason: perm === 'denied'
          ? 'Notifications are blocked for this site. Turn them back on in your browser settings for this board, then try again.'
          : 'Notifications were not allowed, so nothing was turned on.' }
      }
      return register().then(function (reg) {
        return reg.pushManager.getSubscription().then(function (existing) {
          if (existing) return existing
          return reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC)
          })
        })
      }).then(function (sub) {
        return window.VitalityRemote.savePushSubscription(sub)
      })
    }).catch(function (e) {
      warn('enable failed', e)
      return { ok: false, reason: 'Could not turn on notifications. Nothing was changed.' }
    })
  }

  /** Turn it off on THIS device. Other devices keep working. */
  function disable() {
    if (!('serviceWorker' in navigator)) return Promise.resolve({ ok: true })
    return navigator.serviceWorker.getRegistration('/').then(function (reg) {
      if (!reg) return { ok: true }
      return reg.pushManager.getSubscription().then(function (sub) {
        if (!sub) return { ok: true }
        var endpoint = sub.endpoint
        return sub.unsubscribe().then(function () {
          if (window.VitalityRemote && window.VitalityRemote.removePushSubscription) {
            return window.VitalityRemote.removePushSubscription(endpoint)
          }
          return { ok: true }
        })
      })
    }).catch(function (e) {
      warn('disable failed', e)
      return { ok: false, reason: 'Could not turn it off cleanly.' }
    })
  }

  /** Is this device subscribed right now? Reads the browser, not a saved flag,
   *  so revoking permission in Settings is reflected honestly. */
  function isEnabled() {
    if (!('serviceWorker' in navigator) || !('Notification' in window)) return Promise.resolve(false)
    if (Notification.permission !== 'granted') return Promise.resolve(false)
    return navigator.serviceWorker.getRegistration('/').then(function (reg) {
      if (!reg) return false
      return reg.pushManager.getSubscription().then(function (s) { return !!s })
    }).catch(function () { return false })
  }

  window.VitalityPush = {
    support: support,
    enable: enable,
    disable: disable,
    isEnabled: isEnabled,
    // Exposed for the test, and harmless: it is already in the page.
    publicKey: VAPID_PUBLIC,
    _urlBase64ToUint8Array: urlBase64ToUint8Array,
    _b64: b64
  }
})()
