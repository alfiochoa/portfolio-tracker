#!/usr/bin/env bash
# The agent team: build the Herdr layout, start agents, pass work between them.
# Protocol: docs/team/README.md. Runs inside a Herdr pane (`recover` also runs outside one).
# From agent-team-kit. The project's own choices are in scripts/team.conf and scripts/roster.conf.
set -euo pipefail

# `recover` may be started by a service whose environment has no herdr or claude on its path.
if [ "${1:-}" = recover ]; then export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"; fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The main checkout, even when this runs from a worktree.
REPO="$(dirname "$(git -C "$HERE" rev-parse --path-format=absolute --git-common-dir)")"
WORKTREES="${REPO}-worktrees"
TEAM="$REPO/.team"
WAIT_MS="${TEAM_WAIT_MS:-7000000}"

die() { echo "team.sh: $*" >&2; exit 1; }

# --- the project's settings (scripts/team.conf, written by agent-team-kit/install.sh) ------------------
PROJECT="" PREFIX="" OWNER="" BRANCH="" PERMISSION_MODE="" ACCEPT_FOLDER_TRUST="no" MEMORY_GUARD="no" REMOTE_CONTROL="no"
PARTNER="" PARTNER_DIR="partner-team" PARTNER_LABELS=""
FALLBACK_MODEL="claude-opus-5-5" FALLBACK_EFFORT="xhigh" # team.conf may change them; FALLBACK_MODEL="" turns it off
# Task tiers (off unless TASK_TIERS="yes"): the brief's "Tier: light|standard|heavy" picks the worker's model and
# effort for that task only. Standard is the roster's.
TASK_TIERS="no" TIER_LIGHT="claude-sonnet-5-5|high" TIER_HEAVY="claude-opus-5-5|xhigh"
VIEWS_EXTRA=() # "label|process pattern|command" per extra view, from team.conf; `awake` starts them in the Awake tab
CONF="$HERE/team.conf"
[ -f "$CONF" ] || die "$CONF is missing (agent-team-kit/install.sh writes it)"
# shellcheck source=/dev/null
. "$CONF"
[ -n "$PROJECT" ] || PROJECT="$(basename "$REPO")"
BRANCH="${BRANCH:-main}" # the base branch: tasks branch from it and merge into it; the worktrees are made from it
case "$PREFIX" in '' | [a-z]*) ;; *) die "PREFIX in team.conf must start with a lowercase letter" ;; esac
# The owner: the person the team works for. Named in the texts, and the file the architect keeps for them
# is named after them (for-<owner>.md in .team), so that two teams of two people never share a file name.
OWNER_NAME="${OWNER:-the owner}"
slug() { local s; s="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9')"; printf '%s' "${s:-$2}"; }
OWNER_SLUG="$(slug "$OWNER" owner)"
NEEDS="for-$OWNER_SLUG.md"

# A partner team (PARTNER in team.conf): another person's team working on this repository from its own machine,
# through GitHub only. Both machines run this script; the partner's has a marker in its .team/, written by
# `init --side partner`, and there the roster is $PARTNER_DIR/roster.local.conf (else roster.conf), the team works
# for the partner, and the other team is the owner's. The second marker name is the one an earlier version used.
if [ "${1:-}" = init ] && [ "${2:-}" = --side ]; then
  case "${3:-}" in
    partner) mkdir -p "$TEAM"; [ -f "$TEAM/this-is-the-partner-team" ] || date >"$TEAM/this-is-the-partner-team" ;;
    owner) rm -f "$TEAM/this-is-the-partner-team" ;;
    *) die "usage: init [--side owner|partner]" ;;
  esac
fi
PARTNER_SIDE=no
for marker in this-is-the-partner-team this-is-the-support-team; do [ -f "$TEAM/$marker" ] && PARTNER_SIDE=yes; done
OTHER_TEAM="" # the other team, by its person: an apostrophe inside ${...:+...} is a quote to bash, hence two lines
[ -z "$PARTNER" ] || OTHER_TEAM="$PARTNER's team"
ROSTER_FILE="$HERE/roster.conf"
if [ "$PARTNER_SIDE" = yes ]; then
  OTHER_TEAM="$OWNER_NAME's team"
  OWNER_NAME="${PARTNER:-the partner}"
  NEEDS="for-$(slug "$PARTNER" partner).md"
  ROSTER_FILE="$REPO/$PARTNER_DIR/roster.local.conf"
  [ -f "$ROSTER_FILE" ] || ROSTER_FILE="$REPO/$PARTNER_DIR/roster.conf"
fi

# The roster: role | role file in .claude/agents | model | effort | dev port
[ -f "$ROSTER_FILE" ] || die "$ROSTER_FILE is missing"
ROSTER=()
while IFS= read -r row || [ -n "$row" ]; do
  case "$row" in '' | '#'*) ;; *) ROSTER+=("$row") ;; esac
done <"$ROSTER_FILE"
[ ${#ROSTER[@]} -gt 0 ] || die "$ROSTER_FILE lists no agents"
ROLES=()
WORKERS=() # agents that work in their own worktree; the architect works in $REPO
for row in "${ROSTER[@]}"; do
  ROLES+=("${row%%|*}")
  case "${row%%|*}" in architect) ;; *) WORKERS+=("${row%%|*}") ;; esac
done

# Herdr needs agent names to be unique across every workspace it runs. A second team on the same
# machine therefore carries a prefix: the role `builder-1` is the Herdr agent `<prefix>-builder-1`. Commands
# take roles; only the calls to herdr use the full name.
hname() { printf '%s' "${PREFIX:+$PREFIX-}$1"; }
role_of() { printf '%s' "${1#"${PREFIX:+$PREFIX-}"}"; }

in_herdr() { [ "${HERDR_ENV:-}" = 1 ]; }
[ "${1:-}" = recover ] || in_herdr || die "not inside a Herdr pane"

# The workspace the team lives in is the one `office` (or `monitor`, `awake`) recorded. It is never
# guessed from the pane this command runs in: another team's workspace has panes with the same labels,
# and a recover aimed at it would restart that team's agents.
workspace() { [ -f "$TEAM/workspace" ] && cat "$TEAM/workspace" || true; }

lookup() { # sets DEF MODEL EFFORT PORT CWD for role $1
  local row
  for row in "${ROSTER[@]}"; do
    if [ "${row%%|*}" = "$1" ]; then
      IFS='|' read -r _ DEF MODEL EFFORT PORT <<<"$row"
      case "$1" in architect) CWD="$REPO" ;; *) CWD="$WORKTREES/$1" ;; esac
      # The model fallback (scripts/team-fallback.py): while the account is out of this agent's model, it runs on
      # another one. The file says which and until when; past that time the roster's model is back.
      if [ -f "$TEAM/model-override/$1" ]; then
        local o_model o_effort o_until
        IFS='|' read -r o_model o_effort o_until _ <"$TEAM/model-override/$1" || true
        if [ -n "$o_model" ] && { [ -z "$o_until" ] || [ "$(date +%s)" -lt "${o_until%.*}" ]; }; then
          MODEL="$o_model"; EFFORT="${o_effort:-$EFFORT}"
        fi
      fi
      return 0
    fi
  done
  die "'$1' is not in $ROSTER_FILE"
}

agent_field() { # agent_field <role> <field of .result.agent>; empty when the agent is not live
  herdr agent get "$(hname "$1")" 2>/dev/null | jq -r ".result.agent.$2 // empty" 2>/dev/null || true
}

