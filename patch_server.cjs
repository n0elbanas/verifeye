const fs = require('fs');

let content = fs.readFileSync('server.ts', 'utf-8');

// 1. Add imports
content = content.replace(
`import express, { Request, Response } from "express";
import { createServer as createViteServer } from "vite";
import dns from "dns";
import { promisify } from "util";
import validator from "validator";
import net from "net";`,
`import express, { Request, Response, NextFunction } from "express";
import { createServer as createViteServer } from "vite";
import dns from "dns";
import { promisify } from "util";
import validator from "validator";
import net from "net";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { getDb } from "./db.js";

const JWT_SECRET = process.env.JWT_SECRET || "supersecret_verifeye123!";`
);

// 2. Add cookieParser and initialize DB
content = content.replace(
`app.use(express.json({ limit: "2mb" }));`,
`app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

getDb().catch(console.error);

// Auth Middleware
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
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
};

const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.role !== "ADMIN") return res.status(403).json({ error: "Forbidden" });
  next();
};

async function checkAndLogLimit(db: any, userId: number, count: number): Promise<boolean> {
  const user = await db.get("SELECT * FROM users WHERE id = ?", [userId]);
  if (!user) return false;

  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  
  if (user.last_check_date !== today) {
    // Reset limit for new day
    await db.run("UPDATE users SET emails_checked_today = 0, last_check_date = ? WHERE id = ?", [today, userId]);
    user.emails_checked_today = 0;
  }

  if (user.daily_limit !== -1 && (user.emails_checked_today + count) > user.daily_limit) {
    return false; // Limit exceeded
  }
  
  // Update limit
  await db.run("UPDATE users SET emails_checked_today = emails_checked_today + ? WHERE id = ?", [count, userId]);
  return true;
}
`
);

// 3. Replace API routes completely
const routesStart = content.indexOf('// ---------------------------------------------------------------------------');
const apiRoutesIndex = content.indexOf('// API Routes', routesStart);
if (apiRoutesIndex !== -1) {
    const nextSection = content.indexOf('// Start server', apiRoutesIndex);
    const startReplace = content.lastIndexOf('// ---', apiRoutesIndex);
    const endReplace = content.lastIndexOf('// ---', nextSection);
    
    const newRoutes = `// ---------------------------------------------------------------------------
// API Routes
// ---------------------------------------------------------------------------

// ---- Auth Routes ----
app.post("/api/auth/login", async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Missing email or password" });

  try {
    const db = await getDb();
    const user = await db.get("SELECT * FROM users WHERE email = ?", [email]);
    if (!user) return res.status(401).json({ error: "Invalid email or password" });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Invalid email or password" });

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role, limit: user.daily_limit }, JWT_SECRET, { expiresIn: '1d' });
    res.cookie("token", token, { httpOnly: true, sameSite: "strict" });
    
    // get user without password_hash
    const { password_hash, ...safeUser } = user;
    res.json({ user: safeUser });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/auth/logout", (req, res) => {
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
  } catch(e) {
    res.status(500).json({error: "Server error"});
  }
});

// ---- User/Settings Routes ----
app.get("/api/users", requireAuth, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const users = await db.all("SELECT id, email, role, daily_limit, emails_checked_today, last_check_date FROM users");
    res.json(users);
  } catch(e) { res.status(500).json({error: "Server error"}); }
});

app.post("/api/users", requireAuth, requireAdmin, async (req, res) => {
  const { email, password, limit } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Missing required fields" });
  try {
    const db = await getDb();
    const hash = await bcrypt.hash(password, 10);
    const result = await db.run("INSERT INTO users (email, password_hash, role, daily_limit) VALUES (?, ?, 'USER', ?)", [email, hash, parseInt(limit) || -1]);
    res.json({ success: true, id: result.lastID });
  } catch(e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.put("/api/users/:id/limit", requireAuth, requireAdmin, async (req, res) => {
  const { daily_limit } = req.body;
  try {
    const db = await getDb();
    await db.run("UPDATE users SET daily_limit = ? WHERE id = ?", [parseInt(daily_limit), req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({error: "Server error"}); }
});

app.put("/api/users/password", requireAuth, async (req: AuthRequest, res) => {
  const { currentPassword, newPassword } = req.body;
  if(!currentPassword || !newPassword) return res.status(400).json({error: "Missing fields"});
  try {
    const db = await getDb();
    const user = await db.get("SELECT * FROM users WHERE id = ?", [req.user.id]);
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) return res.status(400).json({ error: "Incorrect current password" });
    
    const hash = await bcrypt.hash(newPassword, 10);
    await db.run("UPDATE users SET password_hash = ? WHERE id = ?", [hash, req.user.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({error: "Server error"}); }
});

// ---- Logs Routes ----
app.get("/api/logs", requireAuth, async (req: AuthRequest, res) => {
  try {
    const db = await getDb();
    let logs;
    // Admin sees all logs, user sees own logs
    if (req.user.role === "ADMIN") {
      logs = await db.all(\`
        SELECT logs.id, logs.email, logs.status, logs.timestamp, users.email as checked_by 
        FROM logs 
        JOIN users ON logs.user_id = users.id 
        ORDER BY timestamp DESC LIMIT 500
      \`);
    } else {
      logs = await db.all(\`
        SELECT id, email, status, timestamp 
        FROM logs 
        WHERE user_id = ? 
        ORDER BY timestamp DESC LIMIT 500
      \`, [req.user.id]);
    }
    res.json(logs);
  } catch(e) { res.status(500).json({error: "Server error"}); }
});

// ---- Verification Routes ----
app.post("/api/verify", rateLimit, requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== "string") return res.status(400).json({ error: "email field is required" });
    
    const db = await getDb();
    const canCheck = await checkAndLogLimit(db, req.user.id, 1);
    if (!canCheck) return res.status(403).json({ error: "Daily verification limit reached." });

    const result = await verifySingleEmail(email.trim());
    await db.run("INSERT INTO logs (user_id, email, status) VALUES (?, ?, ?)", [req.user.id, result.email, result.status]);
    return res.json(result);
  } catch (error: any) {
    console.error("[VerifEye] /api/verify error:", error);
    return res.status(500).json({ error: "Internal server error" });
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
    if (!canCheck) return res.status(403).json({ error: \`Daily limit exceeded. Cannot process \${trimmed.length} emails.\` });

    const results = await verifyBatch(trimmed);
    
    const stmt = await db.prepare("INSERT INTO logs (user_id, email, status) VALUES (?, ?, ?)");
    for (const r of results) {
      await stmt.run([req.user.id, r.email, r.status]);
    }
    await stmt.finalize();

    return res.json({ results, total: results.length });
  } catch (error: any) {
    console.error("[VerifEye] /api/verify-bulk error:", error);
    return res.status(500).json({ error: "Internal server error during bulk processing" });
  }
});

`;

    content = content.substring(0, startReplace) + newRoutes + content.substring(endReplace);
}

fs.writeFileSync('server.ts', content);
console.log('Successfully patched server.ts');
