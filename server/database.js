const { getDb } = require('./db');

// ─── Trigger cache ───────────────────────────────────────────────────────
const CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 90; // 90 days

async function getCachedTriggers(tmdbId) {
  const db = await getDb();
  const row = await db.get('SELECT * FROM movie_cache WHERE tmdb_id = ?', tmdbId);
  if (!row) return null;
  const ageMs = Date.now() - new Date(row.scraped_at).getTime();
  if (ageMs > CACHE_MAX_AGE_MS) return null;
  return JSON.parse(row.triggers);
}

async function saveCachedTriggers(tmdbId, triggers) {
  const db = await getDb();
  await db.run(
    'INSERT OR REPLACE INTO movie_cache (tmdb_id, triggers, scraped_at) VALUES (?, ?, ?)',
    tmdbId,
    JSON.stringify(triggers),
    new Date().toISOString()
  );
}

// ─── User profile ────────────────────────────────────────────────────────
async function getProfile(uid) {
  const db = await getDb();
  const row = await db.get('SELECT profile FROM user_profiles WHERE uid = ?', uid);
  return row ? JSON.parse(row.profile) : null;
}

async function saveProfile(uid, profile) {
  const db = await getDb();
  await db.run(
    'INSERT OR REPLACE INTO user_profiles (uid, profile) VALUES (?, ?)',
    uid,
    JSON.stringify(profile)
  );
}

// ─── Watchlist ───────────────────────────────────────────────────────────
async function getWatchlist(uid) {
  const db = await getDb();
  const rows = await db.all('SELECT movie FROM watchlists WHERE uid = ?', uid);
  return rows.map(r => JSON.parse(r.movie));
}

async function addToWatchlist(uid, movie) {
  const db = await getDb();
  await db.run(
    'INSERT OR REPLACE INTO watchlists (uid, movie_id, movie) VALUES (?, ?, ?)',
    uid,
    movie.id.toString(),
    JSON.stringify(movie)
  );
}

async function removeFromWatchlist(uid, movieId) {
  const db = await getDb();
  await db.run('DELETE FROM watchlists WHERE uid = ? AND movie_id = ?', uid, movieId.toString());
}

// ─── Recommendations ─────────────────────────────────────────────────────
async function getRecommendations(uid) {
  const db = await getDb();
  const row = await db.get('SELECT generated_at, movies FROM recommendations WHERE uid = ?', uid);
  if (!row) return null;
  return { generatedAt: row.generated_at, movies: JSON.parse(row.movies) };
}

async function saveRecommendations(uid, movies) {
  const db = await getDb();
  await db.run(
    'INSERT OR REPLACE INTO recommendations (uid, generated_at, movies) VALUES (?, ?, ?)',
    uid,
    new Date().toISOString(),
    JSON.stringify(movies)
  );
}

// ─── Movie summaries + collections ───────────────────────────────────────
async function cacheMovieSummary(tmdbId, movie) {
  const db = await getDb();
  await db.run(
    'INSERT OR REPLACE INTO movie_meta (tmdb_id, title, release_date, poster_path) VALUES (?, ?, ?, ?)',
    tmdbId,
    movie.title,
    movie.release_date,
    movie.poster_path
  );
}

async function getAllCachedEntries() {
  const db = await getDb();
  // Join cache and meta so we only return movies that have both triggers and metadata
  const rows = await db.all(`
    SELECT c.triggers, m.tmdb_id, m.title, m.release_date, m.poster_path
    FROM movie_cache c
    JOIN movie_meta m ON c.tmdb_id = m.tmdb_id
  `);
  
  return rows.map(r => ({
    movie: {
      id: r.tmdb_id,
      title: r.title,
      release_date: r.release_date,
      poster_path: r.poster_path
    },
    triggers: JSON.parse(r.triggers)
  }));
}

// ─── Personalized rating cache ───────────────────────────────────────────
const RATING_CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

async function getCachedRating(uid, movieId, profileHash) {
  const db = await getDb();
  const row = await db.get(
    'SELECT rating, profile_hash, generated_at FROM ratings_cache WHERE uid = ? AND movie_id = ?',
    uid, movieId.toString()
  );
  if (!row || row.profile_hash !== profileHash) return null;
  
  const ageMs = Date.now() - new Date(row.generated_at).getTime();
  if (ageMs > RATING_CACHE_MAX_AGE_MS) return null;
  
  return JSON.parse(row.rating);
}

async function saveCachedRating(uid, movieId, profileHash, rating) {
  const db = await getDb();
  await db.run(
    'INSERT OR REPLACE INTO ratings_cache (uid, movie_id, profile_hash, rating, generated_at) VALUES (?, ?, ?, ?, ?)',
    uid,
    movieId.toString(),
    profileHash,
    JSON.stringify(rating),
    new Date().toISOString()
  );
}

