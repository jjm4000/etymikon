/**
 * Etymikon: the MV3 service worker.
 *
 * Thin chrome.* glue only: all lookup logic lives in ./lookup.js so it stays
 * unit-testable in plain Node. Registered with "type": "module" in
 * manifest.json so these imports work.
 */

import {
  buildFamily,
  buildFamilyIndex,
  buildOmniboxSuggestions,
  buildRoot,
  buildSearchIndex,
  escapeXml,
  lookup,
  toErrorMessage,
} from "./lookup.js";
import {
  ANKI_FIELDS,
  buildAnkiTsv,
  buildCsv,
  checkKeys,
  createFolder,
  deleteFolder,
  joinItems,
  moveItems,
  normalizeSavedState,
  normalizeSettings,
  removeItems,
  renameFolder,
  resolveExportSelection,
  toggleItem,
} from "./saved.js";

const DATA_FILES = {
  words: "data/words.json",
  roots: "data/roots.json",
  forms: "data/forms.json",
};

/**
 * Rule 4: module-level cache. The service worker may be torn down and
 * restarted at any time; the data is simply re-fetched on the next lookup.
 * @type {Promise<{words:object, roots:object, forms:object}>|null}
 */
let dataPromise = null;

/**
 * Rule 4: the root-to-words index, DERIVED from words.json at runtime and
 * stored in no data file. It costs 31 ms and 65 MB of allocation, so it builds
 * only where a ranked family LIST is rendered: a root card, a family chunk, a
 * saved root row. The omnibox and a word-only saved join never touch it.
 * Cleared with the data cache so an updated bundle rebuilds it with no other
 * work.
 * @type {Record<string, string[]>|null}
 */
let familyIndex = null;

/**
 * Rule 4: the omnibox index, derived the same way and cached the same way. It
 * carries family SIZES rather than lists, so a keystroke never pays for the
 * ranked index above.
 * @type {object|null}
 */
let searchIndex = null;

