#!/usr/bin/env python3
"""At-a-glance view of the agent team.

Reads Herdr's agent states, each agent's visible screen, git, the session
transcripts on disk, and the files in .team/ (including the numbers that
scripts/team-statusline.py saves). It makes no model calls, so it uses none of
the plan's usage.

    python3 scripts/team-dash.py [seconds between refreshes, default 5]

Run it in a Herdr pane. Ctrl+C stops it. scripts/teamlib.py works out where the
repository is and who is on the team; with a partner team (PARTNER in team.conf) it
works on both machines, and shows what is open between the two teams on GitHub.
"""
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time

import teamlib
from teamlib import REPO, STATUS, TEAM, WORKTREES

SHARED_CHECKOUT = teamlib.IN_MAIN_CHECKOUT  # these work in REPO itself; the rest have worktrees

RESET, BOLD, DIM = "\033[0m", "\033[1m", "\033[2m"
RED, GREEN, YELLOW, CYAN = "\033[31m", "\033[32m", "\033[33m", "\033[36m"
STATE_STYLE = {
    "working": (GREEN, "●"),
    "idle": (DIM, "○"),
    "done": (DIM, "○"),
    "blocked": (RED + BOLD, "■"),
    "unknown": (YELLOW, "?"),
}


def run(cmd, timeout=6):
    demo = teamlib.demo_output(cmd)
    if demo is not None:
        return demo
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return out.stdout if out.returncode == 0 else ""
    except Exception:
        return ""


def git(checkout, *args):
    return run(["git", "-C", checkout, *args]).strip()


def roster():
    """Agent names and models for this machine's team; an agent on the model fallback shows that model, with a *."""
    out = []
    for name, model in teamlib.roster():
        override = teamlib.model_override(name)
        out.append((name, teamlib.model_label(override["model"]) + "*" if override else teamlib.model_label(model)))
    return out


ANSI = re.compile(r"(\033\[[0-9;]*m)")


def fit(line, width):
    """Cut a line to the pane's width, counting only the characters that show."""
    shown, kept = 0, []
    for part in ANSI.split(line):
        if ANSI.fullmatch(part):
            kept.append(part)
            continue
        room = width - shown
        if room <= 0:
            break
        if len(part) > room:
            kept.append(part[: max(room - 1, 0)] + "…")
            break
        kept.append(part)
        shown += len(part)
    return "".join(kept) + RESET


def flow(line, width):
    """Break a line of parts separated by three spaces into as many lines as the width needs."""
    lines, current = [], ""
    for part in line.split("   "):
        candidate = part if not current else current + "   " + part
        if current and len(ANSI.sub("", candidate)) > width:
            lines.append(current)
            current = part
        else:
            current = candidate
    return lines + [current]


def cut(text, width):
    text = text.replace("\t", " ")
    return text if len(text) <= width else text[: max(width - 1, 0)] + "…"


def short(n):
    if not n:
        return "?"
    return f"{n / 1_000_000:g}M" if n >= 1_000_000 else f"{round(n / 1000)}k"


def bar(percent, cells=10):
    filled = max(0, min(cells, round(percent / 100 * cells)))
    return "▰" * filled + "▱" * (cells - filled)


def load_statuses():
    """The latest numbers each agent's status line saved, by agent name."""
    found = {}
    for path in glob.glob(f"{STATUS}/*.json"):
        base = os.path.basename(path)
        if base.startswith(("_", ".")) or path == teamlib.WATCH_FILE:
            continue
        try:
            data = json.load(open(path))
        except (OSError, ValueError):
            continue
        found[data.get("session_name") or base[:-5]] = data
    return found


def window_sizes(statuses):
    """Context window size per model, learned from status lines and remembered."""
    path = f"{STATUS}/_windows.json"
    try:
        sizes = json.load(open(path))
    except (OSError, ValueError):
        sizes = {}
    changed = False
    for data in statuses.values():
        model = (data.get("model") or {}).get("id")
        size = (data.get("context_window") or {}).get("context_window_size")
        if model and size and sizes.get(model) != size:
            sizes[model] = size
            changed = True
    if changed:
        try:
            os.makedirs(STATUS, exist_ok=True)
            json.dump(sizes, open(path, "w"))
        except OSError:
            pass
    return sizes


_TRANSCRIPTS = {}


