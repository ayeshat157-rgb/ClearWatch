const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');

const DB_PATH = path.join(__dirname, 'database.sqlite');

let dbInstance = null;

async function getDb() {
  if (dbInstance) return dbInstance;

  dbInstance = await open({
    filename: DB_PATH,
    driver: sqlite3.Database
  });

  await dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS movie_cache (
      tmdb_id TEXT PRIMARY KEY,
      triggers JSON,
      scraped_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS movie_meta (
      tmdb_id TEXT PRIMARY KEY,
      title TEXT,
      release_date TEXT,
      poster_path TEXT
    );

    CREATE TABLE IF NOT EXISTS user_profiles (
      uid TEXT PRIMARY KEY,
      profile JSON
    );

    CREATE TABLE IF NOT EXISTS watchlists (
      uid TEXT,
      movie_id TEXT,
      movie JSON,
      PRIMARY KEY (uid, movie_id)
    );

    CREATE TABLE IF NOT EXISTS recommendations (
      uid TEXT PRIMARY KEY,
      generated_at DATETIME,
      movies JSON
    );

    CREATE TABLE IF NOT EXISTS ratings_cache (
      uid TEXT,
      movie_id TEXT,
      profile_hash TEXT,
      rating JSON,
      generated_at DATETIME,
      PRIMARY KEY (uid, movie_id)
    );

    CREATE TABLE IF NOT EXISTS chat_history (
      uid TEXT PRIMARY KEY,
      messages JSON
    );

    CREATE TABLE IF NOT EXISTS trigger_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT,
      movie_id TEXT,
      movie_title TEXT,
      note TEXT,
      reported_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS rating_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT,
      movie_id TEXT,
      movie_title TEXT,
      ai_rating TEXT,
      feedback TEXT,
      note TEXT,
      submitted_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      movie_id TEXT,
      movie_title TEXT,
      poster_path TEXT,
      read INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL
    );
  `);

  return dbInstance;
}

module.exports = { getDb };
