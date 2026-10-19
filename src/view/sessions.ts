/**
 * Which shell a person is looking at, decided from what the canvas says.
 *
 * ## The report this answers
 *
 * "It seems we are using the same terminal session no matter what project or
 * epic we are viewing in terminal module." That was true, and it was not a bug
 * in the ordinary sense: the manifest said `scope: 'global'` and the essay
 * beside it said a terminal is about a directory and a shell, so the canvas's
 * subject moving should not disturb one. Read the premise again, though. A
 * terminal IS about a directory — and the project on the wire is a directory.
 * `projectPath` is an absolute folder the host vouches for. So the argument
 * for staying put was really an argument for following the project, and it
 * only ever read as an argument for staying put because when it was written
 * the context carried no path for a shell to be about.
 *
 * What a person who works in two projects actually met: one shell, whose
 * `cd`, environment and scrollback belonged to whichever project they had
 * looked at last. Looking at the other project changed nothing on screen, and
 * the next command ran in the wrong repository.
 *
 * ## Keyed by project, and deliberately not by epic
 *
 * The report names both. They are not the same kind of thing and they get
 * different answers.
 *
 * A **project** is a folder. A shell has a working directory, a history and an
 * environment, all of which are about that folder, so one shell per project is
 * what a person opens by hand in a terminal application anyway — a tab per
 * repository. The key is the project's id (`context.projectId`) when the host
 * sends one, so a folder renamed under a running shell is still the same
 * project (see "A project is known by its id" below). From an older host it is
 * `projectPath`, exactly as the host spells it, because that is the string the
 * shell is spawned in and two spellings of one folder would be two shells in
 * one place.
 *
 * An **epic** is a unit of work inside a project. It is not a place on disk:
 * two epics in the same project share one working tree, one checkout, one set
 * of environment variables, and a command run for one is run in the same
 * folder as a command run for the other. Keying shells by epic would mean one
 * of two failures, depending on how it was built. Either switching epic takes
 * a person away from the shell they were mid-command in — which is the exact
 * outcome the original `global` essay was written to prevent, and it was right
 * about it — or a shell accumulates for every epic a person has ever glanced
 * at, a process per glance, with no visible reason for any of them. So the
 * epic is read and ignored here, on purpose, and there is a test that says so.
 * If somebody wants a shell per epic they can say so; this file will not
 * quietly give them one.
 *
 * ## What happens to a running command
 *
 * Nothing. A session is never closed because the canvas looked elsewhere.
 * Switching project switches which session is ON SCREEN; the others keep their
 * sockets, their ptys and whatever they were running, and come back exactly
 * where they were. A shell mid-`npm install` must not be killed because
 * somebody looked at another project, and here it cannot be, because the only
 * thing a switch does is change one `hidden` attribute.
 *
 * ## Lifetime, said plainly
 *
 * A session is CREATED the first time the canvas names a project this page has
 * not seen, or — unframed, or framed with no project open — once, for the home
 * directory. It is never created for a project the canvas has not named.
 *
 * A session is DESTROYED when:
 *
 *   - the page is unloaded. Every socket closes and every pty is killed, which
 *     is what happened before this file existed and is still what a pty's
 *     lifetime is: it lives exactly as long as its socket. A session held here
 *     does not outlive the page.
 *   - its shell exits on its own. The dead session is kept on screen with the
 *     `New shell` button until the person leaves it, and forgotten the next
 *     time the canvas moves away from it, because a dead session holds nothing
 *     worth keeping.
 *   - it is the least recently shown of more than `MOST_KEPT`. This is the
 *     line that stops "never destroyed" being the answer by accident. A page
 *     lives as long as the host does — the host loads a module once and shows
 *     it on whichever canvas asks — so without a bound a shell would accumulate
 *     for every project ever looked at, indefinitely. Eviction closes a shell
 *     that may be running something, and that is a real cost; it is taken
 *     because the alternative is an unbounded number of idle processes with no
 *     cause a person could see, and it is announced on the trace when it
 *     happens rather than done silently. The bound is well above the number of
 *     projects anybody flips between in one sitting.
 *
 * ## Sessions from before this change
 *
 * There is no "before" to migrate. A shell was a socket and a socket was a
 * component; when this page reloads with the new code the old socket closes
 * and its pty ends, exactly as every reload always did. Nothing is left
 * existing with nothing to show it.
 *
 * ## Why this file holds no socket, no emulator and no React
 *
 * Everything above is a decision, and every decision here is a pure function
 * of what the canvas said and what was already held. `Shells` in `app.tsx`
 * holds the state and draws it; this decides. That split is what lets the
 * tests below say "two projects, two sessions" and "an epic is not a key"
 * without a browser, a pty or a socket in the room.
 */

import { projectKey } from 'kehikot-module-protocol'

/** A session's place: the project's folder, or null for the home directory. */
export type Key = string | null

/** How many sessions the page holds at once, the one on screen included. */
export const MOST_KEPT = 8

/*
 * ## A project is known by its id, and its folder can move
 *
 * A host from protocol 2.1.0 on sends `projectId` beside `projectPath`: the
 * project's permanent id, which stays the same when its folder is renamed or
 * moved. A session is KEYED by that id when there is one (`projectKey` in the
 * protocol), and by the folder only for an older host that sends none.
 *
 * So the canvas naming the same id at a new folder is a RELINK, not a switch:
 * the shell that is running stays on screen, attached and untouched. macOS
 * keeps a running process's working directory through a rename, so the shell
 * goes on working in the renamed folder — but `$PWD` and the prompt still
 * show the old name, and nothing here can change that from outside the shell.
 * What this does instead is remember the new folder (`now`), say so in one
 * line until the person dismisses it, and open the next shell — `New shell` —
 * in the new folder. It never closes or restarts a shell on its own.
 */

