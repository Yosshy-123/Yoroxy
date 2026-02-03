"use strict";

/* ===============================
   DOM references
=============================== */

const form = document.getElementById("uv-form");
const address = document.getElementById("uv-address");

/* ===============================
   Autofocus
=============================== */

function applyAutofocus() {
    if (!address) return;
    try {
        address.focus({ preventScroll: true });
    } catch {
        address.focus();
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyAutofocus);
} else {
    applyAutofocus();
}

/* ===============================
   Simple obfuscation (Ultraviolet)
=============================== */

class crypts {
    static encode(str) {
        return encodeURIComponent(
            String(str)
                .split("")
                .map((c, i) =>
                    i % 2 ? String.fromCharCode(c.charCodeAt(0) ^ 2) : c
                )
                .join("")
        );
    }

    static decode(str) {
        if (str.endsWith("/")) str = str.slice(0, -1);
        return decodeURIComponent(
            str
                .split("")
                .map((c, i) =>
                    i % 2 ? String.fromCharCode(c.charCodeAt(0) ^ 2) : c
                )
                .join("")
        );
    }
}

/* ===============================
   URL / Search resolver
=============================== */

function resolveInput(value) {
    const input = value.trim();
    if (!input) return "";

    const urlPattern = /^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$/i;
    if (urlPattern.test(input)) {
        return input;
    }

    const hostPattern =
        /^((\d{1,3}\.){3}\d{1,3}|([a-z0-9-]+\.)+[a-z]{2,})(:\d+)?(\/.*)?$/i;

    if (hostPattern.test(input)) {
        return "https://" + input;
    }

    return "";
}

/* ===============================
   Service Worker + フォールバック
=============================== */