agent_env() { # the variables an agent's session needs, as `export` takes them
  lookup "$1"
  printf 'TEAM_AGENT=%s TEAM_REPO=%q TEAM_DIR=%q TEAM_OWNER=%q TEAM_NEEDS=%q TEAM_BRANCH=%q' "$1" "$REPO" "$TEAM" "$OWNER_NAME" "$TEAM/$NEEDS" "$BRANCH"
  [ "$TASK_TIERS" != yes ] || printf ' TEAM_TIERS=yes'
  # With a partner team: which side this machine is, and who the other team is (running-the-team says what each does).
  [ -z "$OTHER_TEAM" ] || printf ' TEAM_SIDE=%s TEAM_OTHER=%q' "$([ "$PARTNER_SIDE" = yes ] && echo partner || echo owner)" "$OTHER_TEAM"
  [ "$PORT" = "-" ] || printf ' TEAM_PORT=%s' "$PORT"
}

pane_of() { # pane_of <label>: the id of the pane with that label in the team's workspace, or nothing
  # Only a pane working in this repository or its worktrees counts, as a second guard against another team's.
  local ws
  ws="$(workspace)"
  [ -n "$ws" ] || return 0
  herdr pane list --workspace "$ws" 2>/dev/null \
    | jq -r --arg l "$1" --arg repo "$REPO" '[.result.panes[] | select(.label == $l and ((.cwd // "") | startswith($repo))) | .pane_id][0] // empty' 2>/dev/null || true
}

# --- finding the Claude process in a pane (macOS: ps shows the environment; Linux: /proc) ------------
proc_env_has() { # proc_env_has <pid> <exact VAR=value>
  if [ -r "/proc/$1/environ" ]; then
    tr '\0' '\n' <"/proc/$1/environ" | grep -qxF -- "$2"
  else
    { ps eww -o command= -p "$1" 2>/dev/null; echo; } | sed 's/$/ /' | grep -qF -- " $2 "
  fi
}

claude_in() { # claude_in <pane-id>: pid of the Claude running in that pane, if any
  local pid
  for pid in $(pgrep -x claude 2>/dev/null || true); do
    if proc_env_has "$pid" "HERDR_PANE_ID=$1"; then echo "$pid"; return 0; fi
  done
  return 0
}

set_up_properly() { # set_up_properly <role> <pane>: is the Claude in this pane one this script started?
  local pid
  pid="$(claude_in "$2")"
  [ -n "$pid" ] && proc_env_has "$pid" "TEAM_AGENT=$1"
}

running_model() { # running_model <pane>: the model the Claude in this pane was started with
  local pid
  pid="$(claude_in "$1")"
  [ -n "$pid" ] || return 0
  ps -o command= -p "$pid" 2>/dev/null | sed -n 's/.* --model \([^ ]*\).*/\1/p' | head -1
}

running_effort() { # running_effort <pane>: the effort level the Claude in this pane was started with
  local pid
  pid="$(claude_in "$1")"
  [ -n "$pid" ] || return 0
  ps -o command= -p "$pid" 2>/dev/null | sed -n 's/.* --effort \([a-z]*\).*/\1/p' | head -1
}

# --- starting and stopping sessions ---------------------------------------------------------------
accept_trust() { # answer Claude Code's folder-trust prompt, and nothing else (only with ACCEPT_FOLDER_TRUST=yes)
  local role="$1" screen
  screen="$(herdr agent read "$(hname "$role")" --source visible --lines 40 2>/dev/null || true)"
  case "$screen" in *"Yes, I trust this folder"*) ;; *) return 1 ;; esac
  herdr agent send-keys "$(hname "$role")" down enter >/dev/null
  herdr agent wait "$(hname "$role")" --until idle --timeout 60000 >/dev/null 2>&1 || true
  [ "$(agent_field "$role" agent_status)" != blocked ]
}

start_agent() { # start_agent <role> <pane-id> [session-id]; the pane must be a shell at its prompt
  local role="$1" pane="$2" session="${3:-}" out attempt args=()
  lookup "$role"
  EFFORT="${EFFORT_FOR_TASK:-$EFFORT}" # a risky task may be given more than the roster's level
  MODEL="${MODEL_FOR_TASK:-$MODEL}"    # a task's tier may give it another model than the roster's
  herdr pane rename "$pane" "$role" >/dev/null
  # The pane is a shell at its prompt; ctrl+c clears anything typed into it (a stray key from a dialog).
  herdr pane send-keys "$pane" ctrl+c >/dev/null 2>&1 || true
  # A pane that Herdr restored after its own restart has lost its variables: set them in its shell again.
  herdr pane run "$pane" "cd $(printf '%q' "$CWD") && export $(agent_env "$role") && clear" >/dev/null
  sleep 2
  [ -z "$session" ] || args+=(--resume "$session") # carry on the saved conversation
  args+=(--agent "$DEF" --model "$MODEL" --effort "$EFFORT" --name "$(hname "$role")")
  [ -f "$TEAM/claude-settings.json" ] && args+=(--settings "$TEAM/claude-settings.json")
  [ -z "$PERMISSION_MODE" ] || args+=(--permission-mode "$PERMISSION_MODE")
  for attempt in 1 2 3; do
    if out="$(herdr agent start "$(hname "$role")" --kind claude --pane "$pane" --timeout 90000 -- "${args[@]}" 2>&1)"; then
      # Herdr can report the session ready while Claude Code's folder-trust dialog is up (it did for the
      # first agent of a new repository, which then quit at that dialog). Answer it now if it is there.
      if [ "$ACCEPT_FOLDER_TRUST" = yes ] && accept_trust "$role"; then
        echo "started $role ($MODEL, $EFFORT effort) in $pane, after confirming folder trust"
      else
        echo "started $role ($MODEL, $EFFORT effort) in $pane${session:+, carrying on its conversation}"
      fi
      return 0
    fi
    case "$out" in
      *agent_not_ready*)
        if [ "$ACCEPT_FOLDER_TRUST" = yes ] && accept_trust "$role"; then
          echo "started $role ($MODEL, $EFFORT effort) in $pane, after confirming folder trust"
          return 0
        fi
        echo "$role is waiting on a prompt in $pane that is not this script's to answer. Look at it:"
        echo "  herdr agent read $(hname "$role") --source visible"
        echo "(A folder-trust prompt is answered automatically once team.conf has ACCEPT_FOLDER_TRUST=\"yes\".)"
        return 0
        ;;
    esac
    sleep 3 # the pane's shell may still be starting
  done
  die "could not start $role in $pane: $out"
}

end_session() { # end_session <role> <pane>: leave Claude Code in that pane, stopping its background commands
  local role="$1" pane="$2" i key
  herdr agent prompt "$pane" "/exit" >/dev/null 2>&1 || true
  for i in $(seq 1 20); do
    [ -z "$(agent_field "$role" pane_id)" ] && [ -z "$(claude_in "$pane")" ] && return 0
    # A session with background commands asks before exiting. Those commands are only waits on other
    # agents, dev servers and test runs, so stopping them is safe; the agents themselves keep working.
    # The dialog is a numbered list ("1. Exit and stop tasks", "2. Move to background and exit",
    # "3. Stay"): press the number of "Exit and stop tasks", never Enter, because the highlighted line
    # is not always that one and "Move to background" leaves the session alive.
    key="$(herdr pane read "$pane" --source visible --lines 30 2>/dev/null | grep -o '[0-9]\. Exit and stop tasks' | head -1 | cut -c1 || true)"
    if [ -n "$key" ]; then
      herdr pane send-keys "$pane" "$key" >/dev/null 2>&1 || true
    elif herdr pane read "$pane" --source visible --lines 30 2>/dev/null | grep -q "Exit and stop tasks"; then
      herdr pane send-keys "$pane" enter >/dev/null 2>&1 || true
    fi
    sleep 2
  done
  die "$role did not exit; check pane $pane"
}

