/**
 * Etymikon: pure saved-items and settings logic.
 *
 * This module deliberately contains NO chrome.* API usage so that it can be
 * imported and unit-tested in plain Node (see test/lookup.test.mjs), exactly
 * like ./lookup.js. background.js is the only writer and is nothing but glue:
 * read storage -> call a function here -> write the returned state back.
 *
 * Every function takes state in and returns NEW state; input state is never
 * mutated. Implements SPEC.md "Saved items" plus the Anki and CSV field spec.
 *
 * The one import is ./lookup.js, the sibling pure module, for the fold, the
 * tier function and the root label line. Each must have exactly one definition
 * in the extension, and that definition is there.
 */

import { fold, rootLabel, tierOf, TIER_LABELS } from "./lookup.js";

/** Schema version of the `okpSaved` record. */
export const SAVED_VERSION = 1;
/** Schema version of the `okpSettings` record. */
export const SETTINGS_VERSION = 1;

/** The folder that always exists: it cannot be deleted or renamed to empty. */
export const DEFAULT_FOLDER_ID = "f0";
/** Name given to the default folder when storage carries none. */
export const DEFAULT_FOLDER_NAME = "Saved";

/** Anki front tokens for word items. */
export const WORD_FRONT_FIELDS = ["word", "defs"];
/** Anki back tokens for word items. */
export const WORD_BACK_FIELDS = ["word", "defs", "breakdown", "tier"];
/** Anki front tokens for root items. */
export const ROOT_FRONT_FIELDS = ["root", "gloss"];
/** Anki back tokens for root items. */
export const ROOT_BACK_FIELDS = ["root", "source", "gloss", "family"];

/**
 * The tokens each Anki setting OFFERS, keyed by its `anki.<name>` path tail.
 *
 * The four lists above are the declaration; this is how they reach a UI. The
 * worker hands this map to the settings view in the settingsGet response, so no
 * surface restates the token lists and a field added above renders on its
 * control with no other edit. (A surface keeping its own copy instead gives a
 * control whose value normalizeSettings drops again: a checkbox that silently
 * refuses to stay checked.)
 *
 * Offering and accepting are the same set per setting, since normalizeSettings
 * below validates each one against the very list named here.
 */
export const ANKI_FIELDS = Object.freeze({
  wordFront: WORD_FRONT_FIELDS,
  wordBack: WORD_BACK_FIELDS,
  rootFront: ROOT_FRONT_FIELDS,
  rootBack: ROOT_BACK_FIELDS,
});

/** The Anki family field lists this many words. */
export const FAMILY_FIELD_WORDS = 5;

/** SPEC defaults for `okpSettings`. */
export const DEFAULT_SETTINGS = Object.freeze({
  v: SETTINGS_VERSION,
  defaultFolderId: DEFAULT_FOLDER_ID,
  anki: Object.freeze({
    wordFront: "word",
    wordBack: Object.freeze(["defs", "breakdown"]),
    rootFront: "root",
    rootBack: Object.freeze(["gloss", "family"]),
  }),
});

/**
 * Columns of the CSV export, in order. The `defs` column carries the
 * definitions of a word row and the gloss of a root row: one text column, per
 * the SPEC's "defs/gloss".
 */
export const CSV_COLUMNS = [
  "kind",
  "key",
  "defs",
  "breakdown",
  "tier",
  "folder",
  "added",
];

/** Separator between the back fields of one Anki note. */
const FIELD_SEPARATOR = " · ";
/** Separator between the entries inside one multi-value field. */
const ENTRY_SEPARATOR = ", ";
/** Separator between the morphemes of a breakdown. */
const MORPH_SEPARATOR = " + ";

const hasOwn = (obj, key) =>
  obj !== null && typeof obj === "object" &&
  Object.prototype.hasOwnProperty.call(obj, key);

/** The `savedCheck` map key for an identity: "r:<root key>" / "w:<word>". */
export function savedMapKey(kind, key) {
  return `${kind === "root" ? "r" : "w"}:${key}`;
}

/**
 * A saved key at the storage boundary: SPEC rule 2's fold, the same one a
 * lookup runs. Identity is (kind, key), so an NFD key and its NFC twin have to
 * BE the same key here or the same root saves twice and neither star syncs.
 */
function cleanKey(key) {
  return typeof key === "string" ? fold(key) : "";
}

