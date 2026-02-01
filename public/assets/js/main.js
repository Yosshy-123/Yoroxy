document.addEventListener("DOMContentLoaded", () => {
    const root = document.documentElement;

    /* ===============================
       Theme color pickers
    =============================== */

    function bindColorPicker(id, cssVar, storageKey) {
        const picker = document.getElementById(id);
        if (!picker) return;

        picker.addEventListener("input", () => {
            root.style.setProperty(cssVar, picker.value);
            localStorage.setItem(storageKey, picker.value);
        });

        const saved = localStorage.getItem(storageKey);
        if (saved) {
            root.style.setProperty(cssVar, saved);
            picker.value = saved;
        }
    }

    bindColorPicker("colorPicker", "--theme-color", "themeColor");
    bindColorPicker("colorPicker2", "--shadow-color", "shadowColor");
    bindColorPicker("colorPicker3", "--shadow-color2", "shadowColor2");

    /* ===============================
       Dark / Light background toggle
    =============================== */

    const bgToggle = document.getElementById("backgroundToggle");

    function applyBackground(isDark) {
        document.body.style.backgroundColor = isDark ? "#000" : "#fff";
        document.body.style.color = isDark ? "#fff" : "#4c4c4c";
    }

    if (bgToggle) {
        const savedToggle = localStorage.getItem("backgroundToggle") === "true";
        bgToggle.checked = savedToggle;
        applyBackground(savedToggle);

        bgToggle.addEventListener("change", () => {
            localStorage.setItem("backgroundToggle", bgToggle.checked);
            applyBackground(bgToggle.checked);
        });
    }

    /* ===============================
       Background image upload
    =============================== */

    const bgDiv = document.getElementById("background");
    const fileInput = document.getElementById("file-input");

    if (bgDiv) {
        const savedImage = localStorage.getItem("backgroundImage");
        if (savedImage) {
            bgDiv.style.backgroundImage = savedImage;
        }
    }

    if (fileInput && bgDiv) {
        fileInput.addEventListener("change", (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (ev) => {
                const img = `url(${ev.target.result})`;
                bgDiv.style.backgroundImage = img;
                localStorage.setItem("backgroundImage", img);
            };
            reader.readAsDataURL(file);
        });
    }

    /* ===============================
       Clock (only if #time exists)
    =============================== */

    const timeEl = document.getElementById("time");
    if (timeEl) {
        const tick = () => {
            timeEl.textContent = new Date().toLocaleTimeString();
        };
        tick();
        setInterval(tick, 1000);
    }
});

/* ===============================
   Fullscreen
=============================== */

function openFullscreen() {
    const el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen();
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    else if (el.msRequestFullscreen) el.msRequestFullscreen();
}

function closeFullscreen() {
    if (document.exitFullscreen) document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    else if (document.msExitFullscreen) document.msExitFullscreen();
}

/* ===============================
   Cloak window
=============================== */

function openGame() {
    const win = window.open();
    if (!win) return;

    const iframe = win.document.createElement("iframe");
    iframe.src = window.location.href;
    iframe.style.cssText = `
        position: fixed;
        inset: 0;
        width: 100%;
        height: 100%;
        border: none;
    `;

    win.document.title = "Yoroxy";
    win.document.body.style.margin = "0";
    win.document.body.appendChild(iframe);
}
