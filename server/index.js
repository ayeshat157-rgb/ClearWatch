require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const puppeteer = require('puppeteer');
const Groq = require('groq-sdk');
const { getCachedTriggers, saveCachedTriggers, getProfile, saveProfile, getWatchlist, addToWatchlist, removeFromWatchlist, getRecommendations, saveRecommendations, cacheMovieSummary, getAllCachedEntries, getCachedRating, saveCachedRating, addTriggerReport, deleteUserData, addRatingFeedback, getUserRatingFeedback, getChatHistory, saveChatHistory, clearChatHistory, getNotifications, addNotification, markNotificationsRead, getUnreadNotificationCount } = require('./database');
const verifyAuth = require('./verifyAuth');
const crypto = require('crypto');

function hashProfile(profileText, feedbackHistory = []) {
  const feedbackStr = JSON.stringify(feedbackHistory || []);
  return crypto.createHash('sha1').update(profileText + feedbackStr).digest('hex');
}

const app = express();
app.use(cors());
app.use(express.json());

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

let globalBrowser = null;

async function getBrowser() {
  if (globalBrowser && globalBrowser.isConnected()) {
    return globalBrowser;
  }
  try {
    if (globalBrowser) {
      await globalBrowser.close().catch(() => {});
    }
  } catch (_) {}

  globalBrowser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu'
    ]
  });
  return globalBrowser;
}

// Scrape trigger data from Does the Dog Die
async function scrapeTriggers(dddId) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );
    await page.goto(`https://www.doesthedogdie.com/media/${dddId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000
    });

    try {
      await page.waitForSelector('.topicRow', { timeout: 8000 });
    } catch {
      // if it never appears, the loop below just returns an empty array
    }

    const triggers = await page.evaluate(() => {
      const items = [];
      document.querySelectorAll('.topicRow').forEach((el) => {
        const name = el.querySelector('.name')?.textContent?.trim();
        const yes = el.querySelector('.yes .count')?.textContent?.trim();
        const no = el.querySelector('.no .count')?.textContent?.trim();
        if (name) items.push({ topic: name, yes: yes || '0', no: no || '0' });
      });
      return items;
    });

    if (triggers.length === 0) {
      console.warn(`[scrapeTriggers] WARNING: 0 triggers extracted for DDD ID ${dddId}. Possible Cloudflare block or DOM change.`);
    }

    return triggers;
  } finally {
    await page.close().catch(() => {});
  }
}

// Find Does the Dog Die's internal ID via their search endpoint. This needs
// a real (headless) browser, not a plain HTTP request — Cloudflare blocks
// bare requests to this endpoint with a JS challenge, but a real browser
// executing JS clears it automatically (same reason scrapeTriggers() below
// already uses Puppeteer instead of axios).
// Find Does the Dog Die's internal ID using their real API (free tier
// covers this lookup fine — matched directly by TMDb ID, no fuzzy title
// matching needed at all, and no Cloudflare issue since this is a proper
// API endpoint, not the site's search page).
async function getDDDId(tmdbId) {
  try {
    const res = await axios.get(
      `https://www.doesthedogdie.com/api/v3/items?tmdb=${tmdbId}`,
      { headers: { 'X-API-KEY': process.env.DDD_API_KEY } }
    );
    const movies = res.data.filter(i => i.itemTypeName === 'Movie');
    return movies[0]?.id || null;
  } catch (err) {
    // Kept: makes a bad/missing API key or lookup failure obvious in the
    // logs instead of silently returning null with no explanation.
    console.error(
      `DDD API lookup failed for TMDb ID ${tmdbId}:`,
      err.response?.status, err.response?.data || err.message
    );
    return null;
  }
}

// NEW: Firestore-cache-first wrapper around the scraper. Checks Firestore
// before touching Puppeteer at all, and saves after a fresh scrape.
async function getTriggers(tmdbId) {
  const cached = await getCachedTriggers(tmdbId);
  if (cached) return cached;
  const dddId = await getDDDId(tmdbId);
  if (!dddId) return [];
  const triggers = await scrapeTriggers(dddId);
  await saveCachedTriggers(tmdbId, triggers);
  return triggers;
}

