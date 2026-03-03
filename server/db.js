import Database from "better-sqlite3";

export const db = new Database("orders.db");

db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    business TEXT NOT NULL,
    selections_json TEXT NOT NULL,
    total_cents INTEGER NOT NULL,
    stripe_session_id TEXT NOT NULL,
    paid INTEGER NOT NULL DEFAULT 0
    );
`);