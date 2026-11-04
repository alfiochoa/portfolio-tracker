# Unit tests for team-cost.py, the cost ledger. Run: python3 -I scripts/team-cost.test.py
# No network and no real transcripts: every test builds a temporary repository, a temporary projects folder
# (what would be ~/.claude/projects) and a temporary status folder, with transcript lines made up here.
import contextlib
import datetime
import importlib.util
import io
import json
import os
import shutil
import subprocess
import tempfile
import sys
import unittest

here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, here)  # team-dash.py imports teamlib
spec = importlib.util.spec_from_file_location("team_cost", os.path.join(here, "team-cost.py"))
tc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tc)

SECRET = "sk-ant-FAKE-0123456789-do-not-print"  # made up; it must never reach any output


def utc(text):
    return tc.parse_time(text)


def transcript_line(ts, model, msg_id, i=0, o=0, cr=0, w5=0, w1=0, fast=False, kind="assistant"):
    """One made-up assistant line whose content carries the fake secret."""
    usage = {
        "input_tokens": i,
        "output_tokens": o,
        "cache_read_input_tokens": cr,
        "cache_creation_input_tokens": w5 + w1,
        "cache_creation": {"ephemeral_5m_input_tokens": w5, "ephemeral_1h_input_tokens": w1},
        "speed": "fast" if fast else "standard",
    }
    return json.dumps({
        "type": kind,
        "timestamp": ts,
        "requestId": "req_" + msg_id,
        "message": {"id": msg_id, "model": model, "role": "assistant", "content": [{"type": "text", "text": SECRET}], "usage": usage},
    }, separators=(",", ":"))


def name_line(name):
    return json.dumps({"type": "agent-name", "agentName": name, "sessionId": "x"}, separators=(",", ":"))


