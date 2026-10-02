// Cookie-consent bypass for the embedded preview webviews.
//
// Two layers:
//   1. Pre-seed the well-known "banner already dismissed" cookies/localStorage
//      keys at document start, before the CMP's own script runs. This is what
//      actually stops OneTrust / CookieBot / Didomi banners from appearing on
//      sites that already gave us their hook names.
//   2. If a banner still shows, hide its container and click a reject /
//      strictly-necessary / accept control (in that order) as soon as it
//      appears, from a bounded polling + MutationObserver window.
//
// The whole thing is also exposed as `window.__gameindexDismissConsent`, and
// re-evaluating this file re-runs the dismissal on demand — so the toolbar's
// "Dismiss cookie banner" command works even after the automatic window ends.
(function () {
  "use strict";

  var CONSENT_SELECTORS = [
    "#onetrust-banner-sdk",
    "#onetrust-consent-sdk",
    "#onetrust-pc-sdk",
    ".onetrust-pc-dark-filter",
    "#CybotCookiebotDialog",
    "#CybotCookiebotDialogBodyUnderlay",
    "#CybotCookiebotDialogBody",
    "#qc-cmp2-container",
    ".qc-cmp2-container",
    ".qc-cmp2-ui",
    "#didomi-host",
    ".didomi-popup-container",
    ".didomi-notice-popup",
    "#usercentrics-root",
    "#usercentrics-cmp-ui",
    "[id^='sp_message_container_']",
    ".fc-consent-root",
    ".fc-dialog-overlay",
    ".osano-cm-window",
    ".cc-window",
    ".cc-banner",
    ".cookie-consent",
    ".cookie-banner",
    ".cookie-notice",
    ".cookie-bar",
    ".cookie-wall",
    ".cookie-modal",
    ".cmp-container",
    ".gdpr-banner",
    "#cookie-law-info-bar",
    "#cookie-law-info-again",
    "#cookie-banner",
    "#cookie-notice",
    ".evidon-banner",
    "#truste-consent-track",
    ".trustarc-banner",
    "[id*='cookie' i][class*='banner' i]",
    "[class*='consent' i][class*='banner' i]",
    "[class*='cookie' i][class*='consent' i]",
    "[class*='cookie' i][class*='dialog' i]"
  ];

  // Known CMP control ids/classes — far more reliable than reading button text.
  var REJECT_CONTROLS = [
    "#onetrust-reject-all-handler",
    "[id*='onetrust'][id*='reject']",
    "#CybotCookiebotDialogBodyButtonDecline",
    "#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll",
    "#didomi-notice-disagree-button",
    "[id*='didomi'][id*='disagree']",
    "#truste-consent-required",
    ".trustarc-agree-btn[data-trustarc-consent='required']",
    "#osano-cm-denyAll",
    ".osano-cm-denyAll",
    "[data-testid*='reject']",
    "[data-testid*='decline']",
    "[id*='reject-all']",
    "[class*='reject-all']"
  ];

  var ACCEPT_CONTROLS = [
    "#onetrust-accept-btn-handler",
    "#CybotCookiebotDialogBodyButtonAccept",
    "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
    "#didomi-notice-agree-button",
    "#osano-cm-accept-all",
    ".osano-cm-accept-all",
    "[data-testid*='accept']"
  ];

  // Preferred first so a banner is dismissed without granting consent.
  var REJECT_TEXTS = [
    "reject all",
    "reject cookies",
    "reject",
    "decline all",
    "decline",
    "deny",
    "disagree",
    "only necessary",
    "strictly necessary",
    "necessary only",
    "essential only",
    "essential cookies only",
    "continue without accepting",
    "without accepting",
    "no thanks",
    "do not accept",
    "don't accept",
    "refuse",
    "ablehnen",
    "alle ablehnen",
    "nur notwendige",
    "tout refuser",
    "refuser",
    "rechazar todo",
    "rechazar",
    "rifiuta tutto",
    "rechazar todas",
    "отклонить",
    "только необходимые",
    "拒绝全部",
    "全部拒绝",
    "接受必要"
  ];

  var ACCEPT_TEXTS = [
    "accept all",
    "accept all cookies",
    "accept cookies",
    "accept",
    "allow all",
    "allow",
    "agree",
    "i agree",
    "got it",
    "understood",
    "okay",
    "ok",
    "alle akzeptieren",
    "akzeptieren",
    "tout accepter",
    "accepter",
    "aceptar todo",
    "aceptar",
    "accetta tutto",
    "accetta",
    "принять",
    "接受全部",
    "同意",
    "接受"
  ];

  var STYLE_ID = "__gameindex_consent_filter_style";

  function buildCss() {
    var rules = [];
    for (var i = 0; i < CONSENT_SELECTORS.length; i++) {
      rules.push(CONSENT_SELECTORS[i] + "{display:none !important;}");
    }
    return rules.join("");
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var parent = document.head || document.documentElement;
    if (!parent) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = buildCss();
    parent.appendChild(style);
  }

  // Pre-seed the flags CMPs check before deciding to render a banner. This is
  // best-effort: unknown cookie names simply do nothing.
  function seedConsent() {
    var expires = new Date(Date.now() + 31536000000).toUTCString();
    var now = new Date().toISOString();
    var cookies = [
      // OneTrust (used by wand.com, MapGenie via Ziff Davis, and many
      // others). `OptanonAlertBoxClosed` suppresses the banner, and
      // `OptanonConsent` records an explicit all-denied choice so consent
      // stacks that read the groups don't default to "granted" (which would
      // still fire the Facebook pixel and targeted ads).
      ["OptanonAlertBoxClosed", now],
      [
        "OptanonConsent",
        "isGpcEnabled=0&datestamp=&version=202401.1.0&browserGpcFlag=0&isIABGlobal=false&hosts=&consentId=&interactionCount=1&landingPath=NotLandingPage&groups=C0001:1,C0002:0,C0003:0,C0004:0,C0005:0"
      ],
      [
        "CookieConsent",
        "{stamp:'" +
          Date.now() +
          "',necessary:true,preferences:false,statistics:false,marketing:false,method:'explicit',ver:1,utc:" +
          Date.now() +
          ",region:''}"
      ],
      ["cookie_consent", "1"],
      ["cookieConsent", "1"],
      ["cookie_accept", "1"],
      ["cookies_accepted", "true"]
    ];
    for (var i = 0; i < cookies.length; i++) {
      try {
        document.cookie =
          cookies[i][0] +
          "=" +
          cookies[i][1] +
          ";path=/;expires=" +
          expires +
          ";SameSite=Lax";
      } catch (e) {
        /* ignore */
      }
    }
    var localKeys = ["didomi_token", "euconsent-v2", "usercentrics"];
    for (var k = 0; k < localKeys.length; k++) {
      try {
        if (!window.localStorage.getItem(localKeys[k])) {
          window.localStorage.setItem(localKeys[k], "{}");
        }
      } catch (e) {
        /* ignore — storage may be blocked */
      }
    }
  }

  function normalise(text) {
    return String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  // Whole-word matching only: a bare "ok" must not match "Facebook"
  // ("facebook" contains "ok"), which previously clicked the share link and
  // navigated the preview to facebook.com.
  function matchesPhrase(label, phrase) {
    if (label === phrase) return true;
    var idx = 0;
    while ((idx = label.indexOf(phrase, idx)) !== -1) {
      var before = idx === 0 ? "" : label.charAt(idx - 1);
      var after = label.charAt(idx + phrase.length);
      if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) {
        return true;
      }
      idx += phrase.length;
    }
    return false;
  }

  // Never treat social-share/tracker links as consent controls, even if
  // their label happens to contain a matching word.
  function isShareOrTrackerLink(el) {
    var href = el.getAttribute && (el.getAttribute("href") || "");
    if (!href) return false;
    return /sharer\.php|share\.php|facebook\.com|twitter\.com|x\.com|reddit\.com|whatsapp\.com|vk\.com|pinterest\.|linkedin\.com/i.test(
      href
    );
  }

  function collectInRoot(root, found) {
    for (var c = 0; c < CONSENT_SELECTORS.length; c++) {
      var nodes;
      try {
        nodes = root.querySelectorAll(CONSENT_SELECTORS[c]);
      } catch (e) {
        continue;
      }
      for (var n = 0; n < nodes.length; n++) {
        if (found.indexOf(nodes[n]) === -1) found.push(nodes[n]);
      }
    }
  }

  function collectConsentContainers() {
    var found = [];
    collectInRoot(document, found);
    if (found.length) return found;

    // Nothing in the light DOM — look inside open shadow roots, but bound the
    // walk so a huge page isn't traversed on every tick.
    try {
      var all = document.querySelectorAll("*");
      var limit = Math.min(all.length, 8000);
      for (var i = 0; i < limit; i++) {
        var shadow = all[i].shadowRoot;
        if (shadow) collectInRoot(shadow, found);
      }
    } catch (e) {
      /* ignore */
    }
    return found;
  }

  // HTMLElement.click() fires even while the element is display:none, so a
  // banner can be dismissed after the CSS has already hidden it.
  function clickFirst(root, selectors) {
    for (var s = 0; s < selectors.length; s++) {
      var els;
      try {
        els = root.querySelectorAll(selectors[s]);
      } catch (e) {
        continue;
      }
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (el.__gameindexClicked) continue;
        try {
          el.__gameindexClicked = true;
          el.click();
          return true;
        } catch (e) {
          /* element rejected programmatic clicks */
        }
      }
    }
    return false;
  }

  function clickByText(root, phrases) {
    var candidates;
    try {
      candidates = root.querySelectorAll(
        "button, [role='button'], input[type='button'], input[type='submit'], a"
      );
    } catch (e) {
      return false;
    }
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (el.__gameindexClicked) continue;
      if (isShareOrTrackerLink(el)) continue;
      var label = normalise(
        el.innerText || el.value || el.getAttribute("aria-label") || el.textContent
      );
      if (!label || label.length > 70) continue;
      for (var p = 0; p < phrases.length; p++) {
        if (matchesPhrase(label, phrases[p])) {
          try {
            el.__gameindexClicked = true;
            el.click();
            return true;
          } catch (e) {
            /* ignore */
          }
        }
      }
    }
    return false;
  }

  function dismissConsent() {
    var containers = collectConsentContainers();
    var i;

    // Known control ids/classes are specific enough to scan page-wide.
    if (clickFirst(document, REJECT_CONTROLS)) return true;

    // Text matching is only safe inside a detected consent container — a
    // page-wide text scan can hit unrelated buttons/links (see matchesPhrase).
    for (i = 0; i < containers.length; i++) {
      if (clickByText(containers[i], REJECT_TEXTS)) return true;
    }

    if (clickFirst(document, ACCEPT_CONTROLS)) return true;

    for (i = 0; i < containers.length; i++) {
      if (clickByText(containers[i], ACCEPT_TEXTS)) return true;
    }

    return containers.length > 0;
  }

  // A dismissed cookie wall usually leaves `overflow: hidden` behind on the
  // scroll root. Clear only the inline value we can safely attribute to it.
  function unlockScroll() {
    var nodes = [document.documentElement, document.body];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!el || !el.style) continue;
      if (el.style.overflow === "hidden" || el.style.overflow === "clip") {
        el.style.overflow = "";
      }
    }
  }

  function run() {
    seedConsent();
    ensureStyles();
    if (dismissConsent()) unlockScroll();
  }

  window.__gameindexDismissConsent = function () {
    run();
    return true;
  };

  var scheduled = false;
  var observer = null;

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(function () {
      scheduled = false;
      run();
    }, 250);
  }

  function stopWatching() {
    if (observer) {
      try {
        observer.disconnect();
      } catch (e) {
        /* already detached */
      }
      observer = null;
    }
  }

  function start() {
    // A re-evaluation (the toolbar's dismiss command) should only re-run the
    // dismissal, not stack another set of timers/observers.
    if (window.__gameindexConsentStarted) {
      run();
      return;
    }
    if (!document.documentElement) {
      setTimeout(start, 50);
      return;
    }
    window.__gameindexConsentStarted = true;
    run();
    var timers = [0, 400, 1200, 2500, 5000, 10000, 20000, 30000];
    for (var i = 0; i < timers.length; i++) setTimeout(run, timers[i]);
    try {
      observer = new MutationObserver(schedule);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      // Late-arriving banners are rare once the page settles; stop watching so
      // a busy page isn't re-scanned on every mutation for its whole lifetime.
      setTimeout(stopWatching, 30000);
    } catch (e) {
      /* MutationObserver unavailable — the timers still cover the load */
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
    start();
  } else {
    start();
  }
})();