async function fetchJson(path) {
  const url = chrome.runtime.getURL(path);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${path} (HTTP ${response.status})`);
  }
  return response.json();
}

/** Lazily load and cache the three data files. A failure clears the cache so a later lookup can retry. */
function getData() {
  if (dataPromise === null) {
    dataPromise = (async () => {
      const [words, roots, forms] = await Promise.all([
        fetchJson(DATA_FILES.words),
        fetchJson(DATA_FILES.roots),
        fetchJson(DATA_FILES.forms),
      ]);
      return { words, roots, forms };
    })();
    dataPromise.catch(() => {
      dataPromise = null;
      familyIndex = null;
      searchIndex = null;
    });
  }
  return dataPromise;
}

/** The family index for the loaded bundle, built on first use. */
function getFamilyIndex(data) {
  if (familyIndex === null) familyIndex = buildFamilyIndex(data.words);
  return familyIndex;
}

/** The omnibox index for the loaded bundle, built on the first keystroke. */
function getSearchIndex(data) {
  if (searchIndex === null) searchIndex = buildSearchIndex(data);
  return searchIndex;
}

/**
 * Handle a {type:"lookup", text} message.
 * @returns {Promise<{ok:true, matches:object[]}|{ok:false, error:string}>}
 */
export async function handleLookup(text) {
  try {
    return lookup(text, await getData());
  } catch (err) {
    return { ok: false, error: toErrorMessage(err) };
  }
}

/**
 * Handle a {type:"root", key} message: the root card body, with the first
 * page of its derived family. An unknown key answers with a null root, not an
 * error, since a stale bundle is not a failure.
 * @returns {Promise<{ok:true, root:object|null}|{ok:false, error:string}>}
 */
export async function handleRoot(key) {
  try {
    const data = await getData();
    return { ok: true, root: buildRoot(key, data, getFamilyIndex(data)) };
  } catch (err) {
    return { ok: false, error: toErrorMessage(err) };
  }
}

/**
 * Handle a {type:"family", key, offset} message: one chunk of the ranked
 * family, with the full total behind it. `offset` defaults to 0.
 * @returns {Promise<{ok:true, rows:object[], total:number, offset:number}|{ok:false, error:string}>}
 */
export async function handleFamily(key, offset) {
  try {
    const data = await getData();
    return { ok: true, ...buildFamily(key, data, getFamilyIndex(data), offset) };
  } catch (err) {
    return { ok: false, error: toErrorMessage(err) };
  }
}

/**
 * Wiktionary links (background-open on every surface): the only URL prefix a
 * content script may ask the worker to open. Anything else is refused, since a
 * content script runs in a page the extension does not trust, so "open this
 * url" is never taken at face value.
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
 * Sidebar (pending-query handshake): the omnibox sets a query here, then opens
 * the panel; the panel pulls the query once at boot. A pull model, so the
 * panel never has to be listening at the moment the query is set, and no
 * storage permission is needed. Module-level like the data cache: if the
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

// ---------------------------------------------------------------------------
// Saved items + settings: the worker is the single writer.
// ---------------------------------------------------------------------------

/** chrome.storage.local keys. Schema v1 for both; see saved.js. */
const SAVED_KEY = "okpSaved";
const SETTINGS_KEY = "okpSettings";

/**
 * The one answer every saved/settings message gets when there is no
 * chrome.storage: a plain Node import (tests), or a Chrome too old for the
 * permission. Surfaces treat it as "feature absent", never as an error to show.
 */
const STORAGE_UNAVAILABLE = "storage unavailable";

/** The usable storage area, or null. Guarded like every other chrome.* touch. */
function storageArea() {
  if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
    return null;
  }
  const area = chrome.storage.local;
  return typeof area.get === "function" && typeof area.set === "function" ? area : null;
}

/**
 * The serialization chain. Every saved/settings handler, reads included, runs
 * as one link, so a read-modify-write can never interleave with another one no
 * matter how many surfaces message the worker at once. A rejected link never
 * breaks the chain: the tail is always a settled, ignored promise.
 * @type {Promise<*>}
 */
let storageChain = Promise.resolve();

function serialize(task) {
  const run = storageChain.then(task, task);
  storageChain = run.then(
    () => {},
    () => {}
  );
  return run;
}

/**
 * Storage guard, serialization and error envelope, shared by all eleven
 * handlers below.
 * @param {(area:object) => Promise<object>} task
 */
async function withStorage(task) {
  const area = storageArea();
  if (area === null) return { ok: false, error: STORAGE_UNAVAILABLE };
  return serialize(async () => {
    try {
      return await task(area);
    } catch (err) {
      return { ok: false, error: toErrorMessage(err) };
    }
  });
}

async function readKey(area, key) {
  const got = await area.get(key);
  return got !== null && typeof got === "object" ? got[key] : undefined;
}

/** Read and normalize the saved state. Storage is only rewritten on a change. */
async function readSaved(area) {
  return normalizeSavedState(await readKey(area, SAVED_KEY));
}

/** Read and normalize settings, resetting a default folder that no longer exists. */
async function readSettings(area, savedState) {
  return normalizeSettings(await readKey(area, SETTINGS_KEY), savedState);
}

function writeSaved(area, state) {
  return area.set({ [SAVED_KEY]: state });
}

function writeSettings(area, settings) {
  return area.set({ [SETTINGS_KEY]: settings });
}

/**
 * Join saved items against the live cache. An empty list is answered without
 * touching the cache at all: the settings view asks for the folder list through
 * savedGet, and on a cold worker that used to cost an 18.9 MB parse and a full
 * index build to fill one select. The ranked family index is built only when a
 * ROOT row is in the list, since that is the only row that reads it.
 */
async function joinSaved(items) {
  if (items.length === 0) return [];
  const data = await getData();
  const needsFamily = items.some(
    (item) => item !== null && typeof item === "object" && item.kind === "root"
  );
  return joinItems(items, needsFamily ? { ...data, familyIndex: getFamilyIndex(data) } : data);
}

/**
 * Shallow patch merge, one level deep through `anki` so a settings control can
 * send `{anki:{wordFront:"defs"}}` without resetting its sibling fields.
 */
function mergeSettings(settings, patch) {
  const src = patch !== null && typeof patch === "object" ? patch : {};
  const anki = src.anki !== null && typeof src.anki === "object" ? src.anki : {};
  return { ...settings, ...src, anki: { ...settings.anki, ...anki } };
}

/**
 * Export filename, dated by the worker: etymikon-anki-YYYYMMDD.txt for the
 * Anki file, etymikon-saved-YYYYMMDD.csv for the spreadsheet.
 */
function exportFilename(format, date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  return format === "csv" ? `etymikon-saved-${stamp}.csv` : `etymikon-anki-${stamp}.txt`;
}

/**
 * {type:"savedGet"} → the folder list plus every saved item PRE-JOINED against
 * the live data cache (identity-only storage, joined at read time).
 * @returns {Promise<{ok:true, folders:object[], items:object[]}|{ok:false, error:string}>}
 */
export async function handleSavedGet() {
  return withStorage(async (area) => {
    const state = await readSaved(area);
    return { ok: true, folders: state.folders, items: await joinSaved(state.items) };
  });
}

/**
 * {type:"savedToggle", kind, key} → save or unsave one identity. The folder
 * list rides along so the save bubble needs no second round-trip.
 * @returns {Promise<{ok:true, saved:boolean, item?:object, folderId?:string, folders:object[]}|{ok:false, error:string}>}
 */
export async function handleSavedToggle(kind, key) {
  return withStorage(async (area) => {
    const state = await readSaved(area);
    const settings = await readSettings(area, state);
    const result = toggleItem(state, kind, key, settings.defaultFolderId, Date.now());
    await writeSaved(area, result.state);
    const response = {
      ok: true,
      saved: result.saved,
      folders: result.state.folders,
    };
    if (result.item) {
      response.item = result.item;
      response.folderId = result.item.folderId;
    }
    return response;
  });
}

/**
 * {type:"savedCheck", keys:[{kind,key}]} → the one batched answer a render pass
 * needs, keyed "r:<key>" / "w:<key>".
 * @returns {Promise<{ok:true, saved:Record<string,boolean>}|{ok:false, error:string}>}
 */
export async function handleSavedCheck(keys) {
  return withStorage(async (area) => {
    const state = await readSaved(area);
    return { ok: true, saved: checkKeys(state, keys) };
  });
}

/**
 * {type:"savedRemove", ids} → drop saved items.
 * @returns {Promise<{ok:true, removed:number}|{ok:false, error:string}>}
 */
export async function handleSavedRemove(ids) {
  return withStorage(async (area) => {
    const { state, removed } = removeItems(await readSaved(area), ids);
    await writeSaved(area, state);
    return { ok: true, removed };
  });
}

/**
 * {type:"savedMove", ids, folderId} → re-home saved items.
 * @returns {Promise<{ok:true, moved:number}|{ok:false, error:string}>}
 */
export async function handleSavedMove(ids, folderId) {
  return withStorage(async (area) => {
    const { state, moved, error } = moveItems(await readSaved(area), ids, folderId);
    if (error !== null) return { ok: false, error };
    await writeSaved(area, state);
    return { ok: true, moved };
  });
}

/**
 * {type:"folderCreate", name} → a new folder.
 * @returns {Promise<{ok:true, folder:object}|{ok:false, error:string}>}
 */
export async function handleFolderCreate(name) {
  return withStorage(async (area) => {
    const { state, folder, error } = createFolder(await readSaved(area), name);
    if (error !== null) return { ok: false, error };
    await writeSaved(area, state);
    return { ok: true, folder };
  });
}

/**
 * {type:"folderRename", id, name} → rename a folder (f0 included, never to empty).
 * @returns {Promise<{ok:true, folder:object}|{ok:false, error:string}>}
 */
export async function handleFolderRename(id, name) {
  return withStorage(async (area) => {
    const { state, folder, error } = renameFolder(await readSaved(area), id, name);
    if (error !== null) return { ok: false, error };
    await writeSaved(area, state);
    return { ok: true, folder };
  });
}

/**
 * {type:"folderDelete", id} → delete a folder, moving its items to f0. When the
 * deleted folder was the "save new items to" target, the setting resets to f0
 * in the same serialized link, so no surface can observe a dangling default.
 * @returns {Promise<{ok:true, moved:number, settings:object}|{ok:false, error:string}>}
 */
export async function handleFolderDelete(id) {
  return withStorage(async (area) => {
    const before = await readSaved(area);
    const { state, moved, error } = deleteFolder(before, id);
    if (error !== null) return { ok: false, error };
    await writeSaved(area, state);
    const previous = await readSettings(area, before);
    const settings = normalizeSettings(previous, state);
    if (settings.defaultFolderId !== previous.defaultFolderId) {
      await writeSettings(area, settings);
    }
    return { ok: true, moved, settings };
  });
}

/**
 * {type:"settingsGet"} → the settings record, defaults filled in, plus the Anki
 * field tokens each setting may hold.
 *
 * `fields` rides along the same way `tier` rides along on a lookup match: the
 * settings view renders its Anki option lists straight out of the response, so
 * saved.js stays the only declaration of what the tokens are. A field added
 * there reaches the checkboxes with no edit on the view side, where a second
 * copy would instead give a control whose value normalizeSettings drops again.
 * @returns {Promise<{ok:true, settings:object, fields:object}|{ok:false, error:string}>}
 */
export async function handleSettingsGet() {
  return withStorage(async (area) => {
    const state = await readSaved(area);
    return { ok: true, settings: await readSettings(area, state), fields: ANKI_FIELDS };
  });
}

/**
 * {type:"settingsSet", patch} → merge, normalize, store, and hand back the
 * result (the settings view renders from the response, never from its guess).
 * @returns {Promise<{ok:true, settings:object}|{ok:false, error:string}>}
 */
export async function handleSettingsSet(patch) {
  return withStorage(async (area) => {
    const state = await readSaved(area);
    const current = await readSettings(area, state);
    const settings = normalizeSettings(mergeSettings(current, patch), state);
    await writeSettings(area, settings);
    return { ok: true, settings };
  });
}

/**
 * {type:"savedExport", ids? | folderIds? | all?, format} → the export file.
 * `format` is "anki" (default) or "csv"; `tsv` carries the body either way,
 * and the filename extension follows the format. Rows whose dictionary entry
 * is gone are skipped and counted.
 * @returns {Promise<{ok:true, tsv:string, count:number, skipped:number, filename:string}|{ok:false, error:string}>}
 */
export async function handleSavedExport(selection, format) {
  return withStorage(async (area) => {
    const state = await readSaved(area);
    const rows = await joinSaved(resolveExportSelection(state, selection));
    const skipped = rows.filter((row) => row.missing === true).length;
    const csv = format === "csv";
    // The Anki file is shaped by the field settings; the CSV is not, so it
    // does not pay for the settings read.
    const body = csv
      ? buildCsv(rows, state.folders)
      : buildAnkiTsv(rows, await readSettings(area, state), state.folders);
    return {
      ok: true,
      tsv: body,
      count: rows.length - skipped,
      skipped,
      filename: exportFilename(csv ? "csv" : "anki"),
    };
  });
}

/**
 * The message router, as a lookup map: the nested ternary it replaces stopped
 * being readable at sixteen types. Each entry takes the raw message and
 * returns the handler's promise. Exported so the tests can assert the routed
 * set against the SPEC without a chrome.runtime.
 */
export const MESSAGE_HANDLERS = {
  lookup: (m) => handleLookup(m.text),
  root: (m) => handleRoot(m.key),
  family: (m) => handleFamily(m.key, m.offset),
  openTab: (m) => handleOpenTab(m.url),
  getPendingQuery: () => handleGetPendingQuery(),
  savedGet: () => handleSavedGet(),
  savedToggle: (m) => handleSavedToggle(m.kind, m.key),
  savedCheck: (m) => handleSavedCheck(m.keys),
  savedRemove: (m) => handleSavedRemove(m.ids),
  savedMove: (m) => handleSavedMove(m.ids, m.folderId),
  folderCreate: (m) => handleFolderCreate(m.name),
  folderRename: (m) => handleFolderRename(m.id, m.name),
  folderDelete: (m) => handleFolderDelete(m.id),
  settingsGet: () => handleSettingsGet(),
  settingsSet: (m) => handleSettingsSet(m.patch),
  savedExport: (m) =>
    handleSavedExport({ ids: m.ids, folderIds: m.folderIds, all: m.all }, m.format),
};

/** The routed handler for a message, or null when nothing handles it. */
function routeMessage(message) {
  if (!message || typeof message.type !== "string") return null;
  if (!Object.prototype.hasOwnProperty.call(MESSAGE_HANDLERS, message.type)) return null;
  return MESSAGE_HANDLERS[message.type](message);
}

// Guarded so this module can also be imported by Node (tests) without chrome.
if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const handler = routeMessage(message);
    if (handler === null) return false;
    handler.then(sendResponse, (err) => {
      sendResponse({ ok: false, error: toErrorMessage(err) });
    });
    // Keep the message channel open for the async response.
    return true;
  });
}

// Sidebar: clicking the toolbar icon toggles the panel. The call is idempotent
// and Chrome persists the setting, so it runs both at top level (covers a
// plain worker restart) and on install/update. Guarded like the listener above
// so this module still imports cleanly in Node.
if (typeof chrome !== "undefined" && chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  const enableActionToggle = () => {
    // A rejection here costs the icon-click toggle and nothing else, since the
    // panel is still reachable from Chrome's own side-panel menu.
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  };
  enableActionToggle();
  if (chrome.runtime && chrome.runtime.onInstalled) {
    chrome.runtime.onInstalled.addListener(enableActionToggle);
  }
}

// Sidebar (gesture fix, verified on real Chrome 2026-08-17): the omnibox Enter
// gesture does NOT survive an awaited chrome.windows.getCurrent(), so
// sidePanel.open() must be the FIRST async call in the handler or it rejects
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
 * Sidebar (repeat omnibox searches): the push half of the handshake. The boot
 * pull only covers a COLD panel, since an already-open panel never re-asks, so
 * a second `et` query would sit unread until the next panel open. After the
 * panel is open, poke every live extension page so an open one pulls again.
 *
 * Everything is swallowed on purpose: a rejection here is the normal cold-open
 * case (no page was listening yet), and that page's boot pull collects the
 * query anyway. Read-once semantics are untouched, since only getPendingQuery
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

/** Sidebar: the panel page as a TAB, deep-linked with the typed query. */
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

// Omnibox keyword "et". Guarded like the listener above so this module still
// imports cleanly in Node.
if (typeof chrome !== "undefined" && chrome.omnibox && chrome.omnibox.onInputChanged) {
  // Chrome PARSES a suggestion description as XML, and the %s substitution is
  // Chrome's own: a description set here can never escape the text that lands
  // in it, whatever markup surrounds the placeholder. So the wiring-time
  // default carries neither markup nor placeholder, and the row that echoes
  // the query is set per keystroke below, where the typed text goes through
  // the same escapeXml every suggestion row uses.
  chrome.omnibox.setDefaultSuggestion({ description: "Search Etymikon" });

  chrome.omnibox.onInputChanged.addListener((text, suggest) => {
    const typed = typeof text === "string" ? text : "";
    chrome.omnibox.setDefaultSuggestion({
      description: typed === ""
        ? "Search Etymikon"
        : `Search Etymikon for <match>${escapeXml(typed)}</match>`,
    });
    (async () => {
      try {
        const data = await getData();
        // Sizes, not ranked lists: the omnibox index is the cheap one.
        suggest(buildOmniboxSuggestions(text, { ...data, searchIndex: getSearchIndex(data) }));
      } catch {
        // Data unavailable (offline install, mid-update): no rows, no noise.
        suggest([]);
      }
    })();
  });

  // Sidebar: Enter on an omnibox row opens the PANEL and leaves the query for
  // it to pull at boot. Only if the panel refuses to open does the old tab
  // behavior stand in, and then the pending query is dropped, since the tab
  // path carries the query in its URL and a leftover would re-run this search
  // the next time the panel opens for any other reason.
  chrome.omnibox.onInputEntered.addListener((text, disposition) => {
    // No panel API, or the worker somehow has no window id yet: straight to
    // the tab path (which needs no gesture and carries the query in its URL).
    if (!chrome.sidePanel || !chrome.sidePanel.open || focusedWindowId === null) {
      openSearchTab(text, disposition);
      return;
    }
    setPendingQuery(text);
    try {
      // Called SYNCHRONOUSLY in the gesture, see the focusedWindowId note.
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
