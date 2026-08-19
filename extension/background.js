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
  isLevel,
  lookup,
  toErrorMessage,
} from "./lookup.js";
import {
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
  hanja: "data/hanja.json",
  words: "data/words.json",
  variants: "data/variants.json",
  // Romanized search ADDENDUM: the forward-generated RR index.
  rr: "data/rr.json",
  // Decomposition ADDENDUM: display glyph + click target per character.
  decomp: "data/decomp.json",
};

/**
 * Shape guard for rr.json. A bundle mid-update (or one built before the
 * romanization addendum) must cost the interpreter nothing worse than finding
 * no candidates, so the tables are always objects.
 */
function guardRr(raw) {
  const rr = raw !== null && typeof raw === "object" ? raw : {};
  const table = (v) => (v !== null && typeof v === "object" ? v : {});
  return { v: 1, words: table(rr.words), syllables: table(rr.syllables) };
}

const hasOwn = (obj, key) =>
  obj !== null && obj !== undefined &&
  Object.prototype.hasOwnProperty.call(obj, key);

/**
 * Shape guard for decomp.json, in the guardRr spirit: a bundle without the
 * file (or with an older one) must leave lookups working, with the feature
 * simply absent.
 */
export function guardDecomp(raw) {
  const d = raw !== null && typeof raw === "object" ? raw : {};
  const parts = d.parts !== null && typeof d.parts === "object" ? d.parts : {};
  return { v: 1, parts: d.v === 1 ? parts : {} };
}

/**
 * The reading a joined row shows for one hanja.json entry. Some entries carry
 * an empty `eumhun` list and a non-empty `readings` array (或 reads 혹 with no
 * hun recorded); without the fallback those rows would render as a bare gloss.
 * The first eumhun pair still wins whenever there is one.
 */
function joinReading(entry) {
  const pair = (Array.isArray(entry.eumhun) ? entry.eumhun : [])[0];
  if (pair && typeof pair === "object") {
    return {
      hun: typeof pair.hun === "string" ? pair.hun : "",
      eum: typeof pair.eum === "string" ? pair.eum : "",
    };
  }
  const eum = (Array.isArray(entry.readings) ? entry.readings : [])[0];
  return { hun: "", eum: typeof eum === "string" ? eum : "" };
}

/**
 * Decomposition ADDENDUM: turn one emitted row into the response row the
 * renderer draws. Emitted rows are [g], [g,t], [g,null] or [g,null,name];
 * a row is clickable when its length is 1 or slot 2 is a string. The target's
 * eumhun and gloss are joined HERE because the content script has no access to
 * hanja.json, and a target with no entry degrades to an inert row rather than
 * a click that would land nowhere.
 */
function decompRow(row, hanjaTable) {
  if (!Array.isArray(row)) return null;
  const g = typeof row[0] === "string" ? row[0] : "";
  if (!g) return null;
  const clickable = row.length === 1 || typeof row[1] === "string";
  if (!clickable) {
    const out = { g };
    if (typeof row[2] === "string" && row[2] !== "") out.name = row[2];
    return out;
  }
  const t = typeof row[1] === "string" ? row[1] : g;
  const entry = hasOwn(hanjaTable, t) ? hanjaTable[t] : null;
  if (!entry || typeof entry !== "object") return { g };
  const reading = joinReading(entry);
  return {
    g,
    t,
    hun: reading.hun,
    eum: reading.eum,
    gloss: (Array.isArray(entry.glosses) ? entry.glosses : [])[0] ?? "",
  };
}

/** Hang `parts` on every char match the decomposition table knows about. */
export function attachDecomp(result, data) {
  if (!result || result.ok !== true || !Array.isArray(result.matches)) return result;
  const table = data.decomp.parts;
  // hanja.json is {chars, version}; the join reads the chars table, the same
  // reach-through lookup.js does. Passing the whole file would miss every
  // target and silently degrade every part to an inert glyph.
  const charTable = (data.hanja && data.hanja.chars) || {};
  for (const match of result.matches) {
    if (!match || match.kind !== "char") continue;
    const char = typeof match.canonical === "string" ? match.canonical : "";
    if (!char || !hasOwn(table, char)) continue;
    const rows = table[char];
    if (!Array.isArray(rows)) continue;
    const parts = rows.map((row) => decompRow(row, charTable)).filter(Boolean);
    if (parts.length) match.parts = parts;
  }
  return result;
}