def transcript_context(session_id):
    """(tokens in context, model id) from the last reply in a session's transcript."""
    if not session_id:
        return None, None
    path = _TRANSCRIPTS.get(session_id)
    if not path:
        matches = glob.glob(os.path.expanduser(f"~/.claude/projects/*/{session_id}.jsonl"))
        if not matches:
            return None, None
        path = _TRANSCRIPTS[session_id] = matches[0]
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)
            f.seek(max(0, f.tell() - 800_000))
            chunk = f.read().decode("utf-8", "replace")
    except OSError:
        return None, None
    for line in reversed(chunk.splitlines()):
        if '"usage"' not in line:
            continue
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        message = entry.get("message") or {}
        usage = message.get("usage")
        if entry.get("type") != "assistant" or entry.get("isSidechain") or not usage:
            continue
        if message.get("model") == "<synthetic>":
            continue
        tokens = sum(usage.get(k) or 0 for k in ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"))
        return tokens, message.get("model")
    return None, None


def context_for(name, info, statuses, sizes):
    """(percent used or None, label) for an agent's context window."""
    session = (info.get("agent_session") or {}).get("value")
    saved = statuses.get(name)
    if saved and saved.get("session_id") == session:
        window = saved.get("context_window") or {}
        if window.get("used_percentage") is not None:
            return window["used_percentage"], f"of {short(window.get('context_window_size'))}"
    tokens, model = transcript_context(session)
    if tokens is None:
        return None, "empty"
    size = sizes.get(model) or next((v for k, v in sizes.items() if model and (model.startswith(k) or k.startswith(model))), None)
    if size:
        return 100 * tokens / size, f"of {short(size)}"
    return None, f"{short(tokens)} tokens"


def plan_usage(statuses):
    """The plan's usage limits, from whichever agent reported most recently."""
    latest = None
    for data in statuses.values():
        if data.get("rate_limits") and (latest is None or data.get("received_at", 0) > latest.get("received_at", 0)):
            latest = data
    if not latest:
        return f"{DIM}no data yet (it arrives with the next turn of an agent started by team.sh){RESET}"
    parts = []
    now = time.time()
    for key, label in (("five_hour", "5h"), ("seven_day", "week")):
        limit = latest["rate_limits"].get(key) or {}
        used = limit.get("used_percentage")
        if used is None:
            continue
        resets = limit.get("resets_at") or 0
        if resets and resets < now:
            parts.append(f"{label} {DIM}reset at {time.strftime('%a %H:%M', time.localtime(resets))}, no newer reading{RESET}")
            continue
        left = 100 - used
        colour = GREEN if left > 40 else YELLOW if left > 15 else RED
        when = time.strftime("%a %H:%M", time.localtime(resets)) if resets else "?"
        parts.append(f"{label} {colour}{bar(used, 8)} {left:.0f}% left{RESET} {DIM}resets {when}{RESET}")
    received = latest.get("received_at", 0)
    minutes = int((now - received) / 60)
    age = "just now" if minutes < 1 else f"{minutes} min ago"
    stale = YELLOW if minutes >= 10 else DIM
    # The age goes first so a narrow pane cannot cut it off.
    return "   ".join(parts) + f"   {stale}read {age}{RESET}"


def background_shells(screen):
    """The status bar's count of background commands ("· 2 shells") in words, or "" (teamlib.background_commands)."""
    n = teamlib.background_commands(screen)
    return f"{n} background command{'s' if n != 1 else ''}" if n else ""


def screen_summary(name):
    """What the agent's own screen says it is doing, from the visible viewport."""
    screen = run(["herdr", "agent", "read", teamlib.herdr_name(name), "--source", "visible", "--lines", "80"])
    timing, last = "", ""
    for line in screen.splitlines():
        text = line.strip()
        spinner = re.match(r"^\S\s+(\w+)…\s*\((.*?)[·)]", text)
        if spinner:
            timing = f"for {spinner.group(2).strip()}"
        finished = re.search(r"·\s*done\s+(.+?)(?:\s+·|$)", text)
        if finished:
            timing = f"finished {finished.group(1).strip()}"
        if text.startswith("⏺"):
            last = text.lstrip("⏺ ").strip()
    return timing, last, background_shells(screen)


def work_summary(name):
    """Which task the agent's checkout is on, and how much is uncommitted."""
    if name == "architect":
        return ""
    checkout = REPO if name in SHARED_CHECKOUT else f"{WORKTREES}/{name}"
    if not os.path.isdir(checkout):
        return "no checkout"
    branch = git(checkout, "rev-parse", "--abbrev-ref", "HEAD")
    dirty = len([l for l in git(checkout, "status", "--porcelain").splitlines() if l.strip()])
    changed = f", {dirty} file{'s' if dirty != 1 else ''} uncommitted" if dirty else ""
    base = teamlib.BRANCH
    if branch == base:
        return f"on {base}{changed}"
    ahead = git(checkout, "rev-list", "--count", f"{base}..HEAD") or "0"
    if branch == "HEAD":
        behind = git(checkout, "rev-list", "--count", f"HEAD..{base}") or "0"
        where = f"at {base}" if behind == "0" else f"{behind} behind {base}"
        return f"no task branch ({where}){changed}"
    commits = f"{ahead} commit{'s' if ahead != '1' else ''}"
    return f"{branch}: {commits}{changed}"


def section(path, heading):
    """Non-empty lines under a '## heading' in a markdown file."""
    try:
        text = open(path).read()
    except OSError:
        return None
    match = re.search(rf"^## {re.escape(heading)}\s*\n(.*?)(?=^## |\Z)", text, re.M | re.S)
    if not match:
        return []
    return [l.rstrip() for l in match.group(1).splitlines() if l.strip()]


def board_rows():
    try:
        lines = open(f"{TEAM}/board.md").read().splitlines()
    except OSError:
        return [], []
    notes = [l.strip() for l in lines if l.lower().startswith(("open milestone", "**m"))]
    rows = []
    for line in lines:
        if not line.startswith("|") or set(line) <= set("|- "):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) >= 4 and cells[0].lower() != "task":
            rows.append(cells[:4])
    return notes, rows


