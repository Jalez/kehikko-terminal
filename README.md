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

## The terminal froze. It is stuck, hung, frozen, not responding, not updating

Run this. It works while the terminal in front of you is still stuck, and it
does not need the frozen container to cooperate:

```bash
curl -s 127.0.0.1:7920/api/trace
```

That prints what every layer of this module was doing in the seconds before you
ran it. Read the first block downwards and **stop at the first line whose
freshness is old** — the freeze is between that line and the one above it.

```
terminal — trace at 2026-09-02T09:11:12.345Z, this process up 41m12s

the layers, newest first. read down until the freshness stops.
  page       last said something 0.8s ago (1204 times)
             frames: 900 landed, last 22.0s ago, worst wait 22.0s; 38 drawn without waiting for one
             *** a requested animation frame has been outstanding for 22.0s. The window is not serving this frame's animation frames.
                 document.visibilityState is "visible" — a visible frame served one animation frame every
                 ten seconds is WebKit throttling it as "outside the viewport"; see src/view/frames.ts.
                 The rows are drawn anyway if "drawn without waiting" above keeps climbing. If it does not, the fallback in frames.ts is not running.
             worst timer lag 30ms, visibility visible, up 41m01s
             on screen: 100% of this frame, as the browser's own IntersectionObserver sees it; window focus yes; 1180×620
             xterm: 40 writes, 31 renders, last render 0.1s ago
             received 7.9 KB in 40 messages, 12 keystrokes, 0 buffered
             live now: 1 view, 1 emulator, 1 socket, 1 observer  (ever: 3/2 views, 3/2 emulators, 3/2 sockets)
  transport  1 open, 3 opened, 2 closed, 0 refused
             this module has attached 1 time; the server carries 2 upgrade listeners in all
  server     ticked 2472 times, last 0.4s ago, worst lag 3ms, rss 145.2 MB
  shells     1 live, 3 spawned, 2 exited, 0 would not start

every shell this process has held, newest first
  #3  pid 51234  132x40  live for 4.1s
      in /Users/you/Projects/thing
      pty -> page   812 B in 9 chunks, last 0.2s ago
      page -> pty   14 B in 7 frames, last 1.1s ago
      socket        open, buffered 0 B (high 0 B), 9 sends, 0 dropped

the last 37 things that happened, oldest first
  09:10:48.9  page    somebody pressed New shell
  09:10:49.0  pty     #3 a shell started, pid 51234, 132x40, in /Users/you/Projects/thing
  09:10:51.9  page    an animation frame took 22.0s to arrive; the page was visible for it
  ...
```

### What each answer means

| What the report says | Which layer stopped | Where to go next |
|---|---|---|
| `page has never reported` | The container is not open, or its JavaScript died before it could speak once | Is the module framed at all? Look for an error in the host's console |
| `page last said something 40s ago` | The **page entirely** — main thread wedged, or the frame was torn out | The page, not this module's server. Nothing here will help |
| `an animation frame has been outstanding for 22.0s` and beacons still arriving | The **window's animation frames**, for this frame. The page runs; xterm's draw waits for a frame that is not coming | If `visibilityState` is `hidden`, that is allowed. If `visible` and frames land about every ten seconds, WebKit is throttling this iframe as "outside the viewport" — the fourth report, below. `drawn without waiting` should be climbing; if it is, the rows are on screen regardless and this line is the window's condition, not a freeze. If it is not, `src/view/frames.ts` is not running |
| `writes` climbing while `renders` does not | xterm parsed it and never drew it | If `on screen` says 0%, xterm has paused its own renderer because the browser told it the terminal is off screen. If it says 100%, the write path and the render path are different things and the render path is where to look |
| `the send buffer is not draining` | The **transport**. Open at this end, dead at the other | The socket. A half-open websocket is this workspace's recurring shape |
| `pty -> page … last 40.0s ago` while everything above is fresh | The **shell**. It is blocked, or genuinely printing nothing | `ps` the pid the report prints |
| `the heartbeat is stale` | This **server**'s event loop is not turning | This process. Nothing above it is at fault |
| `more than one of something is live` | Something **accumulated** across a remount | An emulator, socket or observer that a `New shell` press left behind |
| `this module attached to the server more than once` | Two terminal handlers racing for one handshake | An HMR reload of the Vite plugin. Restart the module |

`curl -s '127.0.0.1:7920/api/trace?json'` gives the same numbers as JSON.

