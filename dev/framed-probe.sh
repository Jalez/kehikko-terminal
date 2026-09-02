#!/bin/sh
#
# Frame this module in a real WKWebView the way the host frames it, and read
# what the module's own trace says about its frames while it is framed.
#
# This is the instrument behind `src/view/frames.ts`. It exists because the
# report "it stops showing what I type until I switch apps" turned out to be
# WebKit serving the module's iframe one animation frame every ten seconds
# while the page said it was visible — a thing no browser on this machine
# reproduces and only the desktop shell's WKWebView shows. So the window is
# the shell's own probe (`kehikko-desktop/src-tauri/examples/webkit-probe.rs`,
# `cargo build --example webkit-probe`), the page it visits is
# `dev/framed-like-the-host.html`, and the answer is read with `curl` from a
# SECOND copy of this module running on port 7925.
#
# Why a second copy, and why it must NOT be started with `bun run dev`:
# `serves()` in `vite.config.ts` registers whichever port it binds as
# `roadmap.terminal`, and whoever registers last wins — so a probe copy
# started the ordinary way re-points the host at itself and takes the live
# terminal, with everybody's shells in it, off the canvas. Start it with a
# config that leaves `serves()` out and a fixed port instead:
#
#     sed 's/serves({ id: ID, prefer: PREFERRED_PORT }), //' vite.config.ts > vite.probe.config.ts
#     ROADMAP_ORIGIN=http://127.0.0.1:7926 \
#       ./node_modules/.bin/vite --config vite.probe.config.ts --host 127.0.0.1 --port 7925 --strictPort
#
# `ROADMAP_ORIGIN` is the page that will frame it: `/app` sends a
# `frame-ancestors` policy naming the host, and the test page is not the host.
# Serve the test page from this directory on that port:
#
#     (cd dev && python3 -m http.server 7926 --bind 127.0.0.1)
#
# Then, from anywhere:
#
#     dev/framed-probe.sh 40 'http://127.0.0.1:7926/framed-like-the-host.html?plain=1'
#     dev/framed-probe.sh 40 'http://127.0.0.1:7926/framed-like-the-host.html'
#     dev/framed-probe.sh 40 'http://127.0.0.1:7926/framed-like-the-host.html?away=1&wiggle=2000'
#
# The first argument is how many seconds the window is held open. Every five
# seconds a line prints what the framed module reports about itself: `frames`
# is animation frames the WINDOW served (the probe asks the real function, not
# the fallback), `driven` is draws the fallback made because the window had
# not, `renders` is what xterm put on screen, `onScreen` is what the browser's
# IntersectionObserver says. A healthy window reads frames +1 per second,
# worstFrameWait in the tens of milliseconds, driven flat. The `?away=1` page
# reads frames +1 per ten seconds, worstTimerLag 1000, driven climbing — and
# renders flat, because xterm pauses its own renderer while its observer says
# it is off screen, which off screen it is. The README has the runs.
#
# Stop both servers by the pids you started them with. Never by pattern: the
# live module and the host are Vite processes too.

HOLD=${1:-40}
URL=${2:-'http://127.0.0.1:7926/framed-like-the-host.html'}
DESKTOP=${KEHIKKO_DESKTOP:-"$(dirname "$0")/../../kehikko-desktop"}
PROBE="$DESKTOP/src-tauri/target/debug/examples/webkit-probe"
if [ ! -x "$PROBE" ]; then
  echo "no probe at $PROBE — cd $DESKTOP/src-tauri && cargo build --example webkit-probe" >&2
  exit 2
fi
SCRIPT=$(mktemp)
printf '(() => {})()\n' > "$SCRIPT"

cd "$DESKTOP/src-tauri" || exit 1
PROBE_HOLD=$HOLD "$PROBE" --script "$SCRIPT" "$URL" > /tmp/framed-probe.log 2>&1 &
P=$!
i=0
while kill -0 "$P" 2>/dev/null; do
  sleep 5
  i=$((i+5))
  printf '%3ss  ' "$i"
  curl -s '127.0.0.1:7925/api/trace?json' | python3 -c '
import json, sys
d = json.load(sys.stdin)
s = d.get("page") or {}
print({k: s.get(k) for k in ("up", "frames", "frameWaiting", "worstFrameWait", "worstTimerLag", "visibility", "renders", "driven", "onScreen")})
' 2>/dev/null || echo '(no trace on 7925)'
done
rm -f "$SCRIPT"
echo '--- what the page noted ---'
curl -s 127.0.0.1:7925/api/trace | grep -E 'animation frame|became|timer was|screen|focus' | tail -12
