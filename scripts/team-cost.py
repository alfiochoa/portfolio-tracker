#!/usr/bin/env python3
"""The team's cost ledger: what a milestone cost, by model, by agent and by task.

    python3 scripts/team-cost.py --milestone M35            # the table, as text
    python3 scripts/team-cost.py --milestone M35 --markdown  # the same as markdown (saved as M<n>-cost.md)
    python3 scripts/team-cost.py --milestone open --json     # for the dashboard: the open milestone
    python3 scripts/team-cost.py --since m33                 # from that tag's commit time until now
    python3 scripts/team-cost.py --from 2026-10-21T00:00:00Z --to 2026-10-22T00:00:00Z

It makes no model calls and touches nothing but these two things:

1. The session transcripts under ~/.claude/projects/ of the main checkout (the architect) and
   of each worktree (<repo>-worktrees/<agent>, plus the sub-agents a session started). From each
   assistant message it takes ONLY: the message id, the model, the timestamp and the usage block (input,
   output, cache read, cache write tokens, and whether the turn ran in fast mode). Every line is parsed
   and everything else in it is dropped on the spot: **message content is never printed, stored or
   copied**, not to the output, not to a file, not to the cache (a transcript once held a secret).
2. `.team/status/assignments.log`, written by `team.sh assign`, `send` and `fresh`, one line per call,
   tab-separated, never the message text:

       <UTC time, 2026-10-22T09:15:03Z> TAB <assign|send|fresh> TAB <agent> TAB <task id, or -> TAB <label, or ->

   The label says how an `assign` differed from the roster: the task's tier (light or heavy, with
   TASK_TIERS) and a raised effort, comma-separated ("light", "xhigh", "heavy"). The "By tier" table sums
   the tasks by tier when any task had one.

   For `assign` the task id is the one assigned; for `send` and `fresh` it is the agent's current task
   if `team.sh` knows it, else `-`. A line with a task id makes that the agent's task from then on; a
   line with `-` changes nothing. A turn is attributed to the task of the agent's latest such line before
   it; before any, or for an agent that is never assigned (the architect), to "(no task)".

Which agent a transcript belongs to: a worktree's folder names it (builder-1, designer, ...). The main
checkout's folder may hold more than one session (the architect's, and any other run there) and tells them apart in this order:
(1) the `agent-name` entry Claude Code writes into the transcript itself (the last one wins), the signal
the transcripts carry; (2) the statusline file `.team/status/<agent>.json`, whose `session_id` names
the agent's current session; (3) the model: Fable is the architect, anything else is listed as other. A turn is
counted once however many content blocks it was written in (they share a message id), and once however
many files hold it. Sub-agents belong to the agent whose session started them.

The estimated cost is tokens times the price table below; a model that is not in the table is counted
and shown as "no price" instead of guessed. Not priced at all: web searches (server tools), batch
discounts and anything the owner's plan includes: this is what the API would have charged, which is the
size of the thing, not the bill. Window of a milestone: from the commit that added its `### M<n>` heading
to docs/SPEC.md (or the tag of a lower milestone, when that is later: a spec written ahead lists milestones
before they open) to the date of its tag `m<n>` (when the tag was made; a lightweight tag gives its commit's
time); with no tag, to the first tag of a higher milestone made after it started (one that was skipped or
folded), else now. Milestone names may be dotted (M3.2, tag m3.2).
"""
import argparse
import bisect
import collections
import datetime
import glob
import json
import os
import re
import subprocess
import sys

# ---------------------------------------------------------------------------------------------------
# Prices, US dollars per million tokens, per model id. Source: the claude-api skill's pricing
# reference (SKILL.md "Current Models", shared/model-migration.md pricing paragraphs and
# shared/prompt-caching.md), read 2026-10-22. Cache writes: 1.25x input for the 5-minute TTL, 2x for the
# 1-hour TTL; cache reads: 0.1x input, except Opus 5.5 0.05x and Fable 5.1 / Mythos 5.1 0.025x.
# Derived, not printed in the reference: Sonnet 5's cache read (the reference says Sonnet 5.5 has "the same
# prices" as Sonnet 5), Fable 5's cache read ("a quarter of the Fable 5 rate" is $0.25, so $1.00).
# Haiku 5.5 has a second rate card for prompts over 100K tokens. Fast mode (usage.speed == "fast") is twice
# the standard price on the models listed in FAST.
# ---------------------------------------------------------------------------------------------------
PRICES_AS_OF = "2026-10-22"