remote_on() { # the owner reaches the architect from a phone: switch Remote Control back on after a restart
  [ "$REMOTE_CONTROL" = yes ] || return 0
  herdr agent prompt "$(hname "$1")" "/remote-control" >/dev/null 2>&1 || return 0
  sleep 6
  if herdr agent read "$(hname "$1")" --source visible --lines 20 2>/dev/null | grep -q "Enter to select"; then
    herdr agent send-keys "$(hname "$1")" enter >/dev/null 2>&1 || true
  fi
  sleep 2
}

# --- layout -----------------------------------------------------------------------------------------
split_for() { # split_for <role> <pane-to-split> <right|down> <ratio kept by the split pane>; prints the new pane id
  local role="$1" from="$2" direction="$3" ratio="$4" env=(--env "TEAM_AGENT=$role" --env "TEAM_REPO=$REPO" --env "TEAM_DIR=$TEAM")
  lookup "$role"
  [ "$PORT" = "-" ] || env+=(--env "TEAM_PORT=$PORT")
  herdr pane split "$from" --direction "$direction" --ratio "$ratio" --cwd "$CWD" "${env[@]}" --no-focus \
    | jq -r '.result.pane.pane_id'
}

ensure_worktree() { # ensure_worktree <role>: create the agent's worktree if it needs one and has none
  local role="$1" w
  for w in "${WORKERS[@]}"; do
    if [ "$w" = "$role" ]; then
      if [ ! -d "$WORKTREES/$role" ]; then
        git -C "$REPO" worktree add --detach "$WORKTREES/$role" "$BRANCH" >/dev/null
        echo "created worktree $WORKTREES/$role"
      fi
      link_team_files "$WORKTREES/$role"
    fi
  done
}

# In a repository the owner does not own, the kit is installed with `install.sh --local`: the role files, the
# skills, CLAUDE.local.md and the team's docs are kept out of git, so a worktree made from main has none of
# them. They reach it as symlinks to the main checkout's copies: the whole `docs` and `.claude` folders when
# the worktree has none (so files the architect writes later, docs/SPEC.md on the first brief, appear too),
# else entry by entry. Paths the worktree already has (the committed install) are left alone, so this is safe
# to run on any worktree, any number of times.
link_team_files() { # link_team_files <worktree>: symlink the team's untracked files into a worktree
  local wt="$1" n=0
  [ -d "$wt" ] || die "$wt is not a folder"
  link_one() { # link_one <relative path>: a symlink in the worktree to the main checkout's path, when both sides allow
    [ -e "$REPO/$1" ] || return 0
    [ -e "$wt/$1" ] || [ -L "$wt/$1" ] || { mkdir -p "$(dirname "$wt/$1")"; ln -s "$REPO/$1" "$wt/$1"; n=$((n + 1)); }
  }
  link_dir() { # link_dir <folder> <entries...>: the folder whole when the worktree has none, else its entries
    local d="$1" e; shift
    if [ -d "$REPO/$d" ] && [ ! -e "$wt/$d" ] && [ ! -L "$wt/$d" ]; then link_one "$d"; return 0; fi
    for e in "$@"; do link_one "$d/$e"; done
  }
  link_dir docs team SPEC.md ARCHITECTURE.md DECISIONS.md CONVENTIONS.md DESIGN.md
  link_dir .claude agents skills settings.local.json
  link_one CLAUDE.local.md
  [ "$n" = 0 ] || echo "linked $n of the team's files into $wt"
}