def span(seconds):
    """3 h 10 min as '3h 10m', under an hour as '25m'."""
    minutes = max(0, int(seconds // 60))
    return f"{minutes // 60}h {minutes % 60}m" if minutes >= 60 else f"{minutes}m"


def pid_alive(pid):
    try:
        os.kill(int(pid), 0)
        return True
    except PermissionError:
        return True
    except (OSError, ValueError, TypeError):
        return False


def watchdog_status(data=None, now=None, alive=pid_alive):
    """(words, healthy) from the heartbeat scripts/team-watch.sh writes every minute: 'alive 2h 10m' while the
    beat is under 3 minutes old and its process lives, 'ended 5m ago (<reason>)' when it ended and said why,
    else 'none'. Read from this team's own file, so another team's watchdog never counts."""
    if data is None:
        try:
            with open(teamlib.WATCH_FILE) as f:
                data = json.load(f)
        except (OSError, ValueError):
            return "none", False
    now = time.time() if now is None else now
    if data.get("ended"):
        return f"ended {span(now - (data.get('ended_at') or now))} ago ({data['ended']})", False
    beat, started = data.get("beat_at") or 0, data.get("started_at") or 0
    if now - beat < 180 and alive(data.get("pid")):
        return f"alive {span(now - started)}", True
    return "none", False


COST_FILE = os.path.join(STATUS, "_cost-cache.json")  # numbers only, never transcript text
COST_EVERY = 300  # seconds between two readings of the transcripts
_COST = {"running": False}


def refresh_cost():
    """Ask scripts/team-cost.py for the open milestone's total and keep the numbers in COST_FILE. Slow (it reads
    transcripts), so it runs in a thread of its own; a failure keeps the old numbers."""
    try:
        with open(COST_FILE) as f:
            cache = json.load(f)
    except (OSError, ValueError):
        cache = {}
    try:
        out = subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "team-cost.py"),
                              "--milestone", "open", "--json"], capture_output=True, text=True, timeout=180)
        data = json.loads(out.stdout)
        cache = {"milestone": str(data["label"]), "cost": float(data["total"]["cost"]), "turns": int(data["total"]["turns"])}
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
        pass
    cache["at"] = time.time()
    try:
        os.makedirs(STATUS, exist_ok=True)
        tmp = COST_FILE + ".tmp"
        with open(tmp, "w") as f:
            json.dump(cache, f)
        os.replace(tmp, COST_FILE)
    except OSError:
        pass
    _COST["running"] = False


def cost_line(now=None, start=None):
    """'M35 so far: $16.01, 233 turns' for the open milestone, from COST_FILE; None until the first reading. A
    reading older than COST_EVERY is asked for again in the background, so the screen never waits for it."""
    if os.environ.get("TEAM_DEMO"):
        return None
    now = time.time() if now is None else now
    try:
        with open(COST_FILE) as f:
            cache = json.load(f)
    except (OSError, ValueError):
        cache = {}
    if now - (cache.get("at") or 0) >= COST_EVERY and not _COST["running"]:
        _COST["running"] = True
        (start or (lambda: threading.Thread(target=refresh_cost, daemon=True).start()))()
    if not cache.get("milestone"):
        return None
    return f"{cache['milestone']} so far: ${cache['cost']:,.2f}, {cache['turns']:,} turns {DIM}(estimated, API prices){RESET}"


