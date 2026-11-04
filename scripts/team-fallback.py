#!/usr/bin/env python3
"""The model fallback: an agent whose model's usage limit runs out goes on to another model, and comes back.

When the account runs out of one model's usage (Claude Code ends the turn with "You're out of usage credits ...
keep using Fable 5.1 or /model to switch models"), every agent on that model stops working until the limit
resets, days later. This keeps the team going: once a minute it reads each idle agent's screen, and when it finds
that message it restarts the agent on FALLBACK_MODEL at FALLBACK_EFFORT (scripts/team.conf; default Opus 5.5 at
xhigh) with its conversation kept, tells it to carry on, and notifies the owner. When the limit has reset (the time
the agents' screens showed in the warning before it ran out, else five hours later, then again), it puts the agent
back on its roster model at the next moment it is idle with nothing running in the background.

    python3 scripts/team-fallback.py watch            run until stopped (the "model fallback" pane in the Awake tab)
    python3 scripts/team-fallback.py status           which agents run on the fallback, until when
    python3 scripts/team-fallback.py set <role> [--until "2026-10-30 03:00"]   put one on the fallback by hand
    python3 scripts/team-fallback.py clear <role>     take it off (the next restart uses the roster's model)

The switch is a file, .team/model-override/<role> ("model|effort|until|reason"), which scripts/team.sh reads
whenever it starts the agent, so a restart or a recover keeps it. No model is called; the log is
.team/status/fallback.log.
"""
import datetime
import json
import os
import re
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import teamlib  # noqa: E402

TEAM_SH = os.path.join(HERE, "team.sh")
LIMITS = os.path.join(teamlib.STATUS, "limits.json")  # the reset times the warnings showed, by model family
LOG = os.path.join(teamlib.STATUS, "fallback.log")
RETRY = 5 * 3600  # when no reset time is known: try the roster's model again after this long
MARGIN = 5 * 60   # after a reset, wait this long before switching back

# "You're out of usage credits. Run /usage-credits to keep using Fable 5.1 or /model to switch models."
OUT = re.compile(r"out of usage credits\b.{0,120}?keep using ([A-Z][A-Za-z]+)\b.{0,60}?switch models", re.S)
# "You've used 86% of your Fable limit · resets Oct 30 at 3am"
WARNING = re.compile(r"used (\d+)% of your ([A-Z][A-Za-z]+) limit\s*·\s*resets (\w{3}) (\d{1,2})(?:,? at)? (\d{1,2})(?::(\d{2}))?\s*([ap]m)", re.I)
MONTHS = {m: i for i, m in enumerate(("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"), 1)}


def run(cmd, timeout=20):
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return out.stdout if out.returncode == 0 else ""
    except Exception:
        return ""


def log(text):
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')}  {text}"
    print(line, flush=True)
    try:
        os.makedirs(teamlib.STATUS, exist_ok=True)
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


def flat(screen):
    return re.sub(r"\s+", " ", screen or "")


def ran_out(screen):
    """The model family whose limit ended the agent's last turn ("Fable"), or None. Only the bottom of the screen
    counts (the message sits just above the input box), so an agent quoting it earlier in its work does not."""
    lines = [l for l in (screen or "").splitlines() if l.strip()]
    found = OUT.search(flat("\n".join(lines[-14:])))
    return found.group(1) if found else None


def warning_resets(screen, now=None):
    """{family: (used %, reset epoch)} from the "You've used 86% of your Fable limit · resets Oct 30 at 3am" lines."""
    now = now or time.time()
    found = {}
    for used, family, mon, day, hour, minute, ampm in WARNING.findall(flat(screen)):
        month = MONTHS.get(mon.lower()[:3])
        if not month:
            continue
        h = int(hour) % 12 + (12 if ampm.lower() == "pm" else 0)
        year = datetime.datetime.fromtimestamp(now).year
        try:
            when = datetime.datetime(year, month, int(day), h, int(minute or 0))
        except ValueError:
            continue
        if when.timestamp() < now - 86400 * 180:  # December's warning read in January
            when = when.replace(year=year + 1)
        found[family] = (int(used), when.timestamp())
    return found