/** The two saved kinds, or null for anything else. */
function validKind(kind) {
  return kind === "root" ? "root" : kind === "word" ? "word" : null;
}

/** Numeric tail of an "f12" / "i7" style id, or null when the id is not one. */
function idNumber(id, prefix) {
  if (typeof id !== "string" || !id.startsWith(prefix)) return null;
  const tail = id.slice(prefix.length);
  return /^\d+$/.test(tail) ? Number(tail) : null;
}

/** A counter must clear every id already in use, plus whatever storage stored. */
function counterFrom(stored, used) {
  const base = Number.isInteger(stored) && stored >= 0 ? stored : 0;
  return used.reduce((max, n) => (n >= max ? n + 1 : max), base);
}

/**
 * Coerce anything at all (missing record, older shape, hand-edited junk) into a
 * valid v1 saved state. Items whose kind or key is unusable are dropped;
 * items pointing at a folder that no longer exists fall back to f0; duplicate
 * identities collapse to the first one (identity is (kind, key) by SPEC, so
 * duplicates are structurally impossible downstream).
 *
 * @param {*} raw whatever was in chrome.storage.local under "okpSaved"
 * @returns {{v:number, folders:object[], items:object[], nextFolder:number, nextItem:number}}
 */
export function normalizeSavedState(raw) {
  const src = raw !== null && typeof raw === "object" ? raw : {};

  const folders = [];
  const folderIds = new Set();
  for (const folder of Array.isArray(src.folders) ? src.folders : []) {
    if (folder === null || typeof folder !== "object") continue;
    const id = typeof folder.id === "string" ? folder.id : "";
    const name = typeof folder.name === "string" ? folder.name.trim() : "";
    if (id === "" || folderIds.has(id)) continue;
    // A nameless folder is unusable in every UI; f0 is instead renamed back to
    // its default, since it is the one folder that must always exist.
    if (name === "" && id !== DEFAULT_FOLDER_ID) continue;
    folderIds.add(id);
    folders.push({ id, name: name === "" ? DEFAULT_FOLDER_NAME : name });
  }
  if (!folderIds.has(DEFAULT_FOLDER_ID)) {
    folderIds.add(DEFAULT_FOLDER_ID);
    folders.unshift({ id: DEFAULT_FOLDER_ID, name: DEFAULT_FOLDER_NAME });
  }

  // Pass 1: keep the valid items, remembering which ids survived so the
  // counters can be seeded before any replacement id is minted.
  const kept = [];
  const itemIds = new Set();
  const identities = new Set();
  for (const item of Array.isArray(src.items) ? src.items : []) {
    if (item === null || typeof item !== "object") continue;
    const kind = validKind(item.kind);
    const key = cleanKey(item.key);
    if (kind === null || key === "") continue;
    const identity = savedMapKey(kind, key);
    if (identities.has(identity)) continue;
    identities.add(identity);
    const id = typeof item.id === "string" && idNumber(item.id, "i") !== null &&
      !itemIds.has(item.id)
      ? item.id
      : null;
    if (id !== null) itemIds.add(id);
    kept.push({
      id,
      kind,
      key,
      folderId: folderIds.has(item.folderId) ? item.folderId : DEFAULT_FOLDER_ID,
      addedAt: Number.isFinite(item.addedAt) && item.addedAt >= 0 ? item.addedAt : 0,
    });
  }

  const nextFolder = counterFrom(
    src.nextFolder,
    [...folderIds].map((id) => idNumber(id, "f")).filter((n) => n !== null)
  );
  let nextItem = counterFrom(
    src.nextItem,
    [...itemIds].map((id) => idNumber(id, "i")).filter((n) => n !== null)
  );

  // Pass 2: mint ids for the items that arrived without a usable one.
  const items = kept.map((item) => {
    if (item.id !== null) return item;
    const id = `i${nextItem}`;
    nextItem += 1;
    return { ...item, id };
  });

  return { v: SAVED_VERSION, folders, items, nextFolder, nextItem };
}

/** The first valid token, else the default. */
function oneOf(value, allowed, fallback) {
  return typeof value === "string" && allowed.includes(value) ? value : fallback;
}

/** Valid tokens of a checkset, in the given order, deduped. A non-array resets. */
function manyOf(value, allowed, fallback) {
  if (!Array.isArray(value)) return [...fallback];
  const out = [];
  for (const token of value) {
    if (typeof token !== "string" || !allowed.includes(token) || out.includes(token)) {
      continue;
    }
    out.push(token);
  }
  // An emptied checkset is a legitimate user choice, so it is kept as-is.
  return out;
}

