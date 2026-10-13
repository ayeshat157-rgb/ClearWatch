// Exercises every data-layer function against the REAL Firestore project,
// under a throwaway collection prefix, then deletes everything it wrote.
// Catches what the in-memory test double can't (indexes, value types, limits).
//
//   node scripts/firestoreSmokeTest.js

require('dotenv').config();
process.env.FIRESTORE_PREFIX = `_smoketest_${Date.now()}_`;

const assert = require('node:assert/strict');
const db = require('../database');

async function cleanup() {
  const fs = db.getDb();
  for (const name of ['users', 'movieCache', 'movieMeta']) {
    const snap = await fs.collection(process.env.FIRESTORE_PREFIX + name).get();
    for (const d of snap.docs) await fs.recursiveDelete(d.ref);
  }
}

async function main() {
  const uid = 'smoke-user';
  const steps = [];
  const step = async (name, fn) => { await fn(); steps.push(name); console.log('✓', name); };

  try {
    await step('trigger cache', async () => {
      const triggers = [{ topic: 'a dog dies', yes: '933', no: '44', topicId: 153, verified: null }];
      await db.saveCachedTriggers(14306, triggers);
      assert.deepEqual(await db.getCachedTriggers(14306), triggers);
      assert.equal(await db.getCachedTriggers(1), null);
    });
    await step('movie meta + collections join (undefined fields ignored)', async () => {
      await db.cacheMovieSummary(14306, { title: 'Marley & Me', release_date: '2008-12-25', poster_path: undefined });
      const entries = await db.getAllCachedEntries();
      assert.equal(entries.length, 1);
      assert.equal(entries[0].movie.title, 'Marley & Me');
    });
    await step('profile', async () => {
      await db.saveProfile(uid, { triggers: ['Animal cruelty or death'], kidsMode: false });
      assert.deepEqual((await db.getProfile(uid)).triggers, ['Animal cruelty or death']);
    });
    await step('watchlist (ordered)', async () => {
      await db.addToWatchlist(uid, { id: 1, title: 'A' });
      await db.addToWatchlist(uid, { id: 2, title: 'B' });
      await db.removeFromWatchlist(uid, 1);
      assert.deepEqual((await db.getWatchlist(uid)).map(m => m.id), [2]);
    });
    await step('rating cache', async () => {
      await db.saveCachedRating(uid, 14306, 'hash1', { rating: 'RED', matchPct: 20, coverage: { evidence: { x: [{ topic: 't', yes: 1, no: 0 }] } } });
      assert.equal((await db.getCachedRating(uid, 14306, 'hash1')).rating, 'RED');
      assert.equal(await db.getCachedRating(uid, 14306, 'other'), null);
    });
    await step('feedback (orderBy desc + limit)', async () => {
      await db.addRatingFeedback(uid, { movieId: 1, movieTitle: 'A', aiRating: 'GREEN', feedback: 'up', note: 'first' });
      await new Promise(r => setTimeout(r, 5));
      await db.addRatingFeedback(uid, { movieId: 2, movieTitle: 'B', aiRating: 'RED', feedback: 'down', note: 'second' });
      const fb = await db.getUserRatingFeedback(uid, 1);
      assert.equal(fb.length, 1);
      assert.equal(fb[0].note, 'second');
    });
    await step('chat history', async () => {
      await db.saveChatHistory(uid, [{ role: 'user', content: 'hi' }]);
      assert.equal((await db.getChatHistory(uid)).length, 1);
      await db.clearChatHistory(uid);
      assert.deepEqual(await db.getChatHistory(uid), []);
    });
    await step('recommendations (large nested doc)', async () => {
      const big = Array.from({ length: 5 }, (_, i) => ({ movie: { id: i }, triggers: Array.from({ length: 280 }, (_, j) => ({ topic: `topic ${j}`, yes: '1', no: '2' })) }));
      await db.saveRecommendations(uid, big);
      assert.equal((await db.getRecommendations(uid)).movies.length, 5);
    });
    await step('notifications (where + count + batch update)', async () => {
      await db.addNotification(uid, { type: 't', title: 'one', body: 'b' });
      await db.addNotification(uid, { type: 't', title: 'two', body: 'b' });
      assert.equal(await db.getUnreadNotificationCount(uid), 2);
      const [first] = await db.getNotifications(uid);
      await db.markNotificationsRead(uid, [first.id, 'does-not-exist']);
      assert.equal(await db.getUnreadNotificationCount(uid), 1);
      await db.markNotificationsRead(uid, null);
      assert.equal(await db.getUnreadNotificationCount(uid), 0);
    });
    await step('reports + consent + export', async () => {
      await db.addTriggerReport(uid, { movieId: 1, movieTitle: 'A', note: 'missing spider' });
      await db.recordConsent(uid, 'v1', 'text');
      const data = await db.exportUserData(uid);
      assert.equal(data.triggerReports.length, 1);
      assert.equal(data.consents.length, 1);
      assert.equal(data.savedRatings.length, 1);
    });
    await step('account deletion (recursive)', async () => {
      await db.deleteUserData(uid);
      const data = await db.exportUserData(uid);
      assert.equal(data.profile, null);
      for (const k of ['watchlist', 'ratingFeedback', 'triggerReports', 'notifications', 'savedRatings', 'consents']) assert.equal(data[k].length, 0, k);
    });
    console.log(`\nAll ${steps.length} Firestore checks passed.`);
  } finally {
    await cleanup();
    console.log(`Cleaned up ${process.env.FIRESTORE_PREFIX}* collections.`);
  }
}

main().then(() => process.exit(0)).catch(err => { console.error('\n✗ FAILED:', err.message); process.exit(1); });
