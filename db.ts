import sqlite3 from "sqlite3";
import { open, Database } from "sqlite";
import bcrypt from "bcryptjs";

let dbInstance: Database | null = null;

export async function getDb(): Promise<Database> {
  if (dbInstance) {
    return dbInstance;
  }

  const db = await open({
    filename: "database.sqlite",
    driver: sqlite3.Database,
  });

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
      confidence_score INTEGER,
      flags TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id)
    );

    -- Deep (real-email) verification queue
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

    -- SMTP greylisting retry queue
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

  // Ensure default admin exists
  const admin = await db.get("SELECT * FROM users WHERE email = 'admin@verifeye.ph'");
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