cmd_link() { # link [worktree]: the symlinks above, for a worktree made by hand (the verifier's `close`); default: every worktree
  local wt
  if [ $# -ge 1 ]; then link_team_files "$1"; return; fi
  for wt in "$WORKTREES"/*/; do [ -d "$wt" ] && link_team_files "${wt%/}"; done
}

cmd_init() { # init: create the team's live files if they are missing; never overwrites
  mkdir -p "$TEAM/tasks" "$TEAM/milestones" "$TEAM/evidence" "$TEAM/design" "$TEAM/status"
  # A status line for each agent: its context use and the plan's remaining usage. Carries this
  # machine's path, so it is written here and not committed.
  # ... and the guard: a hook that refuses the commands no agent may run (scripts/team-guard.py) before they run.
  jq -n --arg cmd "python3 $HERE/team-statusline.py" --arg guard "python3 $HERE/team-guard.py" \
    '{statusLine: {type: "command", command: $cmd}, hooks: {PreToolUse: [{matcher: "Bash", hooks: [{type: "command", command: $guard, timeout: 15}]}]}}' \
    >"$TEAM/claude-settings.json"
  [ -f "$TEAM/board.md" ] || printf '# Board\n\nThe architect keeps this file current: the open milestone, its tasks, their owners and states. Closed milestones move to board-archive.md.\n\n| Task | Title | Owner | State |\n|---|---|---|---|\n' >"$TEAM/board.md"
  [ -f "$TEAM/$NEEDS" ] || { printf '# For %s\n\n' "$OWNER_NAME" >"$TEAM/$NEEDS"; printf 'The architect keeps this file. It is what to read when you come back after being away.\n\n## Needs you\n\nQuestions only you can answer. Each says what is waiting on it and what is carrying on meanwhile.\n\n## Where things stand\n\n## Decided without you\n\nDecisions made on your behalf that you might have wanted a say in. Each says how to reverse it.\n' >>"$TEAM/$NEEDS"; }
  [ -f "$TEAM/architect-notes.md" ] || printf '# Architect notes\n\nKept to what is written nowhere else: the task the owner gave, what done looks like, what to do at the next check-in, what was learned and is not yet in the documents. Read at every start; about 1,500 words at most.\n' >"$TEAM/architect-notes.md"
  [ -f "$TEAM/notes.md" ] || printf '# Shared notes\n\nThings one agent learned the hard way that the next agent would otherwise learn again. Read this at the start of every task.\n\nWhat belongs here: a trap in the tooling or the codebase that cost you real time and that someone else will walk into, with what to do about it. One line each.\n\nWhat does not: what you built (that is your report), anything already in CLAUDE.md or docs/, anything that only matters to your own task, opinions, and to-dos. Most tasks add nothing.\n\nTo add one, run: %s/team.sh note "<the trap, and what to do>"\n\nWhoever runs the loop prunes this file at each milestone close: what will stay true moves into the skill it belongs to and the rest is removed. It should never be longer than one screen. Notes are removed only with `scripts/team.sh drop "<part of the note>" "<reason>"`, which logs what the note said and why it went in notes-removed.md. Do not edit notes out by hand.\n\n' "$HERE" >"$TEAM/notes.md"
  [ -f "$TEAM/notes-removed.md" ] || printf '# Removed notes\n\nEvery note taken out of notes.md, with why.\n\n' >"$TEAM/notes-removed.md"
  echo "team files are in $TEAM"
}

layout_rows() { # which roles go on the top row (left to right) and which below; sets TOP and BOTTOM
  local r row
  TOP=() BOTTOM=()
  for r in architect designer; do
    for row in "${ROSTER[@]}"; do [ "${row%%|*}" = "$r" ] && TOP+=("$r"); done
  done
  for r in "${ROLES[@]}"; do
    case " ${TOP[*]} " in *" $r "*) ;; *) BOTTOM+=("$r") ;; esac
  done
  [ ${#TOP[@]} -gt 0 ] || die "the roster needs an architect"
}

fill_row() { # fill_row <first pane> <role>...: split a row into equal columns; prints "role=pane" per agent
  local first="$1" prev n i ratio role
  shift
  prev="$first"
  n=$#
  i=0
  for role in "$@"; do
    i=$((i + 1))
    if [ "$i" -eq 1 ]; then echo "$role=$first"; continue; fi
    ratio="$(awk -v k=$((n - i + 2)) 'BEGIN { printf "%.4f", 1 / k }')" # the pane split keeps 1/k, the new pane the rest
    prev="$(split_for "$role" "$prev" right "$ratio")"
    echo "$role=$prev"
  done
}

cmd_office() { # office [pane-id]: build the team layout (in a new Office tab, or from one shell pane) and start everyone
  local anchor="${1:-}" role ws pane b0 line
  git -C "$REPO" rev-parse --verify -q "$BRANCH" >/dev/null || die "the base branch $BRANCH has no commits yet (BRANCH in scripts/team.conf)"
  for role in "${ROLES[@]}"; do
    [ -z "$(agent_field "$role" pane_id)" ] || die "$role is already running (as $(hname "$role"))"
  done
  cmd_init >/dev/null
  for role in "${WORKERS[@]}"; do ensure_worktree "$role"; done
  if [ -z "$anchor" ]; then # no pane given: make the team its own tab in this workspace
    ws="${HERDR_WORKSPACE_ID:?run office from a Herdr pane, or give it a pane id}"
    anchor="$(herdr tab create --workspace "$ws" --cwd "$REPO" --label Office --env "TEAM_REPO=$REPO" --no-focus | jq -r '.result.root_pane.pane_id')"
    echo "opened the Office tab in workspace $ws"
    sleep 2
  else
    ws="$(herdr pane list 2>/dev/null | jq -r --arg p "$anchor" '.result.panes[] | select(.pane_id == $p) | .workspace_id // empty' | head -1)"
    [ -n "$ws" ] || ws="${HERDR_WORKSPACE_ID:-}"
  fi
  [ -z "$ws" ] || printf '%s\n' "$ws" >"$TEAM/workspace"

  layout_rows
  # Top row: architect | designer. Bottom row: the builders and the verifier.
  declare -a placed=()
  if [ ${#BOTTOM[@]} -gt 0 ]; then
    b0="$(split_for "${BOTTOM[0]}" "$anchor" down 0.58)"
    while IFS= read -r line; do placed+=("$line"); done < <(fill_row "$b0" "${BOTTOM[@]}")
  fi
  while IFS= read -r line; do placed+=("$line"); done < <(fill_row "$anchor" "${TOP[@]}")
  sleep 2
  for role in "${ROLES[@]}"; do # start in roster order
    for line in "${placed[@]}"; do
      if [ "${line%%=*}" = "$role" ]; then start_agent "$role" "${line#*=}"; fi
    done
  done
  echo "the team is up; scripts/team.sh status shows it"
}

roster_line() { # roster_line <role> <on|off>: uncomment or comment out the role's line in the roster file
  local tmp="$ROSTER_FILE.team-new.$$"
  if [ "$2" = off ]; then sed "s/^$1|/#$1|/" "$ROSTER_FILE" >"$tmp"; else sed "s/^#[[:space:]]*$1|/$1|/" "$ROSTER_FILE" >"$tmp"; fi
  mv -f "$tmp" "$ROSTER_FILE"
}

cmd_join() { # join <role> <pane-to-split> <right|down> [ratio]: add one agent beside an existing pane
  local role="$1" from="$2" direction="$3" ratio="${4:-0.5}" pane session
  # A benched role's line is commented out in the roster: put it back, then start again with the roster read anew.
  if ! printf '%s\n' "${ROLES[@]}" | grep -qxF -- "$role" && grep -q "^#[[:space:]]*$role|" "$ROSTER_FILE"; then
    roster_line "$role" on
    echo "$role is back in $(basename "$ROSTER_FILE") (its line uncommented; commit it)"
    exec "$0" join "$@"
  fi
  lookup "$role"
  [ -z "$(agent_field "$role" pane_id)" ] || die "$role is already running"
  ensure_worktree "$role"
  pane="$(split_for "$role" "$from" "$direction" "$ratio")"
  sleep 2
  # A role that was paused (benched) comes back with its conversation, like recover would.
  session=""
  if [ -f "$TEAM/paused/$role" ]; then
    session="$(cat "$TEAM/paused/$role")"
    ls "$HOME"/.claude/projects/*/"$session".jsonl >/dev/null 2>&1 || session=""
  fi
  if start_agent "$role" "$pane" "$session"; then rm -f "$TEAM/paused/$role"; fi
}

# --- the views: one definition of each, used by monitor, awake and recover ---------------------------
view_command() { # view_command <pane label>: what runs in that pane (from the repo's root)
  case "$1" in
    "team dashboard") echo "python3 scripts/team-dash.py" ;;
    "office") echo "python3 scripts/team-office.py" ;;
    "shared notes") echo "python3 scripts/team-notes.py" ;;
    "keep awake")
      local keep
      if command -v caffeinate >/dev/null 2>&1; then keep="caffeinate -is" # macOS
      elif command -v systemd-inhibit >/dev/null 2>&1; then keep="systemd-inhibit --what=idle:sleep --who='$PROJECT team' --why='agents are working' sleep infinity"
      else keep="echo 'No caffeinate or systemd-inhibit here. Turn off automatic sleep while the team works.'"
      fi
      echo "echo 'Keeping this machine awake while this runs. Ctrl+C stops it.'; $keep"
      ;;
    "memory guard") echo "bash scripts/memory-guard.sh" ;;
    "$LISTEN_LABEL") echo "python3 scripts/github-activity.py --listen --route --mark $(printf '%q' "$TEAM/status/_other-team-activity")" ;;
    "model fallback") echo "python3 scripts/team-fallback.py watch" ;;
    *) extra_view "$1" 3 ;;
  esac
}
view_process() { # view_process <pane label>: a pattern (pgrep -f) that matches the process running there
  case "$1" in
    "team dashboard") echo "scripts/team-dash.py" ;;
    "office") echo "scripts/team-office.py" ;;
    "shared notes") echo "scripts/team-notes.py" ;;
    "keep awake") echo "caffeinate -is|systemd-inhibit --what=idle:sleep" ;;
    "memory guard") echo "scripts/memory-guard.sh" ;;
    "$LISTEN_LABEL") echo "github-activity.py --listen" ;;
    "model fallback") echo "team-fallback.py watch" ;;
    *) extra_view "$1" 2 ;;
  esac
}
extra_view() { # extra_view <label> <field>: the process pattern (2) or the command (3) of a view in VIEWS_EXTRA
  local row
  for row in "${VIEWS_EXTRA[@]+"${VIEWS_EXTRA[@]}"}"; do
    [ "${row%%|*}" = "$1" ] && { printf '%s\n' "$row" | cut -d'|' -f"$2"; return; }
  done
}
# What runs before a view's command in its pane: the repository as the working directory, and TEAM_REPO
# in the environment, which is how a view's process is told from another team's (view_running).
view_prelude() { printf 'cd %q && export TEAM_REPO=%q && clear;' "$REPO" "$REPO"; }
VIEWS=("team dashboard" "office" "shared notes" "keep awake")
[ "$MEMORY_GUARD" = yes ] && VIEWS+=("memory guard")
# With a partner team, the listener: it asks GitHub once a minute what the other team did and wakes whoever it
# concerns (scripts/github-activity.py; no model calls). Its pane is named after the other team.
LISTEN_LABEL="listening for ${OTHER_TEAM:-the partner team}"
[ -n "$OTHER_TEAM" ] && VIEWS+=("$LISTEN_LABEL")
# The model fallback: an agent whose model's usage runs out goes on to FALLBACK_MODEL until the limit resets.
[ -z "$FALLBACK_MODEL" ] || VIEWS+=("model fallback")
for row in "${VIEWS_EXTRA[@]+"${VIEWS_EXTRA[@]}"}"; do VIEWS+=("${row%%|*}"); done
AWAKE_VIEWS=() # what `awake` puts beside keep-awake: the memory guard, the listener, the extra views
for label in "${VIEWS[@]}"; do case "$label" in "team dashboard" | office | "shared notes" | "keep awake") ;; *) AWAKE_VIEWS+=("$label") ;; esac; done

