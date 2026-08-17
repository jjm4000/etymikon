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
            : null;
    if (handler === null) return false;
    handler.then(sendResponse, (err) => {
      sendResponse({ ok: false, error: toErrorMessage(err) });
    });
    // Keep the message channel open for the async response.
    return true;
  });
}

/** Search popup ADDENDUM: the search page, deep-linked with the typed query. */
function searchUrl(text) {
  return `${chrome.runtime.getURL("popup/popup.html")}?q=${encodeURIComponent(text)}`;
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

  chrome.omnibox.onInputEntered.addListener((text, disposition) => {
    const url = searchUrl(text);
    if (disposition === "currentTab") {
      chrome.tabs.update({ url });
    } else {
      // newForegroundTab (and any unknown disposition) opens focused;
      // newBackgroundTab stays behind. Extension pages need no permission.
      chrome.tabs.create({ url, active: disposition !== "newBackgroundTab" });
    }
  });
}
