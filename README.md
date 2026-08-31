# Terminal

A real terminal on this machine. Your shell, in a container, with nothing else in it.

Port **7920**. `roadmap.terminal`.

```bash
bun install
bun run register     # tell a host on this machine where this answers
./run.sh             # or: PORT=7920 ./run.sh
```

Then open <http://127.0.0.1:7920/app>, or put it on a kehikko.

---

## What this is

A pty on this machine with [xterm.js](https://xtermjs.org) in front of it — the
same two pieces a code editor's integrated terminal is built from. It opens
straight into your login shell. There is no picker, no list, and no chrome at
all while the shell is alive: the container is a terminal, and everything you might
want to do in it is a thing you type.

Nothing about being in a browser makes the emulation weaker. Full-screen
programs, colours, ctrl-C, arrow keys, `vim`: all of it works, because `xterm`
is a real emulator and the thing behind the socket is a real pty.

**It is not a transcript viewer.** That was tried, in the orchestrator, and the
person it was built for said they did not like what they could see or how they
could interact with it. A nicer read-only rendering is still read-only.

**It is not the orchestrator.** That module (port 7850) starts agents on
selected references and reads their transcripts off disk without attaching to
anything. The two are siblings and neither subsumes the other.

### What was here and is gone

A list of every Claude Code chat on the machine, down the left, with a press to
reopen one. It worked. It was cut, because everything it offered was already
reachable by typing — `claude --resume` is a command, and this is a terminal, so
the list was a menu standing in front of a keyboard.

`/api/chats` went with it, along with the reader that walked
`~/.claude/projects`. That is a small security improvement as well as a
deletion: it was the one door here that reported on somebody's own activity —
what they had been working on, and where — and it carried no ticket, on the
argument that a program running as this user could read that directory anyway.
The argument was true, and it is better not to have needed it.

If that list is wanted again, it belongs in its own module framed beside this
one, not as a sidebar inside it.

---

## The security argument, in full

The orchestrator module refused to build this and wrote down why
(`kehikko-orchestrator/transcript.ts`):

> A websocket that carries keystrokes into a shell is a shell on this machine
> reachable by anything that can reach this port — and loopback is a fence
> around the machine, not around the programs on it.

That sentence is true. It is not deleted here, and this module exists because of
what it leaves out. There are two attackers, and only one is real.

### A hostile web page in another tab

The one that matters, and the one that is actually stoppable:

| Fence | What it stops |
|---|---|
| `Origin` checked on upgrade | Browsers always send it and page JavaScript cannot forge it, so `https://evil.example` is refused outright. |
| `Host` checked on upgrade | DNS rebinding — a name that resolves to 127.0.0.1 would otherwise arrive with its own origin intact. |
| No CORS headers, anywhere | A cross-origin `fetch` may be sent but its response may not be read, so the ticket cannot be lifted out of the page. |
| A ticket in the page | Minted per process, printed into `/app`, required as the first frame. Nothing is spawned before it is checked. |
| `frame-ancestors` | Only this origin and the host may frame the page, so a live terminal cannot be embedded in a stranger's document. |
| Bound to 127.0.0.1 | Set explicitly in `vite.config.ts`, not left to a default. |

All six are measured, not asserted.

### A program already running as you

Loopback does not fence this one, exactly as the orchestrator says. But the
conclusion does not follow: **a process running as you can already run `claude`,
or `rm`, or anything else.** It does not need this port. This socket hands such
a program no privilege it did not already hold.

So the honest statement of the boundary is: this protects you from other pages,
not from software already running under your own account. Nothing at this layer
can. A desktop app with an IPC channel instead of a socket would move that same
boundary, not remove it — and it would stop this being a module on a canvas,
which is the entire point.

**Do not put this behind a tunnel or a reverse proxy.** A shell is not a thing
to expose because it was convenient once.

---

## Three bugs worth knowing about

All found by measuring. None visible to `tsc` or `bun test`.

### The careful prose was a crash

A WebSocket close reason is capped at **123 bytes**, and `ws` enforces it by
throwing — inside a message handler, where nothing catches it, so the throw
reaches the top and takes the whole process down.

The refusal sentences here are written to be read by a person, which makes them
long. The ticket refusal is 150 bytes. So sending a wrong ticket did not get you
refused: **it killed the server, for everybody, from an unauthenticated frame.**

Fixed in `sayable()`, which clips by *bytes* on a codepoint boundary — a
character count would have passed its own check and still thrown, because these
sentences contain `—` and `’` at three bytes each. The full sentence still goes
to the log; the socket gets the short form.

### `bun install` drops the executable bit

On macOS, `node-pty` does not exec your shell directly. It execs a helper binary,
`spawn-helper`, which sets up the tty first. The prebuilt helper ships mode 0755
and lands on disk as **0644**.

What that produces is `posix_spawnp failed.` and nothing else. No missing-file
error, because the file is there. No permission error anybody would recognise,
because it surfaces two layers down. Every fence passes, the ticket is accepted,
the socket opens — and then no shell appears, which reads as "the terminal is
broken" rather than "one file lost a permission bit".

`run.sh` chmods it on every start, because `node_modules` is not committed and
the next clean install recreates it exactly.

### A keystroke can be a space

Keystrokes were sent as bare text, with a leading space marking a resize frame.
But typing `" ls"` sends exactly that — it would have been read as a malformed
resize and swallowed, occasionally, with nothing in any log. There is no prefix
a keyboard cannot produce, so every frame is an envelope: `d` is data, `r` is a
resize, and anything else is dropped rather than typed.

---

## Measured

Against a raw `ws` client, which can send handshakes a browser refuses to
produce — a forged `Origin`, a missing one:

```
PASS  the page carries a ticket
PASS  an upgrade with no Origin is refused
PASS  an upgrade from another origin is refused
PASS  a rebound Host is refused even with a good Origin
PASS  a good origin with a wrong ticket spawns nothing        (code 4403)
PASS  a socket that never speaks is closed                    (code 4408)
PASS  a shell runs and answers                                (422 bytes back)
PASS  a keystroke that begins with a space is not eaten
PASS  a resize reaches the program inside the pty             (tput cols -> 132)
```

In a real browser:

```
PASS  xterm mounted with no picking first
PASS  no chrome while the shell is alive                      (0 buttons)
PASS  the chats door is gone                                  (404)
PASS  a prompt was drawn immediately
PASS  typing reached the shell and it answered                (expr 6 \* 7 -> 42)
PASS  the terminal fills the container                             (99% of height)
PASS  no horizontal page overflow at 220/280/320/400/1200px
PASS  a dead shell offers a new one, and it really starts
```

The process group really dies with the socket — a backgrounded `sleep` started
in the container was gone from `pgrep` after the socket closed.

`bun run typecheck` clean. `bun test` 15 pass.

```
curl -sI -H 'Origin: https://evil.example' /app | grep -i access-control
  (prints nothing)
```

## Not verified

- **Framed by the real host on 4181.** The module is registered and reports
  `ready`, and it was framed from its own origin and greeted by a probe speaking
  the protocol — but no canvas has held it through a working session.
- **Anything but macOS + arm64.** The `spawn-helper` chmod covers Linux prebuild
  layouts too, but only darwin-arm64 has been run.
