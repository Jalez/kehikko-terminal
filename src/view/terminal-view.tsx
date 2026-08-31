import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

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
 */

/** What the page was served, minted once per process. See `page.ts`. */
function ticket(): string {
  const tag = document.getElementById('terminal-ticket')
  if (!tag?.textContent) return ''
  try {
    const held: unknown = JSON.parse(tag.textContent)
    return typeof held === 'string' ? held : ''
  } catch {
    /* Louder than a silent empty string, but only in the console: the page
       still renders and the socket still refuses, which is the sentence the
       person needs and it is already on screen. */
    console.error('terminal: the ticket in this page is not a JSON string')
    return ''
  }
}

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
  onStanding,
}: {
  theme: 'light' | 'dark'
  onStanding?: (standing: Standing) => void
}) {
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

    let socket: WebSocket | null = null

    const connect = () => {
      if (socket) return
      try {
        fit.fit()
      } catch {
        return
      }
      const live = new WebSocket(`ws://${location.host}/terminal`)
      socket = live

      live.onopen = () => {
        live.send(
          JSON.stringify({
            ticket: ticket(),
            cwd: null,
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
      /* Output, straight through. Never parsed — it is a byte stream from a
         program, and the moment this side starts looking for structure in it, a
         program that prints JSON becomes a program that can talk to this page. */
      live.onmessage = (event: MessageEvent) => {
        terminal.write(typeof event.data === 'string' ? event.data : '')
      }

      live.onclose = (event: CloseEvent) => {
        move({ at: 'closed', why: event.reason || 'the connection ended' })
      }

      live.onerror = () => {
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
      if (!socket) connect()
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
        if (usable()) connect()
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

    /* A container that was already laid out when this mounted — the common case
       once a canvas is settled — has its size now and should not wait for an
       observation that may not come. */
    if (usable()) connect()

    return () => {
      resized.disconnect()
      typing.dispose()
      /* Closed before the terminal is disposed, so no late frame can arrive for
         an emulator that is gone. A container unmounted before it was ever wide
         enough has no socket to close. */
      socket?.close()
      terminal.dispose()
      term.current = null
    }
    /* The theme is deliberately NOT a dependency: a theme change must not
       restart somebody's shell. It is applied to the live emulator below. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (term.current) term.current.options.theme = palette(theme)
  }, [theme])

  return <div ref={holder} className="h-full w-full" />
}
