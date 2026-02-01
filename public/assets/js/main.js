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
   Base64 URL-safe obfuscation
=============================== */

class crypts {
    static encode(str) {
        const utf8 = new TextEncoder().encode(String(str));
        let binary = "";
        for (const b of utf8) binary += String.fromCharCode(b);
        return btoa(binary)
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");
    }

    static decode(str) {
        if (!str) return "";
        str = str.replace(/-/g, "+").replace(/_/g, "/");
        while (str.length % 4) str += "=";
        const binary = atob(str);
        const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
        return new TextDecoder().decode(bytes);
    }
}

/* ===============================
   URL / Search resolver
=============================== */

function resolveInput(value) {
    const input = String(value || "").trim();
    const searchTemplate = "https://duckduckgo.com/?q=%s";

    if (!input) return "";

    try {
        return new URL(input).toString();
    } catch {}

    try {
        const hostPortPattern = /^([a-zA-Z0-9.-]+|\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}(\/.*)?$/;
        if (hostPortPattern.test(input)) {
            return new URL("http://" + input).toString();
        }
    } catch {}

    /* 3. 検索 */
    return searchTemplate.replace("%s", encodeURIComponent(input));
}

/* ===============================
   Service Worker (Ultraviolet)
=============================== */

if ("serviceWorker" in navigator && form && address) {
    const config = globalThis.__uv$config;

    if (!config || !config.prefix) {
        console.error("[Yoroxy] UV config not found");
    } else {
        navigator.serviceWorker
            .register("/uv/sw.js", { scope: config.prefix })
            .then(() => {
                console.log("[Yoroxy] ServiceWorker registered");

                form.addEventListener("submit", (e) => {
                    e.preventDefault();

                    const resolved = resolveInput(address.value);
                    if (!resolved) return;

                    const encoded = config.prefix + crypts.encode(resolved);
                    window.location.href = encoded;
                });
            })
            .catch((err) => {
                console.error("[Yoroxy] ServiceWorker failed:", err);
            });
    }
}
