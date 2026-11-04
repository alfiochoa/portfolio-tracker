#!/bin/bash
# Memory guard: kill a test-browser helper that grows past a limit, before it takes the machine down.
#
# Why it exists: on 2026-10-09 two WebKit helpers of a Playwright run on a 32 GB Mac reached 29 GB and
# 24 GB. macOS ran out of memory, killed a dozen system services, and WindowServer (the process that
# draws the screen) aborted, which threw the owner to the login screen with every window gone.
#
# This watches every process that runs from Playwright's browser cache (~/Library/Caches/ms-playwright:
# WebKit's GPU, WebContent and Networking helpers, Chromium's helpers) and kills one the moment it is
# over the limit. To the test that was using it, that is a browser crash: the test fails and is rerun.
# Nothing else on the machine is touched.
#
# It also watches WindowServer on macOS. Browsers left alive by an interrupted run keep their hidden
# windows' drawing memory there. When WindowServer's footprint passes a second limit, every Playwright
# browser on the machine is killed: the runs in flight fail, and the screen survives. What WindowServer
# already holds when the guard starts is not growth (it stays until the owner logs out), so the second
# limit is the one given or 2 GB above the footprint at the start, whichever is higher.
#
# Turned on with MEMORY_GUARD="yes" in scripts/team.conf; `scripts/team.sh awake` then runs it in the
# Awake tab and `recover` starts it again if it is gone. Kills are listed in .team/status/memory-guard.log.
#
# usage: scripts/memory-guard.sh [limit-in-GB] [windowserver-limit-in-GB]   (defaults 6 and 6)

LIMIT_GB="${1:-6}"
WS_LIMIT_GB="${2:-6}"
WS_LIMIT_MB=$((WS_LIMIT_GB * 1024))
LIMIT_KB=$((LIMIT_GB * 1024 * 1024))
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(dirname "$(git -C "$HERE" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" 2>/dev/null)"
[ -n "$REPO" ] && [ "$REPO" != . ] || REPO="$(dirname "$HERE")"
LOG="$REPO/.team/status/memory-guard.log"
mkdir -p "$(dirname "$LOG")"

# WindowServer's footprint in MB, as top's MEM column shows it (e.g. 2906M, 34G). Not `ps`'s RSS: the
# drawing memory the windows leave behind is graphics memory, which RSS does not count.
ws_mb() {
  local pid mem
  pid="$(pgrep -x WindowServer 2>/dev/null | head -1)"
  [ -n "$pid" ] || return
  mem="$(top -l 1 -pid "$pid" -stats mem 2>/dev/null | tail -1 | tr -d ' +-')"
  case "$mem" in
    *G) awk -v v="${mem%G}" 'BEGIN { printf "%d", v * 1024 }' ;;
    *M) awk -v v="${mem%M}" 'BEGIN { printf "%d", v }' ;;
    *K) echo 0 ;;
  esac
}

WS_BASE_MB="$(ws_mb)"
if [ -n "$WS_BASE_MB" ] && [ $((WS_BASE_MB + 2048)) -gt "$WS_LIMIT_MB" ]; then
  WS_LIMIT_MB=$((WS_BASE_MB + 2048))
  WS_LIMIT_GB="$(awk -v v="$WS_LIMIT_MB" 'BEGIN { printf "%.1f", v / 1024 }') (WindowServer already held ${WS_BASE_MB} MB at the start; this is 2 GB above it)"
fi

echo "Memory guard: a test-browser helper over ${LIMIT_GB} GB is killed, so a leak cannot take the screen down."
[ -z "$WS_BASE_MB" ] || echo "If WindowServer passes ${WS_LIMIT_GB} GB, every Playwright browser is killed."
echo "Kills are listed here and in $LOG. Ctrl+C stops it."
echo

tick=0
while :; do
  tick=$((tick + 1))
  # Every 30 s: WindowServer (macOS only). Over its limit, kill every Playwright browser process.
  if [ -n "$WS_BASE_MB" ] && [ $((tick % 3)) -eq 1 ]; then
    mb="$(ws_mb)"
    if [ -n "$mb" ] && [ "$mb" -gt "$WS_LIMIT_MB" ]; then
      pids="$(ps -Axo pid=,comm= | awk '$2 ~ /ms-playwright/ { print $1 }')"
      n="$(echo "$pids" | grep -c . || true)"
      [ -n "$pids" ] && echo "$pids" | xargs kill -9 2>/dev/null
      line="$(date '+%Y-%m-%d %H:%M:%S')  WindowServer at ${mb} MB: killed ${n} Playwright browser processes"
      echo "$line"
      echo "$line" >>"$LOG"
    fi
  fi
  # pid, resident KB, command path; only Playwright's browser helpers, only over the limit
  ps -Axo pid=,rss=,comm= | awk -v lim="$LIMIT_KB" '$2 > lim && $3 ~ /ms-playwright/ { print $1, $2, $3 }' |
    while read -r pid kb path; do
      gb="$(awk -v kb="$kb" 'BEGIN { printf "%.1f", kb / 1048576 }')"
      name="${path##*/}"
      if kill -9 "$pid" 2>/dev/null; then
        line="$(date '+%Y-%m-%d %H:%M:%S')  killed pid $pid at ${gb} GB  $name"
      else
        line="$(date '+%Y-%m-%d %H:%M:%S')  could not kill pid $pid at ${gb} GB  $name"
      fi
      echo "$line"
      echo "$line" >>"$LOG"
    done
  sleep 10
done
