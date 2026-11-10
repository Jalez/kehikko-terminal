import type { HeaderItemInput } from 'kehikot-module-protocol'

/** What the header is drawn from. */
export interface HeaderState {
  /** A shell is on screen (and no cover is over the page). */
  shell: boolean
  /** The shell on screen has ended. */
  dead: boolean
  /** Its project's folder was renamed while it ran. */
  relocated: boolean
  /** Why it ended, when it has. */
  why: string | null
  /** The host draws a footer, which then carries `why`. */
  drawsFooter: boolean
}

/**
 * The header: one Run item. With no shell yet, or a cover over the page, there is nothing to offer and
 * none is declared. A function of its own so `dev/rows.ts` states the same rows `kehikot-check-rows` reads.
 */
export function headerItems({ shell, dead, relocated, why, drawsFooter }: HeaderState): HeaderItemInput[] {
  if (!shell) return []
  return [
    {
      kind: 'run',
      id: 'new-shell',
      label: 'New shell',
      icon: 'terminal',
      /* Failed is what the Run trigger shows without the menu being opened: this shell has ended. */
      state: dead ? 'failed' : 'idle',
      /* Why it ended is a readout: the footer's, where a host draws one; else said on the item. */
      result: why && !drawsFooter ? (why.length > 32 ? `${why.slice(0, 31)}…` : why) : null,
      disabled: dead || relocated ? null : 'The shell here is still running.',
      /* Pressed on a shell that is still running (its folder was renamed), it ends that shell: asked first. */
      confirm: !dead && relocated,
    },
  ]
}
