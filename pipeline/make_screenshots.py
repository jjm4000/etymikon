"""Regenerate the Chrome Web Store screenshot set.

    python pipeline/make_screenshots.py

Writes screenshots/1-character-lookup.png through 9-decomposition.png, all
1280x800 24-bit RGB with no alpha channel, which is what the store accepts.
The promotional tiles are a separate script (make_promo.py); this one only
touches the numbered shots.

How it works
------------
Chrome 151 headless ignores --load-extension, so there is no way to capture the
real extension running on a real page. Instead two staging pages in
pipeline/screenshots/ load the REAL extension code (lookup.js, saved.js,
content.js, the sidepanel scripts, the shipped CSS, the shipped data files)
behind the __hanjaHoverTestRuntime stub those scripts already accept in place of
chrome.runtime. Everything in the resulting pixels is the product's own
rendering; only the message transport is local. See pipeline/README.md.

This script then:

  1. serves the repo root over http on a free port (the staging pages use ES
     modules and fetch, neither of which works from file://),
  2. drives ONE headless Chrome over CDP -- a small websocket client and a
     synchronous JSON-RPC loop live in this file, so the whole tool is Python
     3.12 stdlib plus PIL and there is no Node dependency,
  3. captures each scene in its own tab, with the viewport size set BEFORE
     navigation (content.js hides the popup on resize, so a late resize would
     empty the shot),
  4. composites the side-panel shots beside a narrower page shot, with the 1px
     separator Chrome draws between a page and its side panel,
  5. asserts, per shot, both what the DOM says (the popup is up, the variant
     note rendered, the settings view mounted) and what the pixels say (exact
     size, RGB, no alpha, the corner seal actually visible where it is the
     point of the shot),
  6. and only then moves the files into screenshots/. Any failed assertion
     leaves the committed set untouched.

Flags
-----
    --only 3,8      regenerate just these shots (still writes atomically)
    --keep-temp     leave the working directory in place for inspection
"""

import argparse
import base64
import functools
import http.server
import io
import json
import os
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "screenshots"
STAGE_DIR = "pipeline/screenshots"

CHROME = r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"

SHOT_W, SHOT_H = 1280, 800
# A side panel is 360 wide; Chrome draws a 1px separator, leaving 919 for the
# page. 919 + 1 + 360 = 1280.
PAGE_W, PANEL_W = 919, 360
SEPARATOR = (218, 220, 224)


# --------------------------------------------------------------------------
# The scenes.
#
# Every shot is either a whole-viewport page capture ("page") or a page capture
# docked beside a side-panel capture ("composite"). `page` and `panel` are query
# strings for the staging pages; `checks` are JS expressions that must all
# evaluate true after the page signals ready, before anything is captured.
# --------------------------------------------------------------------------

# Shorthands for the checks, which all run against the content script's own
# test hook rather than poking at the DOM blind.
POPUP_UP = ("popup is visible", "globalThis.__hanjaHover.isVisible()")


def head_is(text):
    return (
        f"card headline is {text}",
        f'globalThis.__hanjaHover.query(".card .surface").textContent === "{text}"',
    )


def has_text(label, selector, text):
    return (
        label,
        f'[...globalThis.__hanjaHover.queryAll("{selector}")]'
        f'.some((n) => n.textContent.includes("{text}"))',
    )


def panel_has(label, selector, text=None):
    if text is None:
        return (label, f'!!document.querySelector("{selector}")')
    return (
        label,
        f'[...document.querySelectorAll("{selector}")]'
        f'.some((n) => n.textContent.includes("{text}"))',
    )


