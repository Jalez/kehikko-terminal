import { useEffect, useRef, useState } from 'react'
import { useRoadmap } from 'roadmap-module-protocol/client/react'

import { TerminalView, type Standing } from './view/terminal-view.tsx'
import { NOTHING_HELD, forget, label, restart, show, wanted, type Held } from './view/sessions.ts'
import { note, seen } from './view/trace.ts'
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
 * that it happened. The chat list was a second thing competing for a container that
 * has exactly one job, and everything it offered was already reachable by
 * typing — `claude --resume` is a command, and this is a terminal. A container that
 * lists what you could type instead of letting you type it has added a menu in
 * front of a keyboard.
 *
 * What went with it: `/api/chats`, the reader that walked `~/.claude/projects`,
 * and the resume plumbing on the wire. If it ever comes back it should come
 * back as its own module, framed beside this one, rather than as a sidebar
 * inside it.
 *
 * ## What the host is for here, which is two things
 *
 * This module asks the host for nothing — `uses` is empty — and reads two
 * facts off the context it is sent: the theme, and the project's folder. The
 * second is a reversal of what this comment used to say. It said the canvas
 * switching subject "has no bearing on what you are typing", and that is still
 * true of the EPIC. It was never true of the project, because a project is a
 * folder and a shell is in one: a person looking at two projects through one
 * shell was running every command in whichever folder they had looked at
 * last. `Shells` below keeps a session per project and shows the one the
 * canvas is about. `src/view/sessions.ts` has the whole argument, including
 * why the epic is deliberately not a key.
 *
 * The greeting is still answered, because a module that stays silent is a
 * module a host reports as broken.
 */

export function App() {
  /**
   * The whole conversation with the host, in one line.
   *
   * What used to stand here was `mailbox.ts` and `host.ts` — 418 lines of
   * handshake, byte-identical to the copy in eleven sibling modules, two of
   * which had independently grown the same two bugs. It is one import now, and
   * the essays that explain the orderings live with the code that depends on
   * them rather than in twelve places that can drift apart.
   *
   * Nothing about what this page says on the wire changed: it answers `ready`
   * to every greeting, refuses every `goto` at once, and asks the host nothing,
   * because `uses` is empty and a terminal has no questions.
   */
  const { context, where } = useRoadmap(ID, {
    /*
     * A walk, answered immediately and always with `found: false`.
     *
     * There is nothing in a terminal for a reference to land on — it holds a
     * shell, not a document with anchors. Answering at once rather than staying
     * silent is the point: the protocol says `goto` is the one place a host
     * WAITS on a module, and a host's reference index decides between walking
     * in place and falling back to an ordinary link by whether the walk found
     * anything. Silence would make every reference pointing here sit out the
     * host's timeout first.
     */
    onGoto: (_goto, answer) => {
      answer(false, 'A terminal holds a shell, not a document: there is nothing here to walk to.')
    },
  })

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

  return <Shells theme={theme} where={where} projectPath={context?.projectPath ?? null} />
}

/**
 * One shell per project, and the one the canvas is about on screen.
 *
 * Separate from `App` so that it can be rendered in a test with the canvas's
 * answers handed in as props, rather than faked through a `postMessage`
 * handshake. What the host says arrives as `where` and `projectPath`; what this
 * does with it is the thing worth testing, and `sessions.ts` decides it.
 *
 * ## Every session stays mounted
 *
 * The sessions not on screen are `hidden`, not unmounted. `TerminalView` owns
 * its socket on the lifetime of its component, so unmounting one would close
 * the socket and kill the shell — which is precisely what switching project
 * must not do to a running command. A hidden view keeps its emulator, its
 * socket and its scrollback, and its `ResizeObserver` sees a zero-sized box,
 * which the view already treats as "no measurement" rather than "two columns
 * wide". When it is shown again the observer fires with a real size and the
 * pty is resized to it.
 *
 * ## Why not a server-side registry that survives a reload
 *
 * It would be the bigger thing: a shell that outlives the page, found again by
 * its project on the next load. It is not built here because nobody asked for
 * reload survival, because a pty that nothing is attached to is a process with
 * no owner and no way to close it from the page, and because the report was
 * about switching project, which this answers in full. If it is wanted, it is
 * a change in `shell.ts` and the trace, and the keying in `sessions.ts` would
 * be the client half of it, unchanged.
 */
