import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Select from "react-select";
import Plotly from "plotly.js-dist-min";
import factoryModule from "react-plotly.js/factory";
import { ALL_PLAYERS } from "../lib/players";
import { PLAYER_COLORS } from "../lib/supabase";
import {
  CATEGORY_GROUPS,
  DEFAULT_CATEGORY_WEIGHTS,
  DEFAULT_SUBCATEGORY_WEIGHTS,
  MIN_GAMES_ALL_PLAYERS,
  computeEIScoresByEra,
  fetchAllPlayersSeasonAverages,
} from "../lib/eiComputation";
import "./DiscoverGoat.css";
import "./CreateGoatRanking.css";
import "./GoatAnimation.css";

const createPlotlyComponent = factoryModule.default || factoryModule;
const Plot = createPlotlyComponent(Plotly);

const PLAYER_OPTIONS = ALL_PLAYERS.map((n) => ({ value: n, label: n }));

const SPEED_OPTIONS = [
  { value: 0.5, label: "0.5×" },
  { value: 1, label: "1×" },
  { value: 2, label: "2×" },
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
    background: "rgba(74,127,255,0.18)",
    borderRadius: 4,
  }),
  multiValueLabel: (base) => ({ ...base, color: "#e8eaed", fontSize: "0.78rem" }),
  multiValueRemove: (base) => ({
    ...base,
    color: "#8b92a5",
    ":hover": { background: "rgba(232,54,79,0.3)", color: "#fff" },
  }),
  option: (base, state) => ({
    ...base,
    background: state.isSelected
      ? "rgba(74,127,255,0.22)"
      : state.isFocused
        ? "#1f2537"
        : "#141821",
    color: state.isSelected ? "#e8eaed" : "#8b92a5",
    fontSize: "0.85rem",
    padding: "8px 12px",
  }),
  menu: (base) => ({
    ...base,
    background: "#141821",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 6,
    zIndex: 20,
  }),
  menuList: (base) => ({ ...base, padding: 4, maxHeight: 280 }),
  menuPortal: (base) => ({ ...base, zIndex: 9999 }),
  placeholder: (base) => ({ ...base, color: "#6b7280", fontSize: "0.85rem" }),
};

function seasonSortKey(season) {
  const m = String(season).match(/^(\d{4})-(\d{2})$/);
  if (!m) return String(season);
  const start = parseInt(m[1], 10);
  let end = Math.floor(start / 100) * 100 + parseInt(m[2], 10);
  if (end < start) end += 100;
  return `${String(end).padStart(4, "0")}-${m[1]}`;
}

function compareSeasons(a, b) {
  return seasonSortKey(a).localeCompare(seasonSortKey(b));
}

function msPerFrame(speed) {
  if (speed >= 2) return 180;
  if (speed <= 0.5) return 700;
  return 350;
}

function playerColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return PLAYER_COLORS[h % PLAYER_COLORS.length];
}

