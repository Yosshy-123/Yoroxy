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
        const hostPortPattern =
            /^([a-zA-Z0-9.-]+|\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}(\/.*)?$/;

        if (hostPortPattern.test(input)) {
            return new URL("http://" + input).toString();
        }
    } catch {}

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

                    const encoded =
                        config.prefix + encodeURIComponent(resolved);

                    window.location.href = encoded;
                });
            })
            .catch((err) => {
                console.error("[Yoroxy] ServiceWorker failed:", err);
            });
    }
}
