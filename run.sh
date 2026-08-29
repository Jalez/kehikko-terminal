#!/usr/bin/env bash
#
# The one name every module ships this under, so a host that offers to start one
# has a script to run rather than a command line to build.
#
#   - No arguments. A registration names a directory and one script inside it,
#     never a command line: a string a host handed to a shell would make a
#     registration file a place to write shell. That rule is general, and this
#     module is the one where breaking it would be worst.
#   - $PORT from the environment. Whoever starts this chose the port; a script
#     that picked its own would answer somewhere nobody is looking. 7920 is the
#     default and the number in the registration — 7820, 7830, 7840, 7850,
#     7860, 7870, 7890, 7900 and 7910 are taken by the other modules here.
#   - `exec`, and the foreground. A script that forks and returns leaves whoever
#     started it holding a pid that stops nothing, and Stop is only ever offered
#     for what a host started.
#   - `cd` to this script's own directory, so the module runs beside its own
#     source however it was invoked.
#
# It does NOT register. Registration is a deliberate act by a person — see
# `register.ts` — and a start script that quietly wrote into somebody's home
# directory would be doing it on their behalf.
#
# ## What this process is, said plainly
#
# It serves a page, and it opens ptys running your login shell for that page.
# Anything you type in the pane runs on this machine as you, with no sandbox
# between. The fence is in `shell.ts` and it is real, but it is a fence against
# OTHER PAGES — not against what you yourself type. Start this the way you would
# start a terminal emulator, because that is what it is.
#
# It binds to 127.0.0.1 and nothing else, set explicitly in `vite.config.ts`
# rather than left to a default. Do not put this behind a tunnel or a reverse
# proxy. A shell is not a thing to expose because it was convenient once.
#
# ## There is no build here, and no `dist`
#
# There was going to be. The argument for one is that starting should be
# starting: a start that shells out to a build is a start that fails when the
# network is down. The argument is fine and the shape is still wrong, because
# this program is not deployed — it runs on the machine of the person editing
# it. What `dist` actually buys is a STALE page served with a 200, every symptom
# of a working app and none of the changes, and that failure has cost this
# codebase whole afternoons three separate times in three different programs. A
# missing build announces itself. A stale one does not.
#
# There is also no `build` script in `package.json`, deliberately. Six modules
# in this workspace carry a `"build": "vite build"` that cannot succeed because
# the page is generated per request and there is no `index.html`. A script that
# always fails invites somebody to "fix" it by undoing the paragraph above.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

export PORT="${PORT:-7920}"

# node-pty is native. If it is missing, every other part of this module works
# and only the terminal fails — a pane that draws a chat list and then refuses
# to open a shell, with the reason in this log rather than on screen. Say so
# here, at start, where somebody can act on it.
if [ ! -d node_modules/node-pty ]; then
  echo "terminal: node-pty is not installed. Run 'bun install' first, or the pane will list chats and open no shells." >&2
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

exec bun run vite
