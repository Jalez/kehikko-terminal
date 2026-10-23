#!/usr/bin/env bash
#
# The one name every module ships this under, so a host that offers to start one
# has a script to run rather than a command line to build.
#
#   - No arguments. A registration names a directory and one script inside it,
#     never a command line: a string a host handed to a shell would make a
#     registration file a place to write shell. That rule is general, and this
#     module is the one where breaking it would be worst.
#   - No port exported here, and no `--strictPort` behind it. This script used
#     to set `PORT="${PORT:-7920}"` and `vite.config.ts` read it back, which put
#     the number in two files and `register.ts` in a third. It is said once now,
#     beside the id, as `PREFERRED_PORT` in `manifest.ts`, and `serves()` in
#     `vite.config.ts` is what acts on it.
#
#     $PORT is still honoured — by the plugin rather than by this file — and for
#     the reason this bullet always gave: whoever starts this chose the port, and
#     a module that picked its own would answer somewhere nobody is looking. A
#     host passes the port from the registration when it spawns this script,
#     which is the address it is about to go and read.
#
#     What `strictPort` bought was a module that DIED on a taken port rather than
#     one answering quietly somewhere else, and that was the only honest option
#     while nothing handled a collision. It is a poor trade for this module in
#     particular: its registration carries `keep: true` so that nothing reaps a
#     terminal out from under a running command, and a module that refuses to
#     start is a module holding no shell at all. `serves()` handles the collision
#     — a free 7920 in silence, a clean exit rather than a second copy if this
#     module is already answering there, and otherwise a loud move with the
#     registration rewritten to the port actually bound. The fence in `shell.ts`
#     follows that port rather than assuming it; see `vite.config.ts`.
#   - `exec`, and the foreground. A script that forks and returns leaves whoever
#     started it holding a pid that stops nothing, and Stop is only ever offered
#     for what a host started.
#   - `cd` to this script's own directory, so the module runs beside its own
#     source however it was invoked.
#
# It does NOT register a module that had none. Registration is a deliberate act
# by a person — see `register.ts` — and a start script that quietly wrote into
# somebody's home directory would be doing it on their behalf, which is a
# sharper point here than anywhere else in the workspace because what gets framed
# is a shell. That argument is untouched. What the Vite plugin now writes on
# every start is this module's ADDRESS, which is a different sentence: the person
# decided to be framed, they did not decide to be framed at 7920 in particular,
# and a registration still naming a port this module has drifted off is one the
# host sweeps to find nothing. It MERGES, so the `keep: true` a person put beside
# the url survives the rewrite.
#
# ## What this process is, said plainly
#
# It serves a page, and it opens ptys running your login shell for that page.
# Anything you type in the container runs on this machine as you, with no sandbox
# between. The fence is in `shell.ts` and it is real, but it is a fence against
# OTHER PAGES — not against what you yourself type. Start this the way you would
# start a terminal emulator, because that is what it is.
#
# It binds to 127.0.0.1 and nothing else, set explicitly in `vite.config.ts`
# rather than left to a default. Do not put this behind a tunnel or a reverse
# proxy. A shell is not a thing to expose because it was convenient once.
#
# ## The built page, when it is this checkout's, and Vite otherwise
#
# There is a build now: `bun run build` compiles the page into `dist/` and
# stamps it with the commit (`dist/.kehikot-built`), and `serve.ts` serves it —
# the same doors, the same socket, a twentieth of the memory and none of the
# transforms on every load. A host builds an installed copy when it installs or
# updates it, at the tag; a start never builds, because a start that builds is
# a start that fails when the network is down.
#
# The old objection to a `dist` was the right one: a STALE page served with a
# 200 has every symptom of a working app and none of the changes, and that has
# cost this codebase whole afternoons. So the built page is served only when its
# stamp is the commit checked out here, which is checked below before anything
# is started. A checkout somebody edits has no stamp, or one of an older commit,
# and gets Vite as it always did; a build of an edited tree is never stamped.
# `serve.ts` refuses a stale build itself too (a 503 that says why), so even
# `bun run start` by hand cannot serve one.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