export interface Session {
  /** What this session is known by: the project's id, else its folder, else null for home. */
  key: Key
  /**
   * Where this shell was opened. Fixed for the life of the shell: the folder a
   * running process was spawned in, as it was spelled then.
   */
  at: Key
  /**
   * Where the project is now. The same as `at` until the canvas names this
   * project's id at another folder (a rename or a move); the next shell opens
   * here.
   */
  now: Key
  /** Whether the person dismissed the line saying the folder moved. */
  dismissed: boolean
  /**
   * Bumped by `New shell`, so a fresh shell in the same place is a NEW
   * component rather than a re-pointed live one. See `TerminalView` on why
   * restarting in place is a question with no good answer.
   */
  generation: number
  /** When this was last the one on screen. Decides who is evicted. */
  shownAt: number
}

export interface Held {
  sessions: Session[]
  /** Which session is on screen, or null before the canvas has said anything. */
  shown: { key: Key } | null
}

export const NOTHING_HELD: Held = { sessions: [], shown: null }

/**
 * What the canvas said, reduced to the facts a shell is about: which project
 * (`key`) and where its folder is (`at`).
 *
 * `null` means "nothing is decided yet" and is different from `{ at: null }`,
 * which means "the home directory": the first is a page that has not heard
 * whether it is framed and must not spawn, the second is a page that knows
 * nobody is going to name a project. The `where` a module gets from the
 * protocol client has exactly those three states, and the middle one lasts
 * under a second.
 *
 * `epic` is not read. That is the decision, not an omission — see the essay
 * at the top.
 */
export function wanted(
  where: 'listening' | 'unhosted' | 'hosted',
  context: { projectPath: string | null; projectId?: string | null } | null,
): { key: Key; at: Key } | null {
  if (where === 'listening') return null
  const at = context?.projectPath ?? null
  if (at === null) return { key: null, at: null }
  return { key: projectKey({ projectId: context?.projectId ?? null, projectPath: at })?.key ?? at, at }
}

/** The string a session is known by, for React keys and for the trace. Stable across a relink. */
export function label(session: { key: Key; generation: number }): string {
  return `${session.key ?? 'home'}#${session.generation}`
}

/**
 * The folder this session's project moved to while its shell was running, for
 * the line that says so — or null when there is nothing to say (never moved,
 * moved back, already dismissed, or a fresh shell already opened there).
 */
export function moved(session: Session | null | undefined): string | null {
  if (!session || session.dismissed) return null
  return session.now !== session.at ? session.now : null
}

/**
 * Put the session for `want` on screen, creating it if this is the first time.
 *
 * `want` is what `wanted` returned; a bare folder is read as a project known by
 * its folder (an older host). When a held session has the same key at another
 * folder, it is RELINKED: kept, shown, and told where its project is now.
 *
 * Returns what was evicted to make room, so the caller can say so somewhere a
 * person will read it. Eviction never touches the one being shown: the least
 * recently shown OTHER session goes first.
 */
export function show(
  held: Held,
  want: Key | { key: Key; at: Key },
  now: number,
): { held: Held; evicted: Session[]; relinked: { from: Key; to: Key } | null } {
  const { key, at } = typeof want === 'object' && want !== null ? want : { key: want, at: want }
  const found = held.sessions.find((s) => s.key === key)
  const relinked = found && found.now !== at ? { from: found.now, to: at } : null
  const sessions = found
    ? held.sessions.map((s) =>
        s === found ? { ...s, shownAt: now, ...(relinked ? { now: at, dismissed: false } : {}) } : s,
      )
    : [...held.sessions, { key, at, now: at, dismissed: false, generation: 1, shownAt: now }]

  const evicted: Session[] = []
  const kept = [...sessions]
  while (kept.length > MOST_KEPT) {
    /* Oldest `shownAt` among those NOT on screen. The shown one has `now`, the
       largest value, so it can never be chosen — but say so rather than rely on
       the arithmetic. */
    let oldest: Session | null = null
    for (const s of kept) {
      if (s.key === key) continue
      if (!oldest || s.shownAt < oldest.shownAt) oldest = s
    }
    if (!oldest) break
    kept.splice(kept.indexOf(oldest), 1)
    evicted.push(oldest)
  }

  return { held: { sessions: kept, shown: { key } }, evicted, relinked }
}

/**
 * A fresh shell for the same project, replacing whatever was there, opened
 * where the project is NOW.
 *
 * Called for a session whose shell has exited, or — on the person's press —
 * for one whose folder was renamed under it, which is the only way that shell
 * learns the new name.
 */
export function restart(held: Held, key: Key): Held {
  return {
    ...held,
    sessions: held.sessions.map((s) =>
      s.key === key ? { ...s, at: s.now, dismissed: false, generation: s.generation + 1 } : s,
    ),
  }
}

/** The person dismissed the line saying this session's folder moved. Nothing else changes. */
export function dismiss(held: Held, key: Key): Held {
  return { ...held, sessions: held.sessions.map((s) => (s.key === key ? { ...s, dismissed: true } : s)) }
}

/**
 * Drop a session that holds nothing.
 *
 * Used for a dead one the canvas has moved away from. Never called for the
 * session on screen, and never for a live one: this is bookkeeping, not a way
 * to close a shell.
 */
export function forget(held: Held, key: Key): Held {
  if (held.shown?.key === key) return held
  return { ...held, sessions: held.sessions.filter((s) => s.key !== key) }
}
