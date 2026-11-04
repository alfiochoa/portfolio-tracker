#!/usr/bin/env python3
"""Status line for the team's Claude Code sessions.

Claude Code runs this locally after each turn and passes the session's numbers
on stdin: context window use and the plan's usage limits. It prints the line
shown at the bottom of the agent's pane and saves the numbers to
.team/status/<agent>.json for scripts/team-dash.py. No model call is involved.
"""
import json
import os
import sys
import time

try:
    from teamlib import STATUS
except Exception:  # never let the status line fail a session
    STATUS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".team", "status")


def main():
    try:
        data = json.load(sys.stdin)
    except ValueError:
        return
    name = os.environ.get("TEAM_AGENT") or data.get("session_name") or "session"
    data["received_at"] = int(time.time())

    try:
        os.makedirs(STATUS, exist_ok=True)
        tmp = f"{STATUS}/.{name}.{os.getpid()}.tmp"
        with open(tmp, "w") as f:
            json.dump(data, f)
        os.replace(tmp, f"{STATUS}/{name}.json")
    except OSError:
        pass

    parts = [name, (data.get("model") or {}).get("display_name", "")]
    used = (data.get("context_window") or {}).get("used_percentage")
    if used is not None:
        filled = round(used / 10)
        parts.append(f"context {'▰' * filled}{'▱' * (10 - filled)} {used:.0f}%")
    limits = data.get("rate_limits") or {}
    left = []
    for key, label in (("five_hour", "5h"), ("seven_day", "week")):
        pct = (limits.get(key) or {}).get("used_percentage")
        if pct is not None:
            left.append(f"{100 - pct:.0f}% of {label} left")
    if left:
        parts.append("plan: " + ", ".join(left))
    print(" · ".join(p for p in parts if p))


if __name__ == "__main__":
    main()
