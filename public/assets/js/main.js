"use strict";

const form = document.getElementById("uv-form");
const address = document.getElementById("uv-address");

function applyAutofocus() {
    if (!address) return;
    try { address.focus({ preventScroll: true }); } catch { address.focus(); }
}
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyAutofocus);
} else { applyAutofocus(); }

class crypts {
    static encode(str) {
        return encodeURIComponent(
            String(str).split("").map((c, i) => (i % 2 ? String.fromCharCode(c.charCodeAt(0) ^ 2) : c)).join("")
        );
    }
    static decode(str) {
        if (str.endsWith("/")) str = str.slice(0, -1);
        return decodeURIComponent(str.split("").map((c, i) => (i % 2 ? String.fromCharCode(c.charCodeAt(0) ^ 2) : c)).join(""));
    }
}

function resolveInput(value) {
    const input = value.trim();
    if (!input) return "";
    const urlPattern = /^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$/i;
    if (urlPattern.test(input)) return input;
    const hostPattern = /^((\d{1,3}\.){3}\d{1,3}|([a-z0-9-]+\.)+[a-z]{2,})(:\d+)?(\/.*)?$/i;
    if (hostPattern.test(input)) return "https://" + input;
    return "";
}

if (form && address) {
    function getUvConfig() {
        try { if (typeof window !== "undefined" && window.__uv$config) return window.__uv$config; } catch {}
        try { if (typeof self !== "undefined" && self.__uv$config) return self.__uv$config; } catch {}
        return undefined;
    }
    const swMap = { uv: { file: "/uv/sw.js", config: getUvConfig() } };
    const sw = swMap.uv;

    function handleSubmitProxy(e) {
        e.preventDefault();
        const resolved = resolveInput(address.value);
        if (!resolved) return;
        try {
            window.location.href = sw.config.prefix + crypts.encode(resolved);
        } catch (err) {
            console.warn("[Yoroxy] proxy failed, fallback", err);
            handleSubmitFallback(e);
        }
    }

    const PROBE_TIMEOUT = 2000;
    const SEARX_JSON = "https://searx.space/data/instances.json";
    const SEARX_FETCH_LIMIT = 2;

    function fetchWithTimeout(url, timeout = PROBE_TIMEOUT) {
        return new Promise((resolve, reject) => {
            const ctrl = new AbortController();
            const id = setTimeout(() => ctrl.abort(), timeout);
            fetch(url, { method: "GET", mode: "cors", cache: "no-store", signal: ctrl.signal })
                .then((r) => { clearTimeout(id); resolve(r); })
                .catch((e) => { clearTimeout(id); reject(e); });
        });
    }

    async function fetchSearxInstances(limit = SEARX_FETCH_LIMIT) {
        try {
            const res = await fetch(SEARX_JSON, { method: "GET", cache: "no-store" });
            if (!res.ok) throw new Error(res.status);
            const data = await res.json();
            const online = Array.isArray(data.online_https) ? data.online_https : (Array.isArray(data.online) ? data.online : []);
            const urls = online.map(i => (i && i.url ? i.url.replace(/\/$/, "") + "/search?q=%s" : null)).filter(Boolean);
            const uniq = []; for (const u of urls) if (!uniq.includes(u)) uniq.push(u);
            return uniq.slice(0, limit);
        } catch (err) {
            return [];
        }
    }

    async function buildFallbackEngineTemplates() {
        const templates = [
            "https://duckduckgo.com/?q=%s",
            "https://www.startpage.com/sp/search?query=%s"
        ];
        try {
            const searx = await fetchSearxInstances(SEARX_FETCH_LIMIT);
            if (searx && searx.length) templates.push(...searx);
        } catch {}
        templates.push("https://duckduckgo.com/html/?q=%s");
        templates.push("https://lite.duckduckgo.com/lite/?q=%s");
        return templates;
    }

    function buildEngineUrlsFromTemplates(query, templates) {
        const q = encodeURIComponent(query);
        return templates.map(t => t.replace("%s", q));
    }

    async function probeAndNavigateMinimal(query) {
        const templates = await buildFallbackEngineTemplates();
        const urls = buildEngineUrlsFromTemplates(query, templates);
        for (const url of urls) {
            try {
                const res = await fetchWithTimeout(url, PROBE_TIMEOUT);
                if (res && (res.ok || res.type === "opaque")) {
                    window.location.href = url;
                    return;
                }
            } catch (e) {}
        }
        window.location.href = "https://lite.duckduckgo.com/lite/?q=" + encodeURIComponent(query);
    }

    async function handleSubmitFallback(e) {
        e.preventDefault();
        const raw = address.value.trim();
        if (!raw) return;
        const urlPattern = /^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$/i;
        const hostPattern = /^((\d{1,3}\.){3}\d{1,3}|([a-z0-9-]+\.)+[a-z]{2,})(:\d+)?(\/.*)?$/i;
        if (urlPattern.test(raw) || hostPattern.test(raw)) {
            const resolved = urlPattern.test(raw) ? raw : "https://" + raw;
            window.location.href = resolved;
            return;
        }
        await probeAndNavigateMinimal(raw);
    }

    if (!sw || !sw.config || !sw.config.prefix) {
        console.warn("[Yoroxy] UV config not found — fallback handler");
        form.addEventListener("submit", handleSubmitFallback);
    } else {
        navigator.serviceWorker.register(sw.file, { scope: sw.config.prefix })
            .then(() => {
                console.log("[Yoroxy] SW registered — proxy handler");
                form.addEventListener("submit", handleSubmitProxy);
            })
            .catch((err) => {
                console.error("[Yoroxy] SW register failed — fallback", err);
                form.addEventListener("submit", handleSubmitFallback);
            });
    }
} else {
    console.warn("[Yoroxy] form/address not found");
}
