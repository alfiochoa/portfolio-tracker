#!/usr/bin/env python3
"""The team guard: a hook that refuses, before it runs, a shell command no agent may run.

CLAUDE.md says the rules in words (the Mac's own apps and permissions are the owner's, nobody force-pushes,
accounts and credentials are theirs, nothing outside the repository and its worktrees is deleted, servers are
stopped by port and never with pkill, nobody runs `git reset --hard` in the shared checkout; on a partner team's
machine, nobody merges a pull request or pushes the base branch). An agent reads them and can still forget; this hook cannot. It runs
as a PreToolUse hook on the Bash tool in every session team.sh starts (.team/claude-settings.json, written
by `team.sh init`), reads the command from stdin, and answers "deny" with the rule when one matches. A
project adds its own patterns in scripts/team.conf: GUARD_DENY="wrangler (deploy|publish)".

The guard reads what a command runs, not what it says: the body of a heredoc written with cat or tee, and
the quoted arguments of a command that prints, searches, commits or sends text (echo, grep, git commit, a
team.sh message, a Herdr notification) are left out before the rules are matched. A python script given as a
heredoc (python3 - <<EOF) is read as code: the text in its quotes is left out, so a script that edits a document
saying "never pkill" is not refused, unless its code can start a program or run text as code (subprocess,
os.system, exec, eval, __import__ ...), when every word stays. Any other heredoc fed to an interpreter, or piped
onward, is still a command. This is a net against mistakes, not a wall.

Denials are logged in $TEAM_DIR/status/guard.log, one line each: the time, the agent, the rule, the command,
the words in it that matched, and, when those words were inside a here-document given to a program (python3 - <<EOF),
that program's name, since such words may be only text the script writes. The Overview's Notices tab shows them.
Only a hook call is logged (Claude Code's input carries the session's id); a test that pipes a command in gets
the answer and leaves the log alone. No model is called.
"""
import io
import json
import os
import tokenize
import re
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))

RULES = [  # (pattern over the whole command, the rule it keeps)
    (r"\bosascript\b|System Events|\bscreencapture\b|\btccutil\b|(^|[|;&(]\s*)open\s+(-|\S*://|\S+\.(app|html?)\b)",
     "the Mac's own apps, screen and permissions are the owner's (CLAUDE.md); browsers are Playwright's on your own port"),
    (r"\bsudo\b|\bshutdown\b|\breboot\b|\bdiskutil\b|\bnetworksetup\b|\blaunchctl\s+(load|unload|bootstrap|bootout)\b|\bdefaults\s+write\b",
     "the machine's settings are the owner's"),
    (r"\b(pkill|killall)\b", "stop your own server by its port (lsof -ti tcp:$TEAM_PORT | xargs kill); pkill and killall hit other agents' processes"),
    (r"\bgit\s+push\b[^|;&]*(\s--force\b|\s-f\b|\s--force-with-lease\b|\s\+\S)", "nobody force-pushes"),
    (r"\bgit\s+(filter-branch|filter-repo)\b|\bgit\s+reflog\s+expire\b|\bgit\s+gc\b[^|;&]*--prune", "committed history is not deleted"),
    (r"\b(wrangler|claude|gh\s+auth|npm|npx\s+wrangler)\s+(login|logout|adduser|setup-token)\b", "accounts and credentials are the owner's"),
    (r"\bherdr\s+(server\s+stop|workspace\s+close)\b", "the Herdr server and workspaces stay up; team.sh has pause, restart and recover"),
]
TMP_ROOTS = ("/tmp", "/private/tmp", "/private/var/folders", "/var/folders")
DATA_SINKS = ("cat", "tee")  # a heredoc fed to one of these is text being written, not run
PYTHONS = re.compile(r"python[\d.]*$")


def python_reads_code(head):
    """Whether `python3 [flags] [-] [args]` reads its program from the heredoc (not -c, -m or a script file)."""
    for arg in head[1:]:
        if arg == "-":
            return True
        if arg.startswith("-") and not arg.startswith("--") and arg[1:2] in ("c", "m"):
            return False
        if not arg.startswith("-"):
            return False
    return True
# Names in a python script's code (its strings left out) that can start a program or run text as code. Not
# anchored after an underscore or a dot, so asyncio.create_subprocess_exec and os.posix_spawnp count too; a
# name matched by mistake only keeps every word, as for any other interpreter.
RUNS = re.compile(r"(?<![A-Za-z0-9])(subprocess|system|popen|spawn|exec|eval|pty|ctypes|__import__|importlib|getattr|"
                  r"attrgetter|methodcaller|globals|vars|__dict__|builtins|runpy)")


