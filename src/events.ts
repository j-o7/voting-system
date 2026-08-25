import { EventEmitter } from "node:events";
import type { ElectionSnapshot } from "./domain/election.js";

// ─────────────────────────────────────────────────────────────────────────────
// THE EVENT BUS — how "something changed" travels to whoever is watching.
//
// This is the one deliberate seam in the app. When an election changes, the
// service layer *publishes* a message here. The WebSocket layer *subscribes* and
// forwards those messages to connected browsers. Neither side talks to the other
// directly — they only meet at this bus.
//
// Why it matters: to run the app on several servers at once, this in-memory bus
// is the single piece you'd swap for something shared like Redis pub/sub. The
// rest of the code wouldn't have to change.
// ─────────────────────────────────────────────────────────────────────────────

// The two kinds of message that travel over the bus. Both carry a full snapshot
// so a subscriber always has the complete latest state, not just a diff.
//   "updated" -> a vote changed the counts.
//   "closed"  -> the election ended; snapshot.result is now filled in.
export type ElectionEvent =
  | { type: "updated"; snapshot: ElectionSnapshot }
  | { type: "closed"; snapshot: ElectionSnapshot };

/**
 * A thin, typed wrapper around Node's built-in EventEmitter.
 *
 * We use the electionId as the "channel" name. That way a browser watching
 * election A is only woken up for A's events, never B's.
 */
class ElectionBus {
  // The underlying emitter that does the actual notifying.
  private emitter = new EventEmitter();

  // Announce an event on one election's channel. Every handler currently
  // subscribed to that electionId gets called with the event.
  publish(electionId: string, event: ElectionEvent): void {
    this.emitter.emit(electionId, event);
  }

  // Start listening to one election's channel. `handler` runs for each event.
  // Returns an "unsubscribe" function — call it to stop listening (we call it
  // when a WebSocket disconnects, so we don't leak dead listeners).
  subscribe(electionId: string, handler: (e: ElectionEvent) => void): () => void {
    this.emitter.on(electionId, handler);
    return () => this.emitter.off(electionId, handler);
  }
}

// A single shared bus for the whole app (one instance, imported everywhere).
export const electionBus = new ElectionBus();