class Env(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="team-cost-test-")
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        self.repo = os.path.join(self.root, "Repo")
        self.projects = os.path.join(self.root, "projects")
        self.status = os.path.join(self.root, "status")
        for d in (self.repo, self.projects, self.status):
            os.makedirs(d)

    # -- a git repository whose history gives the milestone windows
    def git(self, *args, when=None):
        env = dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@example.com", GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@example.com")
        if when:
            env["GIT_AUTHOR_DATE"] = env["GIT_COMMITTER_DATE"] = when
        subprocess.run(["git", "-C", self.repo, "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", *args], check=True, capture_output=True, env=env)

    def spec(self, text, when):
        os.makedirs(os.path.join(self.repo, "docs"), exist_ok=True)
        with open(os.path.join(self.repo, "docs", "SPEC.md"), "w") as f:
            f.write(text)
        self.git("add", "-A")
        self.git("commit", "-m", "spec", when=when)

    def init_repo(self):
        self.git("init", "-q", "-b", "main")

    # -- transcripts
    def project(self, worktree=None):
        name = tc.encode_project(self.repo if worktree is None else self.repo + "-worktrees") + ("" if worktree is None else "-" + worktree)
        path = os.path.join(self.projects, name)
        os.makedirs(path, exist_ok=True)
        return path

    def write(self, folder, name, lines):
        path = os.path.join(folder, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write("\n".join(lines) + "\n")
        return path

    def log(self, *rows):
        with open(os.path.join(self.status, "assignments.log"), "w") as f:
            f.write("".join("\t".join(r) + "\n" for r in rows))

    def run_ledger(self, *extra, fmt=()):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            tc.main(["--repo", self.repo, "--status-dir", self.status, "--projects-dir", self.projects, *extra, *fmt])
        return out.getvalue()

    def data(self, *extra):
        return json.loads(self.run_ledger(*extra, fmt=("--json",)))


class Window(Env):
    def test_milestone_runs_from_the_heading_commit_to_the_tag_date(self):
        self.init_repo()
        self.spec("### M3: old\n", "2026-10-01T10:00:00Z")
        self.spec("### M3: old\n### M35: new\n", "2026-10-05T10:00:00Z")
        self.spec("### M3: old, edited\n### M35: new\n", "2026-10-06T10:00:00Z")  # an edit of M3 is not M35's start
        self.git("tag", "-a", "m35", "-m", "m35", when="2026-10-09T18:30:00Z")
        start, end = tc.milestone_window(self.repo, "M35")
        self.assertEqual((tc.iso(start), tc.iso(end)), ("2026-10-05T10:00:00Z", "2026-10-09T18:30:00Z"))
        # An untagged M3 beside a tagged m35: a higher milestone's tag says nothing about when M3 began, so it starts at
        # its own heading commit, and it ends where m35 was tagged (it was skipped or folded), not now.
        m3_start, m3_end = tc.milestone_window(self.repo, "M3")
        self.assertEqual((tc.iso(m3_start), tc.iso(m3_end)), ("2026-10-01T10:00:00Z", "2026-10-09T18:30:00Z"))

    def test_a_spec_written_ahead_starts_each_milestone_at_the_lower_tag(self):
        self.init_repo()
        self.spec("### M4: a\n### M5: b\n", "2026-10-01T10:00:00Z")
        self.git("tag", "-a", "m4", "-m", "m4", when="2026-10-03T10:00:00Z")
        now = utc("2026-10-07T00:00:00Z")
        self.assertEqual(tc.milestone_window(self.repo, "M5", now), (utc("2026-10-03T10:00:00Z"), now))

    def test_without_a_tag_the_window_ends_now(self):
        self.init_repo()
        self.spec("### M7: x\n", "2026-10-05T10:00:00Z")
        now = utc("2026-10-20T00:00:00Z")
        self.assertEqual(tc.milestone_window(self.repo, "M7", now), (utc("2026-10-05T10:00:00Z"), now))

    def test_open_milestone_is_the_lowest_untagged_above_the_highest_tag(self):
        # The kit's rule (2026-10-26): a spec that lists M6 and M7 ahead of time makes M6 the open one once m5
        # exists, and none once m7 does (M6 below the highest tag is not open; it was skipped or folded).
        self.init_repo()
        self.spec("### M5: a\n### M6: b\n### M7: c\n", "2026-10-05T10:00:00Z")
        self.git("tag", "m5")
        self.assertEqual(tc.open_milestone(self.repo), "M6")
        self.git("tag", "m7")
        self.assertIsNone(tc.open_milestone(self.repo))

    def test_only_turns_inside_the_window_are_counted(self):
        self.init_repo()
        self.spec("### M2: x\n", "2026-10-05T10:00:00Z")
        self.git("tag", "-a", "m2", "-m", "m2", when="2026-10-06T10:00:00Z")
        folder = self.project("builder-1")
        self.write(folder, "a.jsonl", [
            transcript_line("2026-10-05T09:59:59.000Z", "claude-opus-5-5", "m_before", o=1000),
            transcript_line("2026-10-05T10:00:01.000Z", "claude-opus-5-5", "m_in1", o=1000),
            transcript_line("2026-10-06T09:59:00.000Z", "claude-opus-5-5", "m_in2", o=1000),
            transcript_line("2026-10-06T10:00:01.000Z", "claude-opus-5-5", "m_after", o=1000),
        ])
        data = self.data("--milestone", "M2")
        self.assertEqual(data["total"]["turns"], 2)
        self.assertEqual(data["total"]["output"], 2000)

    def test_a_file_untouched_since_before_the_window_is_not_read(self):
        folder = self.project("builder-1")
        path = self.write(folder, "a.jsonl", [transcript_line("2026-10-05T10:00:00Z", "claude-opus-5-5", "m1", o=5)])
        old = utc("2026-10-05T10:00:00Z").timestamp()
        os.utime(path, (old, old))
        data = self.data("--from", "2026-10-06T00:00:00Z", "--to", "2026-10-07T00:00:00Z")
        self.assertEqual(data["total"]["turns"], 0)

    def test_since_a_tag_runs_from_the_tag_to_now(self):
        self.init_repo()
        self.spec("### M2: x\n", "2026-10-05T10:00:00Z")
        self.git("tag", "-a", "m2", "-m", "m2", when="2026-10-06T10:00:00Z")
        folder = self.project("designer")
        recent = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=5)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        self.write(folder, "a.jsonl", [
            transcript_line("2026-10-05T12:00:00Z", "claude-opus-5-5", "m_before", o=1),
            transcript_line(recent, "claude-opus-5-5", "m_after", o=7),
        ])
        data = self.data("--since", "m2")
        self.assertEqual((data["total"]["turns"], data["total"]["output"]), (1, 7))
        self.assertEqual(data["from"], "2026-10-06T10:00:00Z")


