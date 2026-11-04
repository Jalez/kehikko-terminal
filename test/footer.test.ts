import { describe, expect, test } from 'bun:test'
import { footerItemsSchema, footerLayout } from 'kehikot-module-protocol'
import { COVER_WORDS, type CoverState } from 'kehikot-module-protocol/client/react'

import { FOOTER_DISMISS_RENAMED, footerItems, type FooterState } from '../src/view/footer.ts'

/** The footer this page declares to a host that draws one: what is going on in the shell on screen. */
describe('footerItems', () => {
  const parses = (items: unknown) => expect(footerItemsSchema.safeParse(items).success).toBe(true)
  const base: FooterState = { cover: null, shell: true, name: 'Terminal' }
  const idle = { cwd: '/Users/a/proj', shown: '~/proj', shell: 'zsh', busy: null }
  const ids = (state: FooterState) => footerItems(state).map((one) => one.id)

  test('nothing read yet and nothing covering the shell: nothing to say', () => {
    expect(footerItems(base)).toEqual([])
  })

  test('no shell on screen: the cover is drawn whole over the page, so the footer says nothing', () => {
    expect(footerItems({ ...base, cover: 'down', shell: false, status: idle })).toEqual([])
  })

  test('the server down: the sentence as a warning, and Try again with the refresh icon at the end, and nothing stale beside it', () => {
    const items = footerItems({ ...base, cover: 'down', status: idle })
    parses(items)
    expect(items).toEqual([
      { kind: 'text', id: 'cover', text: 'Terminal’s own server is not answering.', level: 'warn' },
      { kind: 'run', id: 'try-again', label: 'Try again', icon: 'refresh', align: 'end', tooltip: 'Ask whether Terminal’s own server is answering now.' },
    ])
  })

  test('any other cover: the sentence alone, at its normal level, and every one parses', () => {
    expect(footerItems({ ...base, cover: 'stale' })).toMatchObject([{ kind: 'text', id: 'cover', level: 'normal' }])
    for (const cover of Object.keys(COVER_WORDS) as CoverState[]) parses(footerItems({ ...base, cover }))
  })

  test('a shell at its prompt: Idle first, then the folder with ~ for home, the shell at the end and optional', () => {
    const items = footerItems({ ...base, status: idle })
    parses(items)
    expect(items).toEqual([
      { kind: 'text', id: 'state', text: 'Idle', tooltip: 'zsh is waiting at its prompt.' },
      { kind: 'text', id: 'cwd', text: '~/proj', tooltip: '/Users/a/proj' },
      { kind: 'text', id: 'shell', text: 'zsh', align: 'end', optional: true, tooltip: 'The shell: zsh' },
    ])
  })

  test('a command running: said by name, and kept when the row is at its narrowest', () => {
    const items = footerItemsSchema.parse(footerItems({ ...base, status: { ...idle, busy: 'vim' } }))
    expect(items[0]).toMatchObject({ id: 'state', text: 'Running vim' })
    expect(footerLayout(items, 180).start.map((one) => one.id)).toEqual(['state'])
    expect(footerLayout(items, 260).start.map((one) => one.id)).toEqual(['state', 'cwd'])
  })

  test('the shell ended: why, as a warning, and where it was; New shell stays in the header', () => {
    const items = footerItems({ ...base, status: idle, ended: 'the shell exited (0)' })
    parses(items)
    expect(items.map((one) => one.id)).toEqual(['ended', 'cwd'])
    expect(items[0]).toMatchObject({ text: 'The shell ended: the shell exited (0)', level: 'warn' })
    expect(items.some((one) => one.kind === 'run')).toBe(false)
  })

  test('the folder renamed under the shell: the sentence, with Dismiss beside it', () => {
    const items = footerItems({ ...base, status: idle, renamed: '/Users/a/new' })
    parses(items)
    expect(ids({ ...base, status: idle, renamed: '/Users/a/new' })).toEqual(['state', 'cwd', 'renamed', FOOTER_DISMISS_RENAMED, 'shell'])
    expect(items.find((one) => one.id === FOOTER_DISMISS_RENAMED)).toMatchObject({ kind: 'run', label: 'Dismiss', align: 'end' })
  })

  test('a long folder is cut to fit, whole in its tooltip', () => {
    const deep = `/${'a'.repeat(400)}`
    const items = footerItems({ ...base, status: { ...idle, cwd: deep, shown: deep } })
    parses(items)
  })
})