proc_cwd() { # proc_cwd <pid>: the process's working directory (Linux: /proc; macOS: lsof)
  if [ -e "/proc/$1/cwd" ]; then readlink "/proc/$1/cwd" 2>/dev/null
  else lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1
  fi
}

# Two teams on one machine run the same views: a view counts as this team's only when its process runs
# in this repository (its working directory, or TEAM_REPO in its environment; view_prelude sets both).
# macOS hides the environment of its own binaries such as caffeinate from ps, hence the directory.
view_running() {
  local pid
  for pid in $(pgrep -f "$(view_process "$1")" 2>/dev/null || true); do
    [ "$(proc_cwd "$pid")" = "$REPO" ] && return 0
    proc_env_has "$pid" "TEAM_REPO=$REPO" && return 0
  done
  return 1
}

cmd_monitor() { # monitor [pane-id]: add the dashboard, the office and the shared notes beside a pane
  local base="${1:-${HERDR_PANE_ID:-}}" dash office notes
  [ -n "$base" ] || die "usage: monitor <pane-id of the pane to put the three views beside>"
  cmd_init >/dev/null
  [ -f "$TEAM/workspace" ] || { [ -z "${HERDR_WORKSPACE_ID:-}" ] || printf '%s\n' "$HERDR_WORKSPACE_ID" >"$TEAM/workspace"; }
  dash="$(herdr pane split "$base" --direction right --ratio 0.5 --cwd "$REPO" --env "TEAM_REPO=$REPO" --no-focus | jq -r '.result.pane.pane_id')"
  office="$(herdr pane split "$base" --direction down --ratio 0.64 --cwd "$REPO" --env "TEAM_REPO=$REPO" --no-focus | jq -r '.result.pane.pane_id')"
  notes="$(herdr pane split "$dash" --direction down --ratio 0.78 --cwd "$REPO" --env "TEAM_REPO=$REPO" --no-focus | jq -r '.result.pane.pane_id')"
  herdr pane rename "$dash" "team dashboard" >/dev/null
  herdr pane rename "$office" "office" >/dev/null
  herdr pane rename "$notes" "shared notes" >/dev/null
  if [ "$base" = "${HERDR_PANE_ID:-}" ] && [ -n "${HERDR_TAB_ID:-}" ]; then
    herdr tab rename "$HERDR_TAB_ID" Setup >/dev/null 2>&1 || true
  fi
  sleep 2
  herdr pane run "$dash" "$(view_prelude) $(view_command 'team dashboard')" >/dev/null
  herdr pane run "$office" "$(view_prelude) $(view_command 'office')" >/dev/null
  herdr pane run "$notes" "$(view_prelude) $(view_command 'shared notes')" >/dev/null
  echo "dashboard in $dash, office in $office, shared notes in $notes"
}

cmd_awake() { # awake: open an Awake tab that keeps this machine awake (and runs the memory guard, the listener, ...)
  local ws pane
  # The team's own workspace when it has one: run from another workspace (a setup session), the tab must still
  # go to the team's.
  ws="$(workspace)"; [ -n "$ws" ] || ws="${HERDR_WORKSPACE_ID:?run awake from a Herdr pane}"
  cmd_init >/dev/null
  [ -f "$TEAM/workspace" ] || printf '%s\n' "$ws" >"$TEAM/workspace"
  # An Awake tab that is already open is reused: a second run (after a Herdr restart, or to add the memory
  # guard once it is turned on) starts what is missing in the panes it has, and never makes a second tab.
  pane="$(pane_of 'keep awake')"
  if [ -n "$pane" ]; then
    if view_running 'keep awake'; then echo "keep-awake already running in $pane (tab Awake)"
    else
      herdr pane run "$pane" "$(view_prelude) $(view_command 'keep awake')" >/dev/null
      echo "keep-awake command running in $pane (tab Awake)"
    fi
  else
    pane="$(herdr tab create --workspace "$ws" --cwd "$REPO" --label Awake --env "TEAM_REPO=$REPO" --no-focus | jq -r '.result.root_pane.pane_id')"
    herdr pane rename "$pane" "keep awake" >/dev/null
    sleep 2
    herdr pane run "$pane" "$(view_prelude) $(view_command 'keep awake')" >/dev/null
    echo "keep-awake command running in $pane (tab Awake)"
  fi
  # Beside it, each of the other always-on views (the memory guard, the partner listener, the extra views): the
  # first takes the right part of keep-awake's pane, each next one the lower part of the one before.
  local label last="" dir=right ratio=0.4 view
  for label in "${AWAKE_VIEWS[@]+"${AWAKE_VIEWS[@]}"}"; do
    view="$(pane_of "$label")"
    if [ -n "$view" ]; then
      last="$view"; dir=down; ratio=0.5
      if view_running "$label"; then echo "$label already running in $view"; continue; fi
    else
      view="$(herdr pane split "${last:-$pane}" --direction "$dir" --ratio "$ratio" --cwd "$REPO" --env "TEAM_REPO=$REPO" --no-focus | jq -r '.result.pane.pane_id')"
      herdr pane rename "$view" "$label" >/dev/null
      last="$view"; dir=down; ratio=0.5
      sleep 2
    fi
    herdr pane run "$view" "$(view_prelude) $(view_command "$label")" >/dev/null
    echo "$label running in $view"
  done
}

# --- messages ---------------------------------------------------------------------------------------
ledger() { # ledger <assign|send|fresh> <role> [task id] [effort]: one line for scripts/team-cost.py (format: its header)
  # UTC time, command, role, task, effort, tab-separated. Never the message: a send can quote anything.
  # Without a task id, the role's latest assigned task if there is one, else "-". A failed write never stops the command.
  local log="$TEAM/status/assignments.log" task="${3:-}"
  if [ -z "$task" ]; then
    task="$(awk -F'\t' -v a="$2" '$3 == a && $2 == "assign" && $4 != "-" { t = $4 } END { print t }' "$log" 2>/dev/null || true)"
  fi
  { mkdir -p "$TEAM/status" && printf '%s\t%s\t%s\t%s\t%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1" "$2" "${task:--}" "${4:--}" >>"$log"; } 2>/dev/null || true
}

cmd_send() { # send <role> <message...>: deliver a message and wait until the agent stops
  local role="$1"; shift
  local rc=0
  herdr agent prompt "$(hname "$role")" "$*" --wait --timeout "$WAIT_MS" || rc=$?
  echo
  echo "$role is now: $(agent_field "$role" agent_status) (prompt exit code $rc)"
  echo "Read its task file for the report. If there is none, read the pane:"
  echo "  herdr agent read $(hname "$role") --source recent-unwrapped --lines 80"
  return 0
}

cmd_tell() { # tell <role> <message...>: deliver a message without waiting for the agent to stop
  local role="$1"; shift
  herdr agent prompt "$(hname "$role")" "$*" >/dev/null
  echo "delivered to $role"
}

task_tier() { # task_tier <task file>: light, standard or heavy, from the brief's "Tier:" line; standard without one
  local t
  t="$(sed -n 's/^[*_ ]*[Tt]ier:[*_ ]*\([A-Za-z]*\).*/\1/p' "$1" 2>/dev/null | head -1 | tr '[:upper:]' '[:lower:]')"
  case "$t" in light | heavy) echo "$t" ;; *) echo standard ;; esac
}

