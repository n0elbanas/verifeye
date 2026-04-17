import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import { createServer as createViteServer } from "vite";
import dns from "dns";
import { promisify } from "util";
import validator from "validator";
import net from "net";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { getDb } from "./db.js";
import { startRetryQueue, enqueueRetry, getPendingJobs, registerSmtpProbe } from "./src/queue/retryQueue.js";
import {
  MAILER_ENABLED,
  sendDeepVerification,
  getDeepVerificationStatus,
  markPixelDelivered,
} from "./src/mailer/verificationMailer.js";

const JWT_SECRET = process.env.JWT_SECRET || "supersecret_verifeye123!";

const resolveMx = promisify(dns.resolveMx);
const resolveA = promisify(dns.resolve4);

const app = express();
const PORT = parseInt(process.env.PORT ?? "3000");
const MAX_BULK = 1000;
const BATCH_SIZE = 20;

app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

getDb().catch(console.error);

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------
interface AuthRequest extends Request {
  user?: any;
}

const requireAuth = (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
};

const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.role !== "ADMIN") return res.status(403).json({ error: "Forbidden" });
  next();
};

// ---------------------------------------------------------------------------
// Daily-limit helper
// ---------------------------------------------------------------------------
async function checkAndLogLimit(db: any, userId: number, count: number): Promise<boolean> {
  const user = await db.get("SELECT * FROM users WHERE id = ?", [userId]);
  if (!user) return false;

  const today = new Date().toISOString().split("T")[0];
  if (user.last_check_date !== today) {
    await db.run("UPDATE users SET emails_checked_today = 0, last_check_date = ? WHERE id = ?", [today, userId]);
    user.emails_checked_today = 0;
  }

  if (user.daily_limit !== -1 && (user.emails_checked_today + count) > user.daily_limit) {
    return false;
  }

  await db.run("UPDATE users SET emails_checked_today = emails_checked_today + ? WHERE id = ?", [count, userId]);
  return true;
}

// ---------------------------------------------------------------------------
// Rate limiting (100 req / min per IP)
// ---------------------------------------------------------------------------
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function rateLimit(req: Request, res: Response, next: () => void) {
  const ip = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const window = 60_000;
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
// Per-domain SMTP rate limiter (max 5 probes / domain / min)
// Prevents getting blacklisted from hammering specific mail servers.
// ---------------------------------------------------------------------------
const smtpDomainMap = new Map<string, { count: number; resetAt: number }>();

function canSmtpProbe(domain: string): boolean {
  const now = Date.now();
  const window = 60_000;
  const limit = 5;

  let entry = smtpDomainMap.get(domain);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + window };
    smtpDomainMap.set(domain, entry);
  }
  entry.count++;
  return entry.count <= limit;
}

// ---------------------------------------------------------------------------
// MX record cache (5-minute TTL)
// ---------------------------------------------------------------------------
interface MxCacheEntry {
  records: dns.MxRecord[];
  expiresAt: number;
}
const mxCache = new Map<string, MxCacheEntry>();

async function resolveMxCached(domain: string): Promise<dns.MxRecord[]> {
  const now = Date.now();
  const cached = mxCache.get(domain);
  if (cached && now < cached.expiresAt) return cached.records;

  const records = await resolveMx(domain);
  mxCache.set(domain, { records, expiresAt: now + 5 * 60 * 1000 });
  return records;
}

// ---------------------------------------------------------------------------
// Disposable email domains
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
  "0815.ru", "0815.ry", "spamtrap.ro", "spam4.me",
  "boun.cr", "cfl.fr", "deadlymemes.com", "10minutemail.com",
  "10minutemail.net", "mytemp.email", "fakemailgenerator.com",
  "mailnesia.com", "dispostable.com", "mailexpire.com",
  "spamfree24.org", "spam.la", "nowhere.org",
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
  "hello", "enquiries", "enquiry", "newsletter",
  "news", "notifications", "mailer", "bounce",
  "root", "daemon", "nobody", "www",
]);

