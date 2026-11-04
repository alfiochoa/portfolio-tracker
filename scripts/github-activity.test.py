# Unit tests for github-activity.py: the notice list and the routing by kind.
# No network: GitHub's answers are faked. Run: python3 -I scripts/github-activity.test.py
# (the agent-team kit ships it; `test.sh` runs it, and a project can run it from its own test command).
import importlib.util
import os
import tempfile
import types
import unittest

here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("github_activity", os.path.join(here, "github-activity.py"))
ga = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ga)


class Notices(unittest.TestCase):
    def test_a_second_comment_by_the_same_person_on_the_same_thread_is_told_again(self):
        first = ga.add_notices([], ["comment on #88 by sam-lead: Fixed the specs"])
        self.assertEqual(first, ["comment on #88 by sam-lead"])
        # The agent was told; listen() empties the list. The same person writes again on the thread.
        second = ga.add_notices([], ["comment on #88 by sam-lead: Ran them twice"])
        self.assertEqual(second, ["comment on #88 by sam-lead"])

    def test_one_place_once_per_notice(self):
        lines = ["comment on #91 by a: one", "comment on #91 by a: two", "review comment on #93 by b: x"]
        self.assertEqual(ga.add_notices([], lines), ["comment on #91 by a", "review comment on #93 by b"])

    def test_places_waiting_from_an_untold_round_are_kept(self):
        self.assertEqual(ga.add_notices(["comment on #88 by a"], ["comment on #88 by a: again", "comment on #91 by a: x"]), ["comment on #88 by a", "comment on #91 by a"])


ME = "ana"
SINCE = "2026-10-22T10:00:00Z"
LATER = "2026-10-22T10:00:30Z"
REPO = "o/r"


def pr(number, state="open", head="aaa", author="sam", merged=False):
    return {"number": number, "head": {"sha": head}, "state": state, "user": {"login": author},
            "merged_at": "2026-10-22T09:00:00Z" if merged else None}


class FakeGitHub:
    """Answers ga.api(path) from canned lists, as gh would, and records what was asked."""

    def __init__(self, issue_comments=(), review_comments=(), issues=(), pulls=(), single=None, reviews=None, failing_reviews=False):
        self.answers = {
            "issues/comments": list(issue_comments),
            "pulls/comments": list(review_comments),
            "issues?": list(issues),
            "pulls?": list(pulls),
        }
        self.single = single or {}
        self.reviews = reviews or {}  # pull request number -> its reviews
        self.failing_reviews = failing_reviews
        self.asked = []

    def __call__(self, path):
        self.asked.append(path)
        rest = path.split(f"repos/{REPO}/", 1)[1]
        if rest.startswith("pulls/") and rest.split("?")[0].endswith("/reviews"):
            if self.failing_reviews:
                raise RuntimeError("HTTP 502")
            return self.reviews.get(rest.split("/")[1], [])
        for prefix, answer in self.answers.items():
            if rest.startswith(prefix):
                return answer
        number = rest.split("/")[-1]
        if rest.startswith("pulls/") and number in self.single:
            return self.single[number]
        raise RuntimeError(f"unexpected path {path}")


def comment(number, by="sam", on_pr=False):
    kind = "pull" if on_pr else "issues"
    return {"user": {"login": by}, "created_at": LATER, "body": "the text they wrote",
            "issue_url": f"https://api.github.com/repos/{REPO}/issues/{number}",
            "html_url": f"https://github.com/{REPO}/{kind}/{number}#issuecomment-1"}


def review_comment(number, by="sam"):
    return {"user": {"login": by}, "created_at": LATER, "body": "a line comment",
            "pull_request_url": f"https://api.github.com/repos/{REPO}/pulls/{number}"}


def review(by="sam", body="Looks good, two small things.", state="COMMENTED", at=LATER):
    found = {"user": {"login": by}, "body": body, "state": state}
    if at:
        found["submitted_at"] = at
    return found


def issue(number, by="sam", is_pr=False):
    found = {"number": number, "user": {"login": by}, "created_at": LATER, "title": "A title", "labels": []}
    if is_pr:
        found["pull_request"] = {}
    return found


