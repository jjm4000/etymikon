/*
 * Etymikon, the side panel's SAVED view.
 *
 * A classic script loaded after sidepanel.js, which self-registers through
 * __okpyeonSidebar.registerView. Registering is the whole wiring: the nav row
 * appears by itself once a second view exists, and nothing in sidepanel.js
 * knows this file is here.
 *
 * This is PAGE chrome, not the shadow renderer: rows are plain elements styled
 * by sidepanel.css, so there are no tier chips and no card markup here. The
 * secondary line carries the first definition (words) or the gloss (roots),
 * and a row whose entry has left the dictionary says so instead of vanishing.
 *
 * Everything the view knows comes from the worker (`savedGet`), and everything
 * it changes goes back through the worker — the panel never touches storage.
 * A worker without chrome.storage answers {ok:false} to every one of these
 * messages, and that reads as "the feature is absent": one quiet line, never
 * an error.
 *
 * Exposed for the test harness as globalThis.__okpyeonSavedView:
 *
 *   refresh()                 re-read savedGet and re-render; -> Promise
 *   selection()               the checked item ids, as an array
 *   folders()                 the folders from the last read
 *   items()                   the joined rows from the last read
 *   filter()                  the folder id the list is filtered to, or ""
 *   collapsed()               the ids of the folders currently collapsed
 *   effectiveIds()            what an action would act on right now
 *   lastDownload()            {filename, format, body, count, skipped} or null
 *   handleStorageChanged(c,a) the storage-change handler, driveable without a
 *                             real chrome.storage
 *   setStorageSync(on)        pretend a real storage listener is (not) attached
 *   pendingSelfWrites()       unspent self-write claims, for the check above
 */
