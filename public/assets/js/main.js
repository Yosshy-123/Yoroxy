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

const PROBE_TIMEOUT = 2000;

const SEARCH_TEMPLATES = [
  "https://duckduckgo.com/?q=%s",
  "SEARX",
  "https://duckduckgo.com/html/?q=%s",
  "https://lite.duckduckgo.com/lite/?q=%s"
];

function fetchWithTimeout(url) {
  return new Promise((res, rej) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), PROBE_TIMEOUT);
    fetch(url, {
      signal: c.signal,
      cache: "no-store"
    })
      .then(r => {
        clearTimeout(t);
        res(r);
      })
      .catch(e => {
        clearTimeout(t);
        rej(e);
      });
  });
}

const SEARX_INSTANCES_API = "https://searx.space/data/instances.json";
const SEARX_MAX_INSTANCES = 2;

async function getSearxUrls(query) {
  try {
    const res = await fetch(SEARX_INSTANCES_API, {
      cache: "no-store"
    });
    if (!res.ok) return [];

    const data = await res.json();
    const bases = extractSearxInstances(data);

    return bases.map(base => buildSearxSearchUrl(base, query));
  } catch {
    return [];
  }
}

function extractSearxInstances(data) {
  const list =
    Array.isArray(data.online_https) ? data.online.https :
    Array.isArray(data.online) ? data.online :
    [];

  return list
    .map(i => normalizeSearxBase(i.url))
    .slice(0, SEARX_MAX_INSTANCES);
}

function normalizeSearxBase(url) {
  return url.replace(/\/+$/, "");
}

function buildSearxSearchUrl(base, query) {
  return `${base}/search?q=${query}`;
}

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

  for (const tpl of SEARCH_TEMPLATES) {
    if (tpl === "SEARX") {
      try {
        const searxUrls = await getSearxUrls(q);
        if (searxUrls.length) {
          redirect(searxUrls[0]);
          return;
        }
      } catch {}
      continue;
    }

    if (tpl.includes("%s")) {
      redirect(tpl.replace("%s", q));
      return;
    }
  }
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