# Unit tests for the watchdog's helpers: what counts as work in flight (scripts/teamlib.py) and
# the dashboard's watchdog line (scripts/team-dash.py). Run: python3 -I scripts/team-watch.test.py
# (the agent-team kit ships it; `test.sh` runs it, and a project can run it from its own test command).
import importlib.util
import os
import sys
import tempfile
import unittest

here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, here)
import teamlib  # noqa: E402

spec = importlib.util.spec_from_file_location("team_dash", os.path.join(here, "team-dash.py"))
dash = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dash)

BOARD = """# Board

**Now: M35 is open.** A State in prose (building) is not a row.

## M35 tasks

| Task | Item | Owner | State | Notes |
|---|---|---|---|---|
| T-477 idle turns | 1a | builder-1 | building | owns team-watch |
| T-478 house style | 7 | builder-2 | done (merged abc) | |
| T-480 cost ledger | 5 | builder-2 | ready (brief written) | |
| T-482 impact map | 6 | last | not written | |
| Close | | architect | | |

## Carried

| Item | Where | Notes |
|---|---|---|
| building | a table without a State column | not a task row |
"""


class InFlight(unittest.TestCase):
    def board(self, text):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        path = os.path.join(folder.name, "board.md")
        with open(path, "w") as f:
            f.write(text)
        return path

    def test_rows_in_an_active_state_are_in_flight(self):
        self.assertEqual(teamlib.board_in_flight(self.board(BOARD)), ["T-477 building", "T-480 ready"])

    def test_a_board_of_done_rows_is_nothing_in_flight(self):
        done = BOARD.replace("| building |", "| done |").replace("| ready (brief written) |", "| done |")
        self.assertEqual(teamlib.board_in_flight(self.board(done)), [])
        self.assertEqual(teamlib.in_flight(self.board(done)), "")

    def test_every_active_word_counts(self):
        for state in ("assigned", "in review", "verifying", "changes requested", "design pass", "Running the close"):
            text = BOARD.replace("| done (merged abc) |", f"| {state} |")
            self.assertIn(f"T-478 {state}", teamlib.board_in_flight(self.board(text)), state)

    def test_in_flight_names_the_rows(self):
        self.assertEqual(teamlib.in_flight(self.board(BOARD)), "board: T-477 building, T-480 ready")

    def test_no_board_is_nothing_from_the_board(self):
        self.assertEqual(teamlib.board_in_flight("/nonexistent/board.md"), [])

    def test_the_status_bar_counts_background_commands(self):
        self.assertEqual(teamlib.background_commands("Read 2 files, ran 2 shell commands\n  ⏵⏵ bypass permissions on · 3 shells\n"), 3)
        self.assertEqual(teamlib.background_commands("⏺ Done · 1 shell still running\n"), 0)  # the end of a turn, stale
        self.assertEqual(teamlib.background_commands("✻ Churned · done 6:17 PM · 2 shells still\n  running\n"), 0)  # wrapped
        self.assertEqual(teamlib.background_commands("ran 4 shell commands\n"), 0)


class DashboardLine(unittest.TestCase):
    NOW = 1_800_000_000

    def test_a_fresh_beat_of_a_live_process_is_alive_with_its_age(self):
        data = {"pid": 1, "started_at": self.NOW - (2 * 3600 + 10 * 60), "beat_at": self.NOW - 30}
        self.assertEqual(dash.watchdog_status(data, self.NOW, alive=lambda pid: True), ("alive 2h 10m", True))

    def test_a_stale_beat_is_none(self):
        data = {"pid": 1, "started_at": self.NOW - 3600, "beat_at": self.NOW - 200}
        self.assertEqual(dash.watchdog_status(data, self.NOW, alive=lambda pid: True), ("none", False))

    def test_a_dead_process_is_none(self):
        data = {"pid": 1, "started_at": self.NOW - 600, "beat_at": self.NOW - 10}
        self.assertEqual(dash.watchdog_status(data, self.NOW, alive=lambda pid: False), ("none", False))

    def test_an_ended_watchdog_says_why(self):
        data = {"pid": 1, "started_at": self.NOW - 3600, "beat_at": self.NOW - 300, "ended": "an agent is blocked", "ended_at": self.NOW - 300}
        self.assertEqual(dash.watchdog_status(data, self.NOW), ("ended 5m ago (an agent is blocked)", False))

    def test_no_file_is_none(self):
        original = teamlib.WATCH_FILE
        teamlib.WATCH_FILE = "/nonexistent/watch.json"
        try:
            self.assertEqual(dash.watchdog_status(), ("none", False))
        finally:
            teamlib.WATCH_FILE = original


if __name__ == "__main__":
    unittest.main()