def _p(inp, out, read, w5, w1):
    return {"input": inp, "output": out, "cache_read": read, "cache_write_5m": w5, "cache_write_1h": w1}


PRICES = {
    "claude-fable-5-1": _p(10, 50, 0.25, 12.5, 20),
    "claude-mythos-5-1": _p(10, 50, 0.25, 12.5, 20),
    "claude-fable-5": _p(10, 50, 1.0, 12.5, 20),
    "claude-opus-5-5": _p(4, 20, 0.2, 5, 8),
    "claude-opus-5": _p(5, 25, 0.5, 6.25, 10),
    "claude-opus-4-8": _p(5, 25, 0.5, 6.25, 10),
    "claude-opus-4-7": _p(5, 25, 0.5, 6.25, 10),
    "claude-opus-4-6": _p(5, 25, 0.5, 6.25, 10),
    "claude-sonnet-5-5": _p(2, 10, 0.2, 2.5, 4),
    "claude-sonnet-5": _p(2, 10, 0.2, 2.5, 4),
    "claude-sonnet-4-6": _p(3, 15, 0.3, 3.75, 6),
    "claude-haiku-5-5": _p(0.1, 0.5, 0.01, 0.125, 0.2),
    "claude-haiku-4-5": _p(1, 5, 0.1, 1.25, 2),
}
LONG_PROMPT = {  # the rate card for a prompt (input + cache read + cache write) over this many tokens
    "claude-haiku-5-5": (100_000, _p(0.5, 2.5, 0.05, 0.625, 1.0)),
}
FAST = {"claude-opus-5-5": 2.0, "claude-opus-5": 2.0}  # fast-mode price multiplier

NO_TASK = "(no task)"
NO_PRICE = "no price"