export function Shells({
  theme,
  where,
  projectPath,
}: {
  theme: 'light' | 'dark'
  where: 'listening' | 'unhosted' | 'hosted'
  projectPath: string | null
}) {
  const [held, setHeld] = useState<Held>(NOTHING_HELD)

  /**
   * Each session's standing, by label, so the dead bar can be drawn for the
   * one on screen and a dead one can be forgotten when the canvas moves on.
   *
   * A ref beside the state, because the effect below reads it at the moment
   * the canvas moves and must not be re-run for every standing change: an
   * effect keyed on standings would re-decide the shown session every time a
   * shell connected, which is a decision only the canvas gets to make.
   */
  const [standings, setStandings] = useState<Record<string, Standing>>({})
  const known = useRef(standings)
  known.current = standings

  /* What is held, readable from inside the effect below without being one of
     its dependencies. The effect must run when the CANVAS moves and not when a
     shell connects or dies, and it needs the current sessions when it does. */
  const holding = useRef(held)
  holding.current = held

  /* The last place the canvas named, so that the same answer twice — which
     `StrictMode` produces on every mount by running effects twice — decides
     nothing twice and writes nothing twice onto the trace. */
  const decided = useRef<{ at: string | null } | null>(null)

  /*
   * The canvas moved, or spoke for the first time.
   *
   * `where` and `projectPath` are the only dependencies, and the epic is not
   * among them on purpose: `wanted` does not read it, so an epic switch inside
   * one project re-runs nothing and the shell stays exactly where it was.
   *
   * The decision is made here, in the effect, and handed to `setHeld` as a
   * value rather than as an updater. An updater is run twice under
   * `StrictMode`, and the notes and the `holding` count beside it are side
   * effects that would then happen twice — which put every switch on the
   * trace as two identical lines, and a trace that repeats itself is a trace
   * somebody reads as "it happened twice".
   */
  useEffect(() => {
    const want = wanted(where, { projectPath })
    if (!want) return
    if (decided.current && decided.current.at === want.at) return
    decided.current = want

    const before = holding.current
    const fresh = !before.sessions.some((s) => s.at === want.at)
    const shown = show(before, want.at, Date.now())

    /* A dead session the person is leaving holds nothing: no socket, no
       shell. Forgotten here — after the switch, since `forget` refuses to
       drop whatever is on screen — so it cannot sit in the report as a view
       that is live for no reason. */
    const leaving = before.sessions.find((s) => s.at === before.shown?.at)
    if (leaving && known.current[label(leaving)]?.at === 'closed') {
      shown.held = forget(shown.held, leaving.at)
    }

    note(
      `the canvas is about ${want.at ?? 'no project'}; ${fresh ? 'opening a shell there' : 'showing its shell'} (${
        shown.held.sessions.length
      } held)`,
    )
    for (const gone of shown.evicted) {
      note(
        `closed the shell in ${gone.at ?? 'the home directory'}: it was the least recently shown of more sessions than this page keeps (MOST_KEPT in src/view/sessions.ts)`,
      )
    }
    seen.holding(shown.held.sessions.length)
    setHeld(shown.held)
  }, [where, projectPath])

  const current = held.sessions.find((s) => s.at === held.shown?.at) ?? null
  const standing = current ? standings[label(current)] : undefined

  /*
   * The one control on the page, and it is only drawn when the shell is gone.
   *
   * A terminal with a toolbar is a terminal with less terminal in it. While the
   * shell is running there is nothing here to press, because everything you
   * could want to do is a thing you type. When it EXITS the container would
   * otherwise be a dead rectangle with no way out, and that is the one moment a
   * button earns its pixels.
   */
  const dead = standing?.at === 'closed'

  return (
    <div className="bg-background text-foreground flex h-dvh min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        {held.sessions.map((session) => {
          const id = label(session)
          const shown = session.at === held.shown?.at
          return (
            /* `hidden` rather than unmounted: see the essay above. The wrapper
               carries the attribute so that the view's own holder keeps its
               `h-full w-full` and measures correctly the moment it is shown. */
            <div key={id} hidden={!shown} className="h-full w-full" data-session={id}>
              <TerminalView
                theme={theme}
                at={session.at}
                shown={shown}
                onStanding={(next) => setStandings((all) => ({ ...all, [id]: next }))}
              />
            </div>
          )
        })}
      </div>

      {dead && current && (
        <div className="flex items-center justify-between gap-2 border-t px-2 py-1">
          <span className="text-muted-foreground truncate text-[11px]">{standing.why}</span>
          <Button
            size="sm"
            variant="outline"
            className="h-6 shrink-0 px-2 text-xs"
            onClick={() => {
              /* Recorded, because pressing this is the single most informative
                 thing somebody does while the container is stuck. "Clicking New
                 shell doesn't fix it either" rules out the shell, the pty and
                 the socket all at once — but only if the trace can show that
                 the press HAPPENED, that a second shell really started, and
                 that its bytes arrived and still did not appear. Without this
                 line the report cannot tell a press that did nothing from a
                 press that never landed.

                 Worth knowing while reading a report: this button only exists
                 while the shown session's shell has closed. If somebody was
                 able to press it, the socket had already ended — which is
                 itself a fact about the freeze, and the ring above will say
                 what closed it. */
              note(`somebody pressed New shell in ${current.at ?? 'the home directory'}`)
              setHeld((before) => restart(before, current.at))
            }}
          >
            New shell
          </Button>
        </div>
      )}
    </div>
  )
}
