// One-off: copy user data from the old SQLite database into Firestore.
//
//   node scripts/migrateSqliteToFirestore.js              # dry run — prints what it would copy
//   node scripts/migrateSqliteToFirestore.js --write      # actually writes
//   node scripts/migrateSqliteToFirestore.js --write --db path/to/database.sqlite
//
// Copies: profiles, watchlists, chat history, trigger reports, rating
// feedback, notifications. Skips the trigger cache, rating cache and
// recommendations on purpose — all were produced by older logic (scraper,
// pre-evidence-gate ratings) and are regenerated on demand.
// Safe to re-run: documents are written with deterministic IDs.

require('dotenv').config();
const path = require('path');
const sqlite3 = require('sqlite3');
const { getDb } = require('../database');

const args = process.argv.slice(2);
const write = args.includes('--write');
const dbPath = args.includes('--db') ? args[args.indexOf('--db') + 1] : path.join(__dirname, '..', 'database.sqlite');

const sqlite = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
const all = sql => new Promise((resolve, reject) => sqlite.all(sql, (err, rows) => (err ? reject(err) : resolve(rows))));
const parse = v => { try { return JSON.parse(v); } catch { return null; } };
const tableExists = async name => (await all(`SELECT name FROM sqlite_master WHERE type='table' AND name='${name}'`)).length > 0;

async function main() {
  const fs = getDb();
  const prefix = process.env.FIRESTORE_PREFIX || '';
  const userDoc = uid => fs.collection(prefix + 'users').doc(uid);
  const writes = []; // [ref, data, description]

  for (const r of await all('SELECT uid, profile FROM user_profiles')) {
    writes.push([userDoc(r.uid), { profile: parse(r.profile) }, `profile ${r.uid}`]);
  }
  for (const r of await all('SELECT uid, movie_id, movie FROM watchlists')) {
    writes.push([userDoc(r.uid).collection('watchlist').doc(String(r.movie_id)), { movie: parse(r.movie), addedAt: new Date(0).toISOString() }, `watchlist ${r.uid}/${r.movie_id}`]);
  }
  for (const r of await all('SELECT uid, messages FROM chat_history')) {
    const messages = (parse(r.messages) || []).filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-50);
    writes.push([userDoc(r.uid).collection('private').doc('chat'), { messages }, `chat ${r.uid}`]);
  }
  for (const r of await all('SELECT id, uid, movie_id, movie_title, note, reported_at FROM trigger_reports')) {
    writes.push([userDoc(r.uid).collection('triggerReports').doc(`sqlite-${r.id}`), { movieId: r.movie_id, movieTitle: r.movie_title, note: r.note, reportedAt: r.reported_at }, `report ${r.uid}`]);
  }
  for (const r of await all('SELECT id, uid, movie_id, movie_title, ai_rating, feedback, note, submitted_at FROM rating_feedback')) {
    writes.push([userDoc(r.uid).collection('ratingFeedback').doc(`sqlite-${r.id}`), {
      movieId: r.movie_id, movieTitle: r.movie_title, aiRating: r.ai_rating, feedback: r.feedback, note: r.note || '', submittedAt: r.submitted_at,
    }, `feedback ${r.uid}`]);
  }
  // Skip every old "safe pick": they came from rating logic that could call a
  // title GREEN with no evidence. And keep only the latest "profile updated"
  // per user — the old app created one per slider tick.
  for (const r of await all(`SELECT * FROM notifications
      WHERE type != 'new_safe_pick'
        AND (type != 'profile_update' OR id IN (SELECT MAX(id) FROM notifications WHERE type = 'profile_update' GROUP BY uid))`)) {
    writes.push([userDoc(r.uid).collection('notifications').doc(`sqlite-${r.id}`), {
      type: r.type, title: r.title, body: r.body, movieId: r.movie_id, movieTitle: r.movie_title, posterPath: r.poster_path, read: r.read === 1, createdAt: r.created_at,
    }, `notification ${r.uid}`]);
  }
  if (await tableExists('consents')) {
    for (const r of await all('SELECT id, uid, version, text, accepted_at FROM consents')) {
      writes.push([userDoc(r.uid).collection('consents').doc(`sqlite-${r.id}`), { version: r.version, text: r.text, acceptedAt: r.accepted_at }, `consent ${r.uid}`]);
    }
  }

  const byKind = writes.reduce((acc, [, , d]) => ((acc[d.split(' ')[0]] = (acc[d.split(' ')[0]] || 0) + 1), acc), {});
  console.log(`Source: ${dbPath}`);
  console.log(`Target: Firestore project ${process.env.FIREBASE_PROJECT_ID}${prefix ? ` (prefix ${prefix})` : ''}`);
  console.log('Documents to write:', byKind, `total ${writes.length}`);

  if (!write) {
    console.log('\nDry run — nothing written. Re-run with --write to copy.');
    return;
  }
  for (let i = 0; i < writes.length; i += 400) {
    const batch = fs.batch();
    for (const [ref, data] of writes.slice(i, i + 400)) batch.set(ref, data, { merge: true });
    await batch.commit();
  }
  console.log(`\nWrote ${writes.length} documents.`);
}

main()
  .then(() => { sqlite.close(); process.exit(0); })
  .catch(err => { console.error(err); process.exit(1); });
