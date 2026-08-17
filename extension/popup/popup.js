/*
 * Okpyeon — action-popup bootstrapper.
 *
 * Deliberately thin. Everything about how search BEHAVES lives in
 * search-shell.js, which knows nothing about this page; this file only finds
 * this page's elements, renders the page's own header, reads the ?q= deep
 * link, and starts the shell. A future sidepanel.html reuses popup-boot.js +
 * content.js + search-shell.js verbatim and writes its own equivalent of this
 * file.
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

  /* ------------------------------------------------------------------ *
   * Header actions registry
   *
   * The same shape as content.js's badge registry, for the same reason:
   * renderHeaderActions below is entirely generic, so shipping a new header
   * action is ONE entry in this array and nothing else — no new markup, no
   * new CSS (the per-key modifier class is generated), no new wiring.
   *
   * Entry: {
   *   key,      // required, unique — becomes the .action--<key> modifier
   *   label,    // the visible glyph or short word
   *   title,    // tooltip / accessible name; on a disabled entry, say WHY
   *   enabled,  // boolean or () => boolean; default true. false = dimmed+inert
   *   onClick   // (event) => void, ignored when disabled
   * }
   *
   * It ships EMPTY on purpose. Search needs no icon (its input is always
   * visible directly below), and a placeholder that does nothing is worse
   * than an empty header. Example of the first real entry, for when the
   * saved-words surface exists:
   *
   *   HEADER_ACTIONS.push({
   *     key: "saved",
   *     label: "★",
   *     title: "Saved words",
   *     enabled: true,
   *     onClick: function () {
   *       location.href = chrome.runtime.getURL("saved/saved.html");
   *     }
   *   });
   * ------------------------------------------------------------------ */

  var HEADER_ACTIONS = [];

  function isEnabled(action) {
    if (typeof action.enabled === "function") return action.enabled() !== false;
    return action.enabled !== false; // default: enabled
  }

  // Rebuilt wholesale rather than patched: the registry is small, and a full
  // rebuild means `enabled` can be a live predicate without any invalidation
  // protocol. Returns the number of actions rendered.
  function renderHeaderActions(container, registry) {
    if (!container) return 0;
    while (container.firstChild) container.removeChild(container.firstChild);
    var list = registry || [];
    for (var i = 0; i < list.length; i++) {
      var action = list[i];
      if (!action || !action.key) continue;
      var button = document.createElement("button");
      button.type = "button";
      button.className = "action action--" + action.key;
      // Dictionary/registry text only ever reaches the DOM as text.
      button.textContent = action.label == null ? "" : String(action.label);
      var title = action.title == null ? "" : String(action.title);
      if (title) button.title = title;
      // The label is usually a bare glyph, so the title carries the name.
      button.setAttribute("aria-label", title || button.textContent || action.key);
      if (isEnabled(action)) {
        if (typeof action.onClick === "function") {
          button.addEventListener("click", (function (fn) {
            return function (ev) { fn(ev); };
          })(action.onClick));
        }
      } else {
        button.disabled = true;
        button.classList.add("action--disabled");
      }
      container.appendChild(button);
    }
    return container.childElementCount;
  }

  function deepLinkQuery() {
    try {
      return new URLSearchParams(location.search).get("q") || "";
    } catch (e) {
      return "";
    }
  }

  var actionsBox = document.getElementById("okp-actions");
  renderHeaderActions(actionsBox, HEADER_ACTIONS);

  globalThis.__okpyeonSearchShell.init({
    input: document.getElementById("okp-input"),
    results: document.getElementById("okp-results"),
    status: document.getElementById("okp-status"),
    autofocus: true,
    initialQuery: deepLinkQuery()
  });

  // The registry itself, so a check can prove a NEW action needs nothing but
  // an entry — the same hook content.js exposes for its badge registry.
  globalThis.__okpyeonPopupHeader = {
    actionRegistry: HEADER_ACTIONS,
    render: function () { return renderHeaderActions(actionsBox, HEADER_ACTIONS); }
  };
})();