# ---------------------------------------------------------------------------------------------------
# Reading the transcripts: usage fields only.
# ---------------------------------------------------------------------------------------------------
def parse_time(text):
    """An ISO time (Z or an offset; naive means UTC) as an aware datetime, or None."""
    try:
        t = datetime.datetime.fromisoformat(str(text).strip().replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    return t if t.tzinfo else t.replace(tzinfo=datetime.timezone.utc)


def iso(t):
    return t.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _int(value):
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else 0


def usage_record(entry):
    """The few fields of one assistant entry the ledger keeps, or None. Nothing else is read."""
    msg = entry.get("message")
    if not isinstance(msg, dict):
        return None
    usage = msg.get("usage")
    model = msg.get("model")
    t = parse_time(entry.get("timestamp"))
    if not isinstance(usage, dict) or not isinstance(model, str) or t is None or model.startswith("<"):
        return None  # "<synthetic>" entries are Claude Code's own notices, not turns
    write = _int(usage.get("cache_creation_input_tokens"))
    split = usage.get("cache_creation")
    w1 = _int(split.get("ephemeral_1h_input_tokens")) if isinstance(split, dict) else 0
    w1 = min(w1, write)
    key = msg.get("id") if isinstance(msg.get("id"), str) else None
    key = key or (entry.get("requestId") if isinstance(entry.get("requestId"), str) else None)
    return {
        "key": key,
        "time": t,
        "model": model,
        "input": _int(usage.get("input_tokens")),
        "output": _int(usage.get("output_tokens")),
        "cache_read": _int(usage.get("cache_read_input_tokens")),
        "cache_write_5m": write - w1,
        "cache_write_1h": w1,
        "fast": usage.get("speed") == "fast",
    }


def scan_transcript(path, start=None, end=None):
    """(the agent name the transcript carries or None, the usage records inside [start, end]).

    Each line is parsed and dropped; only usage_record's fields and the agent-name entry survive."""
    name, records = None, []
    try:
        handle = open(path, "r", encoding="utf-8", errors="replace")
    except OSError:
        return None, records
    with handle:
        for line in handle:
            is_assistant = '"assistant"' in line
            is_name = '"agent-name"' in line
            if not (is_assistant or is_name):
                continue
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            if not isinstance(entry, dict):
                continue
            kind = entry.get("type")
            if kind == "agent-name" and isinstance(entry.get("agentName"), str):
                name = entry["agentName"]
            elif kind == "assistant":
                rec = usage_record(entry)
                if rec and (start is None or rec["time"] >= start) and (end is None or rec["time"] <= end):
                    records.append(rec)
            del entry
    return name, records


def encode_project(path):
    """Claude Code's folder name for a working directory: every character but a letter or digit becomes '-'."""
    return re.sub(r"[^A-Za-z0-9]", "-", path)


def session_agents(status_dir):
    """{session id: agent} from the statusline files; the second signal for the main checkout."""
    found = {}
    for path in glob.glob(os.path.join(status_dir, "*.json")):
        base = os.path.basename(path)[:-5]
        if base.startswith("_"):
            continue
        try:
            with open(path) as f:
                sid = json.load(f).get("session_id")
        except (OSError, ValueError, AttributeError):
            continue
        if isinstance(sid, str):
            found[sid] = base
    return found


def transcript_files(projects, repo):
    """[(path, folder agent or None, session id, parent session id or None)] for the team's folders."""
    main = encode_project(repo)
    folders = [(os.path.join(projects, main), None)]
    prefix = encode_project(repo + "-worktrees") + "-"
    for d in sorted(glob.glob(os.path.join(projects, prefix + "*"))):
        folders.append((d, os.path.basename(d)[len(prefix):]))
    files = []
    for folder, agent in folders:
        for path in glob.glob(os.path.join(folder, "*.jsonl")):
            files.append((path, agent, os.path.basename(path)[:-6], None))
        for path in glob.glob(os.path.join(folder, "*", "subagents", "*.jsonl")):
            parent = os.path.basename(os.path.dirname(os.path.dirname(path)))
            files.append((path, agent, os.path.basename(path)[:-6], parent))
    return files


def collect(projects, repo, status_dir, start, end):
    """Usage records inside the window, each with the agent it belongs to, every turn once."""
    by_session = session_agents(status_dir)
    files = transcript_files(projects, repo)
    # Parents before their sub-agents, so a sub-agent can take its parent's agent.
    files.sort(key=lambda f: f[3] is not None)
    session_agent = {}
    seen, out = set(), []
    for path, folder_agent, sid, parent in files:
        if start is not None:
            try:
                if datetime.datetime.fromtimestamp(os.path.getmtime(path), datetime.timezone.utc) < start:
                    # Untouched since before the window; still needed for the name only if it has sub-agents
                    # that are inside it, which is rare enough to answer from the other signals.
                    continue
            except OSError:
                continue
        name, records = scan_transcript(path, start, end)
        if folder_agent:
            agent = folder_agent
        elif parent and parent in session_agent:
            agent = session_agent[parent]
        elif name == "architect":
            agent = name
        elif sid in by_session:
            agent = by_session[sid]
        elif parent and parent in by_session:
            agent = by_session[parent]
        else:
            models = [r["model"] for r in records]
            agent = "architect" if models and "fable" in models[0] else "other"
        session_agent[sid] = agent
        for rec in records:
            if rec["key"] is not None:
                if rec["key"] in seen:
                    continue
                seen.add(rec["key"])
            rec["agent"] = agent
            out.append(rec)
    return out


# ---------------------------------------------------------------------------------------------------
# The assignments log and the cost of a turn.
# ---------------------------------------------------------------------------------------------------
def read_assignments(status_dir):
    """{agent: ([times], [(task, effort)])}: each agent's task changes in time order."""
    per = collections.defaultdict(list)
    try:
        with open(os.path.join(status_dir, "assignments.log"), encoding="utf-8", errors="replace") as f:
            lines = f.read().splitlines()
    except OSError:
        lines = []
    for line in lines:
        cols = line.split("\t")
        if len(cols) < 4:
            continue
        t = parse_time(cols[0])
        task = cols[3].strip()
        if t is None or not task or task == "-":
            continue
        effort = cols[4].strip() if len(cols) > 4 and cols[4].strip() not in ("", "-") else None
        per[cols[2].strip()].append((t, task, effort))
    out = {}
    for agent, rows in per.items():
        rows.sort(key=lambda r: r[0])
        out[agent] = ([r[0] for r in rows], [(r[1], r[2]) for r in rows])
    return out


def task_of(assignments, agent, when):
    times, rows = assignments.get(agent, ([], []))
    i = bisect.bisect_right(times, when) - 1
    return rows[i] if i >= 0 else (NO_TASK, None)


def normal_model(model):
    model = re.sub(r"^anthropic\.", "", model)
    model = re.sub(r"\[[^\]]*\]$", "", model)
    return re.sub(r"-\d{8}$", "", model)


def turn_cost(rec):
    """Dollars for one turn, or None when the model has no price."""
    model = normal_model(rec["model"])
    card = PRICES.get(model)
    if card is None:
        return None
    if model in LONG_PROMPT:
        limit, long_card = LONG_PROMPT[model]
        if rec["input"] + rec["cache_read"] + rec["cache_write_5m"] + rec["cache_write_1h"] > limit:
            card = long_card
    dollars = sum(rec[k] * card[k] for k in ("input", "output", "cache_read", "cache_write_5m", "cache_write_1h")) / 1e6
    if rec["fast"]:
        dollars *= FAST.get(model, 1.0)
    return dollars


def blank():
    return {"turns": 0, "input": 0, "output": 0, "cache_read": 0, "cache_write": 0, "cost": 0.0, "unpriced_turns": 0}


def add(row, rec, cost):
    row["turns"] += 1
    row["input"] += rec["input"]
    row["output"] += rec["output"]
    row["cache_read"] += rec["cache_read"]
    row["cache_write"] += rec["cache_write_5m"] + rec["cache_write_1h"]
    if cost is None:
        row["unpriced_turns"] += 1
    else:
        row["cost"] += cost


def build(records, assignments, label, start, end):
    models = collections.defaultdict(blank)
    agents = collections.defaultdict(blank)
    tasks = collections.defaultdict(blank)
    task_agents = collections.defaultdict(set)
    task_effort = {}
    total = blank()
    for rec in sorted(records, key=lambda r: r["time"]):
        cost = turn_cost(rec)
        task, effort = task_of(assignments, rec["agent"], rec["time"])
        add(models[rec["model"]], rec, cost)
        add(agents[rec["agent"]], rec, cost)
        add(tasks[task], rec, cost)
        task_agents[task].add(rec["agent"])
        if effort:
            task_effort[task] = effort
        add(total, rec, cost)
    tiers = collections.defaultdict(blank)  # the tasks by tier: light, heavy, standard (the turns outside a task left out)
    for task, row in tasks.items():
        row["agents"] = sorted(task_agents[task])
        row["effort"] = task_effort.get(task)
        if task == NO_TASK:
            continue
        labels = (row["effort"] or "").split(",")
        tier = "light" if "light" in labels else "heavy" if "heavy" in labels else "standard"
        tiers[tier]["tasks"] = tiers[tier].get("tasks", 0) + 1
        for k in ("turns", "input", "output", "cache_read", "cache_write", "cost", "unpriced_turns"):
            tiers[tier][k] += row[k]
    return {
        "label": label,
        "from": iso(start) if start else None,
        "to": iso(end) if end else None,
        "prices_as_of": PRICES_AS_OF,
        "models": {k: dict(v, priced=normal_model(k) in PRICES) for k, v in models.items()},
        "agents": dict(agents),
        "tasks": dict(tasks),
        "tiers": dict(tiers) if set(tiers) - {"standard"} else {},
        "total": total,
    }


# ---------------------------------------------------------------------------------------------------
# The window: a milestone, a tag, or two times.
# ---------------------------------------------------------------------------------------------------
def git(repo, *args):
    try:
        out = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return ""
    return out.stdout.strip() if out.returncode == 0 else ""


def tag_time(repo, tag):
    # The tag's own date (an annotated tag is made when the architect closes the milestone, which can be
    # hours after the commit it points at); a lightweight tag has none and gives its commit's time.
    for name in (tag, tag.lower(), tag.upper()):
        text = git(repo, "for-each-ref", f"refs/tags/{name}", "--format=%(creatordate:iso-strict)")
        if text:
            return parse_time(text.splitlines()[0])
    return None


def milestone_window(repo, milestone, now=None):
    """(start, end) of a milestone: the commit that added its heading in docs/SPEC.md to its tag's date (else now)."""
    number = re.fullmatch(r"[Mm]?(\d+(?:\.\d+)*)", milestone)  # M3, or a dotted one such as M3.2
    if not number:
        raise SystemExit(f"team-cost: '{milestone}' is not a milestone (M3, M3.2)")
    n = number.group(1)
    text = git(repo, "log", "--reverse", "--format=%cI", "-G", f"^### M{re.escape(n)}([^0-9.]|$)", "--", "docs/SPEC.md")
    first = text.splitlines()[0] if text else ""
    start = parse_time(first)
    if start is None:
        raise SystemExit(f"team-cost: no '### M{n}' heading in the history of docs/SPEC.md")
    key = lambda v: tuple(int(x) for x in v.split("."))
    tags = [(key(name[1:]), t) for name, t in milestone_tags(repo)]
    end = tag_time(repo, f"m{n}")
    if end is None:  # not tagged: it ends where a higher milestone was tagged after it began, else now
        end = min((t for k, t in tags if k > key(n) and t > start), default=None) or now or datetime.datetime.now(datetime.timezone.utc)
    # A spec that lists its milestones ahead (M4 and M5 written at M0) would date each from the first commit:
    # the window starts no earlier than the newest tag of a lower milestone. Only a lower one: a higher
    # milestone's tag says nothing about when this one began.
    prev = max((t for k, t in tags if k < key(n) and t < end), default=None)
    if prev is not None and prev > start:
        start = prev
    return start, end


def milestone_tags(repo):
    """[(tag, time)] for every m<n> tag, by creation date (a lightweight tag gives its commit's time)."""
    out = []
    for line in git(repo, "for-each-ref", "refs/tags", "--format=%(refname:short) %(creatordate:iso-strict)").splitlines():
        name, _, when = line.partition(" ")
        t = parse_time(when)
        if re.fullmatch(r"m\d+(?:\.\d+)*", name) and t is not None:
            out.append((name, t))
    return out


def open_milestone(repo):
    """The newest `### M<n>` heading in docs/SPEC.md whose tag m<n> does not exist yet, as 'M<n>', or None."""
    try:
        with open(os.path.join(repo, "docs", "SPEC.md"), encoding="utf-8", errors="replace") as f:
            text = f.read()
    except OSError:
        return None
    # The lowest untagged milestone above the highest tagged one: a spec that lists M4 and M5 ahead
    # of time does not make M5 the open one.
    key = lambda v: tuple(int(x) for x in v.split("."))
    names = sorted({n for n in re.findall(r"^### M(\d+(?:\.\d+)*)\b", text, re.M)}, key=key)
    tagged = [n for n in names if tag_time(repo, f"m{n}") is not None]
    top = key(tagged[-1]) if tagged else ()
    for n in names:
        if key(n) > top and tag_time(repo, f"m{n}") is None:
            return f"M{n}"
    return None


# ---------------------------------------------------------------------------------------------------
# The output.
# ---------------------------------------------------------------------------------------------------
def human(n):
    if n >= 1e9:
        return f"{n / 1e9:.2f}B"
    if n >= 1e6:
        return f"{n / 1e6:.1f}M"
    if n >= 1e3:
        return f"{n / 1e3:.1f}k"
    return str(n)


def money(row, priced=True):
    if not priced or (row["unpriced_turns"] and row["unpriced_turns"] == row["turns"]):
        return NO_PRICE
    text = f"${row['cost']:,.2f}"
    return text + "+" if row["unpriced_turns"] else text


def total_line(data):
    t = data["total"]
    label = data["label"]
    head = f"Total for {label}" if re.fullmatch(r"M\d+", label) else f"Total {label}"
    line = f"{head}: ${t['cost']:,.2f} (estimated)"
    if t["unpriced_turns"]:
        line += f"; {t['unpriced_turns']} turns on a model with no price are not in it"
    return line


def tables(data):
    """[(title, header, rows)] shared by the text and markdown output; biggest cost first."""
    head = ["turns", "input", "output", "cache read", "cache write", "cost"]

    def cells(row, priced=True):
        return [f"{row['turns']:,}", human(row["input"]), human(row["output"]), human(row["cache_read"]),
                human(row["cache_write"]), money(row, priced)]

    def order(item):
        return (-item[1]["cost"], -item[1]["turns"], item[0])

    out = []
    out.append(("By model", ["model"] + head,
                [[m] + cells(r, r["priced"]) for m, r in sorted(data["models"].items(), key=order)]))
    out.append(("By agent", ["agent"] + head, [[a] + cells(r) for a, r in sorted(data["agents"].items(), key=order)]))
    if data.get("tiers"):
        out.append(("By tier", ["tier", "tasks"] + head,
                    [[t, str(r.get("tasks", 0))] + cells(r) for t, r in sorted(data["tiers"].items(), key=order)]))
    out.append(("By task", ["task", "agents"] + head,
                [[t, ", ".join(r["agents"]) + (f" ({r['effort']})" if r["effort"] else "")] + cells(r)
                 for t, r in sorted(data["tasks"].items(), key=order)]))
    return out


def render_text(data):
    lines = [f"Cost ledger, {data['label']} ({data['from'] or 'the start'} to {data['to'] or 'now'}; prices of {data['prices_as_of']})", ""]
    for title, header, rows in tables(data):
        lines.append(title)
        grid = [header] + rows
        widths = [max(len(str(r[i])) for r in grid) for i in range(len(header))]
        numeric_from = 2 if title in ("By task", "By tier") else 1
        for k, r in enumerate(grid):
            lines.append("  " + "  ".join(
                (str(c).ljust(widths[i]) if i < numeric_from else str(c).rjust(widths[i])) for i, c in enumerate(r)))
            if k == 0:
                lines.append("  " + "  ".join("-" * w for w in widths))
        lines.append("")
    lines.append(total_line(data))
    return "\n".join(lines)


def render_markdown(data):
    lines = [f"# Cost ledger, {data['label']}", "",
             f"From {data['from'] or 'the start'} to {data['to'] or 'now'}. Estimated from token usage at the API prices of "
             f"{data['prices_as_of']} (`scripts/team-cost.py`); what the plan actually charged is not in it.", ""]
    for title, header, rows in tables(data):
        lines += [f"## {title}", "", "| " + " | ".join(header) + " |", "|" + "|".join("---" for _ in header) + "|"]
        lines += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
        lines.append("")
    lines += [f"**{total_line(data)}**"]
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------------------------------
def main(argv=None):
    ap = argparse.ArgumentParser(description="What a milestone cost: turns and tokens by model, agent and task.")
    ap.add_argument("--milestone", metavar="M<n>", help="the milestone's window; 'open' for the newest one with no tag yet")
    ap.add_argument("--since", metavar="TAG", help="from that tag's commit time until now")
    ap.add_argument("--from", dest="from_", metavar="ISO", help="from this time")
    ap.add_argument("--to", metavar="ISO", help="until this time (default now)")
    fmt = ap.add_mutually_exclusive_group()
    fmt.add_argument("--markdown", action="store_true", help="markdown tables (saved as .team/milestones/M<n>-cost.md)")
    fmt.add_argument("--json", action="store_true", help="the numbers as JSON, for the dashboard")
    ap.add_argument("--repo", help="the main checkout (default: where this script's repository lives)")
    ap.add_argument("--status-dir", help="the folder holding assignments.log and the statusline files (default: .team/status)")
    ap.add_argument("--projects-dir", help="the transcripts folder (default: ~/.claude/projects)")
    args = ap.parse_args(argv)

    if args.repo:
        repo = os.path.abspath(args.repo)
    else:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import teamlib
        repo = teamlib.REPO
    status_dir = args.status_dir or os.path.join(repo, ".team", "status")
    projects = args.projects_dir or os.path.join(os.path.expanduser("~"), ".claude", "projects")
    now = datetime.datetime.now(datetime.timezone.utc)

    chosen = [bool(args.milestone), bool(args.since), bool(args.from_ or args.to)]
    if sum(chosen) != 1:
        ap.error("give exactly one of --milestone, --since, or --from/--to")
    if args.milestone:
        name = args.milestone
        if name.lower() == "open":
            name = open_milestone(repo)
            if not name:
                raise SystemExit("team-cost: every milestone in docs/SPEC.md has its tag; none is open")
        start, end = milestone_window(repo, name, now)
        label = "M" + re.sub(r"^[Mm]", "", name)
    elif args.since:
        start = tag_time(repo, args.since)
        if start is None:
            raise SystemExit(f"team-cost: no tag '{args.since}'")
        end, label = now, f"since {args.since}"
    else:
        start = parse_time(args.from_) if args.from_ else None
        end = parse_time(args.to) if args.to else now
        if (args.from_ and start is None) or (args.to and end is None):
            raise SystemExit("team-cost: --from/--to take an ISO time such as 2026-10-21T00:00:00Z")
        label = f"from {iso(start) if start else 'the start'} to {iso(end)}"

    records = collect(projects, repo, status_dir, start, end)
    data = build(records, read_assignments(status_dir), label, start, end)
    if args.json:
        print(json.dumps(data, indent=2, sort_keys=True))
    elif args.markdown:
        sys.stdout.write(render_markdown(data))
    else:
        print(render_text(data))


if __name__ == "__main__":
    main()
