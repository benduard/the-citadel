/**
 * ROTATE THE VAPID KEYS. `node tools/new-vapid-keys.js`
 *
 * Generates a fresh Web Push key pair and puts each half in its one correct
 * home, in the same run:
 *
 *   private -> .env.local          (gitignored, never committed, never printed)
 *   public  -> lib/push.js         (belongs in the page, the browser hands it
 *                                   to the push service at subscribe time)
 *
 * BOTH IN ONE COMMAND ON PURPOSE. The pair only works as a pair. Updating one
 * half and forgetting the other produces subscriptions signed against a key
 * the function cannot prove it owns, and every push is rejected - with
 * nothing on the client saying so. Doing it in one step removes the window
 * where they can disagree.
 *
 * THE PRIVATE KEY IS NEVER PRINTED. It is written to .env.local and that is
 * the only copy. Open that file to copy it into Supabase. A key echoed to a
 * terminal ends up in scrollback, in a transcript, and in whatever is
 * recording the session - which is one more copy than needs to exist. This
 * tool exists at all because a previous version of the push test hardcoded
 * the real key into a committed file to check the key was not in committed
 * files. See vault/decisions.md, 2026-08-04.
 *
 * WHAT ROTATING COSTS. Every existing subscription was created against the
 * OLD public key and is dead the moment this runs. Each device has to turn
 * rest timer alerts off and on again, and the stale rows should be cleared
 * out of push_subscriptions - they can never receive anything again.
 */
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const ENV = path.join(ROOT, '.env.local')
const PUSH_JS = path.join(ROOT, 'lib', 'push.js')

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// A VAPID key pair is an EC P-256 pair (RFC 8292). The public half is the
// uncompressed point: 0x04 followed by X and Y, 65 bytes, which is the last
// 65 bytes of the SPKI DER encoding.
const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const pubRaw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-65)
const pub = b64url(pubRaw)
const priv = privateKey.export({ format: 'jwk' }).d

// Refuse to write anything if the generated pair is not shaped correctly,
// rather than leave the board holding a key that cannot work.
if (pubRaw[0] !== 4 || pub.length !== 87) {
  console.error('Generated public key is not a valid uncompressed P-256 point. Nothing was written.')
  process.exit(1)
}
if (!priv || priv.length !== 43) {
  console.error('Generated private key is not the expected length. Nothing was written.')
  process.exit(1)
}

// Keep whatever subject is already set - it is a contact address, not a
// secret, and re-typing it on every rotation is how it goes stale.
let subject = 'mailto:xboxmanager64@gmail.com'
if (fs.existsSync(ENV)) {
  const m = fs.readFileSync(ENV, 'utf8').match(/^VAPID_SUBJECT=(\S+)/m)
  if (m) subject = m[1]
}

fs.writeFileSync(ENV, `# VAPID keys for rest-timer push. Rotated ${new Date().toISOString().slice(0, 10)}.
#
# THIS FILE IS GITIGNORED AND MUST STAY THAT WAY. The private key is what
# proves a push came from this board; anyone holding it can send notifications
# to every device subscribed to it.
#
# The PUBLIC key is not a secret and is already in lib/push.js, because the
# browser has to hand it to the push service when it subscribes.
#
# The PRIVATE key goes into Supabase and nowhere else:
#   Supabase dashboard -> Edge Functions -> Secrets
#   name:  VAPID_PRIVATE_KEY
#   value: the key below
#
# Regenerate both halves with: node tools/new-vapid-keys.js

VAPID_PUBLIC_KEY=${pub}
VAPID_PRIVATE_KEY=${priv}
VAPID_SUBJECT=${subject}
`)

const src = fs.readFileSync(PUSH_JS, 'utf8')
const replaced = src.replace(
  /(var VAPID_PUBLIC = ')[^']+(')/,
  `$1${pub}$2`
)
if (replaced === src) {
  console.error('Could not find the VAPID_PUBLIC line in lib/push.js. .env.local was written but the page was NOT updated - they now disagree. Fix lib/push.js by hand before deploying.')
  process.exit(1)
}
fs.writeFileSync(PUSH_JS, replaced)

console.log('New VAPID pair generated.\n')
console.log('  public key   ', pub)
console.log('  private key   written to .env.local (not shown here on purpose)')
console.log('  subject      ', subject)
console.log('\nWritten to:')
console.log('  .env.local    both halves')
console.log('  lib/push.js   public half only')
console.log('\nStill to do, and none of it can happen from here:')
console.log('  1. Set VAPID_PRIVATE_KEY in Supabase -> Edge Functions -> Secrets')
console.log('     (open .env.local to copy it)')
console.log('  2. Clear the dead subscriptions:  delete from push_subscriptions;')
console.log('  3. Turn rest timer alerts off and on again on every device')
