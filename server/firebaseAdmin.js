// server/firebaseAdmin.js
// Uses the modular firebase-admin API (v12+) instead of the old namespaced
// require('firebase-admin') style, which doesn't reliably expose .apps in
// CommonJS on newer versions of the package.

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
}

const auth = getAuth();
module.exports = { auth };
