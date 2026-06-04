import { useState, useCallback } from "react";

import Select from "react-select";
import Plotly from "plotly.js-dist-min";
import factoryModule from "react-plotly.js/factory";
import { ALL_PLAYERS } from "../lib/players";
import {
  CATEGORY_GROUPS,
  DEFAULT_CATEGORY_WEIGHTS,
  DEFAULT_SUBCATEGORY_WEIGHTS,
  fetchPlayerSeasonAverages,
  fetchSeasonData,
  computeEIScoresHierarchical,
} from "../lib/eiComputation";
import "./WembyIndicator.css";

const createPlotlyComponent = factoryModule.default || factoryModule;
const Plot = createPlotlyComponent(Plotly);

const PLAYER_OPTIONS = ALL_PLAYERS.map((n) => ({ value: n, label: n }));

const TARGET_RANK_OPTIONS = [
  { value: 1, label: "Top 1 (GOAT)" },
  { value: 3, label: "Top 3" },
  { value: 5, label: "Top 5" },
  { value: 10, label: "Top 10" },
  { value: 15, label: "Top 15" },
];

// Generate season options (e.g. "2023-24", "2022-23", ...)
const SEASON_OPTIONS = (() => {
  const options = [];
  for (let year = 2024; year >= 1947; year--) {
    const label = `${year - 1}-${String(year).slice(2)}`;
    options.push({ value: label, label });
  }
  return options;
})();

const selectStyles = {
  control: (base, state) => ({
    ...base,
    background: "#141821",
    borderColor: state.isFocused
      ? "rgba(74,127,255,0.4)"
      : "rgba(255,255,255,0.06)",
    boxShadow: state.isFocused ? "0 0 0 1px rgba(74,127,255,0.2)" : "none",
    borderRadius: 6,
    minHeight: 38,
    "&:hover": { borderColor: "rgba(255,255,255,0.12)" },
  }),
  input: (base) => ({ ...base, color: "#e8eaed" }),
  singleValue: (base) => ({ ...base, color: "#e8eaed", fontSize: "0.82rem" }),
  option: (base, state) => ({
    ...base,
    background: state.isSelected
      ? "rgba(74,127,255,0.2)"
      : state.isFocused
        ? "#1f2537"
        : "#141821",
    color: state.isSelected ? "#e8eaed" : "#8b92a5",
    fontSize: "0.82rem",
    padding: "7px 12px",
  }),
  placeholder: (base) => ({ ...base, color: "#565d72", fontSize: "0.82rem" }),
  menu: (base) => ({
    ...base,
    background: "#141821",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    overflow: "hidden",
    zIndex: 100,
    boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
  }),
  menuList: (base) => ({ ...base, padding: 4, maxHeight: 320 }),
  menuPortal: (base) => ({ ...base, zIndex: 100 }),
  noOptionsMessage: (base) => ({
    ...base,
    color: "#565d72",
    fontSize: "0.8rem",
  }),
};

