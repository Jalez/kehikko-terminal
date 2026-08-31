/**
 * The reported case: a terminal that is folded and then unfolded.
 *
 * Folding hides the frame, which fires a resize observation at zero. Fitting to
 * that shrank the emulator to about two columns while nobody could see it, and
 * the shell drew its next prompt into a world neither side agreed on — so the
 * staircase appeared on UNFOLD having been caused on fold.
 *
 * Simulated directly on the module's own page, because the damage is done by
 * the element losing its size, however that happens.
 */
import { chromium } from 'playwright'

const browser = await chromium.launch({
  executablePath:
    process.env.HOME +
    '/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell',
})
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
await page.goto('http://127.0.0.1:7920/app', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3500)

const rows = () => page.evaluate(() => document.querySelector('.xterm-rows')?.innerText ?? '')
const cols = () => page.evaluate(() => document.querySelectorAll('.xterm-rows > div').length)

console.log('before folding   prompt:', /[%$#>]/.test(await rows()))

/* Fold: the frame is hidden and the element loses its box. */
await page.evaluate(() => {
  const s = document.createElement('style')
  s.id = 'folded'
  s.textContent = 'body > div, .xterm { width: 0 !important; height: 0 !important; overflow: hidden }'
  document.head.appendChild(s)
})
await page.waitForTimeout(1200)

/* Unfold. */
await page.evaluate(() => document.getElementById('folded')?.remove())
await page.waitForTimeout(1500)

/* Make the shell draw a fresh prompt, which is where the damage showed. */
await page.keyboard.press('Enter')
await page.waitForTimeout(1500)

const text = await rows()
const shortLines = text.split('\n').filter((l) => l.trim().length > 0 && l.trim().length <= 3).length
const ok = /[%$#>]/.test(text) && shortLines === 0
console.log(`after unfolding  short-wrapped lines: ${shortLines}   ${ok ? 'PASS' : 'FAIL'}`)
console.log('  tail:', JSON.stringify(text.replace(/\s+/g, ' ').trim().slice(-72)))

await browser.close()
process.exit(ok ? 0 : 1)

/*
 * Run against a running terminal module:  node dev/fold-unfold-probe.mjs
 *
 * Verified to catch the bug it guards: with the `!usable()` return removed from
 * the resize path in terminal-view.tsx this reports 19 short-wrapped lines and
 * fails; with it, 0.
 */