cmd_assign() { # assign <role> <task-id> [--effort <level>] [--tier light|standard|heavy]: clear the agent's conversation and hand it a task file
  local role="$1" id="$2" want="" tier="" file status have have_model model label
  shift 2
  while [ $# -gt 0 ]; do
    case "$1" in --effort) want="$2"; shift 2 ;; --tier) tier="$2"; shift 2 ;; *) die "assign: unknown option $1" ;; esac
  done
  file="$(ls "$TEAM/tasks/$id"*.md 2>/dev/null | head -1 || true)"
  [ -n "$file" ] || die "no task file matching $TEAM/tasks/$id*.md"
  status="$(agent_field "$role" agent_status)"
  [ -n "$status" ] || die "$role is not running"
  [ "$status" != working ] || die "$role is still working; wait for it or use 'send'"
  # The task runs on the roster's model and effort. A tier changes both for this task (TASK_TIERS="yes" reads it
  # from the brief; --tier names it), and --effort raises the effort; an agent left on another model or level by
  # its last task is restarted on the right one, so either lasts for one task only. Never the architect.
  lookup "$role"
  model="$MODEL"
  [ -n "$tier" ] || { [ "$TASK_TIERS" != yes ] || tier="$(task_tier "$file")"; }
  [ "$role" != architect ] || tier=""
  case "$tier" in
    light) IFS='|' read -r model EFFORT <<<"$TIER_LIGHT" ;;
    heavy) IFS='|' read -r model EFFORT <<<"$TIER_HEAVY" ;;
    "" | standard) tier="" ;;
    *) die "assign: --tier takes light, standard or heavy" ;;
  esac
  want="${want:-$EFFORT}"
  label="$tier" # for the ledger: the tier, and a raised effort after it
  [ "$want" = "$EFFORT" ] || label="${label:+$label,}$want"
  ledger assign "$role" "$id" "${label:-}"
  have="$(running_effort "$(agent_field "$role" pane_id)")"
  have_model="$(running_model "$(agent_field "$role" pane_id)")"
  if { [ -n "$have" ] && [ "$have" != "$want" ]; } || { [ -n "$have_model" ] && [ "$have_model" != "$model" ]; }; then
    echo "$role: ${have_model:-?} at ${have:-?} -> $model at $want for $id${tier:+ ($tier tier)}"
    EFFORT_FOR_TASK="$want" MODEL_FOR_TASK="$model" cmd_restart "$role"
  else
    herdr agent prompt "$(hname "$role")" "/clear" >/dev/null
  fi
  sleep 4
  cmd_send "$role" "Your assignment is $file. First read $TEAM/notes.md, the team's shared notes. Then carry out the assignment as your role instructions describe."
}

cmd_note() { # note <one line>: add a discovery to the team's shared notes
  local who="${TEAM_AGENT:-architect}" file="$TEAM/notes.md" text count
  text="$(printf '%s' "$*" | tr '\n' ' ')"
  [ -f "$file" ] || die "$file is missing; run 'init'"
  [ "${#text}" -le 240 ] || die "a note is one line of at most 240 characters; detail belongs in your report"
  printf -- '- %s %s: %s\n' "$(date '+%Y-%m-%d')" "$who" "$text" >>"$file"
  count="$(grep -c '^- ' "$file" || true)"
  echo "noted ($count notes in $file)"
  if [ "$count" -gt 20 ]; then
    echo "The file is past 20 notes. Architect: prune it (move what stays true into the skill it belongs to, delete the rest)."
  fi
}

cmd_drop() { # drop <part of the note> <reason>: remove a note and record what it said and why it went
  local who="${TEAM_AGENT:-architect}" file="$TEAM/notes.md" log="$TEAM/notes-removed.md"
  local needle="$1" reason hits line text
  shift
  reason="$(printf '%s' "$*" | tr '\n' ' ')"
  [ -n "$reason" ] || die "give a reason: fixed in <commit>, moved to docs/CONVENTIONS.md, no longer true because ..."
  [ "${#reason}" -le 240 ] || die "keep the reason to one line of at most 240 characters"
  hits="$(grep -n -i -F -- "$needle" "$file" | grep -E '^[0-9]+:- ' || true)"
  [ -n "$hits" ] || die "no note contains '$needle'"
  [ "$(printf '%s\n' "$hits" | wc -l | tr -d ' ')" = 1 ] || die "more than one note contains '$needle'; be more specific:
$hits"
  line="${hits%%:*}"
  text="${hits#*:- }"
  printf -- '- %s %s | %s | was: %s\n' "$(date '+%Y-%m-%d %H:%M')" "$who" "$reason" "$text" >>"$log"
  awk -v n="$line" 'NR != n' "$file" >"$file.tmp" && mv "$file.tmp" "$file"
  echo "removed and logged in $log"
}

cmd_report() { # report <one line>: a teammate tells the architect and the owner that something needs them
  local msg="$*"
  mkdir -p "$TEAM"
  printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M')" "$msg" >>"$TEAM/reports.log"
  herdr notification show "$PROJECT team" --body "$msg" --sound done >/dev/null 2>&1 || true
  if herdr agent prompt "$(hname architect)" "[from ${TEAM_AGENT:-a teammate}] $msg" >/dev/null 2>&1; then
    echo "reported to architect"
  else
    echo "architect could not take a message right now; the line is in $TEAM/reports.log"
  fi
}

cmd_status() {
  local role listing
  listing="$(herdr agent list 2>/dev/null || echo '{"result":{"agents":[]}}')"
  {
    for role in "${ROLES[@]}"; do
      jq -r --arg n "$(hname "$role")" --arg r "$role" '
        .result.agents[] | select(.name == $n) | "\($r)\t\(.agent_status)\t\(.pane_id)\t\(.cwd)"' <<<"$listing" 2>/dev/null || true
    done
  } | { if command -v column >/dev/null; then column -t -s $'\t'; else cat; fi; }
  for role in "${ROLES[@]}"; do
    [ ! -f "$TEAM/model-override/$role" ] || echo "$role: on the model fallback ($(cut -d'|' -f1,2 "$TEAM/model-override/$role" | tr '|' ' '); python3 scripts/team-fallback.py status)"
  done
  if [ -f "$TEAM/board.md" ]; then echo; head -60 "$TEAM/board.md"; fi
}

