"use strict";

/* ===============================
   DOM references
=============================== */

const form = document.getElementById("uv-form");
const address = document.getElementById("uv-address");

/* 要素が存在しない場合は何もしない */
if (!form || !address) {
    console.warn("[Yoroxy] uv-form or uv-address not found");
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
    const searchTemplate = "http://duckduckgo.com/?q=%s";

    if (!input) return "";

    /* 1. 完全な URL */
    try {
        return new URL(input).toString();
    } catch {}

    /* 2. スキーム無し URL */
    try {
        const url = new URL("http://" + input);
        if (url.hostname.includes(".")) {
            return url.toString();
        }
    } catch {}

    /* 3. 検索 */
    return searchTemplate.replace("%s", encodeURIComponent(input));
}

/* ===============================
   Service Worker
=============================== */

if ("serviceWorker" in navigator && form && address) {
    const proxySetting = "uv";

    const swMap = {
        uv: {
            file: "/uv/sw.js",
            config: self.__uv$config
        }
    };

    const sw = swMap[proxySetting];
    if (!sw || !sw.config) {
        console.error("[Yoroxy] UV config not found");
    } else {
        navigator.serviceWorker
            .register(sw.file, { scope: sw.config.prefix })
            .then(() => {
                console.log("[Yoroxy] ServiceWorker registered");

                form.addEventListener("submit", (e) => {
                    e.preventDefault();

                    const resolved = resolveInput(address.value);
                    if (!resolved) return;

                    const encoded =
                        sw.config.prefix + crypts.encode(resolved);

                    window.location.href = encoded;
                });
            })
            .catch((err) => {
                console.error("[Yoroxy] ServiceWorker failed:", err);
            });
    }
}