/**
 * Recomposition ADDENDUM: the reverse of decomp.json, DERIVED at runtime and
 * stored nowhere. Scan the table once and credit each row's TARGET (the aliased
 * character: an 亻 row credits 人) with the character the row belongs to. Only
 * clickable rows count, since an inert row names no character.
 *
 * Pure in the decomp table alone: no hanja.json, no ranking. Any change to a
 * decomposition changes the lists on the next worker start, and nothing else
 * has to be rebuilt. The eumhun join and the ranking happen per query.
 *
 * @param {Record<string, Array>} decompTable decomp.parts
 * @returns {Record<string, string[]>} target -> containing characters
 */
export function buildFoundInIndex(decompTable) {
  const table = decompTable !== null && typeof decompTable === "object" ? decompTable : {};
  /** @type {Record<string, string[]>} */
  const index = Object.create(null);
  for (const char of Object.keys(table)) {
    const rows = table[char];
    if (!Array.isArray(rows)) continue;
    // Per containing character, so 雙 (隹 twice) appears once in 隹's list.
    const credited = new Set();
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const g = typeof row[0] === "string" ? row[0] : "";
      if (!g) continue;
      const clickable = row.length === 1 || typeof row[1] === "string";
      if (!clickable) continue;
      const target = typeof row[1] === "string" ? row[1] : g;
      // A character is never found in itself.
      if (target === char || credited.has(target)) continue;
      credited.add(target);
      if (index[target] === undefined) index[target] = [];
      index[target].push(char);
    }
  }
  return index;
}

/**
 * Recomposition ADDENDUM: one target's list, joined against hanja.json into the
 * fields the reading-list rows draw, ranked by cwCount descending with ties by
 * codepoint so the order is stable across runs. A containing character with no
 * hanja.json entry is dropped rather than rendered as a row that would navigate
 * nowhere (the emit is restricted to hanja.json characters, so this is a guard,
 * not a case).
 */
export function buildFoundIn(char, index, hanjaData) {
  if (typeof char !== "string" || char === "") return [];
  const charTable = (hanjaData && hanjaData.chars) || {};
  const list = hasOwn(index, char) ? index[char] : null;
  if (!Array.isArray(list)) return [];
  const ranks = new Map();
  const rows = [];
  for (const containing of list) {
    const entry = hasOwn(charTable, containing) ? charTable[containing] : null;
    if (!entry || typeof entry !== "object") continue;
    const reading = joinReading(entry);
    const row = {
      char: containing,
      hun: reading.hun,
      eum: reading.eum,
      gloss: (Array.isArray(entry.glosses) ? entry.glosses : [])[0] ?? "",
    };
    if (isLevel(entry.lvl)) row.lvl = entry.lvl;
    ranks.set(containing, Array.isArray(entry.cw) ? entry.cw.length : 0);
    rows.push(row);
  }
  rows.sort(
    (a, b) =>
      (ranks.get(b.char) || 0) - (ranks.get(a.char) || 0) ||
      a.char.codePointAt(0) - b.char.codePointAt(0)
  );
  return rows;
}

/**
 * Hang `foundInCount` on every char match the index knows about, usedInCount
 * style (omitted when 0). `getIndex` is a thunk so a lookup with no char match
 * never pays for building the index.
 */
export function attachFoundIn(result, getIndex) {
  if (!result || result.ok !== true || !Array.isArray(result.matches)) return result;
  let index = null;
  for (const match of result.matches) {
    if (!match || match.kind !== "char") continue;
    const char = typeof match.canonical === "string" ? match.canonical : "";
    if (!char) continue;
    if (index === null) index = getIndex();
    const list = hasOwn(index, char) ? index[char] : null;
    if (Array.isArray(list) && list.length > 0) match.foundInCount = list.length;
  }
  return result;
}

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

/**
 * Recomposition ADDENDUM: target -> containing characters, derived from
 * decomp.json at runtime (not a data file). Cached and cleared exactly like the
 * reading index, so an updated bundle rebuilds it with no other work.
 * @type {Record<string, string[]>|null}
 */
let foundInIndex = null;

