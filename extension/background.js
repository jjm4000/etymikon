/**
 * Hanja Hover — MV3 service worker.
 *
 * Thin chrome.* glue only: all lookup logic lives in ./lookup.js so it stays
 * unit-testable in plain Node. Registered with "type": "module" in
 * manifest.json so this import works.
 */

import {
  buildFullCompounds,
  buildOmniboxSuggestions,
  buildReadingIndex,
  buildUsedIn,
  lookup,
  toErrorMessage,
} from "./lookup.js";

const DATA_FILES = {
  hanja: "data/hanja.json",
  words: "data/words.json",
  variants: "data/variants.json",
};

/**
 * Rule 5: module-level cache. The service worker may be torn down and
 * restarted at any time; the data is simply re-fetched on the next lookup.
 * @type {Promise<{hanja:object, words:object, variants:object}>|null}
 */
let dataPromise = null;

/**
 * Rule 3c: eum -> hanja index, derived from hanja.json at runtime (not a data
 * file). Cached module-level alongside the data and built lazily on the first
 * single-syllable lookup, since most lookups never need it.
 * @type {Record<string, object[]>|null}
 */
let readingIndex = null;

async function fetchJson(path) {
  const url = chrome.runtime.getURL(path);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${path} (HTTP ${response.status})`);
  }
  return response.json();
}

/** Lazily load + cache the three data files. Failures clear the cache so a later lookup can retry. */
function getData() {
  if (dataPromise === null) {
    dataPromise = (async () => {
      const [hanja, words, variants] = await Promise.all([
        fetchJson(DATA_FILES.hanja),
        fetchJson(DATA_FILES.words),
        fetchJson(DATA_FILES.variants),
      ]);
      return { hanja, words, variants };
    })();
    dataPromise.catch(() => {
      dataPromise = null;
      readingIndex = null;
    });
  }
  return dataPromise;
}

/**
 * Handle a {type:"lookup", text} message.
 * @returns {Promise<{ok:true, matches:object[]}|{ok:false, error:string}>}
 */
export async function handleLookup(text) {
  try {
    const data = await getData();
    return lookup(text, {
      ...data,
      getReadingIndex: () => {
        if (readingIndex === null) readingIndex = buildReadingIndex(data.hanja);
        return readingIndex;
      },
    });
  } catch (err) {
    return { ok: false, error: toErrorMessage(err) };
  }
}

/**
 * Handle a {type:"compounds", char} message (cw ADDENDUM): the char's complete
 * compound index joined against words.json, in ranked order.
 * @returns {Promise<{ok:true, compounds:object[]}|{ok:false, error:string}>}
 */
export async function handleCompounds(char) {
  try {
    const data = await getData();
    return { ok: true, compounds: buildFullCompounds(char, data) };
  } catch (err) {
    return { ok: false, error: toErrorMessage(err) };
  }
}

/**
 * Handle a {type:"usedIn", word} message (used-in ADDENDUM): every larger
 * word containing this one, ranked, joined against words.json.
 * @returns {Promise<{ok:true, words:object[]}|{ok:false, error:string}>}
 */
export async function handleUsedIn(word) {
  try {
    const data = await getData();
    return { ok: true, words: buildUsedIn(word, data) };
  } catch (err) {
    return { ok: false, error: toErrorMessage(err) };
  }
}

/**
 * Wiktionary links ADDENDUM (background-open on every surface): the only URL
 * prefix a content script may ask the worker to open. Anything else is
 * refused — a content script runs in a page the extension does not trust, so
 * "open this url" is never taken at face value.
 */
export const WIKI_URL_PREFIX = "https://en.wiktionary.org/wiki/";

/** True only for a Wiktionary article URL. Pure; exported for the tests. */
export function isAllowedTabUrl(url) {
  return typeof url === "string" && url.startsWith(WIKI_URL_PREFIX);
}

/**
 * Handle a {type:"openTab", url} message: open a Wiktionary article in a
 * BACKGROUND tab (the in-page popup cannot call chrome.tabs itself). Rejects
 * anything that is not a Wiktionary article, and any environment without
 * chrome.tabs, with {ok:false}.
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function handleOpenTab(url) {
  if (!isAllowedTabUrl(url)) {
    return { ok: false, error: "refused: not a Wiktionary URL" };
  }
  if (typeof chrome === "undefined" || !chrome.tabs || !chrome.tabs.create) {
    return { ok: false, error: "tabs unavailable" };
  }
  try {
    await chrome.tabs.create({ url, active: false });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toErrorMessage(err) };
  }
}

/**
 * Sidebar ADDENDUM (pending-query handshake): the omnibox sets a query here,
 * then opens the panel; the panel pulls the query once at boot. A pull model,
 * so the panel never has to be listening at the moment the query is set, and
 * no storage permission is needed. Module-level like the data cache: if the
 * worker is torn down between the two halves the query is simply lost, which
 * cannot happen in practice (the panel opens in the same gesture).
 * @type {string|null}
 */
let pendingQuery = null;

/** Store the query the next panel boot should search. Exported for the tests. */
export function setPendingQuery(text) {
  pendingQuery = typeof text === "string" && text !== "" ? text : null;
}

/**
 * Handle a {type:"getPendingQuery"} message: hand over the query the omnibox
 * left behind, and clear it. Read-once, so a later panel open (or a reload of
 * the panel page) does not re-run a stale search.
 * @returns {Promise<{ok:true, query:string|null}>}
 */
export async function handleGetPendingQuery() {
  const query = pendingQuery;
  pendingQuery = null;
  return { ok: true, query };
}

// Guarded so this module can also be imported by Node (tests) without chrome.
if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const handler =
      message && message.type === "lookup"
        ? handleLookup(message.text)
        : message && message.type === "compounds"
          ? handleCompounds(message.char)
          : message && message.type === "usedIn"
            ? handleUsedIn(message.word)
            : message && message.type === "openTab"
              ? handleOpenTab(message.url)
              : message && message.type === "getPendingQuery"
                ? handleGetPendingQuery()
                : null;
    if (handler === null) return false;
    handler.then(sendResponse, (err) => {
      sendResponse({ ok: false, error: toErrorMessage(err) });
    });
    // Keep the message channel open for the async response.
    return true;
  });
}

// Sidebar ADDENDUM: clicking the toolbar icon toggles the panel. The call is
// idempotent and Chrome persists the setting, so it runs both at top level
// (covers a plain worker restart) and on install/update. Guarded like the
// listener above so this module still imports cleanly in Node.
if (typeof chrome !== "undefined" && chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  const enableActionToggle = () => {
    // A rejection here costs the icon-click toggle, nothing else — the panel
    // is still reachable from Chrome's own side-panel menu.
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  };
  enableActionToggle();
  if (chrome.runtime && chrome.runtime.onInstalled) {
    chrome.runtime.onInstalled.addListener(enableActionToggle);
  }
}

// Sidebar ADDENDUM (gesture fix, verified on real Chrome 2026-08-17): the
// omnibox Enter gesture does NOT survive an awaited chrome.windows.getCurrent()
// — sidePanel.open() must be the FIRST async call in the handler or it rejects
// and the tab fallback fires. So the worker tracks the focused window itself:
// seeded here (this module re-evaluates on every worker wake, and omnibox
// keystrokes wake the worker well before Enter lands) and kept fresh by
// onFocusChanged. Guarded like the listeners above for Node importability.
let focusedWindowId = null;
if (typeof chrome !== "undefined" && chrome.windows && chrome.windows.getLastFocused) {
  const WINDOW_ID_NONE = chrome.windows.WINDOW_ID_NONE;
  chrome.windows.getLastFocused((win) => {
    // Read lastError so Chrome doesn't log an unchecked-error warning.
    if (chrome.runtime && chrome.runtime.lastError) return;
    if (win && win.id !== WINDOW_ID_NONE) focusedWindowId = win.id;
  });
  if (chrome.windows.onFocusChanged) {
    chrome.windows.onFocusChanged.addListener((windowId) => {
      // WINDOW_ID_NONE means focus left Chrome entirely; keep the last real id.
      if (windowId !== WINDOW_ID_NONE) focusedWindowId = windowId;
    });
  }
}

/**
 * Sidebar ADDENDUM (repeat omnibox searches): the push half of the handshake.
 * The boot pull only covers a COLD panel — an already-open panel never re-asks,
 * so a second `hj` query would sit unread until the next panel open. After the
 * panel is open, poke every live extension page so an open one pulls again.
 *
 * Everything is swallowed on purpose: a rejection here is the normal cold-open
 * case (no page was listening yet), and that page's boot pull collects the
 * query anyway. Read-once semantics are untouched — only getPendingQuery
 * clears the query, so exactly one panel consumes it.
 */
function pokePanelPages() {
  if (typeof chrome === "undefined" || !chrome.runtime ||
      typeof chrome.runtime.sendMessage !== "function") {
    return;
  }
  try {
    const sent = chrome.runtime.sendMessage({
      type: "pendingQueryChanged",
      windowId: focusedWindowId,
    });
    if (sent && typeof sent.catch === "function") sent.catch(() => {});
  } catch {
    // No receiver, or the context went away mid-call. Nothing to do.
  }
}

/** Sidebar ADDENDUM: the panel page as a TAB, deep-linked with the typed query. */
function searchUrl(text) {
  return `${chrome.runtime.getURL("sidepanel/sidepanel.html")}?q=${encodeURIComponent(text)}`;
}

/**
 * Omnibox fallback: open the panel page in a tab, respecting the disposition.
 * Used when the side panel cannot be opened (gesture edge cases, older Chrome).
 */
function openSearchTab(text, disposition) {
  const url = searchUrl(text);
  if (disposition === "currentTab") {
    chrome.tabs.update({ url });
  } else {
    // newForegroundTab (and any unknown disposition) opens focused;
    // newBackgroundTab stays behind. Extension pages need no permission.
    chrome.tabs.create({ url, active: disposition !== "newBackgroundTab" });
  }
}

// Search popup ADDENDUM (omnibox keyword "hj"). Guarded like the listener
// above so this module still imports cleanly in Node.
if (typeof chrome !== "undefined" && chrome.omnibox && chrome.omnibox.onInputChanged) {
  // Set once at wiring time, not per keystroke. %s is the user's input; the
  // surrounding text is the only markup, so nothing needs escaping here.
  chrome.omnibox.setDefaultSuggestion({
    description: "Search Okpyeon for <match>%s</match>",
  });

  chrome.omnibox.onInputChanged.addListener((text, suggest) => {
    (async () => {
      try {
        suggest(buildOmniboxSuggestions(text, await getData()));
      } catch {
        // Data unavailable (offline install, mid-update): no rows, no noise.
        suggest([]);
      }
    })();
  });

  // Sidebar ADDENDUM: Enter on an omnibox row opens the PANEL and leaves the
  // query for it to pull at boot. Only if the panel refuses to open does the
  // old tab behavior stand in — and then the pending query is dropped, since
  // the tab path carries the query in its URL and a leftover would re-run this
  // search the next time the panel opens for any other reason.
  chrome.omnibox.onInputEntered.addListener((text, disposition) => {
    // No panel API, or the worker somehow has no window id yet: straight to
    // the tab path (which needs no gesture and carries the query in its URL).
    if (!chrome.sidePanel || !chrome.sidePanel.open || focusedWindowId === null) {
      openSearchTab(text, disposition);
      return;
    }
    setPendingQuery(text);
    try {
      // Called SYNCHRONOUSLY in the gesture — see the focusedWindowId note.
      // The poke goes in the RESOLVE half, never before open(): an awaited
      // call here would cost the gesture. Two-argument then(), not
      // .then().catch(), so the fallback stays tied to open() failing.
      chrome.sidePanel.open({ windowId: focusedWindowId }).then(pokePanelPages, () => {
        setPendingQuery(null);
        openSearchTab(text, disposition);
      });
    } catch {
      setPendingQuery(null);
      openSearchTab(text, disposition);
    }
  });
}
