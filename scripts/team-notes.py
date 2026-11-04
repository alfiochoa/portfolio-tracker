#!/usr/bin/env python3
"""Live view of the team's shared notes (.team/notes.md), newest first.

It only reads the file, so it uses none of the plan's usage.

    python3 scripts/team-notes.py

Run it in a Herdr pane. Ctrl+C stops it.
"""
import re
import shutil
import sys
import textwrap
import time

import teamlib  # the same folder: the team's settings and the resting interval

from teamlib import TEAM

NOTES = f"{TEAM}/notes.md"
REMOVED = f"{TEAM}/notes-removed.md"  # written by `team.sh drop`
RESET, BOLD, DIM, YELLOW, CYAN = "\033[0m", "\033[1m", "\033[2m", "\033[33m", "\033[36m"


def notes():
    try:
        text = open(NOTES).read()
    except OSError:
        return None
    body = text.split("## Notes", 1)[-1]
    return [line[2:].strip() for line in body.splitlines() if line.startswith("- ")]


def removed():
    """(when and who, reason, what the note said) for each removed note, oldest first."""
    try:
        lines = [l[2:].strip() for l in open(REMOVED).read().splitlines() if l.startswith("- ")]
    except OSError:
        return []
    out = []
    for line in lines:
        head, _, rest = line.partition(" | ")
        reason, _, was = rest.partition(" | was: ")
        out.append((head, reason, was))
    return out


def render(width, height):
    entries = notes()
    if entries is None:
        return [f"{BOLD}SHARED NOTES{RESET}", "", f"  {DIM}{NOTES} is missing{RESET}"]
    tint = YELLOW if len(entries) > 20 else DIM
    out = [f"{BOLD}SHARED NOTES{RESET}  {tint}{len(entries)} of about 20{RESET}  {DIM}traps worth passing on · pruned at each milestone close{RESET}", ""]
    if not entries:
        out.append(f"  {DIM}None yet. Agents add one only when a trap cost them real time.{RESET}")
    for entry in reversed(entries):  # newest first
        match = re.match(r"(\d{4}-\d{2}-\d{2}) (\S+?): (.*)", entry)
        date, who, body = match.groups() if match else ("", "", entry)
        label = f"{date[5:]} {who}" if match else ""
        wrapped = textwrap.wrap(body, max(20, width - 4)) or [""]
        if label:
            out.append(f"  {CYAN}{label}{RESET}")
        out.extend(f"    {line}" for line in wrapped)
    gone = removed()
    if gone:
        out += ["", f"{BOLD}REMOVED{RESET}  {DIM}{len(gone)} so far · newest first · full list in .team/notes-removed.md{RESET}"]
        for head, reason, was in reversed(gone[-4:]):
            out.append(f"  {DIM}{head[5:]}{RESET}  {reason}")
            if was:
                out.extend(f"    {DIM}{line}{RESET}" for line in textwrap.wrap(f"was: {was}", max(20, width - 4)))
    return out[: max(height - 1, 3)]


def main():
    sys.stdout.write("\033[?1049h\033[?7l\033[?25l" + "\033[2J")  # alternate screen, no wrapping, no cursor
    try:
        while True:
            size = shutil.get_terminal_size((100, 14))
            sys.stdout.write("\033[H" + "\033[K\n".join(render(size.columns, size.lines)) + "\033[K\033[J")
            sys.stdout.flush()
            time.sleep(teamlib.refresh_after(4, 30))
    except KeyboardInterrupt:
        pass
    finally:
        sys.stdout.write("\033[?7h\033[?25h\033[?1049l")


if __name__ == "__main__":
    main()