// ---------------------------------------------------------------------------
// Free-provider domains list
// ---------------------------------------------------------------------------
const FREE_PROVIDER_DOMAINS = new Set([
  "gmail.com", "googlemail.com",
  "yahoo.com", "yahoo.co.uk", "yahoo.fr", "yahoo.de", "yahoo.es", "yahoo.in",
  "yahoo.com.au", "yahoo.com.br", "yahoo.com.ar", "yahoo.co.jp",
  "hotmail.com", "hotmail.co.uk", "hotmail.fr", "hotmail.de", "hotmail.es",
  "outlook.com", "live.com", "msn.com", "live.co.uk", "live.fr",
  "aol.com", "icloud.com", "me.com", "mac.com",
  "protonmail.com", "proton.me",
  "zoho.com", "mail.com", "gmx.com", "gmx.de", "gmx.net",
]);

// ---------------------------------------------------------------------------
// Typo domain detection — Levenshtein distance on curated list
// ---------------------------------------------------------------------------
const KNOWN_GOOD_DOMAINS = [
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "yahoo.fr",
  "hotmail.com", "outlook.com", "live.com", "msn.com", "aol.com",
  "icloud.com", "me.com", "protonmail.com", "proton.me",
  "zoho.com", "mail.com", "gmx.com", "gmx.net",
  "yandex.com", "yandex.ru", "fastmail.com", "fastmail.fm",
];

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function detectTypoDomain(domain: string): string | null {
  // Skip if it's already a known-good domain
  if (KNOWN_GOOD_DOMAINS.includes(domain)) return null;

  let bestMatch: string | null = null;
  let bestScore = Infinity;

  for (const known of KNOWN_GOOD_DOMAINS) {
    const dist = levenshtein(domain, known);
    // Only flag if 1–2 character difference (e.g., gmail.con → gmail.com)
    if (dist <= 2 && dist < bestScore) {
      bestScore = dist;
      bestMatch = known;
    }
  }

  return bestMatch;
}

// ---------------------------------------------------------------------------
// MX fingerprinting — detect provider from MX exchange hostnames
// ---------------------------------------------------------------------------
function detectProviderFromMx(mxExchanges: string[]): string | null {
  for (const mx of mxExchanges) {
    const m = mx.toLowerCase();
    if (m.includes(".outlook.com") || m.includes(".protection.outlook.com") ||
        m.includes(".hotmail.com") || m.includes(".live.com")) return "microsoft";
    if (m.includes(".google.com") || m.includes(".googlemail.com") ||
        m === "gmail-smtp-in.l.google.com" || m.includes(".smtp.goog")) return "google";
    if (m.includes(".yahoodns.net") || m.includes(".yahoo.com")) return "yahoo";
    if (m.includes(".icloud.com") || m.includes(".apple.com")) return "icloud";
    if (m.includes(".protonmail.ch") || m.includes(".proton.me")) return "protonmail";
    if (m.includes(".zoho.com") || m.includes(".zoho.eu")) return "zoho";
  }
  return null;
}

/**
 * Providers that block or lie during SMTP probing.
 * These are NEVER probed — heuristic scoring only.
 *
 * Why:
 *  - Yahoo:     Accepts ALL RCPT TO with 250 OK (anti-enumeration), then discards silently → false positives
 *  - Gmail:     Rejects ALL RCPT TO with 550 5.1.1 from unknown IPs → false negatives
 *  - Microsoft: Returns 550 5.7.x for most probes → policy block, not address invalid
 *  - iCloud:    Drops connections at firewall level
 *  - ProtonMail:Blocks all external SMTP probes (privacy policy)
 */
const SMTP_BLOCKING_PROVIDERS = new Set(["google", "yahoo", "microsoft", "icloud", "protonmail"]);

function isEducationalDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  return d.endsWith(".edu") || /\.edu\.[a-z]{2}$/.test(d) || /\.ac\.[a-z]{2,}$/.test(d);
}

function classifyProvider(domain: string, mxExchanges: string[] = []): string {
  const d = domain.toLowerCase();
  if (DISPOSABLE_DOMAINS.has(d)) return "disposable";
  if (FREE_PROVIDER_DOMAINS.has(d)) return "free";
  const mxProvider = detectProviderFromMx(mxExchanges);
  if (mxProvider) return "free";
  if (isEducationalDomain(d)) return "educational";
  return "business";
}