/**
 * Coerce anything into valid v1 settings (defaults + version fill).
 *
 * @param {*} raw whatever was in chrome.storage.local under "okpSettings"
 * @param {*} [savedState] when given, a defaultFolderId naming a folder that no
 *   longer exists resets to f0 (SPEC: deleting the default folder resets it)
 */
export function normalizeSettings(raw, savedState) {
  const src = raw !== null && typeof raw === "object" ? raw : {};
  const anki = src.anki !== null && typeof src.anki === "object" ? src.anki : {};

  let defaultFolderId =
    typeof src.defaultFolderId === "string" && src.defaultFolderId !== ""
      ? src.defaultFolderId
      : DEFAULT_FOLDER_ID;
  if (savedState !== undefined && savedState !== null) {
    const { folders } = normalizeSavedState(savedState);
    if (!folders.some((f) => f.id === defaultFolderId)) {
      defaultFolderId = DEFAULT_FOLDER_ID;
    }
  }

  return {
    v: SETTINGS_VERSION,
    defaultFolderId,
    anki: {
      wordFront: oneOf(anki.wordFront, WORD_FRONT_FIELDS, DEFAULT_SETTINGS.anki.wordFront),
      wordBack: manyOf(anki.wordBack, WORD_BACK_FIELDS, DEFAULT_SETTINGS.anki.wordBack),
      rootFront: oneOf(anki.rootFront, ROOT_FRONT_FIELDS, DEFAULT_SETTINGS.anki.rootFront),
      rootBack: manyOf(anki.rootBack, ROOT_BACK_FIELDS, DEFAULT_SETTINGS.anki.rootBack),
    },
  };
}

/**
 * Save or unsave one identity. Identity is (kind, key): toggling an identity
 * that is already saved REMOVES it, wherever it sits, so duplicates cannot
 * exist. A new item lands in `defaultFolderId` (f0 when that folder is gone).
 *
 * @returns {{state:object, saved:boolean, item?:object}} `item` only on a save
 */
export function toggleItem(state, kind, key, defaultFolderId, now) {
  const next = normalizeSavedState(state);
  const clean = validKind(kind);
  const wanted = cleanKey(key);
  if (clean === null || wanted === "") return { state: next, saved: false };

  const index = next.items.findIndex(
    (item) => item.kind === clean && item.key === wanted
  );
  if (index !== -1) {
    const items = next.items.filter((_, i) => i !== index);
    return { state: { ...next, items }, saved: false };
  }

  const folderId = next.folders.some((f) => f.id === defaultFolderId)
    ? defaultFolderId
    : DEFAULT_FOLDER_ID;
  const item = {
    id: `i${next.nextItem}`,
    kind: clean,
    key: wanted,
    folderId,
    addedAt: Number.isFinite(now) && now >= 0 ? now : 0,
  };
  return {
    state: { ...next, items: [...next.items, item], nextItem: next.nextItem + 1 },
    saved: true,
    item,
  };
}

/**
 * Saved-state of a batch of identities, for the one batched savedCheck a
 * render pass sends. Every requested key gets a boolean.
 *
 * @param {object} state saved state
 * @param {Array<{kind:string, key:string}>} keys
 * @returns {Record<string, boolean>} keyed "r:<key>" / "w:<key>"
 */
export function checkKeys(state, keys) {
  const next = normalizeSavedState(state);
  const saved = new Set(next.items.map((item) => savedMapKey(item.kind, item.key)));
  const out = {};
  for (const entry of Array.isArray(keys) ? keys : []) {
    if (entry === null || typeof entry !== "object") continue;
    const kind = validKind(entry.kind);
    const key = cleanKey(entry.key);
    if (kind === null || key === "") continue;
    const mapKey = savedMapKey(kind, key);
    out[mapKey] = saved.has(mapKey);
  }
  return out;
}

/**
 * Add a folder. Ids come from the state's monotonic counter, so a deleted
 * folder's id is never reused.
 * @returns {{state:object, folder:object|null, error:string|null}}
 */
export function createFolder(state, name) {
  const next = normalizeSavedState(state);
  const clean = typeof name === "string" ? name.trim() : "";
  if (clean === "") return { state: next, folder: null, error: "folder name required" };
  const folder = { id: `f${next.nextFolder}`, name: clean };
  return {
    state: {
      ...next,
      folders: [...next.folders, folder],
      nextFolder: next.nextFolder + 1,
    },
    folder,
    error: null,
  };
}

