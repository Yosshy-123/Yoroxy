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

    const searchTemplate = "https://duckduckgo.com/?q=%s";

    const urlPattern = /^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$/i;
    if (urlPattern.test(input)) {
        return input;
    }

    const hostPattern =
        /^((\d{1,3}\.){3}\d{1,3}|([a-z0-9-]+\.)+[a-z]{2,})(:\d+)?(\/.*)?$/i;

    if (hostPattern.test(input)) {
        return "http://" + input;
    }

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