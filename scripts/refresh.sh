#!/usr/bin/env bash
# The daily refresh on this machine (home B): fetch the NAVs, then build the site into dist/.
# Meant for cron, weekdays at 09:15 Madrid time (README, "Keeping it current"):
#   15 9 * * 1-5 cd /path/to/portfolio-tracker && scripts/refresh.sh
# Appends one line per step to var/refresh.log (the time, what the step printed last, its exit code);
# the whole output of the latest run is in var/refresh-last.log. Never touches git.
# Exits non-zero when the snapshot run failed (the previous prices are kept, and the page built
# from them says "run failed") or when the build failed.
set -u

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root" || exit 2
# cron starts with a bare PATH; node and npm usually live in one of these.
export PATH="$PATH:/usr/local/bin:/usr/bin:/bin"
mkdir -p var
log=var/refresh.log
out=var/refresh-last.log

stamp() { date '+%Y-%m-%d %H:%M:%S %z'; }
note() { printf '%s %s\n' "$(stamp)" "$1" >> "$log"; }

# One run at a time: a second one started while the first is still going stops at once.
if command -v flock > /dev/null; then
  exec 9> var/refresh.lock
  if ! flock -n 9; then
    note "refresh: another run is in progress, nothing done (exit 1)"
    exit 1
  fi
fi

: > "$out"

npm run --silent snapshots >> "$out" 2>&1
snap=$?
summary="$(grep -E '^(Wrote |snapshot failed: )' "$out" | tail -n 1)"
note "snapshots: ${summary:-no summary line, see $out} (exit $snap)"

# Built even after a failed snapshot run, so the local page shows the failure instead of hiding it.
npm run --silent build >> "$out" 2>&1
build=$?
note "build: dist/ $([ "$build" -eq 0 ] && echo rebuilt || echo 'NOT rebuilt, see '"$out") (exit $build)"

if [ "$snap" -ne 0 ]; then exit "$snap"; fi
exit "$build"
