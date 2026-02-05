"use strict";

const form = document.getElementById("uv-form");
const address = document.getElementById("uv-address");

function applyAutofocus() {
  if (!address) return;
  try {
    address.focus({
      preventScroll: true
    });
  } catch {
    address.focus();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", applyAutofocus);
} else {
  applyAutofocus();
}

class crypts {
  static encode(str) {
    return encodeURIComponent(
      String(str)
        .split("")
        .map((c, i) => i % 2 ? String.fromCharCode(c.charCodeAt(0) ^ 2) : c)
        .join("")
    );
  }
}

function resolveInput(v) {
  const s = v.trim();
  if (!s) return "";
  const url = /^(https?|ftp):\/\/[^\s]+$/i;
  const host = /^((\d{1,3}\.){3}\d{1,3}|([a-z0-9-]+\.)+[a-z]{2,})(:\d+)?(\/.*)?$/i;
  if (url.test(s)) return s;
  if (host.test(s)) return "https://" + s;
  return "";
}

(function() {
  const style = document.createElement("style");
  style.textContent = `
    #uv-loading {
      position: fixed;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, .6);
      z-index: 99999;
    }
    #uv-loading svg {
      width: 56px;
      height: 56px;
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
  `;
  document.head.appendChild(style);
  const d = document.createElement("div");
  d.id = "uv-loading";
  d.innerHTML = `<svg viewBox="0 0 50 50"><circle cx="25" cy="25" r="20" fill="none" stroke="#333" stroke-width="4" stroke-dasharray="90 30"/></svg>`;
  document.body.appendChild(d);
})();

const showLoading = () => document.getElementById("uv-loading").style.display = "flex";
const hideLoading = () => document.getElementById("uv-loading").style.display = "none";

function redirect(url) {
  showLoading();
  location.href = sw.config.prefix + crypts.encode(url);
}

function getUvConfig() {
  try {
    return window.__uv$config;
  } catch {}
  try {
    return self.__uv$config;
  } catch {}
}

const sw = {
  file: "/uv/sw.js",
  config: getUvConfig()
};

async function handleProxy(e) {
  e.preventDefault();
  const raw = address.value.trim();
  if (!raw) return;

  const resolved = resolveInput(raw);
  showLoading();

  if (resolved) {
    redirect(resolved);
    return;
  }

  const q = encodeURIComponent(raw);

  try {
    const controller = new AbortController();
    const TIMEOUT_MS = 2500;
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const r = await fetch("/api/search?q=" + q, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json" }
    });

    clearTimeout(timer);

    if (r.ok) {
      const data = await r.json();
      if (data && data.url) {
        redirect(data.url);
        return;
      }
    } else {
      console.warn("Search API responded non-ok:", r.status);
    }
  } catch (err) {
    console.warn("Search API request failed:", err);
  }

  redirect("https://duckduckgo.com/?q=" + q);
}

if (form && address && sw.config && sw.config.prefix) {
  navigator.serviceWorker
    .register(sw.file, {
      scope: sw.config.prefix
    })
    .then(() => {
      form.addEventListener("submit", handleProxy);
    });
}
