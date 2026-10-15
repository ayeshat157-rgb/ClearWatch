// Builds a human review sheet for topicMap.json (topicMap.review.md) and
// checks every mapped ID against DDD's live topic catalogue.
//
//   npm run topicmap:report      (1 DDD API call)
//
// Reviewers read the sheet, edit topicMap.json, set reviewed: true per
// category, then re-run this to refresh the sheet.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Older topics that still carry votes on movies but are no longer listed in
// /api/v3/topics (found by comparing cached movie data with the catalogue).
const KNOWN_UNLISTED = {
  156: 'the main character dies', 160: 'the mom dies', 252: "there's a dead animal", 259: 'someone says "I\'ll kill myself"',
  267: "there's excessive gore", 275: 'someone overdoses', 281: 'someone asphyxiates', 286: 'Someone attempts suicide',
  292: 'someone is sexually assaulted onscreen', 326: 'sexual assault is mentioned',
};

async function main() {
  const { categories } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'topicMap.json'), 'utf8'));
  const res = await axios.get('https://www.doesthedogdie.com/api/v3/topics', {
    headers: { 'X-API-KEY': process.env.DDD_API_KEY, Accept: 'application/json' },
  });
  const catalogue = new Map(res.data.map(t => [String(t.id), t]));
  const nameOf = id => catalogue.get(id)?.name ?? KNOWN_UNLISTED[id];

  const problems = [];
  const used = new Set();
  const entries = Object.entries(categories);
  const lines = [
    '# ClearWatch topic map — review sheet',
    '',
    `Generated ${new Date().toISOString().slice(0, 10)} from \`server/topicMap.json\` and ${res.data.length} DDD topics.`,
    '',
    '**How to review a category:** read its two lists and ask:',
    '- *Core* — is every topic really this category? A majority "yes" on any of them marks the category **Confirmed**, and enough "no" votes on them mark it **clear**.',
    '- *Related* — these only hint at it: reports show **Mixed reports**, never Confirmed, and they never clear the category.',
    '- Anything missing? Check **Unassigned topics** at the bottom.',
    '',
    'Then edit `topicMap.json` (move/add/remove IDs) and set `"reviewed": true` for that category.',
    '',
  ];

  const reviewed = entries.filter(([, c]) => c.reviewed).length;
  lines.push(`**Progress: ${reviewed} of ${entries.length} categories reviewed.**`, '');

  for (const [label, c] of entries) {
    lines.push(`## ${c.reviewed ? '✅' : '☐'} ${label}`);
    if (c.sameAs) { lines.push('', `Same lists as **${c.sameAs}** (${c.notes || 'alias'}).`, ''); continue; }
    for (const role of ['core', 'related']) {
      const ids = Object.keys(c[role] || {});
      lines.push('', `**${role === 'core' ? 'Core' : 'Related'}** (${ids.length})`);
      if (!ids.length) lines.push('- *(none)*');
      for (const id of ids) {
        used.add(id);
        const live = nameOf(id);
        const flag = !live ? ' ⚠️ unknown ID' : !catalogue.has(id) ? ' *(older topic, not in catalogue)*' : '';
        if (!live) problems.push(`${label}: unknown topic ID ${id}`);
        else if (live !== c[role][id]) problems.push(`${label}: ${id} is now called "${live}" (map says "${c[role][id]}")`);
        lines.push(`- \`${id}\` ${live ?? c[role][id]}${flag}`);
      }
    }
    if (c.notes) lines.push('', `> ${c.notes}`);
    lines.push('');
  }

  const unassigned = res.data.filter(t => !used.has(String(t.id))).sort((a, b) => a.name.localeCompare(b.name));
  lines.push('## Unassigned topics', '', `${unassigned.length} DDD topics aren't in any category. Most are intentional (e.g. "the ending is sad"), but scan for anything a category should include.`, '');
  lines.push(unassigned.map(t => `\`${t.id}\` ${t.name}`).join(' · '), '');

  if (problems.length) lines.splice(6, 0, '> ⚠️ **Problems found:**', ...problems.map(p => `> - ${p}`), '');

  const out = path.join(__dirname, '..', 'topicMap.review.md');
  fs.writeFileSync(out, lines.join('\n'));
  console.log(`Wrote ${path.relative(process.cwd(), out)} — ${reviewed}/${entries.length} reviewed, ${unassigned.length} unassigned topics, ${problems.length} problems.`);
  if (problems.length) { console.log(problems.join('\n')); process.exitCode = 1; }
}

main().catch(err => { console.error(err.message); process.exit(1); });
