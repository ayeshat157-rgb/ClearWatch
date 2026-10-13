// src/lib/api.ts
// Service layer connecting the ClearWatch frontend to the Express backend.
// Backend runs at http://localhost:5000 (per server/index.js).
// Shapes below are taken directly from your actual index.js + App.js — confirmed, not guessed.

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

// Carries the server's own error message (e.g. rate limits, "AI is busy")
// so the UI can show something actionable instead of a bare status code.
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
  /** Worth showing to the user as-is: busy / rate-limited / daily cap. */
  get isUserFacing(): boolean {
    return this.status === 429 || this.status === 503;
  }
}

async function apiError(res: Response, fallback: string): Promise<ApiError> {
  try {
    const body = await res.json();
    if (typeof body?.error === "string") return new ApiError(body.error, res.status);
  } catch { /* not JSON */ }
  return new ApiError(`${fallback}: ${res.status}`, res.status);
}

// ─── Health check ──────────────────────────────────────────────────────────
export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/`);
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Search ────────────────────────────────────────────────────────────────
// GET /api/movies/search?query=inception
// index.js just forwards TMDb's raw search response, which wraps results
// in a `results` array.
export interface TmdbSearchResult {
  id: number;
  title: string;
  release_date: string; // "2010-07-15"
  poster_path: string | null;
  overview: string;
}

export async function searchMovies(query: string, signal?: AbortSignal): Promise<TmdbSearchResult[]> {
  const res = await fetch(
    `${API_URL}/api/movies/search?query=${encodeURIComponent(query)}`,
    { signal }
  );
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  const data = await res.json();
  return data.results ?? [];
}

// ─── Rate ──────────────────────────────────────────────────────────────────
// POST /api/movies/:id/rate  { userProfile }
// Returns { movie, triggers, rating } — confirmed from your actual code.
export interface TmdbMovieDetail {
  id: number;
  title: string;
  release_date: string;
  overview: string;
  runtime: number;
  poster_path: string | null;
  vote_average: number;
  genres: { id: number; name: string }[];
}

export interface DDDTrigger {
  topic: string;
  yes: string; // e.g. "12" — comes from the scraped page as text, not a number
  no: string;
}

export interface AIRating {
  // INSUFFICIENT_DATA: the server couldn't verify enough to call it safe —
  // no community data, no profile, or one of the user's categories unverified.
  rating: "GREEN" | "YELLOW" | "RED" | "INSUFFICIENT_DATA";
  reason?: "no_data" | "no_profile" | "partial_data";
  explanation: string; // spoiler-safe, category-level summary — safe to show by default
  details?: string; // AI prose naming specific triggers — only behind a deliberate tap
  topTriggers: string[]; // specific DDD topics (specifics)
  matchPct: number | null; // 0-100; null when there isn't enough data to score
  coverage?: {
    confirmed: string[]; clear: string[]; unverified: string[];
    evidence?: Record<string, { topic: string; yes: number; no: number }[]>;
  };
}

export interface RateResponse {
  movie: TmdbMovieDetail;
  triggers: DDDTrigger[];
  rating: AIRating;
}

// Matches UserProfile in App.tsx and profileToText() in server/index.js.
// A plain string still works too (that's what the old CRA test app sends).
export interface StructuredProfile {
  profileType?: string | null;
  languageStyle?: string | null;
  visualSensitivities?: string[];
  audioSensitivities?: string[];
  triggers?: string[];
  religiousCultural?: string[];
  strictness?: number;
  kidsMode?: boolean;
}

export async function rateMovie(
  tmdbId: number | string,
  userProfile: string | StructuredProfile
): Promise<RateResponse> {
  const res = await fetch(`${API_URL}/api/movies/${tmdbId}/rate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ userProfile }),
  });
  if (!res.ok) throw await apiError(res, "Rating failed");
  return res.json();
}

// ─── Profile (requires real sign-in — see lib/firebase.ts) ─────────────────
import { auth } from "./firebase";

