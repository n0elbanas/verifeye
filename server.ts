import express, { Request, Response } from "express";
import { createServer as createViteServer } from "vite";
import dns from "dns";
import { promisify } from "util";
import validator from "validator";
import net from "net";

const resolveMx = promisify(dns.resolveMx);
const resolveA = promisify(dns.resolve4);

const app = express();
const PORT = 3000;
const MAX_BULK = 1000;
const BATCH_SIZE = 20;

app.use(express.json({ limit: "2mb" }));

// ---------------------------------------------------------------------------
// Rate limiting (100 req / min per IP, shared across all /api routes)
// ---------------------------------------------------------------------------
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function rateLimit(req: Request, res: Response, next: () => void) {
  const ip = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const window = 60_000; // 1 minute
  const limit = 100;

  let entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + window };
    rateLimitMap.set(ip, entry);
  }

  entry.count++;
  if (entry.count > limit) {
    res.status(429).json({ error: "Too many requests. Please wait a minute." });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// Disposable email provider domains
// ---------------------------------------------------------------------------
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "guerrillamail.org",
  "guerrillamail.biz", "guerrillamail.de", "guerrillamail.info",
  "tempmail.com", "temp-mail.org", "temp-mail.io", "throwam.com",
  "throwaway.email", "sharklasers.com", "guerrillamailblock.com",
  "grr.la", "yopmail.com", "yopmail.fr", "cool.fr.nf",
  "jetable.fr.nf", "nospam.ze.tc", "nomail.xl.cx", "mega.zik.dj",
  "speed.1s.fr", "courriel.fr.nf", "moncourrier.fr.nf", "monemail.fr.nf",
  "monmail.fr.nf", "trashmail.com", "trashmail.me", "trashmail.net",
  "trashmail.at", "trashmail.io", "trashmail.xyz", "dispostable.com",
  "spamgourmet.com", "spamgourmet.net", "spamgourmet.org",
  "fakeinbox.com", "mailnull.com", "spamcorptastic.com",
  "spamevader.com", "spamhereplease.com", "spamthisplease.com",
  "maildrop.cc", "discard.email", "mailin8r.com",
  "mailismagic.com", "objectmail.com", "obobbo.com",
  "discardmail.com", "discardmail.de", "spamgob.com",
  "tempr.email", "trbvm.com", "filzmail.com",
  "0815.ru", "0815.ry", "spamtrap.ro",
  "sharklasers.com", "guerrillamailblock.com", "spam4.me",
  "boun.cr", "cfl.fr", "deadlymemes.com",
]);

// ---------------------------------------------------------------------------
// Role-based address prefixes
// ---------------------------------------------------------------------------
const ROLE_PREFIXES = new Set([
  "admin", "administrator", "info", "information",
  "support", "help", "helpdesk", "contact",
  "noreply", "no-reply", "donotreply", "do-not-reply",
  "postmaster", "webmaster", "hostmaster", "abuse",
  "sales", "marketing", "billing", "accounts",
  "hr", "jobs", "careers", "office",
  "privacy", "legal", "security", "team",
  "hello", "enquiries", "enquiry",
]);

// ---------------------------------------------------------------------------
// Free mail provider domain names (used as first-pass check)
// ---------------------------------------------------------------------------
const FREE_PROVIDER_DOMAINS = new Set([
  "gmail.com", "googlemail.com",
  "yahoo.com", "yahoo.co.uk", "yahoo.fr", "yahoo.de", "yahoo.es", "yahoo.in",
  "yahoo.com.au", "yahoo.com.br", "yahoo.com.ar",
  "hotmail.com", "hotmail.co.uk", "hotmail.fr", "hotmail.de", "hotmail.es",
  "outlook.com", "live.com", "msn.com", "live.co.uk", "live.fr",
  "aol.com", "icloud.com", "me.com", "mac.com",
  "protonmail.com", "proton.me",
  "zoho.com", "mail.com", "gmx.com", "gmx.de", "gmx.net",
]);