/**
 * Rename a folder. f0 may be renamed, but never to an empty name: it is the
 * one folder that must always be nameable in the UI.
 * @returns {{state:object, folder:object|null, error:string|null}}
 */
export function renameFolder(state, id, name) {
  const next = normalizeSavedState(state);
  const clean = typeof name === "string" ? name.trim() : "";
  const index = next.folders.findIndex((f) => f.id === id);
  if (index === -1) return { state: next, folder: null, error: "no such folder" };
  if (clean === "") return { state: next, folder: null, error: "folder name required" };
  const folder = { id: next.folders[index].id, name: clean };
  const folders = next.folders.slice();
  folders[index] = folder;
  return { state: { ...next, folders }, folder, error: null };
}

/**
 * Delete a folder and move its items to f0. f0 itself cannot be deleted.
 * @returns {{state:object, moved:number, error:string|null}} moved = items rehomed
 */
export function deleteFolder(state, id) {
  const next = normalizeSavedState(state);
  if (id === DEFAULT_FOLDER_ID) {
    return { state: next, moved: 0, error: "the default folder cannot be deleted" };
  }
  if (!next.folders.some((f) => f.id === id)) {
    return { state: next, moved: 0, error: "no such folder" };
  }
  let moved = 0;
  const items = next.items.map((item) => {
    if (item.folderId !== id) return item;
    moved += 1;
    return { ...item, folderId: DEFAULT_FOLDER_ID };
  });
  return {
    state: { ...next, folders: next.folders.filter((f) => f.id !== id), items },
    moved,
    error: null,
  };
}

/**
 * Move the given item ids into one folder.
 * @returns {{state:object, moved:number, error:string|null}} moved counts items
 *   whose folder actually changed (a move into the current folder counts 0)
 */
export function moveItems(state, ids, folderId) {
  const next = normalizeSavedState(state);
  if (!next.folders.some((f) => f.id === folderId)) {
    return { state: next, moved: 0, error: "no such folder" };
  }
  const wanted = new Set(Array.isArray(ids) ? ids : []);
  let moved = 0;
  const items = next.items.map((item) => {
    if (!wanted.has(item.id) || item.folderId === folderId) return item;
    moved += 1;
    return { ...item, folderId };
  });
  return { state: { ...next, items }, moved, error: null };
}

/**
 * Remove the given item ids.
 * @returns {{state:object, removed:number}}
 */
export function removeItems(state, ids) {
  const next = normalizeSavedState(state);
  const wanted = new Set(Array.isArray(ids) ? ids : []);
  const items = next.items.filter((item) => !wanted.has(item.id));
  return { state: { ...next, items }, removed: next.items.length - items.length };
}

/**
 * Resolve an export selection to items, in saved order. Explicit ids win over
 * folders, folders over `all`; an empty selection exports nothing (the caller,
 * not this module, decides that "nothing checked" means the current filter).
 *
 * @param {object} state saved state
 * @param {{ids?:string[], folderIds?:string[], all?:boolean}} selection
 * @returns {object[]} items
 */
export function resolveExportSelection(state, selection) {
  const next = normalizeSavedState(state);
  const sel = selection !== null && typeof selection === "object" ? selection : {};
  const ids = Array.isArray(sel.ids) ? sel.ids.filter((v) => typeof v === "string") : [];
  if (ids.length > 0) {
    const wanted = new Set(ids);
    return next.items.filter((item) => wanted.has(item.id));
  }
  const folderIds = Array.isArray(sel.folderIds)
    ? sel.folderIds.filter((v) => typeof v === "string")
    : [];
  if (folderIds.length > 0) {
    const wanted = new Set(folderIds);
    return next.items.filter((item) => wanted.has(item.folderId));
  }
  return sel.all === true ? next.items.slice() : [];
}

/** Every definition of a words.json entry, in POS order, empties dropped. */
function allDefs(entry) {
  const out = [];
  for (const sense of Array.isArray(entry.senses) ? entry.senses : []) {
    if (sense === null || typeof sense !== "object") continue;
    for (const def of Array.isArray(sense.defs) ? sense.defs : []) {
      if (typeof def === "string" && def !== "") out.push(def);
    }
  }
  return out;
}