// ---------------------------------------------------------------------------
// Confidence Scoring Engine
// ---------------------------------------------------------------------------
interface ScoreFactors {
  syntaxValid: boolean;
  mxFound: boolean;
  smtpAccepted: boolean;
  catchAll: boolean;
  roleBased: boolean;
  disposable: boolean;
  freeProvider: boolean;
  educationalDomain: boolean;
  businessDomain: boolean;
  typoDomain: boolean;
  smtpBlocking: boolean;
  greylisted: boolean;
  policyBlock: boolean;
}

function calculateConfidenceScore(factors: ScoreFactors): number {
  let score = 0;

  // Positive signals (base 90 for a perfectly verified free email)
  if (factors.syntaxValid) score += 30;
  if (factors.mxFound) score += 30;
  if (factors.smtpAccepted) score += 30;
  if (factors.businessDomain) score += 10;
  if (factors.educationalDomain) score += 5;

  // Negative signals
  if (factors.disposable) score -= 25;
  if (factors.catchAll) score -= 15;
  if (factors.roleBased) score -= 10;
  if (factors.freeProvider) score -= 5;
  if (factors.typoDomain) score -= 20;
  if (factors.policyBlock) score -= 5; // slight penalty, but not decisive
  if (factors.greylisted) score -= 5;  // slight — usually means valid, retry pending

  // Hard caps for blocking providers:
  // Never exceed 72 for blocking providers (we cannot confirm the mailbox)
  if (factors.smtpBlocking && score > 72) score = 72;

  return Math.max(0, Math.min(100, score));
}

function scoreToStatus(score: number): EmailStatus {
  if (score >= 80) return "Valid";
  if (score >= 50) return "Risky";
  if (score >= 1)  return "Unknown";
  return "Invalid";
}

// ---------------------------------------------------------------------------
// SMTP verdict types
// ---------------------------------------------------------------------------
type SmtpVerdict =
  | "accepted"
  | "invalid_mailbox"
  | "policy_block"
  | "rejected_other"
  | "greylisted"
  | "catch_all"
  | "blocked"
  | "timeout"
  | "error"
  | "skipped"; // NEW — for blocking providers

interface SmtpResult {
  verdict: SmtpVerdict;
  message: string;
  catchAll: boolean;
}

function parseSMTPCode(code: number, line: string): SmtpVerdict | null {
  if (code === 250) return "accepted";
  if (code >= 400 && code < 500) return "greylisted";
  if (code >= 500) {
    const enhanced = line.match(/5\.([0-9])\.([0-9]+)/);
    if (enhanced) {
      const cat = enhanced[1];
      if (cat === "1") return "invalid_mailbox";
      if (cat === "7") return "policy_block";
    }
    if (code === 550 || code === 551 || code === 553) return "invalid_mailbox";
    if (code === 554 || code === 556) return "invalid_mailbox";
    return "rejected_other";
  }
  return null;
}

// Rotate EHLO hostnames to reduce fingerprinting
const EHLO_NAMES = ["verifeye.io", "mail.verifeye.io", "outbound.verifeye.io"];
function randomEhlo(): string {
  return EHLO_NAMES[Math.floor(Math.random() * EHLO_NAMES.length)];
}

// Jitter delay removed to drastically increase verification speed
function jitter(): Promise<void> {
  return Promise.resolve();
}