_OTHER = {"at": 0.0, "lines": []}


def other_team():
    """Open pull requests and issues on GitHub, shared with the other team; asked every two minutes."""
    if time.time() - _OTHER["at"] < 120:
        return _OTHER["lines"]
    lines = []
    try:
        prs = json.loads(run(["gh", "pr", "list", "--state", "open", "--limit", "8", "--json", "number,title,author"], timeout=20) or "[]")
        issues = json.loads(run(["gh", "issue", "list", "--state", "open", "--limit", "12", "--json", "number,title,labels,author"], timeout=20) or "[]")
    except ValueError:
        prs, issues = [], []
    for pr in prs:
        lines.append(f"pull request #{pr['number']}  {pr['author']['login']:<12} {pr['title']}")
    for issue in issues:
        labels = [label["name"] for label in issue.get("labels", [])]
        kind = next((l for l in teamlib.PARTNER_LABELS if l in labels), "issue")
        lines.append(f"{kind} #{issue['number']}  {issue['author']['login']:<12} {issue['title']}")
    _OTHER["at"], _OTHER["lines"] = time.time(), lines
    return lines


def last_heard():
    """'last heard from them 7 min ago' from the listener's mark (its first token is the time), or ''."""
    try:
        with open(teamlib.TALK_MARK) as f:
            heard = int((time.time() - float(f.read().split()[0])) / 60)
    except (OSError, ValueError, IndexError):
        return ""
    return f"last heard from them {heard} min ago" if heard < 600 else ""


