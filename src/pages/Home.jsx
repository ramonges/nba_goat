import { Link } from "react-router-dom";
import "./Home.css";

export default function Home() {
  return (
    <div className="home">
      <section className="hero-section">
        <p className="hero-tag">Player Analytics Platform</p>
        <h1 className="hero-title">
          <span className="hero-nba">NBA </span>
          <span className="hero-goat">GOAT</span>
        </h1>
        <p className="hero-subtitle">
          Game-by-game statistical distributions for hundreds of players.
          <br />
          Compare careers, seasons, and performance under pressure.
        </p>
        <Link to="/stats-comparison" className="hero-cta">
          Open Comparison Tool
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M3 8h10m0 0L9 4m4 4L9 12"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>
      </section>

      <section className="tools-section">
        <div className="section-label">Tools</div>
        <div className="tools-grid">
          <Link to="/stats-comparison" className="tool-card">
            <div className="tool-card-header">
              <div className="tool-indicator" />
              <span className="tool-badge">Active</span>
            </div>
            <h3>Stats Distribution Comparison</h3>
            <p>
              Compare per-game statistical distributions across multiple
              players. Filter by regular season or playoffs, select any metric,
              and visualize career or per-season breakdowns.
            </p>
            <span className="tool-link">
              Open
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path
                  d="M3 8h10m0 0L9 4m4 4L9 12"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </Link>

          <Link to="/metrics-comparison" className="tool-card">
            <div className="tool-card-header">
              <div className="tool-indicator" />
              <span className="tool-badge">Active</span>
            </div>
            <h3>NBA Metrics Player Comparison</h3>
            <p>
              Rank all NBA players using the Excellence Index framework.
              Customize metric weights, choose top seasons windows, and explore
              detailed player breakdowns.
            </p>
            <span className="tool-link">
              Open
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path
                  d="M3 8h10m0 0L9 4m4 4L9 12"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </Link>

          <Link to="/discover-goat" className="tool-card">
            <div className="tool-card-header">
              <div className="tool-indicator" />
              <span className="tool-badge">New</span>
            </div>
            <h3>Discover the GOAT of the NBA</h3>
            <p>
              Dynamic simulation dashboard — adjust weights in real-time and
              watch the GOAT ranking update instantly. Your personal take on
              who's the greatest.
            </p>
            <span className="tool-link">
              Open
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path
                  d="M3 8h10m0 0L9 4m4 4L9 12"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </Link>
        </div>
      </section>
    </div>
  );
}
