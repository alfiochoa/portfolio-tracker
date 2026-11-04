#!/usr/bin/env python3
"""The office: every agent as a small Clawd at its desk.

Working agents type while code scrolls on their monitor. Idle agents sleep on
the desk. An orchestrator looks around and taps a foot when it is waiting on
someone, and with a partner team (PARTNER in team.conf) takes a video call when it
is reading or answering the other team. A blocked agent throws its arms up.

It reads Herdr's agent states and the team's files and draws with terminal block
characters. It makes no model calls, so it uses none of the plan's usage.

    python3 scripts/team-office.py

Run it in a Herdr pane. Ctrl+C stops it.
"""
import json
import os
import random
import re
import shutil
import subprocess
import sys
import threading
import time

import teamlib
from teamlib import TEAM, WAITERS

VERB = {
    "architect": "thinking",
    "lead": "coordinating",
    "designer": "designing",
    "verifier": "testing",
}

# Scene size in pixels. One character cell is 2 x 2 pixels, so 30 x 9 cells.
W, H = 60, 18
COLS, ROWS = W // 2, H // 2
BX = 8  # left edge of Clawd's body
MX = 40  # left edge of the monitor
FRAME_SECONDS = 0.2

ORANGE = (215, 119, 87)  # Claude Code's mascot colour
EYELID = (146, 74, 54)
DESK = (133, 100, 70)
DESK_LEG = (98, 74, 52)
KEYS = (147, 153, 178)
KEY_HIT = (245, 245, 250)
BEZEL = (108, 112, 134)
SCREEN = (30, 30, 46)
SCREEN_OFF = (17, 17, 27)
SCREEN_ALARM = (110, 32, 48)
GREEN = (166, 227, 161)
BLUE = (137, 180, 250)
MAUVE = (203, 166, 247)
YELLOW = (249, 226, 175)
RED = (243, 139, 168)
AMBER = (250, 179, 135)
MUG = (205, 214, 244)
BUBBLE = (230, 233, 245)
INK = (40, 42, 58)
MUTED = (127, 132, 156)
LAVENDER = (180, 190, 254)
TEXT = (205, 214, 244)
OTHER_CLAWD = (116, 199, 236)  # the other team's Clawd, seen on the monitor during a call

RESET = "\033[0m"
QUADRANTS = " ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█"  # index bits: upper-left 1, upper-right 2, lower-left 4, lower-right 8
TRUECOLOR = os.environ.get("COLORTERM", "").lower() in ("truecolor", "24bit")


def colour(rgb, background=False):
    lead = 48 if background else 38
    if TRUECOLOR:
        return f"\033[{lead};2;{rgb[0]};{rgb[1]};{rgb[2]}m"
    cube = [round(v / 255 * 5) for v in rgb]
    return f"\033[{lead};5;{16 + 36 * cube[0] + 6 * cube[1] + cube[2]}m"


class Canvas:
    """A small pixel grid, drawn with quadrant block characters, plus text overlays."""

    def __init__(self):
        self.px = [[None] * W for _ in range(H)]
        self.text = {}

    def rect(self, x, y, w, h, rgb):
        for yy in range(max(y, 0), min(y + h, H)):
            for xx in range(max(x, 0), min(x + w, W)):
                self.px[yy][xx] = rgb

    def put(self, col, row, chars, fg, bg=None, bold=False):
        for i, ch in enumerate(chars):
            self.text[(col + i, row)] = (ch, fg, bg, bold)

    def lines(self, crop=0):
        """The scene as text lines, leaving out `crop` cells at each side (both margins are empty)."""
        out = []
        for row in range(ROWS):
            parts = []
            for col in range(crop, COLS - crop):
                if (col, row) in self.text:
                    ch, fg, bg, bold = self.text[(col, row)]
                    style = colour(fg) + (colour(bg, True) if bg else "") + ("\033[1m" if bold else "")
                    parts.append(f"{style}{ch}{RESET}")
                    continue
                cell = [
                    self.px[2 * row][2 * col],
                    self.px[2 * row][2 * col + 1],
                    self.px[2 * row + 1][2 * col],
                    self.px[2 * row + 1][2 * col + 1],
                ]
                filled = [c for c in cell if c is not None]
                if not filled:
                    parts.append(" ")
                    continue
                front = max(set(filled), key=filled.count)
                others = [c for c in filled if c != front]
                if not others and None not in cell:
                    # One colour over the whole cell: paint it as the cell's background, not as a
                    # block character. Some terminals (Apple's Terminal among them) draw block
                    # characters a little short of the cell, which leaves thin lines between rows;
                    # a background always fills the cell.
                    parts.append(f"{colour(front, True)} {RESET}")
                    continue
                back = None if (None in cell or not others) else max(set(others), key=others.count)
                mask = sum(bit for bit, c in zip((1, 2, 4, 8), cell) if c == front)
                if back is not None and mask not in (1, 2, 3) and (15 - mask) in (1, 2, 3):
                    front, back, mask = back, front, 15 - mask
                style = colour(front) + (colour(back, True) if back else "")
                parts.append(f"{style}{QUADRANTS[mask]}{RESET}")
            out.append("".join(parts))
        return out


