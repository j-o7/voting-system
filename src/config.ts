import type { TiePolicy } from "./domain/election.js";

// ─────────────────────────────────────────────────────────────────────────────
// App-wide settings, all in one place.
//
// This is the ONLY file that reads environment variables (process.env). Every
// other file imports `config` from here instead of reading the environment
// itself. That way there is a single, obvious spot to see or change defaults.
//
// Each value falls back to a sensible default using the `??` operator:
//   process.env.PORT ?? 3000   ->  "use PORT if it's set, otherwise 3000".
// ─────────────────────────────────────────────────────────────────────────────
export const config = {
  // TCP port the HTTP + WebSocket server listens on.
  port: Number(process.env.PORT ?? 3000),

  // How long an election stays open (in milliseconds) when the request that
  // created it didn't specify its own duration. 30_000 = 30 seconds.
  defaultDurationMs: Number(process.env.DURATION_MS ?? 30_000),

  // What to do when both items finish with the same number of votes.
  // See TiePolicy in domain/election.ts for the two possible values.
  defaultTiePolicy: (process.env.TIE_POLICY as TiePolicy) ?? "declare-tie",
};