// ─── Missing trigger reports ─────────────────────────────────────────────
async function addTriggerReport(uid, report) {
  const db = await getDb();
  await db.run(
    'INSERT INTO trigger_reports (uid, movie_id, movie_title, note, reported_at) VALUES (?, ?, ?, ?, ?)',
    uid,
    report.movieId.toString(),
    report.movieTitle,
    report.note,
    new Date().toISOString()
  );
}

// ─── Account deletion ────────────────────────────────────────────────────
async function deleteUserData(uid) {
  const db = await getDb();
  await db.run('DELETE FROM user_profiles WHERE uid = ?', uid);
  await db.run('DELETE FROM watchlists WHERE uid = ?', uid);
  await db.run('DELETE FROM recommendations WHERE uid = ?', uid);
  await db.run('DELETE FROM ratings_cache WHERE uid = ?', uid);
  await db.run('DELETE FROM chat_history WHERE uid = ?', uid);
  await db.run('DELETE FROM trigger_reports WHERE uid = ?', uid);
  await db.run('DELETE FROM rating_feedback WHERE uid = ?', uid);
}

// ─── Rating feedback (👍/👎) ─────────────────────────────────────────────
async function addRatingFeedback(uid, entry) {
  const db = await getDb();
  await db.run(
    'INSERT INTO rating_feedback (uid, movie_id, movie_title, ai_rating, feedback, note, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    uid,
    entry.movieId.toString(),
    entry.movieTitle,
    entry.aiRating,
    entry.feedback,
    entry.note || '',
    new Date().toISOString()
  );
}

async function getUserRatingFeedback(uid, limit = 10) {
  const db = await getDb();
  const rows = await db.all(
    'SELECT * FROM rating_feedback WHERE uid = ? ORDER BY submitted_at DESC LIMIT ?',
    uid, limit
  );
  return rows.map(r => ({
    uid: r.uid,
    movieId: r.movie_id,
    movieTitle: r.movie_title,
    aiRating: r.ai_rating,
    feedback: r.feedback,
    note: r.note,
    submittedAt: r.submitted_at
  }));
}

// ─── Chat History ────────────────────────────────────────────────────────
async function getChatHistory(uid) {
  const db = await getDb();
  const row = await db.get('SELECT messages FROM chat_history WHERE uid = ?', uid);
  return row ? JSON.parse(row.messages) : [];
}

async function saveChatHistory(uid, messages) {
  const db = await getDb();
  const limitedMessages = Array.isArray(messages) ? messages.slice(-50) : [];
  await db.run(
    'INSERT OR REPLACE INTO chat_history (uid, messages) VALUES (?, ?)',
    uid,
    JSON.stringify(limitedMessages)
  );
}

async function clearChatHistory(uid) {
  const db = await getDb();
  await db.run('DELETE FROM chat_history WHERE uid = ?', uid);
}

// ─── Notifications ───────────────────────────────────────────────────────────
async function getNotifications(uid) {
  const db = await getDb();
  const rows = await db.all(
    'SELECT * FROM notifications WHERE uid = ? ORDER BY created_at DESC LIMIT 50',
    uid
  );
  return rows.map(r => ({
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body,
    movieId: r.movie_id,
    movieTitle: r.movie_title,
    posterPath: r.poster_path,
    read: r.read === 1,
    createdAt: r.created_at,
  }));
}

async function addNotification(uid, { type, title, body, movieId = null, movieTitle = null, posterPath = null }) {
  const db = await getDb();
  await db.run(
    'INSERT INTO notifications (uid, type, title, body, movie_id, movie_title, poster_path, read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)',
    uid, type, title, body, movieId, movieTitle, posterPath, new Date().toISOString()
  );
}

async function markNotificationsRead(uid, ids = null) {
  const db = await getDb();
  if (ids && ids.length > 0) {
    // mark specific IDs as read
    const placeholders = ids.map(() => '?').join(',');
    await db.run(
      `UPDATE notifications SET read = 1 WHERE uid = ? AND id IN (${placeholders})`,
      uid, ...ids
    );
  } else {
    // mark all as read
    await db.run('UPDATE notifications SET read = 1 WHERE uid = ?', uid);
  }
}

async function getUnreadNotificationCount(uid) {
  const db = await getDb();
  const row = await db.get('SELECT COUNT(*) as cnt FROM notifications WHERE uid = ? AND read = 0', uid);
  return row?.cnt ?? 0;
}

module.exports = {
  getCachedTriggers, saveCachedTriggers,
  getProfile, saveProfile,
  getWatchlist, addToWatchlist, removeFromWatchlist,
  getRecommendations, saveRecommendations,
  cacheMovieSummary, getAllCachedEntries,
  getCachedRating, saveCachedRating,
  addTriggerReport, deleteUserData,
  addRatingFeedback, getUserRatingFeedback,
  getChatHistory, saveChatHistory, clearChatHistory,
  getNotifications, addNotification, markNotificationsRead, getUnreadNotificationCount,
};