function smtpProbe(
  mxHost: string,
  email: string,
  port: number,
  timeoutMs = 2500,
): Promise<SmtpResult> {
  return new Promise((resolve) => {
    let resolved = false;
    let buffer = "";
    let step = 0;
    let socket: net.Socket;

    const done = (result: SmtpResult) => {
      if (!resolved) {
        resolved = true;
        if (socket && !socket.destroyed) {
          // Politely QUIT before closing (reduces blacklisting risk vs. hard destroy)
          try { socket.write("QUIT\r\n"); } catch (_) {}
          setTimeout(() => { if (!socket.destroyed) socket.destroy(); }, 500);
        }
        resolve(result);
      }
    };

    socket = net.createConnection({ host: mxHost, port });
    socket.setTimeout(timeoutMs);

    socket.on("connect", () =>
      console.log(`[VerifEye] SMTP connected ${mxHost}:${port}`));

    socket.on("data", async (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        console.log(`[VerifEye] SMTP <<< ${line}`);
        const code = parseInt(line.substring(0, 3));
        if (isNaN(code)) continue;

        const isLastLine = line[3] !== "-";
        if (!isLastLine) continue;

        if (step === 0) {
          if (code === 220) {
            await jitter();
            socket.write(`EHLO ${randomEhlo()}\r\n`);
            step = 1;
          } else {
            done({ verdict: "error", message: `Unexpected greeting (${code})`, catchAll: false });
          }
        } else if (step === 1) {
          if (code === 250) {
            await jitter();
            socket.write(`MAIL FROM:<>\r\n`);
            step = 2;
          } else {
            done({ verdict: "policy_block", message: `EHLO rejected (${code})`, catchAll: false });
          }
        } else if (step === 2) {
          if (code === 250) {
            await jitter();
            socket.write(`RCPT TO:<${email}>\r\n`);
            step = 3;
          } else {
            const verdict = parseSMTPCode(code, line) ?? "rejected_other";
            done({ verdict, message: line, catchAll: false });
          }
        } else if (step === 3) {
          const verdict = parseSMTPCode(code, line);
          if (verdict === "accepted") {
            await jitter();
            const randAddr = `nvp_${Date.now()}_${Math.random().toString(36).slice(2)}@${email.split("@")[1]}`;
            socket.write(`RCPT TO:<${randAddr}>\r\n`);
            step = 4;
          } else {
            done({ verdict: verdict ?? "rejected_other", message: line, catchAll: false });
          }
        } else if (step === 4) {
          const fakePassed = code === 250;
          done({
            verdict: fakePassed ? "catch_all" : "accepted",
            message: fakePassed ? "Catch-all domain" : "Mailbox confirmed",
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

async function smtpCheck(mxHost: string, email: string): Promise<SmtpResult> {
  // Check ports in parallel for maximum speed
  const [port25, port587] = await Promise.all([
    smtpProbe(mxHost, email, 25, 2500),
    smtpProbe(mxHost, email, 587, 2500)
  ]);

  console.log(`[VerifEye] Port 25 verdict: ${port25.verdict} | Port 587 verdict: ${port587.verdict}`);

  if (port25.verdict !== "blocked" && port25.verdict !== "timeout") {
    return port25;
  }
  if (port587.verdict !== "blocked" && port587.verdict !== "timeout") {
    return port587;
  }

  return { verdict: "blocked", message: "Ports 25 and 587 both unreachable", catchAll: false };
}

// ---------------------------------------------------------------------------
// Result types — enhanced with confidence scoring
// ---------------------------------------------------------------------------
export type EmailStatus = "Valid" | "Invalid" | "Risky" | "Unknown";

export interface EmailVerificationResult {
  email: string;
  status: EmailStatus;
  reason: string;
  domain: string;
  providerType: string;
  detectedProvider: string | null;
  confidenceScore: number;
  flags: string[];
  typoSuggestion: string | null;
  details: {
    syntax: boolean;
    dns: boolean;
    smtp: boolean;
    catchAll: boolean;
    mxRecords: Array<{ exchange: string; priority: number }>;
    smtpVerdict: string;
    smtpSkipped: boolean;
  };
}

// ---------------------------------------------------------------------------
// Core verification engine
// ---------------------------------------------------------------------------
async function verifySingleEmail(email: string): Promise<EmailVerificationResult> {
  console.log(`[VerifEye] Verifying: ${email}`);

  const base: EmailVerificationResult = {
    email,
    status: "Invalid",
    reason: "",
    domain: "",
    providerType: "unknown",
    detectedProvider: null,
    confidenceScore: 0,
    flags: [],
    typoSuggestion: null,
    details: {
      syntax: false,
      dns: false,
      smtp: false,
      catchAll: false,
      mxRecords: [],
      smtpVerdict: "not_run",
      smtpSkipped: false,
    },
  };

  // ─── Layer 1: Syntax ────────────────────────────────────────────────────
  if (!email || !validator.isEmail(email)) {
    base.reason = "Invalid email syntax";
    base.confidenceScore = 0;
    return base;
  }
  base.details.syntax = true;

  const domain = email.split("@")[1].toLowerCase();
  const prefix = email.split("@")[0].toLowerCase();
  base.domain = domain;

  // ─── Flag: Typo domain detection ────────────────────────────────────────
  const typoSuggestion = detectTypoDomain(domain);
  if (typoSuggestion) {
    base.typoSuggestion = typoSuggestion;
    base.flags.push("possible_typo");
    console.log(`[VerifEye] Typo detected: ${domain} → ${typoSuggestion}`);
  }

  // ─── Layer 2: Disposable check (fast path) ──────────────────────────────
  if (DISPOSABLE_DOMAINS.has(domain)) {
    base.status = "Risky";
    base.providerType = "disposable";
    base.flags.push("disposable");
    base.reason = "Disposable / temporary email provider — high bounce risk";
    try {
      const mx = await resolveMxCached(domain);
      base.details.mxRecords = mx;
      base.details.dns = mx.length > 0;
    } catch (_) {}
    base.confidenceScore = calculateConfidenceScore({
      syntaxValid: true, mxFound: base.details.dns,
      smtpAccepted: false, catchAll: false, roleBased: false,
      disposable: true, freeProvider: false, educationalDomain: false,
      businessDomain: false, typoDomain: !!typoSuggestion,
      smtpBlocking: false, greylisted: false, policyBlock: false,
    });
    return base;
  }

  // ─── Flag: Role-based prefix ────────────────────────────────────────────
  const isRoleBased = ROLE_PREFIXES.has(prefix);
  if (isRoleBased) base.flags.push("role_based");

  // ─── Layer 3: DNS / MX resolution ───────────────────────────────────────
  let mxRecords: dns.MxRecord[] = [];
  try {
    mxRecords = await resolveMxCached(domain);
  } catch {
    try {
      const aRecs = await resolveA(domain);
      if (aRecs.length > 0) mxRecords = [{ exchange: domain, priority: 10 }];
    } catch (_) {}
  }

  if (mxRecords.length === 0) {
    base.reason = typoSuggestion
      ? `Domain "${domain}" has no mail servers — did you mean "${typoSuggestion}"?`
      : "Domain has no mail servers (no MX or A records)";
    base.confidenceScore = 0;
    return base;
  }

  const mxExchanges = mxRecords.map((r) => r.exchange);
  base.details.mxRecords = mxRecords;
  base.details.dns = true;
  base.providerType = classifyProvider(domain, mxExchanges);

  const mxProvider = detectProviderFromMx(mxExchanges);
  base.detectedProvider = mxProvider;

  // Flag free providers
  const isFreeProvider = base.providerType === "free";
  if (isFreeProvider) base.flags.push("free_provider");

  const isEducational = isEducationalDomain(domain);
  const isBusinessDomain = base.providerType === "business";

  // ─── Layer 5: SMTP probe (all domains) ───────────
  const primaryMx = [...mxRecords].sort((a, b) => a.priority - b.priority)[0].exchange;
  let smtp: SmtpResult = { verdict: "error", message: "Rate-limited", catchAll: false };

  if (canSmtpProbe(domain)) {
    smtp = await smtpCheck(primaryMx, email);
  } else {
    console.warn(`[VerifEye] SMTP rate limit hit for ${domain} — skipping probe`);
    smtp = { verdict: "blocked", message: "Domain SMTP rate limit reached", catchAll: false };
  }

  base.details.smtp = smtp.verdict === "accepted" || smtp.verdict === "catch_all";
  base.details.catchAll = smtp.catchAll;
  base.details.smtpVerdict = smtp.verdict;

  if (smtp.verdict === "catch_all") base.flags.push("catch_all");

  // ─── Layer 6: Confidence scoring + status classification ────────────────
  const factors: ScoreFactors = {
    syntaxValid: true,
    mxFound: true,
    smtpAccepted: smtp.verdict === "accepted" || smtp.verdict === "catch_all",
    catchAll: smtp.catchAll,
    roleBased: isRoleBased,
    disposable: false,
    freeProvider: isFreeProvider,
    educationalDomain: isEducational,
    businessDomain: isBusinessDomain,
    typoDomain: !!typoSuggestion,
    smtpBlocking: false,
    greylisted: smtp.verdict === "greylisted",
    policyBlock: smtp.verdict === "policy_block",
  };

  const score = calculateConfidenceScore(factors);
  base.confidenceScore = score;

  switch (smtp.verdict) {
    case "accepted":
      base.status = isRoleBased ? "Risky" : scoreToStatus(score);
      base.reason = isRoleBased
        ? `Role-based address (${prefix}@) — mailbox accepted but may not reach a personal inbox. Confidence: ${score}/100.`
        : `Syntax OK, MX records found, SMTP accepted the recipient. Confidence: ${score}/100.`;
      break;

    case "catch_all":
      base.status = "Risky";
      base.reason = `Catch-all domain — server accepts all addresses, mailbox existence unverifiable. Confidence: ${score}/100.`;
      break;

    case "invalid_mailbox":
      base.status = "Invalid";
      base.confidenceScore = 0;
      base.reason = `Mailbox does not exist: ${smtp.message}`;
      break;

    case "policy_block":
      base.status = scoreToStatus(score);
      base.reason = `Server policy blocked the probe (5.7.x) — address may be valid. Confidence: ${score}/100.`;
      break;

    case "greylisted":
      base.status = "Unknown";
      base.reason = `Server temporarily deferred the check (greylisting) — likely valid, retry queued. Confidence: ${score}/100.`;
      break;

    case "blocked":
    case "timeout":
      base.status = scoreToStatus(score);
      base.reason = `SMTP unreachable (ports 25 and 587 blocked) — DNS is valid. Confidence: ${score}/100.`;
      break;

    default:
      base.status = "Unknown";
      base.reason = `SMTP check inconclusive: ${smtp.message}. Confidence: ${score}/100.`;
      break;
  }

  if (isEducational) {
    base.reason = `[Educational institution] ${base.reason}`;
  }
  if (typoSuggestion && smtp.verdict !== "invalid_mailbox") {
    base.reason += ` Possible typo — did you mean "${typoSuggestion}"?`;
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
          reason: "Verification failed unexpectedly",
          domain: batch[j].split("@")[1] || "",
          providerType: "unknown",
          detectedProvider: null,
          confidenceScore: 0,
          flags: [],
          typoSuggestion: null,
          details: {
            syntax: false, dns: false, smtp: false,
            catchAll: false, mxRecords: [],
            smtpVerdict: "error", smtpSkipped: false,
          },
        });
      }
    }
  }
  return results;
}

// Register the smtpCheck function with the retry queue (avoids circular import)
registerSmtpProbe(async (email: string) => {
  const domain = email.split("@")[1];
  const mx = await resolveMxCached(domain);
  const primaryMx = [...mx].sort((a, b) => a.priority - b.priority)[0].exchange;
  return smtpCheck(primaryMx, email);
});

// ---------------------------------------------------------------------------
// API Routes
// ---------------------------------------------------------------------------

// ── Auth ────────────────────────────────────────────────────────────────────
app.post("/api/auth/login", async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Missing email or password" });
  try {
    const db = await getDb();
    const user = await db.get("SELECT * FROM users WHERE email = ?", [email]);
    if (!user) return res.status(401).json({ error: "Invalid email or password" });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Invalid email or password" });
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role, limit: user.daily_limit }, JWT_SECRET, { expiresIn: "1d" });
    res.cookie("token", token, { httpOnly: true, sameSite: "strict" });
    const { password_hash, ...safeUser } = user;
    res.json({ user: safeUser });
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/auth/logout", (_req, res) => {
  res.clearCookie("token");
  res.json({ success: true });
});

app.get("/api/auth/me", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const db = await getDb();
    const user = await db.get("SELECT * FROM users WHERE id = ?", [req.user.id]);
    if (user) {
      const { password_hash, ...safeUser } = user;
      res.json({ user: safeUser });
    } else {
      res.status(404).json({ error: "User not found" });
    }
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

// ── Users ────────────────────────────────────────────────────────────────────
app.get("/api/users", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const db = await getDb();
    const users = await db.all("SELECT id, email, role, daily_limit, emails_checked_today, last_check_date FROM users");
    res.json(users);
  } catch { res.status(500).json({ error: "Server error" }); }
});

app.post("/api/users", requireAuth, requireAdmin, async (req, res) => {
  const { email, password, limit } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Missing required fields" });
  try {
    const db = await getDb();
    const hash = await bcrypt.hash(password, 10);
    const result = await db.run("INSERT INTO users (email, password_hash, role, daily_limit) VALUES (?, ?, 'USER', ?)", [email, hash, parseInt(limit) || -1]);
    res.json({ success: true, id: result.lastID });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.put("/api/users/:id/limit", requireAuth, requireAdmin, async (req, res) => {
  const { daily_limit } = req.body;
  try {
    const db = await getDb();
    await db.run("UPDATE users SET daily_limit = ? WHERE id = ?", [parseInt(daily_limit), req.params.id]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Server error" }); }
});

app.delete("/api/users/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const db = await getDb();
    await db.run("DELETE FROM logs WHERE user_id = ?", [req.params.id]);
    await db.run("DELETE FROM users WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Server error" }); }
});

app.put("/api/users/:id/password", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  const { newPassword } = req.body;
  if (!newPassword) return res.status(400).json({ error: "Missing password field" });
  try {
    const db = await getDb();
    const hash = await bcrypt.hash(newPassword, 10);
    await db.run("UPDATE users SET password_hash = ? WHERE id = ?", [hash, req.params.id]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Server error" }); }
});

app.put("/api/users/password", requireAuth, async (req: AuthRequest, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: "Missing fields" });
  try {
    const db = await getDb();
    const user = await db.get("SELECT * FROM users WHERE id = ?", [req.user.id]);
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) return res.status(400).json({ error: "Incorrect current password" });
    const hash = await bcrypt.hash(newPassword, 10);
    await db.run("UPDATE users SET password_hash = ? WHERE id = ?", [hash, req.user.id]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Server error" }); }
});

// ── Logs ─────────────────────────────────────────────────────────────────────
app.get("/api/logs", requireAuth, async (req: AuthRequest, res) => {
  try {
    const db = await getDb();
    let logs;
    if (req.user.role === "ADMIN") {
      logs = await db.all(`
        SELECT logs.id, logs.email, logs.status, logs.confidence_score, logs.flags, logs.timestamp,
               users.email as checked_by
        FROM logs
        JOIN users ON logs.user_id = users.id
        ORDER BY timestamp DESC LIMIT 500
      `);
    } else {
      logs = await db.all(`
        SELECT id, email, status, confidence_score, flags, timestamp
        FROM logs
        WHERE user_id = ?
        ORDER BY timestamp DESC LIMIT 500
      `, [req.user.id]);
    }
    res.json(logs);
  } catch { res.status(500).json({ error: "Server error" }); }
});

// ── Verification ──────────────────────────────────────────────────────────────

/**
 * Insert a verification log row. Falls back to the base 3-column insert if the
 * confidence_score / flags columns are missing (un-migrated production databases).
 * db.ts self-heals those columns on startup, so this fallback only fires on the
 * very first request before the process has restarted post-deploy.
 */
async function safeLogInsert(
  db: any,
  userId: number,
  email: string,
  status: string,
  confidenceScore: number,
  flags: string[]
): Promise<{ lastID: number | undefined }> {
  try {
    return await db.run(
      "INSERT INTO logs (user_id, email, status, confidence_score, flags) VALUES (?, ?, ?, ?, ?)",
      [userId, email, status, confidenceScore, JSON.stringify(flags)]
    );
  } catch (err: any) {
    // Column missing — production DB not yet migrated; degrade gracefully
    if (err?.message?.includes("no column") || err?.message?.includes("has no column")) {
      console.warn("[VerifEye] logs table missing new columns — falling back to base insert. Restart the server to apply the self-healing migration.");
      return db.run(
        "INSERT INTO logs (user_id, email, status) VALUES (?, ?, ?)",
        [userId, email, status]
      );
    }
    throw err;
  }
}

app.post("/api/verify", rateLimit, requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== "string") return res.status(400).json({ error: "email field is required" });

    const db = await getDb();
    const canCheck = await checkAndLogLimit(db, req.user.id, 1);
    if (!canCheck) return res.status(403).json({ error: "Daily verification limit reached." });

    const result = await verifySingleEmail(email.trim());

    const logResult = await safeLogInsert(
      db, req.user.id, result.email, result.status, result.confidenceScore, result.flags
    );

    if (result.details.smtpVerdict === "greylisted") {
      await enqueueRetry(result.email, req.user.id);
    }

    return res.json({ ...result, logId: logResult.lastID });
  } catch (error: any) {
    console.error("[VerifEye] /api/verify error:", error?.message ?? error);
    return res.status(500).json({ error: "Internal server error", detail: error?.message });
  }
});

