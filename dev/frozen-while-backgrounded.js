/**
 * The reported case: "only by switching to another app it shows what has been
 * written."
 *
 * This is not a probe you run against a browser, and that is the point. It
 * cannot be reproduced in Chromium and it cannot be reproduced in Playwright's
 * headed WebKit either — both were tried first, and both painted every
 * keystroke exactly when it arrived. It reproduces only in the webview the
 * desktop shell actually uses, which is WKWebView hosted by Tauri, so this file
 * is a script for the instrument that can drive one:
 *
 *     cd ../kehikko-desktop/src-tauri
 *     cargo run --example webkit-probe -- \
 *       --script ../../kehikko-terminal/dev/frozen-while-backgrounded.js \
 *       http://127.0.0.1:7920/app
 *
 * Then click on ANY other application while it runs — Finder will do, and it
 * does not need to cover the window. Watch the lines it prints.
 *
 * ## What it establishes
 *
 * Two counters run side by side. One is driven by `requestAnimationFrame`, one
 * by `setInterval`. The timer keeps the measurement alive and proves the page
 * is still executing; the rAF count is the thing being measured, because
 * xterm's DOM renderer does ALL of its row drawing inside a rAF — see
 * `RenderDebouncer` in `@xterm/xterm`, which is the single funnel every write
 * ends up passing through, whatever renderer is loaded.
 *
 * Measured on 2026-09-01, macOS 15, Tauri 2 / WKWebView, one line per second:
 *
 *     {"s":5, "raf":60, "vis":"visible"}      <- window frontmost
 *     {"s":16,"raf":60, "vis":"visible"}
 *     {"s":17,"raf":28, "vis":"hidden"}       <- clicked on Finder here
 *     {"s":18,"raf":0,  "vis":"hidden"}
 *     {"s":24,"raf":0,  "vis":"hidden"}       <- and it stays at zero
 *
 * Not throttled. Stopped. And it is enough for the app to stop being frontmost
 * — the window is still fully on screen and the person can still see it.
 *
 * A second run framed a same-origin child in the same window and measured both:
 * the child's rAF stopped and resumed in lockstep with its parent's, to the
 * second, which is what page visibility means. So a module in an iframe is in
 * exactly the same position as the host page around it, and there is nothing a
 * module can arrange for itself here.
 *
 * ## What that means for this module
 *
 * The pty keeps producing, the socket keeps delivering, and `terminal.write()`
 * keeps parsing into xterm's buffer — none of that is rAF-driven. What does not
 * happen is the render: every `refreshRows` schedules an animation frame that
 * never arrives. Nothing reaches the DOM, so nothing is painted, and the moment
 * the window is frontmost again the one pending frame runs and the whole
 * backlog appears at once.
 *
 * That is the reported sentence, exactly, and there is no fix for it in this
 * repository. Do not reach for `@xterm/addon-webgl` or `@xterm/addon-canvas`:
 * the renderers sit BEHIND the same `RenderDebouncer`, so all three stop
 * together. Do not add a timer that repaints — a page whose rendering update is
 * suspended does not paint whatever you write into it; that is what suspended
 * means.
 *
 * The fix belongs to the shell, in `kehikko-desktop`: WKWebView is deciding
 * this window is not visible, and the shell is what holds the WKWebView.
 */
;(() => {
  const send = (o) => {
    try {
      const x = new XMLHttpRequest()
      x.open('POST', 'http://127.0.0.1:4999/', true)
      x.send(JSON.stringify(o))
    } catch {
      /* The probe's listener is not up. Nothing to do and nothing to say. */
    }
  }

  let raf = 0
  const spin = () => {
    raf++
    requestAnimationFrame(spin)
  }
  requestAnimationFrame(spin)

  let s = 0
  setInterval(() => {
    send({
      s: ++s,
      raf,
      vis: document.visibilityState,
      /* Read straight off the emulator's own rows, so the line says whether
         what the shell wrote actually reached the document — not merely that
         the page is alive. */
      rows: (document.querySelector('.xterm-rows')?.innerText ?? '(no xterm on this page)')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(-50),
    })
    raf = 0
  }, 1000)
})()
