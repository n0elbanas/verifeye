import sqlite3 from "sqlite3";
import { open } from "sqlite";
import bcrypt from "bcryptjs";

async function runMigration() {
  console.log("[Migration] Starting database migration...");

  const db = await open({
    filename: "database.sqlite",
    driver: sqlite3.Database,
  });

  // 1. Ensure `users` table exists
  console.log("[Migration] Ensuring users table exists...");
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

  // 2. Ensure default admin user exists (since old logs need a user_id)
  let admin = await db.get("SELECT id FROM users ORDER BY id ASC LIMIT 1");
  if (!admin) {
    console.log("[Migration] Interjecting default admin to own legacy logs...");
    const defaultPasswordHash = await bcrypt.hash("asdQWE123#", 10);
    const result = await db.run(
      `INSERT INTO users (email, password_hash, role, daily_limit) VALUES (?, ?, ?, ?)`,
      ["admin@verifeye.ph", defaultPasswordHash, "ADMIN", -1]
    );
    admin = { id: result.lastID };
    console.log(`[Migration] Default admin created with ID ${admin.id}.`);
  } else {
    console.log(`[Migration] Admin user found with ID ${admin.id}. Legacy logs will map to this user.`);
  }

  const legacyUserId = admin.id;

  // 3. Inspect the current `logs` table schema
  console.log("[Migration] Checking current logs table schema...");
  let needsMigration = false;
  
  try {
    const tableInfo = await db.all("PRAGMA table_info(logs)");
    if (tableInfo.length > 0) {
      const hasUserId = tableInfo.some((col: any) => col.name === "user_id");
      if (!hasUserId) {
        needsMigration = true;
      }
    } else {
      console.log("[Migration] 'logs' table does not exist. Creating fresh schema...");
      await db.exec(`
        CREATE TABLE logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          email TEXT NOT NULL,
          status TEXT NOT NULL,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users (id)
        );
      `);
      console.log("[Migration] Fresh logs table initialized. No migration needed.");
      return;
    }
  } catch (err) {
    console.log("[Migration] Assuming fresh deployment.");
  }

  // 4. Perform the structured database migration if `user_id` does not exist
  if (needsMigration) {
    console.log("[Migration] 'user_id' column missing in legacy 'logs' table. Proceeding with table migration...");
    
    // SQLite drops limitations mean we will rename and recreate the table
    await db.exec("BEGIN TRANSACTION");

    try {
      // Create new table
      await db.exec(`
        CREATE TABLE logs_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          email TEXT NOT NULL,
          status TEXT NOT NULL,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users (id)
        );
      `);
      
      // Copy data mapping them to `legacyUserId`
      const migrationResult = await db.run(`
        INSERT INTO logs_new (id, user_id, email, status, timestamp)
        SELECT id, ?, email, status, timestamp FROM logs
      `, [legacyUserId]);
      
      console.log(`[Migration] Migrated ${migrationResult.changes} legacy logs.`);

      // Swap tables
      await db.exec("DROP TABLE logs;");
      await db.exec("ALTER TABLE logs_new RENAME TO logs;");
      
      await db.exec("COMMIT");
      console.log("[Migration] Migration completed successfully.");
    } catch (error) {
      await db.exec("ROLLBACK");
      console.error("[Migration] Migration aborted due to an error.", error);
    }
  } else {
    console.log("[Migration] 'logs' table already contains 'user_id'. No migration needed.");
  }

  await db.close();
}

runMigration().catch(console.error);