(function () {
  "use strict";

  var sidebar = globalThis.__okpyeonSidebar;
  if (!sidebar || typeof sidebar.registerView !== "function") return;

  /* ------------------------------------------------------------------ *
   * Worker access — the same probe sidepanel.js uses.
   * ------------------------------------------------------------------ */

  function workerRuntime() {
    var chromeObj = globalThis.chrome;
    var runtime = chromeObj && chromeObj.runtime;
    if (runtime && runtime.id && typeof runtime.sendMessage === "function") {
      return runtime;
    }
    var fake = globalThis.__hanjaHoverTestRuntime;
    if (fake && typeof fake.sendMessage === "function") return fake;
    return null;
  }

  // Callback form first (both MV3 and the harness runtime support it), promise
  // form if one comes back, and every failure resolves null instead of
  // rejecting: a missing worker must read exactly like a worker that said no.
  function sendToWorker(payload) {
    var runtime = workerRuntime();
    if (!runtime) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var settled = false;
      function done(value) {
        if (settled) return;
        settled = true;
        resolve(value);
      }
      var maybePromise;
      try {
        maybePromise = runtime.sendMessage(payload, function (response) {
          if (globalThis.chrome && globalThis.chrome.runtime &&
              globalThis.chrome.runtime.lastError) {
            done(null);
            return;
          }
          done(response || null);
        });
      } catch (e) {
        done(null);
        return;
      }
      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.then(function (response) { done(response || null); },
                          function () { done(null); });
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * View state
   *
   * Selection is held OUTSIDE the DOM (an id -> true map) because the list is
   * rebuilt wholesale on every refresh: a checked box that only lived in the
   * markup would be lost the moment a save arrived from a page. Ids that no
   * longer exist are pruned on each read, so a removed item cannot linger in
   * the selection and resurrect an action.
   *
   * Collapse state is page-session-local by design (SPEC): default expanded,
   * held while the panel is open, gone on a fresh open. Hence a plain object,
   * never storage.
   * ------------------------------------------------------------------ */

  var ctx = null;
  var visible = false;
  var available = true;      // false once the worker says "storage unavailable"

  var folders = [];
  var items = [];
  var selected = Object.create(null);
  var collapsed = Object.create(null);
  var filterId = "";         // "" = All

  /* ------------------------------------------------------------------ *
   * Self-originated writes
   *
   * Every mutation the panel sends is followed by an explicit refresh(), and
   * the same write comes back a second time through chrome.storage.onChanged,
   * so one click cost two savedGet round-trips and two wholesale list rebuilds.
   * A mutation leaves a claim here BEFORE it is sent, so the claim is always in
   * place by the time the write lands; the storage event that follows spends it
   * and stops there. Writes made anywhere else, a page card's ☆, find no claim
   * and refresh as they always did.
   *
   * Claims are fungible: a refused mutation releases one, and every claim
   * expires, so a write that never happened cannot go on swallowing real
   * events. Nothing is claimed unless a storage listener is actually attached,
   * because without one there is no second refresh to suppress.
   * ------------------------------------------------------------------ */

  var storageSyncLive = false;
  var SELF_WRITE_TTL = 3000;
  var selfWrites = [];

  function releaseSelfWrite() { selfWrites.pop(); }

  function spendSelfWrite() {
    var now = Date.now();
    while (selfWrites.length && selfWrites[0] <= now) selfWrites.shift();
    if (!selfWrites.length) return false;
    selfWrites.shift();
    return true;
  }

  // Writing messages go through here rather than sendToWorker, so none of them
  // can forget to mark itself.
  function mutate(payload) {
    if (storageSyncLive) selfWrites.push(Date.now() + SELF_WRITE_TTL);
    return sendToWorker(payload).then(function (res) {
      if (storageSyncLive && (!res || res.ok !== true)) releaseSelfWrite();
      return res;
    });
  }

  // A transient note in the actions bar's count slot ("Moved 2 to Exam
  // words"): holds off the normal count text until it expires, then the
  // next renderActions restores it.
  var flashUntil = 0;
  function flashCount(text) {
    flashUntil = Date.now() + 2500;
    if (els.count) els.count.textContent = text;
    setTimeout(function () {
      flashUntil = 0;
      renderActions();
    }, 2600);
  }

  // The seal only marks empty paper (SPEC "Corner seal"): with enough rows
  // the behind-content watermark read as clutter. The whole mechanism, its
  // threshold and debounce included, lives in sidepanel.js's registry
  // mechanics, and this view's part in it is nudging after a render. The
  // content box is the view container itself, which is the default, so this
  // view declares no `seal` at all.
  function refreshSeal() {
    if (ctx && typeof ctx.refreshSeal === "function") ctx.refreshSeal();
  }

  var lastDownload = null;

  // Bar / actions elements, built once in mount().
  var els = {};

  function folderById(id) {
    for (var i = 0; i < folders.length; i++) {
      if (folders[i] && folders[i].id === id) return folders[i];
    }
    return null;
  }

  function folderName(id) {
    var folder = folderById(id);
    return folder ? folder.name : id;
  }

  // The rows the current filter shows — the unit both the select-all checkbox
  // and "nothing checked" act on.
  function filteredItems() {
    if (!filterId) return items.slice();
    return items.filter(function (item) { return item.folderId === filterId; });
  }

  function itemsInFolder(id) {
    return items.filter(function (item) { return item.folderId === id; });
  }

  function selectedIds() {
    return items
      .filter(function (item) { return selected[item.id] === true; })
      .map(function (item) { return item.id; });
  }

  // Nothing checked means "the current filter", so every action has an obvious
  // target without the user having to select first.
  function effectiveIds() {
    var picked = selectedIds();
    if (picked.length) return picked;
    return filteredItems().map(function (item) { return item.id; });
  }

  /* ------------------------------------------------------------------ *
   * Small DOM helpers
   * ------------------------------------------------------------------ */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function button(className, label, title) {
    var node = el("button", className, label);
    node.type = "button";
    if (title) node.title = title;
    return node;
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  // Dictionary text only ever reaches the DOM as text, never as markup.
  //
  // A word row's secondary line is its first definition, a root row's is its
  // gloss. The worker joins both against live data, and both land in the same
  // slot: one line under the key, saying what the saved thing means.
  function secondaryText(item) {
    if (item.kind === "root") return item.gloss ? String(item.gloss) : "";
    var defs = item && item.defs;
    if (defs && defs.length) return String(defs[0]);
    // A join that hands back whole senses rather than a flat def list.
    var senses = item && item.senses;
    var first = senses && senses.length ? senses[0] : null;
    if (first && first.defs && first.defs.length) return String(first.defs[0]);
    return "";
  }

  /* ------------------------------------------------------------------ *
   * Top bar
   *
   * Built once: the inline name inputs live in it, and a rebuild on every
   * refresh would yank a half-typed folder name out from under the user. Only
   * the option lists and the enabled states are re-rendered.
   * ------------------------------------------------------------------ */

  function buildBar() {
    var bar = el("div", "saved-bar");
    bar.id = "okp-saved-bar";

    var main = el("div", "saved-bar-main");

    var filter = document.createElement("select");
    filter.id = "okp-saved-filter";
    filter.className = "saved-filter";
    filter.setAttribute("aria-label", "Filter by folder");
    filter.addEventListener("change", function () {
      filterId = filter.value;
      renderList();
      renderBar();
      renderActions();
    });
    main.appendChild(filter);

    var newBtn = button("saved-new", "New folder", "Create a folder");
    newBtn.id = "okp-saved-new";
    newBtn.addEventListener("click", function () { openNameForm("new"); });
    main.appendChild(newBtn);

    var renameBtn = button("saved-rename", "Rename", "Rename this folder");
    renameBtn.id = "okp-saved-rename";
    renameBtn.addEventListener("click", function () { openNameForm("rename"); });
    main.appendChild(renameBtn);

    var deleteBtn = button("saved-delete", "Delete", "Delete this folder");
    deleteBtn.id = "okp-saved-delete";
    deleteBtn.addEventListener("click", function () { openDeleteConfirm(); });
    main.appendChild(deleteBtn);

    var selectAllLabel = el("label", "saved-selectall");
    var selectAll = document.createElement("input");
    selectAll.type = "checkbox";
    selectAll.id = "okp-saved-selectall";
    selectAll.className = "saved-selectall-check";
    selectAll.addEventListener("change", function () {
      var rows = filteredItems();
      for (var i = 0; i < rows.length; i++) {
        if (selectAll.checked) selected[rows[i].id] = true;
        else delete selected[rows[i].id];
      }
      renderList();
      renderActions();
    });
    selectAllLabel.appendChild(selectAll);
    selectAllLabel.appendChild(el("span", "saved-selectall-text", "Select all"));
    main.appendChild(selectAllLabel);

    bar.appendChild(main);

    // One slot for whichever inline form is open — new folder, rename, or the
    // delete confirmation. Only one at a time, so one slot is enough.
    var inline = el("div", "saved-bar-inline");
    inline.id = "okp-saved-bar-inline";
    inline.hidden = true;
    bar.appendChild(inline);

    els.bar = bar;
    els.filter = filter;
    els.newBtn = newBtn;
    els.renameBtn = renameBtn;
    els.deleteBtn = deleteBtn;
    els.selectAll = selectAll;
    els.barInline = inline;
    return bar;
  }

  function closeBarInline() {
    if (!els.barInline) return;
    clear(els.barInline);
    els.barInline.hidden = true;
    els.bar.classList.remove("saved-bar--inline");
  }

  function openBarInline(node) {
    clear(els.barInline);
    els.barInline.appendChild(node);
    els.barInline.hidden = false;
    els.bar.classList.add("saved-bar--inline");
  }

  // mode: "new" creates, "rename" renames the filtered folder. One builder,
  // because the two differ only in their starting value and their message.
  function openNameForm(mode) {
    if (mode === "rename" && !filterId) return;
    var form = el("div", "saved-nameform");
    form.setAttribute("data-mode", mode);

    var input = document.createElement("input");
    input.type = "text";
    input.className = "saved-name-input";
    input.id = "okp-saved-name-input";
    input.placeholder = mode === "new" ? "Folder name" : "Folder name";
    input.value = mode === "rename" ? folderName(filterId) : "";
    input.setAttribute("aria-label", mode === "new" ? "New folder name" : "Folder name");
    form.appendChild(input);

    var okBtn = button("saved-name-ok", mode === "new" ? "Create" : "Save");
    var cancelBtn = button("saved-name-cancel", "Cancel");
    var error = el("span", "saved-error");
    error.hidden = true;

    function submit() {
      var name = input.value.trim();
      if (!name) {
        error.textContent = "A folder needs a name.";
        error.hidden = false;
        input.focus();
        return;
      }
      var message = mode === "new"
        ? { type: "folderCreate", name: name }
        : { type: "folderRename", id: filterId, name: name };
      mutate(message).then(function (res) {
        if (!res || res.ok !== true) {
          error.textContent = (res && res.error) ? String(res.error) : "That did not work.";
          error.hidden = false;
          return;
        }
        // Creating a folder stays on the current filter (user-directed):
        // jumping into the new, empty folder abandoned the list the user was
        // looking at. Under "All" the new folder appears as its own group,
        // and it is in the filter and Move selects from here on.
        closeBarInline();
        refresh();
      });
    }

    okBtn.addEventListener("click", submit);
    cancelBtn.addEventListener("click", closeBarInline);
    input.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); submit(); }
      else if (ev.key === "Escape") { ev.preventDefault(); closeBarInline(); }
    });

    form.appendChild(okBtn);
    form.appendChild(cancelBtn);
    form.appendChild(error);
    openBarInline(form);
    input.focus();
  }

  // Inline, never window.confirm: a modal dialog in a side panel is a much
  // bigger interruption than the thing it is guarding.
  function openDeleteConfirm() {
    if (!filterId || filterId === "f0") return;
    var box = el("div", "saved-confirm saved-confirm--folder");
    var count = itemsInFolder(filterId).length;
    box.appendChild(el("span", "saved-confirm-text",
      count
        ? "Delete " + folderName(filterId) + "? " + count +
          (count === 1 ? " item moves to Saved." : " items move to Saved.")
        : "Delete " + folderName(filterId) + "?"));
    var yes = button("saved-confirm-yes", "Delete");
    var no = button("saved-confirm-no", "Cancel");
    yes.addEventListener("click", function () {
      var target = filterId;
      mutate({ type: "folderDelete", id: target }).then(function () {
        if (filterId === target) filterId = "";
        closeBarInline();
        refresh();
      });
    });
    no.addEventListener("click", closeBarInline);
    box.appendChild(yes);
    box.appendChild(no);
    openBarInline(box);
  }

  function renderBar() {
    var filter = els.filter;
    var wanted = filterId;
    clear(filter);
    var all = document.createElement("option");
    all.value = "";
    all.textContent = "All (" + items.length + ")";
    filter.appendChild(all);
    var stillThere = false;
    for (var i = 0; i < folders.length; i++) {
      var option = document.createElement("option");
      option.value = folders[i].id;
      option.textContent = folders[i].name + " (" + itemsInFolder(folders[i].id).length + ")";
      filter.appendChild(option);
      if (folders[i].id === wanted) stillThere = true;
    }
    // A folder that was deleted under us falls back to All rather than leaving
    // the select pointing at nothing.
    if (wanted && !stillThere) filterId = "";
    filter.value = filterId;

    // Rename and Delete are about ONE folder, so they are inert on All; f0 is
    // the folder that always exists, so it offers no delete at all.
    els.renameBtn.disabled = !filterId;
    els.deleteBtn.hidden = !filterId || filterId === "f0";

    var rows = filteredItems();
    var picked = rows.filter(function (item) { return selected[item.id] === true; });
    els.selectAll.checked = rows.length > 0 && picked.length === rows.length;
    els.selectAll.indeterminate = picked.length > 0 && picked.length < rows.length;
    els.selectAll.disabled = rows.length === 0;
  }

  /* ------------------------------------------------------------------ *
   * The list — the view's own scroll region.
   * ------------------------------------------------------------------ */

  function buildItemRow(item) {
    var row = el("div", "saved-row");
    row.setAttribute("data-id", item.id);
    row.setAttribute("data-kind", item.kind);
    row.setAttribute("data-key", item.key);
    if (item.missing === true) row.classList.add("missing");

    var check = document.createElement("input");
    check.type = "checkbox";
    check.className = "saved-check";
    check.checked = selected[item.id] === true;
    check.setAttribute("aria-label", "Select " + item.key);
    check.addEventListener("change", function () {
      if (check.checked) selected[item.id] = true;
      else delete selected[item.id];
      syncSelectionUi();
    });
    // The label is a forgiving hit target (user-directed): a near-miss around
    // the small checkbox toggles selection instead of opening the card.
    var hit = document.createElement("label");
    hit.className = "saved-hit";
    hit.appendChild(check);
    row.appendChild(hit);

    var text = el("div", "saved-text");
    text.appendChild(el("span", "saved-primary", item.key));
    if (item.missing === true) {
      text.appendChild(el("span", "saved-missing", "no longer in the dictionary"));
    } else {
      var secondary = secondaryText(item);
      if (secondary) text.appendChild(el("span", "saved-secondary", secondary));
    }
    row.appendChild(text);

    // The row is a link to the card: anywhere but the checkbox opens it in the
    // search view, with the searchbar showing what was searched.
    row.addEventListener("click", function (ev) {
      if (ev.target === check || (ev.target.closest && ev.target.closest(".saved-hit"))) {
        return;
      }
      openInSearch(item.key);
    });
    return row;
  }

  function buildFolderHeader(folder) {
    var header = el("div", "saved-folder");
    header.setAttribute("data-folder", folder.id);
    var isCollapsed = collapsed[folder.id] === true;
    if (isCollapsed) header.classList.add("saved-folder--collapsed");

    var rows = itemsInFolder(folder.id);
    var picked = rows.filter(function (item) { return selected[item.id] === true; });

    var check = document.createElement("input");
    check.type = "checkbox";
    check.className = "saved-folder-check";
    check.checked = rows.length > 0 && picked.length === rows.length;
    check.indeterminate = picked.length > 0 && picked.length < rows.length;
    check.disabled = rows.length === 0;
    check.setAttribute("aria-label", "Select everything in " + folder.name);
    check.addEventListener("change", function () {
      for (var i = 0; i < rows.length; i++) {
        if (check.checked) selected[rows[i].id] = true;
        else delete selected[rows[i].id];
      }
      renderList();
      renderActions();
      renderBar();
    });
    // Same forgiving hit target as item rows: a near-miss around the folder
    // checkbox selects the folder instead of folding it away.
    var hit = document.createElement("label");
    hit.className = "saved-hit";
    hit.appendChild(check);
    header.appendChild(hit);

    // The triangle is decorative; the header itself carries the state, so a
    // screen reader is told by aria-expanded rather than by a rotated glyph.
    header.appendChild(el("span", "saved-tri", "▸"));
    header.appendChild(el("span", "saved-folder-name", folder.name));
    header.appendChild(el("span", "saved-folder-count", String(rows.length)));
    header.setAttribute("aria-expanded", isCollapsed ? "false" : "true");

    // Clicking the header anywhere but its checkbox folds the folder away. The
    // count and the checkbox stay, so a collapsed folder is still a working
    // batch target.
    header.addEventListener("click", function (ev) {
      if (ev.target === check || (ev.target.closest && ev.target.closest(".saved-hit"))) {
        return;
      }
      if (collapsed[folder.id] === true) delete collapsed[folder.id];
      else collapsed[folder.id] = true;
      renderList();
    });
    return header;
  }

  function renderList() {
    renderListBody();
    refreshSeal();
  }

  function renderListBody() {
    var list = els.list;
    clear(list);

    // Grouped (All) lists indent their item rows under the folder bands;
    // the class keeps that a stylesheet concern (flat lists keep full width).
    list.classList.toggle("saved-list--grouped", !filterId);


    if (!available) {
      list.appendChild(el("p", "saved-unavailable",
        "Saved words are not available in this browser session."));
      return;
    }

    var rows = filteredItems();
    if (!rows.length) {
      list.appendChild(el("p", "saved-empty", items.length
        ? "This folder is empty."
        : "Nothing saved yet. Tap the ☆ on a card to save it."));
      return;
    }

    // A single-folder filter is already one group, so it renders flat: a lone
    // header over a list of everything below it says nothing.
    if (filterId) {
      for (var i = 0; i < rows.length; i++) list.appendChild(buildItemRow(rows[i]));
      return;
    }

    for (var f = 0; f < folders.length; f++) {
      var folder = folders[f];
      var inFolder = itemsInFolder(folder.id);
      // An empty folder still shows: it is where the next save can go, and its
      // header is how the user finds out the folder exists.
      list.appendChild(buildFolderHeader(folder));
      if (collapsed[folder.id] === true) continue;
      for (var j = 0; j < inFolder.length; j++) {
        list.appendChild(buildItemRow(inFolder[j]));
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * Actions bar
   * ------------------------------------------------------------------ */

  function buildActions() {
    var bar = el("div", "saved-actions");
    bar.id = "okp-saved-actions";

    var main = el("div", "saved-actions-main");

    var move = document.createElement("select");
    move.id = "okp-saved-move";
    move.className = "saved-move";
    move.setAttribute("aria-label", "Move the selection to a folder");
    move.addEventListener("change", function () {
      var target = move.value;
      move.value = "";
      if (!target) return;
      var ids = effectiveIds();
      if (!ids.length) return;
      mutate({ type: "savedMove", ids: ids, folderId: target }).then(function (res) {
        // Moves are reversible, so no confirmation — but not silent either:
        // under a folder filter the moved rows vanish from view, which reads
        // as deletion without this note (user-raised).
        if (res && res.ok === true) {
          var folder = folders.filter(function (f) { return f.id === target; })[0];
          flashCount("Moved " + ids.length + " to " + (folder ? folder.name : "folder"));
        }
        refresh();
      });
    });
    main.appendChild(move);

    var removeBtn = button("saved-remove", "Delete", "Delete the selection");
    removeBtn.id = "okp-saved-remove";
    removeBtn.addEventListener("click", openRemoveConfirm);
    main.appendChild(removeBtn);

    var exportBtn = button("saved-export", "Export", "Export the selection");
    exportBtn.id = "okp-saved-export";
    exportBtn.addEventListener("click", openExportChoice);
    main.appendChild(exportBtn);

    main.appendChild(el("span", "saved-count", ""));

    bar.appendChild(main);

    var inline = el("div", "saved-actions-inline");
    inline.id = "okp-saved-actions-inline";
    inline.hidden = true;
    bar.appendChild(inline);

    // One anchor, reused: a fresh one per export would litter the view, and
    // keeping it means the filename the worker chose is inspectable after the
    // download has been handed to the browser.
    var anchor = document.createElement("a");
    anchor.id = "okp-saved-download";
    anchor.className = "saved-download";
    anchor.hidden = true;
    bar.appendChild(anchor);

    els.actions = bar;
    els.move = move;
    els.removeBtn = removeBtn;
    els.exportBtn = exportBtn;
    els.count = main.querySelector(".saved-count");
    els.actionsInline = inline;
    els.anchor = anchor;
    return bar;
  }

  // The inline row takes the main row's place rather than sitting beside it,
  // so the confirmation is where the button was.
  function setActionsMainHidden(hidden) {
    var main = els.actions && els.actions.querySelector(".saved-actions-main");
    if (main) main.hidden = hidden === true;
  }

  function closeActionsInline() {
    if (!els.actionsInline) return;
    clear(els.actionsInline);
    els.actionsInline.hidden = true;
    setActionsMainHidden(false);
  }

  function openActionsInline(node) {
    clear(els.actionsInline);
    els.actionsInline.appendChild(node);
    els.actionsInline.hidden = false;
    setActionsMainHidden(true);
  }

  // Two steps, in place: the first click arms, cancel disarms, confirm removes.
  function openRemoveConfirm() {
    var ids = effectiveIds();
    if (!ids.length) return;
    var box = el("div", "saved-confirm saved-confirm--remove");
    box.appendChild(el("span", "saved-confirm-text",
      "Delete " + ids.length + (ids.length === 1 ? " item?" : " items?")));
    var yes = button("saved-confirm-yes", "Delete");
    var no = button("saved-confirm-no", "Cancel");
    yes.addEventListener("click", function () {
      mutate({ type: "savedRemove", ids: ids }).then(function () {
        for (var i = 0; i < ids.length; i++) delete selected[ids[i]];
        closeActionsInline();
        refresh();
      });
    });
    no.addEventListener("click", closeActionsInline);
    box.appendChild(yes);
    box.appendChild(no);
    openActionsInline(box);
  }

  function openExportChoice() {
    var ids = effectiveIds();
    if (!ids.length) return;
    var box = el("div", "saved-export-choice");
    box.appendChild(el("span", "saved-export-text", "Export " + ids.length + " as"));
    var anki = button("saved-export-anki", "Anki", "Anki tab-separated import file");
    var csv = button("saved-export-csv", "CSV", "Spreadsheet with every field");
    var cancel = button("saved-export-cancel", "Cancel");
    anki.addEventListener("click", function () { runExport(ids, "anki"); });
    csv.addEventListener("click", function () { runExport(ids, "csv"); });
    cancel.addEventListener("click", closeActionsInline);
    box.appendChild(anki);
    box.appendChild(csv);
    box.appendChild(cancel);
    openActionsInline(box);
  }

  // Blob + a download click, filename from the worker, then revoke. The object
  // URL is released on a later turn: revoking it in the same tick can cancel
  // the download Chrome has only just started.
  function runExport(ids, format) {
    sendToWorker({ type: "savedExport", ids: ids, format: format }).then(function (res) {
      if (!res || res.ok !== true || typeof res.tsv !== "string") {
        var box = el("div", "saved-export-choice");
        box.appendChild(el("span", "saved-error",
          (res && res.error) ? String(res.error) : "Export is not available."));
        var back = button("saved-export-cancel", "Close");
        back.addEventListener("click", closeActionsInline);
        box.appendChild(back);
        openActionsInline(box);
        return;
      }
      var filename = res.filename ||
        (format === "csv" ? "etymikon-saved.csv" : "etymikon-anki.txt");
      var type = format === "csv" ? "text/csv" : "text/plain";
      var url = URL.createObjectURL(new Blob([res.tsv], { type: type + ";charset=utf-8" }));
      var anchor = els.anchor;
      anchor.href = url;
      anchor.download = filename;
      anchor.setAttribute("data-format", format);
      anchor.setAttribute("data-count", String(res.count == null ? "" : res.count));
      anchor.setAttribute("data-skipped", String(res.skipped == null ? "" : res.skipped));
      // The body is kept on the element so the file that was actually handed
      // to the browser is inspectable after the object URL is gone.
      anchor.setAttribute("data-body", res.tsv);
      anchor.textContent = filename;
      lastDownload = {
        filename: filename, format: format, body: res.tsv,
        count: res.count, skipped: res.skipped
      };
      // The anchor is fully built either way; only the gesture that hands the
      // file to the browser is skipped when a harness asks for it. A page
      // driving these checks in a real browser would otherwise open a Save As
      // dialog per run, and everything worth asserting (href, download name,
      // format, counts, body) is already on the element and in lastDownload.
      if (globalThis.__okpyeonSuppressDownload !== true) anchor.click();
      setTimeout(function () { URL.revokeObjectURL(url); }, 0);
      closeActionsInline();
    });
  }

  function renderActions() {
    var move = els.move;
    clear(move);
    var head = document.createElement("option");
    head.value = "";
    head.textContent = "Move to…";
    move.appendChild(head);
    for (var i = 0; i < folders.length; i++) {
      var option = document.createElement("option");
      option.value = folders[i].id;
      option.textContent = folders[i].name;
      move.appendChild(option);
    }
    move.value = "";

    var picked = selectedIds();
    var target = picked.length ? picked.length : filteredItems().length;
    els.count.textContent = flashUntil > Date.now()
      ? els.count.textContent
      : picked.length
        ? picked.length + " selected"
        : (target ? "all " + target + " shown" : "");
    var inert = target === 0 || !available;
    move.disabled = inert;
    els.removeBtn.disabled = inert;
    els.exportBtn.disabled = inert;
    els.actions.hidden = !available;
    refreshSeal();
  }

  // The cheap half of a refresh: checkbox states and the action labels, with
  // no list rebuild, so clicking one checkbox does not rebuild every row.
  function syncSelectionUi() {
    if (!filterId) {
      var headers = els.list.querySelectorAll(".saved-folder");
      for (var i = 0; i < headers.length; i++) {
        var id = headers[i].getAttribute("data-folder");
        var rows = itemsInFolder(id);
        var picked = rows.filter(function (item) { return selected[item.id] === true; });
        var check = headers[i].querySelector(".saved-folder-check");
        if (!check) continue;
        check.checked = rows.length > 0 && picked.length === rows.length;
        check.indeterminate = picked.length > 0 && picked.length < rows.length;
      }
    }
    renderBar();
    renderActions();
  }

  /* ------------------------------------------------------------------ *
   * Opening a row in the search view
   * ------------------------------------------------------------------ */

  function openInSearch(key) {
    var input = document.getElementById("okp-input");
    if (input) input.value = key;
    var shellModule = (ctx && ctx.shell) || globalThis.__okpyeonSearchShell;
    var controller = shellModule && typeof shellModule.controller === "function"
      ? shellModule.controller()
      : null;
    // The view switch happens either way: landing on the search view with the
    // query in the box is still the right place to be if the shell is missing.
    if (typeof sidebar.showView === "function") sidebar.showView("search");
    if (controller) {
      try { controller.search(key); } catch (e) { /* the shell reports its own errors */ }
    }
  }

  /* ------------------------------------------------------------------ *
   * Reading
   * ------------------------------------------------------------------ */

  function refresh() {
    return sendToWorker({ type: "savedGet" }).then(function (res) {
      if (!res || res.ok !== true) {
        // "storage unavailable" and "no worker at all" are the same thing to a
        // user: the feature is absent. One quiet line, no error styling.
        available = false;
        folders = [];
        items = [];
        renderBar();
        renderList();
        renderActions();
        els.bar.hidden = true;
        return false;
      }
      available = true;
      els.bar.hidden = false;
      folders = Array.isArray(res.folders) ? res.folders : [];
      items = Array.isArray(res.items) ? res.items : [];
      // Prune: an id that is gone must not sit in the selection and turn up in
      // the next batch action.
      var live = Object.create(null);
      for (var i = 0; i < items.length; i++) live[items[i].id] = true;
      Object.keys(selected).forEach(function (id) {
        if (!live[id]) delete selected[id];
      });
      renderBar();
      renderList();
      renderActions();
      return true;
    });
  }

  // Exposed so the harness can drive the live-refresh path without a real
  // chrome.storage, exactly as sidepanel.js exposes handleWorkerMessage.
  function handleStorageChanged(changes, area) {
    if (area && area !== "local") return false;
    if (changes && !changes.okpSaved && !changes.okpSettings) return false;
    // Spent before the visibility test, so a claim cannot outlive its write by
    // being left behind while the view is hidden.
    if (spendSelfWrite()) return false;
    if (!visible) return false;
    refresh();
    return true;
  }

  /* ------------------------------------------------------------------ *
   * Registration
   * ------------------------------------------------------------------ */

  sidebar.registerView({
    key: "saved",
    label: "Saved",
    title: "Saved words and roots",
    mount: function (container, viewCtx) {
      ctx = viewCtx;
      container.appendChild(buildBar());
      var list = el("div", "saved-list");
      list.id = "okp-saved-list";
      els.list = list;
      container.appendChild(list);
      container.appendChild(buildActions());

      // Real runtime only: the harness has no chrome.storage and drives
      // handleStorageChanged directly instead.
      var chromeObj = globalThis.chrome;
      var runtime = chromeObj && chromeObj.runtime;
      var storage = chromeObj && chromeObj.storage;
      if (runtime && runtime.id && storage && storage.onChanged &&
          typeof storage.onChanged.addListener === "function") {
        storage.onChanged.addListener(function (changes, area) {
          handleStorageChanged(changes, area);
        });
        storageSyncLive = true;
      }
      refresh();
    },
    onShow: function () {
      visible = true;
      // Saves made from a page while another view was up land here.
      refresh();
    },
    onHide: function () {
      visible = false;
      closeBarInline();
      closeActionsInline();
    }
  });

  globalThis.__okpyeonSavedView = {
    refresh: refresh,
    selection: selectedIds,
    folders: function () { return folders.slice(); },
    items: function () { return items.slice(); },
    filter: function () { return filterId; },
    collapsed: function () { return Object.keys(collapsed); },
    effectiveIds: effectiveIds,
    lastDownload: function () { return lastDownload; },
    handleStorageChanged: handleStorageChanged,
    // The harness has no chrome.storage, so mount() never sets the flag that
    // turns self-write marking on. These put the view in the state a real
    // panel is in, and read back what the marking has left pending.
    setStorageSync: function (on) {
      storageSyncLive = on !== false;
      if (!storageSyncLive) selfWrites.length = 0;
    },
    pendingSelfWrites: function () { return selfWrites.length; }
  };
})();
