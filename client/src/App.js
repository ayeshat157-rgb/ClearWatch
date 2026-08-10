import { useState } from "react";

function App() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [selectedMovie, setSelectedMovie] = useState(null);
  const [loading, setLoading] = useState(false);
  const [userProfile, setUserProfile] = useState("");
  const [profileSet, setProfileSet] = useState(false);

  const searchMovies = async () => {
    if (!query) return;
    setLoading(true);
    setSelectedMovie(null);
    try {
      const res = await fetch(
        `http://localhost:5000/api/movies/search?query=${query}`
      );
      const data = await res.json();
      setResults(data.results || []);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const rateMovie = async (id) => {
    setLoading(true);
    try {
      const res = await fetch(`http://localhost:5000/api/movies/${id}/rate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userProfile }),
      });
      const data = await res.json();
      console.log('API response:', data);
      setSelectedMovie(data);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const ratingColor = {
    GREEN: "#27ae60",
    YELLOW: "#f39c12",
    RED: "#e74c3c",
  };

  const ratingEmoji = {
    GREEN: "✅",
    YELLOW: "⚠️",
    RED: "🚫",
  };

  // Onboarding screen
  if (!profileSet) {
    return (
      <div style={{ fontFamily: "Arial", maxWidth: "600px", margin: "80px auto", padding: "20px" }}>
        <h1 style={{ color: "#2c3e50" }}>🎬 ClearWatch</h1>
        <p style={{ color: "#7f8c8d", fontSize: "16px" }}>
          Tell us about yourself so we can personalize movie safety ratings for you.
        </p>
        <textarea
          placeholder="Example: I'm a trauma survivor sensitive to domestic violence and suicide. I also prefer to avoid drug use and self harm scenes. I'm watching this with my 10 year old daughter."
          value={userProfile}
          onChange={(e) => setUserProfile(e.target.value)}
          rows={6}
          style={{ width: "100%", padding: "12px", fontSize: "15px", borderRadius: "8px", border: "1px solid #ddd", marginBottom: "15px", boxSizing: "border-box" }}
        />
        <button
          onClick={() => setProfileSet(true)}
          disabled={!userProfile}
          style={{ width: "100%", padding: "12px", backgroundColor: "#3498db", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "16px" }}
        >
          Start Watching Safely →
        </button>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "Arial", maxWidth: "800px", margin: "0 auto", padding: "20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ color: "#2c3e50" }}>🎬 ClearWatch</h1>
        <button
          onClick={() => { setProfileSet(false); setSelectedMovie(null); setResults([]); }}
          style={{ padding: "8px 16px", borderRadius: "8px", border: "1px solid #ddd", cursor: "pointer" }}
        >
          Edit Profile
        </button>
      </div>

      <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
        <input
          type="text"
          placeholder="Search for a movie..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && searchMovies()}
          style={{ flex: 1, padding: "10px", fontSize: "16px", borderRadius: "8px", border: "1px solid #ddd" }}
        />
        <button
          onClick={searchMovies}
          style={{ padding: "10px 20px", backgroundColor: "#3498db", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "16px" }}
        >
          Search
        </button>
      </div>

      {loading && (
        <div style={{ textAlign: "center", padding: "40px" }}>
          <p style={{ fontSize: "18px", color: "#7f8c8d" }}>
            {selectedMovie ? "Analyzing..." : "Searching..."}
          </p>
          {!selectedMovie && results.length === 0 && (
            <p style={{ fontSize: "14px", color: "#bdc3c7" }}>
              This may take 15-20 seconds while we gather content data...
            </p>
          )}
        </div>
      )}

      {!selectedMovie && !loading && results.map((movie) => (
        <div
          key={movie.id}
          onClick={() => rateMovie(movie.id)}
          style={{ display: "flex", gap: "15px", padding: "15px", marginBottom: "10px", border: "1px solid #ddd", borderRadius: "8px", cursor: "pointer", backgroundColor: "#f9f9f9" }}
        >
          {movie.poster_path && (
            <img
              src={`https://image.tmdb.org/t/p/w92${movie.poster_path}`}
              alt={movie.title}
              style={{ borderRadius: "4px" }}
            />
          )}
          <div>
            <h3 style={{ margin: "0 0 5px" }}>{movie.title}</h3>
            <p style={{ margin: "0", color: "#7f8c8d", fontSize: "14px" }}>{movie.release_date?.split("-")[0]}</p>
            <p style={{ margin: "5px 0 0", fontSize: "14px" }}>{movie.overview?.slice(0, 150)}...</p>
          </div>
        </div>
      ))}

      {selectedMovie && !loading && (
        <div>
          <button
            onClick={() => setSelectedMovie(null)}
            style={{ marginBottom: "15px", padding: "8px 16px", cursor: "pointer", borderRadius: "8px", border: "1px solid #ddd" }}
          >
            ← Back to results
          </button>

          {/* AI Rating Card */}
          <div style={{
            backgroundColor: ratingColor[selectedMovie.rating?.rating],
            borderRadius: "12px",
            padding: "20px",
            marginBottom: "20px",
            color: "white"
          }}>
            <h2 style={{ margin: "0 0 10px" }}>
              {ratingEmoji[selectedMovie.rating?.rating]} {selectedMovie.rating?.rating} — {selectedMovie.movie.title}
            </h2>
            <p style={{ margin: "0 0 15px", fontSize: "16px" }}>{selectedMovie.rating?.explanation}</p>
            <div>
              <strong>Top triggers for you:</strong>
              <ul style={{ margin: "8px 0 0" }}>
                {selectedMovie.rating?.topTriggers?.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
          </div>

          {/* Movie Details */}
          <div style={{ display: "flex", gap: "20px", marginBottom: "20px" }}>
            {selectedMovie.movie.poster_path && (
              <img
                src={`https://image.tmdb.org/t/p/w185${selectedMovie.movie.poster_path}`}
                alt={selectedMovie.movie.title}
                style={{ borderRadius: "8px" }}
              />
            )}
            <div>
              <h2 style={{ margin: "0 0 10px" }}>{selectedMovie.movie.title} ({selectedMovie.movie.release_date?.split("-")[0]})</h2>
              <p>{selectedMovie.movie.overview}</p>
              <p><strong>Genres:</strong> {selectedMovie.movie.genres.map(g => g.name).join(", ")}</p>
              <p><strong>Rating:</strong> ⭐ {selectedMovie.movie.vote_average}/10</p>
              <p><strong>Runtime:</strong> {selectedMovie.movie.runtime} mins</p>
            </div>
          </div>

          {/* All Triggers */}
          <h3>Full Content Breakdown</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            {selectedMovie.triggers
              ?.filter(t => parseInt(t.yes?.replace(/\D/g, '')) > 0)
              .map((t, i) => (
                <div key={i} style={{ padding: "8px 12px", backgroundColor: "#fff3cd", borderRadius: "6px", fontSize: "13px", border: "1px solid #ffc107" }}>
                  ⚠️ {t.topic}
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;