class Costs(Env):
    def test_the_price_sum_is_tokens_times_the_table(self):
        folder = self.project("builder-1")
        self.write(folder, "a.jsonl", [
            transcript_line("2026-10-06T10:00:00Z", "claude-opus-5-5", "m1", i=1000, o=2000, cr=3_000_000, w5=100_000, w1=200_000),
        ])
        data = self.data("--from", "2026-10-06T00:00:00Z", "--to", "2026-10-07T00:00:00Z")
        # 1000*4 + 2000*20 + 3e6*0.2 + 1e5*5 + 2e5*8 = 4000 + 40000 + 600000 + 500000 + 1600000 microdollars
        self.assertAlmostEqual(data["total"]["cost"], 2.744, places=6)
        self.assertEqual(data["total"]["cache_write"], 300_000)
        self.assertIn("Total from 2026-10-06T00:00:00Z to 2026-10-07T00:00:00Z: $2.74 (estimated)", self.run_ledger("--from", "2026-10-06T00:00:00Z", "--to", "2026-10-07T00:00:00Z"))

    def test_model_ids_with_a_date_suffix_use_the_same_row_and_fast_mode_doubles(self):
        dated = {"input": 0, "output": 1_000_000, "cache_read": 0, "cache_write_5m": 0, "cache_write_1h": 0, "fast": False}
        self.assertAlmostEqual(tc.turn_cost(dict(dated, model="claude-opus-5-5-20261001")), 20.0)
        self.assertAlmostEqual(tc.turn_cost(dict(dated, model="claude-opus-5-5", fast=True)), 40.0)

    def test_a_long_prompt_uses_the_second_rate_card(self):
        base = {"input": 0, "output": 1_000_000, "cache_read": 0, "cache_write_5m": 0, "cache_write_1h": 0, "fast": False, "model": "claude-haiku-5-5"}
        self.assertAlmostEqual(tc.turn_cost(dict(base, input=100_000)), 0.5 + 0.1 * 1e5 / 1e6)
        self.assertAlmostEqual(tc.turn_cost(dict(base, input=100_001)), 2.5 + 0.5 * 100_001 / 1e6)

    def test_a_model_without_a_price_is_counted_and_shown_as_no_price(self):
        folder = self.project("builder-1")
        self.write(folder, "a.jsonl", [
            transcript_line("2026-10-06T10:00:00Z", "claude-opus-5-5", "m1", o=1_000_000),
            transcript_line("2026-10-06T10:01:00Z", "claude-mystery-9", "m2", o=1_000_000),
        ])
        window = ("--from", "2026-10-06T00:00:00Z", "--to", "2026-10-07T00:00:00Z")
        data = self.data(*window)
        self.assertEqual(data["total"]["turns"], 2)
        self.assertEqual(data["total"]["unpriced_turns"], 1)
        self.assertAlmostEqual(data["total"]["cost"], 20.0)  # the unknown model is not guessed
        self.assertFalse(data["models"]["claude-mystery-9"]["priced"])
        text = self.run_ledger(*window)
        self.assertRegex(text, r"claude-mystery-9\s+1\s.*no price")
        self.assertIn("1 turns on a model with no price", text)

    def test_one_turn_written_in_several_lines_or_files_counts_once_and_synthetic_ones_not_at_all(self):
        folder = self.project("builder-1")
        line = transcript_line("2026-10-06T10:00:00Z", "claude-opus-5-5", "m1", o=100)
        self.write(folder, "a.jsonl", [line, line, transcript_line("2026-10-06T10:00:00Z", "<synthetic>", "m2", o=100)])
        self.write(folder, "b.jsonl", [line])
        data = self.data("--from", "2026-10-06T00:00:00Z", "--to", "2026-10-07T00:00:00Z")
        self.assertEqual((data["total"]["turns"], data["total"]["output"]), (1, 100))


