import { describe, expect, test } from 'bun:test'
import { realpathSync } from 'node:fs'

import { busyOf, cwdOf, readStatusFrame, shownPath, statusFrame, statusOf, statusWatch, type Run, type ShellStatus } from '../status.ts'

/** What the footer says about a shell, read on the server and sent as a binary frame. */
describe('the shell status', () => {
  const fake = (answers: Record<string, string | null>): Run => async (file, args) => answers[`${file} ${args.join(' ')}`] ?? null

  test('the folder with ~ for home, and only for home itself or under it', () => {
    expect(shownPath('/Users/a/proj', '/Users/a')).toBe('~/proj')
    expect(shownPath('/Users/a', '/Users/a')).toBe('~')
    expect(shownPath('/Users/ab/proj', '/Users/a')).toBe('/Users/ab/proj')
    expect(shownPath(null, '/Users/a')).toBeNull()
  })

  test('the working directory from lsof on macOS', async () => {
    const exec = fake({ 'lsof -a -p 42 -d cwd -Fn': 'p42\nfcwd\nn/Users/a/proj\n' })
    expect(await cwdOf(42, exec, 'darwin')).toBe('/Users/a/proj')
    expect(await cwdOf(43, exec, 'darwin')).toBeNull()
  })

  test('this process’s own folder, read for real', async () => {
    expect(realpathSync((await cwdOf(process.pid))!)).toBe(realpathSync(process.cwd()))
  })

  test('busy is a foreground group that is not the shell’s, said by its leader’s name', async () => {
    expect(await busyOf(42, fake({ 'ps -o pgid=,tpgid= -p 42': ' 42  42\n' }))).toBeNull()
    expect(await busyOf(42, fake({ 'ps -o pgid=,tpgid= -p 42': ' 42  77\n', 'ps -o comm= -p 77': '/usr/bin/vim\n' }))).toBe('vim')
    expect(await busyOf(42, fake({ 'ps -o pgid=,tpgid= -p 42': ' 42  77\n' }))).toBe('a command')
    expect(await busyOf(42, fake({}))).toBeNull()
  })

  test('the whole status, the shell by its name', async () => {
    const exec = fake({ 'lsof -a -p 42 -d cwd -Fn': 'n/tmp\n', 'ps -o pgid=,tpgid= -p 42': '42 42' })
    expect(await statusOf(42, '/bin/zsh', exec, 'darwin')).toEqual({ cwd: '/tmp', shown: '/tmp', shell: 'zsh', busy: null })
  })

  test('the frame reads back as what was sent, and anything else is not a status', () => {
    const status: ShellStatus = { cwd: '/tmp', shown: '/tmp', shell: 'zsh', busy: 'vim' }
    expect(readStatusFrame(statusFrame(status))).toEqual(status)
    expect(readStatusFrame(new TextEncoder().encode('{"d":"ls"}'))).toBeNull()
    expect(readStatusFrame(new TextEncoder().encode('not json'))).toBeNull()
  })

  test('read after output, told only when it changed, and never after stop', async () => {
    let now: ShellStatus = { cwd: '/a', shown: '/a', shell: 'zsh', busy: null }
    let reads = 0
    const told: ShellStatus[] = []
    const watch = statusWatch(
      async () => {
        reads += 1
        return now
      },
      (status) => told.push(status),
      { settle: 5, idle: 60_000 },
    )
    watch.poke()
    watch.poke()
    await Bun.sleep(30)
    expect(reads).toBe(1)
    watch.poke()
    await Bun.sleep(30)
    expect(told.length).toBe(1)
    now = { ...now, busy: 'make' }
    watch.poke()
    await Bun.sleep(30)
    expect(told.map((one) => one.busy)).toEqual([null, 'make'])
    watch.stop()
    now = { ...now, busy: null }
    watch.poke()
    await Bun.sleep(30)
    expect(told.length).toBe(2)
  })
})
