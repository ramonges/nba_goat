import { useState, useCallback, useMemo, useEffect } from "react";
import Select from "react-select";
import Plotly from "plotly.js-dist-min";
import factoryModule from "react-plotly.js/factory";
import { ALL_PLAYERS } from "../lib/players";
import {
  CATEGORY_GROUPS,
  CATEGORIES,
  DEFAULT_CATEGORY_WEIGHTS,
  DEFAULT_SUBCATEGORY_WEIGHTS,
  MIN_GAMES_ALL_PLAYERS,
  fetchAllPlayersSeasonAverages,
  computeEIScoresHierarchical,
  assignDisplayRanks,
} from "../lib/eiComputation";
import "./DiscoverGoat.css";

const createPlotlyComponent = factoryModule.default || factoryModule;
const Plot = createPlotlyComponent(Plotly);

const PLAYER_OPTIONS = ALL_PLAYERS.map((n) => ({ value: n, label: n }));

const TOP_YEARS_OPTIONS = [
  { value: "all", label: "All Seasons" },
  ...Array.from({ length: 15 }, (_, i) => ({
    value: i + 1,
    label: `${i + 1}-Year Window`,
  })),
];

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
  multiValue: (base) => ({ ...base, borderRadius: 4, background: "#1f2537" }),
  multiValueLabel: (base) => ({
    ...base,
    color: "#e8eaed",
    fontWeight: 500,
    fontSize: "0.78rem",
  }),
  multiValueRemove: (base) => ({
    ...base,
    color: "#565d72",
    "&:hover": { background: "rgba(232,54,79,0.15)", color: "#e8364f" },
  }),
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
    boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
  }),
  menuList: (base) => ({ ...base, padding: 4, maxHeight: 360 }),
  menuPortal: (base) => ({ ...base, zIndex: 9999 }),
  noOptionsMessage: (base) => ({
    ...base,
    color: "#565d72",
    fontSize: "0.8rem",
  }),
};

