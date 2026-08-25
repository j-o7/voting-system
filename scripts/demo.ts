import WebSocket from "ws";

// ─────────────────────────────────────────────────────────────────────────────
// DEMO SCRIPT — a tiny end-to-end client that proves the system works.
//
// It runs against an already-running server (start it with `npm run dev` first).
// Steps: create an election over REST, open a WebSocket to watch it, cast a few
// votes over REST, and print every live update the server pushes — including the
// automatic winner when the timer runs out.
//
// This is NOT part of the server; it's just a convenient way to see everything
// working together from one command (`npm run demo`).
// ─────────────────────────────────────────────────────────────────────────────

// Where the server lives. Overridable via the BASE env var if you changed ports.
const BASE = process.env.BASE ?? "http://localhost:3000";
// The WebSocket URL is the same host but with the ws:// scheme instead of http://.
const WS_BASE = BASE.replace(/^http/, "ws");

async function main() {
  // 1) Create a short (5-second) election so the demo finishes quickly.
  //    `fetch` is built into modern Node; we POST JSON and read the JSON reply.
  const created = await fetch(`${BASE}/elections`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      items: [
        { id: "cats", label: "Cats" },
        { id: "dogs", label: "Dogs" },
      ],
      durationMs: 5000,
      tiePolicy: "earliest-leader",
    }),
  }).then((r) => r.json());

  const id = created.id as string; // the id we'll vote on and watch
  console.log("Created election:", id);

  // 2) Open a WebSocket for that election and log every message it pushes.
  //    We attach the message handler BEFORE awaiting "open", so we're guaranteed
  //    to catch the very first "snapshot" message the server sends on connect.
  const ws = new WebSocket(`${WS_BASE}/ws?electionId=${id}`);
  ws.on("message", (data) => console.log("WS >", data.toString()));
  await new Promise<void>((res) => ws.once("open", () => res())); // wait until connected

  // 3) Cast some votes over REST. Each one should show up on the socket above.
  //    Small helper so the calls below read cleanly.
  const vote = (userId: string, itemId: string) =>
    fetch(`${BASE}/elections/${id}/votes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, itemId }),
    });

  await vote("alice", "cats");
  await vote("bob", "dogs");
  await vote("carol", "cats");
  await vote("bob", "cats"); // bob switches from dogs to cats (watch total stay flat)

  // 4) Do nothing and wait — the server's timer will auto-close the election.
  //    When the "closed" message arrives, print the final result and exit.
  console.log("Waiting for auto-close...");
  ws.on("message", (data) => {
    const evt = JSON.parse(data.toString());
    if (evt.type === "closed") {
      console.log("Final result:", evt.snapshot.result);
      ws.close();
      process.exit(0);
    }
  });
}

// Run it, and if anything goes wrong print the error and exit non-zero.
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