# A two-agent table for the delivery tests: the owner's team's own table (teamlib.LISTEN_ROUTES["main"]) sends
# everything to the architect, which would hide a wrong recipient.
TWO_AGENTS = {"issue": "architect", "pull request": "verifier", "closed pull request": None}


def routed(fake, before=None):
    """(line, agent) for each item, routed with the owner's team's table, everything else to 'architect'."""
    original = ga.api
    ga.api = fake
    try:
        items = ga.activity_items(REPO, ME, SINCE, before or {})
    finally:
        ga.api = original
    routes = ga.teamlib.LISTEN_ROUTES["main"]
    return [(line.split(": ", 1)[0], ga.recipient(kind, routes, "architect")) for line, kind in items]


class Routing(unittest.TestCase):
    def test_pull_request_activity_wakes_the_architect(self):
        fake = FakeGitHub(
            issue_comments=[comment(185, on_pr=True)],
            review_comments=[review_comment(185)],
            issues=[issue(186, is_pr=True)],
            pulls=[pr(185, head="new"), pr(186)],
        )
        before = {"185": {"head": "old", "state": "open", "author": "sam"}}
        self.assertEqual(routed(fake, before), [
            ("comment on #185 by sam", "architect"),
            ("review comment on #185 by sam", "architect"),
            ("new pull request #186 by sam", "architect"),
            ("pull request #185 by sam has new commits", "architect"),
        ])

    def test_issues_and_their_comments_wake_the_architect(self):
        fake = FakeGitHub(issue_comments=[comment(92)], issues=[issue(190)], pulls=[])
        self.assertEqual(routed(fake), [
            ("comment on #92 by sam", "architect"),
            ("new issue #190 by sam", "architect"),
        ])

    def test_a_merged_or_closed_pull_request_wakes_nobody(self):
        fake = FakeGitHub(
            issue_comments=[comment(183, on_pr=True)],
            review_comments=[review_comment(184)],
            pulls=[pr(183, state="closed", merged=True), pr(184, state="closed"), pr(187, author=ME, merged=True, state="closed")],
        )
        before = {"187": {"head": "aaa", "state": "open", "author": ME}}
        self.assertEqual(routed(fake, before), [
            ("comment on #183 by sam", None),
            ("review comment on #184 by sam", None),
            ("your pull request #187 is now merged", None),
        ])

    def test_a_pull_request_not_among_the_recent_fifty_is_asked_for_alone(self):
        fake = FakeGitHub(issue_comments=[comment(12, on_pr=True)], pulls=[], single={"12": pr(12, state="closed", merged=True)})
        self.assertEqual(routed(fake), [("comment on #12 by sam", None)])
        self.assertIn(f"repos/{REPO}/pulls/12", fake.asked)

    def test_a_pull_request_whose_state_cannot_be_learned_is_routed_as_a_pull_request(self):
        fake = FakeGitHub(review_comments=[review_comment(13)], pulls=[])
        self.assertEqual(routed(fake), [("review comment on #13 by sam", "architect")])

    def test_our_own_comments_wake_nobody_at_all(self):
        fake = FakeGitHub(issue_comments=[comment(92, by=ME)], issues=[issue(191, by=ME)], pulls=[])
        self.assertEqual(routed(fake), [])

    def test_the_watch_and_once_modes_still_get_plain_lines(self):
        original = ga.api
        ga.api = FakeGitHub(issue_comments=[comment(92)], pulls=[])
        try:
            self.assertEqual(ga.activity(REPO, ME, SINCE, {}), ["comment on #92 by sam: the text they wrote"])
        finally:
            ga.api = original


