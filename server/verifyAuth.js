// server/verifyAuth.js
// Verifies a real Firebase ID token sent by the frontend after email/password
// login — replaces the old dev-only "trust any X-User-Id header" version.

const { auth } = require('./firebaseAdmin');

async function verifyAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing auth token' });
  try {
    const decoded = await auth.verifyIdToken(token);
    req.uid = decoded.uid;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = verifyAuth;