def draw_clawd(cv, top, eyes="open", left_arm=0, right_arm=0):
    """Clawd's body: 24 x 8 pixels, arms at the sides, eyes as holes. Feet are drawn separately."""
    cv.rect(BX, top, 24, 8, ORANGE)
    cv.rect(BX - 4, top + 4 + left_arm, 4, 2, ORANGE)
    cv.rect(BX + 24, top + 4 + right_arm, 4, 2, ORANGE)
    shift = {"left": -2, "right": 2}.get(eyes, 0)  # a whole cell, so the eye stays a clean square
    for ex in (BX + 4, BX + 18):
        if eyes == "closed":
            cv.rect(ex, top + 3, 2, 1, EYELID)
        else:
            cv.rect(ex + shift, top + 2, 2, 2, None)


def draw_feet(cv, kick=False):
    for fx in (2, 6, 16):
        cv.rect(BX + fx, 14, 2, 2, ORANGE)
    cv.rect(BX + (22 if kick else 20), 14, 2, 2, ORANGE)


def draw_desk(cv):
    cv.rect(2, 12, 56, 2, DESK)
    cv.rect(4, 14, 2, 4, DESK_LEG)
    cv.rect(54, 14, 2, 4, DESK_LEG)
    cv.rect(12, 12, 16, 1, KEYS)  # keyboard


def code_lines(name):
    """A fixed, made-up file for this agent's monitor: rows of coloured segments."""
    rng = random.Random(name)
    lines = []
    for _ in range(24):
        x = MX + 2 + rng.choice((0, 0, 2, 4))
        segments = []
        for _ in range(rng.randint(1, 3)):
            length = rng.choice((2, 2, 4, 4, 6))
            if x + length > MX + 16:  # the screen ends at MX + 15
                break
            segments.append((x, length, rng.choice((GREEN, BLUE, BLUE, MAUVE, YELLOW, TEXT))))
            x += length + 2
        lines.append(segments)
    return lines


