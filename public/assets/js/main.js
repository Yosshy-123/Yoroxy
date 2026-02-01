"use strict";

(function () {
  /* ===============================
     Configuration
  ================================ */
  const ENABLE_BEFOREUNLOAD = false;

  if (ENABLE_BEFOREUNLOAD) {
    window.addEventListener("beforeunload", (event) => {
      event.returnValue = "";
    });
  }

  /* ===============================
     DOM References
  ================================ */
  const form = document.getElementById("uv-form");
  const address = document.getElementById("uv-address");

  /* ===============================
     Autofocus
  ================================ */
  function applyAutofocus() {
    if (!address) return;
    try {
      address.focus({ preventScroll: true });
    } catch {
      try {
        address.focus();
      } catch {}
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyAutofocus);
  } else {
    applyAutofocus();
  }

  /* ===============================
     Base64 URL-Safe Encode / Decode
  ================================ */
  class Base64 {
    static encode(raw) {
      return btoa(raw)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    }

    static decode(encoded) {
      let str = encoded
        .replace(/-/g, "+")
        .replace(/_/g, "/");
      while (str.length % 4) str += "="; // padding
      return atob(str);
    }
  }

  /* ===============================
     Input Resolver (URL / Search)
  ================================ */
  function isLikelyHostname(host) {
    const ipv4 = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/;
    const domainLike = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/.*)?$/i;
    return ipv4.test(host) || domainLike.test(host);
  }

  function resolveInput(value) {
    const input = String(value || "").trim();
    const searchTemplate = "https://duckduckgo.com/?q=%s";
    if (!input) return "";

    try {
      const url = new URL(input);
      return url.toString();
    } catch {}

    try {
      const candidate = input.startsWith("//") ? "http:" + input : "http://" + input;
      const url = new URL(candidate);
      if (isLikelyHostname(url.hostname)) return url.toString();
    } catch {}

    return searchTemplate.replace("%s", encodeURIComponent(input));
  }

  /* ===============================
     Service Worker Registration
  ================================ */
  function normalizePrefix(prefix) {
    if (!prefix) return "/";
    if (!prefix.startsWith("/")) prefix = "/" + prefix;
    if (!prefix.endsWith("/")) prefix = prefix + "/";
    return prefix;
  }

  if ("serviceWorker" in navigator && form && address) {
    let uvConfig = null;
    try {
      uvConfig = typeof globalThis.__uv$config !== "undefined" ? globalThis.__uv$config : null;
    } catch {
      uvConfig = null;
    }

    const proxySetting = "uv";
    const swMap = { uv: { file: "/uv/uv.sw.js", config: uvConfig } };
    const sw = swMap[proxySetting];

    if (!sw) {
      console.error("[Yoroxy] ServiceWorker map missing:", proxySetting);
      return;
    }
    if (!sw.config) {
      console.error("[Yoroxy] UV config not found. ServiceWorker not registered.");
      return;
    }

    sw.config.prefix = normalizePrefix(sw.config.prefix);

    navigator.serviceWorker
      .register(sw.file, { scope: sw.config.prefix })
      .then(() => {
        console.log("[Yoroxy] ServiceWorker registered with scope:", sw.config.prefix);

        form.addEventListener("submit", (e) => {
          e.preventDefault();

          const resolved = resolveInput(address.value);
          if (!resolved) {
            alert("Input is empty. Please enter a URL or search query.");
            address.focus();
            return;
          }

          try {
            const encoded = "/p/" + Base64.encode(resolved);
            console.debug("[Yoroxy] Navigating to:", encoded);
            window.location.href = encoded;
          } catch (err) {
            console.error("[Yoroxy] Encoding failed:", err);
            alert("Internal encoding failed. Check console for details.");
          }
        });
      })
      .catch((err) => {
        console.error("[Yoroxy] ServiceWorker failed to register:", err);
      });
  } else if (!("serviceWorker" in navigator)) {
    console.warn("[Yoroxy] ServiceWorker is not supported in this browser.");
  }
})();
