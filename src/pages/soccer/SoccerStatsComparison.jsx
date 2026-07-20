import { useState, useCallback, useEffect } from "react";
import Select from "react-select";
import {
  SOCCER_STAT_COLUMNS,
  SOCCER_PLAYER_COLORS,
  fetchSoccerPlayerNames,
  fetchSoccerPlayerData,
} from "../../lib/soccer";
import DistributionChart from "../../components/DistributionChart";
import "../StatsComparison.css";
import "./Soccer.css";

const COMPETITION_OPTIONS = [
  { value: "all", label: "All Competitions" },
  { value: "regular_season", label: "Domestic League" },
  { value: "champions_league", label: "Champions League" },
];

const DEFAULT_METRICS = [
  "goals",
  "assists",
  "xg",
  "xa",
  "shots",
  "shots_on_target",
  "touches",
  "rating",
].map((k) => ({ value: k, label: SOCCER_STAT_COLUMNS[k] }));

const METRIC_OPTIONS = Object.entries(SOCCER_STAT_COLUMNS).map(
  ([key, label]) => ({ value: key, label })
);

const VIEW_OPTIONS = [
  { value: "career", label: "Career Overview" },
  { value: "season", label: "Per Season" },
];

const selectStyles = {
  control: (base, state) => ({
    ...base,
    background: "#141821",
    borderColor: state.isFocused
      ? "rgba(74,181,232,0.45)"
      : "rgba(255,255,255,0.06)",
    boxShadow: state.isFocused ? "0 0 0 1px rgba(74,181,232,0.2)" : "none",
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
    "&:hover": { background: "rgba(224,90,109,0.15)", color: "#e05a6d" },
  }),
  option: (base, state) => ({
    ...base,
    background: state.isSelected
      ? "rgba(74,181,232,0.22)"
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
};

export default function SoccerStatsComparison() {
  const [playerOptions, setPlayerOptions] = useState([]);
  const [selectedPlayers, setSelectedPlayers] = useState([]);
  const [selectedMetrics, setSelectedMetrics] = useState(DEFAULT_METRICS);
  const [competition, setCompetition] = useState(COMPETITION_OPTIONS[0]);
  const [viewMode, setViewMode] = useState(VIEW_OPTIONS[0]);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingNames, setLoadingNames] = useState(true);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const names = await fetchSoccerPlayerNames();
        if (!cancelled) {
          setPlayerOptions(names.map((n) => ({ value: n, label: n })));
        }
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load players.");
      } finally {
        if (!cancelled) setLoadingNames(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
          `Fetching ${player.label} (${i + 1}/${selectedPlayers.length})…`
        );
        const data = await fetchSoccerPlayerData(
          player.value,
          competition.value
        );
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
        competitionLabel: competition.label,
      });
    } catch (err) {
      setError(err.message || "Failed to fetch data.");
    } finally {
      setLoading(false);
      setProgress("");
    }
  }, [selectedPlayers, selectedMetrics, competition]);

  return (
    <div className="stats-page soccer-page">
      <div className="controls-panel stats-panel soccer-panel">
        <div className="stats-panel-header">
          <h2 className="stats-panel-title soccer-title">
            Soccer · Stats Distribution Comparison
          </h2>
          <p className="controls-description">
            Step 1 of the Soccer GOAT Lab — overlay game-level distributions
            before any composite score. Pick players, metrics, and competition.
          </p>
        </div>

        <div className="stat-steps">
          <div className="stat-step-card">
            <label className="control-label">
              <span className="stat-step-badge soccer-badge">1</span>
              Players
              <span className="control-count">
                {loadingNames
                  ? "loading…"
                  : `${playerOptions.length} available`}
                {selectedPlayers.length > 0 &&
                  ` · ${selectedPlayers.length} selected`}
              </span>
            </label>
            <Select
              isMulti
              options={playerOptions}
              value={selectedPlayers}
              onChange={setSelectedPlayers}
              placeholder={
                loadingNames
                  ? "Loading players…"
                  : "Search Messi, Ronaldo, Haaland…"
              }
              styles={selectStyles}
              closeMenuOnSelect={false}
              isDisabled={loadingNames}
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
                      borderLeft: `4px solid ${SOCCER_PLAYER_COLORS[i % SOCCER_PLAYER_COLORS.length]}`,
                    }}
                  >
                    {p.label}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="stat-step-card">
            <label className="control-label">
              <span className="stat-step-badge soccer-badge">2</span>
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
              placeholder="Select metrics…"
              styles={selectStyles}
              closeMenuOnSelect={false}
            />
          </div>

          <div className="stat-step-card">
            <label className="control-label">
              <span className="stat-step-badge soccer-badge">3</span>
              Filters
            </label>
            <div className="stat-filter-row">
              <div className="control-group">
                <span className="control-sublabel">Competition</span>
                <Select
                  options={COMPETITION_OPTIONS}
                  value={competition}
                  onChange={setCompetition}
                  styles={selectStyles}
                />
              </div>
              <div className="control-group">
                <span className="control-sublabel">View Mode</span>
                <Select
                  options={VIEW_OPTIONS}
                  value={viewMode}
                  onChange={setViewMode}
                  styles={selectStyles}
                />
              </div>
            </div>
          </div>
        </div>

        <button
          className="analyze-btn soccer-analyze"
          onClick={handleAnalyze}
          disabled={loading || selectedPlayers.length === 0}
        >
          {loading ? (
            <>
              <span className="spinner" />
              {progress || "Analyzing…"}
            </>
          ) : (
            "Analyze distributions"
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
                      color:
                        SOCCER_PLAYER_COLORS[i % SOCCER_PLAYER_COLORS.length],
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
              {results.competitionLabel}
            </p>
          </div>

          <div className="charts-grid">
            {results.metrics.map((stat) => (
              <DistributionChart
                key={stat}
                stat={stat}
                playersData={results.players}
                viewMode={viewMode.value}
                statLabels={SOCCER_STAT_COLUMNS}
                colors={SOCCER_PLAYER_COLORS}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