async function authHeader(): Promise<Record<string, string>> {
  const token = await auth.currentUser?.getIdToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function loadProfile(): Promise<StructuredProfile | null> {
  const res = await fetch(`${API_URL}/api/profile`, { headers: await authHeader() });
  if (!res.ok) throw new Error(`Failed to load profile: ${res.status}`);
  const data = await res.json();
  return data.profile;
}

export async function saveProfile(profile: StructuredProfile): Promise<void> {
  const res = await fetch(`${API_URL}/api/profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ profile }),
  });
  if (!res.ok) throw new Error(`Failed to save profile: ${res.status}`);
}

// ─── Watchlist ───────────────────────────────────────────────────────────
// These take/return the already-adapted frontend Movie shape (see
// rateResponseToMovie below) since the backend stores exactly what you send.
export async function getWatchlist<T = unknown>(): Promise<T[]> {
  const res = await fetch(`${API_URL}/api/watchlist`, { headers: await authHeader() });
  if (!res.ok) throw new Error(`Failed to load watchlist: ${res.status}`);
  const data = await res.json();
  return data.movies ?? [];
}

export async function addToWatchlist(movie: unknown): Promise<void> {
  const res = await fetch(`${API_URL}/api/watchlist`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ movie }),
  });
  if (!res.ok) throw new Error(`Failed to add to watchlist: ${res.status}`);
}

export async function removeFromWatchlist(movieId: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/watchlist/${encodeURIComponent(movieId)}`, {
    method: "DELETE",
    headers: await authHeader(),
  });
  if (!res.ok) throw new Error(`Failed to remove from watchlist: ${res.status}`);
}

// ─── Recommendations ─────────────────────────────────────────────────────
// Can take 15-20s+ the first time in a 24h window (rating real movies) —
// instant on repeat calls since the backend caches the result.
export async function getRecommendations(): Promise<RateResponse[]> {
  const res = await fetch(`${API_URL}/api/recommendations`, { headers: await authHeader() });
  if (!res.ok) throw new Error(`Failed to load recommendations: ${res.status}`);
  const data = await res.json();
  return data.movies ?? [];
}

// ─── Collections ─────────────────────────────────────────────────────────
// Not personalized, no sign-in required — auto-generated from whatever's
// already in the shared trigger cache.
export interface CollectionMovie {
  id: number;
  title: string;
  release_date: string;
  poster_path: string | null;
}

export async function getCollections(): Promise<Record<string, CollectionMovie[]>> {
  const res = await fetch(`${API_URL}/api/collections`);
  if (!res.ok) throw new Error(`Failed to load collections: ${res.status}`);
  const data = await res.json();
  return data.collections ?? {};
}

// ─── Chat Assistant ──────────────────────────────────────────────────────
export interface ChatMessageInput { role: "user" | "assistant"; content: string; }
export interface ChatResponse {
  reply: string;
  ratedMovies: RateResponse[]; // movies the assistant actually looked up + rated
  suggestedMovies: TmdbSearchResult[]; // movies just suggested, not yet rated — click to check
}

// Sends only the new message — the server keeps the conversation history.
export async function sendChatMessage(message: string): Promise<ChatResponse> {
  const res = await fetch(`${API_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) throw await apiError(res, "Chat failed");
  return res.json();
}

export async function loadChatHistory(): Promise<ChatMessageInput[]> {
  const res = await fetch(`${API_URL}/api/chat/history`, { headers: await authHeader() });
  if (!res.ok) throw new Error(`Failed to load chat history: ${res.status}`);
  const data = await res.json();
  return data.history ?? [];
}

export async function clearChatHistory(): Promise<void> {
  const res = await fetch(`${API_URL}/api/chat/history`, {
    method: "DELETE",
    headers: await authHeader(),
  });
  if (!res.ok) throw new Error(`Failed to clear chat history: ${res.status}`);
}

// ─── Rating feedback (👍/👎) ─────────────────────────────────────────────
export async function submitRatingFeedback(
  movieId: string, movieTitle: string, aiRating: string, feedback: "up" | "down", note?: string
): Promise<void> {
  const res = await fetch(`${API_URL}/api/rating-feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ movieId, movieTitle, aiRating, feedback, note: note || "" }),
  });
  if (!res.ok) throw new Error(`Failed to submit feedback: ${res.status}`);
}

