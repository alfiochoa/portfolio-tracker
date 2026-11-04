#!/usr/bin/env bash
# Watchdog for the architect. Run it in the background whenever work is in flight; when nothing is (a paused
# team, everything waiting on the owner), run none. It ends only when the architect is needed:
#   - an agent is blocked on a question or approval prompt
#   - work is in flight and nobody on the team has been working for QUIET_MINUTES (default 10)
#   - no team agent is running
#   - the safety ceiling: MAX_MINUTES have passed (default 1440, a day)
# Ctrl-C or a TERM stops it too. It checks once a minute; when it ends it prints one line with the reason,
# then the agent states, the last reports and the head of the board. No model calls.
#
# Work in flight (one definition, in scripts/teamlib.py's in_flight()): a task row on .team/board.md has a
# State starting with assigned, ready, building, review, verifying, changes requested, design pass, running or
# in progress. Quiet minutes count only while work is in flight: a quiet team with nothing in flight is a team
# at rest, not a stall.
#
# Every minute it writes a heartbeat, .team/status/watch.json (pid, start, last beat, quiet minutes, what is in
# flight); scripts/team-dash.py shows it as "watchdog: alive 2h 10m". When it ends, the file keeps the reason.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The team folder lives in the main checkout; teamlib finds it from any worktree.
{ read -r TEAM; read -r STATUS; read -r WATCH_FILE; } < <(python3 "$HERE/teamlib.py" where)
WATCH_FILE="${TEAM_WATCH_FILE:-$WATCH_FILE}" # a test run writes elsewhere; the real one never sets it
QUIET_LIMIT="${QUIET_MINUTES:-10}"
MAX="${MAX_MINUTES:-1440}"

[ "${HERDR_ENV:-}" = 1 ] || { echo "team-watch: not inside a Herdr pane" >&2; exit 1; }
[ -n "${TEAM:-}" ] && [ -n "${WATCH_FILE:-}" ] || { echo "team-watch: cannot find the team folder" >&2; exit 1; }
mkdir -p "$(dirname "$WATCH_FILE")"

PREFIX=""
# shellcheck source=/dev/null
[ -f "$HERE/team.conf" ] && . "$HERE/team.conf"
# The workers' Herdr names: every role on this machine's roster but the architect, with the team's prefix.
ROSTER_FILE="$(python3 -c 'import sys; sys.path.insert(0, sys.argv[1]); import teamlib; print(teamlib.roster_file())' "$HERE")"
NAMES="$(grep -v '^#' "$ROSTER_FILE" | cut -d'|' -f1 | grep -v '^architect$' | grep . | sed "s/^/${PREFIX:+$PREFIX-}/" | tr '\n' ' ')"

started="$(date +%s)"
quiet=0        # whole minutes since the team went quiet with work in flight
quiet_since="" # when it did
states=""
reason=""
ended=""
flight=""

beat() { # beat [ended reason]: write the heartbeat, atomically
  local tmp="$WATCH_FILE.$$.tmp"
  jq -n --argjson pid $$ --argjson started "$started" --argjson beat "$(date +%s)" \
    --argjson quiet "$quiet" --argjson limit "$QUIET_LIMIT" --argjson max "$MAX" \
    --arg flight "$flight" --arg ended "${1:-}" '
    {pid: $pid, started_at: $started, beat_at: $beat, quiet_minutes: $quiet, quiet_limit: $limit,
     max_minutes: $max, in_flight: $flight}
    + (if $ended == "" then {} else {ended: $ended, ended_at: $beat} end)' >"$tmp" 2>/dev/null \
    && mv "$tmp" "$WATCH_FILE" || rm -f "$tmp"
}

sleeper=""
stopped() { # Ctrl-C or TERM: say so in the heartbeat, then go
  [ -n "$sleeper" ] && kill "$sleeper" 2>/dev/null
  beat "stopped"
  echo "team-watch: stopped (Ctrl-C or TERM)"
  exit 130
}
trap stopped INT TERM

while :; do
  if json="$(herdr agent list 2>/dev/null)"; then
    states="$(jq -r --arg names "$NAMES" --arg px "${PREFIX:+$PREFIX-}" '
      ($names | split(" ")) as $n
      | .result.agents[]
      | select(.name != null and (.name as $x | $n | index($x)))
      | "\(.name | ltrimstr($px))=\(.agent_status)"' <<<"$json")"
    if [ -z "$states" ]; then reason="no team agents are running"; ended="no team agent running"; break; fi
    if grep -q '=blocked' <<<"$states"; then reason="an agent is blocked on a prompt"; ended="an agent is blocked"; break; fi
    flight="$(python3 "$HERE/teamlib.py" in-flight 2>/dev/null)"
    if grep -q '=working' <<<"$states" || [ -z "$flight" ]; then
      quiet=0; quiet_since=""
    else
      quiet_since="${quiet_since:-$(date +%s)}"
      quiet=$(( ($(date +%s) - quiet_since) / 60 ))
    fi
    if [ "$quiet" -ge "$QUIET_LIMIT" ]; then
      reason="work is in flight and nobody has been working for $QUIET_LIMIT minutes ($flight)"
      ended="quiet $QUIET_LIMIT min with work in flight"
      break
    fi
  fi
  if [ $(( $(date +%s) - started )) -ge $((MAX * 60)) ]; then
    reason="the safety ceiling: $MAX minutes have passed"; ended="the $MAX-minute ceiling"; break
  fi
  beat
  sleep 60 & sleeper=$!
  wait "$sleeper"
  sleeper=""
done

trap - INT TERM
beat "$ended"
echo "team-watch: $reason"
echo "$states"
if [ -f "$TEAM/reports.log" ]; then echo; echo "--- last reports ---"; tail -5 "$TEAM/reports.log"; fi
if [ -f "$TEAM/board.md" ]; then echo; echo "--- board ---"; head -60 "$TEAM/board.md"; fi
