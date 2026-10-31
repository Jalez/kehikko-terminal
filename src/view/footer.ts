import { LIMITS, type FooterItemInput } from 'kehikot-module-protocol'
import { COVER_WORDS, TRY_AGAIN, type CoverState } from 'kehikot-module-protocol/client/react'

/**
 * The footer this page declares to a host that draws one (`kehikot.footer`, protocol 2.38.0).
 *
 * It is the strip the page draws under a shell while a cover is over it (`data-cover` in
 * `app.tsx`): the cover's sentence, as a text a narrow row keeps, `warn` while this module's server
 * is not answering, and then "Try again", a run with the refresh icon, which asks whether the server
 * is there now. With no cover, or no shell on screen (the cover is then drawn whole, over the page),
 * there is nothing to say and the footer is `[]`, which a host draws as no row at all.
 *
 * Declared only when the greeting said the host draws it (`drawsFooter`); with any other host the
 * page draws its own strip and declares nothing.
 */

/** The id of the cover's sentence and of Try again, which a press names. */
export const FOOTER_COVER = 'cover'
export const FOOTER_TRY_AGAIN = 'try-again'

export function footerItems(cover: CoverState | null, shell: boolean, name: string): FooterItemInput[] {
  if (!cover || !shell) return []
  const said = COVER_WORDS[cover](name)
  const items: FooterItemInput[] = [
    {
      kind: 'text',
      id: FOOTER_COVER,
      text: said.length > LIMITS.FOOTER_TEXT ? `${said.slice(0, LIMITS.FOOTER_TEXT - 1)}…` : said,
      level: cover === 'down' ? 'warn' : 'normal',
    },
  ]
  if (cover === 'down') {
    items.push({
      kind: 'run',
      id: FOOTER_TRY_AGAIN,
      label: TRY_AGAIN,
      icon: 'refresh',
      align: 'end',
      tooltip: `Ask whether ${name}’s own server is answering now.`,
    })
  }
  return items
}
