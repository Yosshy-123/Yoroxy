import express from 'express';
import http from 'node:http';
import { createBareServer } from "@tomphttp/bare-server-node";
import cors from 'cors';
import path from 'node:path';
import { hostname } from "node:os"

const server = http.createServer();
const app = express(server);
const __dirname = process.cwd();
const bareServer = createBareServer('/bare/');
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname + '/public'));
app.use("uv", express.static(__dirname + '/uv'));
app.use(cors());


app.get('/', (req, res) => {
    res.sendFile(path.join(process.cwd(), '/public/index.html'));
});

server.on('request', (req, res) => {
  if (bareServer.shouldRoute(req)) {
    bareServer.routeRequest(req, res)
  } else {
    app(req, res)
  }
})

server.on('upgrade', (req, socket, head) => {
  if (bareServer.shouldRoute(req)) {
    bareServer.routeUpgrade(req, socket, head)
  } else {
    socket.end()
  }
})

server.on('listening', () => {
  const address = server.address();
})

server.listen({ port: PORT, })

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
  server.close();
  bareServer.close();
  process.exit(0);
}