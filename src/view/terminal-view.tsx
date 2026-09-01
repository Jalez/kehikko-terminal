import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

import { ticket } from './ticket.ts'
import { note, seen } from './trace.ts'

/**
 * The terminal itself: xterm in the page, a pty on the other end of a socket.
 *
 * These are the same two pieces a code editor's integrated terminal is built
 * from. Nothing about being in a browser makes the emulation weaker — full
 * screen programs, colours, ctrl-C, arrow keys and `vim` all work, because
 * `xterm` is a real emulator and the thing behind the socket is a real pty.
 *
 * ## The socket is opened here and nowhere else
 *
 * One component owns the connection, and it owns it on the same lifetime as the
 * `Terminal` it draws into. That is not tidiness: a socket outliving its
 * terminal is a pty writing into a disposed emulator, and a terminal outliving
 * its socket is a container that accepts typing and silently drops it. Both are
 * states somebody would call a hang.
 *
 * ## Why `key` matters upstream
 *
 * There is no code here for "start another shell". Asking for one REMOUNTS this
 * component, because the parent changes its `key` — so a new socket, a new pty
 * and a fresh emulator, and the old ones are closed by this effect's cleanup.
 * Restarting a live terminal in place would mean deciding what to do with a
 * half-typed command, and there is no good answer to that question. Remounting
 * never has to ask it.
 *
 * ## The one that is NOT this module's, and the evidence for saying so
 *
 * Reported twice: "only by switching to another app it shows what has been
 * written." The first time it really was this file — nothing had connected, so
 * nothing echoed, and the app switch was what finally produced a resize
 * observation; see the essay on `waiting` further down. That is fixed, and the
 * sentence came back anyway, which is the part worth writing down.
 *
 * The second cause is in the window, not in the page. In WKWebView as Tauri
 * hosts it, an application that stops being frontmost has its page marked
 * `document.visibilityState === 'hidden'` and `requestAnimationFrame` stops
 * firing ENTIRELY — measured at 60/s, then 0/s in the following second, and
 * zero for as long as it is left there. It does not need to be covered. The
 * window is still on screen and the person is still looking at it.
 *
 * xterm draws rows only inside a `requestAnimationFrame`, through one
 * `RenderDebouncer` that every renderer sits behind. So while the app is in the
 * background the pty still produces, the socket still delivers and
 * `terminal.write()` still parses — and the render is a frame that never
 * arrives. Come back, the pending frame runs, and the whole backlog appears at
 * once, which is the reported sentence word for word.
 *
 * Three fixes suggest themselves here and all three are wrong:
 *
 *   - `@xterm/addon-webgl` or `@xterm/addon-canvas`. They replace the renderer,
 *     and the renderer is not what stopped: `RenderService` debounces into a
 *     rAF before any of them is reached, so all three stop together.
 *   - A repaint nudge — toggling a style, reading `offsetHeight` — on write. A
 *     page whose rendering update is suspended does not paint what you write
 *     into it. There is nothing to nudge.
 *   - A timer that renders when rAF will not. Same answer, and it would also be
 *     the per-tick work this workspace refuses everywhere else.
 *
 * It is the shell's to fix, in `kehikko-desktop`, because the shell is what
 * holds the WKWebView and decides what it is told about its window.
 * `dev/frozen-while-backgrounded.js` is the measurement, with the numbers and
 * the command that produced them, so the next person does not spend the
 * afternoon in Chromium finding nothing — which is where this one started, and
 * Chromium and Playwright's headed WebKit both paint every keystroke on time.
 *
 * ## And the reason this file now counts things
 *
 * That fix landed and the sentence came back a third time, with two new facts:
 * it gets worse "after the terminal has been running for a while", and pressing
 * **New shell does not bring it back**. The second one is the useful one. A new
 * shell is a new pty, a new child, a new socket and — because the parent bumps
 * `key` — a brand new emulator and a brand new one of everything in this file.
 * If none of that helps, then whatever stopped is not any of those: it is
 * something that OUTLIVES a remount.
 *
 * There are only a few candidates for that, and every one of them is a thing
 * this file might have failed to release: an emulator that was not disposed, a
 * `ResizeObserver` still observing a detached node, a socket still open, an
 * `onData` listener still attached. So each of them is now counted in and
 * counted out, and `/api/trace` prints how many are LIVE. Two views live at
 * once is not a theory about the bug; it is the bug, stated.
 *
 * The counts are paired with this effect's cleanup deliberately — `seen.x()` on
 * the way in and `seen.xGone()` in the returned function — so that a future
 * edit which forgets to release something also makes the number wrong, and the
 * number is on a report somebody reads. See `src/view/trace.ts`.
 *
 * ## "Scrolling doesn't seem to work at all", which was measured and is not here
 *
 * Reported once, and worth writing down BECAUSE nothing was changed: the next
 * person to read that sentence should start from what has already been ruled
 * out rather than from the beginning.
 *
 * `dev/scroll-probe.mjs` takes the sentence apart into the failures it could be
 * — the wheel doing nothing, the viewport snapping back, no scrollbar, no
 * scrollback to reach, an ancestor scrolling instead — and asserts each one
 * separately, standalone and framed. All of them pass: the wheel moves the
 * view, it stays where it is put while the pty keeps producing, the slider is
 * drawn and moves, and Shift+PageUp walks back to the first prompt. Measured in
 * Chromium headless and headed, at device pixel ratios 1 and 2, in WebKit and
 * in Firefox, and framed inside the host's frames layer — where the
 * `overflow: hidden` on the frame and the `pointer-events` juggling on the
 * layer are, and where neither turned out to matter, because a wheel over an
 * iframe is delivered to the framed document and the host has no `wheel`
 * listener anywhere.
 *
 * There is exactly one state in which the wheel is genuinely dead, and it is
 * the emulator doing what a terminal is supposed to do: a program that has
 * turned on mouse tracking with wheel reporting is SENT the wheel instead of
 * scrolling the view — `Viewport` sets `handleMouseWheel: false` while that
 * protocol is active — and the alternate screen has no scrollback to reach.
 * Both come back on their own when the program turns them off. What does not
 * come back is a program that DIED without turning them off, which leaves a
 * terminal whose wheel does nothing until something resets it. If the sentence
 * is reported again, that is the first thing to ask about; `reset` in the
 * terminal is the test, and it costs nothing.
 */