function profileToText(userProfile) {
  if (typeof userProfile === 'string') return userProfile;
  if (!userProfile || typeof userProfile !== 'object') return 'No specific preferences provided.';

  const parts = [];
  if (userProfile.profileType) parts.push(`Profiling for: ${userProfile.profileType}.`);
  if (Array.isArray(userProfile.visualSensitivities) && userProfile.visualSensitivities.length) {
    parts.push(`Visual sensitivities: ${userProfile.visualSensitivities.join(', ')}.`);
  }
  if (Array.isArray(userProfile.audioSensitivities) && userProfile.audioSensitivities.length) {
    parts.push(`Audio sensitivities: ${userProfile.audioSensitivities.join(', ')}.`);
  }
  if (Array.isArray(userProfile.triggers) && userProfile.triggers.length) {
    parts.push(`Specific triggers to flag: ${userProfile.triggers.join(', ')}.`);
  }
  if (Array.isArray(userProfile.religiousCultural) && userProfile.religiousCultural.length) {
    parts.push(`Religious/cultural preferences: ${userProfile.religiousCultural.join(', ')}.`);
  }
  if (userProfile.languageStyle) parts.push(`Prefers ${userProfile.languageStyle} language in explanations.`);

  // Strictness: defaults to 60 (balanced) if never set, matching the UI's default slider position.
  const strictness = typeof userProfile.strictness === 'number' ? userProfile.strictness : 60;
  if (strictness < 33) {
    parts.push(`Strictness preference: LENIENT (${strictness}/100). Only flag significant, major, or frequently-confirmed concerns. Do not lower the rating for minor, brief, or rarely-confirmed triggers — err toward GREEN/YELLOW unless something is clearly serious.`);
  } else if (strictness < 66) {
    parts.push(`Strictness preference: BALANCED (${strictness}/100). Weigh triggers by severity and how strongly they're confirmed — use reasonable judgment rather than flagging every minor mention.`);
  } else {
    parts.push(`Strictness preference: VERY STRICT (${strictness}/100). Flag any matching trigger regardless of how minor or infrequently confirmed — err toward caution.`);
  }

  if (userProfile.kidsMode) {
    parts.push('KIDS MODE IS ON — apply extra-strict, child-safety-oriented filtering regardless of the strictness slider above. Treat any mature content as a significant concern.');
  }

  return parts.length ? parts.join(' ') : 'No specific preferences provided.';
}

function triggerYesCount(t) { return parseInt((t.yes || '0').replace(/\D/g, ''), 10) || 0; }
function triggerNoCount(t) { return parseInt((t.no || '0').replace(/\D/g, ''), 10) || 0; }

// Keyword map: user-facing trigger label → words likely to appear in DDD topic names.
// Used to filter the full DDD list down to only what the user selected.
const TRIGGER_KEYWORD_MAP = {
  // Violence & Physical Harm
  'domestic violence / abuse':           ['domestic', 'abuse', 'partner', 'violence'],
  'self-harm or suicide':                ['self-harm', 'suicide', 'self harm', 'suicid'],
  'graphic gore / dismemberment':        ['gore', 'gory', 'dismember', 'blood', 'graphic violence', 'graphic injury'],
  'animal cruelty or death':             ['animal', 'dog', 'cat', 'pet', 'horse', 'bird', 'fish', 'deer', 'bug', 'insect'],
  // Sexual & Interpersonal Trauma
  'sexual content & nudity':             ['sex', 'nudity', 'nude', 'sexual content', 'explicit'],
  'sexual assault references':           ['rape', 'sexual assault', 'non-consensual', 'assault'],
  'relationship manipulation':           ['manipulation', 'gaslighting', 'emotional abuse', 'coercion'],
  'infidelity storylines':               ['infidel', 'affair', 'cheating', 'unfaithful'],
  // Legacy items (kept for backward compat)
  'sexual assault or non-consensual content': ['rape', 'sexual assault', 'non-consensual'],
  'child abuse or neglect':              ['child abuse', 'child neglect', 'child harm', 'minor'],
  'emotional abuse or gaslighting':      ['gaslighting', 'emotional abuse', 'manipulation'],
  // Addiction & Substance Use
  'active drug use / needle depiction':  ['drug', 'needle', 'inject', 'heroin', 'meth', 'cocaine', 'substance'],
  'alcoholism / heavy drinking':         ['alcohol', 'drink', 'drunk', 'drinking', 'beer', 'wine', 'whiskey'],
  'eating disorders / body dysmorphia behaviors': ['eating disorder', 'anorexia', 'bulimia', 'body image', 'vomit'],
  // Common Phobias
  'bugs / insects (spiders, snakes, etc.)': ['spider', 'snake', 'insect', 'bug', 'worm', 'rodent', 'rat', 'mouse'],
  'claustrophobia (being trapped, buried alive)': ['claustro', 'trap', 'buried', 'confined', 'enclosed'],
  'vomiting / emetophobia':              ['vomit', 'puke', 'sick', 'nausea'],
  'medical settings (hospitals, needles, surgeries)': ['hospital', 'needle', 'surgery', 'medical', 'doctor', 'blood'],
  // Visual / audio (passed through from profileText already, but kept here for future use)
  'flashing lights / strobe effects':    ['flash', 'strobe', 'epilep', 'seizure'],
  'shaky camera / intense color contrast': ['shaky', 'camera', 'motion sick', 'handheld'],
  'sudden, high-volume jump scares / loud noises': ['jump scare', 'jumpscare', 'loud', 'startle'],
  'misophonia triggers (e.g., chewing, whispering, scratching sounds)': ['chewing', 'whisper', 'scratch', 'misophonia'],
  'high-pitched frequencies or screaming': ['scream', 'high-pitch', 'shriek'],
};

