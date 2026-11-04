"""Shared by the team's monitoring scripts: where things are and who is on the team.

Nothing here is tied to one machine or one project: the repository is found from where this file
is, and the project's choices come from scripts/team.conf and scripts/roster.conf (agent-team-kit).

    python3 scripts/teamlib.py where       the team folder, the status folder and the watchdog's file, one a line
    python3 scripts/teamlib.py in-flight   why work is in flight, or nothing (exit 1); team-watch.sh asks it
"""
import json
import os
import re
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))


def _repo():
    """The main checkout of the repository, even when a script is run from a worktree."""
    try:
        out = subprocess.run(
            ["git", "-C", HERE, "rev-parse", "--path-format=absolute", "--git-common-dir"],
            capture_output=True, text=True, timeout=5,
        )
        if out.returncode == 0 and out.stdout.strip():
            return os.path.dirname(out.stdout.strip())
    except Exception:
        pass
    return os.path.dirname(HERE)


def _conf():
    """KEY="value" lines of scripts/team.conf, the way bash reads them (no expansion)."""
    values = {}
    try:
        for line in open(os.path.join(HERE, "team.conf")):
            match = re.match(r'^\s*([A-Z_]+)=(?:"([^"]*)"|\'([^\']*)\'|([^#\s]*))', line)
            if match:
                values[match.group(1)] = next(g for g in match.groups()[1:] if g is not None)
    except OSError:
        pass
    return values


REPO = _repo()
WORKTREES = REPO + "-worktrees"
TEAM = os.path.join(REPO, ".team")
STATUS = os.path.join(TEAM, "status")  # written by team-statusline.py

CONF = _conf()
PROJECT = CONF.get("PROJECT") or os.path.basename(REPO)
PREFIX = CONF.get("PREFIX", "")
# The base branch (BRANCH in team.conf): tasks branch from it and merge into it; the worktrees are made from it.
BRANCH = CONF.get("BRANCH") or "main"


def herdr_name(role):
    """The Herdr agent name of a role: `builder-1` is `<prefix>-builder-1` when the team has a prefix, so
    that two teams on one machine can both have a builder-1."""
    return f"{PREFIX}-{role}" if PREFIX else role


# The team's shape: an architect who runs the loop, workers in their own worktrees.
ORCHESTRATOR = "architect"
IN_MAIN_CHECKOUT = ("architect",)  # the rest have worktrees
WAITERS = ("architect",)  # idle often means waiting, not rest
# The owner (OWNER in team.conf) and the file the architect keeps for them, named after them.
OWNER = CONF.get("OWNER", "")
OWNER_NAME = OWNER or "the owner"


def slug(name, default):
    return re.sub(r"[^a-z0-9]", "", name.lower()) or default


OWNER_SLUG = slug(OWNER, "owner")

# --- A partner team (PARTNER in team.conf) ----------------------------------------------------------------
# Another person's team that works on this repository from its own machine, through GitHub only: issues for
# requests and questions, pull requests for work, none of the owner's credentials, no live link between the
# machines. Both machines run these same scripts from their own checkout, so nothing in git tells them apart:
# the partner's machine has a marker file in its .team/ (`scripts/team.sh init --side partner` writes it).
# On that machine the roster is PARTNER_DIR/roster.local.conf (else PARTNER_DIR/roster.conf), the file the
# architect keeps is for its own person, and the other team is the owner's.
PARTNER = CONF.get("PARTNER", "")  # the partner team's person; empty: this project has no partner team
PARTNER_DIR = os.path.join(REPO, CONF.get("PARTNER_DIR") or "partner-team")  # their roster and rules, in git
PARTNER_LABELS = CONF.get("PARTNER_LABELS", "").split()  # issue labels the dashboard names (proposal, ...)
PARTNER_MARKERS = ("this-is-the-partner-team", "this-is-the-support-team")  # the second: an earlier name


def is_partner_side(team_dir=TEAM):
    """Whether this machine runs the partner team (the marker in its .team/)."""
    return any(os.path.exists(os.path.join(team_dir, m)) for m in PARTNER_MARKERS)


PARTNER_SIDE = is_partner_side()
SUPPORT = PARTNER_SIDE  # the name an earlier version used
# The person this machine's team works for, and the other team, by its person.
PERSON = (PARTNER or "the partner") if PARTNER_SIDE else OWNER_NAME
OTHER_TEAM = f"{OWNER_NAME}'s team" if PARTNER_SIDE else (f"{PARTNER}'s team" if PARTNER else "the partner team")
TEAM_TITLE = f"{PROJECT.upper()} · {PERSON.upper()}'S TEAM" if PARTNER_SIDE else f"{PROJECT.upper()} TEAM"
# The file where the architect lists what is waiting on its human.
NEEDS_FILE = os.path.join(TEAM, f"for-{slug(PARTNER, 'partner')}.md" if PARTNER_SIDE else f"for-{OWNER_SLUG}.md")
# The listener (scripts/github-activity.py) writes the time here, and the agents it told, when the other team
# does something on GitHub; the dashboard and the office read it.
TALK_MARK = os.path.join(STATUS, "_other-team-activity")


