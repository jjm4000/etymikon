"""Headless Chrome over CDP, plus the static server that feeds it.

Shared by make_screenshots.py (the store screenshot set) and run_selfchecks.py
(the browser self-check pages). Python 3.12 standard library only: a websocket
client and a synchronous JSON-RPC loop live here because CDP speaks nothing
else and the standard library ships no client. PIL is imported inside
Tab.screenshot, so a caller that never captures pixels needs nothing but the
standard library.

    server, port = serve_root()          # the repo root over http, free port
    chrome = Chrome(window=(1280, 800))  # one headless Chrome per run
    tab = Tab(chrome, 1280, 800)         # one tab per page, viewport preset
    tab.navigate(f"http://127.0.0.1:{port}/some/page.html")
    tab.evaluate("document.title")
    tab.close(); chrome.close(); server.shutdown()

Both callers are run as `python pipeline/<name>.py`, which puts pipeline/ on
sys.path so `from cdp import Chrome, Tab, serve_root` resolves.

Chrome 151 headless needs --headless=new on this machine (the old headless mode
runs but renders nothing usable), and it ignores --load-extension, which is why
every caller loads the extension code into plain pages instead.
"""

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
import tempfile
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

# This file's own root, not the caller's. serve_root would otherwise serve
# whichever tree the importing script happens to sit in.
ROOT = Path(__file__).resolve().parent.parent

CHROME = r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"


# --------------------------------------------------------------------------
# Static server. The pages import ES modules and fetch the data files, so
# file:// is not an option.
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


def serve_root(port=0):
    """Serve the repo root on 127.0.0.1. Port 0 picks a free one; the chosen
    port comes back with the server so a caller can pin it instead."""
    handler = functools.partial(_Handler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, server.server_address[1]


# --------------------------------------------------------------------------
# A websocket client. Only what CDP needs: text frames, client masking,
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
    """One headless Chrome for the whole run, in a throwaway profile."""

    def __init__(self, window=(1280, 800)):
        if not Path(CHROME).exists():
            raise SystemExit(f"Chrome not found at {CHROME}")
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            self.port = probe.getsockname()[1]
        self.profile = tempfile.mkdtemp(prefix="etym-chrome-")
        self.proc = subprocess.Popen([
            CHROME,
            "--headless=new",
            "--disable-gpu",
            "--hide-scrollbars",
            "--no-first-run",
            "--no-default-browser-check",
            "--force-device-scale-factor=1",
            f"--window-size={window[0]},{window[1]}",
            f"--remote-debugging-port={self.port}",
            f"--user-data-dir={self.profile}",
            "about:blank",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        # A failed connect must not leave a headless Chrome and a profile
        # directory behind, which is what an unguarded connect here did.
        try:
            self.ws = WebSocket(self._browser_ws())
        except BaseException:
            self.proc.kill()
            shutil.rmtree(self.profile, ignore_errors=True)
            raise
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
        # Browser.close has already torn the socket down, so closing it again
        # is expected to fail.
        try:
            self.ws.close()
        except OSError:
            pass
        try:
            self.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.proc.kill()
        shutil.rmtree(self.profile, ignore_errors=True)


class Tab:
    def __init__(self, chrome, width, height, dark=False, scale=1):
        self.chrome = chrome
        result = chrome.call("Target.createTarget", {"url": "about:blank"})
        self.target = result["targetId"]
        self.session = chrome.call(
            "Target.attachToTarget", {"targetId": self.target, "flatten": True}
        )["sessionId"]
        self.call("Page.enable")
        self.call("Runtime.enable")
        # Before navigation, always: content.js hides the popup on resize, so a
        # viewport that changes after a scene is staged captures nothing.
        self.call("Emulation.setDeviceMetricsOverride", {
            "width": width, "height": height,
            "deviceScaleFactor": scale, "mobile": False,
        })
        self.call("Emulation.setEmulatedMedia", {
            "features": [{"name": "prefers-color-scheme",
                          "value": "dark" if dark else "light"}],
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
        """Wait for a staging page to set data-shot-ready on <html>."""
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
        """The viewport as a PIL image in RGB. PIL is imported here so a caller
        that never captures pixels runs on the standard library alone."""
        from PIL import Image
        shot = self.call("Page.captureScreenshot",
                         {"format": "png", "captureBeyondViewport": False})
        return Image.open(io.BytesIO(base64.b64decode(shot["data"]))).convert("RGB")

    def close(self):
        self.chrome.call("Target.closeTarget", {"targetId": self.target})
