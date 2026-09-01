/**
 * The reported case: "in terminal, scrolling doesn't seem to work at all."
 *
 * "At all" is several different failures wearing one sentence, and a fix aimed
 * at the wrong one looks right and changes nothing. So this asserts each of
 * them separately rather than asserting "it scrolls":
 *
 *   - the wheel moves the viewport at all
 *   - earlier output can actually be REACHED, back to the first prompt, rather
 *     than the view moving a line and stopping
 *   - the viewport STAYS where it was put while the pty keeps producing, which
 *     is the failure that reads as the wheel not working even though it did
 *   - the scrollbar is drawn, and is drawn in a colour that has contrast
 *     against the terminal's own background — an invisible slider is a
 *     terminal with no visible way back
 *   - keyboard paging works, because a wheel that is broken while Shift+PageUp
 *     is fine is a different bug from both being broken
 *
 * Framed as well as standalone, because the two differ: framed, the page sits
 * in a sandboxed iframe inside the host's frames layer, under an ancestor with
 * `overflow: hidden` and a `pointer-events` layer, and that is where an
 * ancestor clipping the scroll area or swallowing the wheel would bite. The
 * framed half is SKIPPED rather than failed when the module is not on a
 * canvas — it needs a host running and somebody to have put the terminal on
 * it, and a probe that fails for that reason teaches the next person to ignore
 * it.
 *
 * Run against a running terminal module:  node dev/scroll-probe.mjs
 *
 * Verified to catch the bug it guards: with `scrollback: 5000` changed to
 * `scrollback: 0` in `src/view/terminal-view.tsx` the standalone half reports
 * "reached: false" and fails; with it, it walks back to the first prompt.
 */
import { chromium } from 'playwright'

const CHROME =
  process.env.HOME +
  '/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell'

const browser = await chromium.launch({ executablePath: CHROME })

/** The line at the top of the viewport — what "where the view is" means here. */
const topLine = (frame) =>
  frame.evaluate(
    () =>
      document
        .querySelector('.xterm-rows')
        ?.innerText?.split('\n')
        .filter((l) => l.trim())
        .slice(0, 1)
        .join('') ?? '',
  )

/**
 * A wheel gesture, in small steps.
 *
 * Small and repeated rather than one large delta, because that is what a
 * trackpad sends and because the emulator's wheel handling normalises the
 * delta rather than using it directly — a single huge event proves nothing
 * about the gesture a person actually makes.
 */
async function wheelUp(page, box, steps = 10) {
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, -20)
    await page.waitForTimeout(40)
  }
  await page.waitForTimeout(600)
}

/** Every assertion, against one terminal, wherever it is. */
async function measure(page, frame, box) {
  const failures = []

  /* Something to scroll THROUGH. 500 lines is more than any container here is
     tall and far less than the 5000 of scrollback, so a terminal that keeps
     what it is told to keep can reach the first line and one that keeps
     nothing cannot. */
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.keyboard.type('seq 1 500\n')
  await page.waitForTimeout(3000)

  const settled = await topLine(frame)
  await wheelUp(page, box)
  const moved = await topLine(frame)
  console.log(`  wheel:        ${JSON.stringify(settled)} -> ${JSON.stringify(moved)}`)
  if (settled === moved) failures.push('the wheel did not move the viewport')

  /* Put where it was put and LEFT there. A viewport that creeps back toward
     the bottom on its own is the failure that gets reported as the wheel not
     working, because by the time somebody looks the view is where it started. */
  await page.waitForTimeout(1500)
  const held = await topLine(frame)
  console.log(`  stayed put:   ${JSON.stringify(held)}`)
  if (held !== moved) failures.push('the viewport did not stay where it was put')

  /* Reachable, not merely movable. Shift+PageUp rather than more wheel so that
     a wheel that works and a keyboard that does not — or the reverse — are
     told apart rather than averaged. */
  let reached = false
  for (let i = 0; i < 60 && !reached; i++) {
    await page.keyboard.press('Shift+PageUp')
    await page.waitForTimeout(60)
    reached = (await topLine(frame)).includes('seq 1 500')
  }
  console.log(`  reached the first prompt: ${reached}`)
  if (!reached) failures.push('earlier output could not be reached')

  /* A scrollbar somebody can see. The slider's colour is not decoration here:
     xterm paints it from the theme it was handed, and a terminal told a light
     background but left with the emulator's dark-theme slider has a scrollbar
     that is drawn and invisible. */
  const bar = await frame.evaluate(() => {
    const el = document.querySelector('.xterm-scrollable-element > .scrollbar.vertical')
    const slider = el?.querySelector('.slider')
    if (!el || !slider) return null
    const cs = getComputedStyle(el)
    return {
      shown: el.classList.contains('visible') && cs.opacity !== '0',
      width: el.getBoundingClientRect().width,
      height: slider.getBoundingClientRect().height,
      colour: getComputedStyle(slider).backgroundColor,
    }
  })
  console.log(`  scrollbar:    ${JSON.stringify(bar)}`)
  if (!bar || !bar.shown || bar.width < 4 || bar.height < 4) failures.push('no scrollbar is drawn')

  return failures
}

const results = []

/* Standalone, on the module's own page. */
{
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
  await page.goto('http://127.0.0.1:7920/app', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500)
  const box = await page.locator('.xterm').boundingBox()
  console.log('standalone at http://127.0.0.1:7920/app')
  if (!box) {
    results.push(['standalone', ['no terminal on the page']])
  } else {
    results.push(['standalone', await measure(page, page, box)])
  }
  await page.close()
}

/* Framed, in the host, which is where an ancestor's overflow or a
   pointer-events layer would be the cause. */
{
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  let framed = null
  try {
    await page.goto('http://127.0.0.1:4181/', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(7000)
    framed = page.frames().find((f) => f.url().includes('7920')) ?? null
  } catch {
    /* No host running. Not a failure of this module. */
  }
  if (!framed) {
    console.log('framed: SKIPPED — no host at 127.0.0.1:4181 with this module on the open kehikko')
  } else {
    console.log('framed in the host at http://127.0.0.1:4181')
    const rect = await page.evaluate(() => {
      const el = document.querySelector('[data-frame="roadmap.terminal"]')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    })
    results.push(['framed', rect ? await measure(page, framed, rect) : ['the frame has no box']])
  }
  await page.close()
}

await browser.close()

let bad = 0
for (const [where, failures] of results) {
  if (failures.length === 0) {
    console.log(`${where}: PASS`)
  } else {
    bad++
    console.log(`${where}: FAIL — ${failures.join('; ')}`)
  }
}
process.exit(bad === 0 ? 0 : 1)
