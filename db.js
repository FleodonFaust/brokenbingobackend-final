import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'bingo.db');
export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS phrases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1
);
`);

export function getRandomPhrases(limit) {
  // SQLite: losowanie przez RANDOM(); filtrujemy enabled
  const stmt = db.prepare('SELECT text FROM phrases WHERE enabled = 1 ORDER BY RANDOM() LIMIT ?');
  return stmt.all(limit).map(r => r.text);
}


