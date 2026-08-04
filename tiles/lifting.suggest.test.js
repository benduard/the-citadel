/**
 * "Suggest the most likely exercise," checked against tiles/lifting.html.
 * Plain node: `node tiles/lifting.suggest.test.js`.
 *
 * The rule worth guarding: an explicitly started routine always beats a
 * guess from history. If that ever inverts, the app starts arguing with a
 * plan the user already stated.
 */
const fs = require('fs')
const vm = require('vm')
const path = require('path')
const src = fs.readFileSync(path.join(__dirname, 'lifting.html'), 'utf8')

function grab(name) {
  const re = new RegExp(`\\n  function ${name}\\(`)
  const at = src.search(re)
  if (at === -1) throw new Error('could not find ' + name)
  let i = src.indexOf('{', at), depth = 0, end = i
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (!depth) { end = i + 1; break } }
  }
  return src.slice(at + 1, end)
}
function grabVar(name, open) {
  const at = src.search(new RegExp(`\\n  var ${name} =`))
  // Without this, a renamed variable makes indexOf start from -1 and quietly
  // return the first bracket in the FILE - which is inside a doc comment, and
  // fails later with a syntax error that names neither the variable nor this
  // function. Cost an eyebrow raise once; never again.
  if (at === -1) throw new Error('could not find var ' + name)
  const close = open === '[' ? ']' : '}'
  let i = src.indexOf(open, at), depth = 0, end = i
  for (; i < src.length; i++) {
    if (src[i] === open) depth++
    else if (src[i] === close) { depth--; if (!depth) { end = i + 1; break } }
  }
  return src.slice(src.indexOf(open, at), end)
}

const TODAY = '2026-07-31'
const sandbox = { console }
vm.createContext(sandbox)
vm.runInContext(`
  // The default scheme's days. suggestNext() reaches them through splitById,
  // which in the real file searches every scheme; here one scheme is enough to
  // exercise the rule under test.
  var SCHEMES = ${grabVar('SCHEMES', '[')};
  var SPLITS = SCHEMES[0].splits;
  var S = { days:{}, routines:[], routineToday:{}, splits:{}, custom:[], customSplits:[], scheme:'yours' };
  function today(){ return '${TODAY}'; }
  function splitById(id){ for (var i=0;i<SPLITS.length;i++) if (SPLITS[i].id===id) return SPLITS[i]; return null; }
  function splitFor(k){ return S.splits[k || today()] || ''; }
  function fromKey(k){ var p=k.split('-'); return new Date(+p[0], +p[1]-1, +p[2]); }
  function dayKey(d){
    var y=d.getFullYear(), m=String(d.getMonth()+1), da=String(d.getDate());
    if(m.length<2)m='0'+m; if(da.length<2)da='0'+da; return y+'-'+m+'-'+da;
  }
  function shift(k,n){ var d=fromKey(k); d.setDate(d.getDate()+n); return dayKey(d); }
  var LIB = [
    { name:'Back Squat', pri:'quads', w:3 },
    { name:'Leg Press', pri:'quads', w:1 },
    { name:'Romanian Deadlift', pri:'hams', w:2 },
    { name:'Standing Calf Raise', pri:'calves', w:1 },
    { name:'Barbell Bench Press', pri:'chest', w:3 }
  ];
  function allEx(){ return LIB; }
  function findEx(n){ for (var i=0;i<LIB.length;i++) if (LIB[i].name===n) return LIB[i]; return null; }
  ${grab('pickable')}
  ${grab('sessionsInLast14')}
  ${grab('suggestNext')}
`, sandbox)

