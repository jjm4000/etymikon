/*
 * Etymikon, side panel bootstrapper.
 *
 * Deliberately thin. Everything about how search BEHAVES lives in
 * search-shell.js, which knows nothing about this page; this file only finds
 * this page's elements, renders the page's own chrome, works out the initial
 * query, and starts the shell. Any future extension page reuses boot.js +
 * content.js + search-shell.js verbatim and writes its own equivalent of this
 * file.
 *
 * Runs as a CLASSIC script placed after the markup, so the container it hands
 * to the shell is already in the document and laid out.
 *
 * Two declarative registries live here, both built the way content.js builds
 * its badges — a generic renderer plus an array — so that shipping a new view
 * or a new header action is ONE entry and nothing else:
 *
 *   SIDEBAR_VIEWS   {key, label, title, enabled, mount(container, ctx),
 *                    onShow(), onHide(), seal} — the panel's views. Ships
 *                   with exactly one entry, `search`. The corner seal is
 *                   part of the registry's mechanics, so every view is
 *                   sealed by the same rule with no code of its own.
 *   HEADER_ACTIONS  {key, label, title, enabled, onClick} — the buttons at
 *                   the right of the header row. Ships empty.
 *
 * Exposed for the test harness as globalThis.__okpyeonSidebar:
 *
 *   viewRegistry            the live SIDEBAR_VIEWS array
 *   actionRegistry          the live HEADER_ACTIONS array
 *   registerView(view)      push + re-render the nav; returns the view
 *   renderNav()             -> number of tabs rendered (0 with one view)
 *   renderActions()         -> number of actions rendered
 *   showView(key)           -> boolean; mounts on first show, then toggles
 *   activeView()            -> the key currently shown, or null
 *   refreshSeal()           re-measure every view's corner-seal room
 *                           (debounced), the same nudge views get on ctx
 *   sealRoom                the px of clear space the seal needs
 *   sealDebounce            the ms every seal path shares, so a check can
 *                           wait it out without hard-coding it
 *   handleWorkerMessage(m)  the worker-message handler (the panel half of the
 *                           pending-query push), driveable without a real
 *                           chrome.runtime; -> Promise<{applied, ...}>
 *   ready                   Promise resolved once the boot sequence is done
 *                           (the initial query has been resolved, the chrome
 *                           rendered and the search view mounted)
 */
