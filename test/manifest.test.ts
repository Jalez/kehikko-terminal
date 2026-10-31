import { describe, expect, test } from 'bun:test'
import { holdsLiveSessions, manifestSchema, revealModeOf } from 'kehikot-module-protocol'

import { MANIFEST } from '../manifest.ts'

describe('the manifest', () => {
  test('is one a host accepts', () => {
    expect(manifestSchema.safeParse(MANIFEST).success).toBe(true)
  })

  test('says a restart ends the shells it holds, so a host never restarts it on its own account', () => {
    expect(MANIFEST.holds).toEqual(['live-sessions'])
    expect(holdsLiveSessions(MANIFEST)).toBe(true)
  })

  test('asks the host to reveal its header and footer over the shell, never by resizing it', () => {
    expect(revealModeOf(manifestSchema.parse(MANIFEST))).toBe('over')
  })
})
