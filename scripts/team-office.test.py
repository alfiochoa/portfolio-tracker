# Unit tests for team-office.py's readings of the team: who the other team's notice was sent
# to, and the status bar's count of background commands. No Herdr, no GitHub: `run` is patched and
# the mark file is a temporary one. Run: python3 -I scripts/team-office.test.py
# (the agent-team kit ships it; `test.sh` runs it, and a project can run it from its own test command).
import importlib.util
import json
import os
import sys
import tempfile
import time
import unittest
from unittest import mock

here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, here)
import teamlib  # noqa: E402

spec = importlib.util.spec_from_file_location("team_office", os.path.join(here, "team-office.py"))
office = importlib.util.module_from_spec(spec)
spec.loader.exec_module(office)

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


class Stop(Exception):
    pass


class BackgroundShells(unittest.TestCase):
    def test_the_bar_alone(self):
        self.assertEqual(office.background_shells(BAR_ONE_SHELL), 1)
        self.assertEqual(office.background_shells("  ⏵⏵ bypass permissions on · 2 shells\n"), 2)
        self.assertEqual(office.background_shells("  ⏵⏵ bypass permissions on · 12 shells"), 12)

    def test_ran_shell_commands_in_the_transcript_is_not_a_count(self):
        self.assertEqual(office.background_shells(RAN + BAR_NONE), 0)
        self.assertEqual(office.background_shells("ran 2 shell commands\n"), 0)
        self.assertEqual(office.background_shells("the 2 shells I started\n"), 0)

    def test_the_stale_end_of_turn_line_is_not_a_count(self):
        self.assertEqual(office.background_shells(END_OF_TURN + "\n" + BAR_NONE), 0)
        self.assertEqual(office.background_shells("✻ Cooked for 3s · done 14:40 · 2 shells still running\n"), 0)

    def test_both_lines_with_a_live_bar_count_the_bar(self):
        self.assertEqual(office.background_shells(RAN + END_OF_TURN + "\n" + BAR_ONE_SHELL), 1)
        self.assertEqual(office.background_shells(END_OF_TURN + "\n  ⏵⏵ bypass permissions on · 3 shells\n"), 3)

    def test_the_last_bar_on_the_screen_wins(self):
        self.assertEqual(office.background_shells("  ⏵⏵ bypass permissions on · 3 shells\n" + BAR_ONE_SHELL), 1)

    def test_nothing(self):
        self.assertEqual(office.background_shells(""), 0)
        self.assertEqual(office.background_shells(None), 0)
        self.assertEqual(office.background_shells("hello\n"), 0)


class Heard(unittest.TestCase):
    def check(self, text, name, ago=10):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "_other-team-activity")
            if text is not None:
                with open(path, "w") as f:
                    f.write(text.replace("{t}", str(NOW - ago)))
            with mock.patch.object(teamlib, "TALK_MARK", path), mock.patch.object(time, "time", lambda: NOW):
                return office.heard_from_other_team(name)

    def test_a_notice_sent_to_a_worker_marks_the_worker_and_not_the_architect(self):
        self.assertTrue(self.check("{t} builder-1", "builder-1"))
        self.assertFalse(self.check("{t} builder-1", "architect"))

    def test_a_notice_sent_to_both_marks_both(self):
        self.assertTrue(self.check("{t} builder-1 architect", "builder-1"))
        self.assertTrue(self.check("{t} builder-1 architect", "architect"))

    def test_a_mark_with_no_names_means_the_orchestrator(self):  # today's format, --once and --watch
        self.assertTrue(self.check("{t}", "architect"))
        self.assertFalse(self.check("{t}", "builder-1"))
        self.assertTrue(self.check("{t}\n", "architect"))

    def test_a_stale_mark_marks_nobody(self):
        for text in ("{t}", "{t} builder-1", "{t} builder-1 architect"):
            for name in ("architect", "builder-1"):
                self.assertFalse(self.check(text, name, ago=240), (text, name))
                self.assertFalse(self.check(text, name, ago=3000), (text, name))
        self.assertTrue(self.check("{t} builder-1", "builder-1", ago=239))

    def test_a_missing_empty_or_garbled_mark_marks_nobody(self):
        for text in (None, "", "  \n", "soon builder-1", "builder-1 {t}"):
            for name in ("architect", "builder-1"):
                self.assertFalse(self.check(text, name), (text, name))


