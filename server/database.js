// Data layer — Cloud Firestore (via firebase-admin).
//
// Layout:
//   movieCache/{tmdbId}            { triggers, scrapedAt }        shared DDD cache
//   movieMeta/{tmdbId}             { title, release_date, poster_path }
//   users/{uid}                    { profile }
//   users/{uid}/watchlist/{movieId}      { movie, addedAt }
//   users/{uid}/ratings/{movieId}        { rating, profileHash, generatedAt }
//   users/{uid}/ratingFeedback/{auto}    { movieId, movieTitle, aiRating, feedback, note, submittedAt }
//   users/{uid}/triggerReports/{auto}    { movieId, movieTitle, note, reportedAt }
//   users/{uid}/notifications/{auto}     { type, title, body, movieId, movieTitle, posterPath, read, createdAt }
//   users/{uid}/consents/{auto}          { version, text, acceptedAt }
//   users/{uid}/private/chat             { messages }
//   users/{uid}/private/recommendations  { generatedAt, movies }
//
// Everything a user owns sits under users/{uid}, so deleting an account is
// one recursive delete. Firestore encrypts data at rest.
// FIRESTORE_PREFIX (optional) namespaces top-level collections, e.g. for a
// smoke test that must not touch real data.

const { getFirestore } = require('firebase-admin/firestore');
require('./firebaseAdmin'); // initializes the Firebase app

let dbInstance = null;
function getDb() {
  if (!dbInstance) {
    dbInstance = getFirestore();
    // TMDb objects contain undefined fields; Firestore rejects those by default.
    dbInstance.settings({ ignoreUndefinedProperties: true });
  }
  return dbInstance;
}
// Tests swap in an in-memory implementation.
function setDb(db) { dbInstance = db; }

const prefix = () => process.env.FIRESTORE_PREFIX || '';
const col = name => getDb().collection(prefix() + name);
const userDoc = uid => col('users').doc(uid);
const sub = (uid, name) => userDoc(uid).collection(name);
const privateDoc = (uid, name) => sub(uid, 'private').doc(name);
const now = () => new Date().toISOString();
const ageMs = iso => Date.now() - new Date(iso).getTime();

// ─── Trigger cache ───────────────────────────────────────────────────────
const CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 90; // 90 days

async function getCachedTriggers(tmdbId) {
  const snap = await col('movieCache').doc(String(tmdbId)).get();
  if (!snap.exists) return null;
  const { triggers, scrapedAt } = snap.data();
  if (ageMs(scrapedAt) > CACHE_MAX_AGE_MS) return null;
  return triggers;
}

async function saveCachedTriggers(tmdbId, triggers) {
  await col('movieCache').doc(String(tmdbId)).set({ triggers, scrapedAt: now() });
}

// ─── User profile ────────────────────────────────────────────────────────
async function getProfile(uid) {
  const snap = await userDoc(uid).get();
  return snap.exists ? snap.data().profile ?? null : null;
}

async function saveProfile(uid, profile) {
  await userDoc(uid).set({ profile }, { merge: true });
}

// ─── Watchlist ───────────────────────────────────────────────────────────
async function getWatchlist(uid) {
  const snap = await sub(uid, 'watchlist').orderBy('addedAt').get();
  return snap.docs.map(d => d.data().movie);
}

async function addToWatchlist(uid, movie) {
  await sub(uid, 'watchlist').doc(String(movie.id)).set({ movie, addedAt: now() });
}

async function removeFromWatchlist(uid, movieId) {
  await sub(uid, 'watchlist').doc(String(movieId)).delete();
}

// ─── Recommendations ─────────────────────────────────────────────────────
async function getRecommendations(uid) {
  const snap = await privateDoc(uid, 'recommendations').get();
  return snap.exists ? snap.data() : null;
}

async function saveRecommendations(uid, movies) {
  await privateDoc(uid, 'recommendations').set({ generatedAt: now(), movies });
}

// ─── Movie summaries + collections ───────────────────────────────────────
async function cacheMovieSummary(tmdbId, movie) {
  await col('movieMeta').doc(String(tmdbId)).set({
    title: movie.title, release_date: movie.release_date, poster_path: movie.poster_path,
  });
}

// Movies that have both cached triggers and metadata. Reads both collections
// in full, so callers should cache the result (see /api/collections).
async function getAllCachedEntries() {
  const [cache, meta] = await Promise.all([col('movieCache').get(), col('movieMeta').get()]);
  const metaById = new Map(meta.docs.map(d => [d.id, d.data()]));
  return cache.docs
    .filter(d => metaById.has(d.id))
    .map(d => ({ movie: { id: d.id, ...metaById.get(d.id) }, triggers: d.data().triggers || [] }));
}