# --- restarting --------------------------------------------------------------------------------------
cmd_restart() { # restart <role> [--keep]: end its session and start one in the same pane; --keep carries on its conversation
  local role="$1" keep="${2:-}" pane session=""
  lookup "$role"
  pane="$(agent_field "$role" pane_id)"
  [ -n "$pane" ] || pane="$(pane_of "$role")" # a pane Herdr brought back bare is known only by its label
  [ -n "$pane" ] || die "$role is not running"
  [ "$pane" != "${HERDR_PANE_ID:-}" ] || die "$role cannot restart itself: ask the architect (or, for the architect, the verifier) to run this"
  if [ -n "$keep" ]; then
    session="$(agent_field "$role" agent_session.value)"
    ls "$HOME"/.claude/projects/*/"$session".jsonl >/dev/null 2>&1 || session=""
    [ -n "$session" ] || echo "$role has no saved conversation; starting it fresh"
  fi
  end_session "$role" "$pane"
  start_agent "$role" "$pane" "$session"
  [ "$role" != architect ] || remote_on architect
}

cmd_bench() { # bench <role>: take a role off the team until it is needed: pause it, comment out its roster line, close its pane
  local role="$1" pane
  [ "$role" != architect ] || die "the architect runs the team; it is never benched"
  lookup "$role"
  pane="$(agent_field "$role" pane_id)"
  if [ -n "$pane" ]; then
    [ "$pane" != "${HERDR_PANE_ID:-}" ] || die "$role cannot bench itself: ask the architect to run this"
    [ "$(agent_field "$role" agent_status)" != working ] || die "$role is working; bench it when it stops"
    cmd_pause "$role"
    if [ -n "$(agent_field "$role" pane_id)" ]; then die "$role did not stop; look at pane $pane"; fi
  fi
  roster_line "$role" off
  # The pane it ran in: by Herdr's record, or by its label once the session has gone. Closed only when no Claude is in it.
  [ -n "$pane" ] || pane="$(pane_of "$role")"
  if [ -n "$pane" ] && [ -z "$(claude_in "$pane")" ]; then herdr pane close "$pane" >/dev/null 2>&1 && echo "closed its pane $pane"; fi
  echo "$role: benched. Its conversation is kept$([ -f "$TEAM/paused/$role" ] && echo " (.team/paused/$role)"), its line in $(basename "$ROSTER_FILE") is commented out (commit it), and its worktree stays. scripts/team.sh join $role <pane-to-split> right|down brings it back with its conversation."
}

cmd_pause() { # pause <role>...: end each session without a model call; recover brings it back with its conversation
  # For a long stop (days). An idle session costs nothing, but its background commands wake it when
  # they end, and every wake-up is a turn. Ending the session stops them. The session id is kept in
  # .team/paused/ so that recover resumes the same conversation.
  local role pane session
  mkdir -p "$TEAM/paused"
  for role in "$@"; do
    lookup "$role"
    pane="$(agent_field "$role" pane_id)"
    if [ -z "$pane" ]; then echo "$role: not running"; continue; fi
    [ "$pane" != "${HERDR_PANE_ID:-}" ] || { echo "$role: this command runs in its pane; left alone"; continue; }
    if [ "$(agent_field "$role" agent_status)" = working ]; then echo "$role: working; left alone (pause it when it stops)"; continue; fi
    session="$(agent_field "$role" agent_session.value)"
    printf '%s\n' "$session" >"$TEAM/paused/$role"
    (end_session "$role" "$pane") && echo "$role: paused (conversation $session kept)" || echo "$role: did not exit; look at pane $pane"
  done
}

cmd_fresh() { # fresh <role> <first message...>: restart it with an empty conversation and give it its first message
  # For the architect at a milestone boundary: every turn re-sends the whole conversation,
  # so a fresh one makes each later turn cheaper. The agent picks up from its notes and the board.
  local role="$1"; shift
  ledger fresh "$role"
  cmd_restart "$role"
  sleep 3
  cmd_tell "$role" "$*"
}

# --- recover: put the team back after the machine or Herdr restarts -----------------------------------
# Herdr brings its panes back as plain shells, without the TEAM_* variables, and starts each Claude as a
# bare `claude --resume <id>`: no role, model, status feed or dev port. The views do not come back.

server_up() { herdr status server 2>/dev/null | grep -q 'status: running'; }

recover_wait() { # outside Herdr: wait for the server, then for its restore of the panes and sessions to settle
  local i n last=-1 still=0
  for i in $(seq 1 60); do server_up && break; sleep 2; done
  server_up || die "Herdr server not running; nothing to do"
  for i in $(seq 1 30); do [ -n "$(pane_of architect)" ] && break; sleep 2; done
  for i in $(seq 1 40); do # Herdr starts its bare `claude --resume` sessions a few seconds after restoring the panes
    n="$(pgrep -cx claude 2>/dev/null || true)"
    if [ "$n" = "$last" ]; then still=$((still + 1)); else still=0; last="$n"; fi
    [ "$still" -ge 5 ] && break
    sleep 3
  done
}

cmd_sleep() { # sleep: a team nobody is working on: pause every agent (conversations kept), stop the views and keep-awake
  local role label pid n=0 pane msg
  for role in "${ROLES[@]}"; do cmd_pause "$role"; done
  for role in "${ROLES[@]}"; do
    [ -z "$(agent_field "$role" pane_id)" ] || { echo "$role is still running, so the team is not asleep; run sleep again when it stops"; return 1; }
  done
  for label in "${VIEWS[@]}"; do
    for pid in $(pgrep -f "$(view_process "$label")" 2>/dev/null || true); do
      # INT, not TERM: a view then leaves the alternate screen tidily, as on ctrl+c.
      if [ "$(proc_cwd "$pid")" = "$REPO" ] || proc_env_has "$pid" "TEAM_REPO=$REPO"; then kill -INT "$pid" 2>/dev/null && n=$((n + 1)); fi
    done
  done
  date '+%Y-%m-%d %H:%M' >"$TEAM/asleep"
  # One line in the dashboard's pane. The text goes through a file: a project name with an accent in it does
  # not survive printf %q on the way into Herdr.
  printf '  The %s team sleeps since %s: every agent paused with its conversation kept, the views and keep-awake stopped.\n  scripts/team.sh wake brings it all back.\n' "$PROJECT" "$(cat "$TEAM/asleep")" >"$TEAM/asleep-note.txt"
  pane="$(pane_of 'team dashboard')"
  if [ -n "$pane" ]; then
    sleep 1
    herdr pane run "$pane" "clear; echo; cat $(printf '%q' "$TEAM/asleep-note.txt")" >/dev/null || true
  fi
  echo "asleep since $(cat "$TEAM/asleep"): ${#ROLES[@]} conversations kept, $n view process$([ "$n" = 1 ] || echo es) stopped; scripts/team.sh wake brings the team back"
}

cmd_wake() { # wake: bring a sleeping team back, every agent with its conversation and every view (recover does it)
  if [ -f "$TEAM/asleep" ]; then echo "asleep since $(cat "$TEAM/asleep"); waking"; rm -f "$TEAM/asleep" "$TEAM/asleep-note.txt"; else echo "not asleep; recover runs anyway"; fi
  cmd_recover
  # A kit update may have brought an always-on view the Awake tab has no pane for yet: awake adds it.
  [ -z "$(pane_of 'keep awake')" ] || cmd_awake | grep -v 'already running' || true
}

cmd_recover() { # recover [--check]: restart every agent Herdr brought back bare, and every view that is gone
  local check="${1:-}" role pane label changed=0 session ws pid
  ws="$(workspace)"
  [ -n "$ws" ] || die "no workspace is recorded for this team in $TEAM/workspace (office, monitor and awake record it); nothing to recover"
  in_herdr || [ -n "$check" ] || recover_wait
  for role in "${ROLES[@]}"; do
    pane="$(agent_field "$role" pane_id)"
    if [ -z "$pane" ]; then
      # Its session has ended, or came back bare (a Claude Herdr does not know by our name). Find its pane by label.
      pane="$(pane_of "$role")"
      if [ -z "$pane" ]; then echo "$role: not running, and no pane has that label (scripts/team.sh office or join starts it)"; continue; fi
      changed=1; session=""
      pid="$(claude_in "$pane")"
      if [ -n "$pid" ]; then # a bare session: keep its conversation
        session="$(herdr agent get "$pane" 2>/dev/null | jq -r '.result.agent.agent_session.value // empty' 2>/dev/null || true)"
      elif [ -f "$TEAM/paused/$role" ]; then
        session="$(cat "$TEAM/paused/$role")"
      fi
      [ -z "$session" ] || ls "$HOME"/.claude/projects/*/"$session".jsonl >/dev/null 2>&1 || session=""
      if [ -n "$check" ]; then echo "$role: not set up; would be ${pid:+re}started in $pane${session:+, carrying on its conversation}"; continue; fi
      if [ -n "$pid" ] && ! (end_session "$role" "$pane"); then echo "$role: did not exit; look at pane $pane"; continue; fi
      if (start_agent "$role" "$pane" "$session"); then rm -f "$TEAM/paused/$role"; else echo "$role: could not be started (see above)"; fi
      continue
    fi
    if set_up_properly "$role" "$pane"; then echo "$role: fine"; continue; fi
    changed=1
    if [ "$pane" = "${HERDR_PANE_ID:-}" ]; then
      echo "$role: needs a restart, but this command runs in its pane; run recover from another pane"
    elif [ -n "$check" ]; then
      echo "$role: would be restarted, keeping its conversation"
    elif [ "$(agent_field "$role" agent_status)" = working ]; then
      echo "$role: needs a restart but is working; left alone (run recover again when it stops)"
    else
      (cmd_restart "$role" --keep) || echo "$role: could not be restarted (see above)"
    fi
  done
  for label in "${VIEWS[@]}"; do
    if view_running "$label"; then echo "$label: fine"; continue; fi
    changed=1
    pane="$(pane_of "$label")"
    if [ -z "$pane" ]; then echo "$label: not running, and no pane has that label (monitor or awake rebuilds it)"
    elif [ -n "$check" ]; then echo "$label: would be started in $pane"
    else herdr pane run "$pane" "$(view_prelude) $(view_command "$label")" >/dev/null && echo "$label: started in $pane"
    fi
  done
  [ "$changed" = 1 ] || echo "Nothing to do."
}