### What it costs when nothing is wrong

One `setInterval` at 1Hz in the server and one in the page; one animation frame
per second (not a rAF loop — see the essay in `src/view/trace.ts`); one ~0.5 KB
`fetch` to loopback every two seconds while a container is open; one
`IntersectionObserver` that fires only when the frame leaves the screen or comes
back. On the hot paths — a chunk out of the pty, a keystroke in, a message into
the page — two integer increments and no allocation. Buffers are bounded at 400
events and 12 shells, so the tracer cannot become the leak it was built to find.

The fallback in `src/view/frames.ts` costs one one-shot timer per animation
frame something asked for, cancelled the moment the frame lands. Nothing asks
for a frame while the terminal is sitting still, so it is zero then.

---

## The fourth report, and what the trace said

"The problem where it just stops showing what I write is still occurring. It
seems to show what I wrote whenever I swap to another full screen app." This
time the trace above was running on the page in front of the person, so instead
of reasoning from the sentence it could be read:

```
  page       last said something 0.9s ago (10398 times)
             frames: 92 landed, last 0.6s ago, worst wait 9.4s
             worst timer lag 1.2s, visibility visible, up 15m21s
             xterm: 65 writes, 9 renders, last render 10.6s ago
             received 22.6 KB in 65 messages, 108 keystrokes, 0 buffered
  14:31:09.452  page    the page loaded
  14:31:18.958  page    the page's own timer was 1.0s late; something held the main thread
  14:31:19.517  page    an animation frame took 9.1s to arrive; the page was visible for it
  14:31:29.516  page    an animation frame took 8.6s to arrive; the page was visible for it
  … one of those every ten seconds, and a 1.0s-late timer about every fifth tick, for fifteen minutes
```

Not the `hidden` case the desktop shell fixed — the page said `visible` the
whole time and nothing in the ring said otherwise. The window was serving this
frame **one animation frame every ten seconds**, and its repeating timers were
landing on a **one-second grid**. Those are two named constants in WebKit,
`AggressiveThrottlingAnimationInterval` and `hiddenPageAlignmentInterval`, and
they are applied together by exactly one function,
`LocalFrameView::updateScriptedAnimationsAndTimersThrottlingState`, to a
**subframe** whose visible rect WebKit has computed as empty
(`ThrottlingReason::OutsideViewport`). Nothing else in WebKit makes a ten-second
frame. This module is a subframe.

xterm draws rows only inside an animation frame, so every keystroke's echo
waited for the next ten-second tick, and a window-level event that forced a
rendering update showed the backlog — which is the sentence.

### Measured, in the desktop shell's own WKWebView

`dev/framed-like-the-host.html` frames a second copy of this module the way the
host does — one flat layer inside a scrolling `<main>`, an `overflow: hidden`
wrapper moved into place by a CSS transform — with each part of that switchable
from the query string. `dev/framed-probe.sh` opens it in
`kehikko-desktop`'s `webkit-probe` window and reads the framed copy's trace
every five seconds. The same probe was also pointed at the real host on 4181,
framing the real module on 7920. macOS 15, Tauri 2 / wry 0.55, 2026-09-02:

```
page                                         frames/s   worst wait   timer lag   renders
?plain=1  a bare iframe, the control            1.0         27ms         28ms      —
the host's shape                                1.0         27ms         21ms      —
the host's shape, --fullscreen                  1.0          2ms         21ms      —
the host's shape, ?down=300 (canvas scrolled)   1.0          2ms         21ms      —
the host's shape, ?late=800 (sized late)        1.0          2ms         21ms      —
the host's shape, another app in front          1.0         17ms         21ms      —
the host's shape, window off screen             1.0         21ms       1002ms      —
the REAL host on 4181, the REAL module on 7920  1.0         16ms         39ms      —
   …while, in the same trace, the person's own
   page in their own window read:               0.1       10021ms      1203ms     14
?away=1 the frame genuinely off screen          0.1        8959ms      1001ms      1
```

The last line is the control for the diagnosis: put the frame where WebKit is
*right* to call it outside the viewport and the trace reads exactly what the
person's page read. The line above it is the finding: the same host framing the
same module in a fresh window built by the same shell is not throttled, so the
cause is something the person's window — open for thirty-five hours by then —
had been put into, and not the page, the module, or the host's layout. What
puts a window into that state was not found; none of the states the probe can
drive produce it. That is the shell's or WebKit's to chase, and the trace now
prints what is needed to chase it: the ratio the browser's own
`IntersectionObserver` gives for the frame, beside the frame wait.

