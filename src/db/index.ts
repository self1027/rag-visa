import { settings } from '../config/settings.js';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import path from 'path';
import fs from 'fs';
import { migrateDatabase } from './migrate.js';

const databasePath = settings.databasePath;
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const sqlite = new Database(databasePath);
sqlite.pragma('busy_timeout = 5000');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('journal_mode = WAL');
export const db = drizzle(sqlite);
migrateDatabase(db);
