# Unit tests for team-dash.py's readings of an agent's screen and of the other-team mark:
# the status bar's count of background commands, and "last heard from them". No Herdr, no GitHub:
# `run` is patched and the mark file is a temporary one. Run: python3 -I scripts/team-dash.test.py
# (the agent-team kit ships it; `test.sh` runs it, and a project can run it from its own test command).
import importlib.util
import json
import os
import re
import sys
import tempfile
import time
import unittest
from unittest import mock

here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, here)
import teamlib  # noqa: E402

spec = importlib.util.spec_from_file_location("team_dash", os.path.join(here, "team-dash.py"))
dash = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dash)

NOW = 1792846800

# Live captures (herdr agent read <name> --source visible --lines 14), 2026-10-24.
BAR_ONE_SHELL = (
    "  architect · Fable 5 · context ▰▰▱▱▱▱▱▱▱▱ 20% · plan: 83…\n"
    "  ⏵⏵ bypass permissions on · 1 shell\n"
)
BAR_NONE = (
    "  setup · Fable 5 · context ▰▱▱▱▱▱▱▱▱▱ 8% · plan: 87% of 5h left, 55% of week left\n"
    "  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents\n"
)
END_OF_TURN = "✻ Baked for 1m 1s · done 14:38 · 1 shell still running\n"
RAN = "⏺ Ran 2 shell commands\n  ⎿ done\n"


class BackgroundShells(unittest.TestCase):
    def test_the_bar_alone(self):
        self.assertEqual(dash.background_shells(BAR_ONE_SHELL), "1 background command")
        self.assertEqual(dash.background_shells("  ⏵⏵ bypass permissions on · 2 shells\n"), "2 background commands")

    def test_ran_shell_commands_in_the_transcript_is_not_a_count(self):
        self.assertEqual(dash.background_shells(RAN + BAR_NONE), "")
        self.assertEqual(dash.background_shells("ran 2 shell commands\n"), "")

    def test_the_stale_end_of_turn_line_is_not_a_count(self):
        self.assertEqual(dash.background_shells(END_OF_TURN + "\n" + BAR_NONE), "")
        self.assertEqual(dash.background_shells("✻ Cooked for 3s · done 14:40 · 2 shells still running\n"), "")

    def test_both_lines_with_a_live_bar_count_the_bar(self):
        self.assertEqual(dash.background_shells(RAN + END_OF_TURN + "\n" + BAR_ONE_SHELL), "1 background command")
        self.assertEqual(dash.background_shells(END_OF_TURN + "\n  ⏵⏵ bypass permissions on · 3 shells\n"), "3 background commands")

    def test_nothing(self):
        self.assertEqual(dash.background_shells(""), "")
        self.assertEqual(dash.background_shells(None), "")


class ScreenSummary(unittest.TestCase):
    def summary(self, screen):
        with mock.patch.object(dash, "run", lambda cmd, timeout=6: screen):
            return dash.screen_summary("architect")

    def test_a_finished_turn_with_a_live_command_shows_the_time_and_the_command(self):
        screen = "⏺ Done with the PR.\n\n" + END_OF_TURN + "\n" + BAR_ONE_SHELL
        self.assertEqual(self.summary(screen), ("finished 14:38", "Done with the PR.", "1 background command"))

    def test_a_finished_turn_whose_command_has_ended_shows_none(self):
        screen = "⏺ Done with the PR.\n\n" + END_OF_TURN + "\n" + BAR_NONE
        self.assertEqual(self.summary(screen), ("finished 14:38", "Done with the PR.", ""))

    def test_a_live_bar_counts_while_the_turn_is_still_running(self):
        screen = "✻ Cooking… (12s · ↓ 300 tokens)\n\n" + BAR_ONE_SHELL
        self.assertEqual(self.summary(screen), ("for 12s", "", "1 background command"))


class LastHeard(unittest.TestCase):
    def heard_line(self, mark):
        def fake_run(cmd, timeout=6):
            if cmd[:3] == ["herdr", "agent", "list"]:
                return json.dumps({"result": {"agents": []}})
            return ""

        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "_other-team-activity")
            if mark is not None:
                with open(path, "w") as f:
                    f.write(mark.replace("{t}", str(NOW - 7 * 60 - 20)))
            with mock.patch.object(dash, "run", fake_run), \
                    mock.patch.object(dash, "other_team", lambda: []), \
                    mock.patch.object(dash, "load_statuses", lambda: {}), \
                    mock.patch.object(dash, "plan_usage", lambda statuses: ""), \
                    mock.patch.object(dash, "board_rows", lambda: ([], [])), \
                    mock.patch.object(dash, "section", lambda path, heading: None), \
                    mock.patch.object(teamlib, "partner_active", lambda: True), \
                    mock.patch.object(teamlib, "PARTNER_SIDE", True), \
                    mock.patch.object(teamlib, "TALK_MARK", path), \
                    mock.patch.object(time, "time", lambda: NOW):
                lines = dash.render([], 200, 60)
        text = "\n".join(re.sub(r"\033\[[0-9;]*m", "", line) for line in lines)
        found = re.search(r"open on GitHub( · last heard from them \d+ min ago)?", text)
        return found.group(0) if found else None

    def test_the_time_alone_and_the_time_with_names_read_the_same(self):
        alone = self.heard_line("{t}")
        self.assertTrue(alone.endswith("last heard from them 7 min ago"), alone)
        self.assertEqual(self.heard_line("{t} builder-1"), alone)
        self.assertEqual(self.heard_line("{t} builder-1 architect"), alone)

    def test_no_line_when_there_is_no_usable_mark(self):
        for mark in (None, "", "soon builder-1"):
            line = self.heard_line(mark)
            self.assertTrue(line and "last heard" not in line, (mark, line))


if __name__ == "__main__":
    unittest.main()
