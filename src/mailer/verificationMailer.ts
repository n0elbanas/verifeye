/**
 * VerifEye — Real Email Verification Mailer (Layer 6)
 *
 * Sends a minimal, legitimate-looking probe email to "Risky" addresses.
 * Tracks delivery via a 1×1 tracking pixel served by Express.
 *
 * Gracefully disabled if SMTP credentials are not configured in .env.
 */

import nodemailer from "nodemailer";
import crypto from "crypto";
import { getDb } from "../../db.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
export const MAILER_ENABLED = !!(
  process.env.SMTP_HOST &&
  process.env.SMTP_USER &&
  process.env.SMTP_PASS
);

const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? "smtp.gmail.com",
      port: parseInt(process.env.SMTP_PORT ?? "587"),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      // Polite connection limits to avoid blacklisting
      pool: true,
      maxConnections: 2,
      maxMessages: 10,
      rateDelta: 1000, // 1 second between sends
      rateLimit: 2,    // max 2 messages per rateDelta
    });
  }
  return transporter;
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

export async function createDeepVerificationRequest(
  logId: number,
  email: string
): Promise<{ id: number; token: string }> {
  const db = await getDb();
  const token = crypto.randomBytes(24).toString("hex");

  const result = await db.run(
    `INSERT INTO verification_queue (log_id, email, status, tracking_token)
     VALUES (?, ?, 'pending', ?)`,
    [logId, email, token]
  );

  return { id: result.lastID as number, token };
}

export async function getDeepVerificationStatus(id: number) {
  const db = await getDb();
  return db.get(
    `SELECT id, email, status, send_attempt, last_attempt_at, resolved_at, bounce_code, created_at
     FROM verification_queue WHERE id = ?`,
    [id]
  );
}

export async function markPixelDelivered(token: string): Promise<boolean> {
  const db = await getDb();
  const row = await db.get(
    `SELECT id FROM verification_queue WHERE tracking_token = ? AND status = 'sent'`,
    [token]
  );
  if (!row) return false;

  await db.run(
    `UPDATE verification_queue SET status = 'delivered', resolved_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [row.id]
  );
  return true;
}

// ---------------------------------------------------------------------------
// Send probe email
// ---------------------------------------------------------------------------

/**
 * Queue and send a real verification email.
 * Returns the verification_queue id so the client can poll status.
 */
export async function sendDeepVerification(
  email: string,
  logId: number
): Promise<{ queueId: number; disabled?: boolean }> {
  if (!MAILER_ENABLED) {
    return { queueId: -1, disabled: true };
  }

  const { id, token } = await createDeepVerificationRequest(logId, email);
  const pixelUrl = `${APP_URL}/api/tracking/pixel/${token}`;
  const db = await getDb();

  // Send asynchronously — don't block the API response
  setImmediate(async () => {
    try {
      await db.run(
        `UPDATE verification_queue SET status = 'sending', send_attempt = send_attempt + 1, last_attempt_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [id]
      );

      const info = await getTransporter().sendMail({
        from: `"${process.env.SMTP_FROM_NAME ?? "VerifEye"}" <${process.env.SMTP_FROM_EMAIL ?? process.env.SMTP_USER}>`,
        to: email,
        subject: "Email Address Verification",
        text: [
          "Hello,",
          "",
          "This is an automated message to verify that your email address is active.",
          "No action is required on your part.",
          "",
          "If you received this message in error, please disregard it.",
          "",
          "— VerifEye Verification System",
        ].join("\n"),
        html: [
          `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;color:#333;">`,
          `<h2 style="font-size:18px;font-weight:600;margin-bottom:16px;">Email Verification</h2>`,
          `<p style="font-size:14px;line-height:1.6;color:#555;">`,
          `This is an automated message to verify that your email address is active.`,
          `No action is required on your part.</p>`,
          `<p style="font-size:12px;color:#aaa;margin-top:24px;border-top:1px solid #eee;padding-top:16px;">`,
          `If you received this in error, please disregard it.</p>`,
          // 1×1 tracking pixel — invisible, loaded on email open
          `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;opacity:0;" />`,
          `</div>`,
        ].join(""),
        headers: {
          // Helps deliverability — signals this is not bulk spam
          "X-Mailer": "VerifEye/2.0",
          Precedence: "bulk",
          "List-Unsubscribe": `<mailto:${process.env.SMTP_FROM_EMAIL ?? process.env.SMTP_USER}?subject=unsubscribe>`,
        },
      });

      const accepted = (info.accepted ?? []).length > 0;
      const rejected = (info.rejected ?? []).length > 0;

      await db.run(
        `UPDATE verification_queue SET status = ?, last_attempt_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [accepted && !rejected ? "sent" : "failed", id]
      );

      console.log(`[DeepVerify] Sent to ${email} — messageId: ${info.messageId}`);
    } catch (err: any) {
      console.error(`[DeepVerify] Failed to send to ${email}:`, err.message);

      // Classify bounce type from SMTP error codes
      let bounceCode = "unknown";
      const msg = (err.message ?? "").toLowerCase();
      if (msg.includes("550") || msg.includes("5.1.1") || msg.includes("no such user")) {
        bounceCode = "hard_bounce";
      } else if (msg.includes("452") || msg.includes("4.2.2") || msg.includes("quota")) {
        bounceCode = "soft_bounce_quota";
      } else if (msg.includes("421") || msg.includes("greylisting")) {
        bounceCode = "soft_bounce_greylisted";
      } else if (msg.includes("timeout") || msg.includes("etimedout")) {
        bounceCode = "timeout";
      }

      await db.run(
        `UPDATE verification_queue SET status = 'bounced', bounce_code = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [bounceCode, id]
      );
    }
  });

  return { queueId: id };
}