# Install when nothing is installed, AND whenever bun.lock or package.json is
# newer than the last install here, the same rule as the host's own run.sh. A
# pull that moves the protocol pin leaves the old package in node_modules, and
# a page that imports a name the old package does not have draws nothing.
# `--frozen-lockfile`, so a start installs exactly what bun.lock says and never
# rewrites it behind somebody's back. The stamp is written only after an
# install that succeeded.
INSTALLED=node_modules/.kehikot-installed
VITE_FORCE=
if [ ! -d node_modules ] || [ ! -f "$INSTALLED" ] || [ bun.lock -nt "$INSTALLED" ] || [ package.json -nt "$INSTALLED" ]; then
  echo "installing…" >&2
  if [ -f bun.lock ]; then
    bun install --frozen-lockfile >&2 || { echo "bun install --frozen-lockfile failed: bun.lock does not match package.json. Run \`bun install\` and commit bun.lock." >&2; exit 1; }
  else
    bun install >&2
  fi
  touch "$INSTALLED"
  # Rebuild Vite's pre-bundle rather than trust one made from the old packages.
  VITE_FORCE=--force
fi

# node-pty is native. If it is missing, every other part of this module works
# and only the terminal fails — a container that draws a chat list and then refuses
# to open a shell, with the reason in this log rather than on screen. Say so
# here, at start, where somebody can act on it.
if [ ! -d node_modules/node-pty ]; then
  echo "terminal: node-pty is not installed. Run 'bun install' first, or the container will list chats and open no shells." >&2
fi

# ---------------------------------------------------------------------------
# The executable bit on spawn-helper, which `bun install` does not preserve.
#
# On macOS node-pty does not exec your shell directly: it execs a small helper
# binary, `spawn-helper`, which sets up the tty and then execs the shell. The
# prebuilt helper ships in the tarball with mode 0755 — and arrives on disk as
# 0644, because the installer did not carry the bit across.
#
# The failure this produces is `posix_spawnp failed.` and nothing else. No
# missing-file error, because the file is right there; no permission error a
# person would recognise, because it surfaces as a spawn failure two layers
# down. Every fence passes, the ticket is accepted, the socket opens, and then
# no shell appears — which reads as "the terminal is broken" rather than "one
# file lost a permission bit". It cost this module an hour and it would cost it
# again on the next clean install, on any machine.
#
# So it is fixed here, on every start, rather than once by hand: `node_modules`
# is not committed, and the next `bun install` recreates the problem exactly.
# Cheap, idempotent, and it fails quietly if the layout ever changes — a chmod
# that finds nothing is not a reason to refuse to start.
for helper in node_modules/node-pty/prebuilds/*/spawn-helper node_modules/node-pty/build/Release/spawn-helper; do
  if [ -f "$helper" ] && [ ! -x "$helper" ]; then
    chmod +x "$helper" && echo "terminal: made $helper executable (bun install does not keep the bit)"
  fi
done

# The built page, when its stamp is this checkout's HEAD. Read here, in the
# shell, so choosing costs a `git rev-parse` and not a process. A build this
# checkout cannot vouch for falls through to Vite.
BUILT=
if [ -f dist/.kehikot-built ] && [ -f dist/index.html ]; then
  read -r BUILT < dist/.kehikot-built || true
fi
if [ -n "$BUILT" ] && [ "$BUILT" = "$(git rev-parse HEAD 2>/dev/null)" ]; then
  exec bun run serve.ts
fi
if [ -n "$BUILT" ]; then
  echo "terminal: dist/ is a build of ${BUILT:0:7}, not of this checkout, so Vite serves the page. \`bun run build\` would make it current." >&2
fi

exec bun run vite $VITE_FORCE
