import { useState, useCallback, useMemo } from "react";
import Select from "react-select";
import Plotly from "plotly.js-dist-min";
import factoryModule from "react-plotly.js/factory";
import {
  STAT_COLUMNS,
  PLAYER_COLORS,
  fetchPlayerData,
} from "../lib/supabase";
import { ALL_PLAYERS } from "../lib/players";
import {
  CATEGORY_GROUPS,
  CATEGORIES,
  computeEraDistributions,
  fetchAllPlayersSeasonAverages,
  decadeLabel,
} from "../lib/eiComputation";
import DistributionChart from "../components/DistributionChart";
import "./StatsComparison.css";

const createPlotlyComponent = factoryModule.default || factoryModule;
const Plot = createPlotlyComponent(Plotly);

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

// Accent color per decade — shared with the GOAT Lab presets for consistency.
const DECADE_COLORS = {
  1950: "#c9a44a",
  1960: "#e8894a",
  1970: "#e05a6d",
  1980: "#b86ce0",
  1990: "#6c7ae0",
  2000: "#4ab5e8",
  2010: "#3fbf9b",
  2020: "#7ac74f",
};

// Sub-categories that participate in era distributions (Legacy is cumulative and
// excluded from the per-season era measures).
const ERA_GROUPS = Object.entries(CATEGORY_GROUPS).filter(
  ([g]) => g !== "Legacy"
);

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

// ── Helpers for the era distribution charts ──────────────────────────────────
function prettyMeasure(key) {
  return key
    .replace(/_per_game/g, " / G")
    .replace(/_per36/g, " / 36")
    .replace(/_pct/g, " %")
    .replace(/_cv/g, " CV")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function stdDev(arr) {
  const n = arr.length;
  if (n < 2) return 0;
  const m = arr.reduce((a, b) => a + b, 0) / n;
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1));
}