SHOTS = [
    {
        "n": 1,
        "name": "1-character-lookup.png",
        "kind": "page",
        # 電 highlighted in the opening paragraph: one character, its eumhun,
        # its glosses and the compounds it builds. 電 replaced 學 for variety:
        # 學生 already fronts the Japanese shot.
        "page": {"scene": "1", "scroll": 0},
        "checks": [POPUP_UP, head_is("\u96fb"),
                   has_text("compounds listed", ".compounds .cpd-hangul", "\uc804\ud654")],
    },
    {
        "n": 2,
        "name": "2-hangul-reverse-lookup.png",
        # 국민 (hangul) highlighted: the hangul-to-hanja direction.
        "kind": "page",
        "page": {"scene": "2", "scroll": 262},
        "checks": [POPUP_UP, head_is("\u570b\u6c11"),
                   has_text("hangul headline", ".card .hangul", "\uad6d\ubbfc")],
    },
    {
        "n": 3,
        "name": "3-recursive-breakdown.png",
        # 자본 highlighted, then "used in larger words" opened and 資本主義
        # followed: the popup's own navigation, two levels deep.
        "kind": "page",
        "page": {"scene": "3", "scroll": 393, "bottom": 100},
        "checks": [POPUP_UP, head_is("\u8cc7\u672c\u4e3b\u7fa9"),
                   ("breadcrumb trail present",
                    '!!globalThis.__hanjaHover.query(".crumbs .crumb")')],
    },
    {
        "n": 4,
        "name": "4-homophone-browse.png",
        # A single hangul syllable, 국: every hanja read that way.
        "kind": "page",
        "page": {"scene": "4", "scroll": 566, "bottom": 80},
        "checks": [POPUP_UP,
                   ("several hanja share the reading",
                    'globalThis.__hanjaHover.queryAll(".reading-row").length >= 3'),
                   has_text("\u570b among them", ".reading-row", "\u570b")],
    },
    {
        "n": 5,
        "name": "5-sidebar-search.png",
        "kind": "composite",
        "page": {"scene": "0", "scroll": 0},
        "panel": {"view": "search", "q": "\uad6d\ubbfc"},
        # The search view renders through content.js, so its nodes live in the
        # embedded panel's shadow root and only its own query hook sees them.
        "checks": [head_is("國民"),
                   has_text("component cards", ".card .surface", "民"),
                   ("component section present",
                    '!!globalThis.__hanjaHover.query(".components")')],
    },
    {
        "n": 6,
        "name": "6-saved-words.png",
        "kind": "composite",
        "page": {"scene": "0", "scroll": 430},
        # Six rendered rows is the most the seal's room rule tolerates: with a
        # seventh the view stops being .view--roomy and the seal correctly
        # vanishes. Two folders are therefore collapsed, which is also the
        # honest picture of a library with three folders in it.
        "panel": {"view": "saved", "collapse": "Saved,\uc2dc\ud5d8"},
        "checks": [
            panel_has("saved view mounted", ".view--saved"),
            ("seal has room", 'document.querySelector(".view--saved")'
                              '.classList.contains("view--roomy")'),
            panel_has("filter reads All (13)", ".saved-bar", "All (13)"),
            panel_has("delete action present", ".saved-actions", "Delete"),
            panel_has("expanded folder rows", ".saved-row", "\u570b\u6c11"),
        ],
        "pixels": "seal",
    },
    {
        "n": 7,
        "name": "7-settings.png",
        "kind": "composite",
        "page": {"scene": "0", "scroll": 200},
        "panel": {"view": "settings"},
        "checks": [
            panel_has("settings view mounted", ".view--settings"),
            panel_has("anki export section", ".view--settings", "Anki export"),
            ("seal has room", 'document.querySelector(".view--settings")'
                              '.classList.contains("view--roomy")'),
        ],
        "pixels": "seal",
    },
    {
        "n": 8,
        "name": "8-japanese-lookup.png",
        "kind": "page",
        # A Japanese page: 学生 highlighted resolves to the canonical 學生, and
        # the variant note that says so is the whole point of the shot.
        "page": {"scene": "5", "scroll": 230},
        "checks": [
            POPUP_UP,
            head_is("\u5b78\u751f"),
            has_text("variant note", ".canonical", "\u5b66\u751f \u2192 \u5b78\u751f"),
            has_text("component card 學", ".card .surface", "\u5b78"),
            has_text("component card 生", ".card .surface", "\u751f"),
            ("both component heads are in frame",
             '[...globalThis.__hanjaHover.queryAll(".card .surface")]'
             ".every((n) => n.getBoundingClientRect().bottom < 800)"),
        ],
    },
    {
        "n": 9,
        "name": "9-decomposition.png",
        "kind": "composite",
        "page": {"scene": "0", "scroll": 120},
        # 樂 searched in the panel, its "Made of" row opened: four parts with
        # their readings (幺's arrives via the readings[0] fallback), and the
        # "Part of" row underneath — 樂 is inside 9 characters, 藥 among them.
        # Replaced 學 here for variety: 學生 already fronts the Japanese shot.
        "panel": {"view": "search", "q": "樂", "expand": "madeof"},
        "checks": [
            head_is("樂"),
            ("made-of row is open",
             'globalThis.__hanjaHover.query(".madeof-row")'
             '.getAttribute("aria-expanded") === "true"'),
            ("part list is showing",
             '!globalThis.__hanjaHover.query(".madeof-list").hidden'),
            ("four part rows",
             'globalThis.__hanjaHover.queryAll(".madeof-part").length === 4'),
            # Every row must carry a reading: a bare glyph in the shot would
            # advertise the feature failing to join.
            ("every part row reads as a character",
             '[...globalThis.__hanjaHover.queryAll(".madeof-part")]'
             '.every((n) => n.classList.contains("nav") &&'
             ' (n.querySelector(".r-eumhun") || {}).textContent)'),
            has_text("나무 목 among the parts", ".madeof-part", "나무 목"),
            ("part-of row present",
             '!!globalThis.__hanjaHover.query(".foundin-row")'),
            ("part-of names a plausible count",
             '(globalThis.__hanjaHover.query(".foundin-row b").textContent | 0) >= 1'),
            ("the whole section is in frame",
             'globalThis.__hanjaHover.query(".foundin-row")'
             ".getBoundingClientRect().bottom < 800"),
        ],
    },
]