/**
 * Given the full DDD trigger list and the user's selected trigger labels,
 * return only the DDD entries that match at least one of the user's selections.
 * Falls back to the full list if the user selected nothing (so the prompt is
 * still useful for general-purpose ratings).
 */
function filterTriggersToUserProfile(allTriggers, selectedTriggers) {
  if (!selectedTriggers || selectedTriggers.length === 0) return allTriggers;

  // Build a flat set of lowercase keywords the user cares about
  const wantedKeywords = new Set();
  for (const sel of selectedTriggers) {
    const keywords = TRIGGER_KEYWORD_MAP[sel.toLowerCase()] || [sel.toLowerCase()];
    keywords.forEach(k => wantedKeywords.add(k.toLowerCase()));
  }

  return allTriggers.filter(t => {
    const topic = (t.topic || '').toLowerCase();
    for (const kw of wantedKeywords) {
      if (topic.includes(kw)) return true;
    }
    return false;
  });
}

// Generate personalized rating using Claude / Groq
async function generateRating(movie, triggers, profileText, selectedTriggers, feedbackHistory = []) {
  // Only show the model triggers the user actually cares about
  const relevantTriggers = filterTriggersToUserProfile(triggers, selectedTriggers);

  const triggersText = relevantTriggers
    .filter(t => triggerYesCount(t) > 0 && triggerYesCount(t) >= triggerNoCount(t)) // drop stray single votes contradicted by consensus
    .sort((a, b) => triggerYesCount(b) - triggerYesCount(a)) // strongest-confirmed first
    .slice(0, 20) // cap so the prompt stays focused
    .map(t => `- ${t.topic}: ${triggerYesCount(t)} yes / ${triggerNoCount(t)} no`)
    .join('\n');

  // Tell the model exactly which triggers the user cares about so it reasons precisely
  const userTriggerList = selectedTriggers && selectedTriggers.length
    ? `\nThe user has specifically flagged these as personal triggers they want warned about: ${selectedTriggers.join(', ')}.\nYour rating, explanation, and topTriggers MUST focus exclusively on whether any of these appear — ignore content the user did not select.`
    : '';

  // Format historical feedback to calibrate personalized strictness
  let feedbackText = '';
  if (Array.isArray(feedbackHistory) && feedbackHistory.length > 0) {
    const formatted = feedbackHistory.map(f => {
      const icon = f.feedback === 'up' ? 'AGREED (👍)' : 'DISAGREED (👎)';
      const noteStr = f.note ? ` — User note: "${f.note}"` : '';
      return `- Rated "${f.movieTitle}" as ${f.aiRating} → User ${icon}${noteStr}`;
    }).join('\n');
    feedbackText = `\n\nUSER HISTORICAL RATING FEEDBACK & CALIBRATION:\nThis user has previously provided feedback on AI safety ratings:\n${formatted}\n\nCALIBRATION INSTRUCTIONS:\n- Take this feedback into account when deciding the rating color, strictness, and explanation for this title.\n- If the user previously felt ratings were too strict or disagreed with specific flags, calibrate your strictness accordingly.`;
  }

  // Wrap the Groq call in a 30s timeout so a hung request doesn't
  // lock up the server indefinitely. Also detect TPM rate-limit (429)
  // and surface a specific error code the frontend can display gracefully.
  let completion;
  try {
    const timeoutMs = 30_000;
    completion = await Promise.race([
      client.chat.completions.create({
        model: GROQ_MODEL,
        max_tokens: 350,
        temperature: 0,
        messages: [{
          role: 'user',
          content: `You are ClearWatch, a personalized content safety assistant.

Movie: ${movie.title} (${movie.release_date?.split('-')[0]})
Overview: ${movie.overview}

User sensitivity profile: ${profileText}${userTriggerList}${feedbackText}

Confirmed triggers in this movie that match the user's selected sensitivities (from community-reported data):
${triggersText || 'None of the user\'s selected triggers were confirmed in available data — this is likely safe for them.'}

Base your answer ONLY on the trigger data above — do not rely on general knowledge or assumptions about this movie beyond what's given here. If the data is sparse, say so honestly rather than guessing.

Based on the user's profile and the trigger data, provide:
1. A color rating: GREEN (safe), YELLOW (some concerns), or RED (avoid)
2. A 2-3 sentence personalized explanation — explicitly reference the user's actual stated sensitivities by name and connect them to specific triggers found (or note their absence). Avoid generic, boilerplate phrasing.
3. The top 3 specific triggers most relevant to this user, chosen ONLY from the confirmed trigger list above — never invent one that isn't in that list
4. A match percentage (0-100) for how well this movie fits this specific user's stated preferences overall — 100 means a perfect fit (nothing they're sensitive to appears), 0 means it's full of exactly what they want to avoid. This should be consistent with the rating: GREEN should generally be 70-100, YELLOW roughly 30-70, RED roughly 0-30 — but use the actual severity/frequency of matching triggers to place it precisely within that band, not just the midpoint.

Respond with ONLY valid JSON, no other text, in this exact format:
{
  "rating": "GREEN/YELLOW/RED",
  "explanation": "your explanation here",
  "topTriggers": ["trigger1", "trigger2", "trigger3"],
  "matchPct": 85
}`
        }]
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('GROQ_TIMEOUT')), timeoutMs)
      ),
    ]);
  } catch (err) {
    if (err.message === 'GROQ_TIMEOUT') {
      console.error('[generateRating] Groq API timed out after 30s for:', movie.title);
      const e = new Error('AI rating timed out — please try again in a moment.');
      e.code = 'GROQ_TIMEOUT';
      throw e;
    }
    // Groq 429 = TPM limit exceeded on free tier
    if (err.status === 429 || err.response?.status === 429) {
      console.error('[generateRating] Groq 429 TPM limit hit for:', movie.title);
      const e = new Error('AI is busy right now (rate limit) — please try again in a minute.');
      e.code = 'GROQ_RATE_LIMIT';
      throw e;
    }
    throw err; // re-throw anything else unchanged
  }

  const rawText = completion.choices[0].message.content.trim();

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    parsed = JSON.parse(cleaned);
  }

  // Fallback if the model ever omits matchPct or returns something malformed —
  // a rough band based on the rating color, so the UI never breaks.
  const FALLBACK_MATCH = { GREEN: 85, YELLOW: 50, RED: 15 };
  if (typeof parsed.matchPct !== 'number' || parsed.matchPct < 0 || parsed.matchPct > 100) {
    parsed.matchPct = FALLBACK_MATCH[parsed.rating] ?? 50;
  }

  return parsed;
}

