/*
 * Hanja Hover — content script (Agent C)
 *
 * Selection-triggered popup. Listens for mouseup/keyup, checks the current
 * selection for Han characters or Hangul syllables, asks the service worker
 * for a lookup, and renders the result in a closed shadow root anchored to the
 * selection rect.
 *
 * All page data and dictionary data is treated as untrusted text: the DOM is
 * built exclusively with createElement/textContent. innerHTML is never used
 * with anything but the static stylesheet string below.
 */
(function () {
  "use strict";

  /* ------------------------------------------------------------------ *
   * Runtime shim
   *
   * In the real extension `chrome.runtime` always exists, so the stub is
   * never reached. It only kicks in when the script is loaded into a plain
   * page (test-page/index.html) for visual testing. A page may install its
   * own fake at globalThis.__hanjaHoverTestRuntime before this script runs.
   * ------------------------------------------------------------------ */

  var HAS_CHROME_RUNTIME =
    typeof globalThis.chrome !== "undefined" &&
    globalThis.chrome !== null &&
    typeof globalThis.chrome.runtime !== "undefined" &&
    globalThis.chrome.runtime !== null;

  function makeFallbackRuntime() {
    // Minimal canned fixture so the script is still demoable with no test page
    // harness installed. The test page normally overrides this.
    var CHARS = {
      "國": {
        kind: "char", surface: "國", canonical: "國",
        eumhun: [{ hun: "나라", eum: "국" }], readings: ["국"],
        glosses: ["country; state; nation"],
        compounds: [{ hangul: "국민", hanja: "國民", gloss: "the people of a nation" }]
      },
      "民": {
        kind: "char", surface: "民", canonical: "民",
        eumhun: [{ hun: "백성", eum: "민" }], readings: ["민"],
        glosses: ["people; populace"],
        compounds: [{ hangul: "국민", hanja: "國民", gloss: "the people of a nation" }]
      }
    };
    var WORD = {
      kind: "word", canonical: "國民", hangul: "국민",
      glosses: ["the people; citizens of a nation"], chars: ["國", "民"]
    };
    function respond(msg) {
      if (msg && msg.type === "compounds") return { ok: true, compounds: [] };
      if (msg && msg.type === "usedIn") return { ok: true, words: [] };
      var text = (msg && msg.text) || "";
      var out = [];
      var seen = Object.create(null);
      // A lone hangul syllable browses homophones.
      if (text === "국") {
        return { ok: true, matches: [{
          kind: "reading", surface: "국", eum: "국",
          candidates: [{ char: "國", hun: "나라", eum: "국", gloss: "country; state; nation" }]
        }] };
      }
      var hangulHit = text.indexOf("국민") >= 0;
      var hanjaHit = text.indexOf("國民") >= 0;
      if (hangulHit || hanjaHit) {
        var w = {};
        for (var k in WORD) { if (Object.prototype.hasOwnProperty.call(WORD, k)) w[k] = WORD[k]; }
        w.surface = hanjaHit ? "國民" : "국민";
        out.push(w);
        out.push(CHARS["國"], CHARS["民"]);
        seen["國"] = seen["民"] = true;
      }
      for (var i = 0; i < text.length; i++) {
        var ch = text.charAt(i);
        if (CHARS[ch] && !seen[ch]) { seen[ch] = true; out.push(CHARS[ch]); }
      }
      return { ok: true, matches: out };
    }
    return {
      __isStub: true,
      sendMessage: function (msg, cb) {
        var resp = respond(msg);
        if (typeof cb === "function") { setTimeout(function () { cb(resp); }, 0); return undefined; }
        return Promise.resolve(resp);
      }
    };
  }

  var RUNTIME = HAS_CHROME_RUNTIME
    ? globalThis.chrome.runtime
    : (globalThis.__hanjaHoverTestRuntime || makeFallbackRuntime());
  var IS_STUB = !HAS_CHROME_RUNTIME;

  /* ------------------------------------------------------------------ *
   * Constants
   * ------------------------------------------------------------------ */

  var HAN_RE = /\p{Script=Han}/u;
  // A single syllable is enough: it triggers the homophone-browse reading match.
  var HANGUL_RE = /[가-힣]/;
  var MAX_SELECTION_CHARS = 30;
  var MAX_COMPOUNDS = 5;
  var COMPOUND_PAGE = 5; // compounds revealed per press of "Show 5 more"
  var MAX_CRUMBS = 3;   // first + last two, everything between is elided
  var GAP = 8;          // gap between selection rect and popup
  var VIEWPORT_MARGIN = 8;
  var Z_INDEX = "2147483646";
  // Resize bounds (stage 1: no persistence — a size lasts for the page visit).
  var MIN_PANEL_W = 280;
  var MIN_PANEL_H = 220;
  var MAX_PANEL_VW = 0.9;
  var MAX_PANEL_VH = 0.85;
  var RESIZE_ZONE = 18;      // hit area of the native handle, bottom-right
  var RESIZE_DEBOUNCE = 120; // a drag has no end event; settle after a pause
  var FLASH_MS = 600;        // eumhun chip → component card orientation flash
  var EDU_LABEL = "Basic-1800 (기초)";
  var EDU_TITLE = "MOE basic education hanja (1,800)";
  // MOE tier (phase 2): a second, separate badge — Naver-style, one badge per
  // classification. Plain-English label; the Korean lives in the tooltip.
  var TIER_LABEL = { m: "Middle school", h: "High school" };
  var TIER_TITLE = {
    m: "MOE tier: middle school (중학교용)",
    h: "MOE tier: high school (고등학교용)"
  };
  var SCROLL_SETTLE_MS = 700; // smooth-scroll watchdog (see revealCharCard)

  var CSS = [
    ":host { all: initial; }",
    "* { box-sizing: border-box; }",
    "[hidden] { display: none !important; }",
    ".panel {",
    "  --bg: #ffffff;",
    "  --fg: #1b1b1f;",
    "  --fg-soft: #33333a;",
    "  --muted: #6b6b73;",
    "  --faint: #86868f;",
    "  --accent: #2f57c9;",
    "  --rule: rgba(0, 0, 0, 0.09);",
    "  --edge: rgba(0, 0, 0, 0.12);",
    "  --chip-bg: #f1f3f8;",
    "  --chip-fg: #3a3a42;",
    "  --chip-edge: rgba(0, 0, 0, 0.06);",
    "  --rail: #c3d0ee;",
    "  --hedge-bg: #f6f6f9;",
    "  --hedge-fg: #7b7b85;",
    "  --hover: #eef1f8;",
    "  --shadow: 0 8px 28px rgba(0, 0, 0, 0.18), 0 1px 3px rgba(0, 0, 0, 0.12);",
    "  --scroll: rgba(0, 0, 0, 0.22);",
    "  --grip: rgba(0, 0, 0, 0.3);",
    "  --flash: rgba(47, 87, 201, 0.16);",
    "  width: 340px;",
    "  max-height: 360px;",
    "  overflow-y: auto;",
    // The panel IS the scroll container, which is exactly what `resize` needs
    // (it only applies when the computed overflow is not `visible`). The size
    // bounds are NOT declared here: min-height would inflate every short card,
    // and max-height is the 360px default cap until the user takes over. Both
    // are applied inline the moment a drag starts — see beginUserResize.
    "  resize: both;",
    "  overscroll-behavior: contain;",
    "  -webkit-user-select: text;",
    "  user-select: text;",
    "  text-align: left;",
    "  direction: ltr;",
    "  color-scheme: light dark;",
    "  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,",
    "    'Helvetica Neue', Arial, 'Malgun Gothic', 'Apple SD Gothic Neo',",
    "    'Noto Sans KR', 'Noto Sans CJK KR', sans-serif;",
    "  font-size: 13px;",
    "  line-height: 1.45;",
    "  font-weight: 400;",
    "  color: var(--fg);",
    "  background: var(--bg);",
    "  border: 1px solid var(--edge);",
    "  border-radius: 10px;",
    "  box-shadow: var(--shadow);",
    "  padding: 0;",
    "}",
    "@media (prefers-color-scheme: dark) {",
    "  .panel {",
    "    --bg: #23232a;",
    "    --fg: #e6e6ea;",
    "    --fg-soft: #d2d2d9;",
    "    --muted: #9a9aa4;",
    "    --faint: #8b8b95;",
    "    --accent: #96b4ff;",
    "    --rule: rgba(255, 255, 255, 0.12);",
    "    --edge: rgba(255, 255, 255, 0.14);",
    "    --chip-bg: #32323b;",
    "    --chip-fg: #cfcfd7;",
    "    --chip-edge: rgba(255, 255, 255, 0.08);",
    "    --rail: rgba(150, 180, 255, 0.38);",
    "    --hedge-bg: rgba(255, 255, 255, 0.035);",
    "    --hedge-fg: #93939e;",
    "    --hover: #2e2e38;",
    "    --shadow: 0 8px 28px rgba(0, 0, 0, 0.55), 0 1px 3px rgba(0, 0, 0, 0.4);",
    "    --scroll: rgba(255, 255, 255, 0.24);",
    "    --grip: rgba(255, 255, 255, 0.34);",
    "    --flash: rgba(150, 180, 255, 0.2);",
    "  }",
    "}",
    /* ---- view container: the unit that swaps on navigation ---- */
    "@keyframes hh-view-in { from { opacity: 0; } to { opacity: 1; } }",
    ".view { animation: hh-view-in 120ms ease-out; }",
    "@media (prefers-reduced-motion: reduce) { .view { animation: none; } }",
    /* ---- top-level cards: word cards and the independent-char list ---- */
    ".view > .card, .top-chars > .card { padding: 10px 12px 11px; }",
    ".view > .card + .card, .top-chars > .card + .card,",
    ".view > .card ~ .top-chars { border-top: 1px solid var(--rule); }",
    ".head { display: flex; align-items: baseline; gap: 9px; }",
    ".surface {",
    "  font-size: 26px;",
    "  line-height: 1.15;",
    "  font-weight: 600;",
    "  letter-spacing: 0.02em;",
    "  flex: 0 0 auto;",
    "  max-width: 190px;",
    "  overflow-wrap: anywhere;",
    "}",
    ".headmeta { min-width: 0; flex: 1 1 auto; }",
    ".hangul, .eumhun { font-size: 15px; font-weight: 600; color: var(--accent); overflow-wrap: anywhere; }",
    ".readings { font-size: 14px; font-weight: 600; color: var(--accent); }",
    ".canonical { font-size: 11px; color: var(--muted); margin-top: 1px; }",
    /* ---- sense lists: numbered, hanging indent, clamped ---- */
    ".glosses { margin: 7px 0 0; }",
    ".gloss { display: flex; align-items: baseline; gap: 6px; color: var(--fg-soft); }",
    ".gloss + .gloss { margin-top: 3px; }",
    // The number is its own column, so wrapped lines hang under the text.
    ".gloss-num {",
    "  flex: 0 0 auto; min-width: 1.05em; color: var(--faint);",
    "  font-variant-numeric: tabular-nums;",
    "}",
    ".gloss > .clampwrap { flex: 1 1 auto; min-width: 0; }",
    ".clampwrap { display: flex; align-items: flex-end; gap: 2px; }",
    ".clampwrap > .clamp { flex: 1 1 auto; min-width: 0; }",
    ".clamp {",
    "  display: -webkit-box; -webkit-box-orient: vertical;",
    "  overflow: hidden; overflow-wrap: anywhere;",
    "}",
    ".clamp-1 { -webkit-line-clamp: 1; }",
    ".clamp-2 { -webkit-line-clamp: 2; }",
    ".clamp.expanded { display: block; -webkit-line-clamp: none; overflow: visible; }",
    ".more {",
    "  flex: 0 0 auto; font: inherit; font-size: 11px; font-weight: 600;",
    "  line-height: 1.35; margin: 0; padding: 0 3px; border: 0; border-radius: 4px;",
    "  background: transparent; color: var(--accent); cursor: pointer;",
    "  white-space: nowrap;",
    "}",
    ".more:hover { background: var(--hover); }",
    ".more:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }",
    /* ---- Wiktionary link: top-right corner of every word / char card ---- */
    // Lives as the last child of .head so it can never collide with the hedge
    // label or a homograph chip row above it, nor with the hangul beside the
    // glyph: the head is a flex row and the link is its trailing item.
    ".wiki {",
    "  flex: 0 0 auto; align-self: flex-start; margin-left: auto;",
    "  padding-left: 8px; font-size: 11px; line-height: 1.6; font-weight: 500;",
    "  color: var(--muted); text-decoration: none; white-space: nowrap;",
    "}",
    ".wiki:hover { color: var(--accent); text-decoration: underline; }",
    ".wiki:focus-visible {",
    "  color: var(--accent); text-decoration: underline;",
    "  outline: 2px solid var(--accent); outline-offset: 1px; border-radius: 4px;",
    "}",
    // A step smaller inside a nested component card, matching its 22px glyph.
    ".card.component .wiki { font-size: 10px; }",
    ".chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }",
    ".chip {",
    "  display: inline-flex; align-items: baseline; gap: 4px;",
    "  padding: 2px 7px; border-radius: 999px;",
    "  background: var(--chip-bg); border: 1px solid var(--chip-edge);",
    "  font-size: 11px; color: var(--chip-fg); white-space: nowrap;",
    "}",
    ".chip-glyph { font-size: 13px; font-weight: 600; color: var(--fg); }",
    // Clickable eumhun chips keep the pill look; hover and cursor carry the
    // affordance, since a chevron would crowd a row of five or six of them.
    ".chip.nav { cursor: pointer; }",
    ".chip.nav:hover { background: var(--hover); border-color: var(--accent); }",
    ".chip.nav:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }",
    // Orientation flash on the card a chip points at: the card is already on
    // screen, so this beats pushing a duplicate view.
    "@keyframes hh-flash { from { background-color: var(--flash); }",
    "  to { background-color: transparent; } }",
    ".flash { animation: hh-flash " + FLASH_MS + "ms ease-out; border-radius: 7px; }",
    "@media (prefers-reduced-motion: reduce) { .flash { animation: none; } }",
    ".label {",
    "  margin-top: 9px; font-size: 10px; font-weight: 700;",
    "  letter-spacing: 0.07em; text-transform: uppercase; color: var(--faint);",
    "}",
    /* ---- compounds: nav rows + "show more" pagination ---- */
    // The negative side margins let a row's hover background bleed into the
    // card padding, so the compound text still lines up with the label above.
    ".compounds { margin-top: 2px; margin-left: -6px; margin-right: -6px; }",
    // .entry-row is shared by compound rows and the used-in list rows.
    ".entry-row {",
    "  display: flex; align-items: baseline; gap: 6px;",
    "  padding: 2px 6px; border-radius: 6px;",
    "}",
    ".entry-row > .clampwrap { flex: 1 1 auto; min-width: 0; }",
    // Hangul-only compounds have nothing to look up: no pointer, no chevron.
    ".entry-row.nav { cursor: pointer; }",
    ".compound { overflow-wrap: anywhere; }",
    ".cpd-hangul { font-weight: 600; color: var(--fg); }",
    ".cpd-hanja { color: var(--muted); }",
    ".cpd-gloss { color: var(--fg-soft); }",
    // Same muted treatment a rare homograph chip gets.
    ".entry-row.rare .cpd-hangul,",
    ".entry-row.rare .cpd-hanja,",
    ".entry-row.rare .cpd-gloss { color: var(--hedge-fg); }",
    ".cpd-rare {",
    "  font-size: 8px; font-weight: 700; letter-spacing: 0.06em;",
    "  text-transform: uppercase; margin-left: 4px; vertical-align: super;",
    "  color: var(--hedge-fg);",
    "}",
    ".cpd-more {",
    "  display: inline-block; font: inherit; font-size: 12px; font-weight: 600;",
    "  line-height: 1.3; margin: 5px 0 0; padding: 3px 9px; border-radius: 6px;",
    "  background: var(--chip-bg); border: 1px solid var(--chip-edge);",
    "  color: var(--accent); cursor: pointer; white-space: nowrap;",
    "}",
    ".cpd-more:hover { background: var(--hover); }",
    ".cpd-more:disabled { opacity: 0.55; cursor: default; }",
    ".cpd-more:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }",
    // A step smaller inside a nested component card, like its Wiktionary link.
    ".card.component .cpd-more { font-size: 11px; padding: 2px 8px; }",
    /* ---- used-in: one collapsed disclosure row, then a dedicated view ---- */
    // Design option C: word cards stay lean, so the count is a single line at
    // the end of the word body rather than an inline list.
    ".usedin-row {",
    "  margin: 9px -6px 0; padding: 4px 6px;",
    "  color: var(--muted); font-size: 12px;",
    "}",
    ".usedin-row b { font-weight: 600; color: var(--fg-soft); }",
    ".card.component .usedin-row { font-size: 11px; }",
    ".view > .card.usedin { padding: 0; }",
    ".usedin-list { padding: 3px 0 5px; }",
    ".usedin-item { padding: 4px 12px; border-radius: 0; }",
    /* ---- nested sections: component words + component hanja ---- */
    // Sections are built only when populated; an empty one must take no space.
    ".parts:empty, .components:empty, .hedge:empty, .top-chars:empty { display: none; }",
    ".parts, .components { margin-top: 11px; }",
    ".part-list, .component-list {",
    "  margin-top: 4px; padding-left: 11px;",
    "  border-left: 2px solid var(--rail); border-radius: 1px;",
    "}",
    ".card.component { padding: 7px 0; }",
    ".card.component:first-child { padding-top: 1px; }",
    ".card.component:last-child { padding-bottom: 0; }",
    ".card.component + .card.component { border-top: 1px solid var(--rule); }",
    // Slightly smaller glyph than a top-level card: same content, lower rank.
    ".card.component .surface { font-size: 22px; }",
    ".card.component .hangul, .card.component .eumhun { font-size: 14px; }",
    ".part-row {",
    "  display: flex; align-items: baseline; gap: 8px;",
    "  padding: 5px 6px 5px 7px; margin: 1px 0;",
    "  border-radius: 6px; cursor: pointer;",
    "}",
    ".p-hanja { flex: 0 0 auto; font-size: 16px; font-weight: 600; color: var(--fg); }",
    ".part-row > .clampwrap { flex: 1 1 auto; min-width: 0; }",
    ".p-text { overflow-wrap: anywhere; }",
    ".p-hangul { font-weight: 600; color: var(--accent); }",
    ".p-gloss { color: var(--muted); }",
    /* ---- hedged card: a hangul span that only matches a rare spelling ---- */
    ".card.hedged { background: var(--hedge-bg); }",
    // Only the word's own content is muted; nested component cards are normal.
    ".card.hedged > .word-body .surface,",
    ".card.hedged > .word-body .hangul,",
    ".card.hedged > .word-body .gloss { color: var(--hedge-fg); }",
    ".hedge { margin-bottom: 8px; }",
    ".hedge .label { margin-top: 0; }",
    ".hedge-note { font-size: 11px; line-height: 1.4; color: var(--muted); }",
    /* ---- homograph spelling selector ---- */
    ".spellings { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 9px; }",
    ".spell-chip {",
    "  font: inherit; font-size: 14px; font-weight: 600; line-height: 1.3;",
    "  margin: 0; padding: 3px 9px; border-radius: 7px; cursor: pointer;",
    "  background: var(--chip-bg); border: 1px solid var(--chip-edge);",
    "  color: var(--muted); white-space: nowrap;",
    "}",
    ".spell-chip:hover { background: var(--hover); color: var(--fg); }",
    ".spell-chip.sel {",
    "  background: var(--accent); border-color: var(--accent); color: #ffffff;",
    "}",
    "@media (prefers-color-scheme: dark) { .spell-chip.sel { color: #16161b; } }",
    ".spell-chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }",
    ".spell-chip.rare { color: var(--hedge-fg); opacity: 0.75; }",
    ".spell-chip.rare.sel { opacity: 1; }",
    // Curriculum badge: same quiet register as the rare marker. It rides at
    // the end of the eumhun line, so it can never crowd the Wiktionary link
    // (a separate flex item) or the variant note (the line below).
    ".edu-badge {",
    "  display: inline-block; margin-left: 6px; padding: 0 4px;",
    "  border-radius: 4px; vertical-align: 2px;",
    "  font-size: 9px; font-weight: 700; letter-spacing: 0.04em;",
    "  line-height: 1.6; white-space: nowrap;",
    "  color: var(--faint); background: var(--chip-bg);",
    "  border: 1px solid var(--chip-edge);",
    "}",
    ".card.component .edu-badge { font-size: 8px; margin-left: 5px; }",
    // Registry badges sit side by side when more than one applies.
    ".edu-badge + .edu-badge { margin-left: 4px; }",
    ".chip-rare {",
    "  font-size: 8px; font-weight: 700; letter-spacing: 0.06em;",
    "  text-transform: uppercase; margin-left: 3px; vertical-align: super;",
    "}",
    /* ---- reading (homophone browse) list ---- */
    ".view > .card.reading { padding: 0; }",
    ".reading-title {",
    "  position: sticky; top: 0; z-index: 1;",
    "  padding: 9px 12px 7px; background: var(--bg);",
    "  border-bottom: 1px solid var(--rule);",
    "  font-size: 12px; font-weight: 600; color: var(--muted);",
    "}",
    ".reading-title b { font-size: 17px; font-weight: 600; color: var(--fg); }",
    ".reading-list { padding: 3px 0 5px; }",
    ".reading-row {",
    "  display: flex; align-items: baseline; gap: 9px;",
    "  padding: 5px 12px; cursor: pointer;",
    "}",
    ".r-glyph { flex: 0 0 auto; min-width: 1.3em; font-size: 19px; font-weight: 600; color: var(--fg); }",
    ".r-text { min-width: 0; flex: 1 1 auto; overflow-wrap: anywhere; }",
    ".r-eumhun { font-weight: 600; color: var(--accent); }",
    ".r-gloss { color: var(--muted); }",
    /* ---- shared affordance for navigable rows ---- */
    ".reading-row:hover, .part-row:hover, .entry-row.nav:hover {",
    "  background: var(--hover);",
    "}",
    ".reading-row:focus-visible, .part-row:focus-visible,",
    ".entry-row.nav:focus-visible {",
    "  outline: 2px solid var(--accent); outline-offset: -2px;",
    "}",
    ".reading-row::after, .part-row::after, .entry-row.nav::after {",
    "  content: '\\203A'; margin-left: auto; padding-left: 8px;",
    "  align-self: center; color: var(--faint); font-size: 15px; line-height: 1;",
    "  flex: 0 0 auto;",
    "}",
    ".reading-row:hover::after, .part-row:hover::after,",
    ".entry-row.nav:hover::after { color: var(--accent); }",
    /* ---- breadcrumb trail (one nav bar for every drill-down) ---- */
    ".crumbs {",
    "  position: sticky; top: 0; z-index: 2;",
    "  display: flex; align-items: center; flex-wrap: nowrap; gap: 2px;",
    "  padding: 6px 10px; background: var(--bg);",
    "  border-bottom: 1px solid var(--rule);",
    "  font-size: 12px; overflow: hidden;",
    "}",
    ".crumb {",
    "  font: inherit; font-size: 12px; font-weight: 600; line-height: 1.3;",
    "  margin: 0; padding: 2px 5px; border: 0; border-radius: 5px;",
    "  background: transparent; color: var(--accent); cursor: pointer;",
    "  white-space: nowrap; max-width: 120px; overflow: hidden;",
    "  text-overflow: ellipsis;",
    "}",
    ".crumb:hover { background: var(--hover); }",
    ".crumb:focus-visible { outline: 2px solid var(--accent); outline-offset: -1px; }",
    ".crumb.current {",
    "  color: var(--fg); cursor: default; background: transparent;",
    "}",
    ".crumb-sep { color: var(--faint); flex: 0 0 auto; padding: 0 1px; }",
    // The elision is a control, not decoration: pressing it reveals every
    // level, so an intermediate view is never unreachable.
    ".crumb-gap {",
    "  font: inherit; font-size: 12px; line-height: 1.3; flex: 0 0 auto;",
    "  margin: 0; padding: 2px 4px; border: 0; border-radius: 5px;",
    "  background: transparent; color: var(--faint); cursor: pointer;",
    "}",
    ".crumb-gap:hover { background: var(--hover); color: var(--fg-soft); }",
    ".crumb-gap:focus-visible { outline: 2px solid var(--accent); outline-offset: -1px; }",
    ".crumbs.expanded { flex-wrap: wrap; row-gap: 1px; }",
    /* ---- scrollbar ---- */
    ".panel::-webkit-scrollbar { width: 10px; }",
    ".panel::-webkit-scrollbar-thumb {",
    "  background: var(--scroll); border-radius: 999px;",
    "  border: 3px solid transparent; background-clip: content-box;",
    "}",
    /* ---- resize grip ---- */
    // Where the vertical scrollbar meets the resizer Chrome paints an opaque
    // corner, which reads as a white block on a dark panel. Clear it so only
    // the grip below shows.
    ".panel::-webkit-scrollbar-corner { background: transparent; }",
    // Chrome paints a nearly invisible default resizer, and it is invisible
    // outright on dark backgrounds. Two diagonal strokes in a theme token make
    // the affordance discoverable without shouting.
    ".panel::-webkit-resizer {",
    "  background-color: transparent;",
    "  background-image: linear-gradient(135deg,",
    "    transparent 0 30%, var(--grip) 30% 42%,",
    "    transparent 42% 58%, var(--grip) 58% 70%, transparent 70% 100%);",
    "}"
  ].join("\n");

  var HOST_STYLE = {
    position: "fixed",
    top: "0px",
    left: "0px",
    right: "auto",
    bottom: "auto",
    margin: "0",
    padding: "0",
    border: "0",
    width: "auto",
    height: "auto",
    "min-width": "0",
    "min-height": "0",
    "max-width": "none",
    "max-height": "none",
    background: "transparent",
    opacity: "1",
    transform: "none",
    float: "none",
    clip: "auto",
    "clip-path": "none",
    filter: "none",
    "pointer-events": "auto",
    "text-align": "left",
    direction: "ltr",
    "z-index": Z_INDEX,
    display: "none",
    visibility: "visible"
  };

  /* ------------------------------------------------------------------ *
   * Popup host / shadow root (created once, reused)
   * ------------------------------------------------------------------ */

  var host = null;
  var shadow = null;
  var panel = null;
  var viewRoot = null;        // fresh element per view; the fade-in target
  var visible = false;
  var requestSeq = 0;
  var anchorRect = null;      // selection rect the popup is currently glued to

  // --- resize state (survives the popup session; only a reload resets it) ---
  var userSized = false;      // the user has taken control of the dimensions
  var resizing = false;       // a handle drag is in progress
  var dragState = null;       // {x, y, w, h} captured when the drag started
  var dragScrollTop = null;   // scroll offset pinned for the whole gesture
  var resizeTimer = null;
  var lastPanelW = 0;         // last size the observer acted on (loop guard)
  var lastPanelH = 0;
  var scrollSettleTimer = null; // smooth-scroll watchdog

  // --- per-popup session state (reset on every new selection) ---------
  var lookupCache = null;     // lookup text -> response, so nav never re-queries
  var compoundsCache = null;  // char -> full joined compound list (one request)
  var compoundsPending = null;// char -> in-flight promise, so two cards share it
  var usedInCache = null;     // word -> larger words containing it
  var usedInPending = null;   // word -> in-flight promise
  var crumbsExpanded = false; // a pressed "…" shows the whole trail until nav
  var charDataIndex = null;   // char -> char match data (accumulates)
  var charCardIndex = null;   // char -> the card element showing it, this view
  var viewStack = [];         // the descent; last entry is the current view
  var currentSrcText = "";    // source text of the view being rendered (see noteApplies)
  var wordStates = [];        // one per word surface in the current view
  var independentChars = [];  // current view's chars that are nobody's component
  var independentCardEls = null;
  var topCharsBox = null;

  function ensureHost() {
    if (host && host.isConnected) return;
    if (!host) {
      host = document.createElement("div");
      host.setAttribute("data-hanja-hover", "");
      for (var prop in HOST_STYLE) {
        if (Object.prototype.hasOwnProperty.call(HOST_STYLE, prop)) {
          host.style.setProperty(prop, HOST_STYLE[prop], "important");
        }
      }
      shadow = host.attachShadow({ mode: "closed" });
      var style = document.createElement("style");
      // Static stylesheet string only — never page or dictionary data.
      style.textContent = CSS;
      shadow.appendChild(style);
      panel = document.createElement("div");
      panel.className = "panel";
      shadow.appendChild(panel);
      installResize();
    }
    (document.documentElement || document.body).appendChild(host);
  }

  /* ------------------------------------------------------------------ *
   * Resizing (stage 1 — no persistence)
   *
   * The panel carries `resize: both`. Its bounds are applied inline at the
   * start of the first drag rather than in the stylesheet, because the
   * stylesheet values do double duty: `max-height: 360px` is the DEFAULT
   * content cap (height is auto, so short cards stay short), and a
   * `min-height` in the base rule would inflate every small popup. Once the
   * user takes over, the panel is explicitly sized and the bounds become the
   * real min/max. Chrome does honour min-/max-width/height while dragging,
   * but the JS clamp below is authoritative — it also covers viewport changes
   * and programmatic sizing.
   * ------------------------------------------------------------------ */

  function viewportSize() {
    var doc = document.documentElement;
    return {
      w: (doc && doc.clientWidth) || window.innerWidth || 0,
      h: (doc && doc.clientHeight) || window.innerHeight || 0
    };
  }

  // Freeze the current dimensions and hand the panel over to the user. Called
  // on mousedown in the handle's corner, before the browser starts dragging.
  function beginUserResize() {
    if (userSized) return;
    var box = panel.getBoundingClientRect();
    userSized = true;
    panel.style.setProperty("min-width", MIN_PANEL_W + "px");
    panel.style.setProperty("min-height", MIN_PANEL_H + "px");
    panel.style.setProperty("max-width", (MAX_PANEL_VW * 100) + "vw");
    panel.style.setProperty("max-height", (MAX_PANEL_VH * 100) + "vh");
    // Height was auto; pin it so the drag continues from what is on screen.
    panel.style.setProperty("width", Math.round(box.width) + "px");
    panel.style.setProperty("height", Math.round(box.height) + "px");
  }

  function clampPanelSize() {
    if (!userSized) return;
    var vp = viewportSize();
    var maxW = Math.max(MIN_PANEL_W, Math.round(vp.w * MAX_PANEL_VW));
    var maxH = Math.max(MIN_PANEL_H, Math.round(vp.h * MAX_PANEL_VH));
    var box = panel.getBoundingClientRect();
    if (box.width > maxW + 0.5) panel.style.setProperty("width", maxW + "px");
    else if (box.width < MIN_PANEL_W - 0.5) panel.style.setProperty("width", MIN_PANEL_W + "px");
    if (box.height > maxH + 0.5) panel.style.setProperty("height", maxH + "px");
    else if (box.height < MIN_PANEL_H - 0.5) panel.style.setProperty("height", MIN_PANEL_H + "px");
  }

  // A resize has no end event, so this runs on a debounce from the observer.
  // Width changes alter how many lines a gloss takes, so the clamp/"more"
  // measurement has to run again before the popup is re-anchored.
  function settleResize() {
    resizeTimer = null;
    clampPanelSize();
    syncClamps();
    // A tick that lands during (or right after) a drag must not let the
    // content shift under the user.
    holdDragScroll();
    if (visible && !dragState) reposition();
    // Absorb the adjustments we just made, so the observer does not treat
    // them as a fresh user resize and loop.
    var box = panel.getBoundingClientRect();
    lastPanelW = box.width;
    lastPanelH = box.height;
  }

  function inResizeCorner(ev) {
    var box = panel.getBoundingClientRect();
    return ev.clientX <= box.right && ev.clientY <= box.bottom &&
      (box.right - ev.clientX) <= RESIZE_ZONE &&
      (box.bottom - ev.clientY) <= RESIZE_ZONE;
  }

  // The panel's scroll offset must not move because the user resized it. The
  // browser clamps scrollTop whenever the visible area grows, and the vertical
  // scrollbar ends right where the handle begins, so a drag that starts a few
  // pixels high used to grab the thumb and scroll the content instead. Pin the
  // offset for the whole gesture and put it back on every tick.
  function holdDragScroll() {
    if (dragScrollTop === null) return;
    if (panel.scrollTop !== dragScrollTop) panel.scrollTop = dragScrollTop;
  }

  function installResize() {
    // We drive the resize ourselves rather than leaving it to the native
    // resizer: its hit area is a handful of pixels that overlap the scrollbar,
    // which made drags scroll the content or do nothing at all. Taking the
    // gesture means a predictable RESIZE_ZONE target, no text selection, and
    // exact control over the scroll offset. `resize: both` stays in the
    // stylesheet purely so Chrome paints the grip.
    panel.addEventListener("mousedown", function (ev) {
      if (ev.button !== 0 || !inResizeCorner(ev)) return;
      ev.preventDefault();   // no native resize, no drag-select
      ev.stopPropagation();  // no row underneath sees the press
      beginUserResize();
      var box = panel.getBoundingClientRect();
      dragState = {
        x: ev.clientX, y: ev.clientY,
        w: box.width, h: box.height
      };
      dragScrollTop = panel.scrollTop;
      resizing = true;
    }, true);

    window.addEventListener("mousemove", function (ev) {
      if (!dragState) return;
      ev.preventDefault();
      var vp = viewportSize();
      var maxW = Math.max(MIN_PANEL_W, Math.round(vp.w * MAX_PANEL_VW));
      var maxH = Math.max(MIN_PANEL_H, Math.round(vp.h * MAX_PANEL_VH));
      var w = dragState.w + (ev.clientX - dragState.x);
      var h = dragState.h + (ev.clientY - dragState.y);
      w = Math.max(MIN_PANEL_W, Math.min(maxW, w));
      h = Math.max(MIN_PANEL_H, Math.min(maxH, h));
      panel.style.setProperty("width", Math.round(w) + "px");
      panel.style.setProperty("height", Math.round(h) + "px");
      // The top-left stays put during the gesture, so the drag feels direct;
      // re-anchoring happens once the drag ends.
      holdDragScroll();
    }, true);

    window.addEventListener("mouseup", function () {
      if (!dragState) return;
      dragState = null;
      holdDragScroll();
      // A width change alters how many lines a gloss takes, which changes the
      // content height — measure, then hold the offset again.
      syncClamps();
      holdDragScroll();
      reposition();
      dragScrollTop = null;
      setTimeout(function () { resizing = false; }, 0);
    }, true);

    // Capture phase: swallow the click that ends the drag before any row sees it.
    panel.addEventListener("click", function (ev) {
      if (!resizing) return;
      resizing = false;
      ev.preventDefault();
      ev.stopPropagation();
    }, true);

    if (typeof ResizeObserver !== "function") return;
    var observer = new ResizeObserver(function () {
      var box = panel.getBoundingClientRect();
      // Hidden popups report 0; ignore, and ignore sizes we produced ourselves.
      if (!box.width && !box.height) return;
      if (Math.abs(box.width - lastPanelW) < 0.5 &&
          Math.abs(box.height - lastPanelH) < 0.5) return;
      lastPanelW = box.width;
      lastPanelH = box.height;
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(settleResize, RESIZE_DEBOUNCE);
    });
    observer.observe(panel);
  }

  function isInsidePopup(node) {
    if (!host || !node) return false;
    // Events originating inside a closed shadow root are retargeted to the host.
    if (node === host) return true;
    return typeof node.nodeType === "number" && node.nodeType === 1 && host.contains(node);
  }

  function eventInsidePopup(e) {
    if (!host) return false;
    if (isInsidePopup(e.target)) return true;
    if (typeof e.composedPath === "function") {
      var path = e.composedPath();
      for (var i = 0; i < path.length; i++) {
        if (path[i] === host) return true;
      }
    }
    return false;
  }

  // A new selection is a new session: nav stack, caches and any retained
  // scroll offsets are all discarded.
  function resetSession() {
    lookupCache = Object.create(null);
    compoundsCache = Object.create(null);
    compoundsPending = Object.create(null);
    usedInCache = Object.create(null);
    usedInPending = Object.create(null);
    crumbsExpanded = false;
    charDataIndex = Object.create(null);
    charCardIndex = Object.create(null);
    viewStack = [];
    wordStates = [];
    pendingScrollTop = null;
  }

  function hide() {
    requestSeq++; // invalidate any in-flight response (incl. spelling swaps)
    anchorRect = null;
    resetSession();
    if (!host) return;
    // Reset the scroll container while it still has layout, so the next
    // selection cannot inherit this popup's scroll position.
    if (panel) panel.scrollTop = 0;
    host.style.setProperty("display", "none", "important");
    visible = false;
  }

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null && text !== "") node.textContent = String(text);
    return node;
  }

  function asArray(v) {
    return Array.isArray(v) ? v : [];
  }

  function nonEmptyString(v) {
    return typeof v === "string" && v.trim() !== "" ? v.trim() : "";
  }

  function clearNode(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  function uniqStrings(values) {
    var seen = Object.create(null);
    var out = [];
    for (var i = 0; i < values.length; i++) {
      var v = nonEmptyString(values[i]);
      if (!v || seen[v]) continue;
      seen[v] = true;
      out.push(v);
    }
    return out;
  }

  function usableMatches(matches) {
    return asArray(matches).filter(function (m) {
      return m && typeof m === "object";
    });
  }

  function spellingKey(m) {
    return nonEmptyString(m.canonical) || nonEmptyString(m.surface);
  }

  // "나라 국" / "나라 국 · 서울 방" ; falls back to readings when no eumhun.
  function formatEumhun(eumhun) {
    var parts = [];
    var list = asArray(eumhun);
    for (var i = 0; i < list.length; i++) {
      var entry = list[i];
      if (!entry || typeof entry !== "object") continue;
      var hun = nonEmptyString(entry.hun);
      var eum = nonEmptyString(entry.eum);
      if (hun && eum) parts.push(hun + " " + eum);
      else if (eum) parts.push(eum);
      else if (hun) parts.push(hun);
    }
    return parts.join(" · ");
  }

  // Display-time capitalization: uppercase the first letter character we meet,
  // so "(historical) a kind of hat" → "(Historical) a kind of hat". The
  // underlying data string is never modified.
  function capitalizeSense(text) {
    var s = String(text);
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (!/\p{L}/u.test(ch)) continue;
      var upper = ch.toUpperCase();
      // Caseless scripts (hanja, hangul) uppercase to themselves — leave alone.
      if (upper === ch) return s;
      return s.slice(0, i) + upper + s.slice(i + 1);
    }
    return s;
  }

  // Wraps a text node in a line-clamped box. syncClamps() adds the "more"
  // button afterwards, once the element has been laid out and can be measured.
  function clampWrap(node, lines) {
    var wrap = el("div", "clampwrap");
    node.classList.add("clamp", lines === 1 ? "clamp-1" : "clamp-2");
    wrap.appendChild(node);
    return wrap;
  }

  // Numbered sense list with hanging indent; a lone sense needs no number.
  function appendGlosses(parent, glosses) {
    var list = asArray(glosses).map(nonEmptyString).filter(Boolean);
    if (!list.length) return;
    var box = el("div", "glosses");
    if (list.length > 1) box.classList.add("numbered");
    list.forEach(function (text, i) {
      var row = el("div", "gloss");
      if (list.length > 1) row.appendChild(el("span", "gloss-num", (i + 1) + "."));
      row.appendChild(clampWrap(el("span", "gloss-text", capitalizeSense(text)), 2));
      box.appendChild(row);
    });
    parent.appendChild(box);
  }

  // Reveals clamped text in place. Runs after layout, so overflow is real.
  function syncClamps() {
    if (!viewRoot) return;
    var wraps = viewRoot.querySelectorAll(".clampwrap");
    for (var i = 0; i < wraps.length; i++) {
      var wrap = wraps[i];
      var body = wrap.firstChild;
      if (!body || !body.classList || !body.classList.contains("clamp")) continue;
      if (body.classList.contains("expanded")) continue; // keep its toggle
      var overflowing = body.scrollHeight > body.clientHeight + 1;
      var button = wrap.querySelector(".more");
      if (overflowing && !button) {
        wrap.appendChild(makeMoreButton(body));
      } else if (!overflowing && button) {
        wrap.removeChild(button);
      }
    }
  }

  function makeMoreButton(body) {
    var button = el("button", "more", "more");
    button.type = "button";
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();   // never triggers navigation on a clickable row
      var expanded = body.classList.toggle("expanded");
      button.textContent = expanded ? "less" : "more";
      button.setAttribute("aria-expanded", expanded ? "true" : "false");
      refreshLayout();
    });
    return button;
  }

  // Scroll offset owed to the view being rendered. Applied only once layout
  // exists — assigning scrollTop while the host is display:none is a no-op and
  // the browser would otherwise restore the previous offset.
  var pendingScrollTop = null;

  function applyPendingScroll() {
    if (pendingScrollTop === null) return;
    panel.scrollTop = pendingScrollTop;
    pendingScrollTop = null;
  }

  // Re-measure clamps, settle the scroll offset, then re-anchor.
  function refreshLayout() {
    syncClamps();
    applyPendingScroll();
    reposition();
  }

  // True when the user has an active text selection inside the popup, so a
  // click that merely ended a copy-drag doesn't navigate.
  function hasShadowSelection() {
    try {
      if (shadow && typeof shadow.getSelection === "function") {
        var sel = shadow.getSelection();
        return !!sel && !sel.isCollapsed;
      }
    } catch (e) { /* not supported — fall through */ }
    return false;
  }

  /* ---- Wiktionary links ------------------------------------------------ *
   * Derived at runtime from the match itself; no data change is involved.
   * Char cards point at the canonical hanja; word cards at the HANGUL
   * headword, because that is where Korean word entries live.
   * -------------------------------------------------------------------- */

  var WIKI_BASE = "https://en.wiktionary.org/wiki/";

  function wiktionaryUrl(title) {
    var t = nonEmptyString(title);
    return t ? WIKI_BASE + encodeURIComponent(t) + "#Korean" : "";
  }

  // Appends the small top-right link to a card head. Clicks are isolated from
  // the popup's own click handling the same way the "more" expander does it —
  // stopPropagation only, so the browser still follows the link. Opening the
  // new tab ends the popup session by itself; nothing extra to dismiss.
  function appendWikiLink(head, title) {
    var url = wiktionaryUrl(title);
    if (!url) return null;
    var link = el("a", "wiki", "Wiktionary ↗");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label",
      "Wiktionary entry for " + title + " (opens in a new tab)");
    link.addEventListener("mousedown", function (ev) { ev.stopPropagation(); });
    link.addEventListener("click", function (ev) { ev.stopPropagation(); });
    head.appendChild(link);
    return link;
  }

  // Wires a div as a keyboard-accessible navigation row. `target` is either the
  // text of a follow-up lookup or a function that performs the navigation
  // itself (the used-in disclosure needs its own request).
  function makeNavRow(row, target) {
    row.setAttribute("role", "button");
    row.setAttribute("tabindex", "0");
    function activate(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (hasShadowSelection()) return;
      if (typeof target === "function") target();
      else navigateTo(target);
    }
    row.addEventListener("click", function (ev) {
      // The "more" expander stops propagation itself; this is belt and braces.
      if (ev.target && ev.target.closest && ev.target.closest(".more")) return;
      activate(ev);
    });
    row.addEventListener("keydown", function (ev) {
      // Enter/Space on the nested "more" button must toggle, not navigate.
      if (ev.target !== row) return;
      if (ev.key === "Enter" || ev.key === " " || ev.key === "Spacebar") activate(ev);
    });
  }

  /* ------------------------------------------------------------------ *
   * Card builders
   * ------------------------------------------------------------------ */

  // Fills (or refills) the swappable body of a word card for one spelling.
  function fillWordBody(body, m) {
    clearNode(body);

    var head = el("div", "head");
    // The hanja spelling is always the big text; `surface` may be either script
    // depending on what the user highlighted.
    var surface = nonEmptyString(m.surface);
    var canonical = nonEmptyString(m.canonical);
    var hangul = nonEmptyString(m.hangul);
    var big = canonical || surface;
    head.appendChild(el("div", "surface", big));

    var meta = el("div", "headmeta");
    if (hangul) meta.appendChild(el("div", "hangul", hangul));
    // Note the highlighted form only when it is neither the big text nor the
    // hangul already shown (e.g. a simplified/variant spelling was selected),
    // and only in a view whose own source text actually contains it.
    if (surface && surface !== big && surface !== hangul && noteApplies(surface)) {
      meta.appendChild(el("div", "canonical", surface + " → " + big));
    }
    head.appendChild(meta);
    // Korean word entries usually live at the hangul title; hp-flagged
    // matches were harvested from the hanja-spelling page (大韓民國), which
    // also hosts the Chinese/Japanese entries, so link there instead.
    // Rebuilt with the rest of the body, so a chip swap re-points it too.
    appendWikiLink(head, m.hp === true ? (big || hangul) : (hangul || big));
    body.appendChild(head);

    appendGlosses(body, m.glosses);

    // Per-character eumhun chips — only for chars whose data we actually have.
    var chars = uniqStrings(asArray(m.chars));
    var chips = el("div", "chips");
    var chipCount = 0;
    for (var i = 0; i < chars.length; i++) {
      var info = charDataIndex[chars[i]];
      if (!info) continue;
      var line = formatEumhun(info.eumhun) ||
        asArray(info.readings).map(nonEmptyString).filter(Boolean).join(", ");
      if (!line) continue;
      var chip = el("span", "chip nav");
      chip.appendChild(el("span", "chip-glyph", chars[i]));
      chip.appendChild(el("span", "chip-text", line));
      chip.setAttribute("aria-label", chars[i] + " " + line);
      makeNavRow(chip, (function (ch) {
        return function () { revealCharCard(ch); };
      })(chars[i]));
      chips.appendChild(chip);
      chipCount++;
    }
    if (chipCount) body.appendChild(chips);

    appendUsedInRow(body, m);
  }

  function prefersReducedMotion() {
    try {
      return !!(window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (e) {
      return false;
    }
  }

  // Re-triggerable tint fade, so clicking the same chip twice flashes twice.
  function flashCard(card) {
    card.classList.remove("flash");
    void card.offsetWidth;              // force a reflow to restart the animation
    card.classList.add("flash");
    if (card.hhFlashTimer) clearTimeout(card.hhFlashTimer);
    card.hhFlashTimer = setTimeout(function () {
      card.classList.remove("flash");
      card.hhFlashTimer = null;
    }, FLASH_MS);
  }

  // Clicking an eumhun chip. The character's full card is already on screen in
  // COMPONENT HANJA, so pushing a view would just duplicate it: scroll to the
  // card and flash it instead. Only when that card is genuinely absent do we
  // fall back to an ordinary drill-down lookup.
  function revealCharCard(ch) {
    var card = charCardIndex && charCardIndex[ch];
    if (!card || !card.isConnected) {
      navigateTo(ch);
      return false;
    }
    var panelBox = panel.getBoundingClientRect();
    var cardBox = card.getBoundingClientRect();
    scrollPanelTo(panel.scrollTop + (cardBox.top - panelBox.top) - 8);
    if (!prefersReducedMotion()) flashCard(card);
    return true;
  }

  // Smooth where it is wanted, instant under reduced motion.
  function scrollPanelTo(top) {
    var limit = Math.max(0, panel.scrollHeight - panel.clientHeight);
    var target = Math.max(0, Math.min(limit, top));
    if (prefersReducedMotion() || typeof panel.scrollTo !== "function") {
      panel.scrollTop = target;
      return;
    }
    var startTop = panel.scrollTop;
    panel.scrollTo({ top: target, behavior: "smooth" });
    // Smooth scrolling is driven by animation frames. A host that is not
    // compositing (background tab, hidden pane) never ticks them and the
    // request silently does nothing, which would strand the user. If the
    // offset has not budged at all by the time a normal animation would have
    // finished, land on the target outright. Any movement means the animation
    // ran — or the user took over — so leave it alone.
    if (scrollSettleTimer) clearTimeout(scrollSettleTimer);
    scrollSettleTimer = setTimeout(function () {
      scrollSettleTimer = null;
      if (panel.scrollTop === startTop && startTop !== target) {
        panel.scrollTop = target;
      }
    }, SCROLL_SETTLE_MS);
  }

  // Used-in disclosure (design option C): ONE collapsed line at the end of the
  // word body, never an inline list — the card stays about this word and its
  // components. Rebuilt with the body, so a homograph chip swap re-points it at
  // the newly selected spelling (and drops it when that spelling has no count).
  function appendUsedInRow(body, m) {
    var count = (typeof m.usedInCount === "number" && isFinite(m.usedInCount) &&
      m.usedInCount > 0) ? Math.floor(m.usedInCount) : 0;
    var word = nonEmptyString(m.canonical) || nonEmptyString(m.surface);
    if (!count || !word) return;

    var row = el("div", "entry-row usedin-row nav");
    var text = el("span", "usedin-text");
    text.appendChild(document.createTextNode("Used in "));
    text.appendChild(el("b", null, String(count)));
    text.appendChild(document.createTextNode(
      count === 1 ? " larger word" : " larger words"));
    row.appendChild(text);

    var busy = false;
    makeNavRow(row, function () {
      if (busy) return;
      busy = true;
      row.setAttribute("aria-busy", "true");
      var seq = requestSeq;
      fetchUsedIn(word).then(function (words) {
        if (seq !== requestSeq) return;
        busy = false;
        row.removeAttribute("aria-busy");
        // Failure (or an empty list): stay on the card, keep the row pressable.
        if (!words || !words.length) return;
        pushView({
          key: "usedin:" + word,
          label: "Used in",
          matches: [{ kind: "usedin", word: word, rows: words }]
        });
      });
    });
    body.appendChild(row);
  }

  // The used-in list: same shape as the homophone browser, one nav row per
  // larger word.
  function buildUsedInCard(m) {
    var rows = asArray(m.rows).filter(function (w) {
      return w && typeof w === "object" && (nonEmptyString(w.hanja) || nonEmptyString(w.hangul));
    });
    if (!rows.length) return null;

    var card = el("div", "card usedin");
    var title = el("div", "reading-title");
    title.appendChild(document.createTextNode(
      rows.length + (rows.length === 1 ? " word contains " : " words contain ")));
    title.appendChild(el("b", null, nonEmptyString(m.word)));
    card.appendChild(title);

    var list = el("div", "usedin-list");
    rows.forEach(function (w) {
      var row = buildEntryRow(w, "usedin-item");
      if (row) list.appendChild(row);
    });
    card.appendChild(list);
    return card;
  }

  // COMPONENT WORDS: the word's interior re-segmented into sub-words. Each row
  // navigates into that sub-word's own card (which may itself have parts).
  // The section is built only when it has rows, so an inapplicable card
  // carries no phantom label text.
  function renderParts(state) {
    clearNode(state.partsBox);
    state.partsList = el("div", "part-list");
    asArray(state.items[state.index].parts).forEach(function (p) {
      if (!p || typeof p !== "object") return;
      if (p.type !== "word") return;         // char parts live in COMPONENT HANJA
      var hanja = nonEmptyString(p.hanja);
      if (!hanja) return;
      var row = el("div", "part-row");
      row.appendChild(el("span", "p-hanja", hanja));
      var text = el("span", "p-text");
      var hangul = nonEmptyString(p.hangul);
      if (hangul) text.appendChild(el("span", "p-hangul", hangul));
      var gloss = asArray(p.glosses).map(nonEmptyString).filter(Boolean)[0] || "";
      if (gloss) text.appendChild(el("span", "p-gloss", (hangul ? "  " : "") + gloss));
      row.appendChild(clampWrap(text, 1));
      makeNavRow(row, hanja);
      state.partsList.appendChild(row);
    });
    if (state.partsList.firstChild) {
      state.partsBox.appendChild(el("div", "label", "Component words"));
      state.partsBox.appendChild(state.partsList);
    }
  }

  function syncChips(state) {
    state.chips.forEach(function (chip, i) {
      var on = i === state.index;
      chip.classList.toggle("sel", on);
      chip.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  // A rare spelling only warrants hedging when the user highlighted HANGUL:
  // then the word is probably native Korean and the hanja spelling is a
  // coincidence. If they highlighted the hanja itself, the flag is ignored.
  function isHedged(m) {
    if (!m || m.rare !== true) return false;
    var surface = nonEmptyString(m.surface);
    return !!surface && !HAN_RE.test(surface);
  }

  // Everything on a word card that depends on the selected spelling.
  function syncWordCard(state) {
    syncChips(state);
    var m = state.items[state.index];
    var hedged = isHedged(m);
    state.card.classList.toggle("hedged", hedged);
    clearNode(state.hedgeBox);
    if (hedged) {
      state.hedgeBox.appendChild(el("div", "label", "Rare hanja homograph"));
      state.hedgeBox.appendChild(el("div", "hedge-note",
        "Likely native Korean. This hanja spelling is obscure."));
    }
    fillWordBody(state.body, m);
    renderParts(state);
  }

  // One card per word surface. Homographs (사기 → 詐欺 / 士氣 / 沙器) get a
  // spelling selector; every word card gets nested regions for its component
  // words and component hanja, so the hierarchy is legible at a glance.
  function buildWordGroupCard(state) {
    var card = el("div", "card");
    var body = el("div", "word-body");

    state.card = card;
    state.body = body;
    state.chips = [];

    // Hedge banner: filled only when the selected spelling is a rare hangul match.
    var hedgeBox = el("div", "hedge");
    card.appendChild(hedgeBox);
    state.hedgeBox = hedgeBox;

    if (state.items.length > 1) {
      var selector = el("div", "spellings");
      state.items.forEach(function (m, i) {
        var chip = el("button", "spell-chip", spellingKey(m));
        chip.type = "button";
        chip.setAttribute("aria-pressed", i === 0 ? "true" : "false");
        if (i === 0) chip.classList.add("sel");
        if (m.rare === true) {
          chip.classList.add("rare");
          chip.appendChild(el("sup", "chip-rare", "rare"));
        }
        chip.addEventListener("click", function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          selectSpelling(state, i);
        });
        state.chips.push(chip);
        selector.appendChild(chip);
      });
      card.appendChild(selector);
    }

    card.appendChild(body);

    var partsBox = el("div", "parts");
    card.appendChild(partsBox);
    state.partsBox = partsBox;

    var componentsBox = el("div", "components");
    card.appendChild(componentsBox);
    state.componentsBox = componentsBox;
    state.componentList = el("div", "component-list");

    syncWordCard(state);
    return card;
  }

  // Homophone browse: "국 — 12 hanja" over a scrollable list of candidates.
  function buildReadingCard(m) {
    var candidates = asArray(m.candidates).filter(function (c) {
      return c && typeof c === "object" && nonEmptyString(c.char);
    });
    if (!candidates.length) return null;

    var card = el("div", "card reading");
    var syllable = nonEmptyString(m.surface) || nonEmptyString(m.eum);
    var title = el("div", "reading-title");
    title.appendChild(document.createTextNode(candidates.length + " hanja read "));
    title.appendChild(el("b", null, syllable));
    card.appendChild(title);

    var list = el("div", "reading-list");
    candidates.forEach(function (c) {
      var glyph = nonEmptyString(c.char);
      var row = el("div", "reading-row");
      row.appendChild(el("span", "r-glyph", glyph));

      var text = el("span", "r-text");
      var hun = nonEmptyString(c.hun);
      var eum = nonEmptyString(c.eum) || syllable;
      var label = hun && eum ? hun + " " + eum : (eum || hun);
      if (label) text.appendChild(el("span", "r-eumhun", label));
      appendBadges(text, c);
      var gloss = nonEmptyString(c.gloss);
      if (gloss) text.appendChild(el("span", "r-gloss", (label ? "  " : "") + gloss));
      row.appendChild(text);

      makeNavRow(row, glyph);
      list.appendChild(row);
    });
    card.appendChild(list);
    return card;
  }

  // Classification badges are DECLARATIVE: this array is the whole definition.
  // Each entry answers, for one match or reading candidate, "do I apply, and
  // with what wording?" — `when` returns false or { label, title }. Adding a
  // badge is one more entry here and nothing else: the renderer below is the
  // only badge-drawing code and every site calls it. (Inline semantic markers
  // like RARE are a different animal and stay where they are.)
  var BADGES = [
    {
      key: "basic1800",
      when: function (m) {
        // A known tier already implies membership, so the tier badge REPLACES
        // this one; Basic-1800 is left for edu chars whose tier is unknown.
        // (Keyed off a tier we can actually render, so an unrecognised eduT
        // value can never leave the char with no badge at all.)
        return m.edu === true && !TIER_LABEL[m.eduT] &&
          { label: EDU_LABEL, title: EDU_TITLE };
      }
    },
    {
      key: "moeTier",
      when: function (m) {
        var t = m.eduT;
        return !!TIER_LABEL[t] && { label: TIER_LABEL[t], title: TIER_TITLE[t] };
      }
    }
  ];

  // The one badge renderer, in registry order. `m` is a char match or a
  // reading-list candidate — anything carrying the classification flags.
  function appendBadges(container, m) {
    if (!container || !m || typeof m !== "object") return 0;
    var count = 0;
    BADGES.forEach(function (spec) {
      var info;
      try {
        info = spec.when(m);
      } catch (e) {
        info = false;
      }
      if (!info || !nonEmptyString(info.label)) return;
      // Shared styling, plus a per-key modifier so one badge can be tuned
      // later without touching this code.
      var badge = el("span", "edu-badge edu-badge--" + spec.key, info.label);
      var title = nonEmptyString(info.title) || info.label;
      badge.title = title;
      badge.setAttribute("aria-label", title);
      container.appendChild(badge);
      count++;
    });
    return count;
  }

  function buildCharCard(m) {
    var card = el("div", "card");

    var head = el("div", "head");
    // The canonical hanja is always the big glyph, mirroring word cards: the
    // entry IS the canonical character, and a simplified/shinjitai surface
    // (highlighting 国) belongs in the variant note, not the headline.
    var surface = nonEmptyString(m.surface);
    var canonical = nonEmptyString(m.canonical);
    var big = canonical || surface;
    head.appendChild(el("div", "surface", big));

    var meta = el("div", "headmeta");
    var eumhun = formatEumhun(m.eumhun);
    var readingLine = null;
    if (eumhun) {
      readingLine = el("div", "eumhun", eumhun);
      meta.appendChild(readingLine);
    } else {
      var readings = asArray(m.readings).map(nonEmptyString).filter(Boolean);
      if (readings.length) {
        readingLine = el("div", "readings", readings.join(", "));
        meta.appendChild(readingLine);
      }
    }
    // Classification badges, tucked onto the end of the reading line.
    appendBadges(readingLine || meta, m);
    // The variant note belongs to the view, not to the cached match: it says
    // "you highlighted 学, this entry is 學", which is only true where 学 was
    // actually in the looked-up text (see noteApplies).
    if (surface && surface !== big && noteApplies(surface)) {
      meta.appendChild(el("div", "canonical", surface + " → " + big));
    }
    head.appendChild(meta);
    // The entry IS the canonical character, so that is the page we link to.
    appendWikiLink(head, big);
    card.appendChild(head);

    appendGlosses(card, m.glosses);

    appendCompounds(card, m);

    return card;
  }

  // One dictionary line: "국민 (國民): the people of a nation". Shared by the
  // compound rows on char cards and the used-in list view. A row with a hanja
  // spelling is a nav row exactly like a component-word row; entries with no
  // spelling to look up (hangul-only compounds exist in the data) get no
  // chevron and no click target.
  function buildEntryRow(c, className) {
    if (!c || typeof c !== "object") return null;
    var hangul = nonEmptyString(c.hangul);
    var hanja = nonEmptyString(c.hanja);
    if (!hangul && !hanja) return null;

    var row = el("div", "entry-row " + className);
    var text = el("span", "compound");
    text.appendChild(el("span", "cpd-hangul", hangul || hanja));
    if (hanja && hangul) text.appendChild(el("span", "cpd-hanja", " (" + hanja + ")"));
    var gloss = nonEmptyString(c.gloss);
    if (gloss) text.appendChild(el("span", "cpd-gloss", ": " + gloss));
    if (c.rare === true) {
      row.classList.add("rare");
      text.appendChild(el("sup", "cpd-rare", "rare"));
    }
    row.appendChild(clampWrap(text, 1));

    if (hanja) {
      row.classList.add("nav");
      makeNavRow(row, hanja);
    }
    return row;
  }

  function buildCompoundRow(c) {
    return buildEntryRow(c, "compound-row");
  }

  // Scrolls `node` back into the panel's visible band after the card grew,
  // so pressing "show more" never leaves the control off-screen.
  function keepInView(node) {
    if (!node || !node.isConnected || !panel) return;
    var box = panel.getBoundingClientRect();
    var target = node.getBoundingClientRect();
    if (target.bottom > box.bottom - 2) {
      panel.scrollTop += target.bottom - box.bottom + 6;
    } else if (target.top < box.top + 2) {
      panel.scrollTop -= box.top - target.top + 6;
    }
  }

  // COMPOUNDS: the inline five, plus a "Show 5 more (N)" control when the
  // char's full index (cwCount) holds more. The first press fetches that index
  // once; later presses reveal five more from the cached list.
  function appendCompounds(card, m) {
    var box = el("div", "compounds");
    var shown = Object.create(null);   // hanja spellings already on screen
    var shownCount = 0;
    var rowCount = 0;

    asArray(m.compounds).slice(0, MAX_COMPOUNDS).forEach(function (c) {
      var hanja = c && typeof c === "object" ? nonEmptyString(c.hanja) : "";
      if (hanja && shown[hanja]) return;
      var row = buildCompoundRow(c);
      if (!row) return;
      if (hanja) {
        shown[hanja] = true;
        shownCount++;
      }
      box.appendChild(row);
      rowCount++;
    });

    var char = nonEmptyString(m.canonical) || nonEmptyString(m.surface);
    var total = (typeof m.cwCount === "number" && isFinite(m.cwCount) && m.cwCount > 0)
      ? Math.floor(m.cwCount) : 0;
    // Before the index is fetched the remaining count comes from cwCount minus
    // the spellings already displayed (hangul-only rows are not in the index).
    // Afterwards `pending` is authoritative.
    var remaining = char ? Math.max(0, total - shownCount) : 0;

    if (!rowCount && !remaining) return;
    card.appendChild(el("div", "label", "Compounds"));
    card.appendChild(box);
    if (!remaining) return;

    var pending = null;   // full index minus everything already displayed
    var button = el("button", "cpd-more");
    button.type = "button";

    function syncButton() {
      if (remaining <= 0) {
        if (button.parentNode) button.parentNode.removeChild(button);
        return;
      }
      button.textContent =
        "Show " + Math.min(COMPOUND_PAGE, remaining) + " more (" + remaining + ")";
    }

    function revealNext() {
      while (pending.length) {
        var c = pending[0];
        var hanja = nonEmptyString(c.hanja);
        if (!hanja || shown[hanja]) { pending.shift(); continue; }
        break;
      }
      var added = 0;
      while (added < COMPOUND_PAGE && pending.length) {
        var next = pending.shift();
        var spelling = nonEmptyString(next.hanja);
        if (spelling && shown[spelling]) continue;
        var row = buildCompoundRow(next);
        if (!row) continue;
        if (spelling) shown[spelling] = true;
        box.appendChild(row);
        added++;
      }
      remaining = pending.length;
      syncButton();
      // The control follows the rows down; re-measure clamps, re-anchor the
      // popup for its new height, then make sure it is still reachable.
      var anchorEl = button.isConnected ? button : box.lastChild;
      refreshLayout();
      keepInView(anchorEl);
    }

    button.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();     // never read as a click on a compound row
      if (button.disabled) return;
      if (pending) { revealNext(); return; }

      var seq = requestSeq;     // dismissal or a new selection cancels this
      button.disabled = true;
      fetchCompounds(char).then(function (list) {
        if (seq !== requestSeq) return;
        button.disabled = false;
        // Failure: leave the rows alone and stay pressable for a retry.
        if (!list) return;
        pending = list.filter(function (c) {
          var hanja = nonEmptyString(c.hanja);
          return !!hanja && !shown[hanja];
        });
        remaining = pending.length;
        revealNext();
      });
    });

    syncButton();
    card.appendChild(button);
  }

  /* ------------------------------------------------------------------ *
   * View rendering
   * ------------------------------------------------------------------ */

  // The text a view was looked up FROM. Every view has one: the root view's is
  // the selection, a drill-down's is the row's target spelling. When no text is
  // threaded (test hooks, synthetic views) the view's own matches supply it —
  // a fresh response's surfaces are by definition parts of the text it answered,
  // and unlike charDataIndex entries they are never borrowed from another view.
  function viewSourceText(matches, text) {
    var parts = [];
    var explicit = nonEmptyString(text);
    if (explicit) parts.push(explicit);
    asArray(matches).forEach(function (m) {
      if (!m || typeof m !== "object") return;
      var s = nonEmptyString(m.surface);
      if (s) parts.push(s);
    });
    return parts.join("\n");
  }

  // "surface → canonical" is a statement about the CURRENT view: it explains a
  // glyph the reader actually highlighted here. char matches are cached per
  // popup session and reused in later views (charDataIndex), so the surface on
  // a cached match may belong to some earlier lookup — selecting 学生 and then
  // drilling into 文學 must not caption that view's 學 card with "学 → 學".
  // Rendering-time check, so nothing is mutated and going back restores the note.
  function noteApplies(surface) {
    if (!surface) return false;
    if (!currentSrcText) return true;   // unknown provenance: keep the note
    return currentSrcText.indexOf(surface) !== -1;
  }

  function adoptCharData(matches) {
    asArray(matches).forEach(function (m) {
      if (!m || m.kind !== "char") return;
      var surface = nonEmptyString(m.surface);
      var canonical = nonEmptyString(m.canonical);
      if (canonical && !charDataIndex[canonical]) charDataIndex[canonical] = m;
      if (surface && !charDataIndex[surface]) charDataIndex[surface] = m;
    });
  }

  // Single source of truth for where every char card lives. Each char match is
  // rendered exactly once: nested under the first word card whose SELECTED
  // spelling contains it, otherwise top-level. Re-running this after a chip
  // swap moves cards in and out of the group automatically — including giving
  // an independently-selected char its top-level card back.
  function renderCharRegions() {
    var claim = Object.create(null);
    wordStates.forEach(function (state) {
      uniqStrings(asArray(state.items[state.index].chars)).forEach(function (ch) {
        if (!claim[ch]) claim[ch] = state;
      });
    });

    wordStates.forEach(function (state) {
      clearNode(state.componentsBox);
      state.componentList = el("div", "component-list");
      state.owned = [];
    });
    if (topCharsBox) clearNode(topCharsBox);

    var rendered = Object.create(null);
    var count = 0;
    // Rebuilt from scratch every time cards move (including chip swaps), so an
    // eumhun chip always points at the card currently on screen.
    charCardIndex = Object.create(null);

    wordStates.forEach(function (state) {
      uniqStrings(asArray(state.items[state.index].chars)).forEach(function (ch) {
        if (claim[ch] !== state || rendered[ch]) return;
        var m = charDataIndex[ch];
        if (!m) return; // not fetched (yet) — simply no card for it
        var cardEl = buildCharCard(m);
        cardEl.classList.add("component");
        state.componentList.appendChild(cardEl);
        state.owned.push(ch);
        rendered[ch] = true;
        charCardIndex[ch] = cardEl;
        count++;
      });
      if (state.componentList.firstChild) {
        state.componentsBox.appendChild(el("div", "label", "Component hanja"));
        state.componentsBox.appendChild(state.componentList);
      }
    });

    // Independent characters keep their top-level card. The element is reused
    // across swaps, so an unrelated card is genuinely untouched (same node,
    // same text selection) rather than rebuilt.
    if (topCharsBox) {
      independentChars.forEach(function (ch) {
        if (rendered[ch] || claim[ch]) return;
        var m = charDataIndex[ch];
        if (!m) return;
        var cardEl = independentCardEls[ch];
        if (!cardEl) {
          cardEl = buildCharCard(m);
          independentCardEls[ch] = cardEl;
        }
        topCharsBox.appendChild(cardEl);
        rendered[ch] = true;
        charCardIndex[ch] = cardEl;
        count++;
      });
    }

    return count;
  }

  // Order: reading list, then word cards (same-surface homographs collapsed),
  // then the independent chars. Returns the number of cards rendered.
  function appendMatchCards(list) {
    adoptCharData(list);
    wordStates = [];
    independentChars = [];
    independentCardEls = Object.create(null);
    topCharsBox = null;

    var readings = [];
    var usedIns = [];
    var words = [];
    var responseChars = [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].kind === "reading") readings.push(list[i]);
      else if (list[i].kind === "usedin") usedIns.push(list[i]);
      else if (list[i].kind === "word") words.push(list[i]);
      else if (list[i].kind === "char") {
        var ck = spellingKey(list[i]);
        if (ck) responseChars.push(ck);
      }
    }
    responseChars = uniqStrings(responseChars);

    // Group word matches by surface, preserving first-appearance order.
    var groups = [];
    var bySurface = Object.create(null);
    for (var w = 0; w < words.length; w++) {
      var key = nonEmptyString(words[w].surface) || nonEmptyString(words[w].canonical);
      if (!bySurface[key]) {
        bySurface[key] = [];
        groups.push(bySurface[key]);
      }
      bySurface[key].push(words[w]);
    }

    var count = 0;
    for (var u = 0; u < usedIns.length; u++) {
      var usedInCard = buildUsedInCard(usedIns[u]);
      if (usedInCard) {
        viewRoot.appendChild(usedInCard);
        count++;
      }
    }
    for (var r = 0; r < readings.length; r++) {
      var readingCard = buildReadingCard(readings[r]);
      if (readingCard) {
        viewRoot.appendChild(readingCard);
        count++;
      }
    }

    groups.forEach(function (group) {
      var state = {
        items: group, index: 0, card: null, body: null, chips: [],
        partsBox: null, partsList: null,
        componentsBox: null, componentList: null, owned: []
      };
      wordStates.push(state);
      viewRoot.appendChild(buildWordGroupCard(state));
      count++;
    });

    // Char matches the response returned for a reason OTHER than being a
    // component of some word's first spelling (rules 3/3b) — i.e. unmatched
    // characters. Only these keep a top-level card when a spelling is swapped
    // away. A char that is both a component and independently selected is
    // deduped by the service worker; the component group wins (see notes).
    var isComponent = Object.create(null);
    wordStates.forEach(function (state) {
      uniqStrings(asArray(state.items[0].chars)).forEach(function (ch) {
        isComponent[ch] = true;
      });
    });
    independentChars = responseChars.filter(function (ch) { return !isComponent[ch]; });

    topCharsBox = el("div", "top-chars");
    viewRoot.appendChild(topCharsBox);

    return count + renderCharRegions();
  }

  /* ------------------------------------------------------------------ *
   * Navigation: a stack of views presented as a breadcrumb trail
   * ------------------------------------------------------------------ */

  /* ---- view identity -------------------------------------------------- *
   * A view's key is what it is ABOUT: one word, one character, one syllable
   * list, one used-in list. Navigation compares keys so that arriving at a
   * level already in the trail re-enters it instead of stacking a duplicate
   * (the 學生 › 學生 › 學生 report). A view showing several independent things
   * — a mixed sentence, a word plus unrelated characters — has no identity at
   * all: pushing a genuinely new view is much cheaper than wrongly collapsing
   * two different ones, so anything ambiguous returns null.
   * --------------------------------------------------------------------- */
  function viewKey(matches) {
    var list = usableMatches(matches);
    if (!list.length) return null;

    var usedIns = [], readings = [], words = [], chars = [];
    list.forEach(function (m) {
      if (m.kind === "usedin") usedIns.push(m);
      else if (m.kind === "reading") readings.push(m);
      else if (m.kind === "word") words.push(m);
      else if (m.kind === "char") chars.push(m);
    });

    if (list.length === 1 && usedIns.length === 1) {
      var listWord = nonEmptyString(usedIns[0].word);
      return listWord ? "usedin:" + listWord : null;
    }
    if (list.length === 1 && readings.length === 1) {
      var syllable = nonEmptyString(readings[0].surface) ||
        nonEmptyString(readings[0].eum);
      return syllable ? "reading:" + syllable : null;
    }
    if (usedIns.length || readings.length) return null;   // mixed: no identity

    if (words.length) {
      // Homographs share one surface and render as ONE card, so they are still
      // a single target; two different surfaces are two cards and are not.
      var surfaces = uniqStrings(words.map(function (m) {
        return nonEmptyString(m.surface) || nonEmptyString(m.canonical);
      }));
      if (surfaces.length !== 1) return null;
      // Only the first spelling contributes component char cards (rule 3b);
      // any char card beyond those is an independent card on screen.
      var isComponent = Object.create(null);
      uniqStrings(asArray(words[0].chars)).forEach(function (ch) {
        isComponent[ch] = true;
      });
      var independent = chars.filter(function (m) {
        return !isComponent[spellingKey(m)];
      });
      if (independent.length) return null;
      // The canonical, never the surface: a hangul-sourced 학생 view and a
      // hanja 學生 navigation are the same view.
      var canonical = nonEmptyString(words[0].canonical) || surfaces[0];
      return canonical ? "word:" + canonical : null;
    }

    if (chars.length === 1) {
      var glyph = spellingKey(chars[0]);
      return glyph ? "char:" + glyph : null;
    }
    return null;
  }

  // Only the CURRENT view is protected from duplication. Arriving at a place
  // that is further back in the trail is still forward travel — 學生 › 學校 ›
  // 學生 is a legitimate descent, the same way browser history records a
  // revisit — so an ancestor match pushes normally rather than collapsing.
  function isCurrentView(key) {
    if (!key) return false;
    var top = viewStack[viewStack.length - 1];
    return !!top && top.key === key;
  }

  // Already-on-screen target: no push. Scroll back to the top and flash the
  // card head, the same orientation cue the eumhun chips use.
  function orientCurrentView() {
    if (!viewRoot) return;
    scrollPanelTo(0);
    if (prefersReducedMotion()) return;
    var card = viewRoot.querySelector(".card");
    if (!card) return;
    flashCard(card.querySelector(".head") ||
      card.querySelector(".reading-title") || card);
  }

  // Already here: orient instead of stacking a copy of this very view.
  function reenterCurrentView(key) {
    if (!isCurrentView(key)) return false;
    orientCurrentView();
    return true;
  }

  // A crumb names what the view IS, not the gesture that opened it: selecting
  // 学生 roots the trail as 學生 (the card's "学生 → 學生" note already records
  // what was highlighted). That is exactly the view's identity, so the label
  // falls straight out of the key. Reading lists keep their syllable — the 국
  // view is the homophone list, not a variant spelling of 國. Only a view with
  // no single canonical (a mixed selection) falls back to its surface text.
  function viewLabel(matches, fallback) {
    var key = viewKey(matches);
    if (key) {
      var cut = key.indexOf(":");
      var kind = key.slice(0, cut);
      if (kind === "word" || kind === "char" || kind === "reading") {
        return key.slice(cut + 1);
      }
    }
    var order = ["reading", "word", "char"];
    for (var k = 0; k < order.length; k++) {
      for (var i = 0; i < matches.length; i++) {
        var m = matches[i];
        if (m.kind !== order[k]) continue;
        var label = nonEmptyString(m.surface) || nonEmptyString(m.canonical) ||
          nonEmptyString(m.eum);
        if (label) return label;
      }
    }
    return nonEmptyString(fallback);
  }

  function saveCurrentViewState() {
    var view = viewStack[viewStack.length - 1];
    if (!view) return;
    view.scrollTop = panel.scrollTop;
    view.selection = wordStates.map(function (state) { return state.index; });
  }

  // Crumbs: every level except the last jumps straight to that cached view.
  // Long trails keep the first and the last two, eliding the middle — but the
  // elision is a button that expands the trail in place, so no intermediate
  // level is ever unreachable. The expansion lasts until the next navigation.
  function buildCrumbs() {
    var bar = el("div", "crumbs");
    var last = viewStack.length - 1;
    var indices = [];
    var i;
    if (viewStack.length <= MAX_CRUMBS || crumbsExpanded) {
      for (i = 0; i < viewStack.length; i++) indices.push(i);
      if (crumbsExpanded) bar.classList.add("expanded");
    } else {
      indices = [0, -1, last - 1, last];
    }
    indices.forEach(function (idx, pos) {
      if (pos > 0) bar.appendChild(el("span", "crumb-sep", "›"));
      if (idx === -1) {
        var gap = el("button", "crumb-gap", "…");
        gap.type = "button";
        gap.setAttribute("aria-label",
          "Show all " + viewStack.length + " steps of the trail");
        gap.addEventListener("click", function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          crumbsExpanded = true;
          refreshCrumbs();
          refreshLayout();
        });
        bar.appendChild(gap);
        return;
      }
      var view = viewStack[idx];
      var label = view.label || "?";
      if (idx === last) {
        var current = el("span", "crumb current", label);
        current.setAttribute("aria-current", "true");
        bar.appendChild(current);
        return;
      }
      var crumb = el("button", "crumb", label);
      crumb.type = "button";
      crumb.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        goToDepth(idx);
      });
      bar.appendChild(crumb);
    });
    return bar;
  }

  // Swaps just the nav bar, so expanding the trail keeps the cards below
  // (and their revealed compounds) exactly as they are.
  function refreshCrumbs() {
    if (!viewRoot) return;
    var current = viewRoot.querySelector(".crumbs");
    if (!current) return;
    viewRoot.replaceChild(buildCrumbs(), current);
  }

  // Renders whatever is at the top of the stack.
  function renderCurrentView() {
    ensureHost();
    var view = viewStack[viewStack.length - 1];
    if (!view) return 0;

    // Any navigation re-collapses an expanded trail.
    crumbsExpanded = false;
    // Scope for the variant notes drawn while this view renders.
    currentSrcText = view.srcText || "";
    clearNode(panel);
    panel.scrollTop = 0;
    viewRoot = el("div", "view");
    panel.appendChild(viewRoot);

    if (viewStack.length > 1) viewRoot.appendChild(buildCrumbs());

    var count = appendMatchCards(view.matches);

    // Restore the spelling that was selected when we left this view.
    if (view.selection && view.selection.length) {
      var changed = false;
      wordStates.forEach(function (state, i) {
        var idx = view.selection[i];
        if (typeof idx === "number" && idx > 0 && idx < state.items.length) {
          state.index = idx;
          changed = true;
        }
      });
      if (changed) {
        wordStates.forEach(syncWordCard);
        renderCharRegions();
      }
    }

    // Deferred: the panel may not have layout yet (see applyPendingScroll).
    pendingScrollTop = view.scrollTop || 0;
    return count;
  }

  function goToDepth(index) {
    if (index < 0 || index >= viewStack.length - 1) return; // last = current
    saveCurrentViewState();
    viewStack.length = index + 1;
    renderCurrentView();
    refreshLayout();
  }

  // Cached lookups: every drill-down and spelling swap goes through here, so
  // revisiting anything in this popup session never hits the service worker.
  function fetchLookup(text) {
    if (Object.prototype.hasOwnProperty.call(lookupCache, text)) {
      return Promise.resolve(lookupCache[text]);
    }
    return sendLookup(text).then(function (response) {
      // Only successful responses are cached, so a transient failure can retry.
      if (response && response.ok === true) lookupCache[text] = response;
      return response;
    });
  }

  // Descend one level. Every drill-down goes through here, so the breadcrumb,
  // the saved scroll offset and the fade-in stay consistent.
  function pushView(view) {
    if (reenterCurrentView(view.key)) return;
    saveCurrentViewState();
    viewStack.push({
      key: view.key || null, label: view.label, matches: view.matches,
      srcText: viewSourceText(view.matches, view.srcText),
      scrollTop: 0, selection: null
    });
    renderCurrentView();
    refreshLayout();
  }

  // Every nav row — compounds, component words, used-in entries, reading rows,
  // chip fallbacks — lands here, so the cycle guard covers all of them at once.
  function navigateTo(text) {
    var target = nonEmptyString(text);
    if (!target) return;

    // Rows navigate by canonical spelling, so "am I already here?" is usually
    // answerable before asking the worker anything.
    if (reenterCurrentView("word:" + target) ||
        reenterCurrentView("char:" + target)) return;

    var seq = requestSeq;
    fetchLookup(target).then(function (response) {
      if (seq !== requestSeq) return;                 // dismissed or superseded
      if (!response || response.ok !== true) return;  // keep the current view
      var list = usableMatches(response.matches);
      if (!list.length) return;
      // Authoritative check: a variant surface (学生) only resolves to its
      // canonical key once the worker has answered.
      var key = viewKey(list);
      if (reenterCurrentView(key)) return;
      pushView({
        key: key, label: viewLabel(list, target), matches: list,
        srcText: target                 // this view was looked up from the row
      });
    });
  }

  // Swap the visible spelling. The body and parts update instantly; char cards
  // follow as soon as their data is known (usually already cached).
  function selectSpelling(state, index) {
    if (index === state.index || index < 0 || index >= state.items.length) return;
    state.index = index;
    syncWordCard(state);
    renderCharRegions();
    refreshLayout();

    var needed = uniqStrings(asArray(state.items[index].chars)).filter(function (ch) {
      return !charDataIndex[ch];
    });
    if (!needed.length) return;

    // Snapshot the view token: dismissing the popup or making a new selection
    // bumps it and cancels this swap.
    var seq = requestSeq;
    Promise.all(needed.map(fetchLookup)).then(function (responses) {
      if (seq !== requestSeq) return;
      var before = Object.keys(charDataIndex).length;
      responses.forEach(function (response) {
        if (!response || response.ok !== true) return;
        adoptCharData(response.matches);
      });
      if (Object.keys(charDataIndex).length === before) return; // nothing new
      if (state.index !== index) return;                        // another chip won
      syncWordCard(state);
      renderCharRegions();
      refreshLayout();
    });
  }

  /* ------------------------------------------------------------------ *
   * Positioning
   * ------------------------------------------------------------------ */

  // rect is in viewport coordinates (position: fixed uses the same frame).
  function positionAt(rect) {
    var doc = document.documentElement;
    var vw = (doc && doc.clientWidth) || window.innerWidth || 0;
    var vh = (doc && doc.clientHeight) || window.innerHeight || 0;

    var size = panel.getBoundingClientRect();
    var w = size.width || 340;
    var h = size.height || 0;

    // Vertical: below by default, flip above when it would overflow the bottom.
    var top = rect.bottom + GAP;
    if (top + h > vh - VIEWPORT_MARGIN) {
      var above = rect.top - GAP - h;
      top = above >= VIEWPORT_MARGIN ? above : vh - VIEWPORT_MARGIN - h;
    }
    // Final clamp: the anchor rect can itself sit outside the viewport (e.g. a
    // selection left over from before a programmatic scroll), so never let the
    // popup escape. When it is taller than the viewport, pin to the top.
    if (top + h > vh - VIEWPORT_MARGIN) top = vh - VIEWPORT_MARGIN - h;
    if (top < VIEWPORT_MARGIN) top = VIEWPORT_MARGIN;

    // Horizontal: left-align to the selection, clamped to the viewport.
    var left = rect.left;
    if (left + w > vw - VIEWPORT_MARGIN) left = vw - VIEWPORT_MARGIN - w;
    if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;

    host.style.setProperty("left", Math.round(left) + "px", "important");
    host.style.setProperty("top", Math.round(top) + "px", "important");
  }

  // Re-anchor after the content (and therefore the height) changed in place —
  // spelling swap, drill-down, crumb jump. Keeps the popup glued to the
  // original selection throughout the whole descent.
  function reposition() {
    if (!visible || !anchorRect) return;
    positionAt(anchorRect);
  }

  function showAt(rect, matches, srcText) {
    ensureHost();
    var list = usableMatches(matches);
    resetSession();
    viewStack = [{
      key: viewKey(list), label: viewLabel(list, ""), matches: list,
      // The selection itself: the root view is the one place a highlighted
      // variant glyph is guaranteed to belong.
      srcText: viewSourceText(list, srcText),
      scrollTop: 0, selection: null
    }];
    var count = renderCurrentView();
    if (!count) {
      hide();
      return false;
    }
    anchorRect = rect;
    // Make it measurable but not visible, measure, place, then reveal.
    host.style.setProperty("visibility", "hidden", "important");
    host.style.setProperty("display", "block", "important");
    host.style.setProperty("left", "0px", "important");
    host.style.setProperty("top", "0px", "important");
    // Clamp overflow and scrollTop both need the popup to have layout.
    syncClamps();
    applyPendingScroll();
    positionAt(rect);
    host.style.setProperty("visibility", "visible", "important");
    visible = true;
    return true;
  }

  /* ------------------------------------------------------------------ *
   * Selection handling
   * ------------------------------------------------------------------ */

  var lastPointer = null; // fallback anchor when the range has no usable rect

  function selectionRect(range) {
    var rect = range.getBoundingClientRect();
    if (rect && (rect.width > 0 || rect.height > 0)) return rect;
    var rects = range.getClientRects();
    if (rects && rects.length) {
      for (var i = 0; i < rects.length; i++) {
        if (rects[i].width > 0 || rects[i].height > 0) return rects[i];
      }
    }
    if (lastPointer) {
      return {
        left: lastPointer.x, right: lastPointer.x,
        top: lastPointer.y, bottom: lastPointer.y,
        width: 0, height: 0
      };
    }
    return null;
  }

  function readSelection() {
    var sel;
    try {
      sel = window.getSelection();
    } catch (e) {
      return null;
    }
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    var text = String(sel.toString()).trim();
    if (!text) return null;
    if (text.length > MAX_SELECTION_CHARS) return null;
    if (!HAN_RE.test(text) && !HANGUL_RE.test(text)) return null;
    var range;
    try {
      range = sel.getRangeAt(0);
    } catch (e2) {
      return null;
    }
    var rect = selectionRect(range);
    if (!rect) return null;
    return { text: text, rect: rect };
  }

  function sendToWorker(payload) {
    return new Promise(function (resolve) {
      var settled = false;
      function done(value) {
        if (settled) return;
        settled = true;
        resolve(value);
      }
      var maybePromise;
      try {
        // Callback form works in both MV3 and the test stub; when a callback is
        // supplied Chrome returns undefined rather than a promise.
        maybePromise = RUNTIME.sendMessage(payload, function (response) {
          // Reading lastError clears the "Unchecked runtime.lastError" warning
          // that appears when no receiver is registered yet.
          if (HAS_CHROME_RUNTIME && globalThis.chrome.runtime.lastError) {
            done(null);
            return;
          }
          done(response || null);
        });
      } catch (e) {
        // "Extension context invalidated" (reload/update) and friends.
        done(null);
        return;
      }
      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.then(function (response) { done(response || null); }, function () { done(null); });
      }
    });
  }

  function sendLookup(text) {
    return sendToWorker({ type: "lookup", text: text });
  }

  // The char's COMPLETE compound index, joined by the service worker. Fetched
  // at most once per character per popup session; a failure resolves to null
  // and is NOT cached, so the control can simply be pressed again.
  function fetchCompounds(char) {
    if (compoundsCache && Object.prototype.hasOwnProperty.call(compoundsCache, char)) {
      return Promise.resolve(compoundsCache[char]);
    }
    if (compoundsPending && compoundsPending[char]) return compoundsPending[char];
    var promise = sendToWorker({ type: "compounds", char: char }).then(function (response) {
      if (compoundsPending) delete compoundsPending[char];
      if (!response || response.ok !== true || !Array.isArray(response.compounds)) return null;
      var list = response.compounds.filter(function (c) {
        return c && typeof c === "object";
      });
      if (compoundsCache) compoundsCache[char] = list;
      return list;
    });
    if (compoundsPending) compoundsPending[char] = promise;
    return promise;
  }

  // The larger words containing this one. Same caching contract as the
  // compound index: one request per word per popup session, failures resolve
  // to null and are not cached so the disclosure row can simply be re-pressed.
  function fetchUsedIn(word) {
    if (usedInCache && Object.prototype.hasOwnProperty.call(usedInCache, word)) {
      return Promise.resolve(usedInCache[word]);
    }
    if (usedInPending && usedInPending[word]) return usedInPending[word];
    var promise = sendToWorker({ type: "usedIn", word: word }).then(function (response) {
      if (usedInPending) delete usedInPending[word];
      if (!response || response.ok !== true || !Array.isArray(response.words)) return null;
      var list = response.words.filter(function (w) {
        return w && typeof w === "object";
      });
      if (usedInCache) usedInCache[word] = list;
      return list;
    });
    if (usedInPending) usedInPending[word] = promise;
    return promise;
  }

  function handleSelection() {
    var sel = readSelection();
    if (!sel) {
      hide();
      return;
    }
    var seq = ++requestSeq;
    sendLookup(sel.text).then(function (response) {
      if (seq !== requestSeq) return; // superseded by a newer selection
      if (!response || response.ok !== true || !asArray(response.matches).length) {
        hide();
        return;
      }
      // Re-read the rect: layout may have shifted while awaiting the response.
      var fresh = readSelection();
      showAt(fresh && fresh.text === sel.text ? fresh.rect : sel.rect,
        response.matches, sel.text);
      // Seed the cache so drilling back into the original text is free.
      if (lookupCache) lookupCache[sel.text] = response;
    });
  }

  /* ------------------------------------------------------------------ *
   * Events (all capture-phase so page handlers can't suppress them)
   * ------------------------------------------------------------------ */

  var SELECTION_KEYS = {
    ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1,
    Home: 1, End: 1, PageUp: 1, PageDown: 1
  };

  window.addEventListener("mousedown", function (e) {
    if (eventInsidePopup(e)) return; // clicks inside must not dismiss
    if (visible) hide();
  }, true);

  window.addEventListener("mouseup", function (e) {
    if (eventInsidePopup(e)) return; // mouseup inside the popup: ignore entirely
    lastPointer = { x: e.clientX, y: e.clientY };
    // Let the browser finish updating the selection first.
    setTimeout(handleSelection, 0);
  }, true);

  window.addEventListener("keyup", function (e) {
    if (eventInsidePopup(e)) return;
    var isSelectAll = (e.key === "a" || e.key === "A") && (e.ctrlKey || e.metaKey);
    // Escape is handled on keydown; ignoring it here stops the popup from
    // immediately reopening on the matching keyup.
    if (!SELECTION_KEYS[e.key] && !isSelectAll) return;
    setTimeout(handleSelection, 0);
  }, true);

  window.addEventListener("keydown", function (e) {
    if (e.key === "Escape" || e.key === "Esc") hide();
  }, true);

  // Capture phase catches scrolls in any scroller, not just the document.
  window.addEventListener("scroll", function (e) {
    if (!visible) return;
    if (eventInsidePopup(e)) return; // scrolling the popup's own list is fine
    hide();
  }, true);

  window.addEventListener("resize", function () {
    if (visible) hide();
  }, true);

  window.addEventListener("pagehide", hide, true);

  /* ------------------------------------------------------------------ *
   * Test hooks — only exposed when running outside the extension.
   * ------------------------------------------------------------------ */

  if (IS_STUB) {
    var testDragOrigin = { x: 0, y: 0 };
    globalThis.__hanjaHover = {
      showAt: function (rect, matches, srcText) {
        ensureHost();
        return showAt(rect, matches, srcText);
      },
      // The badge registry itself, so a check can prove a NEW badge needs
      // nothing but an entry (the harness registers a dummy and removes it).
      badgeRegistry: BADGES,
      hide: hide,
      handleSelection: handleSelection,
      readSelection: readSelection,
      formatEumhun: formatEumhun,
      isVisible: function () { return visible; },
      hostRect: function () { ensureHost(); return host.getBoundingClientRect(); },
      panelText: function () { ensureHost(); return panel.textContent; },
      panelStyle: function (prop) {
        ensureHost();
        return getComputedStyle(panel).getPropertyValue(prop);
      },
      cardCount: function () { ensureHost(); return panel.querySelectorAll(".card").length; },
      // Reach into the closed shadow root so tests can click rows and chips.
      query: function (sel) { ensureHost(); return panel.querySelector(sel); },
      queryAll: function (sel) {
        ensureHost();
        return Array.prototype.slice.call(panel.querySelectorAll(sel));
      },
      viewDepth: function () { return viewStack.length; },
      viewKeys: function () {
        return viewStack.map(function (v) { return v.key; });
      },
      crumbLabels: function () {
        ensureHost();
        return Array.prototype.slice.call(panel.querySelectorAll(".crumb, .crumb-gap"))
          .map(function (c) { return c.textContent; });
      },
      scrollTop: function (v) {
        ensureHost();
        if (typeof v === "number") panel.scrollTop = v;
        return panel.scrollTop;
      },
      // --- resize ---
      panelSize: function () {
        ensureHost();
        var box = panel.getBoundingClientRect();
        return { width: box.width, height: box.height };
      },
      isUserSized: function () { return userSized; },
      // Readable while the popup is hidden, unlike getBoundingClientRect.
      panelInlineSize: function () {
        ensureHost();
        return { width: panel.style.width, height: panel.style.height };
      },
      // Simulates a drag: take the panel over, set a size, then run the same
      // settle path the debounced ResizeObserver uses.
      resizePanel: function (w, h) {
        ensureHost();
        beginUserResize();
        panel.style.setProperty("width", w + "px");
        panel.style.setProperty("height", h + "px");
        settleResize();
        var box = panel.getBoundingClientRect();
        return { width: box.width, height: box.height };
      },
      // Test-only: hands the panel back to the stylesheet. There is no
      // in-product reset in stage 1 (a page reload is the reset), but the
      // self-check suite has to start every run from the default size.
      resetPanelSize: function () {
        ensureHost();
        userSized = false;
        ["width", "height", "min-width", "min-height", "max-width", "max-height"]
          .forEach(function (prop) { panel.style.removeProperty(prop); });
        lastPanelW = 0;
        lastPanelH = 0;
        return { width: panel.style.width, height: panel.style.height };
      },
      // Drives the real handlers with real events: press in the corner, then
      // move to each [dx, dy] offset FROM THE PRESS POINT. Pass continue=true
      // to keep the current gesture going instead of starting a new one.
      dragResize: function (x, y, steps, keepGoing) {
        ensureHost();
        if (!keepGoing) {
          testDragOrigin = { x: x, y: y };
          panel.dispatchEvent(new MouseEvent("mousedown", {
            bubbles: true, composed: true, cancelable: true,
            button: 0, clientX: x, clientY: y
          }));
        }
        (steps || []).forEach(function (step) {
          window.dispatchEvent(new MouseEvent("mousemove", {
            bubbles: true, composed: true, cancelable: true,
            clientX: testDragOrigin.x + step[0], clientY: testDragOrigin.y + step[1]
          }));
        });
        var box = panel.getBoundingClientRect();
        return { width: box.width, height: box.height };
      },
      endDragResize: function () {
        window.dispatchEvent(new MouseEvent("mouseup", {
          bubbles: true, composed: true, cancelable: true
        }));
      },
      resizeCorner: function () {
        ensureHost();
        var box = panel.getBoundingClientRect();
        return { x: box.right - 4, y: box.bottom - 4 };
      },
      isResizing: function () { return resizing; }
    };
  }
})();

