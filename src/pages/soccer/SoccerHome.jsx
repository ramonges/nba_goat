import { Link } from "react-router-dom";
import "./Soccer.css";

export default function SoccerHome() {
  return (
    <div className="soccer-home">
      <section className="soccer-hero">
        <p className="soccer-hero-tag">Other sports · Soccer</p>
        <h1 className="soccer-hero-title">
          Soccer <span>GOAT Lab</span>
        </h1>
        <p className="soccer-hero-sub">
          Same configuration as the NBA lab — adapted categories, columns, and
          competitions. Step 1 establishes distributions before any composite
          score.
        </p>
      </section>

      <section className="soccer-tools">
        <Link to="/soccer/stats-comparison" className="soccer-tool-card">
          <span className="soccer-tool-step">Step 1</span>
          <h3>Stats Distribution Comparison</h3>
          <p>
            Overlay game-level distributions for goals, xG, xA, shots, touches,
            rating, and more. Filter by domestic league or Champions League.
          </p>
          <span className="soccer-tool-link">Open →</span>
        </Link>

        <Link to="/soccer/goat-ranking" className="soccer-tool-card">
          <span className="soccer-tool-step">Step 2</span>
          <h3>Soccer GOAT Ranking</h3>
          <p>
            Build your own category weights, then rank players with the same
            two-step EI transform as the NBA lab (sigmoid → hierarchical RMS).
          </p>
          <span className="soccer-tool-link">Open →</span>
        </Link>
      </section>
    </div>
  );
}
