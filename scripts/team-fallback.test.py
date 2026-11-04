# Unit tests for team-fallback.py: reading the out-of-usage message and the warning's reset time, and what one round
# decides. No Herdr, no restart: the actions are passed in. Run: python3 -I scripts/team-fallback.test.py
# (the agent-team kit ships it; `test.sh` runs it, and a project can run it from its own test command).
import datetime
import importlib.util
import os
import sys
import tempfile
import time
import unittest
from unittest import mock

here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, here)
import teamlib  # noqa: E402

spec = importlib.util.spec_from_file_location("team_fallback", os.path.join(here, "team-fallback.py"))
fb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fb)

# The architect's pane on 2026-10-28 at 00:17, when the account ran out of Fable usage.
OUT_SCREEN = """⏺ Understood: builder-1 and the verifier belong to the run.
❯ [Setup session] The kit is updated in your main checkout.
  ⎿  2 skills available
  ⎿  You're out of usage credits. Run /usage-credits to
     keep using Fable 5.1 or /model to switch models.
     Usage credits are at least 30% off for one purchase
     · 14 days left · /usage-credits
✻ Brewed for 0s · done 12:17 AM
──────────────────────────────────────────── architect ─
❯
────────────────────────────────────────────────────────
  architect · Fable 5.1 · context ▰▱▱▱▱▱▱▱▱▱ 14% · pl…
  ⏵⏵ bypass permissions on (shift+tab to cycle)
"""
WARN_SCREEN = "✻ Worked for 3m · done 9:05 PM\n  You've used 86% of your Fable limit · resets Oct 30 at 3am\n❯\n"
NOW = datetime.datetime(2026, 10, 28, 0, 20).timestamp()


class Reading(unittest.TestCase):
    def test_the_message_names_the_model_family(self):
        self.assertEqual(fb.ran_out(OUT_SCREEN), "Fable")

    def test_the_message_counts_only_at_the_bottom(self):
        quoted = OUT_SCREEN.replace("✻ Brewed for 0s", "⏺ " + "\n⏺ ".join(f"line {i}" for i in range(20)) + "\n✻ Brewed for 0s")
        self.assertIsNone(fb.ran_out(quoted))
        self.assertIsNone(fb.ran_out(""))
        self.assertIsNone(fb.ran_out(None))

    def test_the_warning_gives_the_reset(self):
        found = fb.warning_resets(WARN_SCREEN, NOW)
        self.assertEqual(found["Fable"][0], 86)
        self.assertEqual(datetime.datetime.fromtimestamp(found["Fable"][1]), datetime.datetime(2026, 10, 30, 3, 0))

    def test_a_pm_reset_with_minutes(self):
        found = fb.warning_resets("You've used 95% of your Opus limit · resets Nov 2 at 4:30pm", NOW)
        self.assertEqual(datetime.datetime.fromtimestamp(found["Opus"][1]), datetime.datetime(2026, 11, 2, 16, 30))

    def test_until_is_the_known_reset_else_a_retry(self):
        reset = NOW + 3600
        self.assertEqual(fb.until_for("Fable", {"Fable": {"resets_at": reset}}, NOW), reset + fb.MARGIN)
        self.assertEqual(fb.until_for("Fable", {"Fable": {"resets_at": NOW - 10}}, NOW), NOW + fb.RETRY)
        self.assertEqual(fb.until_for("Fable", {}, NOW), NOW + fb.RETRY)