class Attribution(Env):
    WINDOW = ("--from", "2026-10-06T00:00:00Z", "--to", "2026-10-07T00:00:00Z")

    def test_a_turn_belongs_to_the_task_the_agent_was_last_assigned_before_it(self):
        self.log(
            ("2026-10-06T10:00:00Z", "assign", "builder-1", "T-1", "-"),
            ("2026-10-06T12:00:00Z", "assign", "builder-1", "T-2", "xhigh"),
            ("2026-10-06T13:00:00Z", "send", "builder-1", "-", "-"),  # a send that knows no task changes nothing
            ("2026-10-06T11:00:00Z", "assign", "builder-2", "T-9", "-"),  # another agent's, later in time order
            "garbage line without tabs".split("\t"),
        )
        folder = self.project("builder-1")
        self.write(folder, "a.jsonl", [
            transcript_line("2026-10-06T09:00:00Z", "claude-opus-5-5", "a", o=1),
            transcript_line("2026-10-06T11:00:00Z", "claude-opus-5-5", "b", o=10),
            transcript_line("2026-10-06T12:00:00Z", "claude-opus-5-5", "c", o=100),
            transcript_line("2026-10-06T13:30:00Z", "claude-opus-5-5", "d", o=1000),
        ])
        folder2 = self.project("builder-2")
        self.write(folder2, "a.jsonl", [transcript_line("2026-10-06T10:30:00Z", "claude-opus-5-5", "e", o=10000), transcript_line("2026-10-06T11:30:00Z", "claude-opus-5-5", "f", o=100000)])
        tasks = self.data(*self.WINDOW)["tasks"]
        self.assertEqual(tasks[tc.NO_TASK]["output"], 1 + 10000)
        self.assertEqual(tasks["T-1"]["output"], 10)
        self.assertEqual(tasks["T-2"]["output"], 1100)
        self.assertEqual(tasks["T-2"]["effort"], "xhigh")
        self.assertEqual(tasks["T-9"]["output"], 100000)
        self.assertEqual(tasks["T-2"]["agents"], ["builder-1"])

    def test_a_missing_log_leaves_every_turn_without_a_task(self):
        folder = self.project("verifier")
        self.write(folder, "a.jsonl", [transcript_line("2026-10-06T09:00:00Z", "claude-opus-5-5", "a", o=1)])
        data = self.data(*self.WINDOW)
        self.assertEqual(list(data["tasks"]), [tc.NO_TASK])
        self.assertEqual(list(data["agents"]), ["verifier"])


class Tiers(Env):
    def test_tasks_are_summed_by_tier_and_the_label_shows(self):
        folder = self.project("builder-1")
        self.write(folder, "a.jsonl", [
            transcript_line("2026-10-05T10:01:00Z", "claude-sonnet-5-5", "t1", o=100),
            transcript_line("2026-10-05T11:01:00Z", "claude-opus-5-5", "t2", o=300),
            transcript_line("2026-10-05T12:01:00Z", "claude-opus-5-5", "t3", o=500),
        ])
        self.log(("2026-10-05T10:00:00Z", "assign", "builder-1", "T-1", "light"),
                 ("2026-10-05T11:00:00Z", "assign", "builder-1", "T-2", "-"),
                 ("2026-10-05T12:00:00Z", "assign", "builder-1", "T-3", "heavy"))
        data = self.data("--from", "2026-10-05T00:00:00Z", "--to", "2026-10-06T00:00:00Z")
        self.assertEqual({t: (r["tasks"], r["output"]) for t, r in data["tiers"].items()},
                         {"light": (1, 100), "standard": (1, 300), "heavy": (1, 500)})
        text = self.run_ledger("--from", "2026-10-05T00:00:00Z", "--to", "2026-10-06T00:00:00Z")
        self.assertIn("By tier", text)
        self.assertIn("builder-1 (light)", text)

    def test_no_tier_no_table(self):
        folder = self.project("builder-1")
        self.write(folder, "a.jsonl", [transcript_line("2026-10-05T10:01:00Z", "claude-opus-5-5", "t1", o=1)])
        self.log(("2026-10-05T10:00:00Z", "assign", "builder-1", "T-1", "xhigh"))
        data = self.data("--from", "2026-10-05T00:00:00Z", "--to", "2026-10-06T00:00:00Z")
        self.assertEqual(data["tiers"], {})