// ---------------------------------------------------------------------------
// MX-based provider fingerprinting (Verifalia-style — catches any custom
// domain hosted on Microsoft/Google/Yahoo infrastructure)
// ---------------------------------------------------------------------------
function detectProviderFromMx(mxExchanges: string[]): string | null {
  for (const mx of mxExchanges) {
    const m = mx.toLowerCase();
    // Microsoft (Outlook/Hotmail/Live + Office 365 custom domains)
    if (m.includes(".outlook.com") || m.includes(".protection.outlook.com") ||
        m.includes(".hotmail.com") || m.includes(".live.com")) {
      return "microsoft";
    }
    // Google (Gmail + Google Workspace custom domains)
    if (m.includes(".google.com") || m.includes(".googlemail.com") ||
        m === "gmail-smtp-in.l.google.com" || m.includes(".smtp.goog")) {
      return "google";
    }
    // Yahoo
    if (m.includes(".yahoodns.net") || m.includes(".yahoo.com")) {
      return "yahoo";
    }
    // iCloud / Apple
    if (m.includes(".icloud.com") || m.includes(".apple.com")) {
      return "icloud";
    }
    // ProtonMail
    if (m.includes(".protonmail.ch") || m.includes(".proton.me")) {
      return "protonmail";
    }
    // Zoho
    if (m.includes(".zoho.com") || m.includes(".zoho.eu")) {
      return "zoho";
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Educational TLD detection
// ---------------------------------------------------------------------------
function isEducationalDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  if (d.endsWith(".edu")) return true;
  if (/\.edu\.[a-z]{2}$/.test(d)) return true;
  if (/\.ac\.[a-z]{2,}$/.test(d)) return true;
  return false;
}

// Known free provider MX fingerprints that always block SMTP verification
const SMTP_BLOCKING_PROVIDERS = new Set(["google", "microsoft", "yahoo", "icloud", "protonmail"]);

// ---------------------------------------------------------------------------
// Classify domain type (domain name + MX fingerprint)
// ---------------------------------------------------------------------------
function classifyProvider(domain: string, mxExchanges: string[] = []): string {
  const d = domain.toLowerCase();
  if (DISPOSABLE_DOMAINS.has(d)) return "disposable";
  if (FREE_PROVIDER_DOMAINS.has(d)) return "free";
  // Check MX fingerprint for custom domains hosted on free provider infra
  const mxProvider = detectProviderFromMx(mxExchanges);
  if (mxProvider) return "free"; // hosted on free/major provider infra
  if (isEducationalDomain(d)) return "educational";
  return "business";
}

// ---------------------------------------------------------------------------
// Verifalia-style SMTP response code interpretation
// ---------------------------------------------------------------------------
type SmtpVerdict =
  | "accepted"          // 250 — mailbox confirmed
  | "invalid_mailbox"   // 5.1.1 / 5.1.2 — user does not exist
  | "policy_block"      // 5.7.x — server blocked the probe (does NOT mean invalid)
  | "rejected_other"    // other 5xx
  | "greylisted"        // 4xx — temporary deferral, retry later
  | "catch_all"         // accepted + catch-all probe also accepted
  | "blocked"           // network-level: port blocked / connection refused
  | "timeout"           // socket timeout
  | "error";            // unexpected error

interface SmtpResult {
  verdict: SmtpVerdict;
  message: string;
  catchAll: boolean;
}

/**
 * Parse an SMTP response line into a SmtpVerdict.
 * Enhanced detail codes (5.1.1, 5.7.1 etc.) are preferred over bare 5xx.
 */
function parseSMTPCode(code: number, line: string): SmtpVerdict | null {
  if (code === 250) return "accepted";
  if (code >= 400 && code < 500) return "greylisted";

  if (code >= 500) {
    // Look for enhanced status code (e.g. "550 5.1.1 ...")
    const enhanced = line.match(/5\.([0-9])\.([0-9]+)/);
    if (enhanced) {
      const cat = enhanced[1]; // category: 1=address, 7=policy, etc.
      const detail = enhanced[2];
      if (cat === "1") return "invalid_mailbox"; // 5.1.x = address problem
      if (cat === "7") return "policy_block";    // 5.7.x = policy/auth/spam
    }
    // Bare 5xx without enhanced code
    if (code === 550 || code === 551 || code === 553) return "invalid_mailbox";
    if (code === 554 || code === 556) return "invalid_mailbox";
    if (code === 552 || code === 555) return "rejected_other";
    return "rejected_other";
  }
  return null;
}

/**
 * Single-port SMTP probe. Returns a SmtpResult.
 */
function smtpProbe(
  mxHost: string,
  email: string,
  port: number,
  timeoutMs = 5000,
): Promise<SmtpResult> {
  return new Promise((resolve) => {
    let resolved = false;
    let buffer = "";
    let step = 0;
    let rcptAccepted = false;
    let socket: net.Socket;

    const done = (result: SmtpResult) => {
      if (!resolved) {
        resolved = true;
        if (socket && !socket.destroyed) socket.destroy();
        resolve(result);
      }
    };

    socket = net.createConnection({ host: mxHost, port });
    socket.setTimeout(timeoutMs);

    socket.on("connect", () =>
      console.log(`[VerifEye] SMTP connected ${mxHost}:${port}`));

    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      // Process all complete response lines
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // keep partial last line

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        console.log(`[VerifEye] SMTP <<< ${line}`);
        const code = parseInt(line.substring(0, 3));
        if (isNaN(code)) continue;

        // Multi-line responses: only act on the final line (no dash after code)
        const isLastLine = line[3] !== "-";
        if (!isLastLine) continue;

        // --- SMTP conversation state machine ---
        if (step === 0) {
          if (code === 220) {
            socket.write(`EHLO verifeye.io\r\n`);
            step = 1;
          } else {
            done({ verdict: "error", message: `Unexpected greeting (${code})`, catchAll: false });
          }
        } else if (step === 1) {
          if (code === 250) {
            socket.write(`MAIL FROM:<probe@verifeye.io>\r\n`);
            step = 2;
          } else {
            done({ verdict: "policy_block", message: `EHLO rejected (${code})`, catchAll: false });
          }
        } else if (step === 2) {
          if (code === 250) {
            socket.write(`RCPT TO:<${email}>\r\n`);
            step = 3;
          } else {
            const verdict = parseSMTPCode(code, line) ?? "rejected_other";
            done({ verdict, message: line, catchAll: false });
          }
        } else if (step === 3) {
          const verdict = parseSMTPCode(code, line);
          if (verdict === "accepted") {
            rcptAccepted = true;
            // Catch-all probe: try a definitely-fake address
            const randAddr = `nonexistent_probe_${Date.now()}@${email.split("@")[1]}`;
            socket.write(`RCPT TO:<${randAddr}>\r\n`);
            step = 4;
          } else {
            done({ verdict: verdict ?? "rejected_other", message: line, catchAll: false });
          }
        } else if (step === 4) {
          // Catch-all probe response
          const fakePassed = code === 250;
          done({
            verdict: fakePassed ? "catch_all" : "accepted",
            message: fakePassed ? "Server accepts all addresses (catch-all)" : "Mailbox confirmed",
            catchAll: fakePassed,
          });
        }
      }
    });

    socket.on("error", (err: any) => {
      const isBlocked = ["ECONNREFUSED", "EACCES", "ETIMEDOUT", "ENETUNREACH"].includes(err.code);
      console.error(`[VerifEye] SMTP ${mxHost}:${port} error: ${err.code}`);
      done({ verdict: isBlocked ? "blocked" : "error", message: err.message, catchAll: false });
    });

    socket.on("timeout", () => {
      console.warn(`[VerifEye] SMTP ${mxHost}:${port} timeout`);
      done({ verdict: "timeout", message: `Timeout on port ${port}`, catchAll: false });
    });
  });
}