function withAlpha(hex, alpha) {
  const m = String(hex).match(/^#([0-9a-f]{6})$/i);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

export default function GoatAnimation() {
  const [playerMode, setPlayerMode] = useState("top"); // top | custom
  const [topN, setTopN] = useState(15);
  const [selectedPlayers, setSelectedPlayers] = useState([]);

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState(null);
  const [seasonData, setSeasonData] = useState(null);
  const [eiBundle, setEiBundle] = useState(null);

  const [playing, setPlaying] = useState(false);
  const [frameIndex, setFrameIndex] = useState(0);
  const [speed, setSpeed] = useState(SPEED_OPTIONS[1]);
  const playRef = useRef(null);

  const handleLoad = useCallback(async () => {
    const players =
      playerMode === "custom"
        ? selectedPlayers.map((p) => p.value)
        : ALL_PLAYERS;
    if (players.length === 0) {
      setError("Select at least one player.");
      return;
    }
    setLoading(true);
    setError(null);
    setPlaying(false);
    setEiBundle(null);
    setFrameIndex(0);
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

  useEffect(() => {
    if (!seasonData || seasonData.length === 0) return;
    const minGames = playerMode === "top" ? MIN_GAMES_ALL_PLAYERS : 0;
    const results = computeEIScoresByEra(
      seasonData,
      DEFAULT_CATEGORY_WEIGHTS,
      DEFAULT_SUBCATEGORY_WEIGHTS,
      {
        minGames,
        categoryGroups: CATEGORY_GROUPS,
        topYears: "all",
      }
    );
    setEiBundle(results);
  }, [seasonData, playerMode]);

  useEffect(() => {
    setFrameIndex(0);
    setPlaying(false);
  }, [seasonData, playerMode]);

  const resolvedTopN = Math.min(30, Math.max(2, Number(topN) || 15));

  // Top mode: best N by era EI *each season*. Custom: fixed cohort.
  const boardBundle = useMemo(() => {
    if (!eiBundle) {
      return { timeline: [], topBySeason: [], series: [] };
    }

    if (playerMode === "custom") {
      const names = new Set(selectedPlayers.map((p) => p.value));
      const tracked = eiBundle.playerRankings.filter((p) =>
        names.has(p.player_name)
      );
      if (tracked.length === 0) {
        return { timeline: [], topBySeason: [], series: [] };
      }

      const byPlayer = new Map();
      for (const p of tracked) byPlayer.set(p.player_name, new Map());

      for (const p of tracked) {
        for (const s of p.allSeasons || []) {
          const ei = s.eiScore;
          if (ei == null || Number.isNaN(ei) || !Number.isFinite(ei)) continue;
          byPlayer.get(p.player_name).set(s.season, ei);
        }
      }

      const seasonSet = new Set();
      for (const map of byPlayer.values()) {
        for (const season of map.keys()) seasonSet.add(season);
      }
      const timeline = [...seasonSet].sort(compareSeasons);

      const series = tracked.map((p) => {
        const map = byPlayer.get(p.player_name) || new Map();
        return {
          player_name: p.player_name,
          color: playerColor(p.player_name),
          values: timeline.map((season) =>
            map.has(season) ? map.get(season) : null
          ),
        };
      });

      return { timeline, topBySeason: null, series };
    }

    const bySeason = new Map();
    for (const p of eiBundle.playerRankings) {
      for (const s of p.allSeasons || []) {
        const ei = s.eiScore;
        if (ei == null || Number.isNaN(ei) || !Number.isFinite(ei)) continue;
        if (!bySeason.has(s.season)) bySeason.set(s.season, []);
        bySeason.get(s.season).push({
          player_name: s.player_name,
          ei,
        });
      }
    }

    const timeline = [...bySeason.keys()].sort(compareSeasons);
    const topBySeason = timeline.map((season) => {
      const rows = bySeason.get(season) || [];
      return [...rows]
        .sort((a, b) => a.ei - b.ei)
        .slice(0, resolvedTopN)
        .map((r) => ({
          player_name: r.player_name,
          ei: r.ei,
          color: playerColor(r.player_name),
        }));
    });

    return { timeline, topBySeason, series: [] };
  }, [eiBundle, playerMode, selectedPlayers, resolvedTopN]);

  const { timeline, topBySeason, series: customSeries } = boardBundle;
  const maxFrame = Math.max(0, timeline.length - 1);
  const currentSeason = timeline[frameIndex] || null;

  useEffect(() => {
    if (frameIndex > maxFrame) setFrameIndex(maxFrame);
  }, [frameIndex, maxFrame]);

  useEffect(() => {
    if (!playing || timeline.length === 0) {
      if (playRef.current) {
        clearInterval(playRef.current);
        playRef.current = null;
      }
      return;
    }
    playRef.current = setInterval(() => {
      setFrameIndex((i) => {
        if (i >= maxFrame) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, msPerFrame(speed.value));
    return () => {
      if (playRef.current) {
        clearInterval(playRef.current);
        playRef.current = null;
      }
    };
  }, [playing, speed, maxFrame, timeline.length]);

  const liveRanks = useMemo(() => {
    if (!currentSeason) return [];

    if (playerMode === "top" && topBySeason) {
      const board = topBySeason[frameIndex] || [];
      return board.map((row, i) => ({
        player_name: row.player_name,
        ei: row.ei,
        color: row.color,
        rank: i + 1,
      }));
    }

    const active = [];
    for (const s of customSeries) {
      const ei = s.values[frameIndex];
      if (ei == null) continue;
      active.push({
        player_name: s.player_name,
        ei,
        color: s.color,
      });
    }
    active.sort((a, b) => a.ei - b.ei);
    return active.map((row, i) => ({ ...row, rank: i + 1 }));
  }, [currentSeason, playerMode, topBySeason, frameIndex, customSeries]);

  const rankByName = useMemo(() => {
    const m = new Map();
    for (const r of liveRanks) m.set(r.player_name, r.rank);
    return m;
  }, [liveRanks]);

  // Top mode: keep curves for everyone who has been on the board through the
  // current frame (so dropouts leave a trail). Right panel = current top N only.
  const plotSeries = useMemo(() => {
    if (playerMode === "custom") {
      return customSeries.map((s) => ({ ...s, active: true }));
    }
    if (!topBySeason || timeline.length === 0) return [];

    const seen = new Map(); // name → color
    for (let i = 0; i <= frameIndex; i++) {
      for (const row of topBySeason[i] || []) {
        if (!seen.has(row.player_name)) {
          seen.set(row.player_name, row.color);
        }
      }
    }

    const activeNames = new Set(liveRanks.map((r) => r.player_name));

    return [...seen.entries()].map(([name, color]) => ({
      player_name: name,
      color,
      active: activeNames.has(name),
      values: timeline.map((_, i) => {
        if (i > frameIndex) return null;
        const board = topBySeason[i] || [];
        const hit = board.find((x) => x.player_name === name);
        return hit ? hit.ei : null;
      }),
    }));
  }, [
    playerMode,
    customSeries,
    topBySeason,
    timeline,
    frameIndex,
    liveRanks,
  ]);

  const plotData = useMemo(() => {
    const end = frameIndex;
    // Current board first in legend, then historical trails.
    const ordered = [...plotSeries].sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      const ra = rankByName.get(a.player_name) ?? 999;
      const rb = rankByName.get(b.player_name) ?? 999;
      return ra - rb;
    });

    return ordered.map((s) => {
      const x = [];
      const y = [];
      const customdata = [];
      for (let i = 0; i <= end; i++) {
        x.push(i);
        y.push(s.values[i]);
        customdata.push(timeline[i]);
      }
      const rank = rankByName.get(s.player_name);
      const label =
        rank != null
          ? `${s.player_name}  #${rank}`
          : `${s.player_name}  (left)`;
      const stroke = s.active ? s.color : withAlpha(s.color, 0.35);
      return {
        type: "scatter",
        mode: "lines+markers",
        name: label,
        x,
        y,
        customdata,
        connectgaps: false,
        line: { color: stroke, width: s.active ? 2.4 : 1.4 },
        marker: {
          size: s.active ? 5 : 3,
          color: stroke,
        },
        opacity: s.active ? 1 : 0.55,
        hovertemplate:
          `<b>${s.player_name}</b><br>` +
          `Season: %{customdata}<br>EI: %{y:.5f}<extra></extra>`,
      };
    });
  }, [plotSeries, timeline, frameIndex, rankByName]);

  const plotLayout = useMemo(() => {
    const end = frameIndex;
    const tickidxs = [];
    const ticktext = [];
    const step = Math.max(1, Math.ceil((end + 1) / 16));
    for (let i = 0; i <= end; i += step) {
      tickidxs.push(i);
      ticktext.push(timeline[i]);
    }
    if (end >= 0 && tickidxs[tickidxs.length - 1] !== end) {
      tickidxs.push(end);
      ticktext.push(timeline[end]);
    }
    return {
      paper_bgcolor: "transparent",
      plot_bgcolor: "rgba(20,24,33,0.55)",
      font: { color: "#8b92a5", size: 11 },
      margin: { t: 28, r: 24, b: 64, l: 56 },
      height: 480,
      showlegend: true,
      legend: {
        orientation: "v",
        x: 1.02,
        xanchor: "left",
        y: 1,
        font: { size: 11, color: "#c5cad6" },
        bgcolor: "rgba(0,0,0,0)",
      },
      xaxis: {
        title: "Season",
        tickmode: "array",
        tickvals: tickidxs,
        ticktext,
        tickangle: -45,
        gridcolor: "rgba(255,255,255,0.04)",
        zeroline: false,
        range: end > 0 ? [-0.5, end + 0.5] : undefined,
      },
      yaxis: {
        title: "Season EI (↓ better)",
        autorange: "reversed",
        gridcolor: "rgba(255,255,255,0.04)",
        zeroline: false,
      },
      title: {
        text: currentSeason
          ? `Through ${currentSeason}`
          : "Load players to begin",
        font: { size: 14, color: "#e8eaed" },
        x: 0,
        xanchor: "left",
      },
    };
  }, [currentSeason, frameIndex, timeline]);

  const handleReplay = () => {
    setFrameIndex(0);
    setPlaying(true);
  };

  return (
    <div className="goat-page create-goat-page goat-animation-page">
      <div className="controls-panel">
        <h2 className="controls-title">NBA GOAT Animation</h2>
        <p className="controls-description">
          Watch the era-adjusted season EI board evolve. Top X shows the best X
          each season, the live ranking churns, while past board members keep
          their curves so you can follow the ranking over time. Lower EI is
          better.
        </p>

        <div className="goat-animation-controls">
          <div className="lab-control-card lab-step-card">
            <label className="lab-control-label">
              <span className="lab-step-badge">1</span>
              Players
            </label>
            <div className="player-mode-toggle">
              <button
                type="button"
                className={`mode-btn ${playerMode === "top" ? "mode-btn--active" : ""}`}
                onClick={() => setPlayerMode("top")}
              >
                Top X each season
              </button>
              <button
                type="button"
                className={`mode-btn ${playerMode === "custom" ? "mode-btn--active" : ""}`}
                onClick={() => setPlayerMode("custom")}
              >
                Custom selection
              </button>
            </div>

            {playerMode === "top" ? (
              <>
                <label className="lab-control-sublabel" htmlFor="top-n">
                  Board size (best X that season)
                </label>
                <input
                  id="top-n"
                  className="goat-anim-number"
                  type="number"
                  min={2}
                  max={30}
                  value={topN}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (Number.isNaN(v)) {
                      setTopN(e.target.value);
                      return;
                    }
                    setTopN(Math.min(30, Math.max(2, v)));
                  }}
                />
                <span className="control-hint">
                  Every season keeps only the best {resolvedTopN} by era-
                  adjusted EI. Dropouts leave a trail on the chart; the side
                  ranking shows the current board only.
                </span>
              </>
            ) : (
              <>
                <Select
                  isMulti
                  options={PLAYER_OPTIONS}
                  value={selectedPlayers}
                  onChange={setSelectedPlayers}
                  placeholder="Search and select players…"
                  styles={selectStyles}
                  closeMenuOnSelect={false}
                  menuPortalTarget={
                    typeof document !== "undefined" ? document.body : null
                  }
                  menuPlacement="auto"
                  filterOption={(option, input) =>
                    option.label.toLowerCase().includes(input.toLowerCase())
                  }
                />
                <span className="control-hint">
                  Fixed cohort, ranks among your selected players only.
                </span>
              </>
            )}
          </div>

          <div className="lab-control-card lab-step-card">
            <label className="lab-control-label">
              <span className="lab-step-badge">2</span>
              Playback
            </label>
            <div className="goat-anim-transport">
              <button
                type="button"
                className="builder-btn builder-btn--primary"
                disabled={!timeline.length}
                onClick={() => setPlaying((p) => !p)}
              >
                {playing ? "Pause" : "Play"}
              </button>
              <button
                type="button"
                className="builder-btn builder-btn--ghost"
                disabled={!timeline.length}
                onClick={handleReplay}
              >
                Replay
              </button>
              <Select
                options={SPEED_OPTIONS}
                value={speed}
                onChange={setSpeed}
                styles={selectStyles}
                isDisabled={!timeline.length}
                menuPortalTarget={
                  typeof document !== "undefined" ? document.body : null
                }
              />
            </div>
            <label className="lab-control-sublabel" htmlFor="season-scrub">
              Season scrubber
              {currentSeason ? `, ${currentSeason}` : ""}
            </label>
            <input
              id="season-scrub"
              className="goat-anim-scrub"
              type="range"
              min={0}
              max={maxFrame || 0}
              step={1}
              value={Math.min(frameIndex, maxFrame)}
              disabled={!timeline.length}
              onChange={(e) => {
                setPlaying(false);
                setFrameIndex(Number(e.target.value));
              }}
            />
            <span className="control-hint">
              Axis advances season by season. Curves stay for anyone who has
              been on the board so far.
            </span>
          </div>
        </div>

        <button
          className="analyze-btn"
          onClick={handleLoad}
          disabled={
            loading ||
            (playerMode === "custom" && selectedPlayers.length === 0)
          }
        >
          {loading ? (
            <>
              <span className="spinner" />
              {progress || "Loading…"}
            </>
          ) : seasonData ? (
            "Reload Players"
          ) : (
            "Load Players"
          )}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {timeline.length > 0 && (
        <div className="results-section goat-anim-results">
          <div className="result-card goat-anim-chart-card">
            <div className="result-card-header">
              <div>
                <h3 className="result-card-title">Season EI board</h3>
                <p className="result-card-subtitle">
                  Era-adjusted, Lab default weights,{" "}
                  {playerMode === "top"
                    ? `Top ${resolvedTopN} each season`
                    : "Custom cohort"}
                  , {timeline[0]} to {timeline[timeline.length - 1]}
                </p>
              </div>
            </div>
            <div className="goat-anim-layout">
              <div className="goat-anim-plot">
                <Plot
                  data={plotData}
                  layout={plotLayout}
                  config={{ displayModeBar: false, responsive: true }}
                  style={{ width: "100%" }}
                  useResizeHandler
                />
              </div>
              <aside className="goat-anim-ranks">
                <div className="goat-anim-ranks-title">
                  {playerMode === "top"
                    ? `Top ${resolvedTopN}, ${currentSeason || "…"}`
                    : `Live ranks, ${currentSeason || "…"}`}
                </div>
                <p className="goat-anim-ranks-hint">
                  {playerMode === "top"
                    ? "Current board only, chart keeps trails of past members (lower EI = better)"
                    : "Among selected players active this season (lower EI = better)"}
                </p>
                <ol className="goat-anim-rank-list">
                  {liveRanks.length === 0 && (
                    <li className="goat-anim-rank-empty">
                      No active players this frame
                    </li>
                  )}
                  {liveRanks.map((r) => (
                    <li key={r.player_name} className="goat-anim-rank-row">
                      <span className="goat-anim-rank-pos">#{r.rank}</span>
                      <span
                        className="goat-anim-rank-dot"
                        style={{ background: r.color }}
                      />
                      <span className="goat-anim-rank-name">
                        {r.player_name}
                      </span>
                      <span className="goat-anim-rank-ei">
                        {r.ei.toFixed(4)}
                      </span>
                    </li>
                  ))}
                </ol>
              </aside>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
