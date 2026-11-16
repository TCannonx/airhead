"""Tests for ship.py with the HTTP and git layers stubbed. Run: python scripts/dev/ship_test.py"""
import contextlib
import io
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ship  # noqa: E402

SECRET = "ghp_supersecrettoken123"


def check(name, status="completed", conclusion="success", job_id=1):
    return {"name": name, "status": status, "conclusion": conclusion, "id": job_id,
            "details_url": f"https://github.com/x/actions/runs/9/job/{job_id}"}


class Fake:
    def __init__(self, runs, branch="task/13-0-ship"):
        self.runs = runs
        self.branch = branch
        self.calls = []
        self.git_calls = []

    def http(self, method, url, body=None, token=None, raw=False):
        assert token == SECRET
        self.calls.append((method, url, body))
        if url.endswith("/pulls/5"):
            return {"number": 5, "title": "feat: x", "head": {"sha": "abc", "ref": self.branch}}
        if "/check-runs" in url:
            return {"check_runs": self.runs}
        if method == "PUT" and url.endswith("/merge"):
            return {"merged": True}
        if method == "POST" and url.endswith("/pulls"):
            return {"number": 7}
        if raw:
            return "line1\nboom: failed\n"
        return {}

    def git(self, *args):
        self.git_calls.append(args)
        if args[:2] == ("rev-parse", "--abbrev-ref"):
            return self.branch
        return ""


def run(fake, argv):
    ship.http = fake.http
    ship.git = fake.git
    ship.get_token = lambda: SECRET
    ship.sleep = lambda s: None
    out = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
        code = ship.main(argv)
    return code, out.getvalue()


ALL_GREEN = [check(n, job_id=i) for i, n in enumerate(ship.REQUIRED_CHECKS)]


class ShipTest(unittest.TestCase):
    def test_refuses_on_main(self):
        fake = Fake(ALL_GREEN, branch="main")
        code, out = run(fake, ["pr", "--title", "t", "--body-file", __file__])
        self.assertNotEqual(code, 0)
        self.assertIn("main", out)
        self.assertFalse(any(c[0] == "push" for c in fake.git_calls))

    def test_pr_pushes_and_prints_number(self):
        fake = Fake(ALL_GREEN)
        code, out = run(fake, ["pr", "--title", "t", "--body-file", __file__])
        self.assertEqual(code, 0)
        self.assertIn("7", out)
        push = [c for c in fake.git_calls if c[0] == "push"][0]
        self.assertNotIn("--force", push)
        self.assertNotIn("-f", push)

    def test_merge_refuses_with_failed_check(self):
        runs = ALL_GREEN[:-1] + [check(ship.REQUIRED_CHECKS[-1], conclusion="failure")]
        fake = Fake(runs)
        code, _ = run(fake, ["merge", "5"])
        self.assertNotEqual(code, 0)
        self.assertFalse(any(c[0] == "PUT" for c in fake.calls))

    def test_merge_refuses_with_missing_check(self):
        fake = Fake(ALL_GREEN[:-1])
        code, out = run(fake, ["merge", "5"])
        self.assertNotEqual(code, 0)
        self.assertIn("missing", out)
        self.assertFalse(any(c[0] == "PUT" for c in fake.calls))

    def test_merge_squashes_when_green(self):
        fake = Fake(ALL_GREEN)
        code, _ = run(fake, ["merge", "5"])
        self.assertEqual(code, 0)
        put = [c for c in fake.calls if c[0] == "PUT"][0]
        self.assertEqual(put[2]["merge_method"], "squash")
        self.assertIn(("checkout", "main"), fake.git_calls)

    def test_wait_exit_3_while_pending(self):
        runs = ALL_GREEN[:-1] + [check(ship.REQUIRED_CHECKS[-1], status="in_progress", conclusion=None)]
        fake = Fake(runs)
        ship.WAIT_SECONDS = 0
        code, _ = run(fake, ["wait", "5"])
        self.assertEqual(code, 3)

    def test_wait_exit_1_on_failure_and_0_on_green(self):
        runs = ALL_GREEN[:-1] + [check(ship.REQUIRED_CHECKS[-1], conclusion="failure")]
        self.assertEqual(run(Fake(runs), ["wait", "5"])[0], 1)
        self.assertEqual(run(Fake(ALL_GREEN), ["wait", "5"])[0], 0)

    def test_skipped_counts_as_passed(self):
        runs = ALL_GREEN[:-1] + [check(ship.REQUIRED_CHECKS[-1], conclusion="skipped")]
        self.assertEqual(run(Fake(runs), ["wait", "5"])[0], 0)

    def test_logs_prints_failed_tail(self):
        runs = ALL_GREEN[:-1] + [check(ship.REQUIRED_CHECKS[-1], conclusion="failure", job_id=42)]
        code, out = run(Fake(runs), ["logs", "5"])
        self.assertEqual(code, 0)
        self.assertIn("boom: failed", out)

    def test_token_never_in_output(self):
        for argv in (["pr", "--title", "t", "--body-file", __file__], ["wait", "5"], ["merge", "5"], ["logs", "5"]):
            _, out = run(Fake(ALL_GREEN), argv)
            self.assertNotIn(SECRET, out)


if __name__ == "__main__":
    unittest.main()
