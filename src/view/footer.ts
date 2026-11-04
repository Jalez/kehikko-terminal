import { LIMITS, type FooterItemInput } from 'kehikot-module-protocol'
import { COVER_WORDS, TRY_AGAIN, type CoverState } from 'kehikot-module-protocol/client/react'

import type { ShellStatus } from './status-frame.ts'

/**
 * The footer this page declares to a host that draws one (`kehikot.footer`, protocol 2.38.0): what
 * is going on in the shell on screen, so that a container folded to its header and footer still
 * says it.
 *
 * - whether a command is running in front of the shell ("Running vim") or it waits at its prompt
 *   ("Idle"); first, because it is the one text a very narrow row keeps;
 * - the folder the shell is in, the home folder as `~`, whole on hover;
 * - which shell it is, at the end, the first to go when the row is narrow;
 * - why the shell ended, once it has (New shell stays in the header: it starts something);
 * - the folder renamed under a running shell, with Dismiss beside it;
 * - while a cover is over the shell, only the cover's sentence, `warn` while this module's server
 *   is not answering, and Try again beside it.
 *
 * With no shell on screen (the cover is then drawn whole, over the page) there is nothing to say and
 * the footer is `[]`, which a host draws as no row at all.
 *
 * Declared only when the greeting said the host draws it (`drawsFooter`); with any other host the
 * page draws its own strips and declares nothing.
 */

/** The ids a press names. */
export const FOOTER_COVER = 'cover'
export const FOOTER_TRY_AGAIN = 'try-again'
export const FOOTER_DISMISS_RENAMED = 'dismiss-renamed'

/** What the footer is drawn from. */
export interface FooterState {
  cover: CoverState | null
  /** Whether a shell is on screen. */
  shell: boolean
  /** The module's name, for the cover's sentence. */
  name: string
  /** What the server last read about the shell on screen, or null before it said. */
  status?: ShellStatus | null
  /** Why the shell on screen ended, or null while it runs. */
  ended?: string | null
  /** The folder the project was renamed to under the running shell, until dismissed. */
  renamed?: string | null
}

const cut = (text: string, most: number) => (text.length > most ? `${text.slice(0, most - 1)}…` : text)
const said = (text: string) => cut(text, LIMITS.FOOTER_TEXT)
const tip = (text: string) => cut(text, LIMITS.FOOTER_TOOLTIP)

export function footerItems({ cover, shell, name, status = null, ended = null, renamed = null }: FooterState): FooterItemInput[] {
  if (!shell) return []
  if (cover) {
    const items: FooterItemInput[] = [{ kind: 'text', id: FOOTER_COVER, text: said(COVER_WORDS[cover](name)), level: cover === 'down' ? 'warn' : 'normal' }]
    if (cover === 'down') {
      items.push({ kind: 'run', id: FOOTER_TRY_AGAIN, label: TRY_AGAIN, icon: 'refresh', align: 'end', tooltip: `Ask whether ${name}’s own server is answering now.` })
    }
    return items
  }
  const items: FooterItemInput[] = []
  if (ended) {
    const words = `The shell ended: ${ended}`
    items.push({ kind: 'text', id: 'ended', text: said(words), level: 'warn', tooltip: tip(`${words}. New shell, in the header, opens another.`) })
  } else if (status) {
    items.push(
      status.busy
        ? { kind: 'text', id: 'state', text: said(`Running ${status.busy}`), tooltip: tip(`${status.busy} is running in front of the shell.`) }
        : { kind: 'text', id: 'state', text: 'Idle', tooltip: tip(`${status.shell} is waiting at its prompt.`) },
    )
  }
  if (status?.shown) items.push({ kind: 'text', id: 'cwd', text: said(status.shown), tooltip: tip(status.cwd ?? status.shown) })
  if (renamed && !ended) {
    const words = `This folder was renamed to ${renamed}. The shell still works in it but shows the old name; open a new shell to start fresh.`
    items.push({ kind: 'text', id: 'renamed', text: said(words), level: 'warn', tooltip: tip(words) })
    items.push({ kind: 'run', id: FOOTER_DISMISS_RENAMED, label: 'Dismiss', icon: 'x', align: 'end' })
  }
  if (status && !ended) items.push({ kind: 'text', id: 'shell', text: said(status.shell), align: 'end', optional: true, tooltip: tip(`The shell: ${status.shell}`) })
  return items
}