### What the module does about it

`src/view/frames.ts`. WebKit throttles this document's animation-frame
callbacks and its nested timers, not the page's rendering update — the page
was painting, which is why the backlog appeared at all. So the window's
`requestAnimationFrame` is replaced with one that asks for the real frame *and*
arms a one-shot timer, and draws from whichever comes first, once. A one-shot
timer from an event handler is nesting level one and is not on the one-second
grid; a repeating one would be, which is why it is not a loop. Every draw made
that way is counted and printed as `drawn without waiting for one`.

Against the `?away=1` page, which is the one arrangement in which WebKit
provably applies the throttle, with the wrapper resized every two seconds so
xterm keeps asking for renders:

```
                              before frames.ts          after
frames (window-served)        4 in 45s                  4 in 45s     <- the probe still asks the real window
worst frame wait              8959ms                    8911ms
timer lag                     1001ms                    1002ms
drawn without waiting         —                         25 in 45s    <- the fallback runs, on time
renders                       1                         1
```

`renders` stays at 1 in both columns, and that is xterm, not the fallback:
`RenderService` pauses itself while its own `IntersectionObserver` reports the
screen off screen, which in this arrangement it is. In the person's window it
was not — their ten-second frames did render, nine of them — so there the
fallback reaches `renderRows`. That last step is the one thing this bench
cannot show, and it is listed under "Not verified".

---

### What it does not record

**Not the contents of your terminal.** Sizes, counts, timings, pids and the
directory each shell opened in — nothing that was typed and nothing that was
printed. `TERMINAL_TRACE_BYTES=1` turns on a 60-byte-per-chunk content trace for
the case where a freeze turns out to be an escape sequence the emulator choked
on; it is off, it is deliberate to set, and every report says loudly while it is
on.

`GET /api/trace` carries no ticket, because the one command a person runs while
their terminal is stuck has to work when the page holding the ticket is the
frozen half. `POST /api/trace/page` — how the page reports itself — does carry
it. The argument for that asymmetry is written out in `doors.ts`.

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

`bun run typecheck` clean. `bun test` 46 pass.

The trace, against a real running module and a real shell (`node dev/trace-probe.mjs 7920`):

```
PASS  a shell was spawned and its pid recorded
PASS  the pty produced bytes and the trace counted them
PASS  every one of them was handed to the socket
PASS  the page half of the count matches what arrived here
PASS  what was typed was counted going in
PASS  the resize reached the record
PASS  the socket is reported open and drained
PASS  one shell is live
PASS  this module attached to the server exactly once
PASS  the server heartbeat is turning
PASS  the counts came back down when the socket closed
```

```
curl -sI -H 'Origin: https://evil.example' /app | grep -i access-control
  (prints nothing)
```

## Not verified

- **Framed by the real host on 4181.** The module is registered and reports
  `ready`, and it was framed from its own origin and greeted by a probe speaking
  the protocol — but no canvas has held it through a working session.
- **The fallback drawing rows in the window that had the bug.** It was measured
  running under WebKit's real throttle (`?away=1`, above), and the throttled
  frames in the person's window were measured rendering, so the two halves are
  each measured and the join is not: no window with the bug in it has run
  `frames.ts` yet. When the module is next restarted on 7920 the trace will
  say — `drawn without waiting` climbing beside a frame wait near ten seconds,
  and `renders` climbing with it, is the join.
- **What puts a window into that state.** Every state the probe can drive was
  tried and none reproduced it; see the table above. The person's window had
  been open for thirty-five hours and the page loaded into it two seconds after
  the host restarted, already throttled. The `on screen` ratio now printed by
  the trace is what to read first next time: if the browser's own observer
  says 100% while frames come every ten seconds, that is WebKit disagreeing
  with itself about one frame, in numbers a WebKit bug report can carry.
- **The page half in the desktop shell.** The rAF probe and the beacon are
  exercised under `happy-dom`, which cannot stop serving frames. WKWebView can,
  and `dev/framed-probe.sh` is the instrument for that;
  `dev/frozen-while-backgrounded.js` for the older `hidden` case.
- **Anything but macOS + arm64.** The `spawn-helper` chmod covers Linux prebuild
  layouts too, but only darwin-arm64 has been run.
