/*
 * How many sizes the pty is told while the container moves.
 *
 *     node dev/resize-burst.mjs
 *
 * Every size is a SIGWINCH, and Claude Code reprints its conversation on each
 * one, leaving the earlier copy in the scrollback: "it sometimes adds
 * previously written text as duplicate". This frames the module the way
 * `dev/two-projects.html` does, runs a stand-in that prints one line per
 * SIGWINCH it receives (no shell rc, no agent), and then moves the box the way
 * the host's grid does — a drag across 300ms, and a fold and unfold animated
 * over 200ms — and counts the lines.
 *
 * Measured on main before `src/view/settle-size.ts`: 9 for the drag, 9 for the
 * fold. With it: 1 for the drag (the size it ended at) and 0 for the fold (it
 * came back to the size it had).
 *
 * It needs the module and the host page running, neither of which it starts —
 * see the top of `dev/sessions-drive.mjs` for the two commands, with a scratch
 * `KEHIKOT_MODULES_DIR`. MODULE and HOST_PAGE say where they are. Stop both by
 * their pids. Never by pattern.
 */
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/* playwright-core is not a dependency of this module and must not become one. */
const { chromium } = await import(process.env.PLAYWRIGHT ?? '/tmp/height-drive/node_modules/playwright-core/index.mjs')

const HOST = process.env.HOST_PAGE ?? 'http://127.0.0.1:7926/two-projects.html'
const MODULE = process.env.MODULE ?? '127.0.0.1:7925'
const PROJECT = process.env.PROJECT_A ?? '/tmp/proj-a'

/* The stand-in: one line per SIGWINCH, with the size it was told. */
const scratch = mkdtempSync(join(tmpdir(), 'resize-burst-'))
const standIn = join(scratch, 'winch.sh')
writeFileSync(standIn, "#!/bin/sh\ntrap 'echo W$(stty size)' WINCH\nwhile :; do sleep 0.05; done\n")
chmodSync(standIn, 0o755)

const browser = await chromium.launch({ executablePath: process.env.CHROME })
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
await page.goto(`${HOST}?project=${PROJECT}`)
await page.waitForTimeout(2500)
const frame = page.frames().find((one) => one.url().includes(MODULE))
const rows = async () => (await frame.$$eval('.xterm-rows > div', (all) => all.map((one) => one.textContent ?? ''))).join(' ')
const told = async () => (await rows()).match(/W\d+ \d+/g)?.length ?? 0

await frame.click('.xterm')
await page.keyboard.type(`clear; ${standIn}\n`)
await page.waitForTimeout(800)

let before = await told()
for (let step = 0; step <= 20; step += 1) {
  await page.evaluate((width) => {
    document.querySelector('.frame').style.width = `${width}px`
  }, 900 - step * 15)
  await page.waitForTimeout(15)
}
await page.waitForTimeout(600)
console.log(`a drag from 900 to 600 pixels: the pty was told ${(await told()) - before} sizes`)

before = await told()
await page.evaluate(() => {
  const box = document.querySelector('.frame')
  box.style.transition = 'height 200ms'
  box.style.height = '0px'
})
await page.waitForTimeout(500)
await page.evaluate(() => {
  document.querySelector('.frame').style.height = '500px'
})
await page.waitForTimeout(800)
console.log(`a fold and unfold, animated: the pty was told ${(await told()) - before} sizes`)

await browser.close()
