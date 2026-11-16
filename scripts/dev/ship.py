#!/usr/bin/env python3
"""Ship a task branch through the GitHub REST API (no `gh` needed). Standard library only.

  ship.py pr --title "..." --body-file <path>   push the branch, open the PR, print its number
  ship.py wait <pr>     poll checks up to 9 minutes; exit 0 all passed, 1 one failed, 3 still running
  ship.py logs <pr>     print the tail of each failed job's log
  ship.py merge <pr>    squash-merge when every required check passed, delete the branch, update main

The token comes from `git credential fill` at run time. It is never printed, stored or accepted as an argument.
"""
import argparse
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request

REQUIRED_CHECKS = ["checks", "unit tests", "e2e tests", "e2e sync tests", "database tests"]
REPO = "TCannonx/airhead"
API = f"https://api.github.com/repos/{REPO}"
WAIT_SECONDS = 9 * 60
POLL_SECONDS = 30
PASSED = {"success", "skipped", "neutral"}

sleep = time.sleep


def git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True, check=True).stdout.strip()


def get_token():
    out = subprocess.run(["git", "credential", "fill"], input="protocol=https\nhost=github.com\n\n",
                         capture_output=True, text=True, check=True).stdout
    fields = dict(line.split("=", 1) for line in out.splitlines() if "=" in line)
    if not fields.get("password"):
        raise SystemExit("no GitHub credential found by `git credential fill`")
    return fields["password"]


def http(method, url, body=None, token=None, raw=False):
    """urllib follows redirects for GET (log downloads redirect to storage)."""
    req = urllib.request.Request(url, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bearer {token}",
                                          "Accept": "application/vnd.github+json",
                                          "X-GitHub-Api-Version": "2022-11-28"})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    if raw:
        return data.decode("utf-8", "replace")
    return json.loads(data) if data else {}


def current_branch():
    return git("rev-parse", "--abbrev-ref", "HEAD")


def check_states(token, number):
    pr = http("GET", f"{API}/pulls/{number}", token=token)
    runs = http("GET", f"{API}/commits/{pr['head']['sha']}/check-runs?per_page=100", token=token)["check_runs"]
    latest = {}
    for r in runs:  # keep the newest run per name (highest id)
        if r["name"] not in latest or r["id"] > latest[r["name"]]["id"]:
            latest[r["name"]] = r
    return pr, latest


def summarise(latest):
    """Return 'passed', 'failed' or 'pending' over the required checks, printing each."""
    state = "passed"
    for name in REQUIRED_CHECKS:
        r = latest.get(name)
        if r is None:
            print(f"  {name}: missing")
            state = "failed" if state == "failed" else "pending"
            continue
        if r["status"] != "completed":
            print(f"  {name}: {r['status']}")
            if state != "failed":
                state = "pending"
        elif r["conclusion"] in PASSED:
            print(f"  {name}: {r['conclusion']}")
        else:
            print(f"  {name}: {r['conclusion']}")
            state = "failed"
    return state


def cmd_pr(token, args):
    branch = current_branch()
    git("push", "-u", "origin", branch)
    with open(args.body_file, encoding="utf-8") as f:
        body = f.read()
    pr = http("POST", f"{API}/pulls", {"title": args.title, "head": branch, "base": "main", "body": body}, token=token)
    print(pr["number"])
    return 0


def cmd_wait(token, args):
    deadline = time.monotonic() + WAIT_SECONDS
    while True:
        _, latest = check_states(token, args.pr)
        state = summarise(latest)
        if state == "passed":
            return 0
        if state == "failed":
            return 1
        if time.monotonic() >= deadline:
            print("still running; run `ship.py wait` again")
            return 3
        sleep(POLL_SECONDS)


def cmd_logs(token, args):
    _, latest = check_states(token, args.pr)
    for name, r in latest.items():
        if r["status"] == "completed" and r["conclusion"] not in PASSED:
            print(f"===== {name} ({r['conclusion']}) =====")
            try:
                text = http("GET", f"{API}/actions/jobs/{r['id']}/logs", token=token, raw=True)
            except urllib.error.HTTPError as e:
                print(f"(log not available: HTTP {e.code})")
                continue
            print("\n".join(text.splitlines()[-120:]))
    return 0


def cmd_merge(token, args):
    pr, latest = check_states(token, args.pr)
    missing = [n for n in REQUIRED_CHECKS if n not in latest]
    if missing:
        print("refusing to merge, missing checks: " + ", ".join(missing))
        return 1
    if summarise(latest) != "passed":
        print("refusing to merge: not every required check passed")
        return 1
    http("PUT", f"{API}/pulls/{args.pr}/merge",
         {"merge_method": "squash", "commit_title": f"{pr['title']} (#{args.pr})"}, token=token)
    try:
        http("DELETE", f"{API}/git/refs/heads/{pr['head']['ref']}", token=token)
    except urllib.error.HTTPError:
        pass  # already deleted by the repo setting
    git("checkout", "main")
    git("pull", "--ff-only")
    print(f"merged #{args.pr}")
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(prog="ship.py")
    sub = p.add_subparsers(dest="cmd", required=True)
    pr = sub.add_parser("pr")
    pr.add_argument("--title", required=True)
    pr.add_argument("--body-file", required=True)
    for name in ("wait", "logs", "merge"):
        sub.add_parser(name).add_argument("pr", type=int)
    args = p.parse_args(argv)

    if args.cmd in ("pr", "merge") and current_branch() == "main":
        print("refusing to run on main")
        return 2
    token = get_token()
    try:
        return {"pr": cmd_pr, "wait": cmd_wait, "logs": cmd_logs, "merge": cmd_merge}[args.cmd](token, args)
    except urllib.error.HTTPError as e:
        print(f"GitHub API error: HTTP {e.code} {e.reason}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