class Agents(Env):
    WINDOW = ("--from", "2026-10-06T00:00:00Z", "--to", "2026-10-07T00:00:00Z")

    def test_the_main_checkout_is_the_architect_and_any_other_session_there_is_other(self):
        # Since 2026-10-27 the main checkout holds one agent, the architect (the kit's team-cost.py: a session there is
        # the architect by its name line, its statusline file or its model; anything else is listed as "other").
        main = self.project()
        self.write(main, "named-architect.jsonl", [transcript_line("2026-10-06T10:00:00Z", "claude-opus-5-5", "b", o=10), name_line("architect")])
        # no agent-name in the file: the statusline file names the session
        self.write(main, "sess-from-status.jsonl", [transcript_line("2026-10-06T10:00:00Z", "claude-opus-5-5", "c", o=100)])
        with open(os.path.join(self.status, "architect.json"), "w") as f:
            json.dump({"session_id": "sess-from-status", "cost": {"total_cost_usd": 1}}, f)
        # neither: the model decides (Fable is the architect)
        self.write(main, "bare-fable.jsonl", [transcript_line("2026-10-06T10:00:00Z", "claude-fable-5-1", "d", o=1000)])
        self.write(main, "bare-opus.jsonl", [transcript_line("2026-10-06T10:00:00Z", "claude-opus-5-5", "e", o=10000)])
        agents = self.data(*self.WINDOW)["agents"]
        self.assertEqual(agents["other"]["output"], 10000)
        self.assertEqual(agents["architect"]["output"], 10 + 100 + 1000)

    def test_a_subagent_belongs_to_the_agent_whose_session_started_it(self):
        main = self.project()
        self.write(main, "parent.jsonl", [name_line("architect"), transcript_line("2026-10-06T10:00:00Z", "claude-opus-5-5", "a", o=1)])
        self.write(main, "parent/subagents/agent-x.jsonl", [transcript_line("2026-10-06T10:05:00Z", "claude-haiku-5-5", "b", o=10)])
        data = self.data(*self.WINDOW)
        self.assertEqual(data["agents"]["architect"]["turns"], 2)
        self.assertEqual(set(data["models"]), {"claude-opus-5-5", "claude-haiku-5-5"})


class Content(Env):
    def test_message_content_never_reaches_any_output_or_any_file(self):
        folder = self.project("builder-1")
        main = self.project()
        self.write(folder, "a.jsonl", [transcript_line("2026-10-06T10:00:00Z", "claude-opus-5-5", "a", o=5)])
        self.write(main, "b.jsonl", [name_line("lead"), transcript_line("2026-10-06T10:00:00Z", "claude-mystery-9", "b", o=5),
                                     "this line is not json but holds " + SECRET + ' "assistant"',
                                     json.dumps({"type": "user", "message": {"content": SECRET}})])
        self.log(("2026-10-06T09:00:00Z", "assign", "builder-1", "T-1", "high"))
        before = sorted(os.listdir(self.status))
        window = ("--from", "2026-10-06T00:00:00Z", "--to", "2026-10-07T00:00:00Z")
        outputs = [self.run_ledger(*window), self.run_ledger(*window, fmt=("--markdown",)), self.run_ledger(*window, fmt=("--json",))]
        for out in outputs:
            self.assertTrue(out.strip())
            self.assertNotIn(SECRET, out)
            self.assertNotIn("FAKE", out)
        self.assertEqual(sorted(os.listdir(self.status)), before)  # nothing written beside the log
        # and the only things kept from a line are the usage fields
        _, records = tc.scan_transcript(os.path.join(folder, "a.jsonl"))
        self.assertNotIn(SECRET, repr(records))
        self.assertEqual(set(records[0]), {"key", "time", "model", "input", "output", "cache_read", "cache_write_5m", "cache_write_1h", "fast"})


