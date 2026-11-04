/**
 * The status frame: what the server reads about a shell (`status.ts` at the root) and sends to the
 * page as a BINARY websocket frame. Pty output always goes out as text, so nothing a program prints
 * can ever be read as one of these. Browser-safe: the page reads it with `readStatusFrame`.
 */
export interface ShellStatus {
  /** The shell's working directory, whole, or null when it could not be read. */
  cwd: string | null
  /** The same, with the home folder as `~`: what the footer shows. */
  shown: string | null
  /** The shell's name: `zsh`, `bash`. */
  shell: string
  /** The name of the command in front of the shell, or null when the shell is at its prompt. */
  busy: string | null
}

/** The status as the frame the page reads: binary, so it can never be confused with pty output. */
export function statusFrame(status: ShellStatus): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ status }))
}

/** A status frame read back on the page; null for anything that is not one. */
export function readStatusFrame(bytes: ArrayBuffer | Uint8Array): ShellStatus | null {
  try {
    const said = JSON.parse(new TextDecoder().decode(bytes)) as { status?: Partial<ShellStatus> }
    const status = said?.status
    if (!status || typeof status !== 'object' || typeof status.shell !== 'string') return null
    const text = (value: unknown) => (typeof value === 'string' && value ? value : null)
    return { cwd: text(status.cwd), shown: text(status.shown), shell: status.shell, busy: text(status.busy) }
  } catch {
    return null
  }
}