/** words.json entry -> display row, or null when the word is unknown. */
function joinWord(item, wordTable) {
  if (!hasOwn(wordTable, item.key)) return null;
  const entry = wordTable[item.key];
  if (entry === null || typeof entry !== "object") return null;
  const morphs = (Array.isArray(entry.morphs) ? entry.morphs : [])
    .map((morph) => (morph && typeof morph.f === "string" ? morph.f : ""))
    .filter((form) => form !== "");
  const row = {
    ...item,
    defs: allDefs(entry),
    breakdown: morphs.join(MORPH_SEPARATOR),
    tier: tierOf(entry.fr),
  };
  if (Number.isInteger(entry.fr) && entry.fr > 0) row.fr = entry.fr;
  return row;
}

/**
 * roots.json entry -> display row, or null when the root is unknown.
 *
 * `family` is cut to the FAMILY_FIELD_WORDS the Anki field prints, at the join
 * rather than at the field: the whole ranked family of five big affixes came to
 * 181 KB (measured 2026-08-24) and nothing downstream ever looked past the
 * fifth word. `familyCount` still counts the whole family, since the saved view
 * shows the root's weight.
 */
function joinRoot(item, rootTable, familyIndex) {
  if (!hasOwn(rootTable, item.key)) return null;
  const entry = rootTable[item.key];
  if (entry === null || typeof entry !== "object") return null;
  const lang = typeof entry.lang === "string" ? entry.lang : item.key.split(":")[0];
  const kind = typeof entry.kind === "string" ? entry.kind : "root";
  const family = hasOwn(familyIndex, item.key) ? familyIndex[item.key] : [];
  return {
    ...item,
    form: typeof entry.form === "string" ? entry.form : "",
    gloss: typeof entry.gloss === "string" ? entry.gloss : "",
    lang,
    source: rootLabel(lang, kind),
    family: Array.isArray(family) ? family.slice(0, FAMILY_FIELD_WORDS) : [],
    familyCount: Array.isArray(family) ? family.length : 0,
  };
}

/**
 * Join identity-only saved items against live data (the worker's cache), the
 * same shape background.js's getData() returns plus the derived family index.
 * An item whose entry is gone from the dictionary becomes a `{missing:true}`
 * row rather than vanishing: the saved view says so, and the exporter skips
 * and counts it.
 *
 * @param {object[]} items saved items
 * @param {{words:object, roots:object, familyIndex?:object}} data
 * @returns {object[]} display rows, one per item, in the given order
 */
export function joinItems(items, data) {
  const wordTable = data?.words?.words ?? {};
  const rootTable = data?.roots?.roots ?? {};
  const familyIndex = data?.familyIndex ?? {};
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (item === null || typeof item !== "object") continue;
    const row =
      item.kind === "root"
        ? joinRoot(item, rootTable, familyIndex)
        : joinWord(item, wordTable);
    out.push(row === null ? { ...item, missing: true } : row);
  }
  return out;
}

/** SPEC: definitions render as one numbered string over ALL definitions. */
function numberedDefs(defs) {
  return (Array.isArray(defs) ? defs : [])
    .filter((def) => typeof def === "string" && def !== "")
    .map((def, i) => `${i + 1}. ${def}`)
    .join("; ");
}

/** One Anki field token rendered from a joined row. */
function fieldValue(row, token) {
  switch (token) {
    // "key" is not an Anki token: it is how the CSV asks for the identity
    // under a kind-neutral name.
    case "word":
    case "key":
      return typeof row.key === "string" ? row.key : "";
    case "root":
      // The card's headword is the root's form, not its "<lang>:<form>" key.
      return typeof row.form === "string" && row.form !== ""
        ? row.form
        : typeof row.key === "string"
          ? row.key
          : "";
    case "defs":
      return numberedDefs(row.defs);
    case "gloss":
      return typeof row.gloss === "string" ? row.gloss : "";
    case "breakdown":
      return typeof row.breakdown === "string" ? row.breakdown : "";
    case "tier":
      return TIER_LABELS[row.tier] ?? "";
    case "source":
      return typeof row.source === "string" ? row.source : "";
    case "family":
      return (Array.isArray(row.family) ? row.family : [])
        .filter((word) => typeof word === "string" && word !== "")
        .slice(0, FAMILY_FIELD_WORDS)
        .join(ENTRY_SEPARATOR);
    default:
      return "";
  }
}