(function () {
  "use strict";

  /* ------------------------------------------------------------------ *
   * Header actions registry
   *
   * renderHeaderActions below is entirely generic, so a new header action is
   * one entry in this array: no new markup, no new CSS (the per-key modifier
   * class is generated), no new wiring.
   *
   * Entry: {
   *   key,      // required, unique — becomes the .action--<key> modifier
   *   label,    // the visible glyph or short word
   *   title,    // tooltip / accessible name; on a disabled entry, say WHY
   *   enabled,  // boolean or () => boolean; default true. false = dimmed+inert
   *   onClick   // (event) => void, ignored when disabled
   * }
   *
   * It ships EMPTY on purpose. Search needs no icon (its input is always
   * visible directly below), and a placeholder that does nothing is worse
   * than an empty header. Example of the first real entry, for when the
   * saved-words surface exists — on this surface it is a VIEW, so the action
   * registers one and switches to it rather than navigating the page away:
   *
   *   HEADER_ACTIONS.push({
   *     key: "saved",
   *     label: "★",
   *     title: "Saved words",
   *     enabled: true,
   *     onClick: function () {
   *       registerView({
   *         key: "saved",
   *         label: "Saved",
   *         title: "Saved words",
   *         mount: function (container, ctx) { ... }
   *       });
   *       showView("saved");
   *     }
   *   });
   * ------------------------------------------------------------------ */

  var HEADER_ACTIONS = [];

  function isEnabled(action) {
    if (typeof action.enabled === "function") return action.enabled() !== false;
    return action.enabled !== false; // default: enabled
  }

  // Rebuilt wholesale rather than patched: the registry is small, and a full
  // rebuild means `enabled` can be a live predicate without any invalidation
  // protocol. Returns the number of actions rendered.
  function renderHeaderActions(container, registry) {
    if (!container) return 0;
    while (container.firstChild) container.removeChild(container.firstChild);
    var list = registry || [];
    for (var i = 0; i < list.length; i++) {
      var action = list[i];
      if (!action || !action.key) continue;
      var button = document.createElement("button");
      button.type = "button";
      button.className = "action action--" + action.key;
      // Dictionary/registry text only ever reaches the DOM as text.
      button.textContent = action.label == null ? "" : String(action.label);
      var title = action.title == null ? "" : String(action.title);
      if (title) button.title = title;
      // The label is usually a bare glyph, so the title carries the name.
      button.setAttribute("aria-label", title || button.textContent || action.key);
      if (isEnabled(action)) {
        if (typeof action.onClick === "function") {
          button.addEventListener("click", (function (fn) {
            return function (ev) { fn(ev); };
          })(action.onClick));
        }
      } else {
        button.disabled = true;
        button.classList.add("action--disabled");
      }
      container.appendChild(button);
    }
    return container.childElementCount;
  }

  /* ------------------------------------------------------------------ *
   * View registry
   *
   * Entry: {
   *   key,      // required, unique — becomes the .view--<key> modifier and
   *             //   the id of the view's container
   *   label,    // the tab's visible text (falls back to the key)
   *   title,    // the tab's tooltip; on a disabled entry, say WHY
   *   enabled,  // boolean or () => boolean; default true. false = dimmed+inert
   *   mount,    // required: (container, ctx) => void, called ONCE
   *   onShow,   // optional: () => void, on every switch TO this view
   *   onHide,   // optional: () => void, on every switch AWAY from it
   *   seal      // optional: which box holds this view's content. See
   *             //   "Corner seal" below; every view is sealed without asking.
   * }
   *
   * A view is mounted once and then only shown and hidden, so its input,
   * results, breadcrumb trail and scroll position all survive a trip to
   * another view. `ctx` is {embedApi, shell, refreshSeal}: the live embed API
   * content.js exposed, the search-shell MODULE (not a controller instance,
   * since the module is defined before any view can mount and its .controller()
   * hands back the live controller whenever a view actually wants it), and the
   * seal nudge described under "Corner seal".
   *
   * It ships with exactly ONE entry. The nav renders tabs only from the
   * second entry on, so adding "saved" or "settings" later is one push and
   * the tab row appears by itself.
   * ------------------------------------------------------------------ */

  var SIDEBAR_VIEWS = [];

  var navBox = document.getElementById("okp-nav");
  var actionsBox = document.getElementById("okp-actions");
  var viewsBox = document.getElementById("okp-views");

  // key -> container element, so mount() runs exactly once per view.
  var mountedViews = Object.create(null);
  var activeKey = null;
  // The query the search view should start with. Resolved before the view is
  // mounted (see the boot sequence), because the shell takes it at init time.
  var bootQuery = "";

  function findView(key) {
    for (var i = 0; i < SIDEBAR_VIEWS.length; i++) {
      if (SIDEBAR_VIEWS[i] && SIDEBAR_VIEWS[i].key === key) return SIDEBAR_VIEWS[i];
    }
    return null;
  }

  function viewContext() {
    return {
      embedApi: globalThis.__okpyeonEmbedApi,
      shell: globalThis.__okpyeonSearchShell,
      refreshSeal: refreshSeals
    };
  }

  /* ------------------------------------------------------------------ *
   * Corner seal (SPEC "Corner seal")
   *
   * ONE implementation, here, for every view. The seal is a decorative paper
   * mark that only ever marks EMPTY paper: it shows while it FITS in the clear
   * space under the view's content, so text never sits on it and an empty view
   * shows it by construction. sidepanel.css holds the other half
   * (.view--sealed / .view--roomy, and the z-index rules that keep the mark
   * behind the content but in front of the page background).
   *
   * Sealing is part of BEING a view, not something a view opts into: a new
   * registry entry gets the mark with no code of its own. Views differ only in
   * which box holds their content, so that is the one thing a view may say:
   *
   *   seal: false                    // no seal on this view
   *   seal: function (container) {}  // -> the element whose children are the
   *                                  //   content (default: the container)
   *
   * The box's CHILDREN are measured, never the box: a stretched flex scroller
   * (#okp-results, .settings-body) always reaches the view's bottom edge and
   * would report zero room forever. A box with no laid-out children falls back
   * to the box's own top, so the whole space below it counts as room.
   *
   * Re-measured on: a measured child resizing, a child arriving or leaving, a
   * window resize, a view switch, and any nudge a view makes through
   * ctx.refreshSeal (the search shell's onState and the saved and settings
   * renders use it). Size IS the render signal, so the observers alone cover
   * searches, drill-downs, show-more and folder collapses with no renderer
   * hook. Every path shares ONE debounce, so a burst of renders measures once
   * and every view answers the same panel width the same way.
   * ------------------------------------------------------------------ */

  var SEAL_ROOM = 230;      // px of clear space the seal needs to show
  var SEAL_DEBOUNCE = 60;   // ms, one timer for all views

  var seals = [];           // {container, box, watched, observers}
  var sealTimer = null;

  function measureSeal(seal) {
    var box = seal.box;
    var edge = 0;
    for (var i = 0; i < box.children.length; i++) {
      var rect = box.children[i].getBoundingClientRect();
      if (rect.height > 0 && rect.bottom > edge) edge = rect.bottom;
    }
    var room = seal.container.getBoundingClientRect().bottom -
      (edge || box.getBoundingClientRect().top);
    seal.container.classList.toggle("view--roomy", room >= SEAL_ROOM);
  }

  function refreshSeals() {
    clearTimeout(sealTimer);
    sealTimer = setTimeout(function () {
      for (var i = seals.length - 1; i >= 0; i--) {
        // A container lifted out of the document (the harness retires its
        // probe views this way) measures nothing but zeros forever, so it is
        // dropped rather than measured.
        if (seals[i].container.isConnected === false) {
          seals[i].observers.forEach(function (o) { o.disconnect(); });
          seals.splice(i, 1);
          continue;
        }
        measureSeal(seals[i]);
      }
    }, SEAL_DEBOUNCE);
  }

  // Called once per view, right after mount(), so the box a view names is
  // already in the container.
  function attachSeal(view, container) {
    if (view.seal === false) return null;
    var box = container;
    if (typeof view.seal === "function") {
      var named = view.seal(container);
      if (named && typeof named.getBoundingClientRect === "function") box = named;
    }
    container.classList.add("view--sealed");
    var seal = { container: container, box: box, watched: [], observers: [] };
    seals.push(seal);
    if (typeof ResizeObserver !== "function" ||
        typeof MutationObserver !== "function") {
      refreshSeals();
      return seal;
    }
    var sizes = new ResizeObserver(refreshSeals);
    // Enrolment is a reconcile rather than an append: a view that rebuilds its
    // content wholesale (settings does, on every show) would otherwise leave
    // every past generation of children under observation.
    function watchChildren() {
      var kids = Array.prototype.slice.call(box.children);
      for (var i = seal.watched.length - 1; i >= 0; i--) {
        if (kids.indexOf(seal.watched[i]) < 0) {
          sizes.unobserve(seal.watched[i]);
          seal.watched.splice(i, 1);
        }
      }
      for (var j = 0; j < kids.length; j++) {
        if (seal.watched.indexOf(kids[j]) < 0) {
          seal.watched.push(kids[j]);
          sizes.observe(kids[j]);
        }
      }
      refreshSeals();
    }
    watchChildren();
    var arrivals = new MutationObserver(watchChildren);
    arrivals.observe(box, { childList: true });
    seal.observers.push(sizes, arrivals);
    return seal;
  }

  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("resize", refreshSeals);
  }

  // The search view's container is authored in the markup (it is the one view
  // that always exists, and the shell wants a laid-out container); every other
  // view gets one built here on first show.
  function containerFor(view) {
    if (mountedViews[view.key]) return mountedViews[view.key];
    var container = viewsBox
      ? viewsBox.querySelector('[data-view="' + view.key + '"]')
      : null;
    if (!container) {
      container = document.createElement("div");
      container.id = "okp-view-" + view.key;
      container.className = "view view--" + view.key;
      container.setAttribute("data-view", view.key);
      container.classList.add("view--hidden");
      if (viewsBox) viewsBox.appendChild(container);
    }
    return container;
  }

  // Shows one view and hides the rest. Mounts on the first show only — views
  // are never destroyed or rebuilt, which is what keeps search state alive
  // across a switch. Fires onHide on the outgoing view, then onShow on the
  // incoming one. Returns false for an unknown key.
  function showView(key) {
    var view = findView(key);
    if (!view) return false;
    if (activeKey === key && mountedViews[key]) return true;

    var container = containerFor(view);
    var firstShow = !mountedViews[view.key];
    if (firstShow) {
      mountedViews[view.key] = container;
      if (typeof view.mount === "function") view.mount(container, viewContext());
      attachSeal(view, container);
    }

    var outgoing = activeKey ? findView(activeKey) : null;
    if (outgoing && outgoing.key !== key && typeof outgoing.onHide === "function") {
      outgoing.onHide();
    }

    for (var i = 0; i < SIDEBAR_VIEWS.length; i++) {
      var other = SIDEBAR_VIEWS[i];
      var box = other && mountedViews[other.key];
      if (!box) continue;
      if (other.key === key) box.classList.remove("view--hidden");
      else box.classList.add("view--hidden");
    }

    activeKey = key;
    renderNav();
    if (typeof view.onShow === "function") view.onShow();
    // A hidden view measures nothing but zeros, so the one just revealed has
    // to be measured again before its seal means anything.
    refreshSeals();
    return true;
  }

  // Tabs exist to choose BETWEEN views, so one view means no nav at all — not
  // a lone tab that does nothing. Returns the number of tabs rendered.
  function renderNav() {
    if (!navBox) return 0;
    while (navBox.firstChild) navBox.removeChild(navBox.firstChild);
    if (SIDEBAR_VIEWS.length < 2) {
      navBox.classList.add("nav--hidden");
      return 0;
    }
    navBox.classList.remove("nav--hidden");
    for (var i = 0; i < SIDEBAR_VIEWS.length; i++) {
      var view = SIDEBAR_VIEWS[i];
      if (!view || !view.key) continue;
      var button = document.createElement("button");
      button.type = "button";
      button.className = "tab tab--" + view.key;
      button.textContent = view.label == null ? String(view.key) : String(view.label);
      var title = view.title == null ? "" : String(view.title);
      if (title) button.title = title;
      button.setAttribute("aria-label", title || button.textContent || view.key);
      if (view.key === activeKey) {
        button.classList.add("tab--active");
        button.setAttribute("aria-current", "page");
      }
      // Same convention as the header actions: a not-yet-usable entry is
      // present, dimmed, inert, and explained by its title.
      if (isEnabled(view)) {
        button.addEventListener("click", (function (key) {
          return function () { showView(key); };
        })(view.key));
      } else {
        button.disabled = true;
        button.classList.add("tab--disabled");
      }
      navBox.appendChild(button);
    }
    return navBox.childElementCount;
  }

  function registerView(view) {
    if (!view || !view.key) throw new TypeError("sidebar: a view needs a key");
    if (findView(view.key)) throw new Error("sidebar: duplicate view key " + view.key);
    if (typeof view.mount !== "function") {
      throw new TypeError("sidebar: view " + view.key + " needs a mount()");
    }
    SIDEBAR_VIEWS.push(view);
    renderNav(); // a second entry is what makes the tab row appear
    return view;
  }

  /* ------------------------------------------------------------------ *
   * The search view — the only entry today.
   *
   * Its container is the one in the markup, so mount() just hands the shell
   * the elements inside it. The shell is a per-page singleton: mount runs
   * once, so init() is never called twice, and switching away and back is a
   * display toggle that leaves the input, the results and the breadcrumb
   * trail exactly as they were.
   * ------------------------------------------------------------------ */

  SIDEBAR_VIEWS.push({
    key: "search",
    label: "Search",
    title: "Search words and roots",
    // The content is the renderer's shadow host inside #okp-results, not the
    // whole view: the searchbar and the status line are chrome, and measuring
    // them would call a one-card result as crowded as a full page.
    seal: function (container) { return container.querySelector("#okp-results"); },
    mount: function (container, ctx) {
      ctx.shell.init({
        input: document.getElementById("okp-input"),
        results: container.querySelector("#okp-results"),
        status: container.querySelector("#okp-status"),
        onState: function () { ctx.refreshSeal(); },
        // Focus rules: the input is focused ONLY on an empty boot — the
        // icon-click open, where typing into the panel is the next thing the
        // user does. A boot that already has a query came from somewhere the
        // user was just typing (the omnibox, or a ?q= link they followed), and
        // grabbing focus there steals the keystrokes meant for that place.
        autofocus: !bootQuery,
        initialQuery: bootQuery
      });
    }
  });

  /* ------------------------------------------------------------------ *
   * The searchbar is global chrome above the views, so typing in it while
   * another view is up means "search" — the results have to be where the user
   * can see them. Attached at load, before the shell's own input handler
   * exists, so the view is already showing by the time the shell reacts.
   * ------------------------------------------------------------------ */

  (function () {
    var inputEl = document.getElementById("okp-input");
    if (!inputEl) return;
    inputEl.addEventListener("input", function () {
      if (activeKey && activeKey !== "search") showView("search");
    });
  })();

  /* ------------------------------------------------------------------ *
   * The wordmark is HOME. It shows the search view, empties the field and
   * the results, and drops whatever descent the reader was in.
   *
   * It used to look up "etymology", the word the name is built from. That
   * read as a bug on this surface: the reader presses the app's own name and
   * gets a card for a different word, as though Etymikon were an entry
   * (Jesse decision 2026-08-25). Home is what a wordmark means everywhere
   * else, and it is the one thing this button can promise.
   *
   * The empty search does all three parts at once: the shell clears the panel
   * through the renderer (which resets the view stack with it) and settles on
   * the empty state, and no lookup is ever issued. Clicks that land before
   * boot finishes queue on `ready` rather than being dropped.
   * ------------------------------------------------------------------ */

  (function () {
    var brand = document.getElementById("okp-brand");
    if (!brand) return;
    brand.addEventListener("click", function () {
      ready.then(function () {
        var shell = globalThis.__okpyeonSearchShell;
        var controller = shell && shell.controller && shell.controller();
        if (!controller) return;
        var inputEl = document.getElementById("okp-input");
        if (inputEl) inputEl.value = "";
        showView("search");
        controller.search("");
      });
    });
  })();

  /* ------------------------------------------------------------------ *
   * Initial query
   *
   * Two sources, and `?q=` wins: it is an explicit deep link (the omnibox
   * tab fallback, or a hand-typed URL), while the pending query is whatever
   * the worker happened to be holding. When `?q=` is present the worker is
   * not asked at all — the omnibox clears the pending query before it takes
   * the tab path, so there is nothing to collect.
   * ------------------------------------------------------------------ */

  function deepLinkQuery() {
    try {
      return new URLSearchParams(location.search).get("q") || "";
    } catch (e) {
      return "";
    }
  }

  // content.js's HAS_CHROME_RUNTIME probe with one addition: `id`. A plain
  // web page (the test harness) can also see a chrome.runtime, but only an
  // extension page's has an id and a receiver for a one-argument
  // sendMessage. Anything else falls back to the harness's fake worker, and
  // failing that there is no worker to ask.
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

  // Same shape as content.js's sendToWorker: callback form (which both MV3
  // and the fake runtime support), promise form if one comes back, and every
  // failure resolves null rather than rejecting.
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
          // Reading lastError clears the "Unchecked runtime.lastError"
          // warning an unanswered message would otherwise log.
          if (globalThis.chrome && globalThis.chrome.runtime &&
              globalThis.chrome.runtime.lastError) {
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
        maybePromise.then(function (response) { done(response || null); },
                          function () { done(null); });
      }
    });
  }

  // The panel must boot normally when there is no pending query, no worker,
  // or a worker too old to know the message type — all of which read as "".
  function pendingQuery() {
    return sendToWorker({ type: "getPendingQuery" }).then(function (res) {
      if (res && res.ok === true && typeof res.query === "string") return res.query;
      return "";
    }, function () {
      return "";
    });
  }

  function resolveInitialQuery() {
    var deep = deepLinkQuery();
    if (deep) return Promise.resolve(deep);
    return pendingQuery();
  }

  /* ------------------------------------------------------------------ *
   * Boot
   * ------------------------------------------------------------------ */

  function renderActions() {
    return renderHeaderActions(actionsBox, HEADER_ACTIONS);
  }

  var ready = resolveInitialQuery().then(function (initialQuery) {
    bootQuery = initialQuery;
    renderActions();
    showView(SIDEBAR_VIEWS[0].key); // mounts the search view and wires the shell
    return initialQuery;
  });

  // Never rejects, so a poke that arrives while boot is in flight (or after a
  // boot that went wrong) still gets a decision instead of hanging.
  var bootSettled = ready.then(null, function () { return null; });

  /* ------------------------------------------------------------------ *
   * Repeat omnibox searches (the push half of the handshake)
   *
   * The boot pull above only covers a COLD panel. When the panel is already
   * open, the worker pokes it after sidePanel.open() resolves and the panel
   * pulls again. Otherwise a second `et` query would sit unread until the
   * next panel open, and then re-run as a stale search.
   *
   * The poke carries the window it was meant for. A panel that knows its own
   * window id and sees a different one ignores it, so a second Chrome window's
   * panel does not steal the query. "Unknown" (no chrome.windows, e.g. the
   * harness or the page opened as a plain tab) is not a mismatch: with nothing
   * to compare, applying is the behavior that keeps the single-window case —
   * the one that actually happens — working.
   * ------------------------------------------------------------------ */

  var ownWindowId = null;

  // Always resolves; "we never found out" reads the same as "no chrome.windows".
  var ownWindowReady = (function () {
    var chromeObj = globalThis.chrome;
    var windows = chromeObj && chromeObj.windows;
    if (!windows || typeof windows.getCurrent !== "function") {
      return Promise.resolve();
    }
    return new Promise(function (resolve) {
      function take(win) {
        if (win && typeof win.id === "number") ownWindowId = win.id;
        resolve();
      }
      var maybePromise;
      try {
        maybePromise = windows.getCurrent(function (win) {
          // Read lastError so Chrome doesn't log an unchecked-error warning.
          if (globalThis.chrome && globalThis.chrome.runtime &&
              globalThis.chrome.runtime.lastError) {
            resolve();
            return;
          }
          take(win);
        });
      } catch (e) {
        resolve();
        return;
      }
      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.then(take, function () { resolve(); });
      }
    });
  })();

  // Writes a pulled query into the page and searches it. The shell's search()
  // deliberately does not touch input.value, so the input is set here — the
  // same programmatic set the boot path does, and like it, it is not a typing
  // event, so nothing about IME composition is being interrupted.
  //
  // Value only: no focus, no selection. The user typed this in the omnibox and
  // is still there, so a panel that grabbed focus (or moved a caret in an input
  // that happens to be focused) would take the keystrokes meant for it.
  function applyPendingQuery(query) {
    // The search has to be VISIBLE: an omnibox query that landed behind the
    // saved or settings view would look like nothing happened.
    showView("search");
    var shellModule = globalThis.__okpyeonSearchShell;
    var controller = shellModule && typeof shellModule.controller === "function"
      ? shellModule.controller()
      : null;
    if (!controller) return Promise.resolve({ applied: false, reason: "no-shell" });
    var inputEl = document.getElementById("okp-input");
    if (inputEl) inputEl.value = query;
    return Promise.resolve(controller.search(query)).then(function () {
      return { applied: true, query: query };
    }, function () {
      // The search reporting an error is the shell's business, not the poke's.
      return { applied: true, query: query };
    });
  }

  // Exposed on __okpyeonSidebar so the harness can drive it with no runtime.
  function handleWorkerMessage(message) {
    if (!message || message.type !== "pendingQueryChanged") {
      return Promise.resolve({ applied: false, reason: "ignored" });
    }
    return bootSettled.then(function () {
      return ownWindowReady;
    }).then(function () {
      if (typeof message.windowId === "number" &&
          typeof ownWindowId === "number" &&
          message.windowId !== ownWindowId) {
        return { applied: false, reason: "other-window" };
      }
      return pendingQuery().then(function (query) {
        // Empty means another panel won the read-once race, or the poke was
        // stale. Either way there is nothing to show and nothing to clear.
        if (!query) return { applied: false, reason: "nothing-pending" };
        return applyPendingQuery(query);
      });
    });
  }

  // Real runtime only: the harness has no onMessage, and drives the handler
  // directly instead. Returns nothing — the reply channel is not used.
  (function () {
    var chromeObj = globalThis.chrome;
    var runtime = chromeObj && chromeObj.runtime;
    if (!runtime || !runtime.id || !runtime.onMessage ||
        typeof runtime.onMessage.addListener !== "function") {
      return;
    }
    runtime.onMessage.addListener(function (message) {
      handleWorkerMessage(message);
    });
  })();

  // The registries themselves, so a check can prove that a NEW view or a new
  // action needs nothing but an entry — the same hook content.js exposes for
  // its badge registry.
  globalThis.__okpyeonSidebar = {
    viewRegistry: SIDEBAR_VIEWS,
    actionRegistry: HEADER_ACTIONS,
    registerView: registerView,
    renderNav: renderNav,
    renderActions: renderActions,
    showView: showView,
    activeView: function () { return activeKey; },
    refreshSeal: refreshSeals,
    sealRoom: SEAL_ROOM,
    sealDebounce: SEAL_DEBOUNCE,
    handleWorkerMessage: handleWorkerMessage,
    ready: ready
  };
})();
