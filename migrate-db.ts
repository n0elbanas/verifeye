import sqlite3 from "sqlite3";
import { open } from "sqlite";
import bcrypt from "bcryptjs";

async function runMigration() {
  console.log("[Migration] Starting VerifEye database migration v2...");

  const db = await open({
    filename: "database.sqlite",
    driver: sqlite3.Database,
  });

  // ── 1. Ensure users table exists ──────────────────────────────────────────
  console.log("[Migration] Ensuring users table...");
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'USER',
      daily_limit INTEGER NOT NULL DEFAULT -1,
      emails_checked_today INTEGER NOT NULL DEFAULT 0,
      last_check_date TEXT
    );
  `);

  // ── 2. Ensure default admin exists ────────────────────────────────────────
  let admin = await db.get("SELECT id FROM users ORDER BY id ASC LIMIT 1");
  if (!admin) {
    console.log("[Migration] Creating default admin user...");
    const defaultPasswordHash = await bcrypt.hash("asdQWE123#", 10);
    const result = await db.run(
      `INSERT INTO users (email, password_hash, role, daily_limit) VALUES (?, ?, ?, ?)`,
      ["admin@verifeye.ph", defaultPasswordHash, "ADMIN", -1]
    );
    admin = { id: result.lastID };
    console.log(`[Migration] Default admin created with ID ${admin.id}.`);
  } else {
    console.log(`[Migration] Admin user found with ID ${admin.id}.`);
  }

  const legacyUserId = admin.id;

  // ── 3. Migrate logs table — add user_id if missing ────────────────────────
  console.log("[Migration] Checking logs table schema...");
  let needsUserIdMigration = false;
  let needsConfidenceMigration = false;
  let needsFlagsMigration = false;

  try {
    const tableInfo = await db.all("PRAGMA table_info(logs)");

    if (tableInfo.length === 0) {
      console.log("[Migration] logs table does not exist — creating fresh...");
      await db.exec(`
        CREATE TABLE logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          email TEXT NOT NULL,
          status TEXT NOT NULL,
          confidence_score INTEGER,
          flags TEXT,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users (id)
        );
      `);
      console.log("[Migration] Fresh logs table created.");
    } else {
      const cols = tableInfo.map((c: any) => c.name);
      needsUserIdMigration = !cols.includes("user_id");
      needsConfidenceMigration = !cols.includes("confidence_score");
      needsFlagsMigration = !cols.includes("flags");
    }
  } catch (err) {
    console.log("[Migration] Assuming fresh deployment.");
  }

  // ── 3a. Migrate legacy logs without user_id ───────────────────────────────
  if (needsUserIdMigration) {
    console.log("[Migration] Adding user_id to logs table...");
    await db.exec("BEGIN TRANSACTION");
    try {
      await db.exec(`
        CREATE TABLE logs_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          email TEXT NOT NULL,
          status TEXT NOT NULL,
          confidence_score INTEGER,
          flags TEXT,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users (id)
        );
      `);
      const migResult = await db.run(`
        INSERT INTO logs_new (id, user_id, email, status, timestamp)
        SELECT id, ?, email, status, timestamp FROM logs
      `, [legacyUserId]);
      console.log(`[Migration] Migrated ${migResult.changes} legacy log rows.`);
      await db.exec("DROP TABLE logs;");
      await db.exec("ALTER TABLE logs_new RENAME TO logs;");
      await db.exec("COMMIT");
      console.log("[Migration] user_id migration complete.");
    } catch (error) {
      await db.exec("ROLLBACK");
      console.error("[Migration] user_id migration failed:", error);
    }
  }

  // ── 3b. Add confidence_score column if missing ────────────────────────────
  if (needsConfidenceMigration && !needsUserIdMigration) {
    console.log("[Migration] Adding confidence_score column to logs...");
    try {
      await db.exec("ALTER TABLE logs ADD COLUMN confidence_score INTEGER DEFAULT NULL");
      console.log("[Migration] confidence_score column added.");
    } catch (err: any) {
      if (!err.message?.includes("duplicate column")) throw err;
    }
  }

  // ── 3c. Add flags column if missing ──────────────────────────────────────
  if (needsFlagsMigration && !needsUserIdMigration) {
    console.log("[Migration] Adding flags column to logs...");
    try {
      await db.exec("ALTER TABLE logs ADD COLUMN flags TEXT DEFAULT NULL");
      console.log("[Migration] flags column added.");
    } catch (err: any) {
      if (!err.message?.includes("duplicate column")) throw err;
    }
  }

  // ── 4. New tables — verification_queue and retry_queue ───────────────────
  console.log("[Migration] Ensuring verification_queue table...");
  await db.exec(`
    CREATE TABLE IF NOT EXISTS verification_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      log_id INTEGER REFERENCES logs(id),
      email TEXT NOT NULL,
      tracking_token TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      send_attempt INTEGER NOT NULL DEFAULT 0,
      last_attempt_at DATETIME,
      resolved_at DATETIME,
      bounce_code TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  console.log("[Migration] Ensuring retry_queue table...");
  await db.exec(`
    CREATE TABLE IF NOT EXISTS retry_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id),
      attempts INTEGER NOT NULL DEFAULT 0,
      next_retry_at DATETIME NOT NULL,
      last_result TEXT,
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(email, user_id)
    );
  `);

  console.log("[Migration] ✓ All migrations complete.");
  await db.close();
}

runMigration().catch(console.error);