def render(agents, width, height):
    out = []
    live = {}
    listing = run(["herdr", "agent", "list"])
    if listing:
        try:
            for a in json.loads(listing)["result"]["agents"]:
                if a.get("name"):
                    live[a["name"]] = a
        except (ValueError, KeyError):
            pass

    # caffeinate on macOS, systemd-inhibit on Linux
    awake = bool(run(["pgrep", "-x", "caffeinate"]).strip() or run(["pgrep", "-f", "systemd-inhibit"]).strip())
    flag = lambda ok, yes, no: f"{GREEN}{yes}{RESET}" if ok else f"{YELLOW}{no}{RESET}"

    out.append(f"{BOLD}{teamlib.TEAM_TITLE}{RESET}   {time.strftime('%H:%M:%S')}")
    if teamlib.PARTNER_SIDE:  # the partner's machine: no base branch of its own to push, its own watch
        out.append(f"Kept awake: {flag(awake, 'yes', 'no')}")
    else:
        watch, watch_ok = watchdog_status()
        unpushed = git(REPO, "rev-list", "--count", f"origin/{teamlib.BRANCH}..{teamlib.BRANCH}")
        backup = "no remote" if unpushed == "" else ("up to date" if unpushed == "0" else f"{unpushed} commits not pushed")
        out.append(
            f"Kept awake: {flag(awake, 'yes', 'no')}   "
            f"watchdog: {flag(watch_ok, watch, watch)}   "
            f"GitHub backup: {flag(unpushed == '0', backup, backup)}"
        )
    if teamlib.partner_active():
        listening = bool(run(["pgrep", "-f", "github-activity.py --listen"]).strip())
        try:  # when the listener last got an answer from GitHub
            quiet = int((time.time() - float(open(f"{STATUS}/_listener-check").read().strip())) / 60)
        except (OSError, ValueError):
            quiet = None
        if listening and quiet is not None and quiet >= 3:
            state = f"{YELLOW}running, but GitHub has not answered for {quiet} min{RESET}"
        else:
            state = flag(listening, "yes", "no")
        out[-1] += f"   listening for {teamlib.OTHER_TEAM}: {state}"
    out.extend(flow(out.pop(), width))
    statuses = load_statuses()
    sizes = window_sizes(statuses)
    out.extend(flow(f"Plan usage: {plan_usage(statuses)}", width))
    if not teamlib.PARTNER_SIDE:
        spent = cost_line()
        if spent:
            out.append(spent)
    for name, _model in teamlib.roster():
        override = teamlib.model_override(name)
        if override:
            until = time.strftime("%a %H:%M", time.localtime(override["until"])) if override["until"] else "?"
            out.append(f"{YELLOW}* {name} runs on {teamlib.model_label(override['model'])} ({override['effort']}) until about {until}: "
                       f"{override['reason'] or 'the model fallback'}{RESET}")
    out.append("")

    for name, model in agents:
        info = live.get(teamlib.herdr_name(name))
        if not info:
            out.append(f"{RED}✕ {name:<10}{RESET} {DIM}{model:<11}{RESET} {RED}not running{RESET}")
            out.append("")
            continue
        status = info.get("agent_status", "unknown")
        colour, mark = STATE_STYLE.get(status, STATE_STYLE["unknown"])
        shown = "idle" if status == "done" else status
        timing, last, shells = screen_summary(name)
        detail = " · ".join(x for x in (timing, shells) if x)
        head = f"{mark} {name:<10}"
        percent, label = context_for(name, info, statuses, sizes)
        if percent is None:
            context, context_colour = f"{'':<10} {label}", DIM
        else:
            context = f"{bar(percent)} {percent:.0f}% {label}"
            context_colour = GREEN if percent < 60 else YELLOW if percent < 85 else RED
        context = f"{context:<24}"
        # The model it runs now, as its own status line reports it: a task's tier can differ from the roster.
        live_model = ((statuses.get(name) or {}).get("model") or {}).get("id")
        if live_model and not model.endswith("*"):
            model = teamlib.model_label(live_model)
        left = f"{model:<11} {shown:<8} "
        room = width - len(head) - 1 - len(left) - len(context) - 1
        out.append(f"{colour}{head}{RESET} {left}{context_colour}{context}{RESET} {cut(detail, max(room, 0))}")
        work = work_summary(name)
        if work:
            out.append(f"  {cut(work, width - 2)}")
        if last:
            out.append(f"  {DIM}{cut(last, width - 2)}{RESET}")
        out.append("")

    needs = section(teamlib.NEEDS_FILE, "Needs you")
    if needs is not None:
        items = [l for l in needs if not l.startswith("Questions only you")]
        if items:
            out.append(f"{RED}{BOLD}NEEDS YOU{RESET}  {DIM}.team/{os.path.basename(teamlib.NEEDS_FILE)}{RESET}")
            out.extend(f"  {cut(l, width - 2)}" for l in items[:8])
        else:
            out.append(f"{BOLD}NEEDS YOU{RESET}  {DIM}nothing right now{RESET}")
        out.append("")

    if teamlib.partner_active():
        shared = other_team()
        last = last_heard()
        out.append(f"{BOLD}WITH {teamlib.OTHER_TEAM.upper()}{RESET}  {DIM}open on GitHub{' · ' + last if last else ''}{RESET}")
        if shared:
            out.extend(f"  {cut(l, width - 2)}" for l in shared[:8])
        else:
            out.append(f"  {DIM}nothing open{RESET}")
        out.append("")

    notes, rows = board_rows()
    out.append(f"{BOLD}BOARD{RESET}")
    out.extend(f"  {cut(re.sub(r'[*`]', '', n), width - 2)}" for n in notes[:2])
    for task, title, owner, state in rows[:12]:
        out.append("  " + cut(f"{task:<7} {owner:<10} {state:<22} {title}", width - 2))
    out.append("")

    out.append(f"{BOLD}LATEST ON {teamlib.BRANCH.upper()}{RESET}")
    for line in git(REPO, "log", "-5", "--format=%cr|%s", teamlib.BRANCH).splitlines():
        when, _, subject = line.partition("|")
        out.append("  " + cut(f"{when:<15} {subject}", width - 2))

    reports = run(["tail", "-3", f"{TEAM}/reports.log"]).splitlines()
    if reports:
        out.append("")
        out.append(f"{BOLD}REPORTS{RESET}")
        out.extend("  " + cut(r, width - 2) for r in reports)

    # Every line is cut to the pane's width and the frame to its height. A line that wrapped,
    # or a frame one row too tall, would scroll the pane and leave old title lines behind.
    return [fit(line, width) for line in out[: max(height - 1, 5)]]


def main():
    interval = float(sys.argv[1]) if len(sys.argv) > 1 else 5.0
    # Alternate screen, no line wrapping, no cursor: nothing drawn here reaches the scrollback.
    sys.stdout.write("\033[?1049h\033[?7l\033[?25l")
    try:
        while True:
            size = shutil.get_terminal_size((100, 40))
            lines = render(roster(), size.columns, size.lines)
            sys.stdout.write("\033[H" + "\033[K\n".join(lines) + "\033[K\033[J")
            sys.stdout.flush()
            time.sleep(teamlib.refresh_after(interval))
    except KeyboardInterrupt:
        pass
    finally:
        sys.stdout.write("\033[?7h\033[?25h\033[?1049l")


if __name__ == "__main__":
    main()