const CATEGORY_INFO = {
  "Scoring Production": { summary: "Measures overall offensive output per season", metrics: ["Points per game", "Points per 36 minutes", "Game Score mean"], direction: "Higher is better" },
  "Minutes Load": { summary: "Total playing time contribution", metrics: ["Total minutes in season", "Minutes per game"], direction: "Higher is better" },
  "Games Played": { summary: "Availability and durability", metrics: ["Games played"], direction: "Higher is better" },
  "Total Rebounding": { summary: "Overall rebounding ability", metrics: ["Rebounds per game", "Rebounds per 36 min"], direction: "Higher is better" },
  "Offensive Rebounding": { summary: "Offensive boards", metrics: ["Off. rebounds per game", "Off. rebounds per 36 min"], direction: "Higher is better" },
  "Defensive Rebounding": { summary: "Defensive boards", metrics: ["Def. rebounds per game", "Def. rebounds per 36 min"], direction: "Higher is better" },
  Assists: { summary: "Playmaking and ball distribution", metrics: ["Assists per game", "Assists per 36 min", "AST/TOV ratio"], direction: "Higher is better" },
  Steals: { summary: "Ball-hawking on defense", metrics: ["Steals per game", "Steals per 36 min"], direction: "Higher is better" },
  Blocks: { summary: "Shot-blocking ability", metrics: ["Blocks per game", "Blocks per 36 min"], direction: "Higher is better" },
  "Defensive Activity": { summary: "Combined stocks (steals + blocks)", metrics: ["Stocks per game", "Stocks per 36 min"], direction: "Higher is better" },
  "Foul Discipline": { summary: "Defending without fouling", metrics: ["Fouls per game", "Fouls per 36 min"], direction: "Lower is better (fewer fouls)" },
  "True Shooting Efficiency": { summary: "Overall shooting efficiency (TS%)", metrics: ["TS% = PTS / (2 × (FGA + 0.44 × FTA))"], direction: "Higher is better" },
  "Field Goal Efficiency": { summary: "Shooting accuracy from the field", metrics: ["FG%", "eFG% = (FGM + 0.5×3PM) / FGA"], direction: "Higher is better" },
  "Three-Point Shooting": { summary: "Three-point accuracy and volume", metrics: ["3P%", "3PM per game"], direction: "Higher is better" },
  "Free Throw Shooting": { summary: "Free throw accuracy", metrics: ["FT%"], direction: "Higher is better" },
  "Turnover Control": { summary: "Taking care of the ball", metrics: ["Turnovers per game", "Turnovers per 36 min"], direction: "Lower is better (fewer TOs)" },
  Consistency: { summary: "Game-to-game stability", metrics: ["Points CV", "Game Score CV"], direction: "Lower is better (less variation)" },
  "Bad-Game Rate": { summary: "Frequency of poor games", metrics: ["% of games with Game Score < 5"], direction: "Lower is better" },
  "Plus-Minus Impact": { summary: "Net scoring margin when on court", metrics: ["+/- per game", "+/- per 36 min"], direction: "Higher is better" },
  "Playoff Production": { summary: "Overall playoff output", metrics: ["Playoff games", "Playoff PPG", "Playoff RPG", "Playoff APG", "Playoff Game Score"], direction: "Higher is better" },
  "Playoff Efficiency": { summary: "Shooting efficiency in playoffs", metrics: ["Playoff TS%", "Playoff eFG%", "Playoff FT%"], direction: "Higher is better" },
  "Playoff Consistency": { summary: "Stability in playoffs", metrics: ["Playoff bad-game rate", "Playoff Game Score CV"], direction: "Lower is better" },
  "Awards Recognition": { summary: "Individual league recognition", metrics: ["MVP, All-NBA, All-Defensive, All-Star, DPOY, POM, Olympic golds, HoF"], direction: "Higher is better" },
  "Championship Success": { summary: "Rings and Finals MVP", metrics: ["NBA Champion, Finals MVP"], direction: "Higher is better" },
};