class Modes(unittest.TestCase):
    """What poll() decides for each agent, with Herdr's answers faked."""

    def modes(self, statuses, screens=None, mark=None, support=False, asks=False):
        # Herdr knows the agents by their prefixed names when the project has a PREFIX (teamlib.herdr_name).
        screens = {teamlib.herdr_name(k): v for k, v in (screens or {}).items()}

        def fake_run(cmd, timeout=6):
            if cmd[:3] == ["herdr", "agent", "list"]:
                agents = [{"name": teamlib.herdr_name(n), "agent_status": s} for n, s in statuses.items() if s]
                return json.dumps({"result": {"agents": agents}})
            if cmd[:3] == ["herdr", "agent", "read"]:
                return screens.get(cmd[3], "")
            return ""

        def stop(_):
            raise Stop()

        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "_other-team-activity")
            if mark is not None:
                with open(path, "w") as f:
                    f.write(mark.replace("{t}", str(NOW - 10)))
            state = {}
            with mock.patch.object(office, "run", fake_run), \
                    mock.patch.object(office, "roster", lambda: list(statuses)), \
                    mock.patch.object(office, "needs_owner", lambda: asks), \
                    mock.patch.object(teamlib, "partner_active", lambda: True), \
                    mock.patch.object(teamlib, "PARTNER_SIDE", support), \
                    mock.patch.object(teamlib, "TALK_MARK", path), \
                    mock.patch.object(time, "time", lambda: NOW), \
                    mock.patch.object(time, "sleep", stop):
                with self.assertRaises(Stop):
                    office.poll(state)
        return {name: mode[0] for name, mode in state["modes"].items()}

    # The architect is the one waiter (teamlib.WAITERS); a worker beside it.
    WORKING = {"architect": "working", "verifier": "working"}

    def test_a_notice_to_a_worker_puts_nobody_on_the_call(self):
        self.assertEqual(self.modes(self.WORKING, mark="{t} verifier"), {"architect": "working", "verifier": "working"})

    def test_a_notice_to_the_architect_puts_the_architect_on_the_call(self):
        self.assertEqual(self.modes(self.WORKING, mark="{t} architect"), {"architect": "talking", "verifier": "working"})

    def test_a_mark_with_no_names_is_the_architect_as_before(self):
        self.assertEqual(self.modes(self.WORKING, mark="{t}"), {"architect": "talking", "verifier": "working"})

    def test_no_fresh_mark_nobody_talks(self):
        self.assertEqual(self.modes(self.WORKING), {"architect": "working", "verifier": "working"})

    def test_a_gh_command_on_the_screen_still_puts_an_agent_on_the_call(self):
        screens = {"architect": "⏺ Bash(gh pr view 201)\n"}
        self.assertEqual(self.modes(self.WORKING, screens)["architect"], "talking")

    def test_a_worker_is_never_on_the_call(self):
        self.assertEqual(self.modes({"builder-1": "working"}, mark="{t} builder-1"), {"builder-1": "working"})

    def idle(self, screen, name="architect", **kw):
        return self.modes({name: "done"}, {name: screen}, **kw)[name]

    def test_a_live_bar_with_a_background_command_is_waiting(self):
        self.assertEqual(self.idle(BAR_ONE_SHELL), "waiting")

    def test_a_finished_turn_with_no_live_command_sleeps(self):
        self.assertEqual(self.idle(END_OF_TURN + "\n" + BAR_NONE), "sleeping")

    def test_ran_shell_commands_in_the_transcript_does_not_keep_an_agent_waiting(self):
        self.assertEqual(self.idle(RAN + BAR_NONE), "sleeping")

    def test_the_partner_architect_with_its_one_command_is_listening(self):
        modes = self.modes({"architect": "done"}, {"architect": BAR_ONE_SHELL}, support=True)
        self.assertEqual(modes, {"architect": "waiting"})


if __name__ == "__main__":
    unittest.main()