app.post("/api/verify-bulk", rateLimit, requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { emails } = req.body;
    if (!Array.isArray(emails)) return res.status(400).json({ error: "emails must be an array" });

    const trimmed = emails.map((e: unknown) => (typeof e === "string" ? e.trim() : "")).filter(Boolean).slice(0, MAX_BULK);
    if (trimmed.length === 0) return res.json({ results: [], total: 0 });

    const db = await getDb();
    const canCheck = await checkAndLogLimit(db, req.user.id, trimmed.length);
    if (!canCheck) return res.status(403).json({ error: `Daily limit exceeded. Cannot process ${trimmed.length} emails.` });

    const results = await verifyBatch(trimmed);

    for (const r of results) {
      await safeLogInsert(db, req.user.id, r.email, r.status, r.confidenceScore, r.flags);
      if (r.details.smtpVerdict === "greylisted") {
        await enqueueRetry(r.email, req.user.id);
      }
    }

    return res.json({ results, total: results.length });
  } catch (error: any) {
    console.error("[VerifEye] /api/verify-bulk error:", error?.message ?? error);
    return res.status(500).json({ error: "Internal server error during bulk processing", detail: error?.message });
  }
});

// ── Deep (real-email) verification ────────────────────────────────────────────
app.post("/api/verify/deep", rateLimit, requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { email, logId } = req.body;
    if (!email || typeof email !== "string") return res.status(400).json({ error: "email is required" });
    if (!MAILER_ENABLED) {
      return res.json({
        error: "Deep verification is not configured. Add SMTP credentials to .env to enable this feature.",
        disabled: true,
      });
    }

    const numericLogId = parseInt(logId ?? "0");
    const result = await sendDeepVerification(email.trim(), numericLogId);
    return res.json({ success: true, queueId: result.queueId, message: "Verification email queued successfully." });
  } catch (error: any) {
    console.error("[VerifEye] /api/verify/deep error:", error);
    return res.status(500).json({ error: "Failed to queue deep verification" });
  }
});

app.get("/api/verify/deep/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const status = await getDeepVerificationStatus(parseInt(req.params.id));
    if (!status) return res.status(404).json({ error: "Not found" });
    return res.json(status);
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

// ── Open-tracking pixel ───────────────────────────────────────────────────────
// Route intentionally uses a neutral path (/r/:token) — paths containing
// "tracking" or "pixel" are blocked by every major ad blocker (uBlock, Brave, etc.).
const PIXEL_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

app.get("/r/:token", async (req, res) => {
  try {
    await markPixelDelivered(req.params.token);
  } catch (_) {}
  res.set({
    "Content-Type": "image/gif",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    "Content-Length": PIXEL_GIF.length.toString(),
  });
  res.end(PIXEL_GIF);
});

// ── Admin: retry queue status ─────────────────────────────────────────────────
app.get("/api/retry-queue", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const jobs = await getPendingJobs();
    res.json(jobs);
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

// ---------------------------------------------------------------------------
// Server startup
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
    console.log(`[VerifEye] Deep email verification: ${MAILER_ENABLED ? "ENABLED" : "DISABLED (no SMTP config)"}`);
    startRetryQueue();
  });
}

startServer();