/**
 * Multi-port SMTP check: try port 25 first, fall back to 587 if blocked/timeout.
 * This mirrors the strategy used by professional verifiers like Verifalia.
 */
async function smtpCheck(mxHost: string, email: string): Promise<SmtpResult> {
  // Try port 25 first (standard MTA port)
  const port25 = await smtpProbe(mxHost, email, 25, 5000);
  console.log(`[VerifEye] Port 25 verdict: ${port25.verdict}`);

  if (port25.verdict !== "blocked" && port25.verdict !== "timeout") {
    return port25; // Conclusive result — use it
  }

  // Port 25 blocked → try port 587 (submission port)
  console.log(`[VerifEye] Port 25 unavailable, trying port 587...`);
  const port587 = await smtpProbe(mxHost, email, 587, 5000);
  console.log(`[VerifEye] Port 587 verdict: ${port587.verdict}`);

  // If 587 also blocked/timeout, return blocked (use DNS-only result)
  if (port587.verdict === "blocked" || port587.verdict === "timeout") {
    return { verdict: "blocked", message: "Port 25 and 587 both unreachable", catchAll: false };
  }

  return port587;
}

// ---------------------------------------------------------------------------
// Core verification logic
// ---------------------------------------------------------------------------
export type EmailStatus = "Valid" | "Invalid" | "Risky" | "Unknown";

