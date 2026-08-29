import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { chats, describe as describeChat, projectsDir } from '../chats.ts'

/**
 * Reading somebody else's file format, defensively.
 *
 * Claude Code owns the shape of these transcripts and is free to change it
 * without telling this module. So the tests that matter are not "it parses a
 * good file" — they are the ones about what happens when it does not.
 */

function make(): { root: string; slug: string } {
  const root = mkdtempSync(join(tmpdir(), 'kehikko-chats-'))
  const slug = join(root, '-Users-jo-Projects-thing')
  mkdirSync(slug, { recursive: true })
  return { root, slug }
}

const row = (o: unknown) => JSON.stringify(o) + '\n'

describe('describing one transcript', () => {
  test('the directory comes from inside the file, not from the folder name', () => {
    /* The folder name is a mangled path and the mangling is not injective —
       `my-app` and `my/app` land in the same place. Guessing would mean opening
       a shell in the wrong repository. */
    const { slug } = make()
    const file = join(slug, 'a.jsonl')
    writeFileSync(
      file,
      row({ type: 'user', cwd: '/Users/jo/Projects/my-app', message: { content: 'hello there' } }),
    )
    expect(describeChat(file)?.cwd).toBe('/Users/jo/Projects/my-app')
  })

  test('the opening line is the first thing a person typed', () => {
    const { slug } = make()
    const file = join(slug, 'b.jsonl')
    writeFileSync(
      file,
      row({ type: 'assistant', cwd: '/x', message: { content: 'I said this first' } }) +
        row({ type: 'user', cwd: '/x', message: { content: [{ type: 'text', text: 'what a person typed' }] } }),
    )
    expect(describeChat(file)?.opening).toBe('what a person typed')
  })

  test('a tool result is not somebody typing', () => {
    /* Recorded as a user turn because that is who it is addressed to, but
       nobody typed it. A list captioned with the output of a grep is useless. */
    const { slug } = make()
    const file = join(slug, 'c.jsonl')
    writeFileSync(
      file,
      row({ type: 'user', cwd: '/x', message: { content: [{ type: 'tool_result', content: 'lots of grep output' }] } }) +
        row({ type: 'user', cwd: '/x', message: { content: [{ type: 'text', text: 'the real question' }] } }),
    )
    expect(describeChat(file)?.opening).toBe('the real question')
  })

  test('a half-written last line does not spoil the read', () => {
    /* A live chat is the most interesting kind to list, and a chat being
       written to always ends mid-line. */
    const { slug } = make()
    const file = join(slug, 'd.jsonl')
    writeFileSync(
      file,
      row({ type: 'user', cwd: '/x', message: { content: 'good row' } }) + '{"type":"assis',
    )
    const read = describeChat(file)
    expect(read?.cwd).toBe('/x')
    expect(read?.opening).toBe('good row')
  })

  test('a transcript with no human turn is described, not skipped', () => {
    /* Opened and abandoned is a real thing that happens, and it should look
       like what it is rather than being filtered out silently. */
    const { slug } = make()
    const file = join(slug, 'e.jsonl')
    writeFileSync(file, row({ type: 'assistant', cwd: '/x', message: { content: 'nobody asked' } }))
    expect(describeChat(file)).toMatchObject({ cwd: '/x', opening: '' })
  })

  test('a file that is not there is null rather than a throw', () => {
    expect(describeChat(join(tmpdir(), 'definitely-not-here.jsonl'))).toBeNull()
  })

  test('a very long opening is clipped', () => {
    const { slug } = make()
    const file = join(slug, 'f.jsonl')
    writeFileSync(file, row({ type: 'user', cwd: '/x', message: { content: 'y'.repeat(900) } }))
    const opening = describeChat(file)?.opening ?? ''
    expect(opening.length).toBeLessThanOrEqual(140)
    expect(opening.endsWith('…')).toBe(true)
  })
})

describe('the list', () => {
  test('newest first, by the file’s own mtime', () => {
    /* mtime rather than anything inside the file: a timestamp parsed from the
       last COMPLETE row of a live chat is a moment that stops advancing. */
    const { root, slug } = make()
    writeFileSync(join(slug, 'old.jsonl'), row({ type: 'user', cwd: '/x', message: { content: 'older' } }))
    writeFileSync(join(slug, 'new.jsonl'), row({ type: 'user', cwd: '/x', message: { content: 'newer' } }))
    const found = chats(root)
    expect(found).toHaveLength(2)
    expect(found[0]!.touched).toBeGreaterThanOrEqual(found[1]!.touched)
  })

  test('the id is the filename', () => {
    const { root, slug } = make()
    writeFileSync(join(slug, 'abc-123.jsonl'), row({ type: 'user', cwd: '/x', message: { content: 'hi' } }))
    expect(chats(root)[0]!.id).toBe('abc-123')
  })

  test('files that are not transcripts are ignored', () => {
    const { root, slug } = make()
    writeFileSync(join(slug, 'notes.md'), 'not a transcript')
    writeFileSync(join(slug, 'a.jsonl'), row({ type: 'user', cwd: '/x', message: { content: 'hi' } }))
    expect(chats(root)).toHaveLength(1)
  })

  test('no projects directory at all is an empty list, not a throw', () => {
    /* What a machine that has never run Claude Code looks like. */
    expect(chats(join(tmpdir(), 'kehikko-nothing-here-at-all'))).toEqual([])
  })

  test('the default location is under the home directory', () => {
    expect(projectsDir('/Users/jo')).toBe('/Users/jo/.claude/projects')
  })
})