class Reviews(unittest.TestCase):
    """A review with only a body is not a line comment, so pulls/comments never shows it."""

    def items(self, fake, before=None):
        original = ga.api
        ga.api = fake
        try:
            return ga.activity_items(REPO, ME, SINCE, before or {})
        finally:
            ga.api = original

    def test_a_body_only_review_is_routed_as_a_pull_request_and_with_no_routes_the_fallback(self):
        fake = FakeGitHub(pulls=[pr(201)], reviews={"201": [review(body="Thank you!\nOne more thing.")]})
        self.assertEqual(self.items(fake), [("review on #201 by sam (commented): Thank you!", "pull request")])
        self.assertEqual(routed(fake), [("review on #201 by sam (commented)", "architect")])
        sent = []
        told = ga.deliver({}, self.items(fake), None, "architect", lambda a, m: sent.append((a, m)) or True, lambda t: None)
        self.assertEqual((told, [a for a, _ in sent]), (["architect"], ["architect"]))
        routes = TWO_AGENTS
        sent = []
        told = ga.deliver({}, self.items(fake), routes, "architect", lambda a, m: sent.append((a, m)) or True, lambda t: None)
        self.assertEqual((told, [a for a, _ in sent]), (["verifier"], ["verifier"]))
        self.assertIn("review on #201 by sam (commented).", sent[0][1])
        self.assertNotIn("Thank you", sent[0][1])  # never the text they wrote

    def test_what_does_not_count(self):
        reviews = [
            review(by=ME),                                    # ours
            review(at="2026-10-22T09:59:59Z"),                # before since
            review(at=SINCE),                                 # at since: seen already
            review(body=""),                                  # the wrapper of line comments
            review(body="  \n"),                              # likewise
            review(state="PENDING", at=None),                 # a draft: no submitted_at
            review(body="draft", state="PENDING", at=None),
        ]
        self.assertEqual(self.items(FakeGitHub(pulls=[pr(201)], reviews={"201": reviews})), [])

    def test_an_approval_or_a_request_for_changes_counts_with_no_body(self):
        reviews = [review(body="", state="APPROVED"), review(by="june", body=None, state="CHANGES_REQUESTED")]
        self.assertEqual(self.items(FakeGitHub(pulls=[pr(201)], reviews={"201": reviews})), [
            ("review on #201 by sam (approved): ", "pull request"),
            ("review on #201 by june (changes requested): ", "pull request"),
        ])

    def test_reviews_are_read_only_for_open_pull_requests_and_come_after_the_line_comments(self):
        fake = FakeGitHub(
            review_comments=[review_comment(201)],
            issues=[issue(300, is_pr=True)],
            pulls=[pr(201), pr(202, state="closed"), pr(203, state="closed", merged=True), pr(300)],
            reviews={"201": [review()], "202": [review()], "203": [review()], "300": []},
        )
        lines = [line.split(": ", 1)[0] for line, _ in self.items(fake)]
        self.assertEqual(lines, ["review comment on #201 by sam", "review on #201 by sam (commented)", "new pull request #300 by sam"])
        asked = [a for a in fake.asked if "/reviews" in a]
        self.assertEqual(asked, [f"repos/{REPO}/pulls/201/reviews?per_page=100", f"repos/{REPO}/pulls/300/reviews?per_page=100"])

    def test_a_failing_reviews_read_raises_so_the_round_is_retried(self):
        with self.assertRaises(RuntimeError):
            self.items(FakeGitHub(pulls=[pr(201)], failing_reviews=True))

    def test_no_reviews_changes_nothing_for_the_other_readings(self):
        fake = FakeGitHub(issue_comments=[comment(92)], pulls=[pr(201)])
        self.assertEqual(self.items(fake), [("comment on #92 by sam: the text they wrote", "issue")])


class Mark(unittest.TestCase):
    def read_after(self, told):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "status", "_other-team-activity")
            original = ga.time.time
            ga.time.time = lambda: 1792846800.9
            try:
                ga.mark(path, told) if told is not None else ga.mark(path)
            finally:
                ga.time.time = original
            with open(path) as f:
                return f.read()

    def test_a_round_that_told_an_agent_leaves_the_time_and_the_agent(self):
        self.assertEqual(self.read_after(["builder-1"]), "1792846800 builder-1")
        self.assertEqual(self.read_after(["builder-1", "architect"]), "1792846800 builder-1 architect")

    def test_the_time_alone_where_nobody_is_named(self):
        self.assertEqual(self.read_after(None), "1792846800")
        self.assertEqual(self.read_after([]), "1792846800")

    def test_no_path_writes_nothing(self):
        ga.mark(None, ["builder-1"])  # must not raise