class Formats(Env):
    def test_markdown_has_the_three_tables_and_the_total(self):
        folder = self.project("builder-1")
        self.write(folder, "a.jsonl", [transcript_line("2026-10-06T10:00:00Z", "claude-opus-5-5", "a", o=1_000_000)])
        md = self.run_ledger("--from", "2026-10-06T00:00:00Z", "--to", "2026-10-07T00:00:00Z", fmt=("--markdown",))
        for heading in ("## By model", "## By agent", "## By task"):
            self.assertIn(heading, md)
        self.assertIn("| claude-opus-5-5 | 1 |", md)
        self.assertIn("(estimated)**", md)

    def test_a_milestone_total_line_names_the_milestone(self):
        self.init_repo()
        self.spec("### M35: x\n", "2026-10-05T10:00:00Z")
        self.git("tag", "-a", "m35", "-m", "m35", when="2026-10-09T18:30:00Z")
        folder = self.project("builder-1")
        self.write(folder, "a.jsonl", [transcript_line("2026-10-06T10:00:00Z", "claude-opus-5-5", "a", o=1_000_000)])
        self.assertIn("Total for M35: $20.00 (estimated)", self.run_ledger("--milestone", "M35"))


class DashboardLine(Env):
    """The dashboard's one line (team-dash.py): a numbers-only cache, asked again in the background."""

    def setUp(self):
        super().setUp()
        dspec = importlib.util.spec_from_file_location("team_dash", os.path.join(here, "team-dash.py"))
        self.dash = importlib.util.module_from_spec(dspec)
        dspec.loader.exec_module(self.dash)
        self.dash.COST_FILE = os.path.join(self.status, "_cost-cache.json")
        self.dash._COST["running"] = False
        self.starts = []

    def line(self, now):
        return self.dash.cost_line(now, start=lambda: self.starts.append(now))

    def test_no_reading_yet_shows_nothing_and_asks_for_one(self):
        self.assertIsNone(self.line(1000.0))
        self.assertEqual(self.starts, [1000.0])

    def test_a_fresh_reading_is_shown_without_asking_again(self):
        with open(self.dash.COST_FILE, "w") as f:
            json.dump({"milestone": "M35", "cost": 16.014, "turns": 2331, "at": 1000.0}, f)
        shown = self.line(1100.0)
        self.assertIn("M35 so far: $16.01, 2,331 turns", shown)
        self.assertEqual(self.starts, [])

    def test_an_old_reading_is_shown_and_asked_for_once_in_the_background(self):
        with open(self.dash.COST_FILE, "w") as f:
            json.dump({"milestone": "M35", "cost": 1.5, "turns": 10, "at": 1000.0}, f)
        self.assertIn("M35 so far: $1.50, 10 turns", self.line(1000.0 + self.dash.COST_EVERY + 1))
        self.line(1000.0 + self.dash.COST_EVERY + 2)  # still running: not started twice
        self.assertEqual(len(self.starts), 1)

    def test_the_cache_holds_numbers_only(self):
        folder = self.project("builder-1")
        self.write(folder, "a.jsonl", [transcript_line("2026-10-06T10:00:00Z", "claude-opus-5-5", "a", o=5)])
        self.init_repo()
        self.spec("### M2: x\n", "2026-10-05T10:00:00Z")
        # the refresh runs the real script against the temporary repository
        real_run = subprocess.run

        def fake_run(cmd, **kw):
            return real_run(cmd + ["--repo", self.repo, "--status-dir", self.status, "--projects-dir", self.projects], **kw)

        self.dash.subprocess = type("S", (), {"run": staticmethod(fake_run), "SubprocessError": subprocess.SubprocessError})
        self.dash.refresh_cost()
        with open(self.dash.COST_FILE) as f:
            cache = json.load(f)
        self.assertEqual(set(cache), {"milestone", "cost", "turns", "at"})
        self.assertEqual(cache["milestone"], "M2")
        self.assertNotIn(SECRET, json.dumps(cache))


if __name__ == "__main__":
    unittest.main()
