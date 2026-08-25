# Mini Voting System (backend only)

Two items compete. Users vote for one and can switch their vote. After a
configurable time limit the winner is declared **automatically**. State is
exposed over a **REST API** and pushed live over **WebSocket**.

---

## Quick start

```powershell
cd C:\Users\abcdj\OneDrive\Desktop\code\voting-system
npm install      # first time only
npm run dev      # starts REST + WS on http://localhost:3000 (auto-reloads)
```

You should see:

```
Voting API on http://localhost:3000
WebSocket on   ws://localhost:3000/ws?electionId=<id>
```

Leave this terminal running. Do all the testing below from a **second** terminal
or a browser.

---

## The 60-second smoke test

The fastest proof it all works — one command, no setup:

```powershell
npm run demo
```

This creates a 5-second election, opens a WebSocket, casts votes over REST
(including a vote **switch**), and prints every live update plus the
auto-declared winner. Expected output (ids will differ):

```
Created election: 5af0dc5f-...
WS > {"type":"snapshot", ... "counts":{"cats":0,"dogs":0}}
WS > {"type":"updated",  ... "counts":{"cats":1,"dogs":0}}   # alice -> cats
WS > {"type":"updated",  ... "counts":{"cats":1,"dogs":1}}   # bob -> dogs
WS > {"type":"updated",  ... "counts":{"cats":2,"dogs":1}}   # carol -> cats
WS > {"type":"updated",  ... "counts":{"cats":3,"dogs":0}}   # bob SWITCHES dogs->cats
Waiting for auto-close...
WS > {"type":"closed",   ... "result":{"outcome":"win","winnerId":"cats"}}
Final result: { outcome: 'win', winnerId: 'cats', counts: { cats: 3, dogs: 0 } }
```

> Watch the switch: bob's vote moves from `dogs` to `cats`, counts go
> `2/1 → 3/0`, but `totalVotes` stays **3**. The switch decrements the old
> bucket — no double-counting.

---

## Watch live updates in your browser

This shows the real-time push without any tooling. Follow the steps in order —
they're written so nothing can silently fail.

**1.** Make sure the server is running (`npm run dev` from the Quick start). The
browser can only connect to an election that exists in the **currently running**
server — elections live in memory, so if you restart the server, old ids stop
working and you must create a new one.

**2.** In PowerShell, create a fresh 2-minute election and copy its `id`. Build
the JSON from a hashtable so there's no quote-escaping, and let
`Invoke-RestMethod` parse the response into an object:

```powershell
$body = @{ items = @(@{id="cats";label="Cats"}, @{id="dogs";label="Dogs"}); durationMs = 120000 } | ConvertTo-Json -Depth 5
$id = (Invoke-RestMethod http://localhost:3000/elections -Method Post -ContentType application/json -Body $body).id
$id   # prints the id — copy it
```

