/*
 * Two projects, two shells, driven with a real keyboard, and read back off the
 * screen.
 *
 *     node dev/sessions-drive.mjs
 *
 * ## Why this is a driver and not a test
 *
 * `test/sessions.test.ts` proves the decision and `test/shells.test.tsx`
 * proves what the component does with it, and neither of them has a pty in
 * the room. This workspace once passed six hundred green tests over a
 * completely dead page, so the claim "what is typed in one shell does not
 * appear in the other" is checked here the only way it can be: by typing into
 * two shells behind a real socket and reading the rows xterm drew.
 *
 * It needs three things running, none of which it starts, so that nothing here
 * can be mistaken for a start script and pointed at the live module:
 *
 *     mkdir -p /tmp/terminal-probe/modules /tmp/proj-a /tmp/proj-b
 *     PORT=7925 ROADMAP_MODULES_DIR=/tmp/terminal-probe/modules \
 *       ROADMAP_ORIGIN=http://127.0.0.1:7926 bun run dev          # the module, on a spare port
 *     (cd dev && python3 -m http.server 7926 --bind 127.0.0.1)   # this page's origin
 *
 * `ROADMAP_MODULES_DIR` is not optional. Without it `serves()` rewrites the
 * real registration to point at the copy under test, and the live terminal —
 * with everybody's shells in it — comes off the canvas.
 *
 * Stop both by the pids you started them with. Never by pattern.
 */
/* playwright-core is not a dependency of this module and must not become one. */
const { chromium } = await import(
  process.env.PLAYWRIGHT ?? '/tmp/height-drive/node_modules/playwright-core/index.mjs'
)

const HOST = process.env.HOST_PAGE ?? 'http://127.0.0.1:7926/two-projects.html'
const MODULE = 'http://127.0.0.1:7925'
const A = process.env.PROJECT_A ?? '/tmp/proj-a'
const B = process.env.PROJECT_B ?? '/tmp/proj-b'

const browser = await chromium.launch({ executablePath: process.env.CHROME })
const page = await browser.newPage({ viewport: { width: 1000, height: 600 } })
const problems = []
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console: ${message.text()}`)
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (what, ok, detail = '') => {
  results.push([what, ok])
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? `  (${detail})` : ''}`)
}

/* The host page greets on the frame's `load`, with this project; see the
   comment there on why a greeting cannot wait for this script. */
await page.goto(`${HOST}?project=${encodeURIComponent(A)}&epic=first`, { waitUntil: 'load' })
await sleep(1500)
const frame = page.frames().find((f) => f.url().startsWith(MODULE))
if (!frame) throw new Error('the module frame did not load')
const heard = await page.evaluate(() => window.heard.map((m) => m.type))
check('the module answered the greeting', heard.includes('roadmap.ready'), heard.join(', '))

/** The rows xterm drew for one session, as text. */
const rows = async (at) =>
  frame.evaluate((where) => {
    const el = document.querySelector(`[data-session^="${where}#"] .xterm-rows`)
    return el ? el.textContent : null
  }, at)
const sessions = () =>
  frame.evaluate(() =>
    [...document.querySelectorAll('[data-session]')].map((el) => ({
      id: el.getAttribute('data-session'),
      hidden: el.hidden,
    })),
  )
const typeInto = async (text) => {
  await frame.locator('[data-session]:not([hidden]) .xterm-helper-textarea').focus()
  await page.keyboard.type(text, { delay: 15 })
  await page.keyboard.press('Enter')
}

/* 1. Greeted with project A: one shell, in A. */
await sleep(1500)
let held = await sessions()
check('greeted with A: one session, shown', held.length === 1 && held[0].id === `${A}#1` && !held[0].hidden, JSON.stringify(held))

await typeInto('echo AAA-$PWD')
await sleep(900)
let a = await rows(A)
check('a shell in A echoes what was typed there', a !== null && a.includes(`AAA-${A}`), (a ?? '').replace(/\s+/g, ' ').slice(0, 120))
check('and its working directory is A', a !== null && a.includes(`AAA-${A}`) && !a.includes('AAA-/Users'))

/* 2. Start something slow in A, then switch to B while it runs. */
await typeInto('sleep 4; echo DONE-IN-A')
await sleep(300)
await page.evaluate((b) => window.say({ project: 'b', projectPath: b, epic: 'first' }), B)
await sleep(2500)
held = await sessions()
check(
  'switched to B: two sessions, A hidden and still mounted, B shown',
  held.length === 2 && held.find((s) => s.id === `${A}#1`)?.hidden === true && held.find((s) => s.id === `${B}#1`)?.hidden === false,
  JSON.stringify(held),
)

await typeInto('echo BBB-$PWD')
await sleep(900)
let b = await rows(B)
check('a shell in B echoes what was typed there, in B', b !== null && b.includes(`BBB-${B}`))
check('what was typed in B did not appear in A', !((await rows(A)) ?? '').includes('BBB'))
check('what was typed in A did not appear in B', !(b ?? '').includes('AAA'))

/* 3. Epic changes inside B: nothing moves. */
await page.evaluate((b) => window.say({ project: 'b', projectPath: b, epic: 'second' }), B)
await sleep(800)
held = await sessions()
check('an epic switch inside B opened nothing and hid nothing', held.length === 2 && held.find((s) => s.id === `${B}#1`)?.hidden === false, JSON.stringify(held))

/* 4. Back to A, after the sleep has had time to finish: the command ran to completion while hidden. */
await sleep(2500)
await page.evaluate((a) => window.say({ project: 'a', projectPath: a, epic: 'second' }), A)
await sleep(1200)
held = await sessions()
check('back to A: the same session, shown again', held.find((s) => s.id === `${A}#1`)?.hidden === false, JSON.stringify(held))
a = await rows(A)
check('the command started in A finished while A was hidden', a.includes('DONE-IN-A'))
check('A still has its own history and not B’s', a.includes(`AAA-${A}`) && !a.includes('BBB'))

/* 5. Typing still reaches A after the round trip, at the size it now has. */
await typeInto('echo BACK-$COLUMNS')
await sleep(900)
a = await rows(A)
check('typing reaches A again after coming back', /BACK-\d+/.test(a), a.match(/BACK-\d+/)?.[0] ?? 'no echo')

/* 6. What the module's own trace says. */
const trace = await fetch(`${MODULE}/api/trace`).then((r) => r.text())
const json = await fetch(`${MODULE}/api/trace?json`).then((r) => r.json())
check('the trace says two sessions are held on purpose', trace.includes('holding 2 sessions on purpose'))
check('and does not call them a leak', !trace.includes('A remount left the old one behind'))
check('two shells are live on the server', json.shells.live === 2, `live ${json.shells.live}`)
const where = json.live.map((s) => s.cwd)
check('one was spawned in A and one in B', where.includes(A) && where.includes(B), where.join(', '))
check('the page said why each switch happened', trace.includes('the canvas is about'), '')

console.log('')
console.log('problems:', problems.length ? problems : 'none')
const failed = results.filter(([, ok]) => !ok).length
console.log(failed === 0 ? 'PASS: two projects, two shells, neither disturbed by the other' : `FAIL: ${failed} check(s)`)
await browser.close()
process.exit(failed === 0 ? 0 : 1)