if (form && address) {
    const SEARX_INSTANCES_URL = "https://searx.space/data/instances.json";
    const SEARX_FETCH_LIMIT = 5;
    const PROBE_TIMEOUT = 2500;

    function getUvConfig() {
        try {
            if (typeof window !== "undefined" && window.__uv$config) return window.__uv$config;
        } catch {}
        try {
            if (typeof self !== "undefined" && self.__uv$config) return self.__uv$config;
        } catch {}
        return undefined;
    }

    const uvConfig = getUvConfig();

    const swMap = {
        uv: {
            file: "/uv/sw.js",
            config: uvConfig
        }
    };

    const sw = swMap["uv"];

    /* ----------
       ユーティリティ: fetch with timeout
    ---------- */
    function fetchWithTimeout(url, timeout = PROBE_TIMEOUT) {
        return new Promise((resolve, reject) => {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), timeout);

            fetch(url, { method: "GET", mode: "cors", cache: "no-store", signal: controller.signal })
                .then((res) => {
                    clearTimeout(id);
                    resolve(res);
                })
                .catch((err) => {
                    clearTimeout(id);
                    reject(err);
                });
        });
    }

    /* ----------
       SearXNG instances.json から動作中の HTTPS インスタンスを取得
    ---------- */
    async function fetchSearxInstances(limit = SEARX_FETCH_LIMIT) {
        try {
            const res = await fetch(SEARX_INSTANCES_URL, { method: "GET", cache: "no-store" });
            if (!res.ok) throw new Error("instances.json fetch failed: " + res.status);
            const data = await res.json();

            const onlineHttps = Array.isArray(data.online_https) ? data.online_https : (Array.isArray(data.online) ? data.online : []);

            const urls = onlineHttps
                .map((inst) => {
                    if (!inst || !inst.url) return null;
                    let base = inst.url;
                    if (base.endsWith("/")) base = base.slice(0, -1);
                    return base + "/search?q=%s";
                })
                .filter(Boolean);

            const unique = [];
            for (const u of urls) {
                if (!unique.includes(u)) unique.push(u);
            }

            return unique.slice(0, limit);
        } catch (err) {
            console.warn("[Yoroxy] failed to fetch SearXNG instances:", err);
            return [];
        }
    }

    /* ----------
       優先エンジン配列
    ---------- */
    async function buildSearchEngines() {
        const engines = [
            "https://duckduckgo.com/?q=%s",
            "https://www.startpage.com/sp/search?query=%s"
        ];

        try {
            const searxEngines = await fetchSearxInstances(SEARX_FETCH_LIMIT);
            if (searxEngines && searxEngines.length) {
                engines.push(...searxEngines);
            }
        } catch (e) {
            console.warn("[Yoroxy] buildSearchEngines: searx fetch failed:", e);
        }

        engines.push("https://duckduckgo.com/html/?q=%s");

        engines.push("https://lite.duckduckgo.com/lite/?q=%s");

        return engines;
    }

    /* ----------
       検索語から試すべき URL のリストを作る
    ---------- */
    function buildEngineUrlsFromEngines(query, engines) {
        const encodedQuery = encodeURIComponent(query);
        const directUrls = engines.map((tpl) => tpl.replace("%s", encodedQuery));

        if (sw && sw.config && sw.config.prefix) {
            try {
                const proxied = directUrls.map((u) => sw.config.prefix + crypts.encode(u));
                return proxied.concat(directUrls);
            } catch (e) {
                console.warn("[Yoroxy] crypts.encode failed while building proxy URLs:", e);
                return directUrls;
            }
        }

        return directUrls;
    }

    /* ----------
       順にプローブして最初に成功した URL に遷移する
    ---------- */
    async function probeAndNavigate(query) {
        const engines = await buildSearchEngines();
        const urls = buildEngineUrlsFromEngines(query, engines);

        for (let i = 0; i < urls.length; i++) {
            const url = urls[i];
            try {
                console.debug("[Yoroxy] probing:", url);
                const res = await fetchWithTimeout(url, PROBE_TIMEOUT);

                if (res && (res.ok || res.type === "opaque")) {
                    console.info("[Yoroxy] probe succeeded:", url);
                    window.location.href = url;
                    return;
                } else {
                    console.warn("[Yoroxy] probe not ok:", url, res && res.status);
                }
            } catch (err) {
                console.warn("[Yoroxy] probe failed:", url, err && err.name ? err.name : err);
            }
        }

        const fallback = "https://lite.duckduckgo.com/lite/?q=" + encodeURIComponent(query);
        console.warn("[Yoroxy] all probes failed — falling back to:", fallback);
        window.location.href = fallback;
    }

    /* ----------
       共通送信ハンドラ
    ---------- */
    const urlPattern = /^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$/i;
    const hostPattern = /^((\d{1,3}\.){3}\d{1,3}|([a-z0-9-]+\.)+[a-z]{2,})(:\d+)?(\/.*)?$/i;

    async function handleSubmitWithFallback(e) {
        e.preventDefault();
        const raw = address.value.trim();
        if (!raw) return;

        if (urlPattern.test(raw) || hostPattern.test(raw)) {
            const resolved = urlPattern.test(raw) ? raw : "http://" + raw;
            window.location.href = resolved;
            return;
        }

        await probeAndNavigate(raw);
    }

    /* ----------
       ServiceWorker
    ---------- */
    if (!sw || !sw.config) {
        console.warn("[Yoroxy] UV config not found — using fallback probe navigation");
        form.addEventListener("submit", handleSubmitWithFallback);
    } else {
        navigator.serviceWorker
            .register(sw.file, { scope: sw.config.prefix })
            .then(() => {
                console.log("[Yoroxy] ServiceWorker registered — using probe navigation with proxy priority");
                form.addEventListener("submit", handleSubmitWithFallback);
            })
            .catch((err) => {
                console.error("[Yoroxy] ServiceWorker failed:", err);
                form.addEventListener("submit", handleSubmitWithFallback);
            });
    }
} else {
    console.warn("[Yoroxy] Form or address element not found — no search handler attached");
}
