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
 * repository. The key is `projectPath`, exactly as the host spells it, because
 * that is the string the shell is spawned in and two spellings of one folder
 * would be two shells in one place.
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

/** A session's place: the project's folder, or null for the home directory. */
export type Key = string | null

/** How many sessions the page holds at once, the one on screen included. */
export const MOST_KEPT = 8

export interface Session {
  /** Where this shell was opened. The key: one session per distinct value. */
  at: Key
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
  shown: { at: Key } | null
}

export const NOTHING_HELD: Held = { sessions: [], shown: null }

/**
 * What the canvas said, reduced to the one fact a shell is about.
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
  context: { projectPath: string | null } | null,
): { at: Key } | null {
  if (where === 'listening') return null
  return { at: context?.projectPath ?? null }
}

/** The string a session is known by, for React keys and for the trace. */
export function label(session: { at: Key; generation: number }): string {
  return `${session.at ?? 'home'}#${session.generation}`
}

/**
 * Put the session for `at` on screen, creating it if this is the first time.
 *
 * Returns what was evicted to make room, so the caller can say so somewhere a
 * person will read it. Eviction never touches the one being shown: the least
 * recently shown OTHER session goes first.
 */
export function show(held: Held, at: Key, now: number): { held: Held; evicted: Session[] } {
  const found = held.sessions.find((s) => s.at === at)
  const sessions = found
    ? held.sessions.map((s) => (s === found ? { ...s, shownAt: now } : s))
    : [...held.sessions, { at, generation: 1, shownAt: now }]

  const evicted: Session[] = []
  const kept = [...sessions]
  while (kept.length > MOST_KEPT) {
    /* Oldest `shownAt` among those NOT on screen. The shown one has `now`, the
       largest value, so it can never be chosen — but say so rather than rely on
       the arithmetic. */
    let oldest: Session | null = null
    for (const s of kept) {
      if (s.at === at) continue
      if (!oldest || s.shownAt < oldest.shownAt) oldest = s
    }
    if (!oldest) break
    kept.splice(kept.indexOf(oldest), 1)
    evicted.push(oldest)
  }

  return { held: { sessions: kept, shown: { at } }, evicted }
}

/**
 * A fresh shell in the same place, replacing whatever was there.
 *
 * Only ever called for a session whose shell has exited — the button that
 * calls it is drawn only then — so nothing running is lost by it.
 */
export function restart(held: Held, at: Key): Held {
  return {
    ...held,
    sessions: held.sessions.map((s) => (s.at === at ? { ...s, generation: s.generation + 1 } : s)),
  }
}

/**
 * Drop a session that holds nothing.
 *
 * Used for a dead one the canvas has moved away from. Never called for the
 * session on screen, and never for a live one: this is bookkeeping, not a way
 * to close a shell.
 */
export function forget(held: Held, at: Key): Held {
  if (held.shown?.at === at) return held
  return { ...held, sessions: held.sessions.filter((s) => s.at !== at) }
}
