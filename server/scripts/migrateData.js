const fs = require('fs');
const path = require('path');
const { getDb } = require('../db');

const DB_PATH = path.join(__dirname, '..', 'data.json');

async function migrate() {
  if (!fs.existsSync(DB_PATH)) {
    console.log('No data.json found, skipping migration.');
    return;
  }

  console.log('Loading data.json...');
  const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  const db = await getDb();

  console.log('Starting migration to SQLite...');

  // 1. movie_cache
  if (data.movieCache) {
    for (const [tmdbId, entry] of Object.entries(data.movieCache)) {
      await db.run(
        'INSERT OR IGNORE INTO movie_cache (tmdb_id, triggers, scraped_at) VALUES (?, ?, ?)',
        tmdbId,
        JSON.stringify(entry.triggers || []),
        entry.scrapedAt
      );
    }
  }

  // 2. movie_meta
  if (data.movieMeta) {
    for (const [tmdbId, meta] of Object.entries(data.movieMeta)) {
      await db.run(
        'INSERT OR IGNORE INTO movie_meta (tmdb_id, title, release_date, poster_path) VALUES (?, ?, ?, ?)',
        tmdbId,
        meta.title,
        meta.release_date,
        meta.poster_path
      );
    }
  }

  // 3. trigger_reports
  if (data.triggerReports) {
    for (const report of data.triggerReports) {
      await db.run(
        'INSERT INTO trigger_reports (uid, movie_id, movie_title, note, reported_at) VALUES (?, ?, ?, ?, ?)',
        report.uid,
        report.movieId.toString(),
        report.movieTitle,
        report.note,
        report.reportedAt
      );
    }
  }

  // 4. rating_feedback
  if (data.ratingFeedback) {
    for (const feedback of data.ratingFeedback) {
      await db.run(
        'INSERT INTO rating_feedback (uid, movie_id, movie_title, ai_rating, feedback, note, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        feedback.uid,
        feedback.movieId.toString(),
        feedback.movieTitle,
        feedback.aiRating,
        feedback.feedback,
        feedback.note,
        feedback.submittedAt
      );
    }
  }

  // 5. users (profiles, watchlists, recommendations, ratings_cache, chat_history)
  if (data.users) {
    for (const [uid, user] of Object.entries(data.users)) {
      if (user.profile) {
        await db.run('INSERT OR IGNORE INTO user_profiles (uid, profile) VALUES (?, ?)', uid, JSON.stringify(user.profile));
      }

      if (user.watchlist) {
        for (const [movieId, movie] of Object.entries(user.watchlist)) {
          await db.run(
            'INSERT OR IGNORE INTO watchlists (uid, movie_id, movie) VALUES (?, ?, ?)',
            uid,
            movieId.toString(),
            JSON.stringify(movie)
          );
        }
      }

      if (user.recommendations) {
        await db.run(
          'INSERT OR IGNORE INTO recommendations (uid, generated_at, movies) VALUES (?, ?, ?)',
          uid,
          user.recommendations.generatedAt,
          JSON.stringify(user.recommendations.movies)
        );
      }

      if (user.ratingsCache) {
        for (const [movieId, entry] of Object.entries(user.ratingsCache)) {
          await db.run(
            'INSERT OR IGNORE INTO ratings_cache (uid, movie_id, profile_hash, rating, generated_at) VALUES (?, ?, ?, ?, ?)',
            uid,
            movieId.toString(),
            entry.profileHash,
            JSON.stringify(entry.rating),
            entry.generatedAt
          );
        }
      }

      if (user.chatHistory) {
        await db.run('INSERT OR IGNORE INTO chat_history (uid, messages) VALUES (?, ?)', uid, JSON.stringify(user.chatHistory));
      }
    }
  }

  console.log('Migration complete!');
}

migrate().catch(console.error);