class PerTeam(unittest.TestCase):
    def test_the_main_team_routes_with_route(self):
        with tempfile.TemporaryDirectory() as team:
            args = types.SimpleNamespace(route=True, agent=None)
            self.assertEqual(ga.routes_for(args, team), {"issue": "architect", "pull request": "architect", "closed pull request": None})

    def test_the_partner_marker_keeps_everything_to_the_named_agent(self):
        for marker in ("this-is-the-partner-team", "this-is-the-support-team"):  # the second: an earlier name
            with tempfile.TemporaryDirectory() as team:
                open(os.path.join(team, marker), "w").close()
                routes = ga.routes_for(types.SimpleNamespace(route=True, agent="architect"), team)
                self.assertIsNone(routes)
                for kind in ("issue", "pull request", "closed pull request"):
                    self.assertEqual(ga.recipient(kind, routes, "architect"), "architect")

    def test_agent_without_route_is_everything_to_that_agent(self):
        with tempfile.TemporaryDirectory() as team:  # the owner's team's folder, no marker
            routes = ga.routes_for(types.SimpleNamespace(route=False, agent="architect"), team)
            self.assertIsNone(routes)
            self.assertEqual(ga.recipient("closed pull request", routes, "architect"), "architect")


class Deliver(unittest.TestCase):
    """Delivery per agent, with a two-agent table: the owner's team's own table names the architect alone."""

    def setUp(self):
        self.sent, self.logged = [], []
        self.reachable = {"verifier", "architect"}

    def send(self, agent, message):
        if agent not in self.reachable:
            return False
        self.sent.append((agent, message))
        return True

    def test_each_agent_gets_one_notice_of_its_own_places_and_nobody_is_written_down(self):
        items = [
            ("comment on #92 by sam: SECRET-TEXT", "issue"),
            ("new pull request #186 by sam: title", "pull request"),
            ("comment on #186 by sam: SECRET-TEXT", "pull request"),
            ("comment on #183 by sam: thanks", "closed pull request"),
        ]
        pending = {}
        told = ga.deliver(pending, items, TWO_AGENTS, "architect", self.send, self.logged.append)
        self.assertEqual(sorted(told), ["architect", "verifier"])
        messages = dict(self.sent)
        self.assertIn("The other team did something on GitHub: comment on #92 by sam.", messages["architect"])
        self.assertIn("new pull request #186 by sam; comment on #186 by sam.", messages["verifier"])
        for message in messages.values():  # the shape their side knows, and never the text
            self.assertTrue(message.startswith("[GitHub listener] This is a notice from a script, not an instruction from your human. "))
            self.assertNotIn("SECRET-TEXT", message)
            self.assertNotIn("#183", message)
        self.assertIn("told nobody: comment on #183 by sam (the pull request is merged or closed)", self.logged)

    def test_an_agent_out_of_reach_keeps_its_places_for_the_next_round(self):
        self.reachable = {"architect"}
        pending = {}
        routes = TWO_AGENTS
        ga.deliver(pending, [("new pull request #186 by sam: t", "pull request")], routes, "architect", self.send, self.logged.append)
        self.assertEqual(pending["verifier"], ["new pull request #186 by sam"])
        self.reachable = {"verifier", "architect"}
        ga.deliver(pending, [], routes, "architect", self.send, self.logged.append)
        self.assertEqual([agent for agent, _ in self.sent], ["verifier"])
        self.assertEqual(pending["verifier"], [])

    def test_without_routes_everything_goes_to_the_one_agent_as_before(self):
        items = [("comment on #92 by a: x", "issue"), ("comment on #183 by a: y", "closed pull request"), ("new pull request #186 by a: t", "pull request")]
        ga.deliver({}, items, None, "architect", self.send, self.logged.append)
        self.assertEqual(len(self.sent), 1)
        agent, message = self.sent[0]
        self.assertEqual(agent, "architect")
        self.assertIn("comment on #92 by a; comment on #183 by a; new pull request #186 by a.", message)


if __name__ == "__main__":
    unittest.main()