/**
 * CSV-style quoting: a field carrying a tab, a newline or a double quote is
 * wrapped in double quotes with the inner quotes doubled. Anki's TSV importer
 * reads exactly this.
 */
function tsvField(value) {
  return /[\t\n\r"]/.test(value) ? `"${value.split('"').join('""')}"` : value;
}

/**
 * The folder's name, falling back to its id so nothing silently disappears.
 * Shared by both exporters.
 */
function folderName(folderId, folders) {
  const found = (Array.isArray(folders) ? folders : []).find(
    (folder) => folder !== null && typeof folder === "object" && folder.id === folderId
  );
  if (found && typeof found.name === "string" && found.name !== "") return found.name;
  return typeof folderId === "string" ? folderId : "";
}

/**
 * A folder name as an Anki tag: whitespace separates tags in Anki, so every
 * whitespace run collapses to a single underscore ("GRE words  2" ->
 * "GRE_words_2"). Leading and trailing whitespace goes first, so a name never
 * turns into a tag that starts or ends with "_".
 */
function ankiTag(name) {
  return name.trim().replace(/\s+/g, "_");
}

/**
 * Build the Anki import file: three header directives, then Front TAB Back TAB
 * Tag per item. The tag is the item's folder, so the folders survive the trip
 * into Anki. Missing rows are skipped (the caller counts them for the
 * "skipped" report). Back fields are joined with " · ", empty ones dropped.
 *
 * @param {object[]} joinedRows rows from joinItems
 * @param {*} settings settings record (normalized here, so raw is fine)
 * @param {Array<{id:string, name:string}>} [folders] folder list, for the tag
 * @returns {string}
 */
export function buildAnkiTsv(joinedRows, settings, folders) {
  const { anki } = normalizeSettings(settings);
  const lines = ["#separator:tab", "#html:false", "#tags column:3"];
  for (const row of Array.isArray(joinedRows) ? joinedRows : []) {
    if (row === null || typeof row !== "object" || row.missing === true) continue;
    const isRoot = row.kind === "root";
    const front = fieldValue(row, isRoot ? anki.rootFront : anki.wordFront);
    const back = (isRoot ? anki.rootBack : anki.wordBack)
      .map((token) => fieldValue(row, token))
      .filter((value) => value !== "")
      .join(FIELD_SEPARATOR);
    const tag = ankiTag(folderName(row.folderId, folders));
    lines.push(`${tsvField(front)}\t${tsvField(back)}\t${tsvField(tag)}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * RFC-4180 quoting: a field carrying a comma, a quote or a line break is
 * wrapped in double quotes with the inner quotes doubled.
 */
function csvField(value) {
  return /[",\n\r]/.test(value) ? `"${value.split('"').join('""')}"` : value;
}

/** addedAt -> ISO calendar date. A missing or unusable stamp renders empty. */
function isoDate(addedAt) {
  if (!Number.isFinite(addedAt) || addedAt <= 0) return "";
  const date = new Date(addedAt);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

/**
 * Build the CSV export: a full-data spreadsheet, independent of the Anki field
 * settings, so the file is a complete record of what was saved. Header row
 * first, then one row per item in CSV_COLUMNS order. A root row writes its
 * gloss in the text column and leaves breakdown and tier empty, since roots
 * carry neither. Missing rows are skipped (the caller counts them), exactly
 * like buildAnkiTsv. Lines end with LF, like the Anki file.
 *
 * @param {object[]} joinedRows rows from joinItems
 * @param {Array<{id:string, name:string}>} folders folder list, for the name column
 * @returns {string}
 */
export function buildCsv(joinedRows, folders) {
  const lines = [CSV_COLUMNS.join(",")];
  for (const row of Array.isArray(joinedRows) ? joinedRows : []) {
    if (row === null || typeof row !== "object" || row.missing === true) continue;
    const isRoot = row.kind === "root";
    const cells = [
      isRoot ? "root" : "word",
      fieldValue(row, "key"),
      isRoot ? fieldValue(row, "gloss") : fieldValue(row, "defs"),
      isRoot ? "" : fieldValue(row, "breakdown"),
      isRoot ? "" : fieldValue(row, "tier"),
      folderName(row.folderId, folders),
      isoDate(row.addedAt),
    ];
    lines.push(cells.map(csvField).join(","));
  }
  return `${lines.join("\n")}\n`;
}
