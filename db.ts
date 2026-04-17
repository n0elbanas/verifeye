import sqlite3 from "sqlite3";
import { open, Database } from "sqlite";
import bcrypt from "bcryptjs";

let dbInstance: Database | null = null;

/**
 * Add a column to a table only if it doesn't already exist.
 * SQLite has no "ALTER TABLE ADD COLUMN IF NOT EXISTS" — we use PRAGMA table_info instead.
 */
async function addColumnIfMissing(
  db: Database,
  table: string,
  column: string,
  definition: string
): Promise<void> {
  const info = await db.all(`PRAGMA table_info(${table})`);
  const exists = info.some((col: any) => col.name === column);
  if (!exists) {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`[VerifEye DB] Added column: ${table}.${column}`);
  }
}

export async function getDb(): Promise<Database> {
  if (dbInstance) {
    return dbInstance;
  }

  const db = await open({
    filename: "database.sqlite",
    driver: sqlite3.Database,
  });

  // Enable WAL mode for better concurrent read/write performance
  await db.exec("PRAGMA journal_mode=WAL;");

  // ── Core tables ──────────────────────────────────────────────────────────
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

    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      email TEXT NOT NULL,
      status TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id)
    );

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

  // ── Self-healing migrations ──────────────────────────────────────────────
  // These run on EVERY startup and safely add any missing columns.
  // This means the production server never needs a manual migration run.
  await addColumnIfMissing(db, "logs", "confidence_score", "INTEGER DEFAULT NULL");
  await addColumnIfMissing(db, "logs", "flags", "TEXT DEFAULT NULL");

  // ── Default admin ────────────────────────────────────────────────────────
  const admin = await db.get("SELECT id FROM users WHERE email = 'admin@verifeye.ph'");
  if (!admin) {
    const defaultPasswordHash = await bcrypt.hash("asdQWE123#", 10);
    await db.run(
      `INSERT INTO users (email, password_hash, role, daily_limit) VALUES (?, ?, ?, ?)`,
      ["admin@verifeye.ph", defaultPasswordHash, "ADMIN", -1]
    );
    console.log("[VerifEye] Default admin user created: admin@verifeye.ph");
  }

  dbInstance = db;
  return db;
}
