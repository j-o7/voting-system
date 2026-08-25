import { randomUUID } from "node:crypto";
import {
  Election,
  ElectionError,
  type ElectionSnapshot,
  type Item,
  type TiePolicy,
} from "../domain/election.js";
import { electionBus } from "../events.js";
import { config } from "../config.js";

// ─────────────────────────────────────────────────────────────────────────────
// THE SERVICE LAYER — the "manager" that runs elections over time.
//
// The domain layer (Election) only knows the rules. It does NOT store elections,
// start timers, or tell anyone when things change. This service fills that gap:
//   1. Storage      — keeps every election in memory so we can look it up by id.
//   2. Timer        — auto-closes an election when its time runs out.
//   3. Broadcasting — after any change, publishes an event on the shared bus.
//
// The transport layers (REST, WebSocket) call this service; they never touch the
// Election objects directly.
// ─────────────────────────────────────────────────────────────────────────────
class ElectionService {
  // All elections that currently exist, looked up by their id.
  // In memory only — restarting the server clears them (fine for this exercise).
  private elections = new Map<string, Election>();

  // The countdown timer for each election, so we can cancel it if the election
  // is closed early. Keyed by the same election id.
  private timers = new Map<string, NodeJS.Timeout>();

  /**
   * Create a new election, store it, and start its countdown.
   * Returns a snapshot of the fresh (empty) election.
   */
  create(params: {
    items: [Item, Item];
    durationMs?: number; // optional; falls back to the configured default
    tiePolicy?: TiePolicy; // optional; falls back to the configured default
  }): ElectionSnapshot {
    const id = randomUUID(); // unique, unguessable id for this election
    const durationMs = params.durationMs ?? config.defaultDurationMs;
    const endsAt = Date.now() + durationMs; // absolute moment voting will end

    const election = new Election({
      id,
      items: params.items,
      endsAt,
      tiePolicy: params.tiePolicy ?? config.defaultTiePolicy,
    });
    this.elections.set(id, election); // remember it so we can find it later

    // Start the automatic close. setTimeout fires once, after `durationMs`, and
    // calls this.close(id). This timer is the ONLY thing that auto-declares the
    // winner. We keep it in the service (not the domain) so the domain stays a
    // pure, timer-free set of rules.
    const timer = setTimeout(() => this.close(id), durationMs);
    this.timers.set(id, timer);

    return election.snapshot();
  }

  /**
   * Apply a vote to one election and, if it actually changed anything, tell all
   * connected clients by publishing an "updated" event.
   */
  vote(id: string, userId: string, itemId: string): ElectionSnapshot {
    const election = this.get(id); // throws NOT_FOUND if the id is unknown
    const changed = election.vote(userId, itemId); // may throw VOTING_CLOSED etc.
    const snapshot = election.snapshot();
    // Only broadcast on a real change, so re-voting the same way doesn't spam
    // every connected browser with a pointless message.
    if (changed) {
      electionBus.publish(id, { type: "updated", snapshot });
    }
    return snapshot;
  }

  /**
   * Close an election (called both by the timer and by the manual close route).
   * Computes the result, cancels the timer, and broadcasts a "closed" event.
   * Safe to call more than once — the guard makes repeat calls do nothing.
   */
  close(id: string): ElectionSnapshot {
    const election = this.get(id);
    if (!election.isClosed()) {
      election.close(); // work out the winner / tie
      this.clearTimer(id); // stop the countdown (may already have fired)
      electionBus.publish(id, { type: "closed", snapshot: election.snapshot() });
    }
    return election.snapshot();
  }

  // Look up the current state of one election.
  snapshot(id: string): ElectionSnapshot {
    return this.get(id).snapshot();
  }

  // Internal helper: fetch an election or throw a clean NOT_FOUND error. Every
  // public method funnels through this, so "unknown id" is handled in one place.
  private get(id: string): Election {
    const election = this.elections.get(id);
    if (!election) {
      throw new ElectionError("NOT_FOUND", `Election '${id}' not found.`);
    }
    return election;
  }

  // Internal helper: stop and forget an election's countdown timer.
  private clearTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }
}

// One shared service for the whole app (single instance, imported everywhere).
export const electionService = new ElectionService();
