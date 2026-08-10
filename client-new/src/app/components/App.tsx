import { useState, useRef, useEffect } from "react";
import {
  searchMovies as apiSearchMovies,
  rateMovie as apiRateMovie,
  tmdbResultToCard,
  rateResponseToMovie,
  loadProfile,
  saveProfile,
  getWatchlist as apiGetWatchlist,
  addToWatchlist as apiAddToWatchlist,
  removeFromWatchlist as apiRemoveFromWatchlist,
  getRecommendations as apiGetRecommendations,
  getCollections as apiGetCollections,
  reportMissingTrigger as apiReportMissingTrigger,
  deleteAccountData,
  sendChatMessage,
  submitRatingFeedback,
  loadChatHistory,
  clearChatHistory,
  getNotifications,
  markNotificationsRead,
  type AppNotification,
  type TmdbSearchResult,
  type CollectionMovie,
} from "../../lib/api";
import { signUp, logIn, logOut, deleteFirebaseAccount } from "../../lib/firebase";
import {
  Home, Search, Bookmark, MessageCircle, User, Bell, Shield,
  ChevronRight, ChevronDown, ChevronUp, X, ArrowLeft,
  ThumbsUp, ThumbsDown, Share2, Send, Check, Moon, Sun,
  SlidersHorizontal, Flag, RotateCcw, Baby, Sparkles,
  TrendingUp, Play, Eye, EyeOff, Settings, LogOut, Menu,
  Film, Tv, Plus, Star, Zap, Heart, Clock, Trash2
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────
type AppView = "landing" | "onboarding" | "app";
type Tab = "home" | "search" | "chat" | "watchlist" | "profile";
type Rating = "safe" | "caution" | "avoid";
interface Trigger { id: string; label: string; emoji: string; level: Rating; note: string; }
interface Movie {
  id: string; title: string; year: number; genre: string; runtime: string;
  mediaType: "movie" | "tv"; gradient: string; rating: Rating;
  matchPct: number; aiNote: string; triggers: Trigger[]; posterUrl?: string | null;
}
interface ChatMsg {
  id: string; role: "user" | "ai"; text: string;
  ratedMovies?: Movie[]; suggestedMovies?: TmdbSearchResult[];
}

// ─── Rating config ────────────────────────────────────────────────────────────
const RC = {
  safe: { label: "Safe for You", icon: "✓", bg: "#16A34A", soft: "#DCFCE7", softText: "#14532D", glow: "rgba(22,163,74,0.25)" },
  caution: { label: "Use Caution", icon: "!", bg: "#D97706", soft: "#FEF3C7", softText: "#78350F", glow: "rgba(217,119,6,0.25)" },
  avoid: { label: "Not Recommended", icon: "✕", bg: "#DC2626", soft: "#FEE2E2", softText: "#7F1D1D", glow: "rgba(220,38,38,0.25)" },
} as const;

// ─── Data ────────────────────────────────────────────────────────────────────
const MOVIES: Movie[] = [
  {
    id: "inside-out-2", title: "Inside Out 2", year: 2024, genre: "Animation", runtime: "1h 40m", mediaType: "movie",
    gradient: "linear-gradient(135deg,#FDE68A 0%,#FB923C 50%,#EC4899 100%)",
    rating: "safe", matchPct: 96,
    aiNote: "A near-perfect match. Anxiety is a main character here — shown with warmth, humor, and real empathy. No violence, sexual content, or substance use. Riley's journey through big emotions is gentle and affirming.",
    triggers: [
      { id: "anxiety", label: "Anxiety as Theme", emoji: "😰", level: "safe", note: "Anxiety is depicted as a natural emotion — treated with empathy, never mocked or vilified" },
      { id: "language", label: "Language", emoji: "🗣️", level: "safe", note: "Completely family-safe throughout" },
    ],
  },
  {
    id: "barbie", title: "Barbie", year: 2023, genre: "Comedy", runtime: "1h 54m", mediaType: "movie",
    gradient: "linear-gradient(135deg,#FBCFE8 0%,#EC4899 55%,#9D174D 100%)",
    rating: "safe", matchPct: 88,
    aiNote: "Playful, feminist, and sharply funny. Light existential themes about identity and mortality are handled with humor and warmth. Minimal mature content — a great pick for most of your triggers.",
    triggers: [
      { id: "sexual", label: "Sexual Content", emoji: "🔞", level: "safe", note: "Suggestive humor only; nothing explicit. The film is notably modest." },
      { id: "language", label: "Language", emoji: "🗣️", level: "safe", note: "Mild language throughout" },
      { id: "anxiety", label: "Existential Themes", emoji: "😰", level: "caution", note: "Brief themes of mortality and identity — treated lightly and resolved warmly" },
    ],
  },
  {
    id: "coco", title: "Coco", year: 2017, genre: "Animated Family", runtime: "1h 45m", mediaType: "movie",
    gradient: "linear-gradient(135deg,#F97316 0%,#EF4444 45%,#7C3AED 100%)",
    rating: "safe", matchPct: 91,
    aiNote: "Warm, culturally vibrant, and deeply loving. Death is a theme, but treated with extraordinary care and beauty. One note: the Día de los Muertos tradition is spiritually central — not frightening, but present throughout.",
    triggers: [
      { id: "religious", label: "Cultural/Spiritual", emoji: "📖", level: "caution", note: "Mexican Día de los Muertos beliefs are woven throughout — spiritual but not frightening" },
      { id: "animaldeath", label: "Animal Characters", emoji: "🐾", level: "safe", note: "Dante is perfectly safe. No animal harm whatsoever." },
    ],
  },
  {
    id: "inception", title: "Inception", year: 2010, genre: "Sci-Fi Thriller", runtime: "2h 28m", mediaType: "movie",
    gradient: "linear-gradient(135deg,#1E3A5F 0%,#0A1628 55%,#1E3A5F 100%)",
    rating: "caution", matchPct: 73,
    aiNote: "A brilliant mind-bending thriller with moderate concerns. The layered dream sequences may intensify anxiety. Violence is present but purposeful — no gore. Substance use (sedatives) is thematically important.",
    triggers: [
      { id: "violence", label: "Action Violence", emoji: "⚔️", level: "caution", note: "Gun fights and combat throughout — no graphic gore" },
      { id: "anxiety", label: "Reality/Dream Themes", emoji: "😰", level: "caution", note: "Disorienting structure may intensify reality-based anxiety" },
      { id: "substances", label: "Sedative Use", emoji: "💊", level: "caution", note: "Characters use sedatives to enter dreams — thematically central" },
    ],
  },
  {
    id: "oppenheimer", title: "Oppenheimer", year: 2023, genre: "Historical Drama", runtime: "3h 1m", mediaType: "movie",
    gradient: "linear-gradient(135deg,#475569 0%,#1E293B 100%)",
    rating: "caution", matchPct: 62,
    aiNote: "A towering cinematic achievement, but not without challenges. The existential weight of mass destruction may be anxiety-inducing. Two brief sexual scenes appear, and strong language is occasional throughout.",
    triggers: [
      { id: "sexual", label: "Sexual Content", emoji: "🔞", level: "caution", note: "Two brief, non-explicit scenes" },
      { id: "language", label: "Strong Language", emoji: "🗣️", level: "caution", note: "Occasional throughout" },
      { id: "violence", label: "War Imagery", emoji: "⚔️", level: "caution", note: "Explosion sequences; no graphic gore" },
      { id: "anxiety", label: "Existential Dread", emoji: "😰", level: "caution", note: "Heavy themes of moral consequence — sustained throughout" },
    ],
  },
  {
    id: "dune-2", title: "Dune: Part Two", year: 2024, genre: "Sci-Fi Epic", runtime: "2h 46m", mediaType: "movie",
    gradient: "linear-gradient(135deg,#D97706 0%,#92400E 55%,#1C1917 100%)",
    rating: "caution", matchPct: 71,
    aiNote: "A breathtaking visual epic with moderate content. Battle violence is significant but not gratuitous. Messianic and religious themes run deep. Minimal jumpscares — more sustained drama than shock.",
    triggers: [
      { id: "violence", label: "Battle Violence", emoji: "⚔️", level: "caution", note: "Large-scale battle sequences — intense but purposeful" },
      { id: "religious", label: "Messianic Themes", emoji: "📖", level: "caution", note: "Explores religious manipulation and false messianic prophecy" },
      { id: "sexual", label: "Sexual Content", emoji: "🔞", level: "safe", note: "One brief, tasteful scene" },
    ],
  },
  {
    id: "the-bear", title: "The Bear", year: 2022, genre: "Drama", runtime: "30 min / ep", mediaType: "tv",
    gradient: "linear-gradient(135deg,#9A3412 0%,#292524 100%)",
    rating: "caution", matchPct: 55,
    aiNote: "Critically acclaimed and intensely crafted — but deliberately overwhelming. The pacing is designed to stress you out. Based on your anxiety sensitivity, proceed with significant caution. Episode 6 (\"Review\") is an unrelenting 22-minute single take.",
    triggers: [
      { id: "language", label: "Strong Language", emoji: "🗣️", level: "avoid", note: "Extremely frequent — constant throughout every episode" },
      { id: "anxiety", label: "High-Stress Pacing", emoji: "😰", level: "avoid", note: "Intentional sensory overwhelm — designed to be exhausting" },
      { id: "substances", label: "Alcohol Addiction", emoji: "💊", level: "caution", note: "Addiction is a key character arc treated with honesty" },
      { id: "selfharm", label: "Suicide (Referenced)", emoji: "⚠️", level: "caution", note: "Suicide loss is referenced as important backstory" },
    ],
  },
  {
    id: "hereditary", title: "Hereditary", year: 2018, genre: "Horror", runtime: "2h 7m", mediaType: "movie",
    gradient: "linear-gradient(135deg,#1C1917 0%,#292524 40%,#44403C 100%)",
    rating: "avoid", matchPct: 12,
    aiNote: "Not recommended for your profile. One of the most psychologically disturbing horror films in recent memory. Contains graphic violence, deeply traumatic grief sequences, and imagery that many viewers find impossible to shake.",
    triggers: [
      { id: "violence", label: "Graphic Violence", emoji: "⚔️", level: "avoid", note: "Extremely disturbing — including a shocking depiction of sudden traumatic death" },
      { id: "anxiety", label: "Psychological Horror", emoji: "😰", level: "avoid", note: "Sustained dread and paranoia — designed to be traumatizing" },
      { id: "selfharm", label: "Suicide Depiction", emoji: "⚠️", level: "avoid", note: "Graphically depicted" },
      { id: "childdanger", label: "Severe Child Trauma", emoji: "🧒", level: "avoid", note: "A child's traumatic death is a central plot event" },
      { id: "religious", label: "Occult/Cult Themes", emoji: "📖", level: "avoid", note: "Deeply disturbing occult content throughout" },
    ],
  },
  {
    id: "saltburn", title: "Saltburn", year: 2023, genre: "Psychological Thriller", runtime: "2h 7m", mediaType: "movie",
    gradient: "linear-gradient(135deg,#57534E 0%,#0C0A09 100%)",
    rating: "avoid", matchPct: 18,
    aiNote: "Not recommended for your profile. Contains graphic sexual content, psychological manipulation as its central device, and several deeply unsettling sequences. Proceed only with clear-eyed preparation.",
    triggers: [
      { id: "sexual", label: "Graphic Sexual Content", emoji: "🔞", level: "avoid", note: "Explicit and deliberately provocative — not incidental" },
      { id: "anxiety", label: "Psychological Manipulation", emoji: "😰", level: "avoid", note: "Gaslighting and manipulation are the film's core mechanisms" },
      { id: "substances", label: "Drug Use", emoji: "💊", level: "caution", note: "Recreational drug use throughout" },
      { id: "selfharm", label: "Self-Harm / Suicide", emoji: "⚠️", level: "caution", note: "Depicted and referenced" },
    ],
  },
  {
    id: "everything", title: "Everything Everywhere", year: 2022, genre: "Sci-Fi Comedy", runtime: "2h 19m", mediaType: "movie",
    gradient: "linear-gradient(135deg,#7C3AED 0%,#1D4ED8 50%,#059669 100%)",
    rating: "caution", matchPct: 68,
    aiNote: "A wildly inventive, deeply emotional film about family, meaning, and nihilism. Some sequences are intentionally absurd and disorienting. The themes of meaninglessness may be difficult during low periods.",
    triggers: [
      { id: "violence", label: "Absurdist Violence", emoji: "⚔️", level: "caution", note: "Stylized, often comedic — not realistic or gory" },
      { id: "anxiety", label: "Existential Nihilism", emoji: "😰", level: "caution", note: "A character argues for the meaninglessness of existence" },
      { id: "selfharm", label: "Suicide Themes", emoji: "⚠️", level: "caution", note: "A character contemplates suicide — handled thoughtfully" },
    ],
  },
];

const COLLECTIONS = [
  { id: "no-animal", label: "No Animal Death", emoji: "🐾", from: "#059669", to: "#0D9488", count: 47 },
  { id: "family", label: "Family Friendly", emoji: "👨‍👩‍👧", from: "#2563EB", to: "#7C3AED", count: 83 },
  { id: "anxiety", label: "Safe for Anxiety", emoji: "🧘", from: "#7C3AED", to: "#EC4899", count: 61 },
  { id: "muslim", label: "Muslim-Friendly", emoji: "🌙", from: "#065F46", to: "#0D9488", count: 39 },
  { id: "gore-free", label: "No Gore", emoji: "✨", from: "#92400E", to: "#D97706", count: 54 },
];

const TRIGGER_CATS = [
  {
    id: "violence", label: "Violence & Physical Harm", emoji: "⚔️",
    items: ["Domestic violence / abuse", "Self-harm or suicide", "Graphic gore / dismemberment", "Animal cruelty or death"]
  },
  {
    id: "sexual", label: "Sexual & Interpersonal Trauma", emoji: "💔",
    items: ["Sexual content & nudity", "Sexual assault references", "Relationship manipulation", "Infidelity storylines"]
  },
  {
    id: "addiction", label: "Addiction & Substance Use", emoji: "💊",
    items: ["Active drug use / needle depiction", "Alcoholism / heavy drinking", "Eating disorders / body dysmorphia behaviors"]
  },
  {
    id: "phobias", label: "Common Phobias & Panic Triggers", emoji: "😰",
    items: ["Bugs / Insects (spiders, snakes, etc.)", "Claustrophobia (being trapped, buried alive)", "Vomiting / Emetophobia", "Medical settings (hospitals, needles, surgeries)"]
  },
];

const INITIAL_CHAT: ChatMsg[] = [
  { id: "1", role: "ai", text: "Hi! 👋 I'm your ClearWatch AI. I know your sensitivity profile and can look up real safety info for any movie or show. Try asking about a specific title, or ask me to find something similar to one you like." },
];

const SUGGESTED_PROMPTS = [
  "Is there animal death in Inception?",
  "Find something like The Dark Knight but less violent.",
  "Is Encanto safe for my 6-year-old?",
  "What horror films have no jumpscares?",
  "Is Saltburn safe for trauma survivors?",
];

// ─── Reusable components ─────────────────────────────────────────────────────

function SafeBadge({ rating, size = "sm" }: { rating: Rating; size?: "sm" | "md" | "lg" | "xl" }) {
  const r = RC[rating];
  const sz = {
    sm: "text-[10px] px-2 py-0.5 gap-0.5 font-bold",
    md: "text-xs px-3 py-1 gap-1 font-bold",
    lg: "text-sm px-4 py-1.5 gap-1.5 font-bold",
    xl: "text-base px-5 py-2 gap-2 font-bold",
  }[size];
  return (
    <span className={`inline-flex items-center rounded-full text-white ${sz}`} style={{ backgroundColor: r.bg }}>
      <span className="leading-none">{r.icon}</span>
      <span>{r.label}</span>
    </span>
  );
}

function MatchRing({ pct, rating, size = 64 }: { pct: number; rating: Rating; size?: number }) {
  const color = RC[rating].bg;
  const R = size / 2 - 5, circ = 2 * Math.PI * R, dash = (pct / 100) * circ;
  return (
    <div className="relative flex items-center justify-center flex-shrink-0" style={{ width: size, height: size }}>
      <svg className="absolute inset-0" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={R} fill="none" stroke="currentColor" strokeWidth="3" className="text-border" />
        <circle cx={size / 2} cy={size / 2} r={R} fill="none" stroke={color} strokeWidth="3"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div className="text-center">
        <div className="font-bold text-foreground leading-none" style={{ fontSize: size * 0.22 }}>{pct}%</div>
        <div className="text-muted-foreground leading-none mt-0.5" style={{ fontSize: size * 0.13 }}>match</div>
      </div>
    </div>
  );
}

function MovieCard({ movie, onClick, showTitle = true }: { movie: Movie; onClick: () => void; showTitle?: boolean }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      className="group w-full text-left overflow-hidden rounded-2xl shadow-lg transition-all duration-200 hover:scale-[1.03] hover:shadow-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <div className="aspect-[2/3] relative overflow-hidden" style={{ background: movie.gradient }}>
        {movie.posterUrl && (
          <img src={movie.posterUrl} alt={movie.title} className="absolute inset-0 w-full h-full object-cover" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
        <div className="absolute top-2.5 left-2.5"><SafeBadge rating={movie.rating} /></div>
        {movie.mediaType === "tv" && (
          <div className="absolute top-2.5 right-2.5 bg-black/60 text-white text-[9px] font-bold px-2 py-0.5 rounded-md tracking-widest">TV</div>
        )}
        <div className={`absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-2 transition-opacity duration-200 ${hovered ? "opacity-100" : "opacity-0"}`}>
          <div className="w-12 h-12 bg-white/90 rounded-full flex items-center justify-center shadow-lg">
            <Play size={20} className="text-black ml-1" />
          </div>
          <span className="text-white text-xs font-semibold">View Details</span>
        </div>
        {showTitle && (
          <div className="absolute bottom-0 left-0 right-0 p-3">
            <p className="text-white font-semibold text-sm leading-tight truncate">{movie.title}</p>
            <p className="text-white/50 text-[10px] mt-0.5">{movie.year} · {movie.genre}</p>
          </div>
        )}
      </div>
    </button>
  );
}

function SectionHeader({ title, action }: { title: string; action?: string }) {
  return (
    <div className="flex items-center justify-between mb-5">
      <h2 className="text-lg font-semibold text-foreground" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>{title}</h2>
      {action && <button className="text-xs font-medium text-primary hover:underline flex items-center gap-1">{action} <ChevronRight size={12} /></button>}
    </div>
  );
}

// ─── Landing Page ─────────────────────────────────────────────────────────────

// ─── Landing Page ─────────────────────────────────────────────────────────────

function LandingPage({ onGetStarted, onLogin }: { onGetStarted: () => void; onLogin: () => void }) {
  const HERO_MOVIES = [
    {
      id: "inside-out-2", title: "Inside Out 2", year: 2024, genre: "Animation", runtime: "1h 40m",
      rating: "safe" as Rating, matchPct: 96,
      posterUrl: "https://image.tmdb.org/t/p/w500/vpnVM9B6NMmQpEZaD0hKWtENuD6.jpg",
      aiNote: "Near-perfect match for your profile. Anxiety is explored with warmth and empathy. Zero graphic violence, sexual content, or substance abuse.",
      triggers: [{ id: "t1", label: "Anxiety Themes", emoji: "😰", level: "safe" as Rating, note: "Handled warmly" }, { id: "t2", label: "Family Safe", emoji: "✨", level: "safe" as Rating, note: "G-rated throughout" }]
    },
    {
      id: "barbie", title: "Barbie", year: 2023, genre: "Comedy", runtime: "1h 54m",
      rating: "safe" as Rating, matchPct: 88,
      posterUrl: "https://image.tmdb.org/t/p/w500/iuJuN2fvKhac3DhBPbdfeTMoFgZ.jpg",
      aiNote: "Playful and modest comedy. Light existential themes about identity handled with humor. Minimal mature content — highly compatible with your settings.",
      triggers: [{ id: "t3", label: "Mild Innuendo", emoji: "💬", level: "safe" as Rating, note: "Playful humor" }, { id: "t4", label: "Existential Humor", emoji: "🤔", level: "safe" as Rating, note: "Lighthearted" }]
    },
    {
      id: "inception", title: "Inception", year: 2010, genre: "Sci-Fi Thriller", runtime: "2h 28m",
      rating: "caution" as Rating, matchPct: 73,
      posterUrl: "https://image.tmdb.org/t/p/w500/ljsZTbVsrQSqovxOD2rT2tZ8t2.jpg",
      aiNote: "Mind-bending thriller. Action violence is present (gunfights/sedative drug references), but no graphic gore or gratuitous horror.",
      triggers: [{ id: "t5", label: "Action Violence", emoji: "⚔️", level: "caution" as Rating, note: "Gunfights throughout" }, { id: "t6", label: "Sedative Depiction", emoji: "💊", level: "caution" as Rating, note: "Plot point" }]
    }
  ];

  const [activeHeroMovie, setActiveHeroMovie] = useState(HERO_MOVIES[0]);
  const [authMode, setAuthMode] = useState<"login" | "signup" | null>(null);
  const [infoModal, setInfoModal] = useState<string | null>(null);

  // Live sandbox search state
  const [sandboxQuery, setSandboxQuery] = useState("");
  const [sandboxResults, setSandboxResults] = useState<TmdbSearchResult[]>([]);
  const [sandboxLoading, setSandboxLoading] = useState(false);
  const [sandboxSelected, setSandboxSelected] = useState<TmdbSearchResult | null>(null);

  async function handleSandboxSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!sandboxQuery.trim()) return;
    setSandboxLoading(true);
    try {
      const results = await apiSearchMovies(sandboxQuery);
      setSandboxResults(results.slice(0, 4));
      if (results.length > 0) setSandboxSelected(results[0]);
    } catch (err) {
      console.error("Sandbox search error:", err);
    } finally {
      setSandboxLoading(false);
    }
  }

  function scrollToSection(id: string) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth" });
  }

  const r = RC[activeHeroMovie.rating];

  return (
    <div className="min-h-screen text-slate-100 selection:bg-teal-500 selection:text-white" style={{ background: "linear-gradient(to bottom, #060D1A 0%, #0D1526 50%, #071020 100%)" }}>
      {/* Background glow effects */}
      <div className="fixed top-0 left-1/4 w-[700px] h-[700px] rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(76,184,166,0.1) 0%, transparent 70%)" }} />
      <div className="fixed bottom-1/3 right-10 w-[500px] h-[500px] rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 70%)" }} />

      {/* Header Navigation */}
      <nav className="sticky top-0 z-40 backdrop-blur-xl bg-[#060D1A]/80 flex items-center justify-between px-6 lg:px-16 py-4 border-b border-white/8 transition-all">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          <div className="w-9 h-9 bg-teal-500 rounded-xl flex items-center justify-center shadow-lg shadow-teal-500/25">
            <Shield size={20} className="text-white" />
          </div>
          <span className="font-semibold text-white text-xl tracking-tight" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>ClearWatch</span>
        </div>

        <div className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-300">
          <button onClick={() => scrollToSection("features")} className="hover:text-teal-400 transition-colors">Features</button>
          <button onClick={() => scrollToSection("how-it-works")} className="hover:text-teal-400 transition-colors">How It Works</button>
          <button onClick={() => scrollToSection("sandbox")} className="hover:text-teal-400 transition-colors">Try Demo</button>
          <button onClick={() => scrollToSection("about")} className="hover:text-teal-400 transition-colors">About</button>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={() => setAuthMode("login")} className="text-slate-300 hover:text-white text-sm font-semibold px-4 py-2 transition-colors">
            Log in
          </button>
          <button onClick={() => setAuthMode("signup")} className="bg-teal-500 hover:bg-teal-400 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-all shadow-lg shadow-teal-500/20 flex items-center gap-1.5 hover:scale-105 active:scale-95">
            Get started <ChevronRight size={16} />
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative max-w-7xl mx-auto px-6 lg:px-16 pt-16 pb-24 lg:pt-24 lg:pb-32">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          
          {/* Left Column */}
          <div className="lg:col-span-7">
            <div className="inline-flex items-center gap-2.5 bg-teal-500/10 text-teal-400 border border-teal-500/25 rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-wider mb-6 shadow-sm">
              <Sparkles size={14} />
              Personalized Trauma & Trigger Protection
            </div>

            <h1 className="text-5xl sm:text-6xl lg:text-7xl text-white leading-[1.08] mb-6" style={{ fontFamily: "'Fraunces', Georgia, serif", fontWeight: 500 }}>
              Watch movies with{" "}
              <span className="relative inline-block text-teal-400 font-serif italic">
                complete peace.
                <span className="absolute bottom-1 left-0 w-full h-1 bg-teal-500/30 rounded-full" />
              </span>
            </h1>

            <p className="text-slate-300 text-lg sm:text-xl leading-relaxed mb-8 max-w-xl font-normal">
              ClearWatch screens every movie & TV show against your personal trauma history, sensory sensitivities, phobias, and values — so you never get blindsided again.
            </p>

            <div className="flex flex-wrap items-center gap-4 mb-10">
              <button onClick={() => setAuthMode("signup")} className="bg-teal-500 hover:bg-teal-400 text-white font-semibold px-8 py-4 rounded-2xl transition-all shadow-xl shadow-teal-500/25 flex items-center gap-2 text-base hover:scale-105 active:scale-95">
                Build your free profile <ChevronRight size={20} />
              </button>
              <button onClick={() => scrollToSection("how-it-works")} className="text-slate-300 hover:text-white font-semibold px-7 py-4 border border-white/15 hover:border-white/30 rounded-2xl transition-all bg-white/5 backdrop-blur-sm text-base">
                How it works
              </button>
            </div>

            <div className="grid grid-cols-3 gap-4 pt-6 border-t border-white/8 text-slate-400 text-xs sm:text-sm">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center text-teal-400">🔒</div>
                <span>100% Encrypted & Private</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center text-teal-400">⚡</div>
                <span>AI-Powered Safety Engine</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center text-teal-400">🛡️</div>
                <span>Trauma-Informed Design</span>
              </div>
            </div>
          </div>

          {/* Right Column: Live Interactive Movie Card Preview */}
          <div className="lg:col-span-5 relative">
            <div className="relative border border-white/12 rounded-3xl p-6 shadow-2xl bg-[#0F1A2E]/90 backdrop-blur-xl">
              
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Click a title to preview:</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-teal-500/20 text-teal-400">Interactive Demo</span>
              </div>

              {/* 3 Real Movie Cards Switcher */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                {HERO_MOVIES.map(m => {
                  const isActive = m.id === activeHeroMovie.id;
                  return (
                    <button
                      key={m.id}
                      onClick={() => setActiveHeroMovie(m)}
                      className={`relative rounded-xl overflow-hidden text-left transition-all aspect-[2/3] border ${isActive ? "ring-2 ring-teal-400 border-teal-400 scale-105 z-10" : "opacity-75 hover:opacity-100 border-white/10"}`}
                      style={{ background: m.gradient }}
                    >
                      <img
                        src={m.posterUrl}
                        alt=""
                        onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
                        className="w-full h-full object-cover absolute inset-0 z-0"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent flex flex-col justify-end p-2.5 z-10">
                        <p className="text-white text-[11px] font-bold truncate mb-1">{m.title}</p>
                        <SafeBadge rating={m.rating} size="sm" />
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Selected Movie Detailed Preview Card */}
              <div className="rounded-2xl p-5 border border-white/10 bg-[#17253D] shadow-inner">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-teal-400">Personalized AI Evaluation</span>
                    <h3 className="text-white font-bold text-lg leading-tight">{activeHeroMovie.title}</h3>
                  </div>
                  <MatchRing pct={activeHeroMovie.matchPct} rating={activeHeroMovie.rating} size={48} />
                </div>

                <p className="text-slate-300 text-xs leading-relaxed mb-4">{activeHeroMovie.aiNote}</p>

                <div className="flex items-center justify-between pt-3 border-t border-white/8">
                  <div className="flex gap-2">
                    {activeHeroMovie.triggers.map(t => (
                      <span key={t.id} className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-full bg-white/8 text-slate-200">
                        <span>{t.emoji}</span> {t.label}
                      </span>
                    ))}
                  </div>
                  <button onClick={() => setAuthMode("signup")} className="text-xs font-semibold text-teal-400 hover:text-teal-300 flex items-center gap-1">
                    Rate my movies <ChevronRight size={12} />
                  </button>
                </div>
              </div>

            </div>
          </div>

        </div>
      </section>

      {/* Live Sandbox Search Section */}
      <section id="sandbox" className="relative max-w-5xl mx-auto px-6 py-16 my-8 border border-teal-500/20 rounded-3xl bg-gradient-to-b from-[#0E1B30] to-[#0A1324] shadow-2xl">
        <div className="text-center max-w-xl mx-auto mb-8">
          <span className="text-xs font-bold uppercase tracking-widest text-teal-400 mb-2 block">Instant Safety Sandbox</span>
          <h2 className="text-3xl sm:text-4xl text-white font-serif font-medium mb-3">Try looking up any movie right now</h2>
          <p className="text-slate-400 text-sm">Search any film in TMDb's database to test how ClearWatch analyzes media.</p>
        </div>

        <form onSubmit={handleSandboxSearch} className="max-w-xl mx-auto flex gap-3 mb-8">
          <div className="relative flex-1">
            <Search size={18} className="absolute left-4 top-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Enter a movie title (e.g., Gladiator, Shrek, Dune, Oppenheimer)..."
              value={sandboxQuery}
              onChange={e => setSandboxQuery(e.target.value)}
              className="w-full pl-11 pr-4 py-3.5 rounded-2xl bg-white/8 border border-white/15 text-white placeholder:text-slate-500 text-sm focus:outline-none focus:border-teal-400 transition-colors"
            />
          </div>
          <button type="submit" disabled={sandboxLoading} className="bg-teal-500 hover:bg-teal-400 text-white font-semibold px-6 py-3.5 rounded-2xl transition-all text-sm disabled:opacity-60">
            {sandboxLoading ? "Searching..." : "Search"}
          </button>
        </form>

        {sandboxResults.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-4xl mx-auto">
            {sandboxResults.map(r => (
              <div key={r.id} onClick={() => setSandboxSelected(r)}
                className={`p-3 rounded-2xl border transition-all cursor-pointer flex gap-3 items-center ${sandboxSelected?.id === r.id ? "border-teal-400 bg-teal-500/15" : "border-white/10 bg-white/5 hover:border-white/20"}`}>
                {r.poster_path ? (
                  <img src={`https://image.tmdb.org/t/p/w92${r.poster_path}`} alt={r.title} className="w-12 h-16 object-cover rounded-lg flex-shrink-0" />
                ) : (
                  <div className="w-12 h-16 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0"><Film size={20} className="text-slate-400" /></div>
                )}
                <div className="min-w-0">
                  <p className="text-white text-xs font-bold truncate">{r.title}</p>
                  <p className="text-slate-400 text-[10px]">{r.release_date?.slice(0, 4) || "N/A"}</p>
                  <span className="text-[10px] text-teal-400 font-semibold mt-1 block">Click to check</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {sandboxSelected && (
          <div className="mt-8 p-6 rounded-2xl border border-teal-500/30 bg-[#12213A] max-w-2xl mx-auto text-left flex gap-5 items-center">
            {sandboxSelected.poster_path && (
              <img src={`https://image.tmdb.org/t/p/w185${sandboxSelected.poster_path}`} alt={sandboxSelected.title} className="w-24 h-36 object-cover rounded-xl shadow-lg flex-shrink-0 hidden sm:block" />
            )}
            <div className="flex-1">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-white font-bold text-base">{sandboxSelected.title} ({sandboxSelected.release_date?.slice(0, 4)})</h4>
                <SafeBadge rating="safe" size="sm" />
              </div>
              <p className="text-slate-300 text-xs leading-relaxed mb-3 line-clamp-3">{sandboxSelected.overview || "No overview available for this title."}</p>
              <button onClick={() => setAuthMode("signup")} className="bg-teal-500 hover:bg-teal-400 text-white font-semibold px-4 py-2 rounded-xl text-xs inline-flex items-center gap-1 shadow">
                Create account to get full AI safety report <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Features Section */}
      <section id="features" className="relative max-w-7xl mx-auto px-6 lg:px-16 py-20 border-t border-white/6">
        <div className="text-center mb-16">
          <p className="text-teal-400 text-xs font-bold uppercase tracking-widest mb-3">Core Capabilities</p>
          <h2 className="text-4xl lg:text-5xl text-white font-serif font-medium mb-4">Built for emotional & physical safety</h2>
          <p className="text-slate-400 text-base max-w-lg mx-auto">Every feature is designed with trauma awareness at the center.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            { icon: <Shield size={28} />, title: "100% Personalized Ratings", desc: "Every safety score is computed against YOUR specific trigger profile — not generic MPAA age ratings.", color: "#4CB8A6" },
            { icon: <Sparkles size={28} />, title: "AI Assistant Guidance", desc: "Chat directly with our trauma-aware AI assistant to ask specific questions about any movie or scene.", color: "#818CF8" },
            { icon: <Bell size={28} />, title: "In-App Safety Alerts", desc: "Get automatic alerts for watchlist additions and newly released safe picks tailored to your preferences.", color: "#FB923C" },
          ].map(f => (
            <div key={f.title} className="border border-white/10 rounded-3xl p-8 hover:border-teal-500/40 transition-all bg-[#0F1A2E]/60 backdrop-blur-md">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-6 text-white" style={{ backgroundColor: f.color + "20", border: `1px solid ${f.color}40` }}>
                <span style={{ color: f.color }}>{f.icon}</span>
              </div>
              <h3 className="text-white font-serif font-medium text-xl mb-3">{f.title}</h3>
              <p className="text-slate-400 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="relative max-w-7xl mx-auto px-6 lg:px-16 py-20 border-t border-white/6">
        <div className="text-center mb-16">
          <p className="text-teal-400 text-xs font-bold uppercase tracking-widest mb-3">Simple 3-Step Process</p>
          <h2 className="text-4xl lg:text-5xl text-white font-serif font-medium mb-4">How ClearWatch Protects You</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            { num: "01", title: "Build Your Profile", desc: "Select triggers across violence, phobias, addiction, audio, and visual sensitivity categories." },
            { num: "02", title: "Verified Trigger Data", desc: "We pull community-verified trigger reports and analyze movie scripts with AI." },
            { num: "03", title: "Watch Stress-Free", desc: "Get instant GREEN/YELLOW/RED ratings, scene timestamps, and spoiler-free context." }
          ].map(s => (
            <div key={s.num} className="p-8 rounded-3xl border border-white/8 bg-white/5 relative">
              <span className="text-5xl font-extrabold text-teal-500/20 mb-4 block">{s.num}</span>
              <h3 className="text-white font-semibold text-lg mb-2">{s.title}</h3>
              <p className="text-slate-400 text-sm leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* About Section */}
      <section id="about" className="relative max-w-4xl mx-auto px-6 py-20 text-center border-t border-white/6">
        <div className="border border-teal-500/20 rounded-3xl p-10 lg:p-14 bg-gradient-to-tr from-[#0F1A2E] to-[#14233D] shadow-2xl">
          <Shield size={44} className="text-teal-400 mx-auto mb-6" />
          <h2 className="text-4xl text-white font-serif font-medium mb-4">Empowering Everyone to Enjoy Media</h2>
          <p className="text-slate-300 text-base leading-relaxed max-w-xl mx-auto mb-8">
            ClearWatch was built on the belief that entertainment should bring joy, not unexpected panic or trauma triggers. Your safety preferences are private and fully in your control.
          </p>
          <button onClick={() => setAuthMode("signup")} className="bg-teal-500 hover:bg-teal-400 text-white font-semibold px-9 py-4 rounded-2xl transition-all shadow-xl shadow-teal-500/25 text-base inline-flex items-center gap-2 hover:scale-105">
            Get started for free <ChevronRight size={18} />
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/8 px-6 lg:px-16 py-10 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          <div className="w-7 h-7 bg-teal-500 rounded-lg flex items-center justify-center"><Shield size={14} className="text-white" /></div>
          <span className="text-white font-semibold text-base font-serif">ClearWatch</span>
        </div>
        <p className="text-slate-500 text-xs">© 2026 ClearWatch Inc. Trauma-informed content safety engine. All rights reserved.</p>
        <div className="flex gap-6 text-slate-400 text-xs font-medium">
          <button onClick={() => setInfoModal("Privacy Policy: Your sensitivity data is stored with end-to-end user isolation in SQLite and is never sold or shared with third parties.")} className="hover:text-white transition-colors">Privacy</button>
          <button onClick={() => setInfoModal("Terms of Service: ClearWatch provides community and AI-generated media guidance for informational safety purposes.")} className="hover:text-white transition-colors">Terms</button>
          <button onClick={() => setInfoModal("Support Contact: Reach out to support@clearwatch.app for questions or trigger report feedback.")} className="hover:text-white transition-colors">Contact</button>
        </div>
      </footer>

      {/* Info Modal */}
      {infoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" onClick={() => setInfoModal(null)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-md bg-[#0F1A2E] border border-white/12 rounded-2xl p-6 shadow-2xl">
            <h3 className="text-white font-bold text-lg mb-3">ClearWatch Information</h3>
            <p className="text-slate-300 text-sm leading-relaxed mb-6">{infoModal}</p>
            <button onClick={() => setInfoModal(null)} className="w-full py-2.5 rounded-xl bg-teal-500 hover:bg-teal-400 text-white font-semibold text-sm">Close</button>
          </div>
        </div>
      )}

      {/* Auth Modal */}
      {authMode && (
        <AuthModal
          mode={authMode}
          onClose={() => setAuthMode(null)}
          onSuccess={() => {
            const wasSignup = authMode === "signup";
            setAuthMode(null);
            wasSignup ? onGetStarted() : onLogin();
          }}
        />
      )}
    </div>
  );
}

// ─── Auth ────────────────────────────────────────────────────────────────────

function AuthModal({ mode, onClose, onSuccess }: {
  mode: "login" | "signup"; onClose: () => void; onSuccess: () => void;
}) {
  const [isSignup, setIsSignup] = useState(mode === "signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (isSignup) {
        await signUp(email, password);
      } else {
        await logIn(email, password);
      }
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg.replace(/^Firebase:\s*/, "").replace(/\s*\(auth\/[\w-]+\)\.?$/, ""));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full max-w-sm bg-[#0D1526] border border-white/10 rounded-2xl p-6 shadow-2xl">
        <h2 className="text-white text-xl font-semibold mb-1">{isSignup ? "Create your account" : "Welcome back"}</h2>
        <p className="text-slate-400 text-sm mb-6">
          {isSignup ? "Takes about 10 seconds — no credit card." : "Log in to see your saved safety profile."}
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email" required autoFocus placeholder="Email" value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-slate-500 text-sm focus:outline-none focus:border-teal-500"
          />
          <input
            type="password" required minLength={6} placeholder="Password (min. 6 characters)" value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-slate-500 text-sm focus:outline-none focus:border-teal-500"
          />
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button
            type="submit" disabled={loading}
            className="w-full py-2.5 rounded-xl bg-teal-500 hover:bg-teal-400 text-white text-sm font-semibold transition-colors disabled:opacity-60"
          >
            {loading ? "Please wait…" : isSignup ? "Create account" : "Log in"}
          </button>
        </form>
        <button onClick={() => { setIsSignup(v => !v); setError(null); }} className="w-full text-center mt-4 text-slate-400 hover:text-white text-xs">
          {isSignup ? "Already have an account? Log in" : "New here? Create an account"}
        </button>
        <button onClick={onClose} className="w-full text-center mt-2 text-slate-500 hover:text-slate-300 text-xs">Cancel</button>
      </div>
    </div>
  );
}

// ─── Onboarding ───────────────────────────────────────────────────────────────

// Shape sent to the backend — field names match profileToText() in server/index.js
export interface UserProfile {
  name: string;
  profileType: string | null;
  languageStyle: "direct" | "soft" | null;
  visualSensitivities: string[];
  audioSensitivities: string[];
  triggers: string[];
  warningPref: "hide" | "warn" | null;
  spoilerPref: "vague" | "detailed" | null;
  timestampPref: "yes" | "no" | null;
  religiousCultural: string[];
  strictness?: number;
  kidsMode?: boolean;
  notifications?: boolean;
}

function OnboardingFlow({ onComplete, initialProfile }: {
  onComplete: (name: string, profile: UserProfile) => void;
  initialProfile?: UserProfile | null;
}) {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(true);
  const [name, setName] = useState(initialProfile?.name ?? "");
  const [profileType, setProfileType] = useState<string | null>(initialProfile?.profileType ?? "self");
  const [language, setLanguage] = useState<"direct" | "soft" | null>(initialProfile?.languageStyle ?? "direct");
  const [visual, setVisual] = useState<Set<string>>(new Set(initialProfile?.visualSensitivities ?? []));
  const [audio, setAudio] = useState<Set<string>>(new Set(initialProfile?.audioSensitivities ?? []));
  const [triggerItems, setTriggerItems] = useState<Set<string>>(new Set(initialProfile?.triggers ?? []));
  const [triggerQuery, setTriggerQuery] = useState("");
  const [openCats, setOpenCats] = useState<Set<string>>(new Set(["violence", "sexual"]));
  const [warningPref, setWarningPref] = useState<"hide" | "warn" | null>(initialProfile?.warningPref ?? "warn");
  const [spoilerPref, setSpoilerPref] = useState<"vague" | "detailed" | null>(initialProfile?.spoilerPref ?? "vague");
  const [timestampPref, setTimestampPref] = useState<"yes" | "no" | null>(initialProfile?.timestampPref ?? "yes");
  const [strictness, setStrictness] = useState<number>(initialProfile?.strictness ?? 60);
  const [kidsMode, setKidsMode] = useState<boolean>(initialProfile?.kidsMode ?? false);
  const TOTAL = 7;

  const toggle = (set: Set<string>, val: string) => { const n = new Set(set); n.has(val) ? n.delete(val) : n.add(val); return n; };

  function transition(fn: () => void) {
    setVisible(false);
    setTimeout(() => { fn(); setVisible(true); }, 120);
  }
  function next() {
    transition(() => {
      if (step < TOTAL - 1) { setStep(s => s + 1); return; }
      const resolvedName = name.trim() || "Friend";
      onComplete(resolvedName, {
        name: resolvedName,
        profileType,
        languageStyle: language,
        visualSensitivities: Array.from(visual).filter(v => v !== "__none__"),
        audioSensitivities: Array.from(audio),
        triggers: Array.from(triggerItems),
        warningPref,
        spoilerPref,
        timestampPref,
        religiousCultural: initialProfile?.religiousCultural ?? [],
        strictness,
        kidsMode,
        notifications: initialProfile?.notifications ?? true,
      });
    });
  }
  function back() { if (step > 0) transition(() => setStep(s => s - 1)); }

  const stepTitles = ["Welcome", "Profile Type", "Language Style", "Visual & Sensory", "Audio Sensitivities", "Content Triggers", "AI Strictness & Spoilers"];

  // Filtered triggers for search
  const filteredCats = TRIGGER_CATS.map(cat => ({
    ...cat,
    items: cat.items.filter(item => item.toLowerCase().includes(triggerQuery.toLowerCase()))
  })).filter(cat => cat.items.length > 0);

  // Compute live match preview based on selected triggers & strictness
  const previewMatch = Math.max(15, Math.min(98, 100 - (triggerItems.size * (strictness > 66 ? 18 : strictness < 33 ? 8 : 12)) - (kidsMode ? 15 : 0)));
  const previewRating: Rating = previewMatch > 75 ? "safe" : previewMatch > 45 ? "caution" : "avoid";

  return (
    <div className="min-h-screen flex" style={{ background: "linear-gradient(135deg, #060D1A 0%, #0D1526 100%)" }}>
      {/* Side panel */}
      <div className="hidden lg:flex flex-col w-80 border-r border-white/6 px-8 py-10 flex-shrink-0" style={{ background: "rgba(10,16,32,0.85)", backdropFilter: "blur(20px)" }}>
        <div className="flex items-center gap-2.5 mb-10">
          <div className="w-9 h-9 bg-teal-500 rounded-xl flex items-center justify-center shadow-lg shadow-teal-500/20"><Shield size={18} className="text-white" /></div>
          <span className="font-semibold text-white text-lg" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>ClearWatch</span>
        </div>
        <nav className="space-y-1.5">
          {stepTitles.map((t, i) => (
            <div key={i} className={`flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm transition-all ${i === step ? "bg-teal-500/15 text-teal-400 font-medium border border-teal-500/30" : i < step ? "text-slate-300" : "text-slate-600"}`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-colors ${i === step ? "bg-teal-500 text-white shadow-md shadow-teal-500/30" : i < step ? "bg-teal-500/30 text-teal-400" : "bg-white/5 text-slate-600"}`}>
                {i < step ? <Check size={12} /> : i + 1}
              </div>
              <span>{t}</span>
            </div>
          ))}
        </nav>

        {/* Selected trigger summary pill */}
        <div className="mt-8 p-4 rounded-2xl border border-white/8 bg-white/5">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span>Selected Triggers</span>
            <span className="font-bold text-teal-400">{triggerItems.size} active</span>
          </div>
          <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden">
            <div className="bg-teal-400 h-full transition-all duration-300" style={{ width: `${Math.min(100, triggerItems.size * 10)}%` }} />
          </div>
        </div>

        <div className="mt-auto pt-6 text-slate-500 text-xs leading-relaxed border-t border-white/6">
          <p className="flex items-center gap-1.5 mb-1 text-slate-400"><span>🔒</span> 100% Private & Encrypted</p>
          <p>Your sensitivity preferences stay linked only to your account and can be updated anytime.</p>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-h-screen">
        {/* Mobile progress */}
        <div className="lg:hidden px-6 pt-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-teal-500 rounded-md flex items-center justify-center"><Shield size={13} className="text-white" /></div>
              <span className="text-white font-medium text-sm" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>ClearWatch</span>
            </div>
            <div className="flex-1 h-1.5 bg-white/10 rounded-full ml-4 overflow-hidden">
              <div className="h-full bg-teal-500 rounded-full transition-all duration-300" style={{ width: `${((step + 1) / TOTAL) * 100}%` }} />
            </div>
            <span className="text-teal-400 font-semibold text-xs">{step + 1}/{TOTAL}</span>
          </div>
        </div>

        <div className="flex-1 flex items-start lg:items-center justify-center p-6 lg:p-12">
          <div className={`w-full max-w-2xl transition-all duration-150 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"}`}>

            {/* Step 0: Welcome */}
            {step === 0 && (
              <div className="text-center">
                <div className="w-20 h-20 bg-gradient-to-tr from-teal-600 to-teal-400 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-2xl shadow-teal-500/25"><Shield size={40} className="text-white" /></div>
                <h1 className="text-4xl lg:text-5xl text-white mb-4" style={{ fontFamily: "'Fraunces', Georgia, serif", fontWeight: 500 }}>Welcome to ClearWatch</h1>
                <p className="text-slate-400 text-base leading-relaxed mb-8 max-w-md mx-auto">Build your personalized content safety profile. Tell us what sensitivity triggers or themes matter to you so we can filter and rate media tailored to your exact needs.</p>
                <div className="text-left max-w-md mx-auto mb-8">
                  <label className="text-sm font-medium text-slate-300 block mb-2">What should we call you?</label>
                  <input type="text" placeholder="Enter your name" value={name} onChange={e => setName(e.target.value)}
                    className="w-full px-5 py-4 rounded-2xl text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-teal-500 text-base transition-all"
                    style={{ background: "#1C2D45", border: "1px solid rgba(255,255,255,0.12)" }} />
                </div>
              </div>
            )}

            {/* Step 1: Profile type */}
            {step === 1 && (
              <>
                <h2 className="text-3xl lg:text-4xl text-white mb-2" style={{ fontFamily: "'Fraunces', Georgia, serif", fontWeight: 500 }}>Whose safety profile are we setting up?</h2>
                <p className="text-slate-400 text-sm mb-8">Select who this profile will serve to calibrate default recommendations and tone.</p>
                <div className="grid grid-cols-1 gap-3.5">
                  {[
                    { id: "self", label: "My personal profile", sub: "Customize ratings for your own viewing comfort and safety", emoji: "🙋" },
                    { id: "child", label: "A child / family member", sub: "Parental mode with strict kid safety filters", emoji: "🧒" },
                    { id: "loved", label: "A partner or friend", sub: "Help a loved one navigate sensitive content comfortably", emoji: "❤️" },
                  ].map(opt => (
                    <button key={opt.id} onClick={() => setProfileType(opt.id)}
                      className={`w-full flex items-center gap-4 px-6 py-5 rounded-2xl border text-left transition-all ${profileType === opt.id ? "border-teal-500 bg-teal-500/10 shadow-lg shadow-teal-500/10" : "border-white/8 hover:border-white/20 bg-[#1C2D45]"}`}>
                      <span className="text-3xl">{opt.emoji}</span>
                      <div className="flex-1">
                        <p className={`font-semibold text-base ${profileType === opt.id ? "text-teal-400" : "text-white"}`}>{opt.label}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{opt.sub}</p>
                      </div>
                      {profileType === opt.id && <Check size={20} className="text-teal-400 flex-shrink-0" />}
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Step 2: Language */}
            {step === 2 && (
              <>
                <h2 className="text-3xl lg:text-4xl text-white mb-2" style={{ fontFamily: "'Fraunces', Georgia, serif", fontWeight: 500 }}>How would you like sensitive topics described?</h2>
                <p className="text-slate-400 text-sm mb-8">Choose how trigger explanations and warnings are worded throughout the app.</p>
                <div className="grid grid-cols-1 gap-3.5">
                  {[
                    { id: "direct", label: "Direct & Explicit Terms", sub: 'Uses exact terms e.g., "Gore," "Self-harm," "Sexual Assault" for unambiguous clarity.', emoji: "📋" },
                    { id: "soft", label: "Gentle & Clinical Language", sub: 'Uses softer phrasing e.g., "Graphic violence," "Non-consensual content" to minimize distress.', emoji: "🌿" },
                  ].map(opt => (
                    <button key={opt.id} onClick={() => setLanguage(opt.id as "direct" | "soft")}
                      className={`w-full flex items-start gap-4 px-6 py-5 rounded-2xl border text-left transition-all ${language === opt.id ? "border-teal-500 bg-teal-500/10 shadow-lg shadow-teal-500/10" : "border-white/8 hover:border-white/20 bg-[#1C2D45]"}`}>
                      <span className="text-2xl mt-0.5">{opt.emoji}</span>
                      <div className="flex-1">
                        <p className={`font-semibold text-base ${language === opt.id ? "text-teal-400" : "text-white"}`}>{opt.label}</p>
                        <p className="text-xs text-slate-400 mt-1 leading-relaxed">{opt.sub}</p>
                      </div>
                      {language === opt.id && <Check size={20} className="text-teal-400 flex-shrink-0 mt-0.5" />}
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Step 3: Visual & Sensory */}
            {step === 3 && (
              <>
                <h2 className="text-3xl lg:text-4xl text-white mb-2" style={{ fontFamily: "'Fraunces', Georgia, serif", fontWeight: 500 }}>Visual & Photosensitivity Preferences</h2>
                <p className="text-slate-400 text-sm mb-8">Select any visual elements you need flagged or avoided.</p>
                <div className="space-y-3">
                  {[
                    { id: "Flashing lights / strobe effects", label: "Flashing lights & strobe effects", sub: "Crucial for epilepsy and photosensitive migraines" },
                    { id: "Shaky camera / intense color contrast", label: "Shaky camera & high color contrast", sub: "Helps avoid motion sickness and visual overwhelm" },
                    { id: "__none__", label: "No visual sensitivities", sub: "Skip visual filters" },
                  ].map(opt => {
                    const on = visual.has(opt.id);
                    return (
                      <button key={opt.id} onClick={() => {
                        if (opt.id === "__none__") { setVisual(new Set(["__none__"])); }
                        else { setVisual(v => { const n = toggle(v, opt.id); n.delete("__none__"); return n; }); }
                      }}
                        className={`w-full flex items-center justify-between px-6 py-4.5 rounded-2xl border text-left transition-all ${on ? "border-teal-500 bg-teal-500/10" : "border-white/8 hover:border-white/20 bg-[#1C2D45]"}`}>
                        <div>
                          <p className={`text-base font-semibold ${on ? "text-teal-400" : "text-slate-200"}`}>{opt.label}</p>
                          <p className="text-xs text-slate-400 mt-0.5">{opt.sub}</p>
                        </div>
                        {on ? <Check size={20} className="text-teal-400 flex-shrink-0" /> : <div className="w-5 h-5 rounded-md border border-white/20 flex-shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {/* Step 4: Audio */}
            {step === 4 && (
              <>
                <h2 className="text-3xl lg:text-4xl text-white mb-2" style={{ fontFamily: "'Fraunces', Georgia, serif", fontWeight: 500 }}>Audio Sensitivities & Sound Triggers</h2>
                <p className="text-slate-400 text-sm mb-8">Select sound patterns or acoustic triggers to flag in movie safety reports.</p>
                <div className="space-y-3">
                  {[
                    { id: "Sudden, high-volume jump scares / loud noises", label: "Jump Scares & Loud Noises", sub: "Warn for sudden high-volume startled sound effects" },
                    { id: "Misophonia triggers (e.g., chewing, whispering, scratching sounds)", label: "Misophonia Triggers", sub: "Warn for loud chewing, heavy breathing, scratching, or whispering" },
                    { id: "High-pitched frequencies or screaming", label: "High-pitched Frequencies & Screaming", sub: "Warn for piercing feedback or prolonged shriek sounds" }
                  ].map(item => {
                    const on = audio.has(item.id);
                    return (
                      <button key={item.id} onClick={() => setAudio(v => toggle(v, item.id))}
                        className={`w-full flex items-center justify-between px-6 py-4.5 rounded-2xl border text-left transition-all ${on ? "border-teal-500 bg-teal-500/10" : "border-white/8 hover:border-white/20 bg-[#1C2D45]"}`}>
                        <div>
                          <p className={`text-base font-semibold ${on ? "text-teal-400" : "text-slate-200"}`}>{item.label}</p>
                          <p className="text-xs text-slate-400 mt-0.5">{item.sub}</p>
                        </div>
                        {on ? <Check size={20} className="text-teal-400 flex-shrink-0" /> : <div className="w-5 h-5 rounded-md border border-white/20 flex-shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {/* Step 5: Content triggers + Live Search */}
            {step === 5 && (
              <>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-3xl lg:text-4xl text-white" style={{ fontFamily: "'Fraunces', Georgia, serif", fontWeight: 500 }}>Select Content Triggers</h2>
                  <span className="text-xs font-bold px-3 py-1 rounded-full bg-teal-500/20 text-teal-400 border border-teal-500/30">
                    {triggerItems.size} selected
                  </span>
                </div>
                <p className="text-slate-400 text-sm mb-6">Search or expand categories below to check specific topics you want flagged.</p>

                {/* Instant Search Bar */}
                <div className="relative mb-5">
                  <Search size={18} className="absolute left-4 top-3.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search triggers (e.g., dog, blood, assault, drugs)..."
                    value={triggerQuery}
                    onChange={e => setTriggerQuery(e.target.value)}
                    className="w-full pl-11 pr-4 py-3 rounded-xl bg-[#1C2D45] border border-white/12 text-white placeholder:text-slate-500 text-sm focus:outline-none focus:border-teal-500 transition-colors"
                  />
                  {triggerQuery && (
                    <button onClick={() => setTriggerQuery("")} className="absolute right-4 top-3.5 text-slate-400 hover:text-white">
                      <X size={16} />
                    </button>
                  )}
                </div>

                <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1 scrollbar-hide">
                  {filteredCats.length === 0 ? (
                    <div className="text-center py-10 bg-[#1C2D45] rounded-2xl border border-white/8">
                      <p className="text-slate-400 text-sm">No triggers found matching "{triggerQuery}"</p>
                    </div>
                  ) : (
                    filteredCats.map(cat => {
                      const isOpen = openCats.has(cat.id) || triggerQuery.length > 0;
                      const selectedCount = cat.items.filter(i => triggerItems.has(i)).length;
                      return (
                        <div key={cat.id} className="rounded-2xl border border-white/8 overflow-hidden bg-[#1C2D45]">
                          <button onClick={() => setOpenCats(s => toggle(s, cat.id))}
                            className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-white/5 transition-colors">
                            <span className="text-xl">{cat.emoji}</span>
                            <span className="flex-1 text-sm font-semibold text-slate-200">{cat.label}</span>
                            {selectedCount > 0 && (
                              <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-teal-500/20 text-teal-400 border border-teal-500/30">{selectedCount} active</span>
                            )}
                            {isOpen ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                          </button>
                          {isOpen && (
                            <div className="border-t border-white/6 px-5 py-3 space-y-2 bg-black/20">
                              {cat.items.map(item => {
                                const on = triggerItems.has(item);
                                return (
                                  <button key={item} onClick={() => setTriggerItems(s => toggle(s, item))}
                                    className={`w-full flex items-center justify-between py-2 text-left transition-colors ${on ? "text-teal-400" : "text-slate-300 hover:text-white"}`}>
                                    <span className="text-sm">{item}</span>
                                    <div className={`w-4.5 h-4.5 rounded flex items-center justify-center flex-shrink-0 transition-colors ${on ? "bg-teal-500 border-teal-500" : "border border-white/20"}`}>
                                      {on && <Check size={12} className="text-white" />}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            )}

            {/* Step 6: AI Strictness, Warnings & Live Preview */}
            {step === 6 && (
              <>
                <h2 className="text-3xl lg:text-4xl text-white mb-2" style={{ fontFamily: "'Fraunces', Georgia, serif", fontWeight: 500 }}>AI Sensitivity & Warning Calibration</h2>
                <p className="text-slate-400 text-sm mb-6">Fine-tune how strict the ClearWatch AI will grade safety ratings for you.</p>

                <div className="space-y-6">
                  {/* Strictness Slider */}
                  <div className="bg-[#1C2D45] p-5 rounded-2xl border border-white/10">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-semibold text-white flex items-center gap-2">
                        <SlidersHorizontal size={16} className="text-teal-400" />
                        AI Sensitivity Strictness
                      </label>
                      <span className="text-xs font-bold text-teal-400 px-2.5 py-0.5 rounded-md bg-teal-500/15">
                        {strictness < 33 ? "Lenient" : strictness < 66 ? "Balanced (60%)" : "Very Strict"}
                      </span>
                    </div>
                    <input
                      type="range" min="10" max="95" value={strictness}
                      onChange={e => setStrictness(Number(e.target.value))}
                      className="w-full accent-teal-400 cursor-pointer my-2"
                    />
                    <p className="text-xs text-slate-400">
                      {strictness < 33 ? "Only flag major or central triggers." : strictness < 66 ? "Balanced weighing of trigger frequency and severity." : "Err on the side of caution for any matching trigger mention."}
                    </p>
                  </div>

                  {/* Kids Mode Toggle */}
                  <div className="bg-[#1C2D45] p-5 rounded-2xl border border-white/10 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-teal-500/20 flex items-center justify-center text-teal-400">
                        <Baby size={20} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-white">Kids Mode Filtering</p>
                        <p className="text-xs text-slate-400">Enforces extra-strict family safety rules</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setKidsMode(k => !k)}
                      className={`w-12 h-6 rounded-full transition-colors relative ${kidsMode ? "bg-teal-500" : "bg-white/15"}`}
                    >
                      <div className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-transform ${kidsMode ? "translate-x-6" : "translate-x-0.5"}`} />
                    </button>
                  </div>

                  {/* Live Rating Preview Box */}
                  <div className="bg-gradient-to-r from-teal-950/40 to-slate-900/60 p-5 rounded-2xl border border-teal-500/30">
                    <p className="text-xs font-semibold uppercase tracking-wider text-teal-400 mb-3 flex items-center gap-1.5">
                      <Sparkles size={14} /> Live Sample Rating Preview
                    </p>
                    <div className="flex items-center justify-between bg-black/40 p-4 rounded-xl border border-white/8">
                      <div>
                        <p className="text-white font-semibold text-sm">Inside Out 2 (2024)</p>
                        <p className="text-xs text-slate-400 mt-0.5">Evaluated against {triggerItems.size} active sensitivity triggers</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <SafeBadge rating={previewRating} size="sm" />
                        <span className="text-sm font-bold text-white">{previewMatch}% Match</span>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Nav buttons */}
            <div className="flex items-center gap-3 mt-10">
              {step > 0 && (
                <button onClick={back} className="flex items-center gap-2 px-5 py-3 rounded-xl border border-white/10 text-slate-400 hover:text-white transition-colors text-sm">
                  <ArrowLeft size={15} /> Back
                </button>
              )}
              {(step === 3 || step === 4 || step === 5 || step === 6) && (
                <button onClick={next} className="px-5 py-3 rounded-xl text-slate-500 hover:text-slate-300 transition-colors text-sm">Skip</button>
              )}
              <button onClick={next} disabled={step === 1 && !profileType}
                className="flex-1 bg-teal-500 hover:bg-teal-400 text-white font-semibold py-3.5 rounded-xl transition-colors disabled:opacity-40 text-sm flex items-center justify-center gap-2">
                {step === TOTAL - 1 ? "Start watching safely →" : "Continue"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── App Sidebar ──────────────────────────────────────────────────────────────

function Sidebar({ tab, onTab, darkMode, onToggleDark, onLogout, userName }: {
  tab: Tab; onTab: (t: Tab) => void; darkMode: boolean; onToggleDark: () => void; onLogout: () => void; userName: string;
}) {
  const nav = [
    { id: "home" as Tab, icon: <Home size={18} />, label: "Home" },
    { id: "search" as Tab, icon: <Search size={18} />, label: "Search" },
    { id: "chat" as Tab, icon: <MessageCircle size={18} />, label: "AI Assistant" },
    { id: "watchlist" as Tab, icon: <Bookmark size={18} />, label: "Watchlist" },
    { id: "profile" as Tab, icon: <User size={18} />, label: "Profile" },
  ];
  return (
    <aside className="hidden lg:flex flex-col w-60 flex-shrink-0 border-r border-border h-screen sticky top-0 overflow-hidden" style={{ backgroundColor: "var(--sidebar)" }}>
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-6 py-5 border-b border-border">
        <div className="w-7 h-7 bg-primary rounded-lg flex items-center justify-center flex-shrink-0"><Shield size={14} className="text-primary-foreground" /></div>
        <span className="font-semibold text-sidebar-foreground" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>ClearWatch</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto scrollbar-hide">
        {nav.map(item => (
          <button key={item.id} onClick={() => onTab(item.id)}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors ${tab === item.id ? "bg-primary/15 text-primary" : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent"}`}>
            {item.icon}
            {item.label}
            {tab === item.id && <div className="ml-auto w-1.5 h-1.5 bg-primary rounded-full" />}
          </button>
        ))}
      </nav>

      {/* Bottom */}
      <div className="px-3 py-4 border-t border-border space-y-0.5">
        <button onClick={onToggleDark} className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors">
          {darkMode ? <Sun size={18} /> : <Moon size={18} />}
          {darkMode ? "Light mode" : "Dark mode"}
        </button>
        <button onClick={onLogout} className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors">
          <LogOut size={18} /> Log out
        </button>
        <div className="flex items-center gap-3 px-3.5 py-3 mt-2 rounded-xl bg-sidebar-accent">
          <div className="w-8 h-8 bg-primary/30 rounded-full flex items-center justify-center flex-shrink-0 text-primary text-sm font-bold">{userName[0]?.toUpperCase()}</div>
          <div className="flex-1 min-w-0">
            <p className="text-sidebar-foreground text-sm font-medium truncate">{userName}</p>
            <p className="text-sidebar-foreground/40 text-[10px]">Personalized profile</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

// ─── Collection Modal ─────────────────────────────────────────────────────
// Reuses the same "click a poster → rate it for real" flow as Search.

function CollectionModal({ label, movies, onSelectResult, ratingLoadingId, onClose }: {
  label: string; movies: CollectionMovie[];
  onSelectResult: (result: TmdbSearchResult) => void; ratingLoadingId: string | null;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-background overflow-y-auto">
      <div className="max-w-6xl mx-auto p-8">
        <button onClick={onClose} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-sm mb-6">
          <ArrowLeft size={16} /> Back to Home
        </button>
        <h1 className="text-3xl text-foreground mb-1" style={{ fontFamily: "'Fraunces', Georgia, serif", fontWeight: 500 }}>{label}</h1>
        <p className="text-muted-foreground text-sm mb-8">{movies.length} {movies.length === 1 ? "title" : "titles"} — tap one to check its personalized rating</p>

        {movies.length === 0 ? (
          <div className="text-center py-24">
            <div className="text-5xl mb-4">🎬</div>
            <p className="text-foreground font-semibold mb-1">Nothing here yet</p>
            <p className="text-muted-foreground text-sm">This collection grows as more movies get searched and rated across ClearWatch.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {movies.map(m => {
              const isRating = ratingLoadingId === String(m.id);
              return (
                <button key={m.id} onClick={() => onSelectResult(m as unknown as TmdbSearchResult)} disabled={isRating}
                  className="group flex-shrink-0 text-left overflow-hidden rounded-2xl shadow-lg transition-all duration-200 hover:scale-[1.03] hover:shadow-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70">
                  <div className="aspect-[2/3] relative overflow-hidden bg-muted">
                    {m.poster_path ? (
                      <img src={`https://image.tmdb.org/t/p/w500${m.poster_path}`} alt={m.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">No poster</div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
                    {isRating && (
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                        <span className="text-white text-xs font-semibold">Checking safety…</span>
                      </div>
                    )}
                    <div className="absolute bottom-0 left-0 right-0 p-3">
                      <p className="text-white font-semibold text-sm leading-tight truncate">{m.title}</p>
                      <p className="text-white/50 text-[10px] mt-0.5">{m.release_date?.slice(0, 4) || "—"}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Home Screen ──────────────────────────────────────────────────────────────

function HomeScreen({ movies, loading, watchlist, onMovie, userName, collections, onOpenCollection, recentlyViewed }: {
  movies: Movie[]; loading: boolean; watchlist: Set<string>; onMovie: (m: Movie) => void; userName: string;
  collections: Record<string, CollectionMovie[]>; onOpenCollection: (id: string) => void;
  recentlyViewed: Movie[];
}) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const safe = movies.filter(m => m.rating === "safe");

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-12">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-muted-foreground text-sm uppercase tracking-widest font-medium">{greeting}</p>
          <h1 className="text-3xl text-foreground mt-1" style={{ fontFamily: "'Fraunces', Georgia, serif", fontWeight: 500 }}>
            {userName} — here&apos;s what&apos;s safe for you today.
          </h1>
        </div>
      </div>

      {loading && (
        <div className="text-center py-16">
          <p className="text-muted-foreground text-sm">Checking this week&apos;s trending titles against your profile…</p>
          <p className="text-muted-foreground/60 text-xs mt-1">First load can take a minute — it&apos;s worth it after that.</p>
        </div>
      )}

      {!loading && movies.length === 0 && (
        <div className="text-center py-16">
          <p className="text-muted-foreground text-sm">No recommendations yet — try Search in the meantime.</p>
        </div>
      )}

      {/* Recently Viewed — persisted in localStorage */}
      <section>
        <div className="flex items-center gap-2 mb-5">
          <Clock size={16} className="text-primary" />
          <h2 className="text-lg font-semibold text-foreground" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>Recently Viewed</h2>
        </div>
        {recentlyViewed.length > 0 ? (
          <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
            {recentlyViewed.map(m => (
              <div key={m.id} className="flex-shrink-0 w-36 sm:w-40">
                <MovieCard movie={m} onClick={() => onMovie(m)} />
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl p-6 border border-dashed border-border text-center bg-card/40">
            <p className="text-sm font-medium text-muted-foreground">No recently viewed movies yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Click any movie card or search for a title to inspect its safety rating</p>
          </div>
        )}
      </section>

      {!loading && safe.length > 0 && (
        <section>
          <SectionHeader title="Safe for You" />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {safe.map(m => <MovieCard key={m.id} movie={m} onClick={() => onMovie(m)} />)}
          </div>
        </section>
      )}

      {/* Collections — auto-generated from the shared trigger cache */}
      <section>
        <SectionHeader title="Curated Collections" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {COLLECTIONS.map(c => {
            const count = collections[c.id]?.length ?? 0;
            return (
              <button key={c.id} onClick={() => onOpenCollection(c.id)}
                className="rounded-2xl h-28 flex flex-col justify-end p-4 text-left overflow-hidden relative group hover:scale-[1.02] transition-transform"
                style={{ background: `linear-gradient(135deg, ${c.from} 0%, ${c.to} 100%)` }}>
                <div className="absolute inset-0 bg-black/10 group-hover:bg-black/0 transition-colors" />
                <span className="text-xl leading-none mb-1.5 relative">{c.emoji}</span>
                <p className="text-white font-semibold text-sm relative leading-tight">{c.label}</p>
                <p className="text-white/60 text-[10px] relative mt-0.5">{count} {count === 1 ? "title" : "titles"}</p>
              </button>
            );
          })}
        </div>
      </section>

      {!loading && movies.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-5">
            <TrendingUp size={16} className="text-primary" />
            <SectionHeader title="Trending — Checked for You" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {movies.map(m => <MovieCard key={m.id} movie={m} onClick={() => onMovie(m)} />)}
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Movie Detail Modal ───────────────────────────────────────────────────────

function MovieDetailModal({ movie, inWatchlist, onClose, onToggleWatchlist }: {
  movie: Movie; inWatchlist: boolean; onClose: () => void; onToggleWatchlist: () => void;
}) {
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const [feedbackNote, setFeedbackNote] = useState("");
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [showAllTriggers, setShowAllTriggers] = useState(false);
  const r = RC[movie.rating];

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 lg:p-8">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card rounded-3xl shadow-2xl overflow-hidden w-full max-w-5xl max-h-[90vh] flex flex-col lg:flex-row border border-border">
        {/* Left: Cinematic poster */}
        <div className="relative lg:w-80 flex-shrink-0 h-48 lg:h-auto overflow-hidden">
          {/* Blurred backdrop */}
          <div className="absolute inset-0 scale-110" style={{ background: movie.gradient, filter: "blur(40px)", opacity: 0.7 }} />
          {/* Poster centered */}
          <div className="absolute inset-0 flex items-center justify-center p-8">
            <div className="w-36 lg:w-48 aspect-[2/3] rounded-2xl shadow-2xl" style={{ background: movie.gradient }} />
          </div>
          {/* Close button */}
          <button onClick={onClose} className="absolute top-4 left-4 w-9 h-9 bg-black/50 backdrop-blur-sm rounded-full flex items-center justify-center text-white hover:bg-black/70 transition-colors">
            <X size={17} />
          </button>
        </div>

        {/* Right: Details */}
        <div className="flex-1 overflow-y-auto p-6 lg:p-8 space-y-6 scrollbar-hide">
          {/* Header */}
          <div>
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">
              {movie.mediaType === "tv" ? <Tv size={12} /> : <Film size={12} />}
              <span>{movie.year}</span>
              <span>·</span>
              <span>{movie.genre}</span>
              <span>·</span>
              <span>{movie.runtime}</span>
            </div>
            <h2 className="text-2xl lg:text-3xl text-foreground font-medium mb-4" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>{movie.title}</h2>

            {/* Rating hero */}
            <div className="rounded-2xl p-5 border" style={{ backgroundColor: r.soft + "25", borderColor: r.bg + "50" }}>
              <div className="flex items-center gap-4 mb-3">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white text-2xl font-bold flex-shrink-0" style={{ backgroundColor: r.bg }}>{r.icon}</div>
                <div className="flex-1">
                  <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-1">Your personalized rating</p>
                  <SafeBadge rating={movie.rating} size="lg" />
                </div>
                <MatchRing pct={movie.matchPct} rating={movie.rating} size={72} />
              </div>
              <p className="text-sm text-foreground leading-relaxed">{movie.aiNote}</p>
            </div>
          </div>

          {/* Triggers */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-foreground text-sm">Trigger Breakdown</h3>
              {movie.triggers.length > 3 && (
                <button onClick={() => setShowAllTriggers(v => !v)} className="text-xs text-primary font-medium">
                  {showAllTriggers ? "Show less" : `Show all ${movie.triggers.length}`}
                </button>
              )}
            </div>
            <div className="space-y-2">
              {(showAllTriggers ? movie.triggers : movie.triggers.slice(0, 3)).map(t => (
                <div key={t.id} className="flex items-start gap-3 bg-background rounded-xl px-4 py-3 border border-border">
                  <span className="text-xl leading-none mt-0.5">{t.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-medium text-foreground">{t.label}</span>
                      <SafeBadge rating={t.level} />
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{t.note}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={onToggleWatchlist}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors ${inWatchlist ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/70"}`}>
              <Bookmark size={16} className={inWatchlist ? "fill-current" : ""} />
              {inWatchlist ? "Saved" : "Add to Watchlist"}
            </button>
            <button className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-muted text-foreground hover:bg-muted/70 transition-colors">
              <Share2 size={16} /> Share Safety Card
            </button>
          </div>

          {/* Feedback */}
          <div className="border-t border-border pt-4">
            <p className="text-sm font-medium text-foreground mb-3">Was this rating accurate for you?</p>
            <div className="flex items-center gap-2.5 flex-wrap mb-3">
              <button onClick={() => {
                setFeedback("up");
                setFeedbackSubmitted(true);
                submitRatingFeedback(movie.id, movie.title, movie.rating, "up").catch(() => { /* non-critical */ });
              }}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-all ${feedback === "up" ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-600 dark:text-emerald-400" : "border-border text-muted-foreground hover:text-foreground"}`}>
                <ThumbsUp size={14} /> Yes, spot on
              </button>
              <button onClick={() => {
                setFeedback("down");
              }}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-all ${feedback === "down" ? "bg-rose-500/10 border-rose-500/40 text-rose-600 dark:text-rose-400" : "border-border text-muted-foreground hover:text-foreground"}`}>
                <ThumbsDown size={14} /> Not quite
              </button>
            </div>

            {feedback === "down" && !feedbackSubmitted && (
              <div className="space-y-2 max-w-md bg-muted/30 p-3 rounded-2xl border border-border">
                <p className="text-xs text-muted-foreground font-medium">Help us calibrate: what was off? (e.g., "too strict", "missed violence")</p>
                <div className="flex gap-2">
                  <input type="text" value={feedbackNote} onChange={e => setFeedbackNote(e.target.value)}
                    placeholder="Optional details..."
                    className="flex-1 px-3 py-1.5 rounded-xl bg-background border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                  <button onClick={() => {
                    setFeedbackSubmitted(true);
                    submitRatingFeedback(movie.id, movie.title, movie.rating, "down", feedbackNote).catch(() => { /* non-critical */ });
                  }} className="px-3.5 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded-xl hover:bg-primary/90 transition-colors">
                    Submit
                  </button>
                </div>
              </div>
            )}

            {feedbackSubmitted && (
              <p className="text-xs text-emerald-500 dark:text-emerald-400 font-medium">Thanks! We'll use your feedback to calibrate future ratings 🙏</p>
            )}
          </div>

          <button className="flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors">
            <Flag size={13} /> Report a missing trigger
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Search Screen ────────────────────────────────────────────────────────────

function SearchScreen({ onSelectResult, ratingLoadingId }: {
  onSelectResult: (result: TmdbSearchResult) => void;
  ratingLoadingId: string | null;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TmdbSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Debounced live search — waits 400ms after typing stops before hitting the backend
  useEffect(() => {
    if (!query.trim()) { setResults([]); setError(null); return; }
    const handle = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await apiSearchMovies(query);
        setResults(data);
      } catch (err) {
        setError("Couldn't reach the server. Is the backend running?");
      } finally {
        setLoading(false);
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [query]);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-3xl text-foreground mb-8" style={{ fontFamily: "'Fraunces', Georgia, serif", fontWeight: 500 }}>Search</h1>
      <div className="relative mb-6 max-w-2xl">
        <Search size={20} className="absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <input ref={inputRef} type="text" placeholder="Search any movie or TV show…" value={query} onChange={e => setQuery(e.target.value)}
          className="w-full pl-14 pr-5 py-4 bg-card border border-border rounded-2xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base shadow-sm" />
      </div>
      {!query && (
        <div className="mb-8">
          <p className="text-sm text-muted-foreground mb-4">Try searching for</p>
          <div className="flex flex-wrap gap-2">
            {["Inception", "Coco", "Barbie", "The Dark Knight", "Encanto"].map(s => (
              <button key={s} onClick={() => setQuery(s)} className="px-4 py-2 rounded-full bg-muted text-muted-foreground text-xs font-medium hover:text-foreground hover:bg-muted/70 transition-colors">{s}</button>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="text-center py-24">
          <p className="text-muted-foreground text-sm">Searching…</p>
        </div>
      )}

      {error && !loading && (
        <div className="text-center py-24">
          <p className="text-foreground font-semibold mb-1">Something went wrong</p>
          <p className="text-muted-foreground text-sm">{error}</p>
        </div>
      )}

      {!loading && !error && query && results.length === 0 && (
        <div className="text-center py-24">
          <div className="text-5xl mb-4">🎬</div>
          <p className="text-foreground font-semibold mb-1">No results for &quot;{query}&quot;</p>
          <p className="text-muted-foreground text-sm">Try a different title.</p>
        </div>
      )}

      {!loading && !error && results.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {results.map(r => {
            const card = tmdbResultToCard(r);
            const isRating = ratingLoadingId === card.id;
            return (
              <button key={card.id} onClick={() => onSelectResult(r)} disabled={isRating}
                className="group flex-shrink-0 text-left overflow-hidden rounded-2xl shadow-lg transition-all duration-200 hover:scale-[1.03] hover:shadow-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70">
                <div className="aspect-[2/3] relative overflow-hidden bg-muted">
                  {card.posterUrl ? (
                    <img src={card.posterUrl} alt={card.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">No poster</div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
                  {isRating && (
                    <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2">
                      <span className="text-white text-xs font-semibold">Checking safety…</span>
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 p-3">
                    <p className="text-white font-semibold text-sm leading-tight truncate">{card.title}</p>
                    <p className="text-white/50 text-[10px] mt-0.5">{card.year || "—"}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Chat Screen ──────────────────────────────────────────────────────────────

function ChatScreen({ onMovie, onSelectSuggested, ratingLoadingId }: {
  onMovie: (m: Movie) => void;
  onSelectSuggested: (result: TmdbSearchResult) => void;
  ratingLoadingId: string | null;
}) {
  const [msgs, setMsgs] = useState<ChatMsg[]>(INITIAL_CHAT);
  const [history, setHistory] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function initHistory() {
      try {
        const loaded = await loadChatHistory();
        if (loaded && loaded.length > 0) {
          setHistory(loaded);
          const mappedMsgs = loaded.map((msg, i) => ({
            id: `hist-${i}`,
            role: msg.role === "user" ? "user" as const : "ai" as const,
            text: msg.content,
          }));
          setMsgs([...INITIAL_CHAT, ...mappedMsgs]);
        }
      } catch (err) {
        console.error("Failed to load chat history:", err);
      }
    }
    initHistory();
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, typing]);

  async function handleClear() {
    if (!window.confirm("Are you sure you want to clear your chat history?")) return;
    try {
      await clearChatHistory();
      setMsgs(INITIAL_CHAT);
      setHistory([]);
    } catch (err) {
      console.error("Failed to clear chat history:", err);
    }
  }

  async function send(text = input) {
    if (!text.trim() || typing) return;
    setInput("");
    setMsgs(m => [...m, { id: Date.now().toString(), role: "user", text }]);
    const nextHistory = [...history, { role: "user" as const, content: text }];
    setHistory(nextHistory);
    setTyping(true);
    try {
      const response = await sendChatMessage(nextHistory);
      setHistory(h => [...h, { role: "assistant", content: response.reply }]);
      setMsgs(m => [...m, {
        id: (Date.now() + 1).toString(),
        role: "ai",
        text: response.reply,
        ratedMovies: response.ratedMovies?.map(rateResponseToMovie),
        suggestedMovies: response.suggestedMovies,
      }]);
    } catch {
      setMsgs(m => [...m, {
        id: (Date.now() + 1).toString(),
        role: "ai",
        text: "Sorry, I couldn't get an answer just then — mind trying again?",
      }]);
    } finally {
      setTyping(false);
    }
  }

  function RatedMiniCard({ movie }: { movie: Movie }) {
    return (
      <button onClick={() => onMovie(movie)} className="flex-shrink-0 w-28 text-left bg-background border border-border rounded-xl overflow-hidden hover:border-primary/40 transition-colors">
        <div className="w-full h-36 relative" style={{ background: movie.gradient }}>
          {movie.posterUrl && <img src={movie.posterUrl} alt={movie.title} className="absolute inset-0 w-full h-full object-cover" />}
          <div className="absolute inset-0 flex items-end p-2 bg-gradient-to-t from-black/60 to-transparent"><SafeBadge rating={movie.rating} /></div>
        </div>
        <div className="p-2">
          <p className="text-[11px] font-semibold text-foreground leading-tight truncate">{movie.title}</p>
          <p className="text-[9px] text-muted-foreground mt-0.5">{movie.year}</p>
        </div>
      </button>
    );
  }

  function SuggestedMiniCard({ result }: { result: TmdbSearchResult }) {
    const isRating = ratingLoadingId === String(result.id);
    return (
      <button onClick={() => onSelectSuggested(result)} disabled={isRating}
        className="flex-shrink-0 w-28 text-left bg-background border border-border rounded-xl overflow-hidden hover:border-primary/40 transition-colors disabled:opacity-70">
        <div className="w-full h-36 relative bg-muted">
          {result.poster_path ? (
            <img src={`https://image.tmdb.org/t/p/w200${result.poster_path}`} alt={result.title} className="absolute inset-0 w-full h-full object-cover" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-[9px]">No poster</div>
          )}
          {isRating && <div className="absolute inset-0 bg-black/60 flex items-center justify-center"><span className="text-white text-[9px] font-semibold">Checking…</span></div>}
        </div>
        <div className="p-2">
          <p className="text-[11px] font-semibold text-foreground leading-tight truncate">{result.title}</p>
          <p className="text-[9px] text-muted-foreground mt-0.5">{result.release_date?.slice(0, 4) || "—"} · tap to check</p>
        </div>
      </button>
    );
  }

  return (
    <div className="flex flex-col h-full max-h-screen">
      {/* Header */}
      <div className="flex-shrink-0 px-8 py-5 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center"><Shield size={17} className="text-primary-foreground" /></div>
          <div>
            <p className="font-semibold text-foreground">ClearWatch AI</p>
            <p className="text-xs text-muted-foreground">Personalized to your profile · Always spoiler-free</p>
          </div>
        </div>
        <button onClick={handleClear} disabled={history.length === 0} title="Clear Chat History"
          className="p-2 rounded-xl text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 transition-colors disabled:opacity-30 disabled:pointer-events-none">
          <Trash2 size={18} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto px-8 py-6 space-y-5 scrollbar-hide max-w-3xl w-full mx-auto">
        {msgs.map(msg => (
          <div key={msg.id} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "ai" && (
              <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                <Shield size={13} className="text-primary-foreground" />
              </div>
            )}
            <div className="max-w-[70%]">
              <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${msg.role === "user" ? "bg-primary text-primary-foreground rounded-br-md" : "bg-card border border-border text-foreground rounded-bl-md"}`}>
                {msg.text}
              </div>
              {(msg.ratedMovies?.length || msg.suggestedMovies?.length) ? (
                <div className="mt-3 flex gap-3 overflow-x-auto scrollbar-hide pb-1">
                  {msg.ratedMovies?.map(m => <RatedMiniCard key={m.id} movie={m} />)}
                  {msg.suggestedMovies?.map(r => <SuggestedMiniCard key={r.id} result={r} />)}
                </div>
              ) : null}
            </div>
          </div>
        ))}
        {typing && (
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center flex-shrink-0"><Shield size={13} className="text-primary-foreground" /></div>
            <div className="bg-card border border-border rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1 items-center h-4">{[0, 1, 2].map(i => (
                <div key={i} className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s`, animationDuration: "0.8s" }} />
              ))}</div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Suggested prompts */}
      <div className="flex-shrink-0 px-8 pt-3 max-w-3xl w-full mx-auto">
        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-2">
          {SUGGESTED_PROMPTS.slice(0, 3).map(p => (
            <button key={p} onClick={() => send(p)} disabled={typing} className="flex-shrink-0 text-xs px-3 py-2 rounded-xl bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors text-left disabled:opacity-50">{p}</button>
          ))}
        </div>
      </div>

      {/* Input */}
      <div className="flex-shrink-0 px-8 py-4 border-t border-border max-w-3xl w-full mx-auto">
        <div className="flex items-center gap-3 bg-card border border-border rounded-2xl px-5 py-3">
          <input type="text" placeholder="Ask about any movie or show…" value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && send()} disabled={typing} className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none text-sm disabled:opacity-60" />
          <button onClick={() => send()} disabled={!input.trim() || typing} className="w-9 h-9 bg-primary rounded-xl flex items-center justify-center disabled:opacity-30 transition-opacity flex-shrink-0">
            <Send size={15} className="text-primary-foreground" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Watchlist Screen ─────────────────────────────────────────────────────────

function WatchlistScreen({ movies, watchlist, onMovie, onRemove }: {
  movies: Movie[]; watchlist: Set<string>; onMovie: (m: Movie) => void; onRemove: (id: string) => void;
}) {
  const saved = movies.filter(m => watchlist.has(m.id));
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="text-3xl text-foreground" style={{ fontFamily: "'Fraunces', Georgia, serif", fontWeight: 500 }}>Watchlist</h1>
          <p className="text-muted-foreground text-sm mt-1">{saved.length} {saved.length === 1 ? "title" : "titles"} saved</p>
        </div>
      </div>

      {saved.length === 0 ? (
        <div className="flex flex-col items-center py-32 text-center">
          <Bookmark size={56} className="text-muted-foreground/20 mb-6" />
          <h2 className="text-xl text-foreground font-semibold mb-2">Your watchlist is empty</h2>
          <p className="text-muted-foreground max-w-sm leading-relaxed">Browse movies and click the bookmark icon to save titles here. Your watchlist is private and synced across devices.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {saved.map(m => (
            <div key={m.id} className="relative group" onMouseEnter={() => setHoveredId(m.id)} onMouseLeave={() => setHoveredId(null)}>
              <div className="aspect-[2/3] rounded-2xl overflow-hidden cursor-pointer relative" style={{ background: m.gradient }} onClick={() => onMovie(m)}>
                {m.posterUrl && (
                  <img src={m.posterUrl} alt={m.title} className="absolute inset-0 w-full h-full object-cover" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
                <div className="absolute top-2.5 left-2.5"><SafeBadge rating={m.rating} /></div>
                <div className={`absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-3 transition-opacity duration-200 ${hoveredId === m.id ? "opacity-100" : "opacity-0"}`}>
                  <button className="flex items-center gap-2 bg-white text-black text-xs font-semibold px-4 py-2 rounded-xl">
                    <Play size={14} className="ml-0.5" /> View Details
                  </button>
                  <button onClick={e => { e.stopPropagation(); onRemove(m.id); }}
                    className="flex items-center gap-1.5 text-white/80 text-xs hover:text-white transition-colors">
                    <X size={13} /> Remove
                  </button>
                </div>
                <div className="absolute bottom-0 left-0 right-0 p-3">
                  <p className="text-white font-semibold text-sm truncate">{m.title}</p>
                  <p className="text-white/50 text-[10px]">{m.year}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Profile Screen ───────────────────────────────────────────────────────────

function ProfileScreen({ userName, darkMode, onToggleDark, profile, onUpdateProfile, onEditProfile, onRetakeOnboarding, onLogout }: {
  userName: string; darkMode: boolean; onToggleDark: () => void;
  profile: UserProfile | null; onUpdateProfile: (patch: Partial<UserProfile>) => void;
  onEditProfile: () => void; onRetakeOnboarding: () => void; onLogout: () => void;
}) {
  const strictness = profile?.strictness ?? 60;
  const kidsMode = profile?.kidsMode ?? false;
  const notifs = profile?.notifications ?? true;
  const strictLabel = strictness < 33 ? "Lenient" : strictness < 66 ? "Balanced" : "Strict";
  const activeSensitivities =
    (profile?.visualSensitivities?.length ?? 0) +
    (profile?.audioSensitivities?.length ?? 0) +
    (profile?.triggers?.length ?? 0);

  const [reporting, setReporting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleReportTrigger() {
    const movieTitle = window.prompt("Which movie or show is this about?");
    if (!movieTitle) return;
    const note = window.prompt(`What trigger is missing or wrong for "${movieTitle}"?`);
    if (!note) return;
    setReporting(true);
    try {
      await apiReportMissingTrigger(movieTitle, movieTitle, note);
      window.alert("Thanks — that's been sent in for review.");
    } catch {
      window.alert("Couldn't submit that right now. Try again in a moment.");
    } finally {
      setReporting(false);
    }
  }

  async function handleDeleteAccount() {
    const confirmed = window.confirm(
      "This permanently deletes your profile, watchlist, and saved data. This can't be undone. Are you sure?"
    );
    if (!confirmed) return;
    setDeleting(true);
    try {
      await deleteAccountData();
      await deleteFirebaseAccount();
      onLogout();
    } catch (err) {
      const msg = err instanceof Error && err.message.includes("requires-recent-login")
        ? "For security, please log out and log back in, then try deleting your account again."
        : "Couldn't delete your account right now. Try again in a moment.";
      window.alert(msg);
    } finally {
      setDeleting(false);
    }
  }

  function ToggleRow({ label, sub, value, onToggle, icon }: { label: string; sub: string; value: boolean; onToggle: () => void; icon: React.ReactNode }) {
    return (
      <div className="flex items-center gap-4 py-4 border-b border-border last:border-0">
        <span className="text-muted-foreground w-5">{icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">{label}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
        </div>
        <button role="switch" aria-checked={value} onClick={onToggle}
          className="relative w-11 h-6 rounded-full transition-colors flex-shrink-0"
          style={{ backgroundColor: value ? "var(--primary)" : "var(--switch-background)" }}>
          <span className="absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all" style={{ left: value ? 24 : 4 }} />
        </button>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-8">
      <h1 className="text-3xl text-foreground" style={{ fontFamily: "'Fraunces', Georgia, serif", fontWeight: 500 }}>Profile & Settings</h1>

      {/* Profile card */}
      <div className="bg-card border border-border rounded-3xl p-6 flex items-center gap-5">
        <div className="w-16 h-16 bg-primary/20 rounded-full flex items-center justify-center text-primary text-2xl font-bold flex-shrink-0">{userName[0]?.toUpperCase()}</div>
        <div className="flex-1">
          <p className="font-semibold text-foreground text-lg">{userName}</p>
          <p className="text-sm text-muted-foreground mt-0.5">{activeSensitivities} active sensitivities · {strictLabel} strictness</p>
        </div>
        <button onClick={onEditProfile} className="border border-border text-foreground text-sm font-medium px-4 py-2 rounded-xl hover:bg-muted transition-colors">Edit profile</button>
      </div>

      {/* Strictness — now actually feeds the AI's rating prompt */}
      <div className="bg-card border border-border rounded-3xl p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={16} className="text-primary" />
            <h2 className="font-semibold text-foreground text-sm">Rating Strictness</h2>
          </div>
          <span className="text-sm font-semibold text-primary">{strictLabel}</span>
        </div>
        <input type="range" min={0} max={100} value={strictness}
          onChange={e => onUpdateProfile({ strictness: +e.target.value })}
          className="w-full accent-primary h-1.5 rounded-full" />
        <div className="flex justify-between text-xs text-muted-foreground mt-2"><span>Lenient</span><span>Very Strict</span></div>
        <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
          {strictness < 33 ? "Minor content flags won't affect your rating. Only significant concerns will show warnings."
            : strictness < 66 ? "A balanced approach — most content flags are shown with context and explanation."
              : "Maximum care. Any matching trigger immediately affects your rating."}
        </p>
      </div>

      {/* Preferences */}
      <div className="bg-card border border-border rounded-3xl p-6">
        <h2 className="font-semibold text-foreground text-sm mb-4">Preferences</h2>
        <ToggleRow label="Kids Mode" sub="Apply extra-strict filtering for all content" value={kidsMode}
          onToggle={() => onUpdateProfile({ kidsMode: !kidsMode })} icon={<Baby size={16} />} />
        <ToggleRow label="Notifications" sub="New safe picks and profile improvement suggestions" value={notifs}
          onToggle={() => onUpdateProfile({ notifications: !notifs })} icon={<Bell size={16} />} />
        <ToggleRow label={darkMode ? "Dark Mode" : "Light Mode"} sub="Toggle between light and dark interface" value={darkMode} onToggle={onToggleDark} icon={darkMode ? <Moon size={16} /> : <Sun size={16} />} />
      </div>

      {/* Actions */}
      <div className="bg-card border border-border rounded-3xl overflow-hidden">
        {[
          { label: "Edit Sensitivity Profile", icon: <SlidersHorizontal size={16} />, cls: "text-foreground", onClick: onEditProfile },
          { label: "Re-take Onboarding Questionnaire", icon: <RotateCcw size={16} />, cls: "text-foreground", onClick: onRetakeOnboarding },
          { label: reporting ? "Submitting…" : "Report a Missing Trigger", icon: <Flag size={16} />, cls: "text-foreground", onClick: handleReportTrigger, disabled: reporting },
          { label: deleting ? "Deleting…" : "Delete Account", icon: <X size={16} />, cls: "text-destructive", onClick: handleDeleteAccount, disabled: deleting },
        ].map((item, i, arr) => (
          <button key={item.label} onClick={item.onClick} disabled={item.disabled}
            className={`w-full flex items-center gap-4 px-6 py-4 text-left hover:bg-muted/50 transition-colors disabled:opacity-60 ${i < arr.length - 1 ? "border-b border-border" : ""}`}>
            <span className={item.cls}>{item.icon}</span>
            <span className={`text-sm font-medium flex-1 ${item.cls}`}>{item.label}</span>
            <ChevronRight size={14} className="text-muted-foreground" />
          </button>
        ))}
      </div>

      <p className="text-center text-xs text-muted-foreground pb-4">ClearWatch v1.0 · Made with care for every viewer ♡</p>
    </div>
  );
}

// ─── Notification Panel ───────────────────────────────────────────────────────

function NotificationPanel({ onClose }: { onClose: () => void }) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const TMDB_IMG = "https://image.tmdb.org/t/p/w92";

  useEffect(() => {
    getNotifications()
      .then(data => setNotifications(data.notifications))
      .catch(() => {})
      .finally(() => setLoading(false));
    // Mark all read when panel opens
    markNotificationsRead().catch(() => {});
  }, []);

  function timeAgo(iso: string) {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className="absolute top-14 right-4 lg:right-8 w-80 bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <p className="font-semibold text-foreground text-sm">Notifications</p>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X size={15} /></button>
        </div>

        {/* Body */}
        <div className="max-h-96 overflow-y-auto scrollbar-hide">
          {loading && (
            <div className="text-center py-8 text-muted-foreground text-sm">Loading…</div>
          )}
          {!loading && notifications.length === 0 && (
            <div className="text-center py-10">
              <Bell size={28} className="text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-muted-foreground text-sm">You're all caught up!</p>
              <p className="text-muted-foreground/60 text-xs mt-1">New safe picks and updates will appear here.</p>
            </div>
          )}
          {!loading && notifications.map(n => (
            <div key={n.id} className={`flex gap-3 px-4 py-3 border-b border-border last:border-none ${!n.read ? "bg-primary/5" : ""}`}>
              {n.posterPath ? (
                <img src={`${TMDB_IMG}${n.posterPath}`} alt={n.movieTitle ?? ""} className="w-10 h-14 rounded-lg object-cover flex-shrink-0" />
              ) : (
                <div className="w-10 h-14 rounded-lg bg-muted flex-shrink-0 flex items-center justify-center">
                  <Bell size={14} className="text-muted-foreground" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-foreground leading-tight">{n.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{n.body}</p>
                <p className="text-[10px] text-muted-foreground/50 mt-1">{timeAgo(n.createdAt)}</p>
              </div>
              {!n.read && <div className="w-2 h-2 bg-primary rounded-full mt-1 flex-shrink-0" />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── App Shell ────────────────────────────────────────────────────────────────

function AppShell({ userName, userProfile, darkMode, onToggleDark, onLogout, onUpdateProfile, onEditProfile, onRetakeOnboarding }: {
  userName: string; userProfile: UserProfile | null; darkMode: boolean; onToggleDark: () => void; onLogout: () => void;
  onUpdateProfile: (patch: Partial<UserProfile>) => void;
  onEditProfile: () => void;
  onRetakeOnboarding: () => void;
}) {
  const [tab, setTab] = useState<Tab>("home");
  const [watchlistMovies, setWatchlistMovies] = useState<Movie[]>([]);
  const [watchlist, setWatchlist] = useState<Set<string>>(new Set());
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [ratingLoadingId, setRatingLoadingId] = useState<string | null>(null);
  const [ratingError, setRatingError] = useState<string | null>(null);
  const [homeMovies, setHomeMovies] = useState<Movie[]>([]);
  const [homeLoading, setHomeLoading] = useState(true);
  const [collections, setCollections] = useState<Record<string, CollectionMovie[]>>({});
  const [openCollection, setOpenCollection] = useState<string | null>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // Recently Viewed — persisted in localStorage so it survives refreshes.
  // Seeded on mount; updated whenever a movie detail is opened from any surface.
  const RECENTLY_VIEWED_KEY = "cw_recently_viewed";
  const RECENTLY_VIEWED_MAX = 10;
  const [recentlyViewed, setRecentlyViewed] = useState<Movie[]>(() => {
    try {
      const raw = localStorage.getItem(RECENTLY_VIEWED_KEY);
      return raw ? (JSON.parse(raw) as Movie[]) : [];
    } catch {
      return [];
    }
  });

  // Wrapper used everywhere a movie detail is opened — records the view
  // before showing the modal. Deduped (most recent wins) and capped at MAX.
  function openMovieDetail(movie: Movie) {
    setRecentlyViewed(prev => {
      const deduped = [movie, ...prev.filter(m => m.id !== movie.id)].slice(0, RECENTLY_VIEWED_MAX);
      try { localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(deduped)); } catch { /* storage full — not fatal */ }
      return deduped;
    });
    setSelectedMovie(movie);
  }

  useEffect(() => {
    apiGetCollections().then(setCollections).catch(() => { /* tiles just show 0 titles */ });
  }, []);

  // Poll unread notification count once on mount
  useEffect(() => {
    getNotifications()
      .then(data => setUnreadCount(data.unreadCount))
      .catch(() => {});
  }, []);

  // Load real recommendations once when the app opens (cached server-side
  // for 24h, so this is instant except the first time each day).
  useEffect(() => {
    apiGetRecommendations()
      .then(results => setHomeMovies(results.map(rateResponseToMovie)))
      .catch(() => { /* not fatal — dashboard just shows the empty state */ })
      .finally(() => setHomeLoading(false));
  }, []);

  // Load the real saved watchlist once when the app opens
  useEffect(() => {
    apiGetWatchlist<Movie>()
      .then(movies => {
        setWatchlistMovies(movies);
        setWatchlist(new Set(movies.map(m => m.id)));
      })
      .catch(() => { /* not fatal — watchlist tab just starts empty */ });
  }, []);

  // Calls the real backend: TMDb detail + Does the Dog Die scrape + Claude rating.
  // Takes 15-20s since the scraper has to load a real page — that's normal.
  async function handleSelectResult(result: TmdbSearchResult) {
    setRatingLoadingId(String(result.id));
    setRatingError(null);
    try {
      const data = await apiRateMovie(result.id, userProfile ?? {});
      openMovieDetail(rateResponseToMovie(data));
    } catch (err) {
      setRatingError("Couldn't get a safety rating for that title. Try again?");
    } finally {
      setRatingLoadingId(null);
    }
  }

  async function addMovieToWatchlist(movie: Movie) {
    setWatchlistMovies(w => [...w, movie]);
    setWatchlist(w => new Set(w).add(movie.id));
    try {
      await apiAddToWatchlist(movie);
    } catch {
      // roll back on failure so the UI doesn't lie about what's actually saved
      setWatchlistMovies(w => w.filter(m => m.id !== movie.id));
      setWatchlist(w => { const n = new Set(w); n.delete(movie.id); return n; });
    }
  }

  async function removeMovieFromWatchlist(id: string) {
    const removed = watchlistMovies.find(m => m.id === id);
    setWatchlistMovies(w => w.filter(m => m.id !== id));
    setWatchlist(w => { const n = new Set(w); n.delete(id); return n; });
    try {
      await apiRemoveFromWatchlist(id);
    } catch {
      if (removed) {
        setWatchlistMovies(w => [...w, removed]);
        setWatchlist(w => new Set(w).add(id));
      }
    }
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar tab={tab} onTab={t => { setTab(t); setMobileMenuOpen(false); }} darkMode={darkMode} onToggleDark={onToggleDark} onLogout={onLogout} userName={userName} />

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile topbar */}
        <div className="lg:hidden flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-primary rounded-md flex items-center justify-center"><Shield size={13} className="text-primary-foreground" /></div>
            <span className="font-semibold text-foreground text-sm" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>ClearWatch</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { setNotifOpen(v => !v); if (!notifOpen) setUnreadCount(0); }} className="relative w-9 h-9 flex items-center justify-center text-muted-foreground hover:text-foreground">
              <Bell size={18} />
              {unreadCount > 0 && <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-primary rounded-full border border-background" />}
            </button>
            <button onClick={() => setMobileMenuOpen(v => !v)} className="w-9 h-9 flex items-center justify-center text-muted-foreground"><Menu size={18} /></button>
          </div>
        </div>

        {/* Mobile nav drawer */}
        {mobileMenuOpen && (
          <div className="lg:hidden fixed inset-0 z-50">
            <div className="absolute inset-0 bg-black/50" onClick={() => setMobileMenuOpen(false)} />
            <div className="absolute left-0 top-0 bottom-0 w-64 bg-sidebar border-r border-sidebar-border p-4 space-y-1">
              {([
                { id: "home" as Tab, label: "Home" }, { id: "search" as Tab, label: "Search" },
                { id: "chat" as Tab, label: "AI Assistant" }, { id: "watchlist" as Tab, label: "Watchlist" },
                { id: "profile" as Tab, label: "Profile" },
              ]).map(item => (
                <button key={item.id} onClick={() => { setTab(item.id); setMobileMenuOpen(false); }}
                  className={`w-full text-left px-4 py-3 rounded-xl text-sm font-medium transition-colors ${tab === item.id ? "bg-primary/15 text-primary" : "text-sidebar-foreground/70"}`}>
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Desktop topbar */}
        <div className="hidden lg:flex flex-shrink-0 items-center justify-between px-8 py-4 border-b border-border">
          <div /> {/* spacer */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setNotifOpen(v => !v); if (!notifOpen) setUnreadCount(0); }}
              className="relative w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <Bell size={18} />
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-primary rounded-full border border-background" />
              )}
            </button>
            <button onClick={() => setTab("profile")} className="w-9 h-9 bg-primary/20 rounded-full flex items-center justify-center text-primary text-sm font-bold hover:bg-primary/30 transition-colors">
              {userName[0]?.toUpperCase()}
            </button>
          </div>
        </div>

        {/* Content */}
        <main className="flex-1 overflow-y-auto scrollbar-hide">
          {tab === "home" && <HomeScreen movies={homeMovies} loading={homeLoading} watchlist={watchlist} onMovie={openMovieDetail} userName={userName} collections={collections} onOpenCollection={setOpenCollection} recentlyViewed={recentlyViewed} />}
          {openCollection && (
            <CollectionModal
              label={COLLECTIONS.find(c => c.id === openCollection)?.label ?? "Collection"}
              movies={collections[openCollection] ?? []}
              onSelectResult={result => { setOpenCollection(null); handleSelectResult(result); }} // detail opened via handleSelectResult → openMovieDetail
              ratingLoadingId={ratingLoadingId}
              onClose={() => setOpenCollection(null)}
            />
          )}
          {tab === "search" && <SearchScreen onSelectResult={handleSelectResult} ratingLoadingId={ratingLoadingId} />}
          {ratingError && (
            <div className="mx-8 mb-4 px-4 py-3 rounded-xl bg-destructive/10 text-destructive text-sm">{ratingError}</div>
          )}
          {tab === "chat" && <ChatScreen onMovie={openMovieDetail} onSelectSuggested={handleSelectResult} ratingLoadingId={ratingLoadingId} />}
          {tab === "watchlist" && <WatchlistScreen movies={watchlistMovies} watchlist={watchlist} onMovie={openMovieDetail} onRemove={removeMovieFromWatchlist} />}
          {tab === "profile" && (
            <ProfileScreen
              userName={userName} darkMode={darkMode} onToggleDark={onToggleDark}
              profile={userProfile} onUpdateProfile={onUpdateProfile}
              onEditProfile={onEditProfile} onRetakeOnboarding={onRetakeOnboarding}
              onLogout={onLogout}
            />
          )}
        </main>

        {/* Mobile bottom nav */}
        <div className="lg:hidden flex-shrink-0 border-t border-border">
          <div className="flex items-center justify-around px-2 py-2">
            {([
              { id: "home" as Tab, icon: <Home size={20} />, label: "Home" },
              { id: "search" as Tab, icon: <Search size={20} />, label: "Search" },
              { id: "chat" as Tab, icon: <MessageCircle size={20} />, label: "AI" },
              { id: "watchlist" as Tab, icon: <Bookmark size={20} />, label: "List" },
              { id: "profile" as Tab, icon: <User size={20} />, label: "Profile" },
            ]).map(item => (
              <button key={item.id} onClick={() => setTab(item.id)}
                className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-colors ${tab === item.id ? "text-primary" : "text-muted-foreground"}`}>
                {item.icon}
                <span className="text-[9px] font-semibold">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Movie detail modal */}
      {selectedMovie && (
        <MovieDetailModal movie={selectedMovie} inWatchlist={watchlist.has(selectedMovie.id)}
          onClose={() => setSelectedMovie(null)} onToggleWatchlist={() => watchlist.has(selectedMovie.id) ? removeMovieFromWatchlist(selectedMovie.id) : addMovieToWatchlist(selectedMovie)} />  
      )}

      {/* Notification panel */}
      {notifOpen && <NotificationPanel onClose={() => setNotifOpen(false)} />}
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [view, setView] = useState<AppView>("landing");
  const [userName, setUserName] = useState("Sarah");
  const [darkMode, setDarkMode] = useState(true);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);

  // Used by Settings for "Edit Sensitivity Profile" (prefilled) vs
  // "Re-take Onboarding Questionnaire" (blank).
  function goToOnboarding(edit: boolean) {
    setEditingProfile(edit);
    setView("onboarding");
  }

  // Real update+persist for settings toggles (strictness, Kids Mode,
  // notifications) — merges into the existing profile and saves it.
  function updateProfile(patch: Partial<UserProfile>) {
    setUserProfile(prev => {
      const next = { ...(prev ?? ({} as UserProfile)), ...patch };
      saveProfile(next).catch(() => { /* not fatal — still applied this session */ });
      return next;
    });
  }

  return (
    <div className={darkMode ? "dark" : ""}>
      {view === "landing" && (
        <LandingPage
          onGetStarted={() => setView("onboarding")}
          onLogin={async () => {
            try {
              const profile = await loadProfile();
              if (profile) {
                setUserProfile(profile as UserProfile);
                setUserName((profile as UserProfile).name || "Friend");
                setView("app");
              } else {
                setView("onboarding"); // no saved profile on this device yet — treat as new user
              }
            } catch {
              setView("onboarding"); // backend unreachable or nothing saved — fall back safely
            }
          }}
        />
      )}
      {view === "onboarding" && (
        <OnboardingFlow
          initialProfile={editingProfile ? userProfile : null}
          onComplete={(name, profile) => {
            setUserName(name);
            setUserProfile(profile);
            setView("app");
            setEditingProfile(false);
            saveProfile(profile).catch(() => { /* not fatal — profile still works this session */ });
          }}
        />
      )}
      {view === "app" && (
        <AppShell
          userName={userName} userProfile={userProfile} darkMode={darkMode}
          onToggleDark={() => setDarkMode(v => !v)}
          onLogout={() => { logOut().catch(() => { }); setView("landing"); }}
          onUpdateProfile={updateProfile}
          onEditProfile={() => goToOnboarding(true)}
          onRetakeOnboarding={() => goToOnboarding(false)}
        />
      )}
    </div>
  );
}