class Round(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        team = self.folder.name
        patches = [
            mock.patch.object(teamlib, "OVERRIDE_DIR", os.path.join(team, "model-override")),
            mock.patch.object(teamlib, "STATUS", os.path.join(team, "status")),
            mock.patch.object(fb, "LIMITS", os.path.join(team, "status", "limits.json")),
            mock.patch.object(fb, "LOG", os.path.join(team, "status", "fallback.log")),
            mock.patch.object(teamlib, "FALLBACK_MODEL", "claude-opus-5-5"),
            mock.patch.object(teamlib, "asleep", lambda: ""),
            mock.patch.object(fb, "current_model", lambda role: "claude-fable-5-1"),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.fell, self.back = [], []

    def round(self, live, screens, now=NOW):
        fb.tick(now, live, read=lambda pane: screens.get(pane, ""),
                fall=lambda role, family, until: self.fell.append((role, family, until)),
                back=lambda role, info: self.back.append(role))

    def test_an_idle_agent_out_of_usage_falls_back(self):
        self.round({"architect": {"agent_status": "idle", "pane_id": "p1"}}, {"p1": OUT_SCREEN})
        self.assertEqual([(r, f) for r, f, _ in self.fell], [("architect", "Fable")])

    def test_a_working_agent_is_left_alone(self):
        self.round({"architect": {"agent_status": "working", "pane_id": "p1"}}, {"p1": OUT_SCREEN})
        self.assertEqual(self.fell, [])

    def test_an_agent_already_on_the_fallback_model_is_left_alone(self):
        with mock.patch.object(fb, "current_model", lambda role: "claude-opus-5-5"):
            self.round({"architect": {"agent_status": "idle", "pane_id": "p1"}}, {"p1": OUT_SCREEN})
        self.assertEqual(self.fell, [])

    def test_a_warning_seen_earlier_sets_the_time_to_come_back(self):
        self.round({"architect": {"agent_status": "idle", "pane_id": "p1"}}, {"p1": WARN_SCREEN})
        self.round({"architect": {"agent_status": "idle", "pane_id": "p1"}}, {"p1": OUT_SCREEN})
        self.assertEqual(datetime.datetime.fromtimestamp(self.fell[0][2]), datetime.datetime(2026, 10, 30, 3, 5))

    def test_on_the_fallback_until_the_time_then_back(self):
        teamlib.write_override("architect", "claude-opus-5-5", "xhigh", NOW + 60, "Fable limit")
        self.round({"architect": {"agent_status": "idle", "pane_id": "p1"}}, {"p1": OUT_SCREEN})
        self.assertEqual((self.fell, self.back), ([], []))
        self.round({"architect": {"agent_status": "idle", "pane_id": "p1"}}, {}, now=NOW + 61)
        self.assertEqual(self.back, ["architect"])

    def test_off_when_the_setting_is_empty(self):
        with mock.patch.object(teamlib, "FALLBACK_MODEL", ""):
            self.round({"architect": {"agent_status": "idle", "pane_id": "p1"}}, {"p1": OUT_SCREEN})
        self.assertEqual(self.fell, [])


class Override(unittest.TestCase):
    def test_write_read_clear(self):
        with tempfile.TemporaryDirectory() as folder, mock.patch.object(teamlib, "OVERRIDE_DIR", folder):
            self.assertIsNone(teamlib.model_override("architect"))
            teamlib.write_override("architect", "claude-opus-5-5", "xhigh", NOW + 10, "Fable limit")
            self.assertEqual(teamlib.model_override("architect"), {"model": "claude-opus-5-5", "effort": "xhigh", "until": int(NOW + 10), "reason": "Fable limit"})
            teamlib.clear_override("architect")
            self.assertIsNone(teamlib.model_override("architect"))

    def test_coming_back_waits_for_an_idle_agent_with_nothing_in_the_background(self):
        restarted = []
        with tempfile.TemporaryDirectory() as folder, mock.patch.object(teamlib, "OVERRIDE_DIR", folder), \
                mock.patch.object(fb, "log", lambda text: None):
            teamlib.write_override("architect", "claude-opus-5-5", "xhigh", NOW, "Fable limit")
            go = lambda *a: restarted.append(a) or (True, "")  # noqa: E731
            with mock.patch.object(fb, "screen_of", lambda pane: "  ⏵⏵ bypass permissions on · 1 shell\n"):
                self.assertFalse(fb.come_back("architect", {"agent_status": "idle", "pane_id": "p1"}, restart=go, note=lambda t: None))
            self.assertFalse(fb.come_back("architect", {"agent_status": "working", "pane_id": "p1"}, restart=go, note=lambda t: None))
            with mock.patch.object(fb, "screen_of", lambda pane: "❯\n"):
                self.assertTrue(fb.come_back("architect", {"agent_status": "idle", "pane_id": "p1"}, restart=go, note=lambda t: None))
            self.assertEqual(restarted, [("restart", "architect", "--keep")])
            self.assertIsNone(teamlib.model_override("architect"))


if __name__ == "__main__":
    unittest.main()