def partner_active():
    """Whether there is another team to hear from: a partner named in team.conf, or this is the partner's machine."""
    return PARTNER_SIDE or bool(PARTNER)


other_active = partner_active  # the name an earlier version used

# Who the listener wakes for each kind of thing the other team does (github-activity.py --listen --route):
#   "issue"                a new issue, or a comment on one
#   "pull request"         a new pull request, new commits on one, or a comment or review on an open one
#   "closed pull request"  anything on a merged or closed pull request, one of your own being merged included
# None wakes nobody: the listener writes the line in its own pane, with the time. The owner's team routes; the
# partner's sends everything to its architect.
LISTEN_ROUTES = {
    "main": {"issue": "architect", "pull request": "architect", "closed pull request": None},
}


def listen_routes(team_dir=TEAM):
    """This machine's row of LISTEN_ROUTES, or None (everything to one agent) on the partner's machine."""
    return None if is_partner_side(team_dir) else LISTEN_ROUTES.get("main")


is_support = is_partner_side  # the name an earlier version used
ASLEEP_FILE = os.path.join(TEAM, "asleep")  # written by `team.sh sleep`: since when the team sleeps


def asleep():
    """Since when the team sleeps (team.sh sleep), or '' when it does not."""
    try:
        with open(ASLEEP_FILE, encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


def anyone_working():
    """Whether one of this team's agents is working now, by Herdr's list (the demo file in demo mode)."""
    if asleep():
        return False
    out = demo_output(["herdr", "agent", "list"])
    if out is None:
        try:
            out = subprocess.run(["herdr", "agent", "list"], capture_output=True, text=True, timeout=6).stdout
        except Exception:
            out = ""
    try:
        agents = json.loads(out)["result"]["agents"]
    except (ValueError, KeyError, TypeError):
        return False
    mine = {herdr_name(role) for role, _model in roster()}
    return any(a.get("name") in mine and a.get("agent_status") == "working" for a in agents)


def refresh_after(active, quiet=20.0):
    """How long a view waits before it draws again: `active` seconds while an agent works, `quiet` otherwise.
    A team nobody is working on then costs almost nothing to watch."""
    return active if anyone_working() else max(active, quiet)


def roster_file():
    """scripts/roster.conf, or on the partner's machine PARTNER_DIR/roster.local.conf (else PARTNER_DIR/roster.conf)."""
    if not PARTNER_SIDE:
        return os.path.join(HERE, "roster.conf")
    local = os.path.join(PARTNER_DIR, "roster.local.conf")
    return local if os.path.exists(local) else os.path.join(PARTNER_DIR, "roster.conf")


def roster():
    """(role, model id) for every agent on this machine's team, in layout order (roster_file())."""
    agents = []
    try:
        for line in open(roster_file()):
            line = line.strip()
            if line and not line.startswith("#"):
                parts = line.split("|")
                if len(parts) >= 3:
                    agents.append((parts[0].strip(), parts[2].strip()))
    except OSError:
        pass
    return agents


# --- The model fallback (scripts/team-fallback.py) -----------------------------------------------------------
# When the account runs out of one model's usage, an agent on it goes on to FALLBACK_MODEL at FALLBACK_EFFORT until
# the limit resets. An absent setting means the default; an empty FALLBACK_MODEL turns the fallback off.
FALLBACK_MODEL = CONF.get("FALLBACK_MODEL", "claude-opus-5-5")
FALLBACK_EFFORT = CONF.get("FALLBACK_EFFORT", "xhigh") or "xhigh"
# One file per agent on the fallback, "model|effort|until (epoch)|reason"; scripts/team.sh reads it at every start.
OVERRIDE_DIR = os.path.join(TEAM, "model-override")


def model_override(role, now=None):
    """{model, effort, until, reason} while the agent runs on a model other than its roster's, else None. An override
    whose time has passed still shows here until the watch takes it away (team.sh no longer starts on it)."""
    try:
        with open(os.path.join(OVERRIDE_DIR, role), encoding="utf-8") as f:
            parts = (f.read().strip().split("|") + ["", "", "", ""])[:4]
    except OSError:
        return None
    if not parts[0]:
        return None
    try:
        until = float(parts[2]) if parts[2] else 0.0
    except ValueError:
        until = 0.0
    return {"model": parts[0], "effort": parts[1] or FALLBACK_EFFORT, "until": until, "reason": parts[3]}


def write_override(role, model, effort, until, reason):
    os.makedirs(OVERRIDE_DIR, exist_ok=True)
    tmp = os.path.join(OVERRIDE_DIR, f".{role}.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(f"{model}|{effort}|{int(until) if until else ''}|{reason}\n")
    os.replace(tmp, os.path.join(OVERRIDE_DIR, role))


def clear_override(role):
    try:
        os.remove(os.path.join(OVERRIDE_DIR, role))
    except OSError:
        pass


def model_label(model_id):
    """claude-opus-5-5 -> Opus 5.5"""
    parts = model_id.replace("claude-", "").split("-")
    version = ".".join(p for p in parts[1:] if p.isdigit() and len(p) < 3)
    return f"{parts[0].capitalize()} {version}".strip()


def demo_output(cmd):
    """Demo mode: with TEAM_DEMO set to a JSON file, Herdr's agent list and screen reads and the process
    checks are answered from that file, so the views can show a fictional team (the kit's README
    screenshots come from overview/demo.py). None outside demo mode or for any other command."""
    path = os.environ.get("TEAM_DEMO")
    if not path:
        return None
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None
    if cmd[:3] == ["herdr", "agent", "list"]:
        return json.dumps({"result": {"agents": data.get("agents", [])}})
    if cmd[:3] == ["herdr", "agent", "read"] and len(cmd) > 3:
        return data.get("screens", {}).get(cmd[3], "")
    if cmd and cmd[0] == "pgrep":
        return "1\n" if any(p in " ".join(cmd) for p in data.get("processes", [])) else ""
    return None


# --- Work in flight, for the architect's watchdog (scripts/team-watch.sh) ------------------------------------
# The watchdog writes a heartbeat here every minute; the dashboard shows it ("watchdog: alive 2h 10m").
WATCH_FILE = os.path.join(STATUS, "watch.json")
# Work is in flight when a task row on the board has a State starting with one of these words (case ignored).
IN_FLIGHT_STATES = (
    "assigned", "ready", "building", "in review", "review", "reviewing", "verify", "verifying",
    "changes requested", "design pass", "running", "in progress",
)
_IN_FLIGHT = re.compile(r"^\W*(" + "|".join(re.escape(s) for s in IN_FLIGHT_STATES) + r")\b", re.I)


def board_in_flight(path=None):
    """The board's task rows in flight, as "T-477 building", from every table with a State column."""
    try:
        with open(path or os.path.join(TEAM, "board.md"), encoding="utf-8") as f:
            lines = f.read().splitlines()
    except OSError:
        return []
    found, state_col = [], None
    for line in lines:
        if not line.lstrip().startswith("|"):
            state_col = None
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if all(set(c) <= set("-: ") for c in cells):
            continue  # the separator row
        if state_col is None:
            lowered = [c.lower() for c in cells]
            state_col = lowered.index("state") if "state" in lowered else -1
            continue  # the header row
        if 0 <= state_col < len(cells) and _IN_FLIGHT.match(cells[state_col]):
            task = cells[0].split()[0] if cells[0] else "?"
            found.append(f"{task} {cells[state_col].split('(')[0].strip()}")
    return found


def in_flight(board=None):
    """Why work is in flight, as one line ("board: T-12 building, T-13 ready"), or "" when nothing is."""
    rows = board_in_flight(board)
    if not rows:
        return ""
    return "board: " + ", ".join(rows[:6]) + (f" and {len(rows) - 6} more" if len(rows) > 6 else "")


def background_commands(screen):
    """How many background commands an agent's status bar says are running ("· 2 shells"), 0 if none.
    Only a count after a "·" counts, so "ran 2 shell commands" in the transcript does not; neither does the
    "· 1 shell still running" that ends a finished turn, which says what ran when the turn ended and stays on
    the screen after the command is gone. The last bar on the screen wins."""
    found = re.findall(r"·\s*(\d+) shells?\b(?!\s+still\s+running)", screen or "")
    return int(found[-1]) if found else 0


if __name__ == "__main__":
    import sys

    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command == "where":
        print(TEAM)
        print(STATUS)
        print(WATCH_FILE)
    elif command == "in-flight":
        reason = in_flight()
        if reason:
            print(reason)
        sys.exit(0 if reason else 1)
    else:
        print("usage: teamlib.py where | in-flight", file=sys.stderr)
        sys.exit(2)
