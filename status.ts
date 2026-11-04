import { execFile } from 'node:child_process'
import { readlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename } from 'node:path'

import type { ShellStatus } from './src/view/status-frame.ts'

export { readStatusFrame, statusFrame, type ShellStatus } from './src/view/status-frame.ts'

/**
 * What the footer says about a shell: the folder it is in, which shell it is, and whether a command
 * is running in front of it. Read on the server, from the operating system, and sent to the page as
 * a binary frame (`statusFrame`), which nothing the pty prints can ever be: pty output goes out as
 * text, so a program that prints JSON still cannot talk to the page.
 *
 * - the folder is the shell's own working directory: what `cd` changes, read with `lsof` on macOS
 *   and from `/proc` on Linux;
 * - busy is the terminal's foreground process group: the shell's own while it waits at its prompt,
 *   a command's while one runs. Its leader's name is what is said ("Running vim").
 *
 * Read only after the shell printed something (a prompt after `cd`, a command starting or ending),
 * at most every `STATUS_SETTLE_MS`, and every `STATUS_IDLE_MS` besides, so an idle shell costs
 * almost nothing and a silent command that ends is still noticed.
 */
/** How long after output the status is read: a burst of output is one read. */
export const STATUS_SETTLE_MS = 400
/** How often it is read anyway, so a command that ends silently is noticed. */
export const STATUS_IDLE_MS = 5_000

/** Run a program and give back what it printed, or null when it failed. */
export type Run = (file: string, args: string[]) => Promise<string | null>

const run: Run = (file, args) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: 2_000, encoding: 'utf8' }, (error, stdout) => resolve(error ? null : stdout))
  })

/** The folder as the footer shows it: the home folder as `~`. */
export function shownPath(cwd: string | null, home: string = homedir()): string | null {
  if (!cwd) return null
  if (home && (cwd === home || cwd.startsWith(`${home}/`))) return `~${cwd.slice(home.length)}`
  return cwd
}

/** The working directory of a process, or null. */
export async function cwdOf(pid: number, exec: Run = run, platform: string = process.platform): Promise<string | null> {
  if (platform === 'linux') {
    try {
      return await readlink(`/proc/${pid}/cwd`)
    } catch {
      return null
    }
  }
  const said = await exec('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'])
  const line = said?.split('\n').find((one) => one.startsWith('n'))
  return line ? line.slice(1) || null : null
}

/** The command in front of the shell, or null when the shell itself is (or nothing could be read). */
export async function busyOf(pid: number, exec: Run = run): Promise<string | null> {
  const groups = await exec('ps', ['-o', 'pgid=,tpgid=', '-p', String(pid)])
  const [pgid, tpgid] = (groups ?? '').trim().split(/\s+/).map(Number)
  if (!pgid || !tpgid || tpgid <= 0 || tpgid === pgid) return null
  const name = (await exec('ps', ['-o', 'comm=', '-p', String(tpgid)]))?.trim()
  /* The leader of the foreground group has gone already: something runs, its name is not known. */
  return name ? basename(name).replace(/^-/, '') : 'a command'
}

/** Everything the footer says about one shell. */
export async function statusOf(pid: number, file: string, exec: Run = run, platform: string = process.platform): Promise<ShellStatus> {
  const [cwd, busy] = await Promise.all([cwdOf(pid, exec, platform), busyOf(pid, exec)])
  return { cwd, shown: shownPath(cwd), shell: basename(file).replace(/^-/, ''), busy }
}

/**
 * Reads one shell's status when it may have changed and hands it on when it did. `poke` after
 * output; `stop` when the shell ends.
 */
export function statusWatch(read: () => Promise<ShellStatus>, tell: (status: ShellStatus) => void, timers: { settle: number; idle: number } = { settle: STATUS_SETTLE_MS, idle: STATUS_IDLE_MS }) {
  let last = ''
  let reading = false
  let again = false
  let stopped = false
  let soon: ReturnType<typeof setTimeout> | null = null
  const look = async () => {
    soon = null
    if (stopped) return
    if (reading) {
      again = true
      return
    }
    reading = true
    try {
      const status = await read()
      const said = JSON.stringify(status)
      if (!stopped && said !== last) {
        last = said
        tell(status)
      }
    } catch {
      /* Nothing could be read this time: the footer keeps what it said. */
    } finally {
      reading = false
      if (again && !stopped) {
        again = false
        poke()
      }
    }
  }
  const poke = () => {
    if (stopped || soon) return
    soon = setTimeout(() => void look(), timers.settle)
  }
  const idle = setInterval(() => void look(), timers.idle)
  return {
    poke,
    stop: () => {
      stopped = true
      clearInterval(idle)
      if (soon) clearTimeout(soon)
    },
  }
}