// Test route
app.get('/', (req, res) => {
  res.json({ message: 'ClearWatch API is running!' });
});

// Search movies
app.get('/api/movies/search', async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: 'Missing query parameter' });
  try {
    const response = await axios.get(
      `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}`
    );
    res.json(response.data);
  } catch (error) {
    if (error.response?.status === 429) {
      console.warn('[search] TMDb rate limit (429) — backing off');
      return res.status(503).json({ error: 'Search service temporarily busy — please try again in a moment.', retryAfter: 10 });
    }
    console.error('Search error:', error.message);
    res.status(500).json({ error: 'Failed to fetch movies' });
  }
});

const tmdbCache = new Map();
async function getTmdbMovie(id) {
  if (tmdbCache.has(id)) return tmdbCache.get(id);
  const tmdbRes = await axios.get(
    `https://api.themoviedb.org/3/movie/${id}?api_key=${TMDB_API_KEY}`
  );
  const data = tmdbRes.data;
  tmdbCache.set(id, data);
  if (tmdbCache.size > 500) {
    const firstKey = tmdbCache.keys().next().value;
    tmdbCache.delete(firstKey);
  }
  return data;
}

// Get movie details + triggers + AI rating
app.post('/api/movies/:id/rate', verifyAuth, async (req, res) => {
  const { id } = req.params;
  const { userProfile } = req.body;
  try {
    const movie = await getTmdbMovie(id);
    await cacheMovieSummary(id, movie); // NEW: so Collections can list this movie later

    // NEW: cache-first, so a movie only ever gets scraped once
    const triggers = await getTriggers(id);

    const profileText = profileToText(userProfile);
    const feedbackHistory = await getUserRatingFeedback(req.uid);
    const profileHash = hashProfile(profileText, feedbackHistory);

    // NEW: same movie + same exact profile → same cached answer, instantly,
    // instead of re-asking Claude (and getting a slightly different answer).
    let rating = await getCachedRating(req.uid, id, profileHash);
    if (!rating) {
      rating = await generateRating(movie, triggers, profileText, userProfile?.triggers || [], feedbackHistory);
      await saveCachedRating(req.uid, id, profileHash, rating);
    }

    res.json({ movie, triggers, rating });
  } catch (error) {
    if (error.response?.status === 429) {
      console.warn(`[rate] TMDb rate limit (429) for movie ${id}`);
      return res.status(503).json({ error: 'Rating service temporarily busy — please try again in a moment.', retryAfter: 10 });
    }
    if (error.code === 'GROQ_TIMEOUT' || error.code === 'GROQ_RATE_LIMIT') {
      return res.status(503).json({ error: error.message, code: error.code });
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to rate movie' });
  }
});

// NEW: load the signed-in user's saved profile
app.get('/api/profile', verifyAuth, async (req, res) => {
  try {
    const profile = await getProfile(req.uid);
    res.json({ profile });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

// NEW: save the signed-in user's profile (called when onboarding finishes,
// or whenever they edit their sensitivity profile in Settings)
app.post('/api/profile', verifyAuth, async (req, res) => {
  try {
    await saveProfile(req.uid, req.body.profile);
    // Notify: profile updated
    try {
      await addNotification(req.uid, {
        type: 'profile_update',
        title: '✅ Profile updated',
        body: 'Your sensitivity profile has been saved. Recommendations will reflect your new preferences.',
      });
    } catch (_) { /* best-effort */ }
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to save profile' });
  }
});

// NEW: watchlist — list, add, remove. All per signed-in user.
app.get('/api/watchlist', verifyAuth, async (req, res) => {
  try {
    const movies = await getWatchlist(req.uid);
    res.json({ movies });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load watchlist' });
  }
});

app.post('/api/watchlist', verifyAuth, async (req, res) => {
  try {
    const { movie } = req.body;
    if (!movie || !movie.id) return res.status(400).json({ error: 'Missing movie' });
    await addToWatchlist(req.uid, movie);
    // Notify: watchlist addition
    try {
      await addNotification(req.uid, {
        type: 'watchlist_add',
        title: '📌 Added to watchlist',
        body: `"${movie.title || 'Untitled'}" has been saved to your watchlist.`,
        movieId: String(movie.id),
        movieTitle: movie.title || null,
        posterPath: movie.poster_path || movie.posterUrl || null,
      });
    } catch (_) { /* best-effort */ }
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to add to watchlist' });
  }
});

app.delete('/api/watchlist/:id', verifyAuth, async (req, res) => {
  try {
    await removeFromWatchlist(req.uid, req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to remove from watchlist' });
  }
});

const RECOMMENDATION_MAX_AGE_MS = 1000 * 60 * 60 * 24; // 24 hours
const RECOMMENDATION_COUNT = 5;

// NEW: home dashboard recommendations. Pulls TMDb's trending list and rates
// a handful of them for this user. Slow the first time (each unrated movie
// needs a real scrape) — cached afterward so it's instant on repeat visits.
app.get('/api/recommendations', verifyAuth, async (req, res) => {
  try {
    const cached = await getRecommendations(req.uid);
    const isFresh = cached && (Date.now() - new Date(cached.generatedAt).getTime()) < RECOMMENDATION_MAX_AGE_MS;
    if (isFresh) return res.json({ movies: cached.movies, cached: true });

    const userProfile = await getProfile(req.uid);
    const profileText = profileToText(userProfile);
    const feedbackHistory = await getUserRatingFeedback(req.uid);
    const trendingRes = await axios.get(
      `https://api.themoviedb.org/3/trending/movie/week?api_key=${TMDB_API_KEY}`
    );
    const candidates = trendingRes.data.results.slice(0, RECOMMENDATION_COUNT);

    const candidatePromises = candidates.map(async (c) => {
      const movie = await getTmdbMovie(c.id);
      await cacheMovieSummary(c.id, movie);
      const triggers = await getTriggers(c.id);
      const rating = await generateRating(movie, triggers, profileText, userProfile?.triggers || [], feedbackHistory);
      return { movie, triggers, rating };
    });

    const settled = await Promise.allSettled(candidatePromises);
    const results = [];
    let failCount = 0;
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        results.push(r.value);
      } else {
        failCount++;
        console.error(`[recommendations] Skipping movie failure (${failCount} failures so far):`, r.reason?.message || r.reason);
      }
    }

    if (failCount > 0 && failCount >= Math.ceil(candidates.length / 2)) {
      console.warn(`[recommendations] Degraded: ${failCount}/${candidates.length} candidates failed. Likely a Groq or TMDb issue.`);
      // Still return what we have — the frontend degrades gracefully with partial results.
    }

    await saveRecommendations(req.uid, results);

    // Generate notifications for new safe picks
    const safePicks = results.filter(r => r.rating?.rating === 'GREEN');
    if (safePicks.length > 0) {
      const pick = safePicks[0];
      try {
        await addNotification(req.uid, {
          type: 'new_safe_pick',
          title: '🟢 New safe pick for you!',
          body: `"${pick.movie.title}" is a great match for your profile — check it out.`,
          movieId: String(pick.movie.id),
          movieTitle: pick.movie.title,
          posterPath: pick.movie.poster_path,
        });
      } catch (notifErr) {
        console.warn('[recommendations] Failed to create notification:', notifErr.message);
      }
    }

    res.json({ movies: results, cached: false });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load recommendations' });
  }
});

// NEW: Curated Collections — auto-generated from whatever's already in the
// trigger cache. Not personalized (no auth needed): same for every visitor.
// Grows over time as more movies get searched/rated across all users.
function triggerFlagged(t) {
  return parseInt((t.yes || '0').replace(/\D/g, ''), 10) > 0;
}

const COLLECTION_RULES = {
  'no-animal':  /animal|dog/i,
  'gore-free':  /gore|graphic violence|dismember|mutilat/i,
  'anxiety':    /panic attack|jump scare|claustrophob/i,
  'family':     /sex|nudity|drug use|alcohol|gore|graphic violence|abuse|rape/i,
  // Rough proxy only (absence of alcohol/drug/sex/nudity triggers) — not a
  // substitute for real religious-content review. Flag this to whoever owns
  // that collection before treating it as authoritative.
  'muslim':     /alcohol|drinking|drug use|sex scene|nudity/i,
};

app.get('/api/collections', async (req, res) => {
  try {
    const entries = await getAllCachedEntries(); // [{ movie, triggers }]
    const collections = {};
    for (const [id, pattern] of Object.entries(COLLECTION_RULES)) {
      collections[id] = entries
        .filter(e => !e.triggers.some(t => pattern.test(t.topic) && triggerFlagged(t)))
        .map(e => e.movie);
    }
    res.json({ collections });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load collections' });
  }
});

// NEW: report a missing/incorrect trigger — just logged for later review
app.post('/api/report-trigger', verifyAuth, async (req, res) => {
  try {
    const { movieId, movieTitle, note } = req.body;
    if (!movieId || !note) return res.status(400).json({ error: 'Missing movieId or note' });
    await addTriggerReport(req.uid, { movieId, movieTitle, note });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to submit report' });
  }
});

// NEW: delete all of a user's stored data (profile, watchlist, caches).
// Does NOT delete the Firebase auth account itself — that happens
// client-side, since it requires the user's own active session.
app.delete('/api/account', verifyAuth, async (req, res) => {
  try {
    await deleteUserData(req.uid);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete account data' });
  }
});

// ─── Chat Assistant ──────────────────────────────────────────────────────
// The model gets real tools instead of being asked to just chat about
// movies from general knowledge — it looks up actual TMDb/DDD data and
// runs the same rating pipeline as everywhere else in the app.

async function checkMovieSafetyTool(title, userProfile, uid) {
  const searchRes = await axios.get(
    `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}`
  );
  const match = searchRes.data.results?.[0];
  if (!match) return { found: false, message: `Couldn't find a movie called "${title}" on TMDb.` };

  const tmdbRes = await axios.get(`https://api.themoviedb.org/3/movie/${match.id}?api_key=${TMDB_API_KEY}`);
  const movie = tmdbRes.data;
  await cacheMovieSummary(match.id, movie);
  const triggers = await getTriggers(match.id);

  const profileText = profileToText(userProfile);
  const feedbackHistory = await getUserRatingFeedback(uid);
  const profileHash = hashProfile(profileText, feedbackHistory);
  let rating = await getCachedRating(uid, match.id, profileHash);
  if (!rating) {
    rating = await generateRating(movie, triggers, profileText, userProfile?.triggers || [], feedbackHistory);
    await saveCachedRating(uid, match.id, profileHash, rating);
  }

  return { found: true, movie, triggers, rating };
}

async function findSimilarMoviesTool(title) {
  const searchRes = await axios.get(
    `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}`
  );
  const match = searchRes.data.results?.[0];
  if (!match) return { found: false, message: `Couldn't find a movie called "${title}" on TMDb.` };

  const simRes = await axios.get(
    `https://api.themoviedb.org/3/movie/${match.id}/recommendations?api_key=${TMDB_API_KEY}`
  );
  const candidates = (simRes.data.results || []).slice(0, 8).map(m => ({
    id: m.id, title: m.title, release_date: m.release_date, poster_path: m.poster_path, overview: m.overview,
  }));
  return { found: true, baseMovie: match.title, candidates };
}

const CHAT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'check_movie_safety',
      description: "Look up a specific movie's real, confirmed content triggers and generate this user's personalized safety rating for it. Use this whenever the user asks about a named title, e.g. 'Is there animal death in Inception?' or 'Is Encanto safe for my kid?'. Never answer questions like this from general knowledge — always call this tool.",
      parameters: {
        type: 'object',
        properties: { title: { type: 'string', description: 'The movie or show title' } },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_similar_movies',
      description: "Find real movies similar to a given title (e.g. 'find something like The Dark Knight'). Returns candidate titles from TMDb. If the user wants a safety comparison too (e.g. 'but less violent'), call check_movie_safety on the most promising candidates afterward.",
      parameters: {
        type: 'object',
        properties: { title: { type: 'string', description: 'The movie to find similar titles to' } },
        required: ['title'],
      },
    },
  },
];

app.post('/api/chat', verifyAuth, async (req, res) => {
  try {
    const { messages } = req.body; // [{ role: 'user'|'assistant', content: string }, ...]
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Missing messages' });
    }

    // Token optimization: Slide window to keep only the last N (e.g., 6) messages
    const SLIDING_WINDOW_SIZE = 6;
    const windowedMessages = messages.slice(-SLIDING_WINDOW_SIZE);

    const userProfile = await getProfile(req.uid);
    const profileText = profileToText(userProfile);

    const systemPrompt = `You are ClearWatch's AI assistant — a friendly, concise content-safety helper.

This user's sensitivity profile: ${profileText}

You have tools to look up real movie safety data and find similar movies. Always use them when the user names a specific title or gives you one to work from — never invent trigger information or guess from general knowledge about a movie. If the request is vague with no title to go on (e.g. "suggest some safe movies"), don't guess a pile of random titles to check — instead ask one short clarifying question first, like what genre they're in the mood for or a movie they already liked. Keep answers to 2-4 sentences, warm and spoiler-free.`;

    const convo = [{ role: 'system', content: systemPrompt }, ...windowedMessages];
    const ratedMovies = [];
    const suggestedMovies = [];

    for (let round = 0; round < 3; round++) { // cap tool-call rounds to avoid runaway loops
      const completion = await client.chat.completions.create({
        model: GROQ_MODEL,
        temperature: 0.4,
        max_tokens: 600,
        messages: convo,
        tools: CHAT_TOOLS,
      });

      const choice = completion.choices[0].message;
      const toolCalls = choice.tool_calls;

      if (!toolCalls || toolCalls.length === 0) {
        // Save history including the new assistant message
        const finalMessages = [...messages, { role: 'assistant', content: choice.content }];
        await saveChatHistory(req.uid, finalMessages);
        return res.json({ reply: choice.content, ratedMovies, suggestedMovies });
      }

      convo.push(choice);

      for (const call of toolCalls) {
        let args = {};
        try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* leave empty */ }

        let compactForModel;
        try {
          if (call.function.name === 'check_movie_safety') {
            const result = await checkMovieSafetyTool(args.title, userProfile, req.uid);
            if (result.found) {
              ratedMovies.push({ movie: result.movie, triggers: result.triggers, rating: result.rating });
              // Compact summary only — NOT the full triggers array or full TMDb
              // object, which blew past Groq's per-minute token limit when the
              // model checked several movies in one round.
              compactForModel = {
                found: true,
                title: result.movie.title,
                year: result.movie.release_date?.slice(0, 4),
                rating: result.rating.rating,
                matchPct: result.rating.matchPct,
                explanation: result.rating.explanation,
                topTriggers: result.rating.topTriggers,
              };
            } else {
              compactForModel = result;
            }
          } else if (call.function.name === 'find_similar_movies') {
            const result = await findSimilarMoviesTool(args.title);
            if (result.found) {
              suggestedMovies.push(...result.candidates);
              // Titles + years only for the model — full overviews aren't needed
              // and add up fast across 8 candidates.
              compactForModel = {
                found: true,
                baseMovie: result.baseMovie,
                candidates: result.candidates.map(c => ({ title: c.title, year: c.release_date?.slice(0, 4) })),
              };
            } else {
              compactForModel = result;
            }
          } else {
            compactForModel = { error: 'Unknown tool' };
          }
        } catch (toolErr) {
          // One flaky lookup (e.g. a scrape timeout) shouldn't kill the
          // whole response — let the model know this one failed and
          // continue with whatever else succeeded in this round.
          console.error(`Chat tool call "${call.function.name}" failed:`, toolErr.message);
          compactForModel = { found: false, message: `Couldn't check "${args.title}" right now — the source may be slow or unavailable. Mention this to the user briefly rather than guessing.` };
        }
        convo.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(compactForModel) });
      }
    }

    // Fallback if loop finishes without a clean response
    const fallbackReply = "I found some information but I'm having a little trouble putting it together — could you try asking again?";
    const finalMessages = [...messages, { role: 'assistant', content: fallbackReply }];
    await saveChatHistory(req.uid, finalMessages);
    res.json({
      reply: fallbackReply,
      ratedMovies, suggestedMovies,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to get a response' });
  }
});

