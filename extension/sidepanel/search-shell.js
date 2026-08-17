/*
 * Okpyeon — search shell.
 *
 * The reusable half of every typed-search surface. It owns ALL of the
 * behavior: mounting the renderer, debounced search-as-you-type, IME
 * handling, deep-link auto-search, and the empty / no-result / error states.
 * It owns NONE of the page: no ids, no layout, no window-close behavior. Each
 * surface (the sidePanel page today, any other extension page later) supplies
 * its own markup and hands the elements in.
 *
 * Contract:
 *   globalThis.__okpyeonSearchShell.init({
 *     input,          // required: the <input> to wire
 *     results,        // required: the document-connected scroll container
 *     status,         // optional: element to receive state text
 *     onState,        // optional: fn(state, detail) — for custom chrome
 *     messages,       // optional: partial override of the default strings
 *     autofocus,      // optional: focus the input, caret at the end
 *     initialQuery    // optional: ?q= deep link — searched immediately
 *   }) -> controller { search, searchSoon, state, query, destroy }
 *
 * Loaded as a CLASSIC script, after boot.js and content.js: it needs
 * globalThis.__okpyeonEmbedApi, which content.js only exposes when the boot
 * flag was set before it evaluated.
 */
(function () {
  "use strict";

  // Long enough that a burst of keystrokes collapses into one lookup, short
  // enough that the result feels like it arrived with the last character.
  var DEBOUNCE_MS = 200;

  // Every state is ONE short line: the popup is sized to its content, so a
  // multi-line hint would make an empty search look like a reserved panel.
  var DEFAULT_MESSAGES = {
    // Shown before anything has been typed.
    empty: "Search hanja, a Korean word, or a syllable.",
    // The search ran and the dictionary had nothing. Receives the query.
    none: function (query) { return "No entry for “" + query + "”."; },
    // The service worker failed or went away. Quiet and retryable — the next
    // keystroke (or Enter) simply tries again.
    error: "Lookup failed — try again."
  };

  var current = null; // one shell per page; see init()

  function textFor(messages, state, detail) {
    var entry = messages[state];
    if (typeof entry === "function") return entry(detail);
    if (typeof entry === "string") return entry;
    return ""; // "loading" and "results" are deliberately silent
  }

  function init(options) {
    var opts = options || {};
    var input = opts.input;
    var results = opts.results;
    var status = opts.status || null;
    var onState = typeof opts.onState === "function" ? opts.onState : null;

    if (!input || input.nodeType !== 1) {
      throw new TypeError("search shell: init() needs an input element");
    }
    if (!results || results.nodeType !== 1) {
      throw new TypeError("search shell: init() needs a results element");
    }
    if (current) {
      throw new Error("search shell: already initialized on this page");
    }

    var api = globalThis.__okpyeonEmbedApi;
    if (!api) {
      throw new Error(
        "search shell: __okpyeonEmbedApi missing — is __okpyeonEmbed set " +
        "before content.js loads?"
      );
    }

    var messages = {};
    var key;
    for (key in DEFAULT_MESSAGES) {
      if (Object.prototype.hasOwnProperty.call(DEFAULT_MESSAGES, key)) {
        messages[key] = DEFAULT_MESSAGES[key];
      }
    }
    if (opts.messages) {
      for (key in opts.messages) {
        if (Object.prototype.hasOwnProperty.call(opts.messages, key)) {
          messages[key] = opts.messages[key];
        }
      }
    }

    api.mount(results);

    var timer = null;
    var state = "empty";
    var lastQuery = "";
    var destroyed = false;

    function setState(next, detail) {
      state = next;
      var text = textFor(messages, next, detail);
      if (status) {
        status.textContent = text;
        status.setAttribute("data-state", next);
        // Silent states must not leave an empty line behind.
        if (text) status.removeAttribute("hidden");
        else status.setAttribute("hidden", "");
      }
      if (onState) onState(next, detail);
    }

    function cancelPending() {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
    }

    // Runs a search NOW. Every path (debounce, Enter, deep link) ends here.
    function search(text) {
      if (destroyed) return Promise.resolve({ ok: true, count: 0 });
      cancelPending();
      var query = String(text === undefined || text === null ? input.value : text).trim();
      lastQuery = query;
      if (!query) {
        api.clear();
        setState("empty");
        return Promise.resolve({ ok: true, count: 0 });
      }
      return api.searchFor(query).then(function (res) {
        // A newer search already owns the panel; its own .then will set state.
        if (destroyed || (res && res.stale)) return res;
        // A fresh query always starts at the top of the results.
        results.scrollTop = 0;
        if (!res || res.ok !== true) setState("error", query);
        else if (!res.count) setState("none", query);
        else setState("results", query);
        return res;
      });
    }

    // Coalesces a burst of keystrokes into a single lookup.
    function searchSoon() {
      if (destroyed) return;
      cancelPending();
      timer = setTimeout(function () {
        timer = null;
        search();
      }, DEBOUNCE_MS);
    }

    function onInput(e) {
      // Mid-composition input events carry the half-built syllable; searching
      // on them both wastes lookups and flashes nonsense results.
      if (e && e.isComposing) return;
      searchSoon();
    }

    // Chromium does not reliably fire a final non-composing `input` after
    // composition ends, so this is the trailing trigger — into the SAME
    // debounce, so a commit immediately followed by typing still collapses.
    function onCompositionEnd() {
      searchSoon();
    }

    function onKeyDown(e) {
      if (!e || e.key !== "Enter") return;
      // Enter belongs to the IME while it is converting: `isComposing` where
      // it is exposed, keyCode 229 as the older, wider-support signal.
      if (e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      search();
    }

    input.addEventListener("input", onInput);
    input.addEventListener("compositionend", onCompositionEnd);
    input.addEventListener("keydown", onKeyDown);

    var initial = typeof opts.initialQuery === "string" ? opts.initialQuery.trim() : "";
    if (initial) {
      input.value = initial;
      // "loading" is a silent state: a deep link must not flash the
      // type-something hint on its way to results.
      setState("loading", initial);
    } else {
      setState("empty");
    }

    if (opts.autofocus) {
      try {
        input.focus();
        var end = input.value.length;
        if (typeof input.setSelectionRange === "function") {
          input.setSelectionRange(end, end);
        }
      } catch (e) { /* focus is a nicety, never a failure */ }
    }

    var ready = initial ? search(initial) : Promise.resolve({ ok: true, count: 0 });

    var controller = {
      search: search,
      searchSoon: searchSoon,
      ready: ready,
      state: function () { return state; },
      query: function () { return lastQuery; },
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        cancelPending();
        input.removeEventListener("input", onInput);
        input.removeEventListener("compositionend", onCompositionEnd);
        input.removeEventListener("keydown", onKeyDown);
        api.clear();
        current = null;
      }
    };
    current = controller;
    return controller;
  }

  globalThis.__okpyeonSearchShell = {
    init: init,
    DEBOUNCE_MS: DEBOUNCE_MS,
    // Exposed so a surface can query the live shell without threading the
    // controller through its own module scope.
    controller: function () { return current; }
  };
})();
