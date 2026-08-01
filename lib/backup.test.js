/**
 * The emergency backup export. Plain node: `node lib/backup.test.js`.
 *
 * The Supabase reads themselves need a live signed-in session, so this
 * covers the parts that can be checked honestly without one: the shape of
 * what gets written, the filename, and - most importantly - that a failed
 * read can never produce a file that LOOKS like a complete backup. A backup
 * you cannot trust is worse than no backup.
 */
const fs = require('fs')
const path = require('path')
const remoteSrc = fs.readFileSync(path.join(__dirname, 'vault-remote.js'), 'utf8')
const librarySrc = fs.readFileSync(path.join(__dirname, 'tiles', 'library.js'), 'utf8')

let fails = 0
const check = (label, cond, extra) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond || !extra ? '' : '  -> ' + extra}`)
  if (!cond) fails++
}

console.log('\n[1] exportEverything exists and is exported')
check('function defined', /function exportEverything\(\)/.test(remoteSrc))
check('on the public API', /exportEverything: exportEverything/.test(remoteSrc))

console.log('\n[2] it reads BOTH tables, scoped to the signed-in user')
check('reads vault_slots', /from\('vault_slots'\)[\s\S]{0,80}\.eq\('user_id', uid\)/.test(remoteSrc))
check('reads ledger', /from\('ledger'\)[\s\S]{0,80}\.eq\('user_id', uid\)/.test(remoteSrc))

console.log('\n[3] a partial read can never masquerade as a complete backup')
check('slots error -> ok:false', /slotsRes\.error[\s\S]{0,140}ok: false/.test(remoteSrc))
check('ledger error -> ok:false', /ledgerRes\.error[\s\S]{0,140}ok: false/.test(remoteSrc))
check('signed out -> ok:false, not an empty "successful" export',
  /Not signed in[\s\S]{0,40}/.test(remoteSrc) && /ok: false, reason: 'Not signed in/.test(remoteSrc))

console.log('\n[4] the UI only writes a file when ok is true')
check('guards on r.ok before downloading', /if \(!r \|\| !r\.ok\)[\s\S]{0,200}return\s*\}\s*\n\s*downloadBackup\(r\)/.test(librarySrc))

console.log('\n[5] filename is dated so backups never overwrite each other')
// Mirror the real helper rather than re-implementing it.
const fnMatch = librarySrc.match(/function backupFilename\(iso\) \{([\s\S]*?)\n  \}/)
check('backupFilename exists', !!fnMatch)
const backupFilename = new Function('iso', fnMatch[1] + '\n')
const name = backupFilename('2026-07-31T18:22:05.123Z')
check('reads citadel-backup-2026-07-31.json', name === 'citadel-backup-2026-07-31.json', name)
const other = backupFilename('2026-08-04T09:00:00.000Z')
check('a different day is a different file', other !== name, `${name} vs ${other}`)
check('a missing timestamp does not throw or produce "undefined"',
  !/undefined/.test(backupFilename(undefined)), backupFilename(undefined))

console.log('\n[6] the file is built in the browser, never uploaded anywhere')
check('uses a local Blob', /new Blob\(\[JSON\.stringify\(payload/.test(librarySrc))
check('no fetch/XHR in the backup path', !/downloadBackup[\s\S]{0,400}fetch\(/.test(librarySrc))

console.log(`\n${fails} failure(s)`)
process.exit(fails ? 1 : 0)
