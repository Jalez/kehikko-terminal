import { MANIFEST_KIND, PROTOCOL, manifestSchema, type Manifest } from 'roadmap-module-protocol'

export const ID = 'roadmap.terminal'
export const VERSION = '1.0.0'

/**
 * What this app says about itself when a host asks.
 *
 * ## What this module is, and what it deliberately is not
 *
 * A terminal. Not a transcript viewer, not a session dashboard, not an
 * orchestrator: a pty on this machine with `xterm` in front of it, the same two
 * pieces a code editor's integrated terminal is built from. You type in it. It
 * runs your login shell, and `claude` is one of the things you can type.
 *
 * It had a chat list down the side once, listing every Claude Code conversation
 * on the machine with a press to reopen one. It was cut on the plainest
 * grounds: everything it offered was already reachable by typing, so it was a
 * menu standing in front of a keyboard. If that list is wanted again it should
 * be its own module framed beside this one, not a sidebar inside it.
 *
 * The orchestrator (port 7850) is the module that does the other thing: it
 * STARTS agents on selected references and reads their transcripts off disk
 * without attaching to anything. The two are siblings on purpose and neither
 * subsumes the other. If you want work dispatched and watched, that is
 * orchestrator. If you want to sit down and type, that is here.
 *
 * ## `global`, not `epic`
 *
 * A terminal is not about an epic. It is about a directory and a shell, and the
 * canvas's subject changing should not disturb one — a container that reset your
 * shell because somebody switched epics in another container would be unusable. The
 * context is still received and still honoured for the one thing it genuinely
 * says about this module: the theme.
 *
 * ## What is declared, and the longer list of what is not
 *
 * - **`uses: []`.** This module asks the host for nothing. Everything on screen
 *   is a pty on this machine, and there is no question a host could answer that
 *   would change what a shell does. A module that declared capabilities it never
 *   exercised would be asking for permission it had no use for.
 * - **`prompt: false`.** A prompt is standing instructions somebody writes FOR
 *   a module, and it earns its place when the module has a decision it would
 *   make differently having read them. This one has no decisions: it runs the
 *   shell and draws the bytes. The instructions belong to whatever you type,
 *   not to the emulator you typed it in.
 * - **`storage: true`, and this one is not optional.** The page opens a
 *   WebSocket to its own `/terminal`, and its own module scripts are fetched in
 *   CORS mode whatever else is true. Without an origin of its own the page runs
 *   opaque, both are cross-origin, and the only way to make them work would be
 *   a permissive `Access-Control-Allow-Origin` — which is precisely the header
 *   that must never appear here, because the thing behind it is a shell. See
 *   the essay in `shell.ts`.
 * - **No extensions.** Nothing here happens that another module has any
 *   business being told about. What you type in your own terminal is not an
 *   event the canvas needs.
 * - **No MCP door.** An agent does not need a tool to use this; a person does.
 *   Giving an agent a tool that types into a human's terminal would be the
 *   inversion of what this module is for.
 */
export const MANIFEST: Manifest = manifestSchema.parse({
  kind: MANIFEST_KIND,
  /**
   * Parsed here, at import, rather than shipped as a bare object.
   *
   * The protocol package is explicit that its schemas are a convenience and
   * never the host's check — the host runs its own copy over what arrives on
   * the wire. That cuts both ways: running it HERE is the cheapest way for this
   * app to learn it has written a manifest no host will accept, and to learn it
   * when this file is imported rather than from a host's refusal in somebody
   * else's log.
   */
  protocol: PROTOCOL,
  id: ID,
  name: 'Terminal',
  version: VERSION,
  summary: 'A real terminal on this machine. Your shell, in a container, with nothing else in it.',
  /**
   * What an agent should do about this module being here.
   *
   * Not what it shows — the summary says that. This says what its PRESENCE
   * OBLIGES, and a host composes it into the prompt every agent on the canvas
   * is handed, attributed to this module.
   *
   * Written as instructions to somebody who has just arrived and does not know
   * the terminal exists, since that is exactly who reads it.
   */
  guidance:
    'A person is sitting at a terminal on this canvas, watching a session run rather than reading a ' +
    'summary of it afterwards. So narrate as you go: say what you are about to do before you do it, ' +
    'and say what happened after, rather than working in silence and reporting at the end. They can ' +
    'see the same shell you are in, so do not describe output they are already looking at, and do ' +
    'not claim a command succeeded where they can watch it fail. Anything you run here runs on their ' +
    'machine as them, with no sandbox between: prefer the reversible order, and ask before the step ' +
    'that cannot be taken back.',
  entry: '/app',
  modes: [{ id: 'terminal', label: 'Terminal', scope: 'global' }],
  extensions: { emits: [], consumes: [] },
  declares: {
    protocol: `>=${PROTOCOL} <${PROTOCOL + 1}`,
    uses: [],
    storage: true,
    prompt: false,
  },
  health: '/healthz',
})
