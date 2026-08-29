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
 * its socket is a pane that accepts typing and silently drops it. Both are
 * states somebody would call a hang.
 *
 * ## Why `key` matters upstream
 *
 * There is no code here for "the chat changed". Switching chats REMOUNTS this
 * component, because the parent gives it a `key` — so a new socket, a new pty
 * and a fresh emulator, and the old ones are closed by this effect's cleanup.
 * Trying to re-point a live terminal at a different shell would mean deciding
 * what to do with a half-typed command in the old one, and there is no good
 * answer to that question. Remounting never has to ask it.
 */

/** What the page was served, minted once per process. See `page.ts`. */
function ticket(): string {
  const tag = document.getElementById('terminal-ticket')
  if (!tag?.textContent) return ''
  try {
    const held: unknown = JSON.parse(tag.textContent)
    return typeof held === 'string' ? held : ''
  } catch {
    /* Louder than a silent empty string would be, but only in the console: the
       page still renders and the socket still refuses, which is the sentence
       the person needs and it is already on screen. */
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
 * looks like a bug in the pane rather than a thing nobody wired up.
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
  cwd,
  resume,
  theme,
  onStanding,
}: {
  /** Where the shell starts. Null means the user's home directory. */
  cwd: string | null
  /** A chat to reopen, typed into the fresh shell. Null for a plain terminal. */
  resume: string | null
  theme: 'light' | 'dark'
  onStanding?: (standing: Standing) => void
}) {
  const holder = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal | null>(null)
  const [standing, setStanding] = useState<Standing>({ at: 'opening' })

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
      /* Enough that `less` and `vim` behave, and the cursor blinks like every
         other terminal the person uses. */
      cursorBlink: true,
      theme: palette(theme),
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(node)
    fit.fit()
    term.current = terminal

    const socket = new WebSocket(`ws://${location.host}/terminal`)

    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          ticket: ticket(),
          cwd,
          resume,
          cols: terminal.cols,
          rows: terminal.rows,
        }),
      )
      move({ at: 'live' })
      terminal.focus()
    }

    /* Output, straight through. Never parsed — it is a byte stream from a
       program, and the moment this side starts looking for structure in it, a
       program that prints JSON becomes a program that can talk to this page. */
    socket.onmessage = (event: MessageEvent) => {
      terminal.write(typeof event.data === 'string' ? event.data : '')
    }

    socket.onclose = (event: CloseEvent) => {
      move({
        at: 'closed',
        why: event.reason || 'the connection ended',
      })
    }

    socket.onerror = () => {
      /* No detail available by design — the browser does not tell a page why a
         socket failed, precisely so a page cannot use it to probe. Say the true
         and useless thing rather than inventing a specific one. */
      move({ at: 'closed', why: 'the connection could not be made' })
    }

    /* Every frame is an envelope; see the essay in `shell.ts`. Bare text would
       have made a leading space indistinguishable from a control frame. */
    const typing = terminal.onData((data: string) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ d: data }))
    })

    /*
     * Resize, and it is not cosmetic.
     *
     * A pty whose columns disagree with the program's idea of them wraps every
     * line in the wrong place — the single most common way a browser terminal
     * is built badly. So the fit is measured here and the NEW size is sent, and
     * the pty is resized to match rather than being left at its opening guess.
     */
    const resized = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        /* A pane measured at zero while it is being laid out. Nothing to do;
           the next observation will have a real size. */
        return
      }
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ r: { cols: terminal.cols, rows: terminal.rows } }))
      }
    })
    resized.observe(node)

    return () => {
      resized.disconnect()
      typing.dispose()
      /* Closed before the terminal is disposed, so no late frame can arrive for
         an emulator that is gone. */
      socket.close()
      terminal.dispose()
      term.current = null
    }
    /* `cwd` and `resume` are read once, at open. Changing which chat is shown
       remounts this component — see the essay above — so they cannot change
       under a live socket, and listing them would only invite somebody to
       "fix" that by re-pointing a running shell. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, resume])

  /* The theme is NOT on that effect's dependency list, because a theme change
     must not restart somebody's shell. Applied to the live emulator instead. */
  useEffect(() => {
    if (term.current) term.current.options.theme = palette(theme)
  }, [theme])

  return (
    <div className="relative h-full w-full">
      <div ref={holder} className="h-full w-full" />
      {standing.at === 'closed' && (
        <div className="bg-background/90 absolute inset-0 grid place-items-center p-4 text-center">
          <p className="text-muted-foreground text-xs">
            {standing.why}. Pick a chat, or start a new terminal, to open another shell.
          </p>
        </div>
      )}
    </div>
  )
}