export default function DiscoverGoat() {
  const [playerMode, setPlayerMode] = useState("all");
  const [selectedPlayers, setSelectedPlayers] = useState([]);
  // Top-level category weights (Production, Rebounding, ...). Normalized to sum to 1.
  const [categoryWeights, setCategoryWeights] = useState(() => ({
    ...DEFAULT_CATEGORY_WEIGHTS,
  }));
  // Sub-category weights within each category (relative).
  const [subCategoryWeights, setSubCategoryWeights] = useState(() => ({
    ...DEFAULT_SUBCATEGORY_WEIGHTS,
  }));
  const [topYears, setTopYears] = useState(TOP_YEARS_OPTIONS[0]);

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState(null);

  const [seasonData, setSeasonData] = useState(null);
  const [results, setResults] = useState(null);
  const [playerCard, setPlayerCard] = useState(null);

  const handleCategoryWeightChange = useCallback((category, value) => {
    setCategoryWeights((prev) => ({ ...prev, [category]: value }));
  }, []);

  const handleSubCategoryWeightChange = useCallback((subCategory, value) => {
    setSubCategoryWeights((prev) => ({ ...prev, [subCategory]: value }));
  }, []);

  // Category weights normalized to sum to 1.
  const normalizedCategoryWeights = useMemo(() => {
    const entries = Object.entries(categoryWeights);
    const total = entries.reduce((s, [, v]) => s + (v || 0), 0);
    if (total <= 0) {
      const n = entries.length;
      return Object.fromEntries(entries.map(([k]) => [k, 1 / n]));
    }
    return Object.fromEntries(entries.map(([k, v]) => [k, (v || 0) / total]));
  }, [categoryWeights]);

  // Sub-category weights normalized to sum to 1 within each parent category.
  const normalizedSubCategoryWeights = useMemo(() => {
    const result = {};
    for (const [, subs] of Object.entries(CATEGORY_GROUPS)) {
      const total = subs.reduce(
        (s, sub) => s + (subCategoryWeights[sub] || 0),
        0
      );
      if (total <= 0) {
        const n = subs.length;
        for (const sub of subs) result[sub] = 1 / n;
      } else {
        for (const sub of subs) {
          result[sub] = (subCategoryWeights[sub] || 0) / total;
        }
      }
    }
    return result;
  }, [subCategoryWeights]);

  // Fetch data from Supabase (only when players/selection changes)
  const handleFetchData = useCallback(async () => {
    const players =
      playerMode === "all"
        ? ALL_PLAYERS
        : selectedPlayers.map((p) => p.value);

    if (players.length === 0) {
      setError("Please select at least one player.");
      return;
    }

    setLoading(true);
    setError(null);
    setResults(null);
    setSeasonData(null);
    setPlayerCard(null);

    try {
      const data = await fetchAllPlayersSeasonAverages(
        players,
        (current, total, name) => {
          setProgress(`Fetching ${name} (${current}/${total})`);
        }
      );
      setSeasonData(data);
    } catch (err) {
      setError(err.message || "Failed to fetch data.");
    } finally {
      setLoading(false);
      setProgress("");
    }
  }, [playerMode, selectedPlayers]);

  // Recompute EI scores whenever weights, topYears, or seasonData changes
  useEffect(() => {
    if (!seasonData || seasonData.length === 0) return;
    // In "all players" mode, drop fringe players (e.g. role players on a
    // recent title roster with <2 seasons) so they don't artificially top
    // Championship-heavy rankings. Custom selections respect the user.
    const minGames = playerMode === "all" ? MIN_GAMES_ALL_PLAYERS : 0;
    const eiResults = computeEIScoresHierarchical(
      seasonData,
      normalizedCategoryWeights,
      normalizedSubCategoryWeights,
      topYears.value,
      { minGames }
    );
    setResults(eiResults);
  }, [
    seasonData,
    normalizedCategoryWeights,
    normalizedSubCategoryWeights,
    topYears,
    playerMode,
  ]);

  const top15 = useMemo(() => {
    if (!results) return [];
    return assignDisplayRanks(results.playerRankings.slice(0, 15));
  }, [results]);

  return (
    <div className="goat-page">
      <div className="controls-panel">
        <h2 className="controls-title">Discover the GOAT of the NBA</h2>
        <p className="controls-description">
          Configure category weights, pick the player pool, and choose a
          consecutive season window. Each player is scored on their best stretch
          of that length (lowest mean EI). Lower is better.
        </p>

        <div className="goat-controls-layout">
          <div className="goat-left-controls">
            <div className="control-group">
              <label className="control-label">Player Selection</label>
              <div className="player-mode-toggle">
                <button
                  className={`mode-btn ${playerMode === "all" ? "mode-btn--active" : ""}`}
                  onClick={() => setPlayerMode("all")}
                >
                  All Players ({ALL_PLAYERS.length})
                </button>
                <button
                  className={`mode-btn ${playerMode === "custom" ? "mode-btn--active" : ""}`}
                  onClick={() => setPlayerMode("custom")}
                >
                  Custom Selection
                </button>
              </div>
              {playerMode === "custom" && (
                <Select
                  isMulti
                  options={PLAYER_OPTIONS}
                  value={selectedPlayers}
                  onChange={setSelectedPlayers}
                  placeholder="Search and select players..."
                  styles={selectStyles}
                  closeMenuOnSelect={false}
                  filterOption={(option, input) =>
                    option.label.toLowerCase().includes(input.toLowerCase())
                  }
                />
              )}
            </div>

            <div className="control-group">
              <label className="control-label">Top Years Window</label>
              <Select
                options={TOP_YEARS_OPTIONS}
                value={topYears}
                onChange={setTopYears}
                styles={selectStyles}
              />
            </div>
          </div>

          <div className="goat-right-controls">
            <div className="weights-header">
              <label className="control-label">Category Weights</label>
              <span className="weights-hint-inline">
                Category weights sum to 1 · sub-category weights sum to 1
                within each category
              </span>
            </div>
            <div className="weights-groups">
              {Object.entries(CATEGORY_GROUPS).map(([group, cats]) => (
                <div key={group} className="weight-group">
                  <div className="weight-group-header">
                    <div className="weight-group-title">
                      <span className="weight-group-label">{group}</span>
                      <span className="weight-group-share">
                        {(normalizedCategoryWeights[group] * 100).toFixed(1)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={categoryWeights[group]}
                      onChange={(e) =>
                        handleCategoryWeightChange(
                          group,
                          parseFloat(e.target.value)
                        )
                      }
                      className="weight-slider-input weight-group-slider"
                    />
                  </div>
                  <div className="weight-group-sliders">
                    {cats.map((catName) => (
                      <div key={catName} className="weight-slider">
                        <div className="weight-slider-header">
                          <span className="weight-slider-label">
                            {catName}
                          </span>
                          <span className="weight-slider-value">
                            {(
                              normalizedSubCategoryWeights[catName] * 100
                            ).toFixed(1)}
                            %
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.01"
                          value={subCategoryWeights[catName]}
                          onChange={(e) =>
                            handleSubCategoryWeightChange(
                              catName,
                              parseFloat(e.target.value)
                            )
                          }
                          className="weight-slider-input"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <button
          className="analyze-btn"
          onClick={handleFetchData}
          disabled={
            loading ||
            (playerMode === "custom" && selectedPlayers.length === 0)
          }
        >
          {loading ? (
            <>
              <span className="spinner" />
              {progress || "Loading..."}
            </>
          ) : seasonData ? (
            "Reload Players"
          ) : (
            "Load Players"
          )}
        </button>

        {error && <div className="error-banner">{error}</div>}
      </div>

      {results && (
        <div className="results-section">
          <div className="result-card">
            <div className="result-card-header">
              <div>
                <h3 className="result-card-title">GOAT Ranking</h3>
                <p className="result-card-subtitle">
                  Top 15 by career EI · lower is better · click a row for the
                  player card
                </p>
              </div>
              <span className="goat-ranking-badge">Live update</span>
            </div>

            <div className="goat-ranking-list">
              {top15.map((player) => (
                <div
                  key={player.player_name}
                  className={`goat-rank-row ${player.displayRank === 1 ? "goat-rank-row--first" : ""}`}
                  onClick={() =>
                    setPlayerCard({ ...player, _rank: player.displayRank })
                  }
                >
                  <div className="goat-rank-pos">
                    {player.displayRank === 1 ? "👑" : player.displayRank}
                  </div>
                  <div className="goat-rank-info">
                    <span className="goat-rank-name">
                      {player.player_name}
                    </span>
                    <span className="goat-rank-meta">
                      {player.totalSeasons} seasons · {player.totalGames} games
                    </span>
                  </div>
                  <div className="goat-rank-scores">
                    <div className="goat-rank-ei">
                      {player.careerEI.toFixed(3)}
                    </div>
                    <div className="goat-rank-peak">
                      Peak: {player.peakEI.toFixed(3)}
                    </div>
                  </div>
                  <div className="goat-rank-bar-container">
                    <div
                      className="goat-rank-bar"
                      style={{
                        width: `${Math.max(5, (1 - player.careerEI) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {playerCard && (
        <PlayerCard
          player={playerCard}
          allEIScores={results?.allEIScores || []}
          totalPlayers={results?.playerRankings.length || 0}
          onClose={() => setPlayerCard(null)}
        />
      )}
    </div>
  );
}

function PlayerCard({ player, allEIScores, totalPlayers, onClose }) {
  if (!player) return null;

  const bestSeason = player.allSeasons.reduce(
    (best, s) => (s.eiScore < best.eiScore ? s : best),
    player.allSeasons[0]
  );

  const playerEI = player.peakEI;
  const percentile =
    allEIScores.length > 0
      ? (
          (allEIScores.filter((s) => s > playerEI).length /
            allEIScores.length) *
          100
        ).toFixed(1)
      : 0;

  const rank = player._rank || "—";

  const catPercentiles = {};
  for (const catName of Object.keys(CATEGORIES)) {
    const score = bestSeason.categoryScores?.[catName];
    catPercentiles[catName] = score != null ? (1 - score) * 100 : null;
  }

  const groupPercentiles = {};
  for (const [group, cats] of Object.entries(CATEGORY_GROUPS)) {
    const vals = cats.map((c) => catPercentiles[c]).filter((v) => v != null);
    groupPercentiles[group] =
      vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }

  const sortedEI = [...allEIScores].sort((a, b) => a - b);
  const median =
    sortedEI.length > 0 ? sortedEI[Math.floor(sortedEI.length * 0.5)] : 0.5;

  return (
    <div className="player-card-overlay" onClick={onClose}>
      <div className="player-card" onClick={(e) => e.stopPropagation()}>
        <div className="player-card-header">
          <h3>
            EI Framework: {player.player_name} · Best Season (
            {bestSeason.season})
          </h3>
          <button className="player-card-close" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="player-card-top">
          <div className="player-card-info-box">
            <div className="info-line">
              <strong>Best Season:</strong> {bestSeason.season}
            </div>
            <div className="info-line">
              <strong>EI:</strong> {playerEI.toFixed(3)}
            </div>
            <div className="info-line">
              <strong>EI Percentile:</strong> {percentile}th
            </div>
            <div className="info-line">
              <strong>Rank:</strong> {rank}/{totalPlayers}
            </div>
          </div>

          <div className="player-card-dist">
            <Plot
              data={[
                {
                  type: "histogram",
                  x: allEIScores,
                  nbinsx: 40,
                  marker: {
                    color: "rgba(74,127,255,0.3)",
                    line: { color: "rgba(74,127,255,0.5)", width: 0.5 },
                  },
                  histnorm: "probability density",
                  showlegend: false,
                },
                {
                  type: "scatter",
                  mode: "lines",
                  x: [median, median],
                  y: [0, 8],
                  line: { color: "#5B9CF6", width: 1.5, dash: "dash" },
                  name: "Median",
                  showlegend: true,
                },
                {
                  type: "scatter",
                  mode: "markers",
                  x: [playerEI],
                  y: [0.2],
                  marker: {
                    symbol: "diamond",
                    size: 12,
                    color: "#5B9CF6",
                    line: { color: "white", width: 1 },
                  },
                  name: player.player_name,
                  showlegend: true,
                },
              ]}
              layout={{
                paper_bgcolor: "transparent",
                plot_bgcolor: "rgba(20,24,33,0.4)",
                font: { family: "Inter", size: 9, color: "#8b92a5" },
                xaxis: {
                  title: { text: "EI", font: { size: 10, color: "#565d72" } },
                  gridcolor: "rgba(255,255,255,0.04)",
                  range: [0.2, 0.9],
                },
                yaxis: { visible: false },
                margin: { t: 5, r: 10, b: 35, l: 10 },
                height: 140,
                legend: {
                  orientation: "h",
                  y: 1.15,
                  font: { size: 9, color: "#8b92a5" },
                  bgcolor: "transparent",
                },
                bargap: 0.02,
              }}
              config={{ responsive: true, displayModeBar: false }}
              style={{ width: "100%" }}
            />
          </div>
        </div>

        <div className="player-card-bottom">
          <div className="player-card-section-left">
            <h4 className="player-card-section-title">
              Section Average Percentile
            </h4>
            <Plot
              data={[
                {
                  type: "bar",
                  orientation: "h",
                  y: Object.keys(groupPercentiles),
                  x: Object.values(groupPercentiles),
                  marker: { color: "rgba(91,156,246,0.7)" },
                  text: Object.values(groupPercentiles).map((v) =>
                    v.toFixed(1)
                  ),
                  textposition: "outside",
                  textfont: { size: 9, color: "#8b92a5" },
                },
              ]}
              layout={{
                paper_bgcolor: "transparent",
                plot_bgcolor: "rgba(20,24,33,0.4)",
                font: { family: "Inter", size: 9, color: "#8b92a5" },
                xaxis: {
                  range: [0, 100],
                  title: {
                    text: "Percentile",
                    font: { size: 9, color: "#565d72" },
                  },
                  gridcolor: "rgba(255,255,255,0.04)",
                },
                yaxis: { automargin: true, tickfont: { size: 9 } },
                margin: { t: 5, r: 40, b: 30, l: 120 },
                height: 280,
              }}
              config={{ responsive: true, displayModeBar: false }}
              style={{ width: "100%" }}
            />
          </div>

          <div className="player-card-section-right">
            <h4 className="player-card-section-title">Category Percentiles</h4>
            <Plot
              data={[
                {
                  type: "bar",
                  orientation: "h",
                  y: Object.keys(catPercentiles),
                  x: Object.values(catPercentiles).map((v) => v ?? 0),
                  marker: { color: "rgba(91,156,246,0.7)" },
                  text: Object.values(catPercentiles).map((v) =>
                    v != null ? v.toFixed(1) : "—"
                  ),
                  textposition: "outside",
                  textfont: { size: 8, color: "#8b92a5" },
                },
              ]}
              layout={{
                paper_bgcolor: "transparent",
                plot_bgcolor: "rgba(20,24,33,0.4)",
                font: { family: "Inter", size: 8, color: "#8b92a5" },
                xaxis: {
                  range: [0, 100],
                  title: {
                    text: "Percentile",
                    font: { size: 9, color: "#565d72" },
                  },
                  gridcolor: "rgba(255,255,255,0.04)",
                },
                yaxis: { automargin: true, tickfont: { size: 8 } },
                margin: { t: 5, r: 40, b: 30, l: 150 },
                height: 520,
              }}
              config={{ responsive: true, displayModeBar: false }}
              style={{ width: "100%" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