// ─── Personalized rating cache ───────────────────────────────────────────
const RATING_CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

async function getCachedRating(uid, movieId, profileHash) {
  const snap = await sub(uid, 'ratings').doc(String(movieId)).get();
  if (!snap.exists) return null;
  const row = snap.data();
  if (row.profileHash !== profileHash || ageMs(row.generatedAt) > RATING_CACHE_MAX_AGE_MS) return null;
  return row.rating;
}

async function saveCachedRating(uid, movieId, profileHash, rating) {
  await sub(uid, 'ratings').doc(String(movieId)).set({ rating, profileHash, generatedAt: now() });
}

// ─── Missing trigger reports ─────────────────────────────────────────────
async function addTriggerReport(uid, report) {
  await sub(uid, 'triggerReports').add({
    movieId: String(report.movieId), movieTitle: report.movieTitle ?? null, note: report.note, reportedAt: now(),
  });
}

// ─── Account deletion ────────────────────────────────────────────────────
async function deleteUserData(uid) {
  await getDb().recursiveDelete(userDoc(uid));
}

// ─── Rating feedback (👍/👎) ─────────────────────────────────────────────
async function addRatingFeedback(uid, entry) {
  await sub(uid, 'ratingFeedback').add({
    movieId: String(entry.movieId),
    movieTitle: entry.movieTitle ?? null,
    aiRating: entry.aiRating ?? null,
    feedback: entry.feedback,
    note: entry.note || '',
    submittedAt: now(),
  });
}

async function getUserRatingFeedback(uid, limit = 10) {
  const snap = await sub(uid, 'ratingFeedback').orderBy('submittedAt', 'desc').limit(limit).get();
  return snap.docs.map(d => ({ uid, ...d.data() }));
}

// ─── Chat History ────────────────────────────────────────────────────────
async function getChatHistory(uid) {
  const snap = await privateDoc(uid, 'chat').get();
  return snap.exists ? snap.data().messages || [] : [];
}

async function saveChatHistory(uid, messages) {
  const limited = Array.isArray(messages) ? messages.slice(-50) : [];
  await privateDoc(uid, 'chat').set({ messages: limited });
}

async function clearChatHistory(uid) {
  await privateDoc(uid, 'chat').delete();
}

// ─── Notifications ───────────────────────────────────────────────────────
async function getNotifications(uid) {
  const snap = await sub(uid, 'notifications').orderBy('createdAt', 'desc').limit(50).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function addNotification(uid, { type, title, body, movieId = null, movieTitle = null, posterPath = null }) {
  await sub(uid, 'notifications').add({
    type, title, body, movieId, movieTitle, posterPath, read: false, createdAt: now(),
  });
}

// ids: specific notification IDs, or null/empty to mark all read. IDs are
// looked up under this user's own path, so nobody can touch another user's.
async function markNotificationsRead(uid, ids = null) {
  const batch = getDb().batch();
  if (Array.isArray(ids) && ids.length > 0) {
    const snaps = await Promise.all(ids.slice(0, 100).map(id => sub(uid, 'notifications').doc(String(id)).get()));
    snaps.filter(s => s.exists).forEach(s => batch.update(s.ref, { read: true }));
  } else {
    const unread = await sub(uid, 'notifications').where('read', '==', false).get();
    unread.docs.forEach(d => batch.update(d.ref, { read: true }));
  }
  await batch.commit();
}

async function getUnreadNotificationCount(uid) {
  const agg = await sub(uid, 'notifications').where('read', '==', false).count().get();
  return agg.data().count;
}

// ─── Consent + data export ───────────────────────────────────────────────
async function recordConsent(uid, version, text) {
  await sub(uid, 'consents').add({ version, text, acceptedAt: now() });
}

// Everything we hold about one user, in a portable form.
async function exportUserData(uid) {
  const all = async name => (await sub(uid, name).get()).docs.map(d => d.data());
  return {
    exportedAt: now(),
    uid,
    profile: await getProfile(uid),
    watchlist: await getWatchlist(uid),
    chatHistory: await getChatHistory(uid),
    ratingFeedback: await all('ratingFeedback'),
    triggerReports: await all('triggerReports'),
    notifications: await getNotifications(uid),
    savedRatings: (await sub(uid, 'ratings').get()).docs.map(d => ({ movieId: d.id, ...d.data() })),
    consents: await all('consents'),
  };
}

module.exports = {
  getDb, setDb,
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
  recordConsent, exportUserData,
};