function InfoTooltip({ category }) {
  const [show, setShow] = useState(false);
  const info = CATEGORY_INFO[category];
  if (!info) return null;

  return (
    <span className="info-tooltip-wrapper">
      <span className="info-icon" onClick={() => setShow(!show)}>i</span>
      {show && (
        <div className="info-popup-overlay" onClick={() => setShow(false)}>
          <div className="info-popup" onClick={(e) => e.stopPropagation()}>
            <div className="info-popup-header">
              <h4>{category}</h4>
              <button className="info-popup-close" onClick={() => setShow(false)}>&times;</button>
            </div>
            <p className="info-popup-summary">{info.summary}</p>
            <div className="info-popup-section">
              <span className="info-popup-label">Metrics used:</span>
              <ul className="info-popup-list">
                {info.metrics.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            </div>
            <div className="info-popup-section">
              <span className="info-popup-label">Direction:</span>
              <p className="info-popup-text info-popup-direction">{info.direction}</p>
            </div>
          </div>
        </div>
      )}
    </span>
  );
}

export default function WembyIndicator() {
  const [targetPlayer, setTargetPlayer] = useState(null);
  const [targetRank, setTargetRank] = useState(TARGET_RANK_OPTIONS[0]);
  const [referenceSeason, setReferenceSeason] = useState(SEASON_OPTIONS[0]);

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState(null);
  const [results, setResults] = useState(null);

  const handleSimulate = useCallback(async () => {
    if (!targetPlayer) {
      setError("Please select a target player.");
      return;
    }
    if (!referenceSeason) {
      setError("Please select a reference season.");
      return;
    }

    setLoading(true);
    setError(null);
    setResults(null);

    try {
      setProgress("Fetching target player data...");
      const playerData = await fetchPlayerSeasonAverages(targetPlayer.value);

      setProgress(`Fetching all players from ${referenceSeason.label}...`);
      const refSeasonData = await fetchSeasonData(referenceSeason.value);

      // Combine: reference season data + target player data (if not already in)
      const combined = [...refSeasonData];
      for (const ps of playerData) {
        const exists = combined.some(
          (s) =>
            s.player_name === ps.player_name && s.season === ps.season
        );
        if (!exists) combined.push(ps);
      }

      setProgress("Computing EI scores...");

      const eiResults = computeEIScoresHierarchical(
        combined,
        DEFAULT_CATEGORY_WEIGHTS,
        DEFAULT_SUBCATEGORY_WEIGHTS,
        "all"
      );
      const { seasonScores } = eiResults;

      // Get rankings for the reference season only
      const refScores = seasonScores.filter(
        (s) => s.season === referenceSeason.value
      );
      refScores.sort((a, b) => a.eiScore - b.eiScore);

      // Target player's most recent season (current year stats)
      const playerSeasonsSorted = playerData.sort((a, b) =>
        b.season.localeCompare(a.season)
      );
      const currentSeason = playerSeasonsSorted[0];

      // Find current season in seasonScores to get its EI + category scores
      const currentScored = seasonScores.find(
        (s) =>
          s.player_name === targetPlayer.value &&
          s.season === currentSeason?.season
      );

      // The threshold: the player at the target rank in the reference season
      const rankIdx = Math.min(targetRank.value - 1, refScores.length - 1);
      const thresholdEntry = refScores[rankIdx];

      // Where would the target player rank in that season?
      const hypotheticalRank =
        refScores.findIndex((s) => s.eiScore > (currentScored?.eiScore ?? 1)) +
        1 || refScores.length + 1;

      // Category comparison
      const categoryComparison = [];
      for (const [group, cats] of Object.entries(CATEGORY_GROUPS)) {
        for (const catName of cats) {
          const currentScore = currentScored?.categoryScores?.[catName];
          const targetScore = thresholdEntry?.categoryScores?.[catName];

          const currentPct =
            currentScore != null ? (1 - currentScore) * 100 : null;
          const targetPct =
            targetScore != null ? (1 - targetScore) * 100 : null;

          const gap =
            currentPct != null && targetPct != null
              ? targetPct - currentPct
              : null;

          categoryComparison.push({
            group,
            category: catName,
            currentScore,
            targetScore,
            currentPct,
            targetPct,
            gap,
            status:
              gap === null
                ? "unknown"
                : gap <= 0
                  ? "achieved"
                  : gap <= 10
                    ? "close"
                    : "needs-work",
          });
        }
      }

      setResults({
        currentSeason: currentSeason?.season,
        currentEI: currentScored?.eiScore ?? null,
        targetEI: thresholdEntry?.eiScore ?? null,
        thresholdPlayer: thresholdEntry?.player_name,
        hypotheticalRank,
        totalInSeason: refScores.length,
        categoryComparison,
        refScores,
        currentScored,
      });
    } catch (err) {
      setError(err.message || "Simulation failed.");
    } finally {
      setLoading(false);
      setProgress("");
    }
  }, [targetPlayer, referenceSeason, targetRank]);

  return (
    <div className="wemby-page">
      <div className="wemby-dashboard">
        <aside className="wemby-sidebar">
          <h2 className="wemby-sidebar-title">Wemby Indicator</h2>
          <p className="wemby-sidebar-desc">
            Pick a player and a reference season. See what stats they'd need to
            rank at the top of that season's player pool.
          </p>

          <div className="wemby-sidebar-section">
            <label className="control-label">Target Player</label>
            <Select
              options={PLAYER_OPTIONS}
              value={targetPlayer}
              onChange={setTargetPlayer}
              placeholder="Select a player..."
              styles={selectStyles}
              menuPortalTarget={document.body}
              menuPlacement="auto"
              filterOption={(option, input) =>
                option.label.toLowerCase().includes(input.toLowerCase())
              }
            />
          </div>

          <div className="wemby-sidebar-section">
            <label className="control-label">Target Rank</label>
            <Select
              options={TARGET_RANK_OPTIONS}
              value={targetRank}
              onChange={setTargetRank}
              styles={selectStyles}
            />
          </div>

          <div className="wemby-sidebar-section">
            <label className="control-label">Reference Season</label>
            <Select
              options={SEASON_OPTIONS}
              value={referenceSeason}
              onChange={setReferenceSeason}
              styles={selectStyles}
              placeholder="Select season..."
              menuPortalTarget={document.body}
              menuPlacement="auto"
            />
            <span className="wemby-sidebar-hint">
              Compare against the top players of this season
            </span>
          </div>

          <button
            className="analyze-btn"
            onClick={handleSimulate}
            disabled={loading || !targetPlayer || !referenceSeason}
          >
            {loading ? (
              <>
                <span className="spinner" />
                {progress || "Simulating..."}
              </>
            ) : (
              "Simulate"
            )}
          </button>

          {error && <div className="error-banner">{error}</div>}
        </aside>

        <main className="wemby-main">
          {!results && !loading && (
            <div className="wemby-empty">
              <div className="wemby-empty-icon">🎯</div>
              <h3>What does it take to be the GOAT?</h3>
              <p>
                Select a player, choose which season's competition you want to
                measure against, and see exactly what stats need to improve.
              </p>
            </div>
          )}

          {loading && (
            <div className="wemby-empty">
              <span className="spinner spinner--lg" />
              <p className="wemby-loading-text">{progress || "Loading..."}</p>
            </div>
          )}

          {results && (
            <>
              <div className="wemby-summary">
                <div className="wemby-summary-card">
                  <span className="wemby-summary-label">
                    {targetPlayer.label}'s Season
                  </span>
                  <span className="wemby-summary-value">
                    {results.currentSeason}
                  </span>
                </div>
                <div className="wemby-summary-card">
                  <span className="wemby-summary-label">
                    Hypothetical Rank in {referenceSeason.label}
                  </span>
                  <span className="wemby-summary-value">
                    #{results.hypotheticalRank}/{results.totalInSeason}
                  </span>
                </div>
                <div className="wemby-summary-card">
                  <span className="wemby-summary-label">Current EI</span>
                  <span className="wemby-summary-value wemby-summary-ei">
                    {results.currentEI != null
                      ? results.currentEI.toFixed(3)
                      : "N/A"}
                  </span>
                </div>
                <div className="wemby-summary-card">
                  <span className="wemby-summary-label">
                    Target EI (Top {targetRank.value})
                  </span>
                  <span className="wemby-summary-value wemby-summary-target">
                    {results.targetEI != null
                      ? results.targetEI.toFixed(3)
                      : "N/A"}
                  </span>
                </div>
                <div className="wemby-summary-card">
                  <span className="wemby-summary-label">
                    Benchmark Player
                  </span>
                  <span className="wemby-summary-value wemby-summary-player">
                    {results.thresholdPlayer || "N/A"}
                  </span>
                </div>
              </div>

              <div className="wemby-gap-indicator">
                <div className="wemby-gap-bar-bg">
                  <div
                    className="wemby-gap-bar-fill"
                    style={{
                      width: `${Math.min(100, Math.max(5, results.currentEI != null && results.targetEI != null ? ((1 - results.currentEI) / (1 - results.targetEI)) * 100 : 0))}%`,
                    }}
                  />
                </div>
                <div className="wemby-gap-labels">
                  <span>
                    {targetPlayer.label} ({results.currentSeason})
                  </span>
                  <span>
                    {results.thresholdPlayer} ({referenceSeason.label})
                  </span>
                </div>
              </div>

              <h3 className="wemby-section-title">
                Category Breakdown
              </h3>
              <p className="wemby-section-desc">
                {targetPlayer.label} ({results.currentSeason}) vs Top{" "}
                {targetRank.value} of {referenceSeason.label} (
                {results.thresholdPlayer})
              </p>

              <div className="wemby-categories">
                {Object.entries(CATEGORY_GROUPS).map(([group, cats]) => (
                  <div key={group} className="wemby-group">
                    <div className="wemby-group-label">{group}</div>
                    {cats.map((catName) => {
                      const item = results.categoryComparison.find(
                        (c) => c.category === catName
                      );
                      if (!item) return null;
                      return (
                        <div
                          key={catName}
                          className={`wemby-cat-row wemby-cat-row--${item.status}`}
                        >
                          <div className="wemby-cat-name">
                            {catName}
                            <InfoTooltip category={catName} />
                          </div>
                          <div className="wemby-cat-bars">
                            <div className="wemby-cat-bar-bg">
                              <div
                                className="wemby-cat-bar-current"
                                style={{
                                  width: `${item.currentPct ?? 0}%`,
                                }}
                              />
                              {item.targetPct != null && (
                                <div
                                  className="wemby-cat-bar-target-marker"
                                  style={{ left: `${item.targetPct}%` }}
                                />
                              )}
                            </div>
                          </div>
                          <div className="wemby-cat-values">
                            <span className="wemby-cat-current">
                              {item.currentPct != null
                                ? item.currentPct.toFixed(1)
                                : "N/A"}
                            </span>
                            <span className="wemby-cat-arrow">→</span>
                            <span className="wemby-cat-target">
                              {item.targetPct != null
                                ? item.targetPct.toFixed(1)
                                : "N/A"}
                            </span>
                          </div>
                          <div className="wemby-cat-gap">
                            {item.gap != null ? (
                              <span
                                className={`wemby-gap-badge wemby-gap-badge--${item.status}`}
                              >
                                {item.gap <= 0
                                  ? "✓"
                                  : `+${item.gap.toFixed(1)}`}
                              </span>
                            ) : (
                              <span className="wemby-gap-badge wemby-gap-badge--unknown">
                                ?
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>

              <h3 className="wemby-section-title">Distribution Comparison</h3>
              <Plot
                data={[
                  {
                    type: "bar",
                    name: `${targetPlayer.label} (${results.currentSeason})`,
                    x: results.categoryComparison
                      .filter((c) => c.currentPct != null)
                      .map((c) => c.category),
                    y: results.categoryComparison
                      .filter((c) => c.currentPct != null)
                      .map((c) => c.currentPct),
                    marker: { color: "rgba(91,156,246,0.7)" },
                  },
                  {
                    type: "bar",
                    name: `${results.thresholdPlayer} (${referenceSeason.label})`,
                    x: results.categoryComparison
                      .filter((c) => c.targetPct != null)
                      .map((c) => c.category),
                    y: results.categoryComparison
                      .filter((c) => c.targetPct != null)
                      .map((c) => c.targetPct),
                    marker: { color: "rgba(52,211,153,0.7)" },
                  },
                ]}
                layout={{
                  paper_bgcolor: "transparent",
                  plot_bgcolor: "rgba(20,24,33,0.6)",
                  font: { family: "Inter", size: 9, color: "#8b92a5" },
                  barmode: "group",
                  xaxis: {
                    tickangle: -45,
                    tickfont: { size: 8 },
                    gridcolor: "rgba(255,255,255,0.04)",
                  },
                  yaxis: {
                    range: [0, 100],
                    title: {
                      text: "Percentile",
                      font: { size: 10, color: "#565d72" },
                    },
                    gridcolor: "rgba(255,255,255,0.04)",
                  },
                  legend: {
                    font: { color: "#8b92a5", size: 10 },
                    bgcolor: "transparent",
                    orientation: "h",
                    y: 1.1,
                  },
                  margin: { t: 30, r: 20, b: 120, l: 50 },
                  height: 400,
                }}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: "100%" }}
              />

              <h3 className="wemby-section-title">
                EI Distribution — {referenceSeason.label}
              </h3>
              <Plot
                data={[
                  {
                    type: "histogram",
                    x: results.refScores.map((s) => s.eiScore),
                    nbinsx: 30,
                    marker: {
                      color: "rgba(91,156,246,0.3)",
                      line: { color: "rgba(91,156,246,0.5)", width: 0.5 },
                    },
                    histnorm: "probability density",
                    showlegend: false,
                  },
                  {
                    type: "scatter",
                    mode: "markers",
                    x: [results.currentEI],
                    y: [0.3],
                    marker: {
                      symbol: "diamond",
                      size: 14,
                      color: "#5B9CF6",
                      line: { color: "white", width: 1.5 },
                    },
                    name: targetPlayer.label,
                    showlegend: true,
                  },
                  {
                    type: "scatter",
                    mode: "markers",
                    x: [results.targetEI],
                    y: [0.3],
                    marker: {
                      symbol: "diamond",
                      size: 14,
                      color: "#34d399",
                      line: { color: "white", width: 1.5 },
                    },
                    name: `Top ${targetRank.value} threshold`,
                    showlegend: true,
                  },
                ]}
                layout={{
                  paper_bgcolor: "transparent",
                  plot_bgcolor: "rgba(20,24,33,0.6)",
                  font: { family: "Inter", size: 10, color: "#8b92a5" },
                  xaxis: {
                    title: { text: "EI Score", font: { size: 10, color: "#565d72" } },
                    gridcolor: "rgba(255,255,255,0.04)",
                  },
                  yaxis: { visible: false },
                  legend: {
                    font: { color: "#8b92a5", size: 10 },
                    bgcolor: "transparent",
                    orientation: "h",
                    y: 1.1,
                  },
                  margin: { t: 30, r: 20, b: 40, l: 20 },
                  height: 200,
                  bargap: 0.02,
                }}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: "100%" }}
              />
            </>
          )}
        </main>
      </div>
    </div>
  );
}