/**
 * xterm's palette, which does NOT follow the page's CSS.
 *
 * The emulator paints into a canvas with colours it was handed in JavaScript,
 * so a `.dark` class on the document does nothing to it. Told once at
 * construction and told again whenever the host changes the theme — otherwise
 * this is the one rectangle on the canvas that stays in the other theme, which
 * looks like a bug in the container rather than a thing nobody wired up.
 */
function palette(theme: 'light' | 'dark') {
  return theme === 'dark'
    ? { background: '#0a0a0a', foreground: '#e5e5e5', cursor: '#e5e5e5', selectionBackground: '#333333' }
    : { background: '#ffffff', foreground: '#171717', cursor: '#171717', selectionBackground: '#d4d4d4' }
}

export type Standing =
  | { at: 'opening' }
  | { at: 'live' }
  | { at: 'closed'; why: string }

export function TerminalView({
  theme,
  at,
  settled,
  onStanding,
}: {
  theme: 'light' | 'dark'
  /**
   * The open project's folder, or null where there is none.
   *
   * A shell that opens in the home directory when the person is looking at a
   * project is a shell whose first command is always the same `cd`. The canvas
   * knows where the project is; this is that answer, passed through.
   */
  at: string | null
  /**
   * Whether the canvas has said anything yet.
   *
   * The greeting arrives after this mounts, so a terminal that spawned the
   * moment it had a size would open in the home directory and then learn where
   * it should have been — and a pty's working directory cannot be changed
   * afterwards from out here without typing into somebody's shell. So the spawn
   * waits for the canvas to have spoken, or for it to be settled that nobody
   * will. Unframed this is true immediately and the shell opens at home, which
   * is the only honest answer when nothing has named a project.
   */
  settled: boolean
  onStanding?: (standing: Standing) => void
}) {
  /* Read inside the effect below, which runs once: putting these in its
     dependency list would dispose a live terminal and spawn a new shell every
     time the canvas mentioned a different project, which is the one thing a
     terminal must never do to somebody mid-command. */
  const start = useRef<{ at: string | null; settled: boolean }>({ at, settled })
  start.current = { at, settled }

  /** Set by the effect below, so a late greeting can start a waiting shell. */
  const wake = useRef<(() => void) | null>(null)

  const holder = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal | null>(null)
  const [, setStanding] = useState<Standing>({ at: 'opening' })

  /* Held in a ref and read inside the effect rather than listed as a
     dependency: a parent that re-created this callback on every render would
     otherwise tear down the socket and the shell with it. */
  const told = useRef(onStanding)
  told.current = onStanding

  const move = (next: Standing) => {
    setStanding(next)
    told.current?.(next)
  }

  useEffect(() => {
    const node = holder.current
    if (!node) return

    /* Counted here and released in this effect's cleanup, so that the report
       can answer the one question a remount raises: is the OLD one still
       alive? "Clicking New shell does not fix it" is exactly the shape of a
       view that was replaced without being released, and a count is the only
       thing that can tell that from a view that was replaced cleanly.

       Under StrictMode these run twice on mount in development — mounted 2,
       disposed 1, live 1 — which is React proving the cleanup works. `live` is
       the number to read; the totals are not a defect count. */
    seen.viewMounted()

    const terminal = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 12,
      /* The scrollback a person actually wants when a build scrolls past. */
      scrollback: 5000,
      cursorBlink: true,
      theme: palette(theme),
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(node)
    term.current = terminal
    seen.emulatorMade()

    /* What xterm ACTUALLY drew, as distinct from what it was handed.
       `terminal.write()` parses into the buffer without touching the screen;
       the render is a separate thing behind a `RenderDebouncer` and an
       animation frame, and the reported freeze is precisely the case where the
       first keeps happening and the second stops. Two counters that diverge
       name that instantly; one counter could not. It fires per render, not per
       byte, so it costs a single increment at the rate the screen changes. */
    const drawn = terminal.onRender(() => {
      seen.rendered()
    })

    /*
     * Nothing is spawned until this container has a real width.
     *
     * `fit()` used to run on the line after `open()`, and the socket opened
     * immediately after that. On a container that had just been shown — freshly
     * placed, unfolded, or a canvas switched to — the element had not been laid
     * out yet, so the fit measured a box a couple of characters wide. xterm
     * sized itself to that; the pty was told the clamped minimum; and the two
     * disagreed about how wide the world was.
     *
     * What that looks like is a prompt falling down the screen two characters
     * at a time:
     *
     *     (b
     *       as
     *         e)
     *
     * It corrects itself the moment the observer below fires, which is why it
     * reads as a glitch rather than a bug — the evidence scrolls away and the
     * next prompt is fine.
     *
     * The fix is not a better guess. It is to not guess: a terminal whose size
     * is unknown has nothing useful to say to a shell, so it waits. `usable`
     * is the smallest width worth starting at — below it, whatever we sent
     * would be a number we would immediately correct.
     */
    const usable = () => node.clientWidth > 40 && node.clientHeight > 40

    /* Both conditions, and the second is not about layout: a shell may only be
       spawned once the canvas has had its say about where. See `settled`. */
    const ready = () => usable() && start.current.settled

    let socket: WebSocket | null = null

    const connect = () => {
      if (socket) return
      try {
        fit.fit()
      } catch {
        /* Measured while being laid out. Worth a line, because a terminal that
           never connects looks exactly like a terminal that froze, and this is
           one of the two ways to reach that state without an error anywhere. */
        note('a fit threw while connecting, so no socket was opened yet')
        return
      }
      const live = new WebSocket(`ws://${location.host}/terminal`)
      socket = live
      seen.socketOpening()

      live.onopen = () => {
        live.send(
          JSON.stringify({
            ticket: ticket(),
            cwd: start.current.at,
            cols: terminal.cols,
            rows: terminal.rows,
          }),
        )
        move({ at: 'live' })
        terminal.focus()
        /* Whatever was typed while this was opening, in the order it was typed
           and after the opening frame, which the server reads first. */
        for (const data of waiting.splice(0)) live.send(JSON.stringify({ d: data }))
      }

      wire(live)
    }

    function wire(live: WebSocket) {
      /* One close per socket, whatever order the browser delivers `error` and
         `close` in. Without this the live count would go negative on a failed
         connection, and a counter that can lie is worse than no counter. */
      let ended = false

      /* Output, straight through. Never parsed — it is a byte stream from a
         program, and the moment this side starts looking for structure in it, a
         program that prints JSON becomes a program that can talk to this page. */
      live.onmessage = (event: MessageEvent) => {
        const data = typeof event.data === 'string' ? event.data : ''
        /* Sizes, never contents. What comes out of somebody's shell is their
           session; see the essay in `trace.ts`. */
        seen.message(data.length)
        terminal.write(data)
        seen.written()
      }

      live.onclose = (event: CloseEvent) => {
        const why = event.reason || 'the connection ended'
        if (!ended) {
          ended = true
          seen.socketClosed(why)
        }
        move({ at: 'closed', why })
      }

      live.onerror = () => {
        if (!ended) {
          ended = true
          seen.socketClosed('the connection could not be made')
        }
        /* No detail available by design — the browser does not tell a page why
           a socket failed, precisely so a page cannot use it to probe. Say the
           true and useless thing rather than inventing a specific one. */
        move({ at: 'closed', why: 'the connection could not be made' })
      }
    }

    /*
     * Every frame is an envelope; see the essay in `shell.ts`. Bare text would
     * have made a leading space indistinguishable from a control frame.
     *
     * ## Nothing typed is ever dropped, and a keystroke can start the shell
     *
     * This used to be `if (socket && readyState === OPEN) send(...)`, which
     * reads like defensive coding and was in fact the bug: a terminal that had
     * not connected swallowed everything a person typed, silently, while
     * looking exactly like a terminal. It had a cursor, it took focus, and it
     * did nothing.
     *
     * The way to get into that state was ordinary. Connecting was reached only
     * from a resize observation, so a container whose size never CHANGED after
     * mount — already laid out, or laid out in a way that produced one
     * observation too early — never got a second one, and never connected.
     * Switching to another app and back forced a fresh layout, the observer
     * fired, and it started working, which is exactly how it was reported.
     *
     * So a keystroke now connects. It is not a fallback bolted on: somebody
     * typing into this terminal is the strongest evidence available that it is
     * on screen, focused and wanted — better evidence than any measurement,
     * because a measurement is this program guessing about that and a keystroke
     * is a person telling it.
     *
     * And what they typed is kept rather than raced. `connect` opens a socket
     * that is not usable for some milliseconds, and the characters typed in
     * that window are the first thing somebody wrote — very often a command
     * they are part-way through. They go in `waiting` and are flushed the
     * moment the socket opens, in order.
     */
    const waiting: string[] = []

    const typing = terminal.onData((data: string) => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        seen.keystroke(waiting.length)
        socket.send(JSON.stringify({ d: data }))
        return
      }
      /* Bounded: a person typing at a dead terminal is a person who will give
         up, and an unbounded buffer would hold a paste of any size for a socket
         that may never open. A few hundred keystrokes is far more than anybody
         types before noticing, and the oldest go first so what survives is what
         they most recently meant. */
      waiting.push(data)
      if (waiting.length > 512) waiting.shift()
      /* A keystroke count and a buffer depth, never the keystroke. Counted on
         BOTH paths — the one that sends and the one that buffers — because a
         count that only rose when nothing was sent would go quiet in exactly
         the case a reader most wants to see: somebody typing at a terminal that
         is answering. A `waiting` that only grows is a terminal accepting
         typing and sending none of it, which is one of the things people call a
         freeze. */
      seen.keystroke(waiting.length)
      /* `ready()` rather than an unconditional connect: a keystroke is proof
         somebody is looking at this, but not proof the canvas has said where the
         project is, and a pty's working directory cannot be changed afterwards.
         What was typed is already in `waiting` and is flushed when the socket
         opens, so nothing is lost by waiting a moment longer. */
      if (!socket && ready()) connect()
    })

    /*
     * Resize, and it is not cosmetic.
     *
     * A pty whose columns disagree with the program's idea of them wraps every
     * line in the wrong place — the single most common way a browser terminal
     * is built badly. So the fit is measured here and the NEW size is sent, and
     * the pty is resized to match rather than left at its opening guess.
     */
    const resized = new ResizeObserver(() => {
      /* The first observation with a real size is what starts the shell. After
         that this is only the resize path. */
      if (!socket) {
        if (ready()) connect()
        return
      }
      /*
       * A container with no size is not a container two characters wide.
       *
       * Folding a container hides its frame, which fires an observation at zero.
       * Fitting to that shrank the emulator to about two columns while nobody
       * could see it, the pty was told the clamped minimum, and the shell drew
       * its next prompt into a world neither of them agreed on. Unfolding fired
       * another observation and put the size right — too late for the prompt
       * already on screen, which is why the staircase appeared on UNFOLD
       * having been caused on fold.
       *
       * The same guard the connect path uses, for the same reason: an absent
       * measurement is not a small measurement, and the honest response to it
       * is to do nothing at all.
       */
      if (!usable()) return
      try {
        fit.fit()
      } catch {
        /* Measured at zero while being laid out. Nothing to do; the next
           observation will have a real size. */
        return
      }
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ r: { cols: terminal.cols, rows: terminal.rows } }))
      }
    })
    resized.observe(node)
    seen.observerMade()

    /* A container that was already laid out when this mounted — the common case
       once a canvas is settled — has its size now and should not wait for an
       observation that may not come. */
    if (ready()) connect()

    /* The canvas usually speaks before the container has a size, in which case
       the observation above starts the shell. When it is the other way round —
       laid out first, greeted after — nothing else would fire, so the effect on
       `settled` below calls this. */
    wake.current = () => {
      if (ready()) connect()
    }

    return () => {
      wake.current = null
      resized.disconnect()
      seen.observerGone()
      drawn.dispose()
      typing.dispose()
      /* Closed before the terminal is disposed, so no late frame can arrive for
         an emulator that is gone. A container unmounted before it was ever wide
         enough has no socket to close. */
      socket?.close()
      terminal.dispose()
      seen.emulatorDisposed()
      seen.viewDisposed()
      term.current = null
    }
    /* The theme is deliberately NOT a dependency: a theme change must not
       restart somebody's shell. It is applied to the live emulator below. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (term.current) term.current.options.theme = palette(theme)
  }, [theme])

  /*
   * The canvas has spoken: start the shell if it was only waiting for that.
   *
   * Separate from the effect that builds the terminal, and deliberately so —
   * putting `settled` in that effect's dependencies would dispose a live
   * emulator and spawn a second shell the moment the greeting arrived.
   */
  useEffect(() => {
    if (settled) wake.current?.()
  }, [settled])

  return <div ref={holder} className="h-full w-full" />
}
