import { describe, expect, test } from 'bun:test'
import { footerItemsSchema } from 'kehikot-module-protocol'
import { COVER_WORDS, type CoverState } from 'kehikot-module-protocol/client/react'

import { footerItems } from '../src/view/footer.ts'

/** The footer this page declares to a host that draws one: the strip under a covered shell, as items. */
describe('footerItems', () => {
  const parses = (items: unknown) => expect(footerItemsSchema.safeParse(items).success).toBe(true)

  test('nothing covering the shell: nothing to say', () => {
    expect(footerItems(null, true, 'Terminal')).toEqual([])
  })

  test('no shell on screen: the cover is drawn whole over the page, so the footer says nothing', () => {
    expect(footerItems('down', false, 'Terminal')).toEqual([])
  })

  test('the server down: the sentence as a warning, and Try again with the refresh icon at the end', () => {
    const items = footerItems('down', true, 'Terminal')
    parses(items)
    expect(items).toEqual([
      { kind: 'text', id: 'cover', text: 'Terminal’s own server is not answering.', level: 'warn' },
      { kind: 'run', id: 'try-again', label: 'Try again', icon: 'refresh', align: 'end', tooltip: 'Ask whether Terminal’s own server is answering now.' },
    ])
  })

  test('any other cover: the sentence alone, at its normal level, and every one parses', () => {
    expect(footerItems('stale', true, 'Terminal')).toMatchObject([{ kind: 'text', id: 'cover', level: 'normal' }])
    for (const cover of Object.keys(COVER_WORDS) as CoverState[]) parses(footerItems(cover, true, 'Terminal'))
  })
})
