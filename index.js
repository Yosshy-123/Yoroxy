import express from "express";
import http from "node:http";
import path from "node:path";
import cors from "cors";
import { createBareServer } from "@tomphttp/bare-server-node";

const __dirname = process.cwd();
const PORT = process.env.PORT || 8080;

/* ===============================
   Servers
=============================== */

const bareServer = createBareServer("/bare/");
const app = express();
const server = http.createServer();

/* ===============================
   Middleware
=============================== */

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, "public")));
app.use("/uv", express.static(path.join(__dirname, "uv")));

/* ===============================
   Routes
=============================== */

app.get("/", (_req, res) => {
    res.sendFile(path.join(__dirname, "public/index.html"));
});

/* ===============================
   HTTP handling (bare-server routing)
=============================== */

server.on("request", (req, res) => {
    if (bareServer.shouldRoute(req)) {
        bareServer.routeRequest(req, res);
    } else {
        app(req, res);
    }
});

server.on("upgrade", (req, socket, head) => {
    if (bareServer.shouldRoute(req)) {
        bareServer.routeUpgrade(req, socket, head);
    } else {
        socket.end();
    }
});

/* ===============================
   Startup
=============================== */

server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});

/* ===============================
   Graceful shutdown
=============================== */

function shutdown() {
    console.log("Shutting down...");
    server.close((err) => {
        if (err) {
            console.error("Error closing HTTP server:", err);
            process.exit(1);
        }
        try {
            if (typeof bareServer.close === "function") {
                bareServer.close();
            }
        } catch (e) {
            console.warn("bareServer.close() threw:", e);
        }
        process.exit(0);
    });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
