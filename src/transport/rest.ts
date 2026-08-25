import { Router, type Request, type Response } from "express";
import { electionService } from "../services/electionService.js";
import { ElectionError, type Item } from "../domain/election.js";

// ─────────────────────────────────────────────────────────────────────────────
// THE REST TRANSPORT — turns HTTP requests into service calls.
//
// This layer is deliberately thin. Its whole job is:
//   1. Read what it needs out of the HTTP request (body, url params).
//   2. Do light validation of the incoming shape.
//   3. Call the service, which holds the real logic.
//   4. Send the result back as JSON.
// It contains NO voting rules of its own.
// ─────────────────────────────────────────────────────────────────────────────

// A Router is Express's way to group related routes; server.ts mounts it.
export const restRouter = Router();

// POST /elections — create a new election.
// Body: { items: [{id,label},{id,label}], durationMs?, tiePolicy? }
restRouter.post("/elections", (req: Request, res: Response) => {
  const { items, durationMs, tiePolicy } = req.body ?? {};
  // Shape check: we need exactly two competing items. Anything else is a 400.
  if (!Array.isArray(items) || items.length !== 2) {
    return res.status(400).json({ error: "Provide exactly two items." });
  }
  const snapshot = electionService.create({
    items: items as [Item, Item],
    durationMs,
    tiePolicy,
  });
  // 201 = "created". Return the fresh election so the caller learns its id.
  res.status(201).json(snapshot);
});

// GET /elections/:id — read the current state of one election.
// `next(err)` hands any thrown error to the error handler at the bottom.
restRouter.get("/elections/:id", (req, res, next) => {
  try {
    res.json(electionService.snapshot(req.params.id));
  } catch (err) {
    next(err);
  }
});

// POST /elections/:id/votes — cast or switch a vote.
// Body: { userId, itemId }
restRouter.post("/elections/:id/votes", (req, res, next) => {
  try {
    const { userId, itemId } = req.body ?? {};
    // Both fields are required to know who voted and for what.
    if (!userId || !itemId) {
      return res.status(400).json({ error: "userId and itemId are required." });
    }
    res.json(electionService.vote(req.params.id, userId, itemId));
  } catch (err) {
    next(err);
  }
});

// POST /elections/:id/close — end an election early. The countdown would do this
// on its own; this route is handy for demos and testing without waiting.
restRouter.post("/elections/:id/close", (req, res, next) => {
  try {
    res.json(electionService.close(req.params.id));
  } catch (err) {
    next(err);
  }
});

// Central error handler for this router. Express recognises it as an error
// handler because it takes four arguments (err first). Doing the mapping here,
// in ONE place, keeps HTTP status codes out of the service and domain layers.
restRouter.use((err: unknown, _req: Request, res: Response, next: (e?: unknown) => void) => {
  // Expected, user-caused problems arrive as ElectionError with a short code.
  // Translate each code into the matching HTTP status.
  if (err instanceof ElectionError) {
    const status =
      err.code === "NOT_FOUND" ? 404 : // unknown election id
      err.code === "VOTING_CLOSED" ? 409 : // tried to vote after it ended
      400; // anything else (e.g. unknown item) is a bad request
    return res.status(status).json({ error: err.message, code: err.code });
  }
  // Not one of ours -> let Express handle it as a real 500-level error.
  next(err);
});