# --------------------------------------------------------------------------
# Static server. The staging pages import ES modules and fetch the data files,
# so file:// is not an option.
# --------------------------------------------------------------------------

class _Handler(http.server.SimpleHTTPRequestHandler):
    # Windows keeps text/plain for .js in the registry, which kills module
    # loading, so the map is pinned here rather than inherited.
    extensions_map = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".png": "image/png",
        ".svg": "image/svg+xml",
        "": "application/octet-stream",
    }

    def log_message(self, *args):
        pass


def serve_root():
    handler = functools.partial(_Handler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, server.server_address[1]


# --------------------------------------------------------------------------
# A websocket client, because CDP speaks nothing else and the standard library
# ships no client. Only what this tool needs: text frames, client masking,
# fragment reassembly, ping answered with pong.
# --------------------------------------------------------------------------

class WebSocket:
    def __init__(self, url, timeout=30):
        parts = urllib.parse.urlparse(url)
        self.sock = socket.create_connection((parts.hostname, parts.port), timeout)
        self.sock.settimeout(timeout)
        path = parts.path or "/"
        if parts.query:
            path += "?" + parts.query
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {parts.hostname}:{parts.port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        ).encode())
        self.buf = b""
        while b"\r\n\r\n" not in self.buf:
            self._fill()
        head, self.buf = self.buf.split(b"\r\n\r\n", 1)
        status = head.split(b"\r\n", 1)[0]
        if b" 101" not in status:
            raise RuntimeError("websocket handshake failed: " + status.decode())

    def _fill(self):
        chunk = self.sock.recv(1 << 16)
        if not chunk:
            raise RuntimeError("websocket closed")
        self.buf += chunk

    def _take(self, n):
        while len(self.buf) < n:
            self._fill()
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def _frame(self, opcode, payload):
        n = len(payload)
        head = bytearray([0x80 | opcode])
        if n < 126:
            head.append(0x80 | n)
        elif n < 1 << 16:
            head.append(0x80 | 126)
            head += struct.pack(">H", n)
        else:
            head.append(0x80 | 127)
            head += struct.pack(">Q", n)
        mask = os.urandom(4)
        head += mask
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(bytes(head) + masked)

    def send(self, text):
        self._frame(0x1, text.encode())

    def recv(self):
        data = b""
        while True:
            b0, b1 = self._take(2)
            fin, opcode = b0 & 0x80, b0 & 0x0F
            n = b1 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._take(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._take(8))[0]
            payload = self._take(n)
            if opcode == 0x8:
                raise RuntimeError("websocket closed by peer")
            if opcode == 0x9:
                self._frame(0xA, payload)
                continue
            if opcode == 0xA:
                continue
            data += payload
            if fin:
                return data.decode()

    def close(self):
        try:
            self._frame(0x8, b"")
        except OSError:
            pass
        self.sock.close()


