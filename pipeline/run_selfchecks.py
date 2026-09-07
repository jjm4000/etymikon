"""Run the browser self-check pages in headless Chrome.

    python pipeline/run_selfchecks.py [--page index|embed|both] [--port N]
                                      [--timeout S] [--keep]

test-page/index.html and test-page/embed.html each carry hundreds of check()
assertions behind a "Run self-checks" button, driven by a fake chrome.runtime.
Opening them in a visible browser is the manual route; this script is the
unattended one. It serves the repo root over http (the pages fetch the
extension's own source and dynamic-import extension/lookup.js, neither of which
works from file://), launches one headless Chrome through the CDP client in
cdp.py, and for each page:

  1. opens it in a fresh tab at a fixed 1280x1000 viewport, device scale
     factor 1 (several checks measure the popup against the viewport and were
     calibrated at scale 1, and index.html derives its panel width from the
     viewport width),
  2. clicks the page's #run button once the document has loaded,
  3. polls #out until the suite has rewritten it, or gives up after --timeout
     seconds,
  4. prints the counts, then every failing line verbatim.

The transcript contract
-----------------------
The page's closing line and this parser are one contract, pinned in SPEC under
"The headless self-check runner". A page writes its whole transcript in one
assignment to #out when it finishes:

    PASS  <name>[   [detail]]     one line per passing check
    FAIL  <name>[   [detail]]     one line per failing check
    FAIL  threw: <stack>          an uncaught error inside the suite
    SKIP  <name>   [why]          one line per skipped check
    <blank>
    <n> passed, <m> failed[, <k> skipped]

There is no separate prefix for a thrown error: "FAIL  threw: " starts with
"FAIL  ", so the fail counter and the failing-line filter catch it already.

Both pages also have an early-return path that writes ONE line to #out when
their test hooks are missing or when extension/lookup.js did not load. That
write ends the poll and has no closing line, so it is reported as DID NOT
COMPLETE with the page's own words printed. That is correct behavior, not a
bug in this script.

The check count printed per page is pass + fail, the number of assertions that
actually ran; skipped checks are listed separately. Compare it with the suite
size recorded in SPEC's last measured-outcome section.

Exit status is 0 only when every requested page completed with no failures.
Downloads are denied at the browser level, so the embed page's export checks
(which click a real download anchor) can never write to the Downloads folder
even if the page's own __etymikonSuppressDownload guard changes.

Flags
-----
    --page index|embed|both   which page(s) to run (default both)
    --port N                  serve on a fixed port instead of a free one
    --timeout S               seconds to wait for one page's suite (default 300)
    --keep                    also write each page's full transcript to a file
                              in the system temp directory and print the path
"""

import argparse
import json
import re
import sys
import tempfile
import time
from pathlib import Path

from cdp import Chrome, Tab, serve_root

PAGES = {
    "index": "test-page/index.html",
    "embed": "test-page/embed.html",
}

# Pinned in SPEC beside this runner. index.html sizes its panel from the
# viewport (wide = min(760, floor(vw * 0.85))) and skips two checks when that
# lands under 560, so a narrower window silently runs a smaller suite.
VIEW_W, VIEW_H = 1280, 1000
LOAD_TIMEOUT = 30

SUMMARY = re.compile(r"^(\d+) passed, (\d+) failed(?:, (\d+) skipped)?$")


