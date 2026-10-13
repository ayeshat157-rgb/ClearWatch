// ClearWatch evaluation harness.
//
// Measures how often the evidence pipeline misses a trigger that is really
// there — the failure a trauma-safety product can't ship. Uses real DDD data
// (cache first, then the API — so it spends API budget on uncached titles).
//
//   npm run eval                          # verified labels only
//   npm run eval -- --include-unverified  # also draft labels
//   npm run eval -- --with-ai             # also run the full rating (uses Groq)
//   npm run eval -- --fail-on-miss        # exit 1 on any dangerous miss (for CI)
//
// Writes eval/results/latest.json and eval/results/latest.md.

const fs = require('fs');
const path = require('path');

const args = new Set(process.argv.slice(2));
const includeUnverified = args.has('--include-unverified');
const withAi = args.has('--with-ai');
const failOnMiss = args.has('--fail-on-miss');

// Don't start the HTTP server or touch auth — we only need the pipeline.
const { getTriggers, assessCoverage, rateForUser, LIMITS } = require('../index');
const { getCachedTriggers } = require('../database');

// DDD allows 30 calls/minute; an uncached title costs 2, so pace those.
const DDD_PACE_MS = 4500;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const axios = require('axios');

const labels = JSON.parse(fs.readFileSync(path.join(__dirname, 'labels.json'), 'utf8'));
const cases = labels.cases.filter(c => c.verified || includeUnverified);

// Outcome of the evidence pipeline for one category.
function predict(coverage, label) {
  if (coverage.confirmed.includes(label)) return 'present';
  if (coverage.clear.includes(label)) return 'absent';
  return 'unknown';
}

function classify(expected, predicted) {
  if (expected === 'present') {
    if (predicted === 'present') return 'caught';
    if (predicted === 'absent') return 'DANGEROUS_MISS'; // told them it's not there
    return 'safe_miss';                                   // said "not enough data"
  }
  if (predicted === 'present') return 'false_alarm';
  if (predicted === 'absent') return 'correct_clear';
  return 'unknown_clear';
}

async function main() {
  if (!cases.length) {
    console.log('No cases to run. Verify labels in eval/labels.json (verified: true) or pass --include-unverified.');
    process.exit(0);
  }
  // The eval is an operator task: let it past the per-user/day caps, but it
  // still counts against DDD's monthly quota.
  LIMITS.userDailyLookups = LIMITS.overallDailyLookups = Math.max(LIMITS.overallDailyLookups, cases.length);

  const rows = [];
  for (const c of cases) {
    const label = c.category;
    const wasCached = !!(await getCachedTriggers(c.tmdbId));
    const triggers = await getTriggers(c.tmdbId);
    if (!wasCached) await sleep(DDD_PACE_MS);
    const coverage = assessCoverage(triggers, [label]);
    const predicted = triggers.length ? predict(coverage, label) : 'unknown';
    const row = {
      title: c.title, tmdbId: c.tmdbId, category: label, expected: c.expected, verified: !!c.verified,
      predicted, outcome: classify(c.expected, predicted),
      evidence: (coverage.evidence?.[label] || []).map(e => `${e.topic} ${e.yes}/${e.no}`).join('; ') || (triggers.length ? 'no matching topic' : 'no DDD data'),
    };
    if (withAi && triggers.length) {
      const movie = (await axios.get(`https://api.themoviedb.org/3/movie/${c.tmdbId}?api_key=${process.env.TMDB_API_KEY}`)).data;
      const rating = await rateForUser(movie, triggers, { triggers: [label] });
      row.aiRating = rating.rating;
      // Product-level failure: a GREEN on something that is really there.
      row.productMiss = c.expected === 'present' && rating.rating === 'GREEN';
    }
    rows.push(row);
    console.log(`${row.outcome.padEnd(15)} ${c.title} — ${label} (expected ${c.expected}, got ${predicted})${row.aiRating ? ` [AI: ${row.aiRating}]` : ''}`);
  }

  const count = o => rows.filter(r => r.outcome === o).length;
  const present = rows.filter(r => r.expected === 'present').length;
  const absent = rows.length - present;
  const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : 'n/a');
  const summary = {
    runAt: new Date().toISOString(),
    cases: rows.length,
    unverifiedIncluded: rows.filter(r => !r.verified).length,
    present, absent,
    caught: count('caught'),
    dangerousMisses: count('DANGEROUS_MISS'),
    safeMisses: count('safe_miss'),
    falseAlarms: count('false_alarm'),
    falseNegativeRate: pct(count('DANGEROUS_MISS'), present),
    recall: pct(count('caught'), present),
    falseAlarmRate: pct(count('false_alarm'), absent),
    ...(withAi ? { productMisses: rows.filter(r => r.productMiss).length } : {}),
  };

  const outDir = path.join(__dirname, 'results');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'latest.json'), JSON.stringify({ summary, rows }, null, 2));
  const md = [
    `# ClearWatch evaluation — ${summary.runAt.slice(0, 10)}`,
    '',
    summary.unverifiedIncluded ? `> ⚠️ ${summary.unverifiedIncluded} of ${summary.cases} cases use draft (unverified) labels — not publishable.` : '> All labels human-verified.',
    '',
    '| Metric | Value |', '|---|---|',
    `| Cases | ${summary.cases} (${present} present, ${absent} absent) |`,
    `| **False-negative rate** (present, but told "not reported") | **${summary.falseNegativeRate}** (${summary.dangerousMisses}) |`,
    `| Recall (present and caught) | ${summary.recall} |`,
    `| Safe misses (present, "not enough data") | ${summary.safeMisses} |`,
    `| False alarms | ${summary.falseAlarmRate} (${summary.falseAlarms}) |`,
    ...(withAi ? [`| Product misses (present but rated GREEN) | ${summary.productMisses} |`] : []),
    '', '| Outcome | Movie | Category | Expected | Got | Evidence |', '|---|---|---|---|---|---|',
    ...rows.map(r => `| ${r.outcome} | ${r.title} | ${r.category} | ${r.expected} | ${r.predicted}${r.aiRating ? ` (AI: ${r.aiRating})` : ''} | ${r.evidence} |`),
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'latest.md'), md + '\n');

  console.log('\n' + JSON.stringify(summary, null, 2));
  process.exit(failOnMiss && summary.dangerousMisses > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
