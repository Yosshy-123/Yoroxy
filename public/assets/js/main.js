"use strict";

const form = document.getElementById("uv-form");
const address = document.getElementById("uv-address");

function applyAutofocus() {
    if (!address) return;
    try { address.focus({ preventScroll: true }); } catch { address.focus(); }
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

(function () {
    const style = document.createElement("style");
    style.textContent = `
#uv-loading{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(255,255,255,.6);z-index:99999}
#uv-loading svg{width:56px;height:56px;animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
`;
    document.head.appendChild(style);
    const d = document.createElement("div");
    d.id = "uv-loading";
    d.innerHTML = `<svg viewBox="0 0 50 50"><circle cx="25" cy="25" r="20" fill="none" stroke="#333" stroke-width="4" stroke-dasharray="90 30"/></svg>`;
    document.body.appendChild(d);
})();
const showLoading = () => document.getElementById("uv-loading").style.display = "flex";
const hideLoading = () => document.getElementById("uv-loading").style.display = "none";

function getUvConfig() {
    try { return window.__uv$config; } catch {}
    try { return self.__uv$config; } catch {}
}

const sw = { file: "/uv/sw.js", config: getUvConfig() };

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
        fetch(url, { signal: c.signal, cache: "no-store" })
            .then(r => { clearTimeout(t); res(r); })
            .catch(e => { clearTimeout(t); rej(e); });
    });
}

async function getSearxUrls(q) {
    try {
        const r = await fetch("https://searx.space/data/instances.json", { cache: "no-store" });
        const j = await r.json();
        const arr = j.online_https || j.online || [];
        return arr
            .slice(0, 2)
            .map(i => i.url.replace(/\/$/, "") + "/search?q=" + q);
    } catch {
        return [];
    }
}

async function searchFallback(query) {
    const q = encodeURIComponent(query);
    for (const t of SEARCH_TEMPLATES) {
        if (t === "SEARX") {
            const searx = await getSearxUrls(q);
            for (const u of searx) {
                try {
                    const r = await fetchWithTimeout(u);
                    if (r.ok || r.type === "opaque") {
                        location.href = u;
                        return;
                    }
                } catch {}
            }
            continue;
        }
        const url = t.replace("%s", q);
        try {
            const r = await fetchWithTimeout(url);
            if (r.ok || r.type === "opaque") {
                location.href = url;
                return;
            }
        } catch {}
    }
    location.href = "https://lite.duckduckgo.com/lite/?q=" + q;
}

async function handleFallback(e) {
    e.preventDefault();
    const raw = address.value.trim();
    if (!raw) return;

    const resolved = resolveInput(raw);
    if (resolved) {
        location.href = resolved;
        return;
    }

    showLoading();
    await searchFallback(raw);
}

async function handleProxy(e) {
    e.preventDefault();
    const raw = address.value.trim();
    if (!raw) return;

    const resolved = resolveInput(raw);
    showLoading();

    if (resolved) {
        location.href = sw.config.prefix + crypts.encode(resolved);
        return;
    }

    const first = SEARCH_TEMPLATES[0].replace("%s", encodeURIComponent(raw));
    location.href = sw.config.prefix + crypts.encode(first);
}

if (form && address) {
    if (!sw.config || !sw.config.prefix) {
        form.addEventListener("submit", handleFallback);
    } else {
        navigator.serviceWorker.register(sw.file, { scope: sw.config.prefix })
            .then(() => form.addEventListener("submit", handleProxy))
            .catch(() => form.addEventListener("submit", handleFallback));
    }
}