**3.** Open any browser, press **F12** for the console, and paste the block
below **all at once** (swap in your id first). Keep it as a single block — the
`{ }` wrapper makes the browser run all the lines together, so the message
handler is attached before the server's first message arrives. If you paste the
lines one at a time instead, you can miss the opening `snapshot` (the handler
isn't ready yet) — everything else still works, but the first line is lost.

```js
{
  const ws = new WebSocket("ws://localhost:3000/ws?electionId=PASTE_ID_HERE");
  ws.onopen    = () => console.log("connected ✅");
  ws.onmessage = e => console.log("live:", JSON.parse(e.data));
  ws.onclose   = e => console.log("closed ❌ code", e.code, e.reason);
  ws.onerror   = () => console.log("error — is the server running and the id valid?");
  window.ws = ws;   // handle you can call ws.close() on later
}
```

What you should see immediately:

- `connected ✅`
- `live: {type: "snapshot", ...}` — the current state, sent the instant you connect

If instead you see `closed ❌ code 1008 Election '...' not found`, the id doesn't
exist in the running server — go back to step 2 and create a fresh one. Leave the
tab open.

**4.** Back in PowerShell, fire some votes and watch them appear in the browser
console instantly. A tiny helper keeps it short:

```powershell
function Vote($user, $item) {
  $b = @{ userId = $user; itemId = $item } | ConvertTo-Json
  Invoke-RestMethod "http://localhost:3000/elections/$id/votes" -Method Post -ContentType application/json -Body $b
}

Vote alice cats
Vote bob   dogs
Vote alice dogs   # alice switches — total stays flat
```

Each vote shows up as a `live: {type: "updated", ...}` line in the browser. When
the 2 minutes elapse (or you force-close, below), the browser logs a
`live: {type: "closed", ...}` message with the final result — pushed by the
server, no polling.

---

## Test each behavior by hand

Set up a reusable election id and a `Vote` helper first:

```powershell
$body = @{ items = @(@{id="cats";label="Cats"}, @{id="dogs";label="Dogs"}); durationMs = 600000 } | ConvertTo-Json -Depth 5
$id = (Invoke-RestMethod http://localhost:3000/elections -Method Post -ContentType application/json -Body $body).id

function Vote($user, $item) {
  $b = @{ userId = $user; itemId = $item } | ConvertTo-Json
  Invoke-RestMethod "http://localhost:3000/elections/$id/votes" -Method Post -ContentType application/json -Body $b
}
```

| What you're testing | Command | Expected |
| --- | --- | --- |
| **Cast a vote** | `Vote alice cats` | `counts.cats = 1`, `totalVotes = 1` |
| **Switch a vote** | `Vote alice dogs` | `cats = 0, dogs = 1`, `totalVotes` **still 1** |
| **Idempotent re-vote** | `Vote alice dogs` again | counts unchanged; no new WS message |
| **Read current state** | `Invoke-RestMethod "http://localhost:3000/elections/$id"` | snapshot object |
| **Force-close early** | `Invoke-RestMethod "http://localhost:3000/elections/$id/close" -Method Post` | `status:"closed"` + `result` |
| **Vote after close** | `Vote bob cats` | **HTTP 409** (voting closed) |
| **Unknown election** | `Invoke-RestMethod http://localhost:3000/elections/nope` | **HTTP 404** |

`Invoke-RestMethod` prints responses as objects. For the error cases (409/404)
it throws a terminating error whose status you can see with
`try { ... } catch { $_.Exception.Response.StatusCode.value__ }`.

---

## Test the two tie policies

Ties are configured per election via `tiePolicy`.

**`declare-tie` (default)** — an equal count returns a real tie:

```powershell
$body = @{ items = @(@{id="a";label="A"}, @{id="b";label="B"}); durationMs = 600000; tiePolicy = "declare-tie" } | ConvertTo-Json -Depth 5
$t = (Invoke-RestMethod http://localhost:3000/elections -Method Post -ContentType application/json -Body $body).id

Invoke-RestMethod "http://localhost:3000/elections/$t/votes" -Method Post -ContentType application/json -Body (@{userId="u1";itemId="a"}|ConvertTo-Json) | Out-Null
Invoke-RestMethod "http://localhost:3000/elections/$t/votes" -Method Post -ContentType application/json -Body (@{userId="u2";itemId="b"}|ConvertTo-Json) | Out-Null
(Invoke-RestMethod "http://localhost:3000/elections/$t/close" -Method Post).result
# -> outcome = tie, winnerId = (empty)
```

**`earliest-leader`** — same 1-1 count, but whoever led first wins the tie-break:

```powershell
$body = @{ items = @(@{id="a";label="A"}, @{id="b";label="B"}); durationMs = 600000; tiePolicy = "earliest-leader" } | ConvertTo-Json -Depth 5
$e = (Invoke-RestMethod http://localhost:3000/elections -Method Post -ContentType application/json -Body $body).id

Invoke-RestMethod "http://localhost:3000/elections/$e/votes" -Method Post -ContentType application/json -Body (@{userId="u1";itemId="a"}|ConvertTo-Json) | Out-Null   # a leads first
Invoke-RestMethod "http://localhost:3000/elections/$e/votes" -Method Post -ContentType application/json -Body (@{userId="u2";itemId="b"}|ConvertTo-Json) | Out-Null   # now tied
(Invoke-RestMethod "http://localhost:3000/elections/$e/close" -Method Post).result
# -> outcome = win, winnerId = a
```

---

## Test with Postman / a WebSocket tool

- **REST base:** `http://localhost:3000`
- **WebSocket URL:** `ws://localhost:3000/ws?electionId=<id>`

In Postman: create a **WebSocket** request to the URL above (with a real id),
click **Connect**, then in a separate REST tab POST to `/elections/:id/votes`.
Each vote appears as an incoming WS message; the timer expiry sends a `closed`
message.

---

## API reference

### REST

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| POST | `/elections` | `{ items:[{id,label},{id,label}], durationMs?, tiePolicy? }` | `durationMs` defaults to 30000; `tiePolicy` to `"declare-tie"` |
| GET | `/elections/:id` | — | current snapshot |
| POST | `/elections/:id/votes` | `{ userId, itemId }` | casts or switches a vote |
| POST | `/elections/:id/close` | — | force close now (the timer does this automatically) |

Error codes: `404` unknown election, `409` voting closed, `400` bad request /
unknown item.

### WebSocket

Connect to `ws://localhost:3000/ws?electionId=<id>`. Messages are JSON:

- `{ type: "snapshot", snapshot }` — sent immediately on connect
- `{ type: "updated",  snapshot }` — on every vote that changes state
- `{ type: "closed",   snapshot }` — when the election ends (includes `result`)

A `snapshot` looks like:

```json
{
  "id": "…",
  "status": "open",
  "items": [{ "id": "cats", "label": "Cats" }, { "id": "dogs", "label": "Dogs" }],
  "counts": { "cats": 3, "dogs": 1 },
  "totalVotes": 4,
  "endsAt": 1787674684524,
  "result": null
}
```

`endsAt` is epoch ms — a client can render its own countdown from it.

---

## Architecture (one glance)

Dependencies point inward: **transport → service → domain**. The domain depends
on nothing.

```
src/
  domain/election.ts        pure voting rules — no I/O, no timers
  events.ts                 typed event bus — the pub/sub seam
  services/electionService  lifecycle: storage, countdown timer, publishing
  transport/rest.ts         Express routes (mutations + reads)
  transport/ws.ts           WebSocket gateway (read-only subscribe)
  server.ts                 composition root — wires it all together
  config.ts                 defaults (duration, tie policy)
scripts/demo.ts             REST + WS demo client
```

- REST **writes and reads**; WebSocket **only subscribes** — votes never arrive
  over the socket.
- Every state change flows through the service, which publishes one event to the
  bus; the WS gateway forwards bus events to connected sockets.
- The event bus is the single component you'd swap for Redis pub/sub to run
  across multiple server instances.

---

## Configuration

Environment variables (all optional):

| Var | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP + WS port |
| `DURATION_MS` | `30000` | default election length when not passed in the request |
| `TIE_POLICY` | `declare-tie` | default tie policy (`declare-tie` \| `earliest-leader`) |

Example:

```powershell
$env:PORT=4000; $env:DURATION_MS=10000; npm run dev
```