def python_without_strings(body):
    """A python script with its string literals emptied, when nothing in its code can start a program; else as
    it is. The words a script only writes into a file (a document that says "never pkill") are then not read
    as a command, and a script that can run something keeps every word."""
    try:
        toks = list(tokenize.generate_tokens(io.StringIO(body).readline))
    except (tokenize.TokenError, IndentationError, SyntaxError):
        return body
    starts = [0]
    for ln in body.splitlines(keepends=True):
        starts.append(starts[-1] + len(ln))
    at = lambda rc: starts[rc[0] - 1] + rc[1] if rc[0] - 1 < len(starts) else len(body)
    out, last = [], 0
    for t in toks:
        if t.type == tokenize.STRING:
            out += [body[last:at(t.start)], "''"]
            last = at(t.end)
    out.append(body[last:])
    code = "".join(out)
    return body if RUNS.search(code) else code
MESSAGE_CMDS = (r"(?:\S*team\.sh\s+(?:tell|send|report|note|drop|assign|fresh)|herdr\s+(?:notification\s+show|agent\s+(?:prompt|send-keys))"
                r"|git\s+(?:commit|tag)|gh\s+(?:issue|pr)\s+\w+|echo|printf|grep|egrep|fgrep|rg)")
QUOTED = r"'[^']*'|\"(?:[^\"\\]|\\.)*\""


def without_data(command):
    """The command with the text it only writes, prints, searches for or sends taken out."""
    pieces, pos = [], 0
    for m in re.finditer(r"<<-?\s*(['\"]?)(\w+)\1([^\n]*)\n", command):
        if m.start() < pos:
            continue
        line_start = command.rfind("\n", 0, m.start()) + 1
        head = re.split(r"\|\||&&|[|;&(]", command[line_start:m.start()])[-1].split()
        prog = head[0].rsplit("/", 1)[-1] if head else ""
        code = bool(PYTHONS.match(prog)) and python_reads_code(head)
        if prog not in DATA_SINKS and not code or "|" in m.group(3):
            continue  # not a plain write: the body may be run by whatever reads it
        end = re.search(r"^\t*" + re.escape(m.group(2)) + r"[ \t]*$", command[m.end():], re.M)
        if not end:
            continue
        pieces.append(command[pos:m.end()])
        if code:
            pieces.append(python_without_strings(command[m.end():m.end() + end.start()]))
        pos = m.end() + end.start()
    pieces.append(command[pos:])
    text = "".join(pieces)
    return re.sub(r"(?:^|(?<=[|;&(\n]))\s*" + MESSAGE_CMDS + r"\b(?:[^'\"|;&\n]|" + QUOTED + r")*",
                  lambda m: re.sub(QUOTED, "''", m.group(0)), text)


def conf_value(key):
    """A KEY="value" line of scripts/team.conf, as bash reads it."""
    try:
        with open(os.path.join(HERE, "team.conf"), encoding="utf-8") as f:
            for line in f:
                m = re.match(rf'^\s*{key}=(?:"([^"]*)"|\'([^\']*)\'|([^#\s]*))', line)
                if m:
                    return next(g for g in m.groups() if g is not None)
    except OSError:
        pass
    return ""


def under(path, root):
    root = root.rstrip("/")
    return path == root or path.startswith(root + "/")


def rm_outside(command, repo):
    """An rm whose target is an absolute or home path outside the repository, its worktrees and the temp folders."""
    allowed = [r for r in ([repo, repo + "-worktrees"] if repo else [])] + list(TMP_ROOTS) + [os.environ.get("TMPDIR", "")]
    for seg in re.split(r"\|\||&&|[|;&\n]", command):
        m = re.match(r"\s*(?:sudo\s+)?(?:/bin/)?rm\s+(.*)", seg)
        if not m:
            continue
        for tok in m.group(1).split():
            if tok.startswith("-"):
                continue
            tok = tok.strip("\"'")
            if tok.startswith("$HOME"):
                tok = "~" + tok[5:]
            if not (tok.startswith("/") or tok.startswith("~")):
                continue
            path = os.path.normpath(os.path.expanduser(tok))
            if not any(a and under(path, a) for a in allowed):
                return f"rm of {tok}: nothing outside this repository, its worktrees and the temp folders is deleted (CLAUDE.md)", seg.strip()
    return None


def repo_of(cwd):
    """The main checkout that `cwd` belongs to (a worktree's included), from git; empty when it is not in one."""
    if not cwd:
        return ""
    try:
        out = subprocess.run(["git", "-C", cwd, "rev-parse", "--git-common-dir"], capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.SubprocessError):
        return ""
    if out.returncode != 0:
        return ""
    common = out.stdout.strip()
    if not os.path.isabs(common):
        common = os.path.join(cwd, common)
    return os.path.dirname(os.path.normpath(common))


def toplevel(path):
    try:
        out = subprocess.run(["git", "-C", path, "rev-parse", "--show-toplevel"], capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.SubprocessError):
        return ""
    return os.path.realpath(out.stdout.strip()) if out.returncode == 0 and out.stdout.strip() else ""