app.get('/api/chat/history', verifyAuth, async (req, res) => {
  try {
    const history = await getChatHistory(req.uid);
    res.json({ history });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load chat history' });
  }
});

app.delete('/api/chat/history', verifyAuth, async (req, res) => {
  try {
    await clearChatHistory(req.uid);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to clear chat history' });
  }
});

// NEW: 👍/👎 feedback on a rating — the real RL signal from the original spec
app.post('/api/rating-feedback', verifyAuth, async (req, res) => {
  try {
    const { movieId, movieTitle, aiRating, feedback, note } = req.body;
    if (!movieId || (feedback !== 'up' && feedback !== 'down')) {
      return res.status(400).json({ error: 'Missing movieId or invalid feedback value' });
    }
    await addRatingFeedback(req.uid, { movieId, movieTitle, aiRating, feedback, note: note || '' });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to save feedback' });
  }
});

// ─── Notifications ────────────────────────────────────────────────────────────

// GET /api/notifications — return all notifications for current user
app.get('/api/notifications', verifyAuth, async (req, res) => {
  try {
    const notifications = await getNotifications(req.uid);
    const unreadCount = await getUnreadNotificationCount(req.uid);
    res.json({ notifications, unreadCount });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});

// POST /api/notifications/read — mark notifications as read (all, or specific IDs)
app.post('/api/notifications/read', verifyAuth, async (req, res) => {
  try {
    const { ids } = req.body; // optional array of IDs; omit to mark all read
    await markNotificationsRead(req.uid, ids ?? null);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to mark notifications read' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`ClearWatch server running on port ${PORT}`);
});