let fails = 0
const check = (label, cond, extra) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond || !extra ? '' : '  -> ' + extra}`)
  if (!cond) fails++
}
const reset = () => vm.runInContext(`S.days={}; S.routines=[]; S.routineToday={}; S.splits={};`, sandbox)
const set = (ex) => ({ id: ex, ex, kg: 100, reps: 5 })

console.log('\n[1] no split, no routine -> no suggestion (not a bad guess)')
reset()
check('returns null rather than inventing one', sandbox.suggestNext() === null)

console.log('\n[2] a started routine wins, and offers its next UNLOGGED item')
reset()
vm.runInContext(`
  S.routines = [{ id:'r1', name:'Leg Day', items:[
    {ex:'Back Squat'}, {ex:'Romanian Deadlift'}, {ex:'Standing Calf Raise'}] }];
  S.routineToday['${TODAY}'] = 'r1';
  S.splits['${TODAY}'] = 'legs';
`, sandbox)
let s = sandbox.suggestNext()
check('first item when nothing logged', s && s.name === 'Back Squat', JSON.stringify(s))
check('says it came from the routine', s.why.indexOf('Leg Day') !== -1, s.why)

vm.runInContext(`S.days['${TODAY}'] = [${JSON.stringify(set('Back Squat'))}];`, sandbox)
s = sandbox.suggestNext()
check('skips what is already logged, offers item 2', s && s.name === 'Romanian Deadlift', JSON.stringify(s))

console.log('\n[3] routine fully logged -> falls through to the split')
reset()
vm.runInContext(`
  S.routines = [{ id:'r1', name:'Leg Day', items:[{ex:'Back Squat'}] }];
  S.routineToday['${TODAY}'] = 'r1';
  S.splits['${TODAY}'] = 'legs';
  S.days['${TODAY}'] = [${JSON.stringify(set('Back Squat'))}];
`, sandbox)
s = sandbox.suggestNext()
check('still suggests something, from the split', s !== null, JSON.stringify(s))
check('and not the already-logged squat', s.name !== 'Back Squat', s.name)

console.log('\n[4] no routine -> least-trained exercise in the split')
reset()
vm.runInContext(`
  S.splits['${TODAY}'] = 'legs';
  // Squatted on 3 recent days; calf raise never.
  S.days['${TODAY}'] = [];
  S.days[shift('${TODAY}', -1)] = [${JSON.stringify(set('Back Squat'))}];
  S.days[shift('${TODAY}', -3)] = [${JSON.stringify(set('Back Squat'))}];
  S.days[shift('${TODAY}', -5)] = [${JSON.stringify(set('Back Squat'))}];
`, sandbox)
s = sandbox.suggestNext()
check('suggests something never trained over the squat', s && s.name !== 'Back Squat', JSON.stringify(s))
check('it is in the legs split', ['Leg Press','Romanian Deadlift','Standing Calf Raise'].indexOf(s.name) !== -1, s.name)

console.log('\n[5] ties break toward the bigger lift')
reset()
vm.runInContext(`S.splits['${TODAY}'] = 'legs';`, sandbox) // nothing trained at all -> all tied at 0
s = sandbox.suggestNext()
check('all untrained -> highest w wins (Back Squat, w:3)', s && s.name === 'Back Squat', JSON.stringify(s))

console.log('\n[6] never suggests something already logged today')
reset()
vm.runInContext(`
  S.splits['${TODAY}'] = 'legs';
  S.days['${TODAY}'] = [
    ${JSON.stringify(set('Back Squat'))}, ${JSON.stringify(set('Leg Press'))},
    ${JSON.stringify(set('Romanian Deadlift'))}, ${JSON.stringify(set('Standing Calf Raise'))}];
`, sandbox)
check('whole split done -> null, nothing left to suggest', sandbox.suggestNext() === null)

console.log('\n[7] the split filter is real - no cross-day suggestions')
reset()
vm.runInContext(`S.splits['${TODAY}'] = 'push';`, sandbox)
s = sandbox.suggestNext()
check('on a push day it never offers a leg exercise', s && s.name === 'Barbell Bench Press', JSON.stringify(s))

console.log(`\n${fails} failure(s)`)
process.exit(fails ? 1 : 0)
