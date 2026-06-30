/**
 * UpKit add-on: New Upwork MESSAGE alert.
 *
 * UpKit's built-in notifications only fire for new *jobs*. This script adds an
 * alert when you receive a new *chat message* on Upwork.
 *
 * How it works: it runs on every upwork.com page (isolated world) and watches
 * the global "unread messages" indicator (the badge Upwork keeps live in the
 * top nav, plus the tab title). When the unread count goes UP, it reports the
 * new count to the background service worker, which fires the desktop
 * notification + sound. State/dedup lives in the background so multiple open
 * Upwork tabs don't double-notify.
 *
 * Tuning: set DEBUG=true (default) and watch the [UpKit-MsgAlert] logs in the
 * page console. If the detected count is wrong/0 when you actually have unread
 * messages, copy the badge element's HTML from the nav and the selector can be
 * made exact.
 */
(function () {
  "use strict";

  const TAG = "[UpKit-MsgAlert]";
  const DEBUG = true;          // set to false to silence console logs
  const POLL_MS = 4000;        // periodic re-check
  const MUTATION_THROTTLE_MS = 800;

  let lastSent = -1;

  function log() {
    if (!DEBUG) return;
    try { console.log.apply(console, [TAG].concat([].slice.call(arguments))); } catch (e) {}
  }

  function toInt(s) {
    const n = parseInt(s, 10);
    return isNaN(n) ? 0 : n;
  }

  const onMessagesPage = /\/messages(\/|$)/i.test(location.pathname);

  // --- Signal 1: tab title, e.g. "(3) Messages | Upwork" -------------------
  function fromTitle() {
    const m = (document.title || "").match(/^\s*\((\d+)\)/);
    return m ? toInt(m[1]) : 0;
  }

  // --- Signal 2: aria-labels that explicitly mention unread messages -------
  function fromAria() {
    let best = 0;
    const els = document.querySelectorAll("[aria-label]");
    for (let i = 0; i < els.length; i++) {
      const al = els[i].getAttribute("aria-label") || "";
      if (/messag/i.test(al) && /(unread|new)/i.test(al)) {
        const m = al.match(/\d+/);
        if (m) best = Math.max(best, toInt(m[0]));
      }
    }
    return best;
  }

  // --- Signal 3: numeric badge sitting next to a "Messages" nav item -------
  // Restricted to the header/nav neighborhood, and skipped on the inbox page
  // itself (where in-page numbers would cause false positives).
  function fromNavBadge() {
    if (onMessagesPage) return 0;

    let best = 0;
    // Candidate "Messages" entry points in the top navigation.
    const links = document.querySelectorAll(
      'a[href*="/messages"], a[href*="messages"], [data-test*="messages" i], [data-test*="Message"]'
    );

    const seen = new Set();
    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      // Only consider items that live inside the page chrome (header/nav).
      const chrome_ = link.closest('header, nav, [role="banner"], [role="navigation"]');
      if (!chrome_) continue;

      // Small neighborhood around the link where a badge would render.
      const scope = link.closest("li, div") || link.parentElement || link;
      if (seen.has(scope)) continue;
      seen.add(scope);

      // Leaf elements whose entire text is just a small number = a badge.
      const leaves = scope.querySelectorAll("*");
      for (let j = 0; j < leaves.length; j++) {
        const node = leaves[j];
        if (node.children.length !== 0) continue;
        const t = (node.textContent || "").trim();
        if (/^\d{1,3}$/.test(t)) best = Math.max(best, toInt(t));
      }
      // The link's own aria-label may carry the count.
      const al = link.getAttribute("aria-label") || "";
      if (/unread|new/i.test(al)) {
        const m = al.match(/\d+/);
        if (m) best = Math.max(best, toInt(m[0]));
      }
    }
    return best;
  }

  function detect() {
    const t = fromTitle();
    const a = fromAria();
    const b = fromNavBadge();
    return { best: Math.max(t, a, b), t: t, a: a, b: b };
  }

  function tick() {
    let r;
    try { r = detect(); } catch (e) { log("detect error", e); return; }
    if (r.best === lastSent) return;

    log("unread =", r.best, "(title=" + r.t, "aria=" + r.a, "navBadge=" + r.b + ")");
    lastSent = r.best;
    try {
      chrome.runtime.sendMessage(
        { type: "UPWORK_UNREAD_REPORT", count: r.best, url: location.href },
        function () { void chrome.runtime.lastError; } // swallow "no receiver" on reload
      );
    } catch (e) {
      // Extension context invalidated (e.g. reloaded) — ignore.
    }
  }

  // Initial read shortly after load, then poll.
  setTimeout(tick, 1500);
  setInterval(tick, POLL_MS);

  // React quickly to live DOM updates (websocket-driven badge changes),
  // throttled so we don't thrash on a busy SPA.
  let pending = false;
  try {
    const obs = new MutationObserver(function () {
      if (pending) return;
      pending = true;
      setTimeout(function () { pending = false; tick(); }, MUTATION_THROTTLE_MS);
    });
    obs.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  } catch (e) {
    log("MutationObserver unavailable", e);
  }

  log("loaded on", location.href, "(onMessagesPage=" + onMessagesPage + ")");
})();