// ─── Report a missing/incorrect trigger ─────────────────────────────────
export async function reportMissingTrigger(movieId: string, movieTitle: string, note: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/report-trigger`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ movieId, movieTitle, note }),
  });
  if (!res.ok) throw new Error(`Failed to submit report: ${res.status}`);
}

// ─── Delete account ──────────────────────────────────────────────────────
// Wipes server-side data (profile, watchlist, caches). Deleting the actual
// Firebase auth account itself happens separately, client-side.
export async function deleteAccountData(): Promise<void> {
  const res = await fetch(`${API_URL}/api/account`, {
    method: "DELETE",
    headers: await authHeader(),
  });
  if (!res.ok) throw new Error(`Failed to delete account: ${res.status}`);
}

// ─── Consent + data export ───────────────────────────────────────────────
// The consent text comes from the server so what the user sees is exactly
// what gets recorded against their account.
export async function getConsentText(): Promise<{ version: string; text: string }> {
  const res = await fetch(`${API_URL}/api/consent`);
  if (!res.ok) throw await apiError(res, "Failed to load consent text");
  return res.json();
}

export async function recordConsent(version: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/consent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ version }),
  });
  if (!res.ok) throw await apiError(res, "Failed to record consent");
}

// Downloads everything the server stores about the user as a JSON file.
export async function downloadMyData(): Promise<void> {
  const res = await fetch(`${API_URL}/api/account/export`, { headers: await authHeader() });
  if (!res.ok) throw await apiError(res, "Failed to export data");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = "clearwatch-my-data.json";
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Notifications ───────────────────────────────────────────────────────────
export interface AppNotification {
  id: string; // Firestore document ID
  type: string;
  title: string;
  body: string;
  movieId?: string | null;
  movieTitle?: string | null;
  posterPath?: string | null;
  read: boolean;
  createdAt: string;
}

export async function getNotifications(): Promise<{ notifications: AppNotification[]; unreadCount: number }> {
  const res = await fetch(`${API_URL}/api/notifications`, { headers: await authHeader() });
  if (!res.ok) throw new Error(`Failed to load notifications: ${res.status}`);
  return res.json();
}

export async function markNotificationsRead(ids?: string[]): Promise<void> {
  const res = await fetch(`${API_URL}/api/notifications/read`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ ids: ids ?? null }),
  });
  if (!res.ok) throw new Error(`Failed to mark notifications read: ${res.status}`);
}


// ─── Adapters: backend shape → frontend's Movie/Trigger types ──────────────
// Converts the real API response into the shape App.tsx's mock MOVIES array uses.

const RATING_MAP: Record<AIRating["rating"], "safe" | "caution" | "avoid" | "unknown"> = {
  GREEN: "safe",
  YELLOW: "caution",
  RED: "avoid",
  INSUFFICIENT_DATA: "unknown",
};

const TMDB_IMG_BASE = "https://image.tmdb.org/t/p/w500";

export function tmdbResultToCard(r: TmdbSearchResult) {
  return {
    id: String(r.id),
    title: r.title,
    year: r.release_date ? Number(r.release_date.slice(0, 4)) : 0,
    posterUrl: r.poster_path ? `${TMDB_IMG_BASE}${r.poster_path}` : null,
  };
}

export function rateResponseToMovie(r: RateResponse) {
  return {
    id: String(r.movie.id),
    title: r.movie.title,
    year: r.movie.release_date ? Number(r.movie.release_date.slice(0, 4)) : 0,
    genre: r.movie.genres?.map((g) => g.name).join(", ") ?? "",
    runtime: r.movie.runtime
      ? `${Math.floor(r.movie.runtime / 60)}h ${r.movie.runtime % 60}m`
      : "",
    mediaType: "movie" as const,
    posterUrl: r.movie.poster_path ? `${TMDB_IMG_BASE}${r.movie.poster_path}` : null,
    gradient: "linear-gradient(135deg,#334155 0%,#1e293b 100%)", // fallback bg behind the real poster image
    rating: RATING_MAP[r.rating.rating] ?? "unknown",
    matchPct: r.rating.matchPct ?? null, // null when there isn't enough data to score
    unverified: r.rating.coverage?.unverified ?? [],
    aiNote: r.rating.explanation,
    details: r.rating.details ?? "",
    triggers: coverageToTriggers(r.rating),
  };
}

// One row per category the user cares about. The label (the user's own
// category) is spoiler-safe; the note lists the specific community-reported
// topics and is only shown once the user taps "Show specifics".
function coverageToTriggers(rating: AIRating) {
  const cov = rating.coverage;
  const describe = (e: { topic: string; yes: number; no: number }) =>
    e.yes || e.no ? `${e.topic} (${e.yes} yes / ${e.no} no)` : e.topic;
  if (!cov) {
    return (rating.topTriggers ?? []).map((topic, i) => ({
      id: `${i}-${topic}`, label: topic, emoji: "⚠️", level: RATING_MAP[rating.rating], note: "",
    }));
  }
  const confirmedLevel: "avoid" | "caution" = rating.rating === "RED" ? "avoid" : "caution";
  return [
    ...cov.confirmed.map(label => ({
      id: `confirmed-${label}`, label, emoji: "⚠️", level: confirmedLevel, badge: "Confirmed",
      note: `Reported by the community: ${(cov.evidence?.[label] ?? []).map(describe).join(" · ")}`,
    })),
    ...cov.clear.map(label => ({
      id: `clear-${label}`, label, emoji: "✓", level: "safe" as const, badge: "Not reported",
      note: `Checked by the community and not reported: ${(cov.evidence?.[label] ?? []).map(describe).join(" · ")}`,
    })),
  ];
}