// Cosmetic content filter for the WebLinks / News preview webviews.
//
// Injected as an initialization script so it runs on every document load,
// before the page's own scripts. It hides common ad slots and dismisses or
// hides cookie-consent banners. This is cosmetic only: it changes what is
// rendered, not what the site is allowed to request.
(function () {
  "use strict";

  if (window.__gameindexContentFilter) return;
  window.__gameindexContentFilter = true;

  var STYLE_ID = "__gameindex_content_filter_style";

  var AD_SELECTORS = [
    "ins.adsbygoogle",
    "iframe[src*='doubleclick.net']",
    "iframe[src*='googlesyndication.com']",
    "iframe[src*='googleadservices.com']",
    "iframe[src*='adservice.google']",
    "iframe[src*='amazon-adsystem.com']",
    "iframe[src*='taboola.com']",
    "iframe[src*='outbrain.com']",
    "[id^='google_ads_']",
    "[id^='div-gpt-ad']",
    "[id^='aswift_']",
    "[id^='taboola-']",
    "[id^='outbrain_widget']",
    "[id*='banner-ad']",
    "[id='ad-container']",
    "[id='ad-wrapper']",
    "[id='advertisement']",
    "[class*='adsbygoogle']",
    "[class*='sponsored-content']",
    "[class~='ad-banner']",
    "[class~='ad-container']",
    "[class~='ad-slot']",
    "[class~='ads-container']",
    "[class~='advert']",
    "[class~='advertisement']",
    "[class~='advertisment']",
    "[data-ad-client]",
    "[data-ad-slot]",
    "[data-google-query-id]",
    "[aria-label='Advertisement' i]",
    "[aria-label='advertisement' i]"
  ];

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
    "[class*='cookie' i][class*='consent' i]"
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

  function buildCss() {
    var rules = [];
    var selectors = AD_SELECTORS.concat(CONSENT_SELECTORS);
    for (var i = 0; i < selectors.length; i++) {
      rules.push(selectors[i] + "{display:none !important;}");
    }
    return rules.join("");
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return true;
    var parent = document.head || document.documentElement;
    if (!parent) return false;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = buildCss();
    parent.appendChild(style);
    return true;
  }

  function normalise(text) {
    return String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function collectConsentContainers() {
    var found = [];
    for (var s = 0; s < CONSENT_SELECTORS.length; s++) {
      var nodes;
      try {
        nodes = document.querySelectorAll(CONSENT_SELECTORS[s]);
      } catch (e) {
        continue;
      }
      for (var n = 0; n < nodes.length; n++) {
        if (found.indexOf(nodes[n]) === -1) found.push(nodes[n]);
      }
    }
    return found;
  }

  // HTMLElement.click() dispatches the event even while the element is
  // display:none, so the banner can be dismissed after the CSS has hidden it.
  function clickByText(root, phrases) {
    var candidates = root.querySelectorAll(
      "button, [role='button'], input[type='button'], input[type='submit'], a"
    );
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (el.__gameindexClicked) continue;
      var label = normalise(
        el.innerText || el.value || el.getAttribute("aria-label") || el.textContent
      );
      if (!label || label.length > 70) continue;
      for (var p = 0; p < phrases.length; p++) {
        if (label === phrases[p] || label.indexOf(phrases[p]) !== -1) {
          try {
            el.__gameindexClicked = true;
            el.click();
            return true;
          } catch (e) {
            /* ignore — some buttons reject programmatic clicks */
          }
        }
      }
    }
    return false;
  }

  function dismissConsent() {
    var containers = collectConsentContainers();
    if (!containers.length) return false;

    var i;
    for (i = 0; i < containers.length; i++) {
      if (clickByText(containers[i], REJECT_TEXTS)) return true;
    }
    for (i = 0; i < containers.length; i++) {
      if (clickByText(containers[i], ACCEPT_TEXTS)) return true;
    }
    return true;
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

  function tick() {
    ensureStyles();
    if (dismissConsent()) unlockScroll();
  }

  var started = false;
  var scheduled = false;
  var observer = null;

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(function () {
      scheduled = false;
      tick();
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
    if (started) return;
    if (!document.documentElement) {
      setTimeout(start, 50);
      return;
    }
    started = true;
    tick();
    var timers = [400, 1200, 2500, 5000];
    for (var i = 0; i < timers.length; i++) setTimeout(tick, timers[i]);
    try {
      observer = new MutationObserver(schedule);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      // Late-arriving banners are rare once the page settles; stop watching
      // so a busy page isn't re-scanned on every mutation for its lifetime.
      setTimeout(stopWatching, 15000);
    } catch (e) {
      /* MutationObserver unavailable — the timers still cover the load */
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tick);
    start();
  } else {
    start();
  }
})();
