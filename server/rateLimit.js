// In-memory rate limits and daily budgets.
// Single-process only: counters reset on restart and aren't shared between
// instances — fine for one Render instance, move to Redis/DB if you scale out.
// Limits are passed as functions so they're read at call time (tests and
// config changes take effect without rebuilding the middleware).

function slidingWindowLimiter({ windowMs, max, keyFn, message }) {
  const hits = new Map(); // key → timestamps inside the window
  return (req, res, next) => {
    const now = Date.now();
    const key = keyFn(req);
    const recent = (hits.get(key) || []).filter(t => now - t < windowMs);
    if (recent.length >= max()) {
      res.set('Retry-After', String(Math.ceil((windowMs - (now - recent[0])) / 1000)));
      return res.status(429).json({ error: message, code: 'RATE_LIMITED' });
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) {
      for (const [k, ts] of hits) if (!ts.some(t => now - t < windowMs)) hits.delete(k);
    }
    next();
  };
}

// Counts per UTC day, per user and overall. tryConsume() returns false
// (and consumes nothing) once either limit is reached.
function dailyBudget({ perUser, overall }) {
  let day = null;
  const counts = new Map();
  return {
    tryConsume(uid) {
      const today = new Date().toISOString().slice(0, 10);
      if (today !== day) { day = today; counts.clear(); }
      const all = counts.get('*') || 0;
      const mine = uid ? counts.get(uid) || 0 : 0;
      if (all >= overall() || (uid && mine >= perUser())) return false;
      counts.set('*', all + 1);
      if (uid) counts.set(uid, mine + 1);
      return true;
    },
  };
}

module.exports = { slidingWindowLimiter, dailyBudget };