async function fetchJson(path) {
  const url = chrome.runtime.getURL(path);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${path} (HTTP ${response.status})`);
  }
  return response.json();
}

/** Lazily load + cache the five data files. Failures clear the cache so a later lookup can retry. */
function getData() {
  if (dataPromise === null) {
    dataPromise = (async () => {
      const [hanja, words, variants, rr, decomp] = await Promise.all([
        fetchJson(DATA_FILES.hanja),
        fetchJson(DATA_FILES.words),
        fetchJson(DATA_FILES.variants),
        fetchJson(DATA_FILES.rr),
        // Absent or malformed: guardDecomp yields an empty table and no card
        // shows a Made of row.
        fetchJson(DATA_FILES.decomp).catch(() => null),
      ]);
      return { hanja, words, variants, rr: guardRr(rr), decomp: guardDecomp(decomp) };
    })();
    dataPromise.catch(() => {
      dataPromise = null;
      readingIndex = null;
      foundInIndex = null;
    });
  }
  return dataPromise;
}

/** The found-in index for the loaded bundle, built on first use. */
function getFoundInIndex(data) {
  if (foundInIndex === null) foundInIndex = buildFoundInIndex(data.decomp.parts);
  return foundInIndex;
}

/**
 * Handle a {type:"lookup", text, interpret} message.
 *
 * Romanized search ADDENDUM (input-channel rule): `interpret` is set only by
 * free-typed entry points (the search shell, the omnibox, `?q=` deep links,
 * the pending query). Everything else — every internal navigation — arrives
 * without it and gets a literal lookup.
 * @returns {Promise<{ok:true, matches:object[]}|{ok:false, error:string}>}
 */
export async function handleLookup(text, interpret) {
  try {
    const data = await getData();
    const result = lookup(
      text,
      {
        ...data,
        getReadingIndex: () => {
          if (readingIndex === null) readingIndex = buildReadingIndex(data.hanja);
          return readingIndex;
        },
      },
      { interpret: interpret === true }
    );
    return attachFoundIn(attachDecomp(result, data), () => getFoundInIndex(data));
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
 * Handle a {type:"foundIn", char} message (recomposition ADDENDUM): every
 * character this one is a part of, ranked, joined against hanja.json. The
 * incoming char is NFC-normalized and variant-mapped like any lookup input.
 * @returns {Promise<{ok:true, chars:object[]}|{ok:false, error:string}>}
 */
export async function handleFoundIn(char) {
  try {
    const data = await getData();
    if (typeof char !== "string" || char === "") return { ok: true, chars: [] };
    const variantMap = data.variants?.map ?? {};
    const normalized = char.normalize("NFC");
    const canonical = hasOwn(variantMap, normalized) ? variantMap[normalized] : normalized;
    return { ok: true, chars: buildFoundIn(canonical, getFoundInIndex(data), data.hanja) };
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

// ---------------------------------------------------------------------------
// Saved words + settings (ADDENDUM): the worker is the single writer.
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
 * The serialization chain. Every saved/settings handler — reads included —
 * runs as one link, so a read-modify-write can never interleave with another
 * one no matter how many surfaces message the worker at once. A rejected link
 * never breaks the chain: the tail is always a settled, ignored promise.
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
 * Storage guard + serialization + error envelope, shared by all eleven
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

/** Read + normalize the saved state. Storage is only rewritten on a change. */
async function readSaved(area) {
  return normalizeSavedState(await readKey(area, SAVED_KEY));
}

/** Read + normalize settings, resetting a default folder that no longer exists. */
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
 * Shallow patch merge, one level deep through `anki` so a settings control can
 * send `{anki:{wordFront:"hangul"}}` without resetting its sibling fields.
 */
function mergeSettings(settings, patch) {
  const src = patch !== null && typeof patch === "object" ? patch : {};
  const anki = src.anki !== null && typeof src.anki === "object" ? src.anki : {};
  return { ...settings, ...src, anki: { ...settings.anki, ...anki } };
}

/**
 * Export filename, dated by the worker: okpyeon-anki-YYYYMMDD.txt for the Anki
 * file, okpyeon-saved-YYYYMMDD.csv for the spreadsheet.
 */
function exportFilename(format, date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  return format === "csv" ? `okpyeon-saved-${stamp}.csv` : `okpyeon-anki-${stamp}.txt`;
}

/**
 * {type:"savedGet"} → the folder list plus every saved item PRE-JOINED against
 * the live data cache (identity-only storage, joined at read time).
 * @returns {Promise<{ok:true, folders:object[], items:object[]}|{ok:false, error:string}>}
 */
export async function handleSavedGet() {
  return withStorage(async (area) => {
    const state = await readSaved(area);
    const data = await getData();
    return { ok: true, folders: state.folders, items: joinItems(state.items, data) };
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
 * needs, keyed "c:<key>" / "w:<key>".
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
 * {type:"settingsGet"} → the settings record, defaults filled in.
 * @returns {Promise<{ok:true, settings:object}|{ok:false, error:string}>}
 */
export async function handleSettingsGet() {
  return withStorage(async (area) => {
    const state = await readSaved(area);
    return { ok: true, settings: await readSettings(area, state) };
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
    const data = await getData();
    const rows = joinItems(resolveExportSelection(state, selection), data);
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
  lookup: (m) => handleLookup(m.text, m.interpret === true),
  compounds: (m) => handleCompounds(m.char),
  usedIn: (m) => handleUsedIn(m.word),
  foundIn: (m) => handleFoundIn(m.char),
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
        // The omnibox is a typed channel, so it always interprets.
        suggest(buildOmniboxSuggestions(text, await getData(), { interpret: true }));
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