def draw_monitor(cv, mode, t, code):
    # A frame one cell thick around a screen of 7 x 3 cells, on a one-cell stand.
    cv.rect(MX, 0, 18, 10, BEZEL)
    cv.rect(MX + 8, 10, 2, 2, BEZEL)  # stand
    screen = {"sleeping": SCREEN_OFF, "away": SCREEN_OFF}.get(mode, SCREEN)
    if mode == "blocked" and (t // 3) % 2 == 0:
        screen = SCREEN_ALARM
    cv.rect(MX + 2, 2, 14, 6, screen)
    if mode == "working":
        scroll, typed = divmod(t, 6)
        for slot in range(3):
            reveal = W if slot < 2 else MX + 2 + (typed + 1) * 3
            for x, length, rgb in code[(scroll + slot) % len(code)]:
                visible = min(length, max(0, reveal - x)) // 2 * 2
                if visible:
                    cv.rect(x, 2 + slot * 2, visible, 1, rgb)
    elif mode == "waiting":
        cv.rect(MX + 2, 2, 6, 1, MUTED)
        steps = list(range(0, 11, 2))
        bounce = steps + steps[-2:0:-1]
        cv.rect(MX + 2 + bounce[t % len(bounce)], 4, 4, 1, YELLOW)
    elif mode == "sleeping" and (t // 10) % 2 == 0:
        cv.rect(MX + 12, 6, 2, 1, AMBER)  # standby light
    elif mode == "talking":
        # A video call: the other team's Clawd, small, in its own colour.
        y = 2 + ((t // 4) % 2)
        cv.rect(MX + 4, y, 10, 4, OTHER_CLAWD)  # body
        cv.rect(MX + 2, y + 2, 2, 1, OTHER_CLAWD)  # arms
        cv.rect(MX + 14, y + 2, 2, 1, OTHER_CLAWD)
        for ex in (MX + 6, MX + 10):
            cv.rect(ex, y + 1, 2, 1, screen)  # eyes
            cv.rect(ex, y + 4, 2, 1, OTHER_CLAWD)  # legs


def bubble(cv, content, fg=INK, fill=BUBBLE):
    cv.put(5, 0, "▐", fill)
    cv.put(6, 0, content.center(5), fg, fill, bold=True)
    cv.put(11, 0, "▌", fill)
    cv.put(7, 1, "▘", fill)


def scene(name, mode, t, code, phrase="", crop=0):
    """One desk: nine lines of drawing, then the agent's name and what it is doing."""
    cv = Canvas()
    draw_monitor(cv, mode, t, code)
    blink = t % 27 == 0
    speaking = (t // 8) % 2 == 0  # in a call: our turn to talk, or theirs

    if mode == "working":
        left_down = (t // 1) % 2 == 0
        draw_clawd(
            cv,
            4,
            "closed" if blink else "open",
            left_arm=2 if left_down else 0,
            right_arm=0 if left_down else 2,
        )
    elif mode == "sleeping":
        draw_clawd(cv, 6, "closed")  # slumped: the desk hides the lower body
    elif mode == "waiting":
        look = ("open", "open", "left", "left", "open", "open", "right", "right")[(t // 3) % 8]
        draw_clawd(cv, 4, "closed" if blink else look)
    elif mode == "blocked":
        draw_clawd(cv, 4, "open", left_arm=-4, right_arm=-4)
    elif mode == "talking":
        wave = -2 if speaking and (t // 2) % 2 == 0 else 0
        draw_clawd(cv, 4, "closed" if blink else ("open" if speaking else "right"), right_arm=wave)

    draw_desk(cv)
    if mode != "away":
        draw_feet(cv, kick=(mode == "waiting" and (t // 2) % 2 == 0))
        cv.rect(36, 10, 2, 2, MUG)

    if mode == "working":
        rng = random.Random(f"{name}{t}")
        for _ in range(2):
            cv.rect(12 + rng.randrange(0, 8) * 2, 12, 2, 1, KEY_HIT)
        cv.put(18, 4, "~" if (t // 3) % 2 else "˜", MUTED)
    elif mode == "sleeping":
        for col, row, ch in ((16, 2, "z"), (17, 1, "Z"), (18, 0, "z"))[: (t // 4) % 4]:
            cv.put(col, row, ch, LAVENDER, bold=(ch == "Z"))
    elif mode == "waiting":
        cv.put(18, 4, "~" if (t // 3) % 2 else "˜", MUTED)
        if phrase.endswith("for you"):
            bubble(cv, "?" if (t // 3) % 2 else " ? ", fill=YELLOW)
        else:
            bubble(cv, ("·", "··", "···", "")[(t // 3) % 4].ljust(3))
    elif mode == "blocked":
        bubble(cv, "!", fg=(255, 255, 255), fill=RED)
    elif mode == "talking":
        cv.put(18, 4, "~" if (t // 3) % 2 else "˜", MUTED)
        dots = ("·", "··", "···")[(t // 2) % 3]
        if speaking:
            bubble(cv, dots.ljust(3))
        else:  # their bubble, beside the monitor
            cv.put(16, 1, "▐", OTHER_CLAWD)
            cv.put(17, 1, dots.ljust(2)[:2], INK, OTHER_CLAWD, bold=True)
            cv.put(19, 1, "▌", OTHER_CLAWD)
            cv.put(19, 2, "▝", OTHER_CLAWD)

    text, tint = {
        "working": (VERB.get(name, "building"), GREEN),
        "sleeping": ("asleep", MUTED),
        "waiting": (phrase, YELLOW),
        "blocked": ("needs an answer", RED),
        "away": ("away", MUTED),
        "talking": (f"talking with {teamlib.OTHER_TEAM}", OTHER_CLAWD),
    }[mode]
    return cv.lines(crop), text, tint


def centred(words, style, cols=COLS):
    words = words[:cols]
    pad = max(0, (cols - len(words)) // 2)
    return " " * pad + f"{style}{words}{RESET}" + " " * max(0, cols - pad - len(words))


# --- reading the team's state (in a background thread, so the animation never stalls) ---


def run(cmd, timeout=6):
    demo = teamlib.demo_output(cmd)
    if demo is not None:
        return demo
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return out.stdout if out.returncode == 0 else ""
    except Exception:
        return ""


def roster():
    return [name for name, _ in teamlib.roster()]


def heard_from_other_team(name, seconds=240):
    """Whether `name` was told, in the last few minutes, that the other team did something. The listener's mark
    holds the time and then the agents it told; a mark with no names means the orchestrator."""
    try:
        with open(teamlib.TALK_MARK) as f:
            first, *told = f.read().split()
        if time.time() - float(first) >= seconds:
            return False
    except (OSError, ValueError):
        return False
    return name in (told or [teamlib.ORCHESTRATOR])


def background_shells(screen):
    """How many background commands the agent's status bar says are running (teamlib.background_commands)."""
    return teamlib.background_commands(screen)


def needs_owner():
    """Whether the architect has an open question for its human."""
    try:
        text = open(teamlib.NEEDS_FILE).read()
    except OSError:
        return False
    match = re.search(r"^## Needs you\s*\n(.*?)(?=^## |\Z)", text, re.M | re.S)
    return bool(match and re.search(r"^\s*[-*] ", match.group(1), re.M))


def poll(state):
    while True:
        names = roster()
        live = {}
        listing = run(["herdr", "agent", "list"])
        if listing:
            try:
                for agent in json.loads(listing)["result"]["agents"]:
                    if agent.get("name"):
                        live[agent["name"]] = agent.get("agent_status", "unknown")
            except (ValueError, KeyError):
                pass
        asks = needs_owner()
        with_other_team = teamlib.partner_active()
        modes = {}
        for name in names:
            status = live.get(teamlib.herdr_name(name))
            screen = ""
            if name in WAITERS and status in ("working", "idle", "done"):
                screen = run(["herdr", "agent", "read", teamlib.herdr_name(name), "--source", "visible", "--lines", "14"])
            if status is None:
                modes[name] = ("away", "")
            elif status == "blocked":
                modes[name] = ("blocked", "")
            elif status == "working":
                # Reading or answering the other team: a GitHub command on its screen, or the listener has just
                # told it the other team did something.
                on_github = bool(re.search(r"\bgh (issue|pr|api|label)\b|github-activity", screen))
                talking = with_other_team and name in WAITERS and (on_github or heard_from_other_team(name))
                modes[name] = ("talking", "") if talking else ("working", "")
            elif name in WAITERS:
                background = background_shells(screen)
                if name == "architect" and asks:
                    modes[name] = ("waiting", "waiting for you")
                elif teamlib.PARTNER_SIDE and name == "architect" and background == 1:
                    modes[name] = ("waiting", f"listening for {teamlib.OTHER_TEAM}")  # its one background command is the watch
                elif background:
                    modes[name] = ("waiting", "waiting for the team" if name == "architect" else "waiting for workers")
                else:
                    modes[name] = ("sleeping", "")
            else:
                modes[name] = ("sleeping", "")
        if names != state.get("names") or modes != state.get("modes"):
            state["version"] = state.get("version", 0) + 1  # the frame loop redraws at once
        state["names"], state["modes"] = names, modes
        state["active"] = any(m[0] in ("working", "talking") for m in modes.values())
        time.sleep(3 if state["active"] else 20)  # nothing moves in an office where nobody works


def frame(state, codes, t, width, height):
    names = state.get("names") or []
    if not names:
        return ["", "  waiting for the team to appear…"]
    def layout(gap, crop):  # as few rows as the width allows, the desks spread evenly over them: 3 + 3, or 2 + 2
        cols = COLS - 2 * crop  # a cropped desk loses its empty margin cell on each side
        fit = max(1, (width + gap) // (cols + gap))
        row_count = -(-len(names) // fit)
        per_row = -(-len(names) // row_count)
        rows = [names[i : i + per_row] for i in range(0, len(names), per_row)]
        return gap, crop, cols, per_row, rows, height // len(rows)

    # Desks sit three cells apart. In a pane too short for the rows that gives, they move closer
    # so that more fit on a row, then lose their margins, then touch: a desk cut off at the bottom
    # is worse than a narrow gap. (A 95-column pane 20 lines tall holds six desks as two rows of
    # three, two cells apart; an 85-column pane holds them as two rows of three touching desks.)
    tries = [layout(gap, crop) for gap, crop in ((3, 0), (2, 0), (1, 0), (2, 1), (1, 1), (0, 1))]
    gap, crop, cols, per_row, rows, room = next((l for l in tries if l[5] >= ROWS), max(tries, key=lambda l: l[5]))
    # Each desk is nine drawn lines plus its name and what it is doing. In a short pane, give up
    # the desk legs first, then put the name and the activity on one line, then the feet; a pane
    # shorter still cuts the drawing further from the bottom, so the names always show.
    spaced = room >= ROWS + 3
    caption_lines = 2 if room >= ROWS + 1 else 1
    keep = max(1, min(ROWS, room - caption_lines))
    left = " " * max(0, (width - (per_row * cols + (per_row - 1) * gap)) // 2)
    out = []
    for group in rows:
        drawn = []
        for name in group:
            mode, phrase = state["modes"].get(name, ("away", ""))
            offset = sum(map(ord, name)) % 11  # so the desks do not move in step
            art, text, tint = scene(name, mode, t + offset, codes.setdefault(name, code_lines(name)), phrase, crop)
            art = art[:keep]
            bold = "\033[1m" + colour(TEXT)
            if caption_lines == 1:
                words = f"{name} · {text}"[:cols]
                pad = max(0, (cols - len(words)) // 2)
                shown = words.replace(name, f"{bold}{name}{RESET}{colour(tint)}", 1)
                caption = [" " * pad + f"{colour(tint)}{shown}{RESET}" + " " * max(0, cols - pad - len(words))]
            else:
                caption = [centred(name, bold, cols), centred(text, colour(tint), cols)]
            drawn.append(art + caption)
        for i in range(len(drawn[0])):
            out.append(left + (" " * gap).join(lines[i] for lines in drawn))
        if spaced:
            out.append("")
    # The last line carries no newline and wrapping is off, so every row of the pane can be used.
    return out[: max(height, 1)]


def main():
    state, codes = {}, {}
    threading.Thread(target=poll, args=(state,), daemon=True).start()
    sys.stdout.write("\033[?1049h\033[?7l\033[?25l" + "\033[2J")  # alternate screen, no wrapping, no cursor
    t = 0
    try:
        while True:
            size = shutil.get_terminal_size((100, 24))
            lines = frame(state, codes, t, size.columns, size.lines)
            sys.stdout.write("\033[H" + "\033[K\n".join(lines) + "\033[K\033[J")
            sys.stdout.flush()
            if state.get("active") or not state.get("names"):
                time.sleep(FRAME_SECONDS)
            else:  # at rest: a frame every 20 s, or at once when what the office shows changes
                seen = state.get("version")
                for _ in range(40):
                    time.sleep(0.5)
                    if state.get("version") != seen:
                        break
            t += 1
    except KeyboardInterrupt:
        pass
    finally:
        sys.stdout.write("\033[?7h\033[?25h\033[?1049l")


if __name__ == "__main__":
    main()
