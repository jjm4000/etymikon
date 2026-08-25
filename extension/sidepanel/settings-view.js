/*
 * Okpyeon — the side panel's SETTINGS view.
 *
 * A classic script loaded after sidepanel.js, self-registering the same way
 * saved-view.js does.
 *
 * The page is EXPECTED TO GROW, so it is a declarative schema plus one generic
 * renderer, in the same spirit as content.js's badge registry: a new setting is
 * ONE entry in SETTINGS_SCHEMA and nothing else. Groups are emitted in schema
 * order, so a new entry either slots into a section that already exists or
 * opens a new one, with no renderer change. A new setting TYPE is one more case
 * in the single control-builder switch — and that switch is the ONLY place in
 * this file allowed to branch. Nothing here may name an individual setting.
 *
 * Every control writes through `settingsSet` the moment it changes: there is no
 * save button, and no local copy of the settings that could drift.
 *
 * Exposed for the test harness as globalThis.__okpyeonSettingsView:
 *
 *   schema        the live SETTINGS_SCHEMA array
 *   render()      re-read settings + folders and rebuild the controls
 *   settings()    the settings object as last read
 *   folders()     the folders as last read
 *   controlId(k)  the DOM id the renderer gives an entry's control
 */
(function () {
  "use strict";

  var sidebar = globalThis.__okpyeonSidebar;
  if (!sidebar || typeof sidebar.registerView !== "function") return;

  /* ------------------------------------------------------------------ *
   * The schema
   *
   * Entry: {
   *   key,      // dot-path into the settings object; also the control's id
   *   group,    // heading it renders under; groups appear in schema order
   *   type,     // "select" | "checkset" | "folder-select"
   *   label,    // the visible label
   *   options,  // [{value, label}] — omitted by folder-select, which resolves
   *             //   its options from the worker's folders at render time
   *   default   // what a settings object that does not carry the key reads as
   * }
   * ------------------------------------------------------------------ */

  var SETTINGS_SCHEMA = [
    {
      key: "defaultFolderId",
      group: "Saving",
      type: "folder-select",
      label: "By default, save new items to",
      default: "f0"
    },
    {
      key: "anki.wordFront",
      group: "Anki export",
      type: "select",
      label: "Word cards: front",
      options: [
        { value: "hanja", label: "Hanja" },
        { value: "hangul", label: "Hangul" }
      ],
      default: "hanja"
    },
    {
      key: "anki.wordBack",
      group: "Anki export",
      type: "checkset",
      label: "Word cards: back",
      options: [
        { value: "hanja", label: "Hanja" },
        { value: "hangul", label: "Hangul" },
        { value: "defs", label: "Definitions" }
      ],
      default: ["hangul", "defs"]
    },
    {
      key: "anki.charFront",
      group: "Anki export",
      type: "select",
      label: "Character cards: front",
      options: [
        { value: "char", label: "Character" },
        { value: "eumhun", label: "Eum-hun" }
      ],
      default: "char"
    },
    {
      key: "anki.charBack",
      group: "Anki export",
      type: "checkset",
      label: "Character cards: back",
      options: [
        { value: "char", label: "Character" },
        { value: "eumhun", label: "Eum-hun" },
        { value: "readings", label: "Readings" },
        { value: "defs", label: "Definitions" },
        { value: "lvl", label: "Level" }
      ],
      default: ["eumhun", "defs"]
    }
  ];

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
   * Dot-paths
   *
   * The schema addresses settings by path, so reading and patching are two
   * tiny generic functions rather than a switch over field names.
   * ------------------------------------------------------------------ */

  function readPath(source, path) {
    var parts = String(path).split(".");
    var value = source;
    for (var i = 0; i < parts.length; i++) {
      if (value == null || typeof value !== "object") return undefined;
      value = value[parts[i]];
    }
    return value;
  }

  // "anki.wordBack" + value -> {anki: {wordBack: value}}. The worker
  // shallow-merges the patch, so the nesting has to be built here.
  function buildPatch(path, value) {
    var parts = String(path).split(".");
    var patch = {};
    var node = patch;
    for (var i = 0; i < parts.length - 1; i++) {
      node[parts[i]] = {};
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = value;
    return patch;
  }

  function currentValue(entry) {
    var value = readPath(settings, entry.key);
    if (value !== undefined) return value;
    return Array.isArray(entry.default) ? entry.default.slice() : entry.default;
  }

  function controlId(key) {
    return "okp-set-" + String(key).split(".").join("-");
  }

  /* ------------------------------------------------------------------ *
   * State
   * ------------------------------------------------------------------ */

  var ctx = null;
  var body = null;
  var settings = {};
  var folders = [];
  var available = true;

  // The corner seal's rule, threshold and debounce all live in sidepanel.js's
  // registry mechanics (SPEC "Corner seal"); this view's part in it is the
  // `seal` box it declares below plus a nudge after each render.
  function refreshSeal() {
    if (ctx && typeof ctx.refreshSeal === "function") ctx.refreshSeal();
  }

  function write(entry, value) {
    return sendToWorker({ type: "settingsSet", patch: buildPatch(entry.key, value) })
      .then(function (res) {
        if (res && res.ok === true && res.settings) settings = res.settings;
        return res;
      });
  }

  /* ------------------------------------------------------------------ *
   * The control builder — the one switch in this file.
   *
   * Adding a TYPE means one more case here. Adding a SETTING means no change
   * at all: the schema entry is the whole of it.
   * ------------------------------------------------------------------ */

  function optionsFor(entry) {
    if (entry.type === "folder-select") {
      return folders.map(function (folder) {
        return { value: folder.id, label: folder.name };
      });
    }
    return entry.options || [];
  }

  function buildSelect(entry) {
    var select = document.createElement("select");
    select.id = controlId(entry.key);
    select.className = "settings-select";
    var options = optionsFor(entry);
    for (var i = 0; i < options.length; i++) {
      var option = document.createElement("option");
      option.value = String(options[i].value);
      option.textContent = String(options[i].label);
      select.appendChild(option);
    }
    select.value = String(currentValue(entry));
    select.addEventListener("change", function () { write(entry, select.value); });
    return select;
  }

  function buildCheckset(entry) {
    var box = document.createElement("div");
    box.id = controlId(entry.key);
    box.className = "settings-checkset";
    var options = optionsFor(entry);
    var value = currentValue(entry);
    var chosen = Array.isArray(value) ? value : [];
    var boxes = [];
    for (var i = 0; i < options.length; i++) {
      var label = document.createElement("label");
      label.className = "settings-checkbox";
      var input = document.createElement("input");
      input.type = "checkbox";
      input.className = "settings-check";
      input.value = String(options[i].value);
      input.setAttribute("data-value", String(options[i].value));
      input.checked = chosen.indexOf(options[i].value) >= 0;
      var text = document.createElement("span");
      text.textContent = String(options[i].label);
      label.appendChild(input);
      label.appendChild(text);
      box.appendChild(label);
      boxes.push(input);
    }
    // The written value keeps the schema's option order, not the click order,
    // so the exported card fields come out in a stable arrangement.
    box.addEventListener("change", function () {
      var picked = boxes.filter(function (input) { return input.checked; })
        .map(function (input) { return input.value; });
      write(entry, picked);
    });
    return box;
  }

  function buildControl(entry) {
    switch (entry.type) {
      case "select":
      case "folder-select":
        return buildSelect(entry);
      case "checkset":
        return buildCheckset(entry);
      default:
        // An unknown type is a schema mistake, not a user-facing state: say so
        // quietly rather than dropping the row and hiding the bug.
        var unknown = document.createElement("span");
        unknown.className = "settings-unknown";
        unknown.textContent = "unsupported setting type: " + String(entry.type);
        return unknown;
    }
  }

  /* ------------------------------------------------------------------ *
   * The generic renderer
   * ------------------------------------------------------------------ */

  function renderSchema() {
    while (body.firstChild) body.removeChild(body.firstChild);

    if (!available) {
      var note = document.createElement("p");
      note.className = "settings-unavailable";
      note.textContent = "Settings are not available in this browser session.";
      body.appendChild(note);
      return 0;
    }

    var groups = Object.create(null);
    var rendered = 0;
    for (var i = 0; i < SETTINGS_SCHEMA.length; i++) {
      var entry = SETTINGS_SCHEMA[i];
      if (!entry || !entry.key) continue;
      var name = entry.group == null ? "" : String(entry.group);
      var group = groups[name];
      if (!group) {
        group = document.createElement("section");
        group.className = "settings-group";
        group.setAttribute("data-group", name);
        var heading = document.createElement("h2");
        heading.className = "settings-heading";
        heading.textContent = name;
        group.appendChild(heading);
        groups[name] = group;
        body.appendChild(group);      // schema order, by first appearance
      }
      var row = document.createElement("div");
      row.className = "settings-row settings-row--" + entry.type;
      row.setAttribute("data-key", entry.key);
      var label = document.createElement("label");
      label.className = "settings-label";
      label.textContent = entry.label == null ? entry.key : String(entry.label);
      label.setAttribute("for", controlId(entry.key));
      row.appendChild(label);
      var control = document.createElement("div");
      control.className = "settings-control";
      control.appendChild(buildControl(entry));
      row.appendChild(control);
      group.appendChild(row);
      rendered++;
    }
    return rendered;
  }

  // One read of each, then one render: folder-select needs the folders, and
  // every control needs the current settings, so neither can be rendered from
  // a stale copy.
  function render() {
    return Promise.all([
      sendToWorker({ type: "settingsGet" }),
      sendToWorker({ type: "savedGet" })
    ]).then(function (answers) {
      var settingsRes = answers[0];
      var savedRes = answers[1];
      if (!settingsRes || settingsRes.ok !== true || !settingsRes.settings) {
        available = false;
        settings = {};
        folders = [];
        renderSchema();
        refreshSeal();
        return false;
      }
      available = true;
      settings = settingsRes.settings;
      folders = (savedRes && savedRes.ok === true && Array.isArray(savedRes.folders))
        ? savedRes.folders
        : [];
      renderSchema();
      refreshSeal();
      return true;
    });
  }

  /* ------------------------------------------------------------------ *
   * Registration
   * ------------------------------------------------------------------ */

  sidebar.registerView({
    key: "settings",
    label: "Settings",
    title: "Saving and export settings",
    // The content is the body's children, not the body: .settings-body is a
    // stretched flex scroller whose own box always reaches the view bottom,
    // so measuring IT would report zero room forever.
    seal: function (container) { return container.querySelector("#okp-settings"); },
    mount: function (container, viewCtx) {
      ctx = viewCtx;
      body = document.createElement("div");
      body.id = "okp-settings";
      body.className = "settings-body";
      container.appendChild(body);
      render();
    },
    onShow: function () {
      // Folders and the default folder can both have changed in the saved
      // view since the last visit, so every show re-reads.
      render();
    }
  });

  globalThis.__okpyeonSettingsView = {
    schema: SETTINGS_SCHEMA,
    render: render,
    settings: function () { return settings; },
    folders: function () { return folders.slice(); },
    controlId: controlId
  };
})();
