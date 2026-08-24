/*
 * Etymikon, content script (Agent C)
 *
 * Selection-triggered popup. Listens for mouseup/keyup, checks the current
 * selection for an English word, asks the service worker for a lookup, and
 * renders the result in a closed shadow root anchored to the selection rect.
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
    var WORD = {
      kind: "word", surface: "subterranean", canonical: "subterranean",
      senses: [{ pos: "adj", defs: ["Below the ground; underground."] }],
      fr: 61254, tier: "rare",
      morphs: [
        { f: "sub-", r: "en:sub-", gloss: "under, beneath" },
        { f: "terra", r: "la:terra", gloss: "earth, land" },
        { f: "-an", r: "en:-an", gloss: "forming adjectives" }
      ]
    };
    var FAMILY = [
      { word: "terrain", def: "An area of land.", fr: 4712, tier: "common" },
      { word: "subterranean", def: "Below the ground; underground.",
        fr: 61254, tier: "rare" }
    ];
    var ROOT = {
      key: "la:terra", form: "terra", lang: "la", gloss: "earth, land",
      kind: "root", familyCount: FAMILY.length, family: FAMILY
    };
    function respond(msg) {
      if (msg && msg.type === "root") {
        return { ok: true, root: msg.key === ROOT.key ? ROOT : null };
      }
      if (msg && msg.type === "family") {
        var rows = msg.key === ROOT.key ? FAMILY : [];
        return { ok: true, rows: rows, total: rows.length, offset: 0 };
      }
      var text = String((msg && msg.text) || "").toLowerCase();
      if (text.indexOf("subterranean") >= 0) {
        return { ok: true, matches: [WORD] };
      }
      return { ok: true, matches: [] };
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
   * Embed mode
   *
   * A host page (the search popup page, or its test harness) sets
   * `globalThis.__okpyeonEmbed = true` BEFORE this script runs. The popup is
   * then a component of that page rather than an overlay on someone else's:
   * no selection/dismissal listeners, no floating anchor, no resize handle —
   * the host supplies a container through globalThis.__okpyeonEmbedApi.
   *
   * This gate is ORTHOGONAL to IS_STUB: an extension popup page has a real
   * chrome.runtime (IS_STUB false, IS_EMBED true), and the embed test harness
   * has neither (both true).
   * ------------------------------------------------------------------ */

  var IS_EMBED = globalThis.__okpyeonEmbed === true;

  /* ------------------------------------------------------------------ *
   * Constants
   * ------------------------------------------------------------------ */

  // A selection is worth a lookup once it holds a letter. The worker extracts
  // the first token itself, so anything past that is its business.
  var WORD_RE = /[A-Za-z]/;
  var MAX_SELECTION_CHARS = 40;
  var MAX_FAMILY = 8;   // family rows a root card shows inline
  var FAMILY_PAGE = 5;  // family rows revealed per press of "Show 5 more"
  // (The trail once capped at a fixed depth of 3. It elides by WIDTH now —
  //  see fitCrumbs — so there is no depth constant left to tune.)
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
  var FLASH_MS = 600;        // orientation flash when a click lands on this view
  // Word tiers. The data ships a frequency RANK and never a tier; the worker
  // derives one and joins it onto every word match and family row, so the
  // cutoffs live in exactly one place and this file never sees a rank. Roots
  // carry no tier, so a root card renders no chip by construction.
  var TIER_ORDER = ["everyday", "common", "advanced", "rare"];
  var TIER_LABEL = {
    everyday: "Everyday",
    common: "Common",
    advanced: "Advanced",
    rare: "Rare"
  };
  // The Rare title names Etymikon as the classifier on purpose: the boundary
  // is our own cutoff over one corpus, and the tooltip should say so.
  var TIER_TITLE = {
    everyday: "Rank in the 3,000 most frequent English words " +
      "(OpenSubtitles corpus)",
    common: "Rank 3,001 to 15,000 by frequency",
    advanced: "Rank 15,001 to 50,000 by frequency",
    rare: "Beyond the 50,000 most frequent words, or unranked " +
      "(Etymikon's classification)"
  };
  // Language names, for the root label line and the quiet origin rows.
  var LANG_NAME = { la: "Latin", grc: "Greek", en: "English" };
  // The Wiktionary section a root's own language lives under.
  var LANG_ANCHOR = { la: "Latin", grc: "Ancient_Greek", en: "English" };
  var SCROLL_SETTLE_MS = 700; // smooth-scroll watchdog (see scrollPanelTo)

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
    "  --quiet: #f6f6f9;",
    "  --hover: #eef1f8;",
    "  --shadow: 0 8px 28px rgba(0, 0, 0, 0.18), 0 1px 3px rgba(0, 0, 0, 0.12);",
    "  --scroll: rgba(0, 0, 0, 0.22);",
    "  --grip: rgba(0, 0, 0, 0.3);",
    "  --flash: rgba(47, 87, 201, 0.16);",
    /* Tier-chip tints. Quiet enough to sit beside a headword without
       competing with it. The two frequent zones carry more saturation and a
       stronger edge than advanced and rare, since those are the ones a reader
       scans for. Rare is deliberately the flattest: it is information, not a
       warning. */
    "  --tier-everyday-bg: #e2f1e9; --tier-everyday-fg: #1f6b4d;",
    "  --tier-everyday-edge: rgba(31, 107, 77, 0.26);",
    "  --tier-common-bg: #e5ecfb; --tier-common-fg: #2a4ea6;",
    "  --tier-common-edge: rgba(42, 78, 166, 0.26);",
    "  --tier-advanced-bg: #fbf1de; --tier-advanced-fg: #8a5810;",
    "  --tier-advanced-edge: rgba(138, 88, 16, 0.20);",
    "  --tier-rare-bg: #f0f0f3; --tier-rare-fg: #74747e;",
    "  --tier-rare-edge: rgba(0, 0, 0, 0.10);",
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
    "    'Helvetica Neue', Arial, sans-serif;",
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
    "    --quiet: rgba(255, 255, 255, 0.035);",
    "    --hover: #2e2e38;",
    "    --shadow: 0 8px 28px rgba(0, 0, 0, 0.55), 0 1px 3px rgba(0, 0, 0, 0.4);",
    "    --scroll: rgba(255, 255, 255, 0.24);",
    "    --grip: rgba(255, 255, 255, 0.34);",
    "    --flash: rgba(150, 180, 255, 0.2);",
    /* Dark: the light tints go muddy on #23232a, so the fills become low-alpha
       washes of the same hue and the text carries the colour instead. */
    "    --tier-everyday-bg: rgba(88, 190, 148, 0.15);",
    "    --tier-everyday-fg: #7fd2ab; --tier-everyday-edge: rgba(127, 210, 171, 0.30);",
    "    --tier-common-bg: rgba(120, 160, 255, 0.15);",
    "    --tier-common-fg: #9fbcff; --tier-common-edge: rgba(159, 188, 255, 0.30);",
    "    --tier-advanced-bg: rgba(230, 170, 70, 0.13);",
    "    --tier-advanced-fg: #e0b271; --tier-advanced-edge: rgba(224, 178, 113, 0.24);",
    "    --tier-rare-bg: rgba(255, 255, 255, 0.06);",
    "    --tier-rare-fg: #9a9aa4; --tier-rare-edge: rgba(255, 255, 255, 0.13);",
    "  }",
    "}",
    /* ---- embed mode: in-flow, flat, and NOT a scroll container ----
     * The popup page's results area is the one and only scroller, so the
     * panel gives up overflow (no nested scrollbars) and its own size caps.
     * `resize: none` is cosmetic here — installResize() is skipped in embed,
     * so there is no drag gesture to suppress. The card chrome (border,
     * radius, shadow) goes too: in-flow, it should read as part of the page,
     * not as a floating card sitting on it. */
    ".panel.embed {",
    "  width: 100%;",
    "  max-height: none;",
    "  height: auto;",
    "  overflow: visible;",
    "  resize: none;",
    "  border: none;",
    "  box-shadow: none;",
    "  border-radius: 0;",
    "}",
    /* ---- view container: the unit that swaps on navigation ---- */
    "@keyframes hh-view-in { from { opacity: 0; } to { opacity: 1; } }",
    ".view { animation: hh-view-in 120ms ease-out; }",
    "@media (prefers-reduced-motion: reduce) { .view { animation: none; } }",
    /* ---- cards: one per match, word cards and root cards alike ---- */
    ".view > .card { padding: 10px 12px 11px; }",
    ".view > .card + .card { border-top: 1px solid var(--rule); }",
    // `position: relative` exists for one reason: the save bubble anchors to
    // the star, and the star lives here.
    ".head { display: flex; align-items: baseline; gap: 9px; position: relative; }",
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
    /* ---- root heads: the romanization beside the form, and the label line ---- */
    // The Greek form is the headword; the romanization is a reading aid, so it
    // sits beside it in the muted colour and at body size.
    ".rom { font-size: 14px; font-weight: 500; color: var(--muted); }",
    ".rootlabel { font-size: 12px; font-weight: 600; color: var(--muted); }",
    // The inflection note: "territories → territory", in the head meta box.
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
    /* ---- Wiktionary link: top-right corner of every word / root card ---- */
    // Lives as the last child of .head so it can never collide with the tier
    // chip or the label line beside the headword: the head is a flex row and
    // the link is its trailing item.
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
    /* ---- save star: the card action that sits beside the Wiktionary link ---- */
    // Both trailing items carry `margin-left: auto`; the star absorbs the free
    // space, so the pair ends up flush right with the head's own gap between
    // them (the link drops its own padding once a star precedes it).
    ".save {",
    "  flex: 0 0 auto; align-self: flex-start; margin-left: auto;",
    "  font: inherit; font-size: 15px; line-height: 1.35;",
    "  padding: 0 3px; margin-top: -1px; border: 0; border-radius: 4px;",
    "  background: transparent; color: var(--muted); cursor: pointer;",
    "}",
    ".save + .wiki { margin-left: 0; padding-left: 0; }",
    ".save:hover { background: var(--hover); color: var(--accent); }",
    ".save:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }",
    ".save--on { color: var(--accent); }",
    // Until a savedCheck answers, the star has no state to show — and a star
    // that guesses would either lie or flip under the reader on every render.
    // It keeps its BOX, though, hiding with visibility rather than display:
    // the answer arrives a tick after the cards are laid out, and a head that
    // changed width on it would reflow every card. Under a restored scroll
    // offset (crumb-back into a scrolled parent) Chrome's scroll anchoring
    // then slides the reader to a position they never scrolled to.
    ".save--unknown { visibility: hidden; }",
    /* ---- save bubble: the confirmation anchored to a star that just saved ---- */
    ".savebubble {",
    "  position: absolute; top: 100%; right: 0; z-index: 3;",
    "  margin-top: 3px; padding: 8px 10px 9px; min-width: 168px;",
    "  background: var(--bg); border: 1px solid var(--edge); border-radius: 8px;",
    "  box-shadow: var(--shadow);",
    "  font-size: 12px; line-height: 1.4; color: var(--fg); text-align: left;",
    "}",
    ".savebubble-title {",
    "  display: block; margin-bottom: 5px; font-size: 11px; font-weight: 700;",
    "  letter-spacing: 0.05em; text-transform: uppercase; color: var(--faint);",
    "}",
    ".savebubble-folder, .savebubble-name {",
    "  width: 100%; font: inherit; font-size: 12px; color: var(--fg);",
    "  background: var(--bg); border: 1px solid var(--edge); border-radius: 5px;",
    "  padding: 2px 4px;",
    "}",
    ".savebubble-controls { display: flex; gap: 6px; margin-top: 6px; }",
    ".savebubble-create, .savebubble-cancel {",
    "  flex: 0 0 auto; font: inherit; font-size: 11px; font-weight: 600;",
    "  padding: 2px 8px; border: 1px solid var(--edge); border-radius: 5px;",
    "  background: var(--chip-bg); color: var(--fg); cursor: pointer;",
    "}",
    ".savebubble-create { border-color: var(--accent); color: var(--accent); }",
    ".savebubble-create:hover, .savebubble-cancel:hover { background: var(--hover); }",
    ".savebubble-create:focus-visible, .savebubble-cancel:focus-visible {",
    "  outline: 2px solid var(--accent); outline-offset: 1px;",
    "}",
    // Empty until the worker refuses a name, so it takes no space until then.
    ".savebubble-error:not(:empty) {",
    "  margin-top: 5px; font-size: 11px; color: var(--hedge-fg);",
    "}",
    ".savebubble-remove {",
    "  display: inline-block; margin: 7px 0 0; padding: 0; border: 0;",
    "  background: transparent; font: inherit; font-size: 11px; font-weight: 600;",
    "  color: var(--accent); text-decoration: underline; cursor: pointer;",
    "}",
    ".savebubble-remove:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }",
    /* ---- the breakdown: morpheme chips joined by plus signs ---- */
    // A chip is two lines: the form the reader sees in the word, and the root
    // gloss under it. Baseline alignment is wrong for a two-line chip, so the
    // row aligns on the top edge and the plus signs are centred by hand.
    ".morphs { display: flex; flex-wrap: wrap; align-items: stretch; gap: 4px;",
    "  margin-top: 3px; }",
    ".morph {",
    "  display: inline-flex; flex-direction: column; gap: 1px;",
    "  padding: 3px 8px 4px; border-radius: 8px;",
    "  background: var(--chip-bg); border: 1px solid var(--chip-edge);",
    "}",
    ".morph-form { font-size: 13px; font-weight: 600; color: var(--fg);",
    "  white-space: nowrap; }",
    ".morph-gloss { font-size: 10px; line-height: 1.3; color: var(--muted); }",
    // Chips that open a root card carry hover and a pointer. A chevron would
    // crowd a row of three or four chips, so the pill itself is the affordance.
    ".morph.nav { cursor: pointer; }",
    ".morph.nav:hover { background: var(--hover); border-color: var(--accent); }",
    ".morph.nav:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }",
    // A morpheme with no card of its own is inert: no pointer, no hover, no
    // focus ring. Nothing about it may suggest it goes somewhere.
    ".morph.inert { background: transparent; border-color: var(--rule); }",
    ".morph-plus { align-self: center; color: var(--faint); font-size: 12px; }",
    // Orientation flash on the card a click points at: the card is already on
    // screen, so this beats pushing a duplicate view.
    "@keyframes hh-flash { from { background-color: var(--flash); }",
    "  to { background-color: transparent; } }",
    ".flash { animation: hh-flash " + FLASH_MS + "ms ease-out; border-radius: 7px; }",
    "@media (prefers-reduced-motion: reduce) { .flash { animation: none; } }",
    ".label {",
    "  margin-top: 9px; font-size: 10px; font-weight: 700;",
    "  letter-spacing: 0.07em; text-transform: uppercase; color: var(--faint);",
    "}",
    // The part-of-speech label heads its own sense list, so it sits closer to
    // the senses under it than a section label does to its section.
    ".label.pos { margin-top: 8px; }",
    ".label.pos + .glosses { margin-top: 2px; }",
    /* ---- rows: the family list and the quiet origin lines ---- */
    // The negative side margins let a row's hover background bleed into the
    // card padding, so the row text still lines up with the label above.
    ".family { margin-top: 2px; margin-left: -6px; margin-right: -6px; }",
    // .entry-row is shared by family rows and the quiet origin/source rows.
    ".entry-row {",
    "  display: flex; align-items: baseline; gap: 6px;",
    "  padding: 2px 6px; border-radius: 6px;",
    "}",
    ".entry-row > .clampwrap { flex: 1 1 auto; min-width: 0; }",
    ".entry-row.nav { cursor: pointer; }",
    ".fam-text { overflow-wrap: anywhere; }",
    ".fam-word { font-weight: 600; color: var(--fg); }",
    ".fam-def { color: var(--fg-soft); }",
    ".fam-more {",
    "  display: inline-block; font: inherit; font-size: 12px; font-weight: 600;",
    "  line-height: 1.3; margin: 5px 0 0; padding: 3px 9px; border-radius: 6px;",
    "  background: var(--chip-bg); border: 1px solid var(--chip-edge);",
    "  color: var(--accent); cursor: pointer; white-space: nowrap;",
    "}",
    ".fam-more:hover { background: var(--hover); }",
    ".fam-more:disabled { opacity: 0.55; cursor: default; }",
    ".fam-more:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }",
    /* ---- origin and source: one quiet nav row naming where a word came from ---- */
    // Deliberately understated: it is a pointer to the root card, not a
    // section of its own, so it reads as one line at the end of the card.
    ".origin-row {",
    "  margin: 9px -6px 0; padding: 4px 6px;",
    "  color: var(--muted); font-size: 12px;",
    "}",
    ".origin-row b { font-weight: 600; color: var(--fg-soft); }",
    /* ---- tier chips ---- */
    // Same quiet register everywhere it appears: beside a headword, and at the
    // end of a family row. The base look is the neutral default for any FUTURE
    // non-tier badge; the four tier rules below only re-tint it.
    ".tier-chip {",
    "  display: inline-block; margin-left: 6px; padding: 0 4px;",
    "  border-radius: 4px; vertical-align: 2px;",
    "  font-size: 9px; font-weight: 700; letter-spacing: 0.04em;",
    "  line-height: 1.6; white-space: nowrap;",
    "  color: var(--faint); background: var(--chip-bg);",
    "  border: 1px solid var(--chip-edge);",
    "}",
    // Registry badges sit side by side when more than one applies.
    ".tier-chip + .tier-chip { margin-left: 4px; }",
    ".tier-chip--everyday { color: var(--tier-everyday-fg);",
    "  background: var(--tier-everyday-bg); border-color: var(--tier-everyday-edge); }",
    ".tier-chip--common { color: var(--tier-common-fg);",
    "  background: var(--tier-common-bg); border-color: var(--tier-common-edge); }",
    ".tier-chip--advanced { color: var(--tier-advanced-fg);",
    "  background: var(--tier-advanced-bg); border-color: var(--tier-advanced-edge); }",
    ".tier-chip--rare { color: var(--tier-rare-fg);",
    "  background: var(--tier-rare-bg); border-color: var(--tier-rare-edge); }",
    /* ---- shared affordance for navigable rows ---- */
    ".entry-row.nav:hover { background: var(--hover); }",
    ".entry-row.nav:focus-visible {",
    "  outline: 2px solid var(--accent); outline-offset: -2px;",
    "}",
    ".entry-row.nav::after {",
    "  content: '\\203A'; margin-left: auto; padding-left: 8px;",
    "  align-self: center; color: var(--faint); font-size: 15px; line-height: 1;",
    "  flex: 0 0 auto;",
    "}",
    ".entry-row.nav:hover::after { color: var(--accent); }",
    /* ---- breadcrumb trail (one nav bar for every drill-down) ---- */
    ".crumbs {",
    "  position: sticky; top: 0; z-index: 2;",
    "  display: flex; align-items: center; flex-wrap: nowrap; gap: 2px;",
    "  padding: 6px 10px; background: var(--bg);",
    "  border-bottom: 1px solid var(--rule);",
    "  font-size: 12px; overflow: hidden;",
    "}",
    // `flex: 0 0 auto` is load-bearing for the width-based truncation below:
    // a shrinkable crumb would squeeze instead of overflowing, so the row
    // could never report that it had run out of space.
    ".crumb {",
    "  flex: 0 0 auto;",
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

  // Embed mode: the host is an in-flow block inside the page's own results
  // container, so it drops the fixed-position anchor, the coordinates and the
  // stacking context. `display` is still toggled by showAt/hide.
  var EMBED_HOST_STYLE = {
    position: "static",
    margin: "0",
    padding: "0",
    border: "0",
    width: "100%",
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
  var embedContainer = null;  // embed mode only: the page element the host lives in

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
  var rootCache = null;       // root key -> root object (one request each)
  var rootPending = null;     // root key -> in-flight promise, so two chips share it
  var familyCache = null;     // root key -> the full ranked family list
  var familyPending = null;   // root key -> in-flight promise
  var crumbsExpanded = false; // a pressed "…" shows the whole trail until nav
  var viewStack = [];         // the descent; last entry is the current view
  var currentSrcText = "";    // source text of the view being rendered (see noteApplies)

  function ensureHost() {
    if (host && host.isConnected) return;
    if (!host) {
      host = document.createElement("div");
      host.setAttribute("data-etymikon", "");
      var hostStyle = IS_EMBED ? EMBED_HOST_STYLE : HOST_STYLE;
      for (var prop in hostStyle) {
        if (Object.prototype.hasOwnProperty.call(hostStyle, prop)) {
          host.style.setProperty(prop, hostStyle[prop], "important");
        }
      }
      shadow = host.attachShadow({ mode: "closed" });
      var style = document.createElement("style");
      // Static stylesheet string only — never page or dictionary data.
      style.textContent = CSS;
      shadow.appendChild(style);
      panel = document.createElement("div");
      panel.className = "panel";
      // Flat, full-width, non-scrolling variant (see the .panel.embed rule).
      if (IS_EMBED) panel.classList.add("embed");
      shadow.appendChild(panel);
      // The resize gesture is deliberately NOT installed in embed: its corner
      // hit-test is geometric, so `resize: none` alone would leave an
      // invisible drag trap in the bottom-right of the results area.
      if (!IS_EMBED) installResize();
    }
    if (IS_EMBED) {
      // No container yet means mount() has not run; the host simply stays
      // detached until it does.
      if (embedContainer) embedContainer.appendChild(host);
      return;
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
    // A narrower row may no longer hold the whole trail, and a wider one may
    // hold more of it than it did a moment ago.
    fitCrumbs();
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
    rootCache = Object.create(null);
    rootPending = Object.create(null);
    familyCache = Object.create(null);
    familyPending = Object.create(null);
    crumbsExpanded = false;
    viewStack = [];
    pendingScrollTop = null;
  }

  function hide() {
    requestSeq++; // invalidate any in-flight response (incl. spelling swaps)
    closeSaveBubble();
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

  function usableMatches(matches) {
    return asArray(matches).filter(function (m) {
      return m && typeof m === "object";
    });
  }

  // What a match is ABOUT: the lemma for a word, the root key for a root.
  function matchKey(m) {
    if (!m || typeof m !== "object") return "";
    if (m.kind === "root") return nonEmptyString(m.key);
    return nonEmptyString(m.canonical) || nonEmptyString(m.surface);
  }

  // The root object a root match carries. Kept in its own slot because the
  // root's own `kind` ("prefix" / "suffix" / "root") is not the match kind.
  function rootOf(m) {
    return m && typeof m.root === "object" && m.root ? m.root : {};
  }

  // A plain-English language name from a root key or a lang code.
  function langName(lang) {
    return LANG_NAME[nonEmptyString(lang)] || "";
  }

  // "la:terra" -> {lang: "la", form: "terra"}. Root keys are the only place
  // this shape appears, and `src` gives us one with no card attached.
  function splitRootKey(key) {
    var text = nonEmptyString(key);
    var cut = text.indexOf(":");
    if (cut < 0) return { lang: "", form: text };
    return { lang: text.slice(0, cut), form: text.slice(cut + 1) };
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
      // A caseless script uppercases to itself, so leave it alone.
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

  /* ---- Card sections ---------------------------------------------------- *
   * Settings reach every section's enabled-predicate through this one
   * accessor. It returns null until the first real toggle ships, and a
   * predicate reads null as enabled, so populating it is the only plumbing
   * that toggle needs.
   * -------------------------------------------------------------------- */

  function sectionSettings() {
    return null;
  }

  // One numbered sense list with hanging indent; a lone sense needs no number.
  // Shared by the word card's POS sections and the root card's single gloss.
  function appendSenseList(parent, defs) {
    var list = asArray(defs).map(nonEmptyString).filter(Boolean);
    if (!list.length) return 0;
    var box = el("div", "glosses");
    if (list.length > 1) box.classList.add("numbered");
    list.forEach(function (text, i) {
      var row = el("div", "gloss");
      if (list.length > 1) row.appendChild(el("span", "gloss-num", (i + 1) + "."));
      row.appendChild(clampWrap(el("span", "gloss-text", capitalizeSense(text)), 2));
      box.appendChild(row);
    });
    parent.appendChild(box);
    return list.length;
  }

  // Part-of-speech tags come from the source as harvested. The four the reader
  // meets constantly get their full English name; anything else is shown as it
  // was harvested, uppercased.
  var POS_LABEL = {
    noun: "NOUN",
    verb: "VERB",
    adj: "ADJECTIVE",
    adv: "ADVERB"
  };

  function posLabel(pos) {
    var tag = nonEmptyString(pos);
    if (!tag) return "";
    return POS_LABEL[tag.toLowerCase()] || tag.toUpperCase();
  }

  // Does this text still need clamping? The question is always asked of the
  // CLAMPED state, even for expanded elements: an expanded element is
  // `overflow: visible` and would always measure as fitting, which is how a
  // "less" button used to survive the panel being widened until the text fit.
  // The class is dropped and restored inside one synchronous task, so the two
  // forced layouts never reach the screen — nothing flickers.
  function clampOverflows(body) {
    var expanded = body.classList.contains("expanded");
    if (expanded) body.classList.remove("expanded");
    var overflowing = body.scrollHeight > body.clientHeight + 1;
    if (expanded) body.classList.add("expanded");
    return overflowing;
  }

  // Expander state is GEOMETRY-DERIVED: every re-measure (resize, width
  // change, content growth) re-decides whether a control belongs here at all.
  // Text that now fits loses its control AND its expanded state — it renders
  // identically either way, so there is nothing left to toggle. Text that
  // still overflows keeps its control and the reader's current choice.
  function syncClamps() {
    if (!viewRoot) return;
    var wraps = viewRoot.querySelectorAll(".clampwrap");
    for (var i = 0; i < wraps.length; i++) {
      var wrap = wraps[i];
      var body = wrap.firstChild;
      if (!body || !body.classList || !body.classList.contains("clamp")) continue;
      var overflowing = clampOverflows(body);
      var button = wrap.querySelector(".more");
      if (!overflowing) {
        if (button) wrap.removeChild(button);
        // Reset, so re-narrowing starts from a fresh, collapsed clamp rather
        // than silently restoring an expansion the reader can no longer see.
        body.classList.remove("expanded");
        continue;
      }
      if (!button) wrap.appendChild(makeMoreButton(body));
      else syncMoreButton(button, body);
    }
  }

  // The label always states what the button will do next, read off the body.
  function syncMoreButton(button, body) {
    var expanded = body.classList.contains("expanded");
    var label = expanded ? "less" : "more";
    if (button.textContent !== label) button.textContent = label;
    button.setAttribute("aria-expanded", expanded ? "true" : "false");
  }

  function makeMoreButton(body) {
    var button = el("button", "more", "more");
    button.type = "button";
    syncMoreButton(button, body);
    button.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();   // never triggers navigation on a clickable row
      body.classList.toggle("expanded");
      syncMoreButton(button, body);
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
    fitCrumbs();
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
   * Word cards point at the lemma's English section. Root cards point at the
   * section of their own language: English affixes, Latin lemmas, Ancient
   * Greek lemmas.
   * -------------------------------------------------------------------- */

  var WIKI_BASE = "https://en.wiktionary.org/wiki/";
  var WIKI_DEFAULT_ANCHOR = "English";

  function wiktionaryUrl(title, anchor) {
    var t = nonEmptyString(title);
    if (!t) return "";
    return WIKI_BASE + encodeURIComponent(t) + "#" +
      (nonEmptyString(anchor) || WIKI_DEFAULT_ANCHOR);
  }

  var WIKI_IDLE_LABEL = "Wiktionary ↗";
  var WIKI_OPENED_LABEL = "Opened ↗";
  var WIKI_FLASH_MS = 1200;

  // Plain clicks never switch tabs, on ANY surface. Two reasons converge:
  // in an action popup, browser-level link activation dismisses the popup —
  // even middle-click-to-background-tab does — while an API-created background
  // tab does not (verified on real Chrome 2026-08-17); and a link that
  // silently stole focus was simply inconsistent between the two surfaces.
  //
  // The surfaces differ ONLY in transport. An extension page can call
  // chrome.tabs itself; a content script cannot, so it asks the worker, which
  // validates the url against the Wiktionary base before opening anything.
  // Decided once: IS_EMBED is fixed at load and chrome.tabs does not appear
  // later on a surface that lacks it.
  var WIKI_TABS_DIRECT =
    IS_EMBED &&
    typeof chrome !== "undefined" &&
    chrome.tabs &&
    typeof chrome.tabs.create === "function";

  // Appends the small top-right link to a card head. Clicks are isolated from
  // the popup's own click handling the same way the "more" expander does it.
  function appendWikiLink(head, title, anchor) {
    var url = wiktionaryUrl(title, anchor);
    if (!url) return null;
    var link = el("a", "wiki", WIKI_IDLE_LABEL);
    // The href/target/rel stay real: a MODIFIED click is still handled by the
    // browser, and the link must remain a link for middle-click-paste, "copy
    // link address", and assistive tech.
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label",
      "Wiktionary entry for " + title + " (opens in a new tab)");
    link.addEventListener("mousedown", function (ev) { ev.stopPropagation(); });

    // Restoring to a CAPTURED previous label would latch on "Opened ↗"
    // permanently if a second click landed inside the flash window; the idle
    // label is a constant, so restore to that and let a re-click just extend.
    var restoreTimer = null;
    function flashOpened() {
      link.textContent = WIKI_OPENED_LABEL;
      if (restoreTimer) clearTimeout(restoreTimer);
      restoreTimer = setTimeout(function () {
        restoreTimer = null;
        link.textContent = WIKI_IDLE_LABEL;
      }, WIKI_FLASH_MS);
    }

    function openInBackground() {
      if (WIKI_TABS_DIRECT) {
        chrome.tabs.create({ url: url, active: false });
        return;
      }
      sendToWorker({ type: "openTab", url: url }).then(function (response) {
        if (response && response.ok === true) return;
        // No handler (a worker from before this shipped) or the url failed
        // validation. The link must still work, so fall back to the ordinary
        // browser route. Note this runs after an await, so the user-gesture
        // token may have lapsed and a popup blocker could refuse it — an
        // acceptable risk on a path that only opens when the worker is broken.
        window.open(url, "_blank", "noopener");
      });
    }

    function intercept(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      openInBackground();
      flashOpened();
    }

    link.addEventListener("click", function (ev) {
      ev.stopPropagation();  // never reaches the popup's own click handling
      // Modified clicks keep native browser behavior, everywhere.
      if (ev.button === 0 && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) {
        intercept(ev);
      }
    });
    // Middle-click fires auxclick, not click.
    link.addEventListener("auxclick", function (ev) {
      if (ev.button === 1) intercept(ev);
    });

    head.appendChild(link);
    return link;
  }

  /* ---- Card actions ---------------------------------------------------- *
   * CARD_ACTIONS is the whole definition of what a card head offers beside
   * the Wiktionary link, in the same declarative spirit as BADGES: an entry
   * answers "do I apply to this match?" and "what element am I?", and the one
   * renderer below is the only action-drawing code. Adding an action is one
   * more entry here and nothing else. First (and so far only) entry: "save".
   * -------------------------------------------------------------------- */

  var STAR_OFF = "☆";
  var STAR_ON = "★";

  // The saved identity of a match: the lemma for a word, the root key for a
  // root. Anything else is not a saveable thing.
  function savedIdentity(m) {
    if (!m || typeof m !== "object") return null;
    if (m.kind !== "root" && m.kind !== "word") return null;
    var key = matchKey(m);
    return key ? { kind: m.kind, key: key } : null;
  }

  // The savedCheck map key, "r:<root key>" / "w:<lemma>". saved.js exports the
  // same function, but this file is a classic-script IIFE and cannot import it,
  // so the convention is pinned here too (it is SPEC, not an implementation
  // detail either side is free to change alone).
  function savedMapKey(kind, key) {
    return (kind === "root" ? "r" : "w") + ":" + key;
  }

  var CARD_ACTIONS = [
    {
      key: "save",
      when: function (m) { return !!savedIdentity(m); },
      build: function (m) { return buildSaveStar(m); }
    }
  ];

  // The one action renderer, in registry order. Every card head that carries
  // actions calls this immediately before appending its Wiktionary link.
  function appendCardActions(head, m) {
    if (!head || !m || typeof m !== "object") return 0;
    var count = 0;
    CARD_ACTIONS.forEach(function (spec) {
      var applies;
      try {
        applies = spec.when(m);
      } catch (e) {
        applies = false;
      }
      if (!applies) return;
      var node;
      try {
        node = spec.build(m);
      } catch (e) {
        node = null;
      }
      if (!node) return;
      head.appendChild(node);
      count++;
    });
    return count;
  }

  /* ---- The save star --------------------------------------------------- *
   * Stars render HIDDEN and are revealed by ONE batched savedCheck per render
   * pass. A star that has not been answered for shows nothing at all: on an
   * older worker, or with no chrome.storage, or in a bare harness runtime, the
   * feature is simply absent rather than wrong.
   * -------------------------------------------------------------------- */

  var pendingStars = [];          // stars awaiting the current pass's answer
  var liveStars = [];             // every star on screen, for cross-surface sync
  var savedCheckScheduled = false;

  // Detached stars belong to a view that has been replaced. Dropping them here
  // is the whole of the registry's housekeeping.
  function pruneStars() {
    liveStars = liveStars.filter(function (star) {
      return star.isConnected !== false;
    });
    return liveStars;
  }

  function applySavedState(star, on) {
    var saved = on === true;
    star.classList.remove("save--unknown");
    star.classList.toggle("save--on", saved);
    star.textContent = saved ? STAR_ON : STAR_OFF;
    star.setAttribute("aria-pressed", saved ? "true" : "false");
    var label = (saved ? "Remove " : "Save ") + star.hhSaveKey;
    star.setAttribute("aria-label", label);
    star.title = saved ? "Saved" : "Save";
  }

  // A render pass builds its cards synchronously, so a microtask is exactly
  // "once everything this pass created has registered".
  function scheduleSavedCheck() {
    if (savedCheckScheduled) return;
    savedCheckScheduled = true;
    Promise.resolve().then(function () {
      savedCheckScheduled = false;
      flushSavedCheck();
    });
  }

  function flushSavedCheck() {
    var stars = pendingStars;
    pendingStars = [];
    pruneStars();
    if (!stars.length) return;
    var keys = [];
    var seen = Object.create(null);
    stars.forEach(function (star) {
      var mapKey = savedMapKey(star.hhSaveKind, star.hhSaveKey);
      if (seen[mapKey]) return;
      seen[mapKey] = true;
      keys.push({ kind: star.hhSaveKind, key: star.hhSaveKey });
    });
    sendToWorker({ type: "savedCheck", keys: keys }).then(function (response) {
      // No answer, or {ok:false}: every star of this pass stays hidden.
      if (!response || response.ok !== true || !response.saved) return;
      stars.forEach(function (star) {
        if (star.isConnected === false) return;  // its view was replaced
        var saved =
          response.saved[savedMapKey(star.hhSaveKind, star.hhSaveKey)] === true;
        // An answer that DISAGREES with the star a bubble is hanging off means
        // the item changed under it — the bubble is describing something that
        // no longer exists, so it goes. An answer that agrees changes nothing,
        // which is the ordinary case: our own save is what fired the sync.
        if (saveBubble && saveBubble.star === star &&
            star.classList.contains("save--on") !== saved) {
          closeSaveBubble();
        }
        applySavedState(star, saved);
      });
    });
  }

  /* ---- Cross-surface sync ---------------------------------------------- *
   * A save made anywhere else — the sidebar's saved view, the popup on
   * another tab — reaches this one as a storage change. A stale star is not
   * merely wrong-looking: it INVERTS the next click, so ☆ on an
   * already-saved word unsaves it, and re-saving drops it back in the default
   * folder, losing wherever the reader had filed it.
   *
   * The fix re-asks about exactly the stars on screen, through the same
   * batched savedCheck a render pass uses. Debounced, because one user action
   * elsewhere can write more than once.
   * -------------------------------------------------------------------- */

  var SAVED_SYNC_DEBOUNCE = 100;
  var savedSyncTimer = null;

  function resyncStars() {
    if (!pruneStars().length) return;
    liveStars.forEach(function (star) {
      if (pendingStars.indexOf(star) < 0) pendingStars.push(star);
    });
    scheduleSavedCheck();
  }

  // The storage-change handler itself. Exposed on the test hooks because a
  // bare harness page has no chrome.storage to fire it.
  function applySavedChange() {
    if (savedSyncTimer) clearTimeout(savedSyncTimer);
    savedSyncTimer = setTimeout(function () {
      savedSyncTimer = null;
      resyncStars();
    }, SAVED_SYNC_DEBOUNCE);
  }

  function buildSaveStar(m) {
    var identity = savedIdentity(m);
    if (!identity) return null;
    // Native <button>, so Enter and Space activate it for free — the same
    // idiom makeMoreButton uses. The listeners below are its own, and both
    // stop propagation so a star inside a clickable row never navigates.
    var star = el("button", "save save--unknown", STAR_OFF);
    star.type = "button";
    star.hhSaveKind = identity.kind;
    star.hhSaveKey = identity.key;
    star.setAttribute("aria-pressed", "false");
    star.setAttribute("aria-label", "Save " + identity.key);
    star.title = "Save";
    star.addEventListener("mousedown", function (ev) { ev.stopPropagation(); });
    star.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      toggleSave(star);
    });
    pendingStars.push(star);
    liveStars.push(star);
    scheduleSavedCheck();
    return star;
  }

  // Optimistic: the star flips now and the worker confirms. A refusal (or no
  // answer at all) puts it back, so the star never claims a save that failed.
  function toggleSave(star) {
    // Any fresh card interaction dismisses an open bubble, this one included.
    closeSaveBubble();
    if (star.hhSaveBusy) return;
    // Unknown state: nothing to toggle. Only reachable programmatically — an
    // unrevealed star is `visibility: hidden`, so it takes neither clicks nor
    // focus.
    if (star.classList.contains("save--unknown")) return;
    var was = star.classList.contains("save--on");
    star.hhSaveBusy = true;
    applySavedState(star, !was);
    sendToWorker({
      type: "savedToggle", kind: star.hhSaveKind, key: star.hhSaveKey
    }).then(function (response) {
      star.hhSaveBusy = false;
      if (!response || response.ok !== true) {
        applySavedState(star, was);
        return;
      }
      applySavedState(star, response.saved === true);
      // Only a SAVE bubbles. Unsaving is silent by design: the reader just
      // undid something, and a panel offering to undo it again is noise.
      if (response.saved === true) openSaveBubble(star, response);
    });
  }

  /* ---- The save bubble ------------------------------------------------- *
   * Chrome's bookmark star, transposed: the save already happened, so the
   * bubble is a confirmation carrying the only two follow-ups worth offering —
   * move it to another folder, or undo it. One at a time, by construction.
   * -------------------------------------------------------------------- */

  var saveBubble = null;   // { node, star }

  // Sentinel value of the select's trailing option. Real folder ids are
  // "f<n>", so this can never collide with one.
  var NEW_FOLDER_OPTION = "okp:new-folder";

  function saveBubbleIsOpen() { return saveBubble !== null; }

  function closeSaveBubble() {
    if (!saveBubble) return;
    var node = saveBubble.node;
    saveBubble = null;
    window.removeEventListener("mousedown", onBubbleOutsideMouseDown, false);
    window.removeEventListener("keydown", onBubbleKeyDown, true);
    if (node && node.parentNode) node.parentNode.removeChild(node);
  }

  // The bubble stops its own mousedowns, so anything that reaches window is
  // outside it — another card, the page, the popup's own chrome.
  function onBubbleOutsideMouseDown() {
    closeSaveBubble();
  }

  // Escape belongs to the bubble while one is open. In normal mode the
  // popup-hide handler checks saveBubbleIsOpen() FIRST and consumes the key,
  // so the popup behind the bubble survives; this listener is what covers
  // embed mode, where that handler is never installed.
  function onBubbleKeyDown(ev) {
    if (ev.key !== "Escape" && ev.key !== "Esc") return;
    if (!saveBubble) return;
    ev.preventDefault();
    ev.stopPropagation();
    closeSaveBubble();
  }

  function openSaveBubble(star, response) {
    closeSaveBubble();
    var head = star.parentNode;
    if (!head) return;
    var item = response.item && typeof response.item === "object" ? response.item : null;
    var folders = asArray(response.folders).filter(function (folder) {
      return folder && typeof folder === "object" && nonEmptyString(folder.id);
    });
    var currentId = nonEmptyString(response.folderId) ||
      (item ? nonEmptyString(item.folderId) : "");

    var node = el("div", "savebubble");
    node.setAttribute("role", "dialog");
    node.setAttribute("aria-label", "Saved");
    node.appendChild(el("span", "savebubble-title", "Saved to"));

    // The folder row swaps between two states in place: the select, and the
    // name input that creates a folder the reader does not have yet. Both are
    // rebuilt from `folders` and `currentId`, so the two renderers below stay
    // the only description of either state.
    var folderRow = el("div", "savebubble-row");
    node.appendChild(folderRow);

    function moveToCurrent() {
      if (!item) return;
      sendToWorker({ type: "savedMove", ids: [item.id], folderId: currentId });
    }

    function renderFolderSelect() {
      clearNode(folderRow);
      var select = el("select", "savebubble-folder");
      select.setAttribute("aria-label", "Folder");
      folders.forEach(function (folder) {
        var option = el("option", "", nonEmptyString(folder.name) || folder.id);
        option.value = folder.id;
        if (folder.id === currentId) option.selected = true;
        select.appendChild(option);
      });
      // Always last: the folder that does not exist yet.
      var creator = el("option", "", "New folder…");
      creator.value = NEW_FOLDER_OPTION;
      select.appendChild(creator);
      if (!item) select.disabled = true;
      // Chrome-bookmarks behaviour: the move happens on the change itself,
      // with no confirm step — the bubble is already the confirmation.
      select.addEventListener("change", function () {
        if (select.value === NEW_FOLDER_OPTION) {
          renderNewFolder();
          return;
        }
        currentId = select.value;
        moveToCurrent();
      });
      folderRow.appendChild(select);
    }

    function renderNewFolder() {
      clearNode(folderRow);
      var input = el("input", "savebubble-name");
      input.type = "text";
      input.placeholder = "Folder name";
      input.setAttribute("aria-label", "New folder name");
      var error = el("div", "savebubble-error");
      var busy = false;

      function create() {
        if (busy) return;
        busy = true;
        error.textContent = "";
        sendToWorker({ type: "folderCreate", name: input.value }).then(function (result) {
          busy = false;
          if (!result || result.ok !== true || !result.folder) {
            // What counts as a usable name is the worker's rule, not ours, so
            // its complaint is what the reader sees and the input stays put.
            error.textContent = (result && nonEmptyString(result.error)) ||
              "Could not create that folder";
            input.focus({ preventScroll: true });
            return;
          }
          folders.push({
            id: result.folder.id,
            name: nonEmptyString(result.folder.name) || result.folder.id
          });
          currentId = result.folder.id;
          moveToCurrent();
          renderFolderSelect();
        });
      }

      var confirm = el("button", "savebubble-create", "Create");
      confirm.type = "button";
      confirm.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        create();
      });
      var cancel = el("button", "savebubble-cancel", "Cancel");
      cancel.type = "button";
      cancel.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        renderFolderSelect();   // currentId never moved, so this restores it
      });
      // Typing must not reach the page underneath. Escape is unaffected: the
      // window listener that closes the bubble runs in the CAPTURE phase, so
      // it has already fired by the time this one is reached.
      input.addEventListener("keydown", function (ev) {
        ev.stopPropagation();
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        create();
      });

      var controls = el("div", "savebubble-controls");
      controls.appendChild(confirm);
      controls.appendChild(cancel);
      folderRow.appendChild(input);
      folderRow.appendChild(controls);
      folderRow.appendChild(error);
      input.focus({ preventScroll: true });
    }

    renderFolderSelect();

    var remove = el("button", "savebubble-remove", "Remove");
    remove.type = "button";
    remove.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      applySavedState(star, false);
      closeSaveBubble();
      sendToWorker({
        type: "savedToggle", kind: star.hhSaveKind, key: star.hhSaveKey
      }).then(function (result) {
        if (!result || result.ok !== true) {
          applySavedState(star, true);   // the removal did not happen
          return;
        }
        applySavedState(star, result.saved === true);
      });
    });
    node.appendChild(remove);

    // Everything inside the bubble is its own business; every other mousedown
    // in the document dismisses it.
    node.addEventListener("mousedown", function (ev) { ev.stopPropagation(); });
    node.addEventListener("click", function (ev) { ev.stopPropagation(); });

    head.appendChild(node);
    saveBubble = { node: node, star: star };
    window.addEventListener("mousedown", onBubbleOutsideMouseDown, false);
    window.addEventListener("keydown", onBubbleKeyDown, true);
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
   *
   * Every card is a stack of SECTIONS. A section is one appendX(card, m)
   * with a single call site in a card build, reading only its slice of the
   * match, and its first act is its enabled-predicate. Moving a section is
   * moving its call, removing it is deleting the call, and disabling it is
   * one predicate.
   * ------------------------------------------------------------------ */

  // Classification badges are DECLARATIVE: this array is the whole definition.
  // Each entry answers, for one match or family row, "do I apply, and with
  // what wording?". `when` returns false or { label, title }. Adding a badge
  // is one more entry here and nothing else: the renderer below is the only
  // badge-drawing code and every site calls it.
  //
  // One entry per tier. Exclusivity lives HERE, in the when() conditions: each
  // tests one exact derived tier, so at most one can ever match. It is NOT a
  // global cap on how many badges may render, so a future non-tier badge
  // co-renders beside whichever tier chip applies with no change to this code.
  function tierEntry(tier) {
    return {
      key: tier,
      when: function (m) {
        // An absent or unrecognised tier renders NO chip. Guessing a zone
        // would be worse than silence, and it is what keeps root cards clean:
        // how many words a root builds is its weight signal, not a tier.
        return m.tier === tier &&
          { label: TIER_LABEL[tier], title: TIER_TITLE[tier] };
      }
    };
  }

  var BADGES = TIER_ORDER.map(tierEntry);

  // The one badge renderer, in registry order. `m` is a word match or a family
  // row: anything the worker joined a tier onto.
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
      var badge = el("span", "tier-chip tier-chip--" + spec.key, info.label);
      var title = nonEmptyString(info.title) || info.label;
      badge.title = title;
      badge.setAttribute("aria-label", title);
      container.appendChild(badge);
      count++;
    });
    return count;
  }

  /* ---- Word card ------------------------------------------------------- */

  function wordHeadEnabled(settings) {
    return true;
  }

  // The head of a word card: the lemma as the big text, the tier chip, the
  // inflection note, the card actions and the Wiktionary link.
  function appendWordHead(card, m) {
    if (!wordHeadEnabled(sectionSettings())) return;
    var head = el("div", "head");
    // The lemma is always the big text; `surface` is whatever was selected,
    // which may differ in case or be an inflected form.
    var surface = nonEmptyString(m.surface);
    var canonical = nonEmptyString(m.canonical);
    var big = canonical || surface;
    head.appendChild(el("div", "surface", big));

    var meta = el("div", "headmeta");
    appendBadges(meta, m);
    // The inflection note. Case alone is not a difference worth a line, and
    // the note belongs only to a view actually looked up from that surface:
    // arriving at "territory" from a family row must not caption it with a
    // selection made three views ago (see noteApplies).
    if (surface && big && surface.toLowerCase() !== big.toLowerCase() &&
        noteApplies(surface)) {
      meta.appendChild(el("div", "canonical", surface + " → " + big));
    }
    head.appendChild(meta);
    // Card actions come first so the star lands beside the link rather than
    // after it.
    appendCardActions(head, m);
    appendWikiLink(head, big, "English");
    card.appendChild(head);
  }

  function glossesEnabled(settings) {
    return true;
  }

  // One section per part of speech: a small uppercase label over that POS's
  // own numbered sense list. A POS whose defs are all empty renders nothing,
  // label included.
  function appendGlosses(card, m) {
    if (!glossesEnabled(sectionSettings())) return;
    asArray(m.senses).forEach(function (sense) {
      if (!sense || typeof sense !== "object") return;
      var defs = asArray(sense.defs).map(nonEmptyString).filter(Boolean);
      if (!defs.length) return;
      var label = posLabel(sense.pos);
      if (label) card.appendChild(el("div", "label pos", label));
      appendSenseList(card, defs);
    });
  }

  function breakdownEnabled(settings) {
    return true;
  }

  // MADE OF: the morphemes as chips joined by plus signs, each showing the
  // form the reader sees in the word over the gloss the worker joined for it.
  // A chip links in one of two directions, and looks the same either way:
  // `r` opens a root card, `w` opens the card of a word that happens to be a
  // part (muse in music). A chip with neither is inert and carries no hover
  // affordance at all, because there is nowhere for it to go.
  function appendBreakdown(card, m) {
    if (!breakdownEnabled(sectionSettings())) return;
    var morphs = asArray(m.morphs).filter(function (p) {
      return p && typeof p === "object" && nonEmptyString(p.f);
    });
    if (!morphs.length) return;

    card.appendChild(el("div", "label", "MADE OF"));
    var row = el("div", "morphs");
    morphs.forEach(function (p, i) {
      if (i) row.appendChild(el("span", "morph-plus", "+"));
      var chip = el("span", "morph");
      chip.appendChild(el("span", "morph-form", nonEmptyString(p.f)));
      var gloss = nonEmptyString(p.gloss);
      if (gloss) chip.appendChild(el("span", "morph-gloss", gloss));
      var rootKey = nonEmptyString(p.r);
      var wordKey = nonEmptyString(p.w);
      if (rootKey) {
        chip.classList.add("nav");
        makeNavRow(chip, (function (key) {
          return function () { navigateToRoot(key); };
        })(rootKey));
      } else if (wordKey) {
        // An ordinary lookup drill-down, exactly like a family row.
        chip.classList.add("nav");
        makeNavRow(chip, wordKey);
      } else {
        chip.classList.add("inert");
      }
      row.appendChild(chip);
    });
    card.appendChild(row);
  }

  function originEnabled(settings) {
    return true;
  }

  // One quiet nav row for a word whose story is a chain rather than a split:
  // "From Latin terra (earth, land)". A word card never carries both this and
  // the breakdown; the data guarantees it.
  function appendOrigin(card, m) {
    if (!originEnabled(sectionSettings())) return;
    var org = m.org && typeof m.org === "object" ? m.org : null;
    if (!org) return;
    var key = nonEmptyString(org.r);
    var parts = splitRootKey(key);
    var form = nonEmptyString(org.f) || parts.form;
    if (!key || !form) return;

    var row = el("div", "entry-row origin-row nav");
    row.appendChild(buildOriginText(parts.lang, form, org.gloss));
    makeNavRow(row, function () { navigateToRoot(key); });
    card.appendChild(row);
  }

  // "From Latin terra (earth, land)" as elements. Shared by the word card's
  // origin row and the affix card's source row, which say the same thing
  // about two different kinds of card.
  function buildOriginText(lang, form, gloss) {
    var name = langName(lang);
    var text = el("span", "origin-text");
    text.appendChild(document.createTextNode("From " + (name ? name + " " : "")));
    text.appendChild(el("b", null, form));
    var short = nonEmptyString(gloss);
    if (short) text.appendChild(document.createTextNode(" (" + short + ")"));
    return text;
  }

  function seeAlsoEnabled(settings) {
    return true;
  }

  // A word that shadows an inflection of another word ("ran" is a word in its
  // own right and also the past of "run") points at the lemma with one quiet
  // row, so the reader is never stranded on the shadowing entry.
  function appendSeeAlso(card, m) {
    if (!seeAlsoEnabled(sectionSettings())) return;
    var lemma = nonEmptyString(m.seeAlso);
    if (!lemma) return;

    var row = el("div", "entry-row origin-row nav");
    var text = el("span", "origin-text");
    text.appendChild(document.createTextNode("Also a form of "));
    text.appendChild(el("b", null, lemma));
    row.appendChild(text);
    makeNavRow(row, lemma);
    card.appendChild(row);
  }

  function buildWordCard(m) {
    var card = el("div", "card word");

    appendWordHead(card, m);

    appendGlosses(card, m);

    appendBreakdown(card, m);

    appendOrigin(card, m);

    appendSeeAlso(card, m);

    return card;
  }

  /* ---- Root card ------------------------------------------------------- */

  function rootHeadEnabled(settings) {
    return true;
  }

  // The head of a root card: the form as the big text, the romanization
  // beside it where the script needs one, the label line, the card actions
  // and the Wiktionary link into this root's own language section.
  function appendRootHead(card, m) {
    if (!rootHeadEnabled(sectionSettings())) return;
    var r = rootOf(m);
    var form = nonEmptyString(r.form) || splitRootKey(m.key).form;
    var head = el("div", "head");
    head.appendChild(el("div", "surface", form));

    var meta = el("div", "headmeta");
    // Greek is written in Greek, so the romanization rides beside the form
    // rather than replacing it.
    var rom = nonEmptyString(r.rom);
    if (rom) meta.appendChild(el("div", "rom", rom));
    var label = rootLabel(r);
    if (label) meta.appendChild(el("div", "rootlabel", label));
    head.appendChild(meta);
    appendCardActions(head, m);
    appendWikiLink(head, form,
      LANG_ANCHOR[nonEmptyString(r.lang)] || WIKI_DEFAULT_ANCHOR);
    card.appendChild(head);
  }

  // "Latin root", "Greek root", "Prefix", "Suffix". An affix says what it is
  // and nothing more: the language it works in is the reader's own.
  function rootLabel(r) {
    var kind = nonEmptyString(r.kind);
    if (kind === "prefix") return "Prefix";
    if (kind === "suffix") return "Suffix";
    var name = langName(r.lang);
    return name ? name + " root" : "Root";
  }

  function rootGlossEnabled(settings) {
    return true;
  }

  // The gloss as a single sense line, clamped like any other sense.
  function appendRootGloss(card, m) {
    if (!rootGlossEnabled(sectionSettings())) return;
    var gloss = nonEmptyString(rootOf(m).gloss);
    if (!gloss) return;
    appendSenseList(card, [gloss]);
  }

  function rootSourceEnabled(settings) {
    return true;
  }

  // "From Latin sub" on an English affix whose own entry descends from a
  // shipped Latin or Greek lemma. Absent otherwise.
  function appendRootSource(card, m) {
    if (!rootSourceEnabled(sectionSettings())) return;
    var key = nonEmptyString(rootOf(m).src);
    if (!key) return;
    var parts = splitRootKey(key);
    if (!parts.form) return;

    var row = el("div", "entry-row origin-row nav");
    row.appendChild(buildOriginText(parts.lang, parts.form, ""));
    makeNavRow(row, function () { navigateToRoot(key); });
    card.appendChild(row);
  }

  // One family row: the word, its first definition, and its tier chip. The
  // whole row navigates into that word's card.
  function buildFamilyRow(entry) {
    if (!entry || typeof entry !== "object") return null;
    var word = nonEmptyString(entry.word);
    if (!word) return null;

    var row = el("div", "entry-row fam-row nav");
    var text = el("span", "fam-text");
    text.appendChild(el("span", "fam-word", word));
    var def = nonEmptyString(entry.def);
    if (def) text.appendChild(el("span", "fam-def", ": " + capitalizeSense(def)));
    appendBadges(text, entry);
    row.appendChild(clampWrap(text, 1));

    makeNavRow(row, word);
    return row;
  }

  function familyEnabled(settings) {
    return true;
  }

  // BUILDS N WORDS: the inline rows the response carried, plus a
  // "Show 5 more (N)" control when the root builds more than that.
  //
  // The list is CHUNKED, because a common affix builds thousands of words:
  // each press reveals five more from rows already in hand, and only when
  // those run out does it ask the worker for the next chunk. When the whole
  // family fits in what a card normally shows inline it is fetched up front
  // and rendered whole: a button whose one press would reveal all it ever
  // could is only a delay.
  function appendFamily(card, m) {
    if (!familyEnabled(sectionSettings())) return;
    var r = rootOf(m);
    var key = nonEmptyString(m.key) || nonEmptyString(r.key);
    var box = el("div", "family");
    var shown = Object.create(null);   // words already on screen
    var rowCount = 0;

    asArray(r.family).slice(0, MAX_FAMILY).forEach(function (entry) {
      var word = entry && typeof entry === "object" ? nonEmptyString(entry.word) : "";
      if (!word || shown[word]) return;
      var node = buildFamilyRow(entry);
      if (!node) return;
      shown[word] = true;
      box.appendChild(node);
      rowCount++;
    });

    var count = (typeof r.familyCount === "number" && isFinite(r.familyCount) &&
      r.familyCount > 0) ? Math.floor(r.familyCount) : rowCount;
    var total = Math.max(count, rowCount);
    var remaining = key ? Math.max(0, total - rowCount) : 0;

    if (!rowCount && !remaining) return;
    card.appendChild(el("div", "label", "BUILDS " + total + " WORDS"));
    card.appendChild(box);
    if (!remaining) return;

    var pending = [];         // fetched rows not yet on screen
    var nextOffset = 0;       // where the next chunk request starts
    var exhausted = false;    // the worker has no more rows to give
    var button = el("button", "fam-more");
    button.type = "button";

    function syncButton() {
      if (remaining <= 0) {
        if (button.parentNode) button.parentNode.removeChild(button);
        return;
      }
      button.textContent =
        "Show " + Math.min(FAMILY_PAGE, remaining) + " more (" + remaining + ")";
      // If a chunk turned out to hold more than the estimate, the auto-reveal
      // path must surface the control again.
      button.hidden = false;
    }

    // Reveals up to one page from what is already in hand. Returns how many
    // rows it managed to add, so the caller knows whether to fetch.
    function revealPending() {
      var added = 0;
      while (added < FAMILY_PAGE && pending.length) {
        var next = pending.shift();
        var name = nonEmptyString(next.word);
        if (name && shown[name]) continue;
        var node = buildFamilyRow(next);
        if (!node) continue;
        if (name) shown[name] = true;
        box.appendChild(node);
        added++;
        rowCount++;
      }
      if (added) {
        // Rows in hand are the authority on what is left once the worker has
        // said it has nothing more.
        remaining = exhausted
          ? pending.length
          : Math.max(pending.length, total - rowCount);
        syncButton();
        // The control follows the rows down; re-measure clamps, re-anchor the
        // popup for its new height, then make sure it is still reachable.
        var anchorEl = button.isConnected ? button : box.lastChild;
        refreshLayout();
        keepInView(anchorEl);
      }
      return added;
    }

    // Asks for the next chunk, then reveals from it. `onFail` is the
    // whole-card path's way of putting the control back.
    function loadChunk(onFail) {
      if (exhausted) return;
      var seq = requestSeq;     // dismissal or a new selection cancels this
      button.disabled = true;
      fetchFamily(key, nextOffset).then(function (chunk) {
        if (seq !== requestSeq) return;
        button.disabled = false;
        // Failure: leave the rows alone and stay pressable for a retry.
        if (!chunk) { if (onFail) onFail(); return; }
        if (typeof chunk.total === "number" && chunk.total > 0) {
          total = Math.floor(chunk.total);
        }
        nextOffset += chunk.rows.length;
        if (!chunk.rows.length || nextOffset >= total) exhausted = true;
        chunk.rows.forEach(function (entry) {
          var word = nonEmptyString(entry.word);
          if (!word || shown[word]) return;
          pending.push(entry);
        });
        if (!revealPending()) {
          // The chunk held nothing new. Whatever is left is unreachable, so
          // the control has nothing left to promise.
          remaining = pending.length;
          syncButton();
        }
      });
    }

    button.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();     // never read as a click on a family row
      if (button.disabled) return;
      // Rows in hand first; the worker is asked only when they run out.
      if (revealPending()) return;
      loadChunk();
    });

    syncButton();
    card.appendChild(button);

    if (total <= MAX_FAMILY) {
      // The whole family fits in what a card normally displays inline: render
      // it whole. MAX_FAMILY deliberately, not FAMILY_PAGE. The rule is "no
      // smaller than a normal card", and it must follow the inline cap if
      // that cap ever changes. The button stays in the DOM but hidden, so a
      // failed fetch can fall back to the press-to-retry path.
      button.hidden = true;
      loadChunk(function () { button.hidden = false; });
    }
  }

  function buildRootCard(m) {
    var card = el("div", "card root");

    appendRootHead(card, m);

    appendRootGloss(card, m);

    appendRootSource(card, m);

    appendFamily(card, m);

    return card;
  }

  /* ---- Shared card helpers --------------------------------------------- */

  function prefersReducedMotion() {
    try {
      return !!(window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (e) {
      return false;
    }
  }

  // Re-triggerable tint fade, so clicking the same target twice flashes twice.
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

  /* ------------------------------------------------------------------ *
   * View rendering
   * ------------------------------------------------------------------ */

  // The text a view was looked up FROM. Every view has one: the root view's is
  // the selection, a drill-down's is the row's target word. When no text is
  // threaded (test hooks, synthetic views) the view's own matches supply it:
  // a fresh response's surfaces are by definition parts of the text it
  // answered, and are never borrowed from another view.
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

  // "territories → territory" is a statement about the CURRENT view: it
  // explains the form the reader actually selected here. Responses are cached
  // per popup session and reused in later views, so the surface on a cached
  // match may belong to some earlier lookup. Selecting "territories" and then
  // drilling into "terrain" must not caption that view with an inflection
  // nobody typed. Rendering-time check, so nothing is mutated and going back
  // restores the note.
  function noteApplies(surface) {
    if (!surface) return false;
    if (!currentSrcText) return true;   // unknown provenance: keep the note
    return currentSrcText.toLowerCase().indexOf(surface.toLowerCase()) !== -1;
  }

  // One card per match, in response order. Words and roots are the only two
  // kinds there are, and each owns its own build.
  function appendMatchCards(list) {
    var count = 0;
    list.forEach(function (m) {
      var card = m.kind === "root" ? buildRootCard(m) : buildWordCard(m);
      if (!card) return;
      viewRoot.appendChild(card);
      count++;
    });
    return count;
  }

  /* ------------------------------------------------------------------ *
   * Navigation: a stack of views presented as a breadcrumb trail
   * ------------------------------------------------------------------ */

  /* ---- view identity -------------------------------------------------- *
   * A view's key is what it is ABOUT: one word, or one root. Navigation
   * compares keys so that arriving at a level already in the trail re-enters
   * it instead of stacking a duplicate. A view showing several independent
   * things has no identity at all: pushing a genuinely new view is much
   * cheaper than wrongly collapsing two different ones, so anything ambiguous
   * returns null.
   * --------------------------------------------------------------------- */
  function viewKey(matches) {
    var list = usableMatches(matches);
    if (list.length !== 1) return null;
    var m = list[0];
    var key = matchKey(m);
    if (!key) return null;
    if (m.kind === "root") return "root:" + key;
    // The lemma, never the surface: a view reached from "territories" and one
    // reached from "Territory" are the same view.
    return "word:" + key;
  }

  // Only the CURRENT view is protected from duplication. Arriving at a place
  // that is further back in the trail is still forward travel — terra › terrain
  // › terra is a legitimate descent, the same way browser history records a
  // revisit — so an ancestor match pushes normally rather than collapsing.
  function isCurrentView(key) {
    if (!key) return false;
    var top = viewStack[viewStack.length - 1];
    return !!top && top.key === key;
  }

  // Already-on-screen target: no push. Scroll back to the top and flash the
  // card head, a quiet orientation cue instead of a duplicate view.
  function orientCurrentView() {
    if (!viewRoot) return;
    scrollPanelTo(0);
    if (prefersReducedMotion()) return;
    var card = viewRoot.querySelector(".card");
    if (!card) return;
    flashCard(card.querySelector(".head") || card);
  }

  // Already here: orient instead of stacking a copy of this very view.
  function reenterCurrentView(key) {
    if (!isCurrentView(key)) return false;
    orientCurrentView();
    return true;
  }

  // A crumb names what the view IS, not the gesture that opened it: selecting
  // "territories" roots the trail as territory (the card's inflection note
  // already records what was selected). That is exactly the view's identity,
  // so the label falls straight out of the key. Only a view with no single
  // identity falls back to its surface text.
  function viewLabel(matches, fallback) {
    var key = viewKey(matches);
    if (key) {
      var cut = key.indexOf(":");
      var kind = key.slice(0, cut);
      if (kind === "word") return key.slice(cut + 1);
      // A root crumb reads as the form, not as the la:terra key.
      if (kind === "root") {
        var m = usableMatches(matches)[0];
        return nonEmptyString(rootOf(m).form) ||
          splitRootKey(key.slice(cut + 1)).form;
      }
    }
    for (var i = 0; i < matches.length; i++) {
      var label = nonEmptyString(matches[i].canonical) ||
        nonEmptyString(matches[i].surface);
      if (label) return label;
    }
    return nonEmptyString(fallback);
  }

  function saveCurrentViewState() {
    var view = viewStack[viewStack.length - 1];
    if (!view) return;
    view.scrollTop = panel.scrollTop;
  }

  /* ---- Breadcrumbs ------------------------------------------------------ *
   * Every level except the last jumps straight to that cached view.
   *
   * The trail renders in FULL and elides only when the row genuinely runs out
   * of width (a fixed depth cap used to hide levels while most of the row sat
   * empty). What survives is the root, as many trailing levels as fit, and
   * never fewer than the last two; the middle collapses behind one "…", which
   * is a button that expands the trail in place, so no level is ever
   * unreachable. The expansion lasts until the next navigation.
   *
   * The elided crumbs stay in the DOM, hidden. Re-fitting is then a matter of
   * unhiding and re-measuring, which is what makes widening the panel restore
   * the trail without a rebuild.
   * -------------------------------------------------------------------- */

  function buildCrumbs() {
    var bar = el("div", "crumbs");
    var last = viewStack.length - 1;
    if (crumbsExpanded) bar.classList.add("expanded");

    // Kept for fitCrumbs: it needs the pieces, not a DOM query per re-fit.
    var parts = { crumbs: [], seps: [], gap: null, gapSep: null };
    bar.hhCrumbs = parts;

    viewStack.forEach(function (view, idx) {
      if (idx > 0) {
        // The separator that PRECEDES this crumb, hidden whenever it is.
        var sep = el("span", "crumb-sep", "›");
        parts.seps.push(sep);
        bar.appendChild(sep);
      }
      var label = view.label || "?";
      var crumb;
      if (idx === last) {
        crumb = el("span", "crumb current", label);
        crumb.setAttribute("aria-current", "true");
      } else {
        crumb = el("button", "crumb", label);
        crumb.type = "button";
        crumb.addEventListener("click", function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          goToDepth(idx);
        });
      }
      parts.crumbs.push(crumb);
      bar.appendChild(crumb);

      // The "…" and its own separator live right after the root, so eliding
      // is only ever a matter of hiding, never of re-ordering.
      if (idx === 0 && last > 0) {
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
        var gapSep = el("span", "crumb-sep", "›");
        parts.gap = gap;
        parts.gapSep = gapSep;
        bar.appendChild(gap);
        bar.appendChild(gapSep);
      }
    });
    return bar;
  }

  function showCrumb(node, on) {
    if (!node) return;
    if (on) node.removeAttribute("hidden");
    else node.setAttribute("hidden", "");
  }

  /**
   * Decide how much of the trail fits, and hide the rest.
   *
   * Deliberately arithmetic rather than iterative: every width is read in ONE
   * pass with the whole trail visible, and the answer is then computed, so a
   * deep trail costs one reflow instead of one per crumb dropped.
   */
  function fitCrumbs() {
    if (!viewRoot) return;
    var bar = viewRoot.querySelector(".crumbs");
    if (!bar || !bar.hhCrumbs) return;
    var parts = bar.hhCrumbs;
    var crumbs = parts.crumbs;
    var count = crumbs.length;

    // Expanded: the row wraps and shows everything, so there is nothing to fit.
    if (crumbsExpanded) {
      crumbs.forEach(function (c) { showCrumb(c, true); });
      parts.seps.forEach(function (s) { showCrumb(s, true); });
      showCrumb(parts.gap, false);
      showCrumb(parts.gapSep, false);
      return;
    }

    // WRITE: everything visible, so the widths read below are the natural ones
    // rather than whatever the last fit left behind.
    crumbs.forEach(function (c) { showCrumb(c, true); });
    parts.seps.forEach(function (s) { showCrumb(s, true); });
    showCrumb(parts.gap, true);
    showCrumb(parts.gapSep, true);

    // READ: one measurement pass, no writes in between.
    var style = getComputedStyle(bar);
    var available = bar.clientWidth -
      (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
    // No layout yet (the panel is still display:none): leave the full trail
    // rendered and let the next call, which has geometry, decide.
    if (!(available > 0)) {
      showCrumb(parts.gap, false);
      showCrumb(parts.gapSep, false);
      return;
    }
    var widths = crumbs.map(function (c) { return c.offsetWidth; });
    var sepW = parts.seps.length ? parts.seps[0].offsetWidth : 0;
    var gapW = parts.gap ? parts.gap.offsetWidth : 0;
    var cssGap = parseFloat(style.columnGap) || 0;

    // Width of the row for a given first-shown suffix index. `start` 0 means
    // the whole trail with no "…" at all.
    function widthFor(start) {
      var sum = 0;
      var items;
      var i;
      if (start === 0) {
        for (i = 0; i < count; i++) sum += widths[i];
        items = count;
      } else {
        sum = widths[0] + gapW;
        for (i = start; i < count; i++) sum += widths[i];
        items = 2 + (count - start);   // root, the "…", and the suffix
      }
      var seps = items - 1;
      // One css gap between every pair of adjacent elements, separators too.
      return sum + seps * sepW + (items + seps - 1) * cssGap;
    }

    var start = 0;
    if (widthFor(0) > available) {
      // Elide as little as possible: the smallest suffix start that fits.
      // `count - 2` keeps the last two, which is the floor whatever happens —
      // with fewer than four levels there is no middle to hide at all.
      for (start = 2; start <= count - 2; start++) {
        if (widthFor(start) <= available) break;
      }
      if (start > count - 2) start = count - 2;
      if (start < 2) start = 0;
    }

    // WRITE: apply the decision.
    var eliding = start > 0;
    showCrumb(parts.gap, eliding);
    showCrumb(parts.gapSep, eliding);
    for (var idx = 1; idx < count; idx++) {
      var on = !eliding || idx >= start;
      showCrumb(crumbs[idx], on);
      // seps[i] is the separator PRECEDING crumbs[i + 1].
      showCrumb(parts.seps[idx - 1], on);
    }
  }

  // Swaps just the nav bar, so expanding the trail keeps the cards below
  // (and their revealed family rows) exactly as they are.
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

    // The cards this bubble was anchored to are about to be thrown away.
    closeSaveBubble();

    // Any navigation re-collapses an expanded trail.
    crumbsExpanded = false;
    // Scope for the inflection notes drawn while this view renders.
    currentSrcText = view.srcText || "";
    clearNode(panel);
    panel.scrollTop = 0;
    viewRoot = el("div", "view");
    panel.appendChild(viewRoot);

    if (viewStack.length > 1) viewRoot.appendChild(buildCrumbs());

    var count = appendMatchCards(usableMatches(view.matches));

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
      scrollTop: 0
    });
    renderCurrentView();
    refreshLayout();
  }

  // Every word-bound nav row lands here: family rows today, anything added
  // later by the same idiom. The cycle guard covers all of them at once.
  function navigateTo(text) {
    var target = nonEmptyString(text);
    if (!target) return;

    // Rows navigate by lemma, so "am I already here?" is usually answerable
    // before asking the worker anything.
    if (reenterCurrentView("word:" + target)) return;

    var seq = requestSeq;
    fetchLookup(target).then(function (response) {
      if (seq !== requestSeq) return;                 // dismissed or superseded
      if (!response || response.ok !== true) return;  // keep the current view
      var list = usableMatches(response.matches);
      if (!list.length) return;
      // Authoritative check: an inflected surface only resolves to its lemma
      // once the worker has answered.
      var key = viewKey(list);
      if (reenterCurrentView(key)) return;
      pushView({
        key: key, label: viewLabel(list, target), matches: list,
        srcText: target                 // this view was looked up from the row
      });
    });
  }

  /* ---- Root drill-downs ------------------------------------------------- *
   * A morpheme chip and an origin row both name a ROOT rather than a word, so
   * they cannot go through the lookup path. They ask for the root card by key
   * instead, and push it as an ordinary view: crumbs, cache, cycle handling
   * and scroll restore all come along unchanged.
   * -------------------------------------------------------------------- */

  function navigateToRoot(key) {
    var target = nonEmptyString(key);
    if (!target) return;
    if (reenterCurrentView("root:" + target)) return;

    var seq = requestSeq;
    fetchRoot(target).then(function (root) {
      if (seq !== requestSeq) return;
      if (!root) return;                // unknown key or a failed request
      var match = { kind: "root", key: target, root: root };
      pushView({
        key: "root:" + target,
        label: nonEmptyString(root.form) || splitRootKey(target).form,
        matches: [match],
        srcText: target
      });
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

  // Re-anchor after the content (and therefore the height) changed in place:
  // a drill-down, a crumb jump, a revealed page of family rows. Keeps the
  // popup glued to the original selection throughout the whole descent.
  function reposition() {
    // Single choke point for every in-place re-anchor (drill-down, crumb
    // jump, resize settle): in embed there is nothing to anchor to, so they
    // all become no-ops here rather than at each call site.
    if (IS_EMBED) return;
    if (!visible || !anchorRect) return;
    positionAt(anchorRect);
  }

  function showAt(rect, matches, srcText) {
    ensureHost();
    var list = usableMatches(matches);
    resetSession();
    viewStack = [{
      key: viewKey(list),
      label: viewLabel(list, ""),
      matches: list,
      // The selection itself: the root view is the one place a selected
      // inflected form is guaranteed to belong.
      srcText: viewSourceText(list, srcText),
      scrollTop: 0
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
    // Trail width, clamp overflow and scrollTop all need the popup to have
    // layout, which is what the measurable-but-invisible step above buys.
    fitCrumbs();
    syncClamps();
    applyPendingScroll();
    if (!IS_EMBED) positionAt(rect);
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
    if (!WORD_RE.test(text)) return null;
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

  // One root card, by key. Fetched at most once per key per popup session; a
  // failure resolves to null and is NOT cached, so the chip can simply be
  // pressed again.
  function fetchRoot(key) {
    if (rootCache && Object.prototype.hasOwnProperty.call(rootCache, key)) {
      return Promise.resolve(rootCache[key]);
    }
    if (rootPending && rootPending[key]) return rootPending[key];
    var promise = sendToWorker({ type: "root", key: key }).then(function (response) {
      if (rootPending) delete rootPending[key];
      if (!response || response.ok !== true) return null;
      // A known-unknown key answers {root: null}. That is an answer, so it
      // caches: asking again would get the same nothing.
      var root = response.root && typeof response.root === "object"
        ? response.root : null;
      if (rootCache) rootCache[key] = root;
      return root;
    });
    if (rootPending) rootPending[key] = promise;
    return promise;
  }

  // One CHUNK of a root's ranked family, starting at `offset`. Same caching
  // contract as the root itself, per key and offset: one request each per
  // popup session, failures resolve to null and are not cached, so the
  // control can simply be pressed again. Resolves {rows, total, offset}.
  function fetchFamily(key, offset) {
    var at = typeof offset === "number" && offset > 0 ? Math.floor(offset) : 0;
    var cacheKey = key + "@" + at;
    if (familyCache && Object.prototype.hasOwnProperty.call(familyCache, cacheKey)) {
      return Promise.resolve(familyCache[cacheKey]);
    }
    if (familyPending && familyPending[cacheKey]) return familyPending[cacheKey];
    var promise = sendToWorker({ type: "family", key: key, offset: at })
      .then(function (response) {
        if (familyPending) delete familyPending[cacheKey];
        if (!response || response.ok !== true || !Array.isArray(response.rows)) {
          return null;
        }
        var chunk = {
          rows: response.rows.filter(function (entry) {
            return entry && typeof entry === "object";
          }),
          total: typeof response.total === "number" ? response.total : 0,
          offset: typeof response.offset === "number" ? response.offset : at
        };
        if (familyCache) familyCache[cacheKey] = chunk;
        return chunk;
      });
    if (familyPending) familyPending[cacheKey] = promise;
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

  // Embed mode installs NONE of these: the popup page owns its own lifecycle,
  // so scrolling the results, clicking the input or pressing Escape must never
  // tear the panel down. Selection lookups are likewise the host page's call
  // (it drives searchFor instead).
  if (!IS_EMBED) {
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
      if (e.key !== "Escape" && e.key !== "Esc") return;
      // A save bubble owns Escape while it is open: the key closes the bubble
      // and NOTHING else, so the popup behind it survives. A second Escape,
      // with no bubble left, dismisses the popup as it always did.
      if (saveBubbleIsOpen()) {
        e.stopPropagation();
        closeSaveBubble();
        return;
      }
      hide();
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
  }

  /* ------------------------------------------------------------------ *
   * Storage sync — installed on BOTH surfaces, since the sidebar's cards
   * come from this same renderer. Guarded all the way down: a bare harness
   * page, or any host without the extension's storage permission, simply
   * has nothing to listen to and keeps render-time state.
   * ------------------------------------------------------------------ */

  if (typeof chrome !== "undefined" && chrome && chrome.storage &&
      chrome.storage.onChanged &&
      typeof chrome.storage.onChanged.addListener === "function") {
    chrome.storage.onChanged.addListener(function (changes, area) {
      // Only the saved record, only the area we write to. Settings changes
      // and anything else are none of a star's business.
      if (area !== "local" || !changes || !changes.okpSaved) return;
      applySavedChange();
    });
  }

  /* ------------------------------------------------------------------ *
   * Embed API — the popup page's handle on the renderer.
   *
   * Gated on IS_EMBED alone, independently of the IS_STUB test hooks below:
   * the real popup page has a chrome.runtime and needs this, the embed test
   * harness has neither and needs both.
   * ------------------------------------------------------------------ */

  if (IS_EMBED) {
    // Inert stand-in for the selection rect. Nothing reads it (positionAt is
    // skipped in embed) — it exists so anchorRect keeps its shape.
    var EMBED_RECT = {
      left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0
    };

    // A typed query in root-key shape: "la:terra", "en:-ful", "grc:logos".
    // Nothing else can look like this, since a lookup token holds letters,
    // apostrophes and hyphens and never a colon.
    var ROOT_KEY_RE = /^(en|la|grc):.+$/;

    // The root half of searchFor: one {type:"root"} request, then the same
    // root view a morpheme chip would have pushed.
    function searchForRoot(key) {
      var seq = ++requestSeq;
      return sendToWorker({ type: "root", key: key }).then(function (response) {
        if (seq !== requestSeq) return { ok: true, count: 0, stale: true };
        if (!response || response.ok !== true) {
          hide();
          return { ok: false, count: 0 };
        }
        var root = response.root && typeof response.root === "object"
          ? response.root : null;
        // An unknown key is not an error: it is a search with no answer, and
        // the shell says so in the same words it uses for a missing word.
        if (!root || !showAt(EMBED_RECT, [{
          kind: "root", key: key, root: root
        }], key)) {
          hide();
          return { ok: true, count: 0 };
        }
        if (rootCache) rootCache[key] = root;
        return { ok: true, count: 1 };
      });
    }

    // The one window listener embed installs. In the in-page popup a resize
    // dismisses the popup outright, so there is nothing to re-measure; here
    // the panel simply gets narrower or wider under a sidebar edge drag, and
    // the trail has to be re-fitted to it. Debounced: a drag is a stream of
    // these.
    var embedResizeTimer = null;
    window.addEventListener("resize", function () {
      if (embedResizeTimer) clearTimeout(embedResizeTimer);
      embedResizeTimer = setTimeout(function () {
        embedResizeTimer = null;
        if (visible) refreshLayout();
      }, RESIZE_DEBOUNCE);
    });

    globalThis.__okpyeonEmbedApi = {
      // The container must already be in the document: ensureHost appends into
      // it immediately and the first render measures inside it.
      mount: function (container) {
        if (!container || container.nodeType !== 1) {
          throw new TypeError("okpyeon embed: mount() needs an element");
        }
        if (!container.isConnected) {
          throw new Error("okpyeon embed: mount() container is not in the document");
        }
        if (embedContainer) return false; // single mount; later calls are no-ops
        embedContainer = container;
        ensureHost();
        return true;
      },

      // Structurally a twin of handleSelection: bump the request sequence,
      // ask the worker, drop stale answers, render. Deliberately NOT built on
      // fetchLookup — that is the per-session drill-down cache, which is reset
      // by the very render this path performs.
      //
      // A query that IS a root key opens the root card instead. The omnibox
      // hands the panel keys like "la:terra" for its root suggestions, and
      // they reach here through every typed channel there is: the input, a
      // ?q= deep link, and the worker's pending query.
      searchFor: function (text) {
        var query = typeof text === "string" ? text.trim() : "";
        ensureHost();
        if (!query) {
          hide();
          return Promise.resolve({ ok: true, count: 0 });
        }
        if (ROOT_KEY_RE.test(query)) return searchForRoot(query);
        var seq = ++requestSeq;
        return sendLookup(query).then(function (response) {
          // A newer search (or clear()) won; leave the DOM to the winner.
          if (seq !== requestSeq) return { ok: true, count: 0, stale: true };
          if (!response || response.ok !== true) {
            hide();
            return { ok: false, count: 0 };
          }
          var list = usableMatches(response.matches);
          if (!list.length ||
              !showAt(EMBED_RECT, response.matches, query)) {
            // showAt already hid the panel when it rendered nothing.
            if (!list.length) hide();
            return { ok: true, count: 0 };
          }
          // Seed the session cache so drilling back to the query is free.
          if (lookupCache) lookupCache[query] = response;
          return { ok: true, count: list.length };
        });
      },

      clear: function () { hide(); }
    };
  }

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
      // A root card without a worker round trip: the harness hands over the
      // root object the {type:"root"} response would have carried.
      showRoot: function (rect, root, srcText) {
        ensureHost();
        return showAt(rect, [{
          kind: "root", key: (root && root.key) || "", root: root || {}
        }], srcText);
      },
      // The badge registry itself, so a check can prove a NEW badge needs
      // nothing but an entry (the harness registers a dummy and removes it).
      badgeRegistry: BADGES,
      // Same contract for card actions: the registry IS the definition, so a
      // check can add or drop an entry and watch every card head follow.
      cardActionRegistry: CARD_ACTIONS,
      saveBubble: function () {
        ensureHost();
        return panel.querySelector(".savebubble");
      },
      // The storage-change handler, for pages that have no chrome.storage to
      // fire it. Debounced exactly as the real listener is, so a check drives
      // the same path the browser does.
      applySavedChange: applySavedChange,
      savedSyncDelay: SAVED_SYNC_DEBOUNCE,
      hide: hide,
      handleSelection: handleSelection,
      readSelection: readSelection,
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
      // The current view's search context (see viewSourceText). The
      // inflection note is scoped by it, so a check can prove a stale surface
      // never follows a match into a later view.
      viewSrcText: function () {
        var view = viewStack[viewStack.length - 1];
        return view ? view.srcText : "";
      },
      crumbLabels: function () {
        ensureHost();
        // Visible crumbs only: width-based elision hides rather than removes,
        // and the harness asserts what the user sees.
        return Array.prototype.slice.call(panel.querySelectorAll(".crumb, .crumb-gap"))
          .filter(function (c) { return !c.hasAttribute("hidden"); })
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

