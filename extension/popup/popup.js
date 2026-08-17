/*
 * Okpyeon — action-popup bootstrapper.
 *
 * Deliberately thin. Everything about how search BEHAVES lives in
 * search-shell.js, which knows nothing about this page; this file only finds
 * this page's elements, reads the ?q= deep link, and starts the shell. A
 * future sidepanel.html reuses popup-boot.js + content.js + search-shell.js
 * verbatim and writes its own equivalent of this file.
 *
 * Runs as a CLASSIC script placed after the markup, so the container it hands
 * to the shell is already in the document and laid out.
 *
 * Known limitation (documented, not fixed): opened as the action popup, the
 * BROWSER closes the window on Escape before any page handler sees the key.
 * Some IME cancel flows end in an Escape, so a cancelled composition can
 * close the popup. Opened as a normal tab — the omnibox target — Escape is
 * ordinary and this does not apply.
 */
(function () {
  "use strict";

  function deepLinkQuery() {
    try {
      return new URLSearchParams(location.search).get("q") || "";
    } catch (e) {
      return "";
    }
  }

  globalThis.__okpyeonSearchShell.init({
    input: document.getElementById("okp-input"),
    results: document.getElementById("okp-results"),
    status: document.getElementById("okp-status"),
    autofocus: true,
    initialQuery: deepLinkQuery()
  });
})();
