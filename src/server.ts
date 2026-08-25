import http from "node:http";
import express from "express";
import { restRouter } from "./transport/rest.js";
import { attachWebSocket } from "./transport/ws.js";
import { config } from "./config.js";

// ─────────────────────────────────────────────────────────────────────────────
// THE COMPOSITION ROOT — the one file that wires all the pieces together.
//
// Everything else in the app depends "inward" (transport -> service -> domain)
// and never reaches back out. This file sits at the very top and is the only
// place that knows about all the parts at once.
// ─────────────────────────────────────────────────────────────────────────────

const app = express();

// Parse incoming JSON request bodies into req.body automatically.
app.use(express.json());

// Mount all our REST routes (defined in transport/rest.ts).
app.use(restRouter);

// Create a raw HTTP server from the Express app. We need this explicit server
// object so the WebSocket layer can hook onto the same one — that lets REST and
// WebSocket share a single port instead of running two servers.
const server = http.createServer(app);
attachWebSocket(server);

// Start listening. The callback runs once the server is ready for connections.
server.listen(config.port, () => {
  console.log(`Voting API on http://localhost:${config.port}`);
  console.log(`WebSocket on   ws://localhost:${config.port}/ws?electionId=<id>`);
});
