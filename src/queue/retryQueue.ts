/**
 * VerifEye — Greylisting Retry Queue
 *
 * Stores emails that returned a 4xx (greylisting) response and schedules
 * SMTP re-probes after a configurable delay. Results are written back to
 * the `retry_queue` table in SQLite.
 *
 * This is intentionally kept as an in-process queue (no Redis dependency)
 * so the app stays deployable on free-tier VPS / Render / Railway.
 * Swap the internals for Bull/BullMQ later if you need horizontal scaling.
 */

import { getDb } from "../../db.js";

export interface RetryJob {
  id: number;
  email: string;
  userId: number;
  attempts: number;
  nextRetryAt: Date;
  lastResult: string | null;
  resolved: boolean;
}

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5 * 60 * 1000; // 5 minutes

// In-memory timer handle (one poll loop for the whole process)
let pollHandle: ReturnType<typeof setInterval> | null = null;

// Forward declaration — the actual SMTP probe is injected from server.ts
// to avoid circular imports.
type SmtpProbeFn = (email: string) => Promise<{
  verdict: string;
  message: string;
  catchAll: boolean;
}>;

let registeredSmtpProbe: SmtpProbeFn | null = null;

export function registerSmtpProbe(fn: SmtpProbeFn) {
  registeredSmtpProbe = fn;
}

/**
 * Enqueue an email for a greylisting retry.
 */
export async function enqueueRetry(email: string, userId: number): Promise<void> {
  try {
    const db = await getDb();
    const nextRetry = new Date(Date.now() + RETRY_DELAY_MS).toISOString();
    await db.run(
      `INSERT INTO retry_queue (email, user_id, attempts, next_retry_at, resolved)
       VALUES (?, ?, 0, ?, 0)
       ON CONFLICT DO NOTHING`,
      [email, userId, nextRetry]
    );
    console.log(`[RetryQueue] Queued ${email} for retry at ${nextRetry}`);
  } catch (err) {
    console.error("[RetryQueue] Failed to enqueue:", err);
  }
}

/**
 * Process all unresolved retry jobs whose next_retry_at has passed.
 */
async function processDueJobs(): Promise<void> {
  if (!registeredSmtpProbe) return;

  try {
    const db = await getDb();
    const now = new Date().toISOString();

    const jobs = await db.all<RetryJob[]>(
      `SELECT * FROM retry_queue
       WHERE resolved = 0 AND next_retry_at <= ? AND attempts < ?
       ORDER BY next_retry_at ASC
       LIMIT 10`,
      [now, MAX_ATTEMPTS]
    );

    for (const job of jobs) {
      console.log(`[RetryQueue] Retrying ${job.email} (attempt ${job.attempts + 1}/${MAX_ATTEMPTS})`);

      try {
        const result = await registeredSmtpProbe(job.email);
        const isGreylisted = result.verdict === "greylisted";
        const isResolved = !isGreylisted || (job.attempts + 1) >= MAX_ATTEMPTS;

        const nextRetry = isResolved
          ? null
          : new Date(Date.now() + RETRY_DELAY_MS).toISOString();

        await db.run(
          `UPDATE retry_queue
           SET attempts = ?, last_result = ?, resolved = ?, next_retry_at = ?
           WHERE id = ?`,
          [
            job.attempts + 1,
            result.verdict,
            isResolved ? 1 : 0,
            nextRetry ?? new Date().toISOString(),
            job.id,
          ]
        );

        if (isResolved) {
          // Update the corresponding log entry with the new verdict
          await db.run(
            `UPDATE logs SET status = ?
             WHERE email = ? AND user_id = ?
             ORDER BY timestamp DESC LIMIT 1`,
            [
              result.verdict === "accepted" ? "Valid" : "Unknown",
              job.email,
              job.userId,
            ]
          );
          console.log(`[RetryQueue] Resolved ${job.email} → ${result.verdict}`);
        }
      } catch (err) {
        console.error(`[RetryQueue] Error retrying ${job.email}:`, err);
      }
    }
  } catch (err) {
    console.error("[RetryQueue] Poll error:", err);
  }
}

/**
 * Start the background poll loop. Call once at server startup.
 */
export function startRetryQueue(): void {
  if (pollHandle) return;
  console.log("[RetryQueue] Starting poll loop (every 60s)");
  pollHandle = setInterval(processDueJobs, 60_000);
}

/**
 * Stop the poll loop (used in tests / graceful shutdown).
 */
export function stopRetryQueue(): void {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
}

/**
 * Get pending retry jobs (for admin API).
 */
export async function getPendingJobs(): Promise<RetryJob[]> {
  const db = await getDb();
  return db.all<RetryJob[]>(
    `SELECT * FROM retry_queue WHERE resolved = 0 ORDER BY next_retry_at ASC LIMIT 100`
  );
}