function kde(data, nPoints = 160) {
  if (data.length < 4) return { x: [], y: [] };
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const lo = min - range * 0.12;
  const hi = max + range * 0.12;
  const step = (hi - lo) / nPoints;
  const h = 1.06 * stdDev(data) * Math.pow(data.length, -0.2);
  if (h === 0) return { x: [], y: [] };
  const x = [];
  const y = [];
  for (let i = 0; i <= nPoints; i++) {
    const xi = lo + i * step;
    let sum = 0;
    for (const d of data) {
      const u = (xi - d) / h;
      sum += Math.exp(-0.5 * u * u);
    }
    x.push(xi);
    y.push(sum / (data.length * h * Math.sqrt(2 * Math.PI)));
  }
  return { x, y };
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// ── Era distribution chart for a single measure, overlaying decades ───────────
function EraMeasureChart({ measure, byDecade, decades }) {
  const { traces, pills } = useMemo(() => {
    const t = [];
    const p = [];
    for (const dk of decades) {
      const vals = byDecade[dk]?.[measure];
      if (!vals || vals.length < 4) continue;
      const curve = kde(vals);
      if (!curve.x.length) continue;
      const color = DECADE_COLORS[dk] || "#8b92a5";
      t.push({
        type: "scatter",
        mode: "lines",
        x: curve.x,
        y: curve.y,
        name: decadeLabel(dk),
        line: { color, width: 2.5, shape: "spline" },
        fill: "tozeroy",
        fillcolor: hexA(color, 0.06),
      });
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      p.push({
        dk,
        color,
        mean,
        sd: stdDev(vals),
        n: vals.length,
      });
    }
    return { traces: t, pills: p };
  }, [measure, byDecade, decades]);

  if (traces.length === 0) return null;

  return (
    <div className="chart-card">
      <h3 className="chart-title">{prettyMeasure(measure)}</h3>
      <Plot
        data={traces}
        layout={{
          paper_bgcolor: "transparent",
          plot_bgcolor: "rgba(20,24,33,0.6)",
          font: { family: "Inter, sans-serif", size: 11, color: "#8b92a5" },
          xaxis: {
            title: {
              text: prettyMeasure(measure),
              font: { size: 10, color: "#565d72" },
            },
            gridcolor: "rgba(255,255,255,0.04)",
            tickfont: { color: "#565d72", size: 10 },
          },
          yaxis: {
            title: { text: "Density", font: { size: 10, color: "#565d72" } },
            gridcolor: "rgba(255,255,255,0.04)",
            tickfont: { color: "#565d72", size: 10 },
          },
          legend: {
            orientation: "h",
            y: -0.22,
            font: { color: "#8b92a5", size: 10 },
            bgcolor: "transparent",
          },
          margin: { t: 12, r: 20, b: 44, l: 52 },
          height: 320,
        }}
        config={{ responsive: true, displayModeBar: false }}
        style={{ width: "100%" }}
      />
      <div className="chart-stats-row">
        {pills.map((p) => (
          <div
            key={p.dk}
            className="chart-stat-pill"
            style={{ borderColor: p.color }}
          >
            <span className="stat-player-dot" style={{ background: p.color }} />
            <strong>{decadeLabel(p.dk)}</strong>
            <span>μ {p.mean.toFixed(1)}</span>
            <span>σ {p.sd.toFixed(1)}</span>
            <span>n {p.n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Explore Eras: pick a sub-category + eras, see how the distribution of each
//    measure shifted decade to decade across the whole league ─────────────────
function EraExplorer() {
  const [eraData, setEraData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState(null);
  const [subCat, setSubCat] = useState("Scoring Production");
  const [activeDecades, setActiveDecades] = useState(() => new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAllPlayersSeasonAverages(
        ALL_PLAYERS,
        (current, total, name) =>
          setProgress(`Fetching ${name} (${current}/${total})`)
      );
      const dist = computeEraDistributions(data);
      setEraData(dist);
      setActiveDecades(new Set(dist.decades));
    } catch (err) {
      setError(err.message || "Failed to fetch league data.");
    } finally {
      setLoading(false);
      setProgress("");
    }
  }, []);

  const toggleDecade = useCallback((dk) => {
    setActiveDecades((prev) => {
      const next = new Set(prev);
      if (next.has(dk)) next.delete(dk);
      else next.add(dk);
      return next;
    });
  }, []);

  const orderedActive = useMemo(
    () => (eraData ? eraData.decades.filter((d) => activeDecades.has(d)) : []),
    [eraData, activeDecades]
  );

  const measures = CATEGORIES[subCat]?.measures ?? [];

  if (!eraData) {
    return (
      <div className="controls-panel stats-panel">
        <div className="stats-panel-header">
          <h2 className="stats-panel-title">Explore Eras</h2>
          <p className="controls-description">
            See how the league-wide distribution of every stat shifted from the
            1950s to today. Load the league once, then pick a category and the
            decades you want to overlay.
          </p>
        </div>
        <button className="analyze-btn" onClick={load} disabled={loading}>
          {loading ? (
            <>
              <span className="spinner" />
              {progress || "Loading league…"}
            </>
          ) : (
            "Load league data"
          )}
        </button>
        {error && <div className="error-banner">{error}</div>}
      </div>
    );
  }

  return (
    <>
      <div className="controls-panel stats-panel">
        <div className="stats-panel-header">
          <h2 className="stats-panel-title">Explore Eras</h2>
          <p className="controls-description">
            Pick a sub-category to see how each of its stats was distributed
            across the players of every decade. Toggle eras to overlay or
            isolate them.
          </p>
        </div>

        <div className="era-picker-block">
          <div className="era-picker-label">
            <span className="stat-step-badge">1</span>
            Sub-category
          </div>
          <div className="subcat-groups">
            {ERA_GROUPS.map(([group, subs]) => (
              <div key={group} className="subcat-group">
                <div className="subcat-group-name">{group}</div>
                <div className="subcat-rects">
                  {subs.map((sc) => (
                    <button
                      key={sc}
                      type="button"
                      className={`subcat-rect ${sc === subCat ? "subcat-rect--active" : ""}`}
                      onClick={() => setSubCat(sc)}
                    >
                      {sc}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="era-picker-block">
          <div className="era-picker-label">
            <span className="stat-step-badge">2</span>
            Eras
          </div>
          <div className="era-rects">
            {eraData.decades.map((dk) => {
              const on = activeDecades.has(dk);
              return (
                <button
                  key={dk}
                  type="button"
                  className={`era-rect ${on ? "era-rect--active" : ""}`}
                  style={{ "--era-color": DECADE_COLORS[dk] || "#8b92a5" }}
                  onClick={() => toggleDecade(dk)}
                >
                  <span className="era-rect-dot" />
                  {decadeLabel(dk)}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="results-section">
        <div className="results-header">
          <h3>
            <span className="results-player-name">{subCat}</span> · distribution
            by era
          </h3>
          <p className="results-meta">
            {orderedActive.length} era
            {orderedActive.length === 1 ? "" : "s"} shown ·{" "}
            {measures.length} measure{measures.length === 1 ? "" : "s"}
          </p>
        </div>

        {orderedActive.length === 0 ? (
          <div className="era-empty">Select at least one era to compare.</div>
        ) : (
          <div className="charts-grid">
            {measures.map((m) => (
              <EraMeasureChart
                key={m}
                measure={m}
                byDecade={eraData.byDecade}
                decades={orderedActive}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ── Player comparison (original feature) ─────────────────────────────────────
function PlayerComparison() {
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
        gameTypeLabel: gameType.label,
      });
    } catch (err) {
      setError(err.message || "Failed to fetch data.");
    } finally {
      setLoading(false);
      setProgress("");
    }
  }, [selectedPlayers, selectedMetrics, gameType]);

  return (
    <>
      <div className="controls-panel stats-panel">
        <div className="stats-panel-header">
          <h2 className="stats-panel-title">Compare Players</h2>
          <p className="controls-description">
            Build your matchup step by step, then hit Analyze.
          </p>
        </div>

        <div className="stat-steps">
          <div className="stat-step-card">
            <label className="control-label">
              <span className="stat-step-badge">1</span>
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

          <div className="stat-step-card">
            <label className="control-label">
              <span className="stat-step-badge">2</span>
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

          <div className="stat-step-card">
            <label className="control-label">
              <span className="stat-step-badge">3</span>
              Filters
            </label>
            <div className="stat-filter-row">
              <div className="control-group">
                <span className="control-sublabel">Game Type</span>
                <Select
                  options={GAME_TYPE_OPTIONS}
                  value={gameType}
                  onChange={setGameType}
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
              {results.gameTypeLabel}
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
    </>
  );
}

export default function StatsComparison() {
  const [mode, setMode] = useState("players");

  return (
    <div className="stats-page">
      <div className="stats-mode-bar">
        <button
          className={`stats-mode-btn stats-mode-btn--players ${mode === "players" ? "stats-mode-btn--active" : ""}`}
          onClick={() => setMode("players")}
        >
          Compare Players
        </button>
        <button
          className={`stats-mode-btn stats-mode-btn--eras ${mode === "eras" ? "stats-mode-btn--active" : ""}`}
          onClick={() => setMode("eras")}
        >
          Explore Eras
        </button>
      </div>

      {mode === "players" ? <PlayerComparison /> : <EraExplorer />}
    </div>
  );
}