export interface EmailVerificationResult {
  email: string;
  status: EmailStatus;
  reason: string;
  domain: string;
  providerType: string;
  details: {
    syntax: boolean;
    dns: boolean;
    smtp: boolean;
    catchAll: boolean;
    mxRecords: Array<{ exchange: string; priority: number }>;
  };
}

async function verifySingleEmail(email: string): Promise<EmailVerificationResult> {
  console.log(`[VerifEye] Verifying: ${email}`);

  const base: EmailVerificationResult = {
    email,
    status: "Invalid",
    reason: "",
    domain: "",
    providerType: "unknown",
    details: { syntax: false, dns: false, smtp: false, catchAll: false, mxRecords: [] },
  };

  // 1. Syntax
  if (!email || !validator.isEmail(email)) {
    base.reason = "Invalid email syntax";
    return base;
  }
  base.details.syntax = true;

  const domain = email.split("@")[1].toLowerCase();
  const prefix = email.split("@")[0].toLowerCase();
  base.domain = domain;

  // 2. Disposable check (fast path before DNS)
  if (DISPOSABLE_DOMAINS.has(domain)) {
    base.status = "Risky";
    base.providerType = "disposable";
    base.reason = "Disposable / temporary email provider";
    // Still resolve MX for completeness
    try {
      const mx = await resolveMx(domain);
      base.details.mxRecords = mx;
      base.details.dns = mx.length > 0;
    } catch (_) {}
    return base;
  }

  // 3. Role-based prefix check
  const isRoleBased = ROLE_PREFIXES.has(prefix);

  // 4. DNS / MX
  let mxRecords: dns.MxRecord[] = [];
  try {
    mxRecords = await resolveMx(domain);
  } catch (dnsErr: any) {
    // A-record fallback
    try {
      const aRecs = await resolveA(domain);
      if (aRecs.length > 0) {
        mxRecords = [{ exchange: domain, priority: 10 }];
      }
    } catch (_) {}

    if (mxRecords.length === 0) {
      base.reason = "Domain has no mail servers (no MX or A records found)";
      return base;
    }
  }

  const mxExchanges = mxRecords.map((r) => r.exchange);
  base.details.mxRecords = mxRecords;
  base.details.dns = mxRecords.length > 0;
  base.providerType = classifyProvider(domain, mxExchanges);

  // Detect specific mail provider from MX fingerprint
  const mxProvider = detectProviderFromMx(mxExchanges);
  const isFreeProvider = base.providerType === "free";
  const isSmtpBlocking = isFreeProvider &&
    (mxProvider ? SMTP_BLOCKING_PROVIDERS.has(mxProvider) : true);

  // 5. SMTP check
  const primaryMx = mxRecords.sort((a, b) => a.priority - b.priority)[0].exchange;
  const smtp = await smtpCheck(primaryMx, email);
  base.details.smtp = smtp.verdict === "accepted" || smtp.verdict === "catch_all";
  base.details.catchAll = smtp.catchAll;

  // 6. Final classification (Verifalia-style verdict mapping)
  switch (smtp.verdict) {
    case "accepted":
      if (isRoleBased) {
        base.status = "Risky";
        base.reason = `Role-based address (${prefix}@) — may not reach a personal inbox`;
      } else {
        base.status = "Valid";
        base.reason = "Syntax OK, MX records found, SMTP accepted the recipient";
      }
      break;

    case "catch_all":
      base.status = "Risky";
      base.reason = "Catch-all domain — server accepts all addresses, mailbox existence unverifiable";
      break;

    case "invalid_mailbox":
      if (isSmtpBlocking) {
        // Major providers use 5.1.1 to block probes, not to report invalid users
        base.status = "Unknown";
        base.reason = `${mxProvider ?? domain} restricts SMTP verification — address syntax and DNS are valid`;
      } else {
        base.status = "Invalid";
        base.reason = `Mailbox does not exist: ${smtp.message}`;
      }
      break;

    case "policy_block":
      // 5.7.x — server rejected the probe for policy reasons, NOT because the address is invalid
      base.status = "Unknown";
      base.reason = `Server policy blocked the verification probe (5.7.x) — address may be valid`;
      break;

    case "greylisted":
      // 4xx — temporary deferral; classic greylisting behaviour
      base.status = "Unknown";
      base.reason = "Server temporarily deferred the check (greylisting) — likely valid, retry later";
      break;

    case "blocked":
    case "timeout":
      if (isSmtpBlocking) {
        // Known SMTP-blocking provider + network block → high confidence it's fine
        base.status = "Unknown";
        base.reason = `${mxProvider ?? domain} infrastructure blocks external SMTP probes — DNS is valid`;
      } else if (isRoleBased) {
        base.status = "Risky";
        base.reason = `Role-based address (${prefix}@). SMTP unreachable — DNS is valid`;
      } else {
        base.status = "Unknown";
        base.reason = "SMTP port 25 and 587 both unreachable — DNS valid but inbox unverifiable";
      }
      break;

    default:
      base.status = "Unknown";
      base.reason = `SMTP check inconclusive: ${smtp.message}`;
      break;
  }

  if (base.providerType === "educational") {
    base.reason = `[Educational institution] ${base.reason}`;
  }

  return base;
}