def hard_reset_in_shared_checkout(command, repo, cwd):
    """A `git reset --hard` run in the main checkout, which every agent's work passes through: it throws away
    what is uncommitted there, whoever's it is (on 2026-10-27 one undid another agent's step that way)."""
    if not repo:
        return None
    for seg in re.split(r"\|\||&&|[|;&\n]", command):
        m = re.match(r"\s*git\s+(?:-C\s+(\S+)\s+)?reset\b(.*)", seg)
        if not m or not re.search(r"(^|\s)--hard\b", m.group(2)):
            continue
        where = os.path.expanduser(m.group(1).strip("\"'")) if m.group(1) else (cwd or "")
        if where and not os.path.isabs(where) and cwd:
            where = os.path.join(cwd, where)
        if where and toplevel(where) == os.path.realpath(repo):
            return ("no `git reset --hard` in the shared checkout: it throws away uncommitted work that may not be yours. "
                    "`git reset --keep <commit>` moves the branch and refuses to drop changes; in your own worktree --hard is fine"), seg.strip()
    return None


PARTNER_MARKERS = ("this-is-the-partner-team", "this-is-the-support-team")


def partner_rule(command, repo):
    """On a partner team's machine: only the owner's team merges, and the base branch is theirs to push."""
    if not repo or not any(os.path.exists(os.path.join(repo, ".team", m)) for m in PARTNER_MARKERS):
        return None
    m = re.search(r"\bgh\s+pr\s+merge\b", command)
    if m:
        return "a partner team never merges a pull request: the owner's team reviews and merges", m.group(0)
    base = re.escape(conf_value("BRANCH") or "main")
    m = re.search(rf"\bgit\s+push\b[^|;&]*\s(?:\S+:)?(?:refs/heads/)?{base}(?=\s|$)", command)
    if m:
        return "a partner team pushes its own branches, never the base branch: its work reaches it as a pull request", m.group(0)
    return None


def heredoc_reader(command, pos):
    """The program a here-document is given to, when `pos` lies in its body (python3 - <<EOF); else ''."""
    for m in re.finditer(r"<<-?\s*(['\"]?)(\w+)\1[^\n]*\n", command):
        if m.end() > pos:
            break
        end = re.search(r"^\t*" + re.escape(m.group(2)) + r"[ \t]*$", command[m.end():], re.M)
        if end and pos < m.end() + end.start():
            line_start = command.rfind("\n", 0, m.start()) + 1
            head = re.split(r"\|\||&&|[|;&(]", command[line_start:m.start()])[-1].split()
            return head[0].rsplit("/", 1)[-1] if head else "a program"
    return ""


def judge(command, repo, cwd=""):
    """(the rule the command breaks, the words in it that matched, the program whose here-document held them),
    or None."""
    command = without_data(command)

    def found(rule, words):
        pos = command.find(words) if words else -1
        return rule, words, heredoc_reader(command, pos) if pos >= 0 else ""

    for pattern, rule in RULES:
        m = re.search(pattern, command)
        if m:
            return found(rule, m.group(0))
    hit = hard_reset_in_shared_checkout(command, repo, cwd) or partner_rule(command, repo)
    if hit:
        return found(*hit)
    extra = os.environ.get("GUARD_DENY") or conf_value("GUARD_DENY")
    if extra:
        try:
            m = re.search(extra, command)
        except re.error:
            m = None
        if m:
            return found(f"this project's own rule (GUARD_DENY in scripts/team.conf: {extra})", m.group(0))
    hit = rm_outside(command, repo)
    return found(*hit) if hit else None


def verdict(command, repo, cwd=""):
    hit = judge(command, repo, cwd)
    return hit[0] if hit else None


def main():
    try:
        data = json.load(sys.stdin)
    except ValueError:
        return
    if data.get("tool_name") != "Bash":
        return
    command = (data.get("tool_input") or {}).get("command") or ""
    # The repository: what team.sh exported, else the one the session's working directory is in (a team
    # started another way, such as a project's own script, has no TEAM_REPO).
    repo = os.environ.get("TEAM_REPO") or repo_of(data.get("cwd") or "")
    hit = judge(command, repo, data.get("cwd") or "")
    if not hit:
        return
    rule, words, reader = hit
    reason = f"team guard: {rule}. What needs this is written as steps for the owner and goes to the architect."
    team_dir = os.environ.get("TEAM_DIR") or (os.path.join(repo, ".team") if repo and os.path.isdir(os.path.join(repo, ".team")) else "")
    if team_dir and (data.get("session_id") or data.get("hook_event_name")):
        try:
            os.makedirs(os.path.join(team_dir, "status"), exist_ok=True)
            with open(os.path.join(team_dir, "status", "guard.log"), "a", encoding="utf-8") as f:
                f.write(f"{time.strftime('%Y-%m-%dT%H:%M:%S')}\t{os.environ.get('TEAM_AGENT', '?')}\t{rule}\t{command[:400]!r}"
                        f"\t{words[:120]!r}\t{reader}\n")
        except OSError:
            pass
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                             "permissionDecisionReason": reason}}))


if __name__ == "__main__":
    main()
