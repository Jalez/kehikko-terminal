/**
 * What a chat looks like on the wire between this module's server and its page.
 *
 * ## Why this is a file of its own, holding nothing but a type
 *
 * Because `chats.ts` — the thing that produces these — imports `node:fs`, and a
 * page that imports `chats.ts` for the TYPE drags the whole reader into the
 * browser bundle with it. That fails at evaluation, before React renders, and
 * the symptom is the worst one available: a module whose page loads, whose
 * frame fires `load`, and which never answers the host's greeting. The host
 * reports a module that will not speak; the module's own console holds the
 * only clue.
 *
 * `import type` alone does not save you, because `verbatimModuleSyntax` will
 * honour it but a single accidental value import in the same file will not. The
 * reliable fix is that there is nothing here to import by value.
 *
 * This has bitten this workspace twice already, in two different modules.
 */

export interface Chat {
  /** The session id, which is the filename. What `claude --resume` takes. */
  id: string
  /** Where it was held, absolute, or null when no row in it recorded one. */
  cwd: string | null
  /** Last write to the file, epoch millis. What the list is ordered by. */
  touched: number
  /** How many rows the transcript has. */
  rows: number
  /** The first thing the person said, clipped, or empty if they never did. */
  opening: string
}