usage() {
  cat <<'EOF'
usage: scripts/team.sh <command>
  init [--side partner]     create the team's live files in .team/ if they are missing; --side partner marks this
                            machine as the partner team's (PARTNER in team.conf; --side owner removes the mark)
  eval <check|run|list|compare|clean>  the fixed eval set, docs/evals/ (scripts/team.sh eval run --help)
  office [pane-id]          start every agent in the roster, in a new Office tab or from the shell pane given
  monitor [pane-id]         add the dashboard, the office animation and the shared notes beside a pane (names the tab Setup)
  awake                     open an Awake tab that keeps this machine awake, with the memory guard (if on), the
                            model fallback, the partner team's listener (with PARTNER) and the extra views beside it
  join <role> <pane> <right|down> [ratio]   add one agent by splitting an existing pane (a benched one with its conversation)
  bench <role>              take a role off the team until it is needed: pause it, comment out its roster line, close its pane
  link [worktree]           symlink the team's untracked files (a --local install) into a worktree made by hand; default: all
  assign <role> <task-id> [--effort xhigh] [--tier light|heavy]   clear the agent's conversation and give it a
                            task file; returns when it stops. --effort raises the effort for this task only; a tier
                            (the brief's "Tier:" line when TASK_TIERS="yes", or --tier) sets model and effort for it
  send <role> <message>     send a follow-up message; returns when the agent stops
  tell <role> <message>     send a message and return at once
  report <one line>         notify the architect and the owner that something needs them
  note <one line>           add a trap worth knowing to the team's shared notes
  drop <part of note> <reason>   remove a note, recording what it said and why
  status                    agent states and the board
  restart <role> [--keep]   replace an agent's session in its pane; --keep carries on its conversation
  pause <role>...           end sessions for a long stop, with no model call; recover resumes their conversations
  sleep                     a team you are not working on: pause every agent, stop the views and keep-awake
  wake                      bring a sleeping team back: every agent with its conversation, every view
  fresh <role> <message>    restart an agent with an empty conversation and give it its first message
                            (the verifier restarts the architect this way at a milestone boundary)
  recover [--check]         after the machine or Herdr restarts: put back every agent and view that came back wrong
Roles are the names in scripts/roster.conf (architect, builder-1, verifier, designer, builder-2). With a PREFIX in
scripts/team.conf, Herdr knows the role `builder-1` as the agent `<prefix>-builder-1`.
EOF
}

cmd="${1:-}"; [ $# -gt 0 ] && shift
case "$cmd" in
  init)    { [ $# -eq 0 ] || { [ $# -eq 2 ] && [ "$1" = --side ]; }; } || die "usage: init [--side owner|partner]"; cmd_init ;;
  office)  [ $# -le 1 ] || die "usage: office [pane-id]"; cmd_office "$@" ;;
  monitor) [ $# -le 1 ] || die "usage: monitor [pane-id]"; cmd_monitor "$@" ;;
  awake)   cmd_awake ;;
  join)    [ $# -ge 3 ] || die "usage: join <role> <pane-to-split> <right|down> [ratio]"; cmd_join "$@" ;;
  bench)   [ $# -eq 1 ] || die "usage: bench <role>"; cmd_bench "$@" ;;
  link)    [ $# -le 1 ] || die "usage: link [worktree]"; cmd_link "$@" ;;
  assign)  ok=yes; [ $# -ge 2 ] || ok=no; i=3
           while [ "$ok" = yes ] && [ $i -le $# ]; do
             opt="${!i}"; j=$((i + 1)); val="${!j:-}"
             case "$opt:$val" in --effort:low | --effort:medium | --effort:high | --effort:xhigh | --effort:max) ;;
               --tier:light | --tier:standard | --tier:heavy) ;; *) ok=no ;; esac
             i=$((i + 2))
           done
           [ "$ok" = yes ] || die "usage: assign <role> <task-id> [--effort low|medium|high|xhigh|max] [--tier light|standard|heavy]"
           cmd_assign "$@" ;;
  send)    [ $# -ge 2 ] || die "usage: send <role> <message>"; ledger send "$1"; cmd_send "$@" ;;
  tell)    [ $# -ge 2 ] || die "usage: tell <role> <message>"; cmd_tell "$@" ;;
  drop)    [ $# -ge 2 ] || die "usage: drop <part of the note's text> <reason>"; cmd_drop "$@" ;;
  note)    [ $# -ge 1 ] || die "usage: note <one line>"; cmd_note "$@" ;;
  report)  [ $# -ge 1 ] || die "usage: report <one line>"; cmd_report "$@" ;;
  eval)    exec python3 "$HERE/team-eval.py" "$@" ;;
  status)  cmd_status ;;
  restart) [ $# -eq 1 ] || { [ $# -eq 2 ] && [ "$2" = --keep ]; } || die "usage: restart <role> [--keep]"; cmd_restart "$@" ;;
  pause)   [ $# -ge 1 ] || die "usage: pause <role>..."; cmd_pause "$@" ;;
  sleep)   [ $# -eq 0 ] || die "usage: sleep"; cmd_sleep ;;
  wake)    [ $# -eq 0 ] || die "usage: wake"; cmd_wake ;;
  fresh)   [ $# -ge 2 ] || die "usage: fresh <role> <first message>"; cmd_fresh "$@" ;;
  recover) [ $# -eq 0 ] || { [ $# -eq 1 ] && [ "$1" = --check ]; } || die "usage: recover [--check]"; cmd_recover "$@" ;;
  *)       usage; [ -z "$cmd" ] || exit 2 ;;
esac