def wait_for(tab, expression, timeout, what):
    """Poll a JS expression until it is truthy. Evaluation errors while the
    page is still navigating are retried, not raised."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            value = tab.evaluate(expression)
        except RuntimeError:
            value = None
        if value:
            return value
        time.sleep(0.25)
    raise TimeoutError(f"{what} after {timeout}s")


def run_page(chrome, port, name, timeout):
    url = f"http://127.0.0.1:{port}/{PAGES[name]}"
    tab = Tab(chrome, VIEW_W, VIEW_H, scale=1)
    try:
        # Headless Chrome throttles timers in tabs it considers hidden, and the
        # suites lean on setTimeout throughout, so the tab is made the active
        # one and told it has focus before anything runs.
        chrome.call("Target.activateTarget", {"targetId": tab.target})
        tab.call("Emulation.setFocusEmulationEnabled", {"enabled": True})
        tab.navigate(url)
        wait_for(tab, 'document.readyState === "complete"'
                      ' && !!document.getElementById("run")'
                      ' && !!document.getElementById("out")',
                 LOAD_TIMEOUT, f"{name}: page never finished loading")
        before = tab.evaluate('document.getElementById("out").textContent')
        started = time.time()
        tab.evaluate('document.getElementById("run").click(); true')
        text = wait_for(
            tab,
            f'(function () {{ var t = document.getElementById("out").textContent;'
            f' return t === {json.dumps(before)} ? null : t; }})()',
            timeout, f"{name}: self-checks did not finish")
        elapsed = time.time() - started
    finally:
        tab.close()
    return text, elapsed


def parse(text):
    """Split a transcript into counts and the lines worth repeating."""
    lines = text.split("\n")
    counted = {
        "pass": sum(1 for line in lines if line.startswith("PASS  ")),
        "fail": sum(1 for line in lines if line.startswith("FAIL  ")),
        "skip": sum(1 for line in lines if line.startswith("SKIP  ")),
    }
    summary = next((line for line in reversed(lines) if line.strip()), "")
    found = SUMMARY.match(summary.strip())
    return {
        "counted": counted,
        "reported": (int(found.group(1)), int(found.group(2))) if found else None,
        "reported_skip": int(found.group(3) or 0) if found else 0,
        "summary": summary.strip(),
        "failing": [line for line in lines if line.startswith("FAIL  ")],
        "complete": found is not None,
    }


def report(name, text, elapsed):
    parsed = parse(text)
    counted = parsed["counted"]
    print(f"{PAGES[name]}  ({elapsed:.1f}s)")
    if not parsed["complete"]:
        print("  DID NOT COMPLETE; the page wrote:")
        for line in text.split("\n")[:20]:
            print("    " + line)
        return False
    ran = counted["pass"] + counted["fail"]
    print(f"  checks: {ran}  pass {counted['pass']}  fail {counted['fail']}"
          f"  skipped {counted['skip']}")
    print(f"  {parsed['summary']}")
    if (parsed["reported"] != (counted["pass"], counted["fail"])
            or parsed["reported_skip"] != counted["skip"]):
        # The closing line and the per-check lines disagree, which means the
        # transcript was not read the way the page wrote it.
        print(f"  WARNING: closing line says pass {parsed['reported'][0]}"
              f" fail {parsed['reported'][1]} skipped {parsed['reported_skip']},"
              f" but the lines count differently")
    for line in parsed["failing"]:
        print("  " + line)
    return counted["fail"] == 0


def main():
    # Check names carry macrons (territōrium, cēdō); the Windows console
    # default is cp1252 and would throw on them.
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--page", choices=["index", "embed", "both"], default="both")
    parser.add_argument("--port", type=int, default=0,
                        help="static server port (default: a free one)")
    parser.add_argument("--timeout", type=float, default=300,
                        help="seconds to wait for one page's suite (default 300)")
    parser.add_argument("--keep", action="store_true",
                        help="write each transcript to the system temp directory")
    args = parser.parse_args()
    names = ["index", "embed"] if args.page == "both" else [args.page]

    server, port = serve_root(args.port)
    chrome = None
    ok = True
    try:
        chrome = Chrome(window=(VIEW_W, VIEW_H))
        # Independent of the pages' own preventDefault guard: a suite that
        # clicks a real download anchor can never write to the Downloads
        # folder, however that guard changes.
        chrome.call("Browser.setDownloadBehavior", {"behavior": "deny"})
        for name in names:
            try:
                text, elapsed = run_page(chrome, port, name, args.timeout)
            except TimeoutError as exc:
                print(f"{PAGES[name]}")
                print(f"  DID NOT COMPLETE: {exc}")
                ok = False
                continue
            if args.keep:
                out = Path(tempfile.gettempdir()) / f"etym-selfchecks-{name}.txt"
                out.write_text(text, encoding="utf-8")
                print(f"  transcript: {out}")
            ok = report(name, text, elapsed) and ok
    finally:
        if chrome is not None:
            chrome.close()
        server.shutdown()
        server.server_close()

    print("all green" if ok else "FAILURES above")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
