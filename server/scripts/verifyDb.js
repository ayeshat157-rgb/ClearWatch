const { getDb } = require('../db');
getDb().then(db => db.all("SELECT name FROM sqlite_master WHERE type='table'"))
  .then(rows => { console.log('Tables:', rows.map(r => r.name).join(', ')); process.exit(0); })
  .catch(err => { console.error(err); process.exit(1); });