def load_limits():
    try:
        with open(LIMITS, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_limits(limits):
    try:
        os.makedirs(teamlib.STATUS, exist_ok=True)
        tmp = LIMITS + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(limits, f)
        os.replace(tmp, LIMITS)
    except OSError:
        pass


def until_for(family, limits, now):
    """When to try the roster's model again: the reset a warning showed (if still ahead), else RETRY from now."""
    reset = (limits.get(family) or {}).get("resets_at")
    return (reset + MARGIN) if reset and reset > now else now + RETRY


def when(epoch):
    return time.strftime("%a %d %b %H:%M", time.localtime(epoch)) if epoch else "?"


def agents():
    """{role: Herdr's record} for this machine's team."""
    try:
        listing = json.loads(run(["herdr", "agent", "list"]) or "{}")["result"]["agents"]
    except (ValueError, KeyError, TypeError):
        return {}
    names = {teamlib.herdr_name(role): role for role, _model in teamlib.roster()}
    return {names[a["name"]]: a for a in listing if a.get("name") in names}


def screen_of(pane):
    return run(["herdr", "pane", "read", pane, "--source", "visible", "--lines", "60"])


def current_model(role):
    """The model the agent's own status line last reported, else ''."""
    try:
        with open(os.path.join(teamlib.STATUS, f"{role}.json"), encoding="utf-8") as f:
            return ((json.load(f).get("model") or {}).get("id")) or ""
    except (OSError, ValueError):
        return ""


def team_sh(*args):
    out = subprocess.run([TEAM_SH, *args], capture_output=True, text=True, timeout=600)
    return out.returncode == 0, (out.stdout + out.stderr).strip()


def notify(text):
    subprocess.run(["herdr", "notification", "show", teamlib.PROJECT, "--body", text, "--sound", "request"], capture_output=True)


def fall_back(role, family, until, restart=team_sh, tell=team_sh, note=notify):
    """Put the agent on the fallback model until `until`, restart it with its conversation, tell it, tell the owner."""
    model, effort = teamlib.FALLBACK_MODEL, teamlib.FALLBACK_EFFORT
    teamlib.write_override(role, model, effort, until, f"{family} limit")
    ok, out = restart("restart", role, "--keep")
    label = teamlib.model_label(model)
    if not ok:
        log(f"{role}: out of {family}; the override is written but the restart failed: {out[-200:]}")
        return False
    log(f"{role}: out of {family} usage; restarted on {label} at {effort} effort, until about {when(until)}")
    tell("tell", role, f"[team.sh model fallback] Your last turn stopped because the account is out of {family} usage. You now run on "
                       f"{label} at {effort} effort, with your conversation, until about {when(until)}, when the script puts you back. "
                       f"Carry on where you were: the board and your notes say what is in flight.")
    note(f"{role} ran out of {family} usage and now runs on {label} ({effort}) until about {when(until)}.")
    return True


def come_back(role, info, restart=team_sh, note=notify):
    """The limit has reset: back on the roster's model, if the agent is idle with nothing in the background."""
    if info.get("agent_status") not in ("idle", "done"):
        return False
    if teamlib.background_commands(screen_of(info.get("pane_id", ""))):
        return False
    teamlib.clear_override(role)
    ok, out = restart("restart", role, "--keep")
    if ok:
        log(f"{role}: the limit has reset; back on its roster model")
        note(f"{role} is back on its roster model.")
    else:
        log(f"{role}: back on its roster model at its next start (restart failed: {out[-200:]})")
    return ok


def tick(now=None, live=None, read=screen_of, fall=fall_back, back=come_back):
    """One round: learn reset times from warnings, switch agents that ran out, bring back the ones whose time is up."""
    now = now or time.time()
    if teamlib.asleep() or not teamlib.FALLBACK_MODEL:
        return
    live = agents() if live is None else live
    limits = load_limits()
    for role, info in live.items():
        screen = read(info.get("pane_id", "")) if info.get("pane_id") else ""
        for family, (used, reset) in warning_resets(screen, now).items():
            if (limits.get(family) or {}).get("resets_at") != reset:
                limits[family] = {"used": used, "resets_at": reset, "seen_at": now}
                save_limits(limits)
        override = teamlib.model_override(role)
        if override and override["until"] and now >= override["until"]:
            back(role, info)
            continue
        if override or info.get("agent_status") not in ("idle", "done"):
            continue
        family = ran_out(screen)
        if family and current_model(role) != teamlib.FALLBACK_MODEL:
            fall(role, family, until_for(family, limits, now))


def parse_time(text):
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M", "%Y-%m-%d"):
        try:
            return datetime.datetime.strptime(text, fmt).timestamp()
        except ValueError:
            pass
    raise SystemExit(f"team-fallback: '{text}' is not a time like 2026-10-30 03:00")


def main(argv):
    command = argv[0] if argv else "watch"
    if command == "watch":
        if not teamlib.FALLBACK_MODEL:
            print("The model fallback is off (FALLBACK_MODEL is empty in scripts/team.conf).")
            return 0
        print(f"Model fallback for {teamlib.PROJECT}: an agent out of its model's usage goes on to "
              f"{teamlib.model_label(teamlib.FALLBACK_MODEL)} ({teamlib.FALLBACK_EFFORT}) and comes back when the limit resets. "
              f"Checks once a minute; no model calls. Ctrl+C stops it.", flush=True)
        while True:
            try:
                tick()
            except Exception as error:  # a bad round is not the end of the watch
                log(f"a round failed: {error}")
            time.sleep(60)
    if command == "status":
        found = False
        for role, _model in teamlib.roster():
            o = teamlib.model_override(role)
            if o:
                found = True
                print(f"{role}: {teamlib.model_label(o['model'])} at {o['effort']} effort until {when(o['until'])} ({o['reason']})")
        if not found:
            print("Every agent runs on its roster model.")
        return 0
    if command in ("set", "clear") and len(argv) >= 2:
        role = argv[1]
        if role not in dict(teamlib.roster()):
            raise SystemExit(f"team-fallback: '{role}' is not on this team's roster")
        if command == "clear":
            teamlib.clear_override(role)
            print(f"{role}: back on the roster's model at its next start (scripts/team.sh restart {role} --keep)")
            return 0
        until = parse_time(argv[3]) if len(argv) >= 4 and argv[2] == "--until" else time.time() + RETRY
        teamlib.write_override(role, teamlib.FALLBACK_MODEL, teamlib.FALLBACK_EFFORT, until, "set by hand")
        print(f"{role}: {teamlib.model_label(teamlib.FALLBACK_MODEL)} at {teamlib.FALLBACK_EFFORT} effort until {when(until)}, "
              f"from its next start (scripts/team.sh restart {role} --keep); the watch brings it back then")
        return 0
    print(__doc__.split("\n\n")[1], file=sys.stderr)
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except KeyboardInterrupt:
        pass