class Chrome:
    """One headless Chrome for the whole run; one tab per shot."""

    def __init__(self):
        if not Path(CHROME).exists():
            raise SystemExit(f"Chrome not found at {CHROME}")
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            self.port = probe.getsockname()[1]
        self.profile = tempfile.mkdtemp(prefix="okp-shot-")
        self.proc = subprocess.Popen([
            CHROME,
            "--headless=new",
            "--disable-gpu",
            "--hide-scrollbars",
            "--no-first-run",
            "--no-default-browser-check",
            "--force-device-scale-factor=1",
            f"--window-size={SHOT_W},{SHOT_H}",
            f"--remote-debugging-port={self.port}",
            f"--user-data-dir={self.profile}",
            "about:blank",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.ws = WebSocket(self._browser_ws())
        self.next_id = 0

    def _browser_ws(self):
        for _ in range(80):
            try:
                with urllib.request.urlopen(
                        f"http://127.0.0.1:{self.port}/json/version", timeout=1) as r:
                    return json.load(r)["webSocketDebuggerUrl"]
            except Exception:
                time.sleep(0.25)
        raise SystemExit("Chrome never opened its debugging port")

    def call(self, method, params=None, session=None):
        self.next_id += 1
        msg = {"id": self.next_id, "method": method, "params": params or {}}
        if session:
            msg["sessionId"] = session
        self.ws.send(json.dumps(msg))
        while True:
            reply = json.loads(self.ws.recv())
            if reply.get("id") != self.next_id:
                continue          # an event; this driver is request/response only
            if "error" in reply:
                raise RuntimeError(f"{method}: {reply['error']}")
            return reply["result"]

    def close(self):
        try:
            self.call("Browser.close")
        except Exception:
            pass
        self.ws.close()
        try:
            self.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.proc.kill()
        shutil.rmtree(self.profile, ignore_errors=True)


class Tab:
    def __init__(self, chrome, width, height):
        self.chrome = chrome
        result = chrome.call("Target.createTarget", {"url": "about:blank"})
        self.target = result["targetId"]
        self.session = chrome.call(
            "Target.attachToTarget", {"targetId": self.target, "flatten": True}
        )["sessionId"]
        self.call("Page.enable")
        self.call("Runtime.enable")
        # Before navigation, always: content.js hides the popup on resize, so a
        # viewport that changes after the scene is staged captures nothing.
        self.call("Emulation.setDeviceMetricsOverride", {
            "width": width, "height": height, "deviceScaleFactor": 1, "mobile": False,
        })
        self.call("Emulation.setEmulatedMedia", {
            "features": [{"name": "prefers-color-scheme", "value": "light"}],
        })

    def call(self, method, params=None):
        return self.chrome.call(method, params, session=self.session)

    def evaluate(self, expression):
        result = self.call("Runtime.evaluate", {
            "expression": expression, "returnByValue": True, "awaitPromise": True,
        })
        if "exceptionDetails" in result:
            raise RuntimeError(json.dumps(result["exceptionDetails"])[:400])
        return result["result"].get("value")

    def navigate(self, url):
        self.call("Page.navigate", {"url": url})

    def wait_ready(self, timeout=25):
        deadline = time.time() + timeout
        while time.time() < deadline:
            time.sleep(0.15)
            try:
                ready = self.evaluate("document.documentElement.dataset.shotReady || null")
            except RuntimeError:
                continue          # still navigating
            if ready:
                time.sleep(0.4)
                return ready
        raise RuntimeError("scene never signalled ready")

    def screenshot(self):
        shot = self.call("Page.captureScreenshot",
                         {"format": "png", "captureBeyondViewport": False})
        return Image.open(io.BytesIO(base64.b64decode(shot["data"]))).convert("RGB")

    def close(self):
        self.chrome.call("Target.closeTarget", {"targetId": self.target})


def stage_url(port, page, params):
    query = urllib.parse.urlencode(params)
    return f"http://127.0.0.1:{port}/{STAGE_DIR}/{page}?{query}"


def run_checks(tab, checks, shot_name):
    for label, expression in checks:
        try:
            ok = tab.evaluate(expression)
        except RuntimeError as exc:
            raise AssertionError(f"{shot_name}: check {label!r} threw: {exc}") from None
        if ok is not True:
            raise AssertionError(f"{shot_name}: check failed -- {label}")


def capture(chrome, port, page, params, width, checks=()):
    tab = Tab(chrome, width, SHOT_H)
    try:
        tab.navigate(stage_url(port, page, params))
        tab.wait_ready()
        run_checks(tab, checks, page)
        image = tab.screenshot()
    finally:
        tab.close()
    if image.size != (width, SHOT_H):
        raise AssertionError(f"{page}: captured {image.size}, wanted {(width, SHOT_H)}")
    return image


def compose(page_image, panel_image):
    """Dock the panel to the right edge of the page, with the 1px separator
    Chrome draws between them."""
    out = Image.new("RGB", (SHOT_W, SHOT_H), SEPARATOR)
    out.paste(page_image, (0, 0))
    out.paste(panel_image, (PAGE_W + 1, 0))
    return out


def assert_image(image, name):
    if image.size != (SHOT_W, SHOT_H):
        raise AssertionError(f"{name}: {image.size}, wanted {(SHOT_W, SHOT_H)}")
    if image.mode != "RGB":
        raise AssertionError(f"{name}: mode {image.mode}, wanted RGB")
    if "transparency" in image.info:
        raise AssertionError(f"{name}: carries a transparency key")


def assert_seal(image, name):
    """The jade 玉篇 seal sits in the panel's lower-right corner when the view
    leaves room for it. Its ink is the only non-grey thing down there, so a
    green cast in that box is proof it rendered."""
    box = image.crop((SHOT_W - 130, SHOT_H - 230, SHOT_W - 10, SHOT_H - 10))
    pixels = box.tobytes()
    jade = 0
    for i in range(0, len(pixels), 3):
        r, g, b = pixels[i], pixels[i + 1], pixels[i + 2]
        if g > r + 8 and g > b + 4 and g < 245:
            jade += 1
    if jade < 200:
        raise AssertionError(f"{name}: seal not visible ({jade} jade pixels)")


def build(shot, chrome, port, work_dir):
    page_width = SHOT_W if shot["kind"] == "page" else PAGE_W
    page_checks = shot["checks"] if shot["kind"] == "page" else ()
    page_image = capture(chrome, port, "shots-page.html", shot["page"],
                         page_width, page_checks)
    if shot["kind"] == "page":
        image = page_image
    else:
        panel_image = capture(chrome, port, "shots-panel.html", shot["panel"],
                              PANEL_W, shot["checks"])
        image = compose(page_image, panel_image)

    assert_image(image, shot["name"])
    if shot.get("pixels") == "seal":
        assert_seal(image, shot["name"])

    out = work_dir / shot["name"]
    image.save(out, "PNG", optimize=True)
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--only", help="comma-separated shot numbers, e.g. 3,8")
    parser.add_argument("--keep-temp", action="store_true")
    args = parser.parse_args()

    wanted = SHOTS
    if args.only:
        keep = {int(n) for n in args.only.split(",")}
        wanted = [s for s in SHOTS if s["n"] in keep]
        if not wanted:
            raise SystemExit(f"--only {args.only} matched no shots")

    server, port = serve_root()
    work_dir = Path(tempfile.mkdtemp(prefix="okp-screenshots-"))
    chrome = Chrome()
    written = []
    try:
        for shot in wanted:
            started = time.time()
            path = build(shot, chrome, port, work_dir)
            written.append((shot, path))
            print(f"  ok  {shot['name']}  ({time.time() - started:.1f}s)")
    except BaseException:
        # A failed run must leave the committed set exactly as it was.
        if not args.keep_temp:
            shutil.rmtree(work_dir, ignore_errors=True)
        raise
    finally:
        chrome.close()
        server.shutdown()

    # Nothing lands until every shot passed every check.
    OUT_DIR.mkdir(exist_ok=True)
    for shot, path in written:
        shutil.move(str(path), str(OUT_DIR / shot["name"]))
    if not args.keep_temp:
        shutil.rmtree(work_dir, ignore_errors=True)
    print(f"wrote {len(written)} screenshot(s) to {OUT_DIR}")


if __name__ == "__main__":
    sys.exit(main())
