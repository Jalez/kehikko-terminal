import { useEffect, useRef, useState } from 'react'
import type { ModuleContext } from 'roadmap-module-protocol'

import { connect, type Host } from './wire/host.ts'
import { TerminalView, type Standing } from './view/terminal-view.tsx'
import { Button } from '@/components/ui/button'

const ID = 'roadmap.terminal'

/**
 * A terminal. That is the whole of it.
 *
 * ## What was here and is deliberately gone
 *
 * A list of every Claude Code chat on the machine, down the left, with a press
 * to reopen one. It worked, and it was cut, because the person it was built for
 * said: "just a terminal was enough, no need for the separate chats list. Just a
 * smooth, simple terminal that's not encumbered by anything that it doesn't
 * need."
 *
 * That is the right call and it is worth writing down why rather than only
 * that it happened. The chat list was a second thing competing for a pane that
 * has exactly one job, and everything it offered was already reachable by
 * typing — `claude --resume` is a command, and this is a terminal. A pane that
 * lists what you could type instead of letting you type it has added a menu in
 * front of a keyboard.
 *
 * What went with it: `/api/chats`, the reader that walked `~/.claude/projects`,
 * and the resume plumbing on the wire. If it ever comes back it should come
 * back as its own module, framed beside this one, rather than as a sidebar
 * inside it.
 *
 * ## What the host is for here, which is almost nothing
 *
 * This module asks the host for nothing — `uses` is empty — and the context
 * carries exactly one fact it acts on: the theme. A terminal is about a shell;
 * the canvas switching epics has no bearing on what you are typing, and a pane
 * that restarted your shell because somebody moved the subject elsewhere would
 * be unusable. The greeting is still answered, because a module that stays
 * silent is a module a host reports as broken.
 */

export function App() {
  const [context, setContext] = useState<ModuleContext | null>(null)
  /**
   * Which shell is on screen, as a key.
   *
   * A number rather than a boolean, because "start another" has to produce a
   * NEW terminal rather than reuse the old one. Bumping it remounts
   * `TerminalView`, which closes the dead socket and opens a fresh pty; see the
   * essay there on why re-pointing a live terminal is a question with no good
   * answer.
   */
  const [shell, setShell] = useState(1)
  const [standing, setStanding] = useState<Standing>({ at: 'opening' })
  const host = useRef<Host | null>(null)

  useEffect(() => {
    const live = connect(ID, {
      onHello: (next) => setContext(next),
      onContext: (next) => setContext(next),
      /*
       * A walk, answered immediately and always with `found: false`.
       *
       * There is nothing in a terminal for a reference to land on — it holds a
       * shell, not a document with anchors. Answering at once rather than
       * staying silent is the point: the protocol says `goto` is the one place
       * a host WAITS on a module, and a host's reference index decides between
       * walking in place and falling back to an ordinary link by whether the
       * walk found anything. Silence would make every reference pointing here
       * sit out the host's timeout first.
       */
      onGoto: (_goto, answer) => {
        answer(false, 'A terminal holds a shell, not a document: there is nothing here to walk to.')
      },
    })
    host.current = live
    return () => {
      live.stop()
      host.current = null
    }
  }, [])

  /* The theme, applied to the document element rather than a wrapper, because
     the shadcn tokens are defined on `:root` and `.dark`. A class on a div
     would leave the page's own background, painted by `body`, in the other
     theme. With no host, no class is set and the media query in `index.css`
     decides — the honest default when nobody has said. */
  const theme = context?.theme ?? 'light'
  useEffect(() => {
    if (!context) return
    const root = document.documentElement
    root.classList.toggle('dark', context.theme === 'dark')
    root.classList.toggle('light', context.theme === 'light')
  }, [context])

  /*
   * The one control on the page, and it is only drawn when the shell is gone.
   *
   * A terminal with a toolbar is a terminal with less terminal in it. While the
   * shell is running there is nothing here to press, because everything you
   * could want to do is a thing you type. When it EXITS the pane would
   * otherwise be a dead rectangle with no way out, and that is the one moment a
   * button earns its pixels.
   */
  const dead = standing.at === 'closed'

  return (
    <div className="bg-background text-foreground flex h-dvh min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <TerminalView key={shell} theme={theme} onStanding={setStanding} />
      </div>

      {dead && (
        <div className="flex items-center justify-between gap-2 border-t px-2 py-1">
          <span className="text-muted-foreground truncate text-[11px]">{standing.why}</span>
          <Button size="sm" variant="outline" className="h-6 shrink-0 px-2 text-xs" onClick={() => setShell((n) => n + 1)}>
            New shell
          </Button>
        </div>
      )}
    </div>
  )
}
