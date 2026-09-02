import { MANIFEST_KIND, PROTOCOL, manifestSchema, type Manifest } from 'roadmap-module-protocol'

export const ID = 'roadmap.terminal'
export const VERSION = '1.0.0'

/**
 * The port this module would rather have, said once and beside the name it goes
 * with.
 *
 * It used to be said three times — `export PORT="${PORT:-7920}"` in `run.sh`,
 * `Number(process.env.PORT ?? 7920)` at the top of `vite.config.ts`, and again
 * in `register.ts` — with nothing keeping them in step, and a fourth copy
 * sitting in `~/.roadmap/modules` from whenever somebody last ran the third.
 *
 * It is here rather than in `vite.config.ts` because `register.ts` needs it too,
 * and importing a Vite config to read one number would build the plugin list and
 * mint this process's terminal ticket on the way to finding out what to write
 * down. A ticket minted by a program that then exits is a ticket no page will
 * ever be given.
 *
 * It is a PREFERENCE and not a promise, and that is a heavier sentence in this
 * module than in its siblings. The port is not only an address here: `fenced()`
 * in `shell.ts` checks a handshake's `Origin` and `Host` against the port this
 * server is ACTUALLY on, and a fence checking the wrong number refuses this
 * module's own page. So the port the server bound is read off
 * `httpServer.address()` after `listening` and handed to `serveTerminals` from
 * there — never assumed from this constant. See `vite.config.ts`.
 */
export const PREFERRED_PORT = 7920

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
 * ## `epic`, which used to be `global`, and the argument that changed
 *
 * This said `global` for its first three days, with this reasoning: "A
 * terminal is not about an epic. It is about a directory and a shell, and the
 * canvas's subject changing should not disturb one — a container that reset
 * your shell because somebody switched epics in another container would be
 * unusable." Every sentence of that is still true, and it is kept here so the
 * reversal is a reversal of something rather than a silent overwrite.
 *
 * What it missed is in its own second sentence. A terminal is about a
 * DIRECTORY — and the project on the wire is one: `projectPath`, an absolute
 * folder the host vouches for, which arrived in the protocol after that essay
 * was written. A module that is about a directory and ignores the one the
 * canvas names is not staying out of the canvas's business; it is running the
 * person's commands in whichever project they happened to look at last. That
 * was reported, in those words, and it is why the scope changed.
 *
 * `scope: 'epic'` is the protocol's word for "follows the reader": told which
 * subject is open, told again on every switch, re-pointed. This module now is
 * that, and a host that only re-points epic-scoped modes — which is what the
 * wire says a conforming host does — has to be told so, or it would be exactly
 * the module the report describes. What it does with the two halves of the
 * subject differs, and is written down in `src/view/sessions.ts`: the PROJECT
 * keys a shell, and a switch shows that project's session without touching
 * any other; the EPIC is deliberately not a key, because an epic is a unit of
 * work inside a folder rather than a folder, and a shell per epic would either
 * take a person away from a running command or leak a process per glance. The
 * original essay's fear — a shell reset because somebody switched epics —
 * cannot happen, because switching never closes anything.
 *
 * ## What is declared, and the longer list of what is not
 *
 * - **`uses: []`.** This module asks the host for nothing. Everything on screen
 *   is a pty on this machine, and there is no question a host could answer that
 *   would change what a shell does. A module that declared capabilities it never
 *   exercised would be asking for permission it had no use for. Following the
 *   project is READING the context, not asking for anything, and the protocol
 *   is explicit that reading a context is not a capability.
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
  modes: [{ id: 'terminal', label: 'Terminal', scope: 'epic' }],
  extensions: { emits: [], consumes: [] },
  declares: {
    protocol: `>=${PROTOCOL} <${PROTOCOL + 1}`,
    uses: [],
    storage: true,
    prompt: false,
  },
  health: '/healthz',
})