// ---------------------------------------------------------------------------
// Batch parallel helper
// ---------------------------------------------------------------------------
async function verifyBatch(emails: string[]): Promise<EmailVerificationResult[]> {
  const results: EmailVerificationResult[] = [];
  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    const batch = emails.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(batch.map((e) => verifySingleEmail(e)));
    for (let j = 0; j < settled.length; j++) {
      const s = settled[j];
      if (s.status === "fulfilled") {
        results.push(s.value);
      } else {
        results.push({
          email: batch[j],
          status: "Unknown",
          reason: "Verification process failed unexpectedly",
          domain: batch[j].split("@")[1] || "",
          providerType: "unknown",
          details: { syntax: false, dns: false, smtp: false, catchAll: false, mxRecords: [] },
        });
      }
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// API Routes
// ---------------------------------------------------------------------------
app.post("/api/verify", rateLimit, async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== "string") {
      return res.status(400).json({ error: "email field is required" });
    }
    const result = await verifySingleEmail(email.trim());
    return res.json(result);
  } catch (error: any) {
    console.error("[VerifEye] /api/verify error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/verify-bulk", rateLimit, async (req: Request, res: Response) => {
  try {
    const { emails } = req.body;
    if (!Array.isArray(emails)) {
      return res.status(400).json({ error: "emails must be an array" });
    }

    const trimmed = emails
      .map((e: unknown) => (typeof e === "string" ? e.trim() : ""))
      .filter(Boolean)
      .slice(0, MAX_BULK);

    const results = await verifyBatch(trimmed);
    return res.json({ results, total: results.length });
  } catch (error: any) {
    console.error("[VerifEye] /api/verify-bulk error:", error);
    return res.status(500).json({ error: "Internal server error during bulk processing" });
  }
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[VerifEye] Server running on http://localhost:${PORT}`);
  });
}

startServer();
