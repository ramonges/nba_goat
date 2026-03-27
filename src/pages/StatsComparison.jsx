import { useState, useCallback } from "react";
import Select from "react-select";
import {
  STAT_COLUMNS,
  PLAYER_COLORS,
  fetchPlayerData,
} from "../lib/supabase";
import { ALL_PLAYERS } from "../lib/players";
import DistributionChart from "../components/DistributionChart";
import "./StatsComparison.css";

const GAME_TYPE_OPTIONS = [
  { value: "all", label: "All Games" },
  { value: "regular_season", label: "Regular Season" },
  { value: "playoffs", label: "Playoffs" },
];

const METRIC_OPTIONS = Object.entries(STAT_COLUMNS).map(([key, label]) => ({
  value: key,
  label,
}));

const DEFAULT_METRICS = [
  "points",
  "rebounds",
  "assists",
  "field_goal_percentage",
  "three_point_percentage",
  "free_throw_percentage",
  "minutes",
  "plus_minus",
].map((k) => ({ value: k, label: STAT_COLUMNS[k] }));

const VIEW_OPTIONS = [
  { value: "career", label: "Career Overview" },
  { value: "season", label: "Per Season" },
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
    minHeight: 40,
    "&:hover": { borderColor: "rgba(255,255,255,0.12)" },
  }),
  input: (base) => ({ ...base, color: "#e8eaed" }),
  singleValue: (base) => ({ ...base, color: "#e8eaed", fontSize: "0.85rem" }),
  multiValue: (base) => ({
    ...base,
    borderRadius: 4,
    background: "#1f2537",
  }),
  multiValueLabel: (base) => ({
    ...base,
    color: "#e8eaed",
    fontWeight: 500,
    fontSize: "0.8rem",
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
    fontSize: "0.85rem",
    padding: "8px 12px",
  }),
  placeholder: (base) => ({ ...base, color: "#565d72", fontSize: "0.85rem" }),
  menu: (base) => ({
    ...base,
    background: "#141821",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 6,
    overflow: "hidden",
    zIndex: 20,
    boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
  }),
  menuList: (base) => ({ ...base, padding: 4, maxHeight: 280 }),
  noOptionsMessage: (base) => ({
    ...base,
    color: "#565d72",
    fontSize: "0.82rem",
  }),
};

const PLAYER_OPTIONS = ALL_PLAYERS.map((n) => ({ value: n, label: n }));

export default function StatsComparison() {
  const [selectedPlayers, setSelectedPlayers] = useState([]);
  const [selectedMetrics, setSelectedMetrics] = useState(DEFAULT_METRICS);
  const [gameType, setGameType] = useState(GAME_TYPE_OPTIONS[0]);
  const [viewMode, setViewMode] = useState(VIEW_OPTIONS[0]);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState("");

  const handleAnalyze = useCallback(async () => {
    if (selectedPlayers.length === 0) {
      setError("Please select at least one player.");
      return;
    }
    if (selectedMetrics.length === 0) {
      setError("Please select at least one metric.");
      return;
    }

    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const playersData = [];
      for (let i = 0; i < selectedPlayers.length; i++) {
        const player = selectedPlayers[i];
        setProgress(
          `Fetching ${player.label} (${i + 1}/${selectedPlayers.length})...`
        );
        const data = await fetchPlayerData(player.value, gameType.value);
        if (data.length === 0) {
          setError(
            `No data found for ${player.label} with the selected filter.`
          );
          setLoading(false);
          return;
        }
        playersData.push({ name: player.label, data });
      }

      setResults({
        players: playersData,
        metrics: selectedMetrics.map((m) => m.value),
      });
    } catch (err) {
      setError(err.message || "Failed to fetch data.");
    } finally {
      setLoading(false);
      setProgress("");
    }
  }, [selectedPlayers, selectedMetrics, gameType]);

  return (
    <div className="stats-page">
      <div className="controls-panel">
        <h2 className="controls-title">Stats Distribution Comparison</h2>
        <p className="controls-description">
          Select players and metrics, choose filters, then click Analyze to
          fetch data and generate charts.
        </p>

        <div className="controls-grid">
          <div className="control-group control-group--wide">
            <label className="control-label">
              Players
              <span className="control-count">
                {ALL_PLAYERS.length} available
                {selectedPlayers.length > 0 &&
                  ` · ${selectedPlayers.length} selected`}
              </span>
            </label>
            <Select
              isMulti
              options={PLAYER_OPTIONS}
              value={selectedPlayers}
              onChange={setSelectedPlayers}
              placeholder="Search and select players..."
              styles={selectStyles}
              closeMenuOnSelect={false}
              noOptionsMessage={() => "No players found"}
              filterOption={(option, input) =>
                option.label.toLowerCase().includes(input.toLowerCase())
              }
            />
            {selectedPlayers.length > 0 && (
              <div className="player-chips">
                {selectedPlayers.map((p, i) => (
                  <span
                    key={p.value}
                    className="player-chip"
                    style={{
                      borderLeft: `4px solid ${PLAYER_COLORS[i % PLAYER_COLORS.length]}`,
                    }}
                  >
                    {p.label}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="control-group control-group--wide">
            <label className="control-label">
              Metrics
              <span className="control-count">
                {selectedMetrics.length} selected
              </span>
            </label>
            <Select
              isMulti
              options={METRIC_OPTIONS}
              value={selectedMetrics}
              onChange={setSelectedMetrics}
              placeholder="Select metrics..."
              styles={selectStyles}
              closeMenuOnSelect={false}
            />
          </div>

          <div className="control-group">
            <label className="control-label">Game Type</label>
            <Select
              options={GAME_TYPE_OPTIONS}
              value={gameType}
              onChange={setGameType}
              styles={selectStyles}
            />
          </div>

          <div className="control-group">
            <label className="control-label">View Mode</label>
            <Select
              options={VIEW_OPTIONS}
              value={viewMode}
              onChange={setViewMode}
              styles={selectStyles}
            />
          </div>
        </div>

        <button
          className="analyze-btn"
          onClick={handleAnalyze}
          disabled={loading || selectedPlayers.length === 0}
        >
          {loading ? (
            <>
              <span className="spinner" />
              {progress || "Analyzing..."}
            </>
          ) : (
            <>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path
                  d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
                  fill="currentColor"
                />
              </svg>
              Analyze
            </>
          )}
        </button>

        {error && <div className="error-banner">{error}</div>}
      </div>

      {results && (
        <div className="results-section">
          <div className="results-header">
            <h3>
              Comparing:{" "}
              {results.players.map((p, i) => (
                <span key={p.name}>
                  {i > 0 && " vs "}
                  <span
                    className="results-player-name"
                    style={{
                      color: PLAYER_COLORS[i % PLAYER_COLORS.length],
                    }}
                  >
                    {p.name}
                  </span>
                </span>
              ))}
            </h3>
            <p className="results-meta">
              {results.players
                .map((p) => `${p.name}: ${p.data.length} games`)
                .join(" · ")}
              {" · "}
              {gameType.label}
            </p>
          </div>

          <div className="charts-grid">
            {results.metrics.map((stat) => (
              <DistributionChart
                key={stat}
                stat={stat}
                playersData={results.players}
                viewMode={viewMode.value}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
