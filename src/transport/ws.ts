import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import { URL } from "node:url";
import { electionBus } from "../events.js";
import { electionService } from "../services/electionService.js";
import { ElectionError } from "../domain/election.js";

// ─────────────────────────────────────────────────────────────────────────────
// THE WEBSOCKET TRANSPORT — the live, read-only feed.
//
// A browser connects to:   ws://host/ws?electionId=<id>
// and then just listens. The server pushes:
//   • one "snapshot" immediately on connect (so the client isn't blank),
//   • an "updated" message on every vote,
//   • a final "closed" message when the election ends.
//
// Clients never SEND votes over this socket — voting goes through REST. Keeping
// the socket one-way (server -> client only) makes it simple and safe.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attach a WebSocket server onto the existing HTTP server, so REST and WebSocket
 * share the same port. Called once from server.ts during startup.
 */
export function attachWebSocket(server: Server): void {
  // Only accept WebSocket connections on the "/ws" path.
  const wss = new WebSocketServer({ server, path: "/ws" });

  // Runs once for every browser that connects. `socket` is that one client's
  // connection; `req` is the initial HTTP upgrade request (we read the query
  // string from it).
  wss.on("connection", (socket: WebSocket, req) => {
    // Pull the electionId out of the URL, e.g. "/ws?electionId=abc" -> "abc".
    // The base "http://localhost" is a throwaway — URL just needs something to
    // parse the relative path against.
    const url = new URL(req.url ?? "", "http://localhost");
    const electionId = url.searchParams.get("electionId");

    // No id given -> we don't know what to show. Close with 1008 ("policy
    // violation") and a reason the client can read.
    if (!electionId) {
      socket.close(1008, "electionId query param required");
      return;
    }

    // Send the current state right away, so a client that joins mid-election can
    // render immediately instead of waiting for the next vote. If the id is
    // unknown, snapshot() throws NOT_FOUND and we close the socket cleanly.
    try {
      socket.send(
        JSON.stringify({ type: "snapshot", snapshot: electionService.snapshot(electionId) })
      );
    } catch (err) {
      if (err instanceof ElectionError) {
        socket.close(1008, err.message); // e.g. "Election '...' not found."
        return;
      }
      throw err; // unexpected error -> let it surface, don't hide it
    }

    // Subscribe to this election's channel on the shared bus. From now on, every
    // "updated"/"closed" event for this election is forwarded straight to this
    // client. `unsubscribe` is the function that stops that forwarding.
    const unsubscribe = electionBus.subscribe(electionId, (event) => {
      // Only write if the connection is still open, to avoid errors on a socket
      // that's mid-close.
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(event));
      }
    });

    // When this client disconnects, stop listening on their behalf. Without this
    // the bus would keep dead handlers around forever (a memory leak).
    socket.on("close", unsubscribe);
  });
}
