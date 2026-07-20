import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Select from "react-select";
import Plotly from "plotly.js-dist-min";
import factoryModule from "react-plotly.js/factory";
import {
  CATEGORY_GROUPS,
  CATEGORIES,
  DEFAULT_CATEGORY_WEIGHTS,
  DEFAULT_SUBCATEGORY_WEIGHTS,
  MIN_GAMES_ALL_PLAYERS,
  assignDisplayRanks,
  computeEIScoresByEra,
  computeEIScoresHierarchical,
  decadeLabel,
} from "../../lib/soccerEi";
import "../DiscoverGoat.css";
import "../CreateGoatRanking.css";
import "../StatsComparison.css";
import "./Soccer.css";

const createPlotlyComponent = factoryModule.default || factoryModule;
const Plot = createPlotlyComponent(Plotly);

const ALL_SUBCATEGORIES = Object.keys(CATEGORIES);

const TOP_YEARS_OPTIONS = [
  { value: "all", label: "Full career" },
  { value: 1, label: "Best 1 season" },
  { value: 3, label: "Best 3-year window" },
  { value: 5, label: "Best 5-year window" },
  { value: 7, label: "Best 7-year window" },
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
  menu: (base) => ({
    ...base,
    background: "#141821",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 6,
    zIndex: 20,
  }),
  menuList: (base) => ({ ...base, padding: 4, maxHeight: 280 }),
  menuPortal: (base) => ({ ...base, zIndex: 9999 }),
};

function getCategoryColor(colorIndex) {
  const hue = (colorIndex * 137.508) % 360;
  return {
    main: `hsl(${hue}, 68%, 62%)`,
    soft: `hsla(${hue}, 68%, 62%, 0.1)`,
    border: `hsla(${hue}, 68%, 62%, 0.32)`,
    glow: `hsla(${hue}, 68%, 62%, 0.22)`,
  };
}

function initialCategoryColorMap() {
  const map = {};
  Object.keys(CATEGORY_GROUPS).forEach((cat, i) => {
    map[cat] = i;
  });
  return map;
}

function categoryColorStyle(colorIndex) {
  const c = getCategoryColor(colorIndex);
  return {
    "--cat-color": c.main,
    "--cat-soft": c.soft,
    "--cat-border": c.border,
    "--cat-glow": c.glow,
  };
}

function initialGroupsState() {
  const groups = {};
  for (const [cat, subs] of Object.entries(CATEGORY_GROUPS)) {
    groups[cat] = [...subs];
  }
  return groups;
}

function initialCategoryOrder() {
  return Object.keys(CATEGORY_GROUPS);
}

function initialCategoryWeights() {
  return { ...DEFAULT_CATEGORY_WEIGHTS };
}

function initialSubCategoryWeights() {
  return { ...DEFAULT_SUBCATEGORY_WEIGHTS };
}

function buildUserCategoryGroups(categoryOrder, userGroups) {
  const groups = {};
  for (const c of categoryOrder) {
    const subs = userGroups[c] || [];
    if (subs.length > 0) groups[c] = subs;
  }
  return groups;
}

function GoatRankingList({ players, onSelectPlayer }) {
  return (
    <div className="goat-ranking-list">
      {players.map((player) => (
        <div
          key={player.player_name}
          className={`goat-rank-row ${player.displayRank === 1 ? "goat-rank-row--first" : ""}`}
          onClick={() =>
            onSelectPlayer({ ...player, _rank: player.displayRank })
          }
        >
          <div className="goat-rank-pos">
            {player.displayRank === 1 ? "👑" : player.displayRank}
          </div>
          <div className="goat-rank-info">
            <span className="goat-rank-name">{player.player_name}</span>
            <span className="goat-rank-meta">
              {player.totalSeasons} seasons · {player.totalGames} games
            </span>
          </div>
          <div className="goat-rank-scores">
            <div className="goat-rank-ei">{player.careerEI.toFixed(5)}</div>
            <div className="goat-rank-peak">
              Peak: {player.peakEI.toFixed(5)}
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
  );
}

function PlayerDrawer({ player, onClose }) {
  if (!player) return null;
  const seasons = [...(player.selectedSeasons || [])].sort(
    (a, b) => (a.season_start || 0) - (b.season_start || 0)
  );
  const cats = Object.keys(player.selectedSeasons?.[0]?.categoryGroupScores || {});
  const catAvgs = cats.map((c) => {
    const vals = seasons
      .map((s) => s.categoryGroupScores?.[c])
      .filter((v) => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  });

  return (
    <div className="player-card-overlay" onClick={onClose}>
      <div
        className="player-card soccer-player-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="player-card-header">
          <h3>
            #{player._rank ?? player.displayRank} {player.player_name}
          </h3>
          <button className="player-card-close" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="soccer-drawer-note">
          Career EI {player.careerEI.toFixed(5)} · Peak{" "}
          {player.peakEI.toFixed(5)} · lower is better
        </p>
        <Plot
          data={[
            {
              type: "scatter",
              mode: "lines+markers",
              x: seasons.map((s) => s.season),
              y: seasons.map((s) => s.eiScore),
              line: { color: "#4ab5e8", width: 2.5 },
              marker: { size: 7 },
              name: "Season EI",
            },
          ]}
          layout={{
            paper_bgcolor: "transparent",
            plot_bgcolor: "rgba(20,24,33,0.5)",
            font: { color: "#8b92a5", size: 11 },
            margin: { t: 10, r: 16, b: 50, l: 44 },
            height: 220,
            xaxis: { tickangle: -40, gridcolor: "rgba(255,255,255,0.04)" },
            yaxis: {
              title: "EI (↓ better)",
              autorange: "reversed",
              gridcolor: "rgba(255,255,255,0.04)",
            },
            showlegend: false,
          }}
          config={{ displayModeBar: false, responsive: true }}
          style={{ width: "100%" }}
        />
        {cats.length > 0 && (
          <>
            <h4 className="soccer-drawer-sub">Category EI averages</h4>
            <Plot
              data={[
                {
                  type: "bar",
                  orientation: "h",
                  y: cats,
                  x: catAvgs.map((v) => v ?? 0),
                  marker: { color: "#3fbf9b" },
                  text: catAvgs.map((v) => (v == null ? "—" : v.toFixed(3))),
                  textposition: "outside",
                },
              ]}
              layout={{
                paper_bgcolor: "transparent",
                plot_bgcolor: "rgba(20,24,33,0.5)",
                font: { color: "#8b92a5", size: 11 },
                margin: { t: 8, r: 48, b: 30, l: 110 },
                height: Math.max(220, cats.length * 36 + 40),
                xaxis: {
                  title: "EI (↓ better)",
                  range: [0, 1],
                  gridcolor: "rgba(255,255,255,0.04)",
                },
                yaxis: { automargin: true },
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: "100%" }}
            />
          </>
        )}
      </div>
    </div>
  );
}

export default function SoccerGoatRanking() {
  const [seasonData, setSeasonData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [results, setResults] = useState(null);
  const [playerCard, setPlayerCard] = useState(null);

  const [scoreType, setScoreType] = useState("classic");
  const [eiMode, setEiMode] = useState("all_time");
  const [eraDecadeFilter, setEraDecadeFilter] = useState("all");
  const [topYears, setTopYears] = useState(TOP_YEARS_OPTIONS[0]);

  const [userGroups, setUserGroups] = useState(initialGroupsState);
  const [categoryOrder, setCategoryOrder] = useState(initialCategoryOrder);
  const [categoryWeights, setCategoryWeights] = useState(initialCategoryWeights);
  const [subCategoryWeights, setSubCategoryWeights] = useState(
    initialSubCategoryWeights
  );
  const [newCategoryName, setNewCategoryName] = useState("");
  const [categoryColorMap, setCategoryColorMap] = useState(
    initialCategoryColorMap
  );
  const [nextColorIndex, setNextColorIndex] = useState(
    () => Object.keys(CATEGORY_GROUPS).length
  );
  const [nameDrafts, setNameDrafts] = useState({});
  const dragInfo = useRef(null);
  const [dragTarget, setDragTarget] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/soccer/season_features.json");
        if (!res.ok) throw new Error(`Failed to load features (${res.status})`);
        const json = await res.json();
        if (!cancelled) setSeasonData(json.seasons || []);
      } catch (err) {
        if (!cancelled) {
          setError(err.message || "Failed to load season features.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const addCategory = useCallback(() => {
    const raw = newCategoryName.trim();
    if (!raw) return;
    if (categoryOrder.includes(raw)) {
      setError(`A category named "${raw}" already exists.`);
      return;
    }
    setUserGroups((prev) => ({ ...prev, [raw]: [] }));
    const newOrder = [...categoryOrder, raw];
    setCategoryOrder(newOrder);
    setCategoryWeights(() => {
      const equalWeight = 1 / newOrder.length;
      const weights = {};
      for (const c of newOrder) weights[c] = equalWeight;
      return weights;
    });
    setCategoryColorMap((prev) => ({ ...prev, [raw]: nextColorIndex }));
    setNextColorIndex((n) => n + 1);
    setNewCategoryName("");
    setError(null);
  }, [newCategoryName, categoryOrder, nextColorIndex]);

  const removeCategory = useCallback(
    (catName) => {
      setUserGroups((prev) => {
        const next = { ...prev };
        const moved = next[catName] || [];
        delete next[catName];
        const remaining = categoryOrder.filter((c) => c !== catName);
        if (moved.length > 0 && remaining.length > 0) {
          const fallback = remaining[0];
          next[fallback] = [...(next[fallback] || []), ...moved];
        }
        return next;
      });
      setCategoryOrder((prev) => prev.filter((c) => c !== catName));
      setCategoryWeights((prev) => {
        const next = { ...prev };
        delete next[catName];
        return next;
      });
      setCategoryColorMap((prev) => {
        const next = { ...prev };
        delete next[catName];
        return next;
      });
    },
    [categoryOrder]
  );

  const renameCategory = useCallback(
    (oldName, newName) => {
      const trimmed = newName.trim();
      if (!trimmed || trimmed === oldName) return;
      if (categoryOrder.includes(trimmed)) {
        setError(`A category named "${trimmed}" already exists.`);
        return;
      }
      setUserGroups((prev) => {
        const next = {};
        for (const k of Object.keys(prev)) {
          next[k === oldName ? trimmed : k] = prev[k];
        }
        return next;
      });
      setCategoryOrder((prev) =>
        prev.map((c) => (c === oldName ? trimmed : c))
      );
      setCategoryWeights((prev) => {
        const next = { ...prev };
        if (oldName in next) {
          next[trimmed] = next[oldName];
          delete next[oldName];
        }
        return next;
      });
      setCategoryColorMap((prev) => {
        const next = { ...prev };
        if (oldName in next) {
          next[trimmed] = next[oldName];
          delete next[oldName];
        }
        return next;
      });
      setError(null);
    },
    [categoryOrder]
  );

  const handleNameDraftChange = useCallback((cat, value) => {
    setNameDrafts((prev) => ({ ...prev, [cat]: value }));
  }, []);

  const commitNameDraft = useCallback(
    (cat) => {
      setNameDrafts((prev) => {
        if (!(cat in prev)) return prev;
        const draft = prev[cat];
        const next = { ...prev };
        delete next[cat];
        const trimmed = (draft ?? "").trim();
        if (trimmed && trimmed !== cat) {
          queueMicrotask(() => renameCategory(cat, trimmed));
        }
        return next;
      });
    },
    [renameCategory]
  );

  const cancelNameDraft = useCallback((cat) => {
    setNameDrafts((prev) => {
      if (!(cat in prev)) return prev;
      const next = { ...prev };
      delete next[cat];
      return next;
    });
  }, []);

  const moveSubCategory = useCallback((subCat, fromCat, toCat) => {
    if (!fromCat || !toCat || fromCat === toCat) return;
    setUserGroups((prev) => {
      const next = { ...prev };
      next[fromCat] = (next[fromCat] || []).filter((s) => s !== subCat);
      const dest = (next[toCat] || []).filter((s) => s !== subCat);
      next[toCat] = [...dest, subCat];
      return next;
    });
  }, []);

  const handleCategoryWeightChange = useCallback((catName, value) => {
    setCategoryWeights((prev) => ({ ...prev, [catName]: value }));
  }, []);

  const handleSubCategoryWeightChange = useCallback((subCat, value) => {
    setSubCategoryWeights((prev) => ({ ...prev, [subCat]: value }));
  }, []);

  const resetToDefaults = useCallback(() => {
    setUserGroups(initialGroupsState());
    setCategoryOrder(initialCategoryOrder());
    setCategoryWeights(initialCategoryWeights());
    setSubCategoryWeights(initialSubCategoryWeights());
    setCategoryColorMap(initialCategoryColorMap());
    setNextColorIndex(Object.keys(CATEGORY_GROUPS).length);
    setError(null);
  }, []);

  const onDragStart = useCallback((e, subCat, fromCat) => {
    dragInfo.current = { subCat, fromCat };
    e.dataTransfer.effectAllowed = "move";
    try {
      e.dataTransfer.setData("text/plain", subCat);
    } catch {
      /* ignore */
    }
  }, []);

  const onDragEnd = useCallback(() => {
    dragInfo.current = null;
    setDragTarget(null);
  }, []);

  const onDragOver = useCallback(
    (e, toCat) => {
      if (!dragInfo.current) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dragTarget !== toCat) setDragTarget(toCat);
    },
    [dragTarget]
  );

  const onDragLeave = useCallback(
    (e, toCat) => {
      if (e.currentTarget.contains(e.relatedTarget)) return;
      if (dragTarget === toCat) setDragTarget(null);
    },
    [dragTarget]
  );

  const onDrop = useCallback(
    (e, toCat) => {
      e.preventDefault();
      const info = dragInfo.current;
      dragInfo.current = null;
      setDragTarget(null);
      if (!info) return;
      moveSubCategory(info.subCat, info.fromCat, toCat);
    },
    [moveSubCategory]
  );

  const normalizedCategoryWeights = useMemo(() => {
    const entries = categoryOrder.map((c) => [c, categoryWeights[c] || 0]);
    const total = entries.reduce((s, [, v]) => s + v, 0);
    if (total <= 0) {
      const n = entries.length || 1;
      return Object.fromEntries(entries.map(([k]) => [k, 1 / n]));
    }
    return Object.fromEntries(entries.map(([k, v]) => [k, v / total]));
  }, [categoryOrder, categoryWeights]);

  const normalizedSubCategoryWeights = useMemo(() => {
    const result = {};
    for (const cat of categoryOrder) {
      const subs = userGroups[cat] || [];
      const total = subs.reduce(
        (s, sub) => s + (subCategoryWeights[sub] || 0),
        0
      );
      if (total <= 0) {
        const n = subs.length || 1;
        for (const sub of subs) result[sub] = 1 / n;
      } else {
        for (const sub of subs) {
          result[sub] = (subCategoryWeights[sub] || 0) / total;
        }
      }
    }
    return result;
  }, [categoryOrder, userGroups, subCategoryWeights]);

  const userCategoryGroups = useMemo(
    () => buildUserCategoryGroups(categoryOrder, userGroups),
    [categoryOrder, userGroups]
  );

  const assignedSubs = useMemo(() => {
    const set = new Set();
    for (const subs of Object.values(userGroups)) {
      for (const s of subs) set.add(s);
    }
    return set;
  }, [userGroups]);

  const unassignedSubs = useMemo(
    () => ALL_SUBCATEGORIES.filter((s) => !assignedSubs.has(s)),
    [assignedSubs]
  );

  useEffect(() => {
    if (!seasonData || seasonData.length === 0) return;
    const opts = {
      minGames: MIN_GAMES_ALL_PLAYERS,
      categoryGroups: userCategoryGroups,
      scoreType,
    };
    const eiResults =
      eiMode === "era"
        ? computeEIScoresByEra(
            seasonData,
            normalizedCategoryWeights,
            normalizedSubCategoryWeights,
            { ...opts, topYears: topYears.value }
          )
        : computeEIScoresHierarchical(
            seasonData,
            normalizedCategoryWeights,
            normalizedSubCategoryWeights,
            topYears.value,
            opts
          );
    setResults(eiResults);
  }, [
    seasonData,
    eiMode,
    userCategoryGroups,
    normalizedCategoryWeights,
    normalizedSubCategoryWeights,
    topYears,
    scoreType,
  ]);

  const eraDecadeOptions = useMemo(() => {
    if (eiMode !== "era" || !results?.decadeRankings) return [];
    const opts = Object.entries(results.decadeRankings)
      .map(([dk, r]) => ({ dk: Number(dk), n: r.players.length }))
      .sort((a, b) => a.dk - b.dk)
      .map(({ dk, n }) => ({ value: dk, label: `${decadeLabel(dk)} (${n})` }));
    return [{ value: "all", label: "All eras" }, ...opts];
  }, [eiMode, results]);

  const rankingsFor = useCallback(
    (res) => {
      if (!res) return [];
      if (eiMode === "era" && eraDecadeFilter !== "all") {
        return res.decadeRankings?.[eraDecadeFilter]?.players ?? [];
      }
      return res.playerRankings || [];
    },
    [eiMode, eraDecadeFilter]
  );

  const rankedPlayers = useMemo(() => {
    if (!results) return [];
    return assignDisplayRanks(rankingsFor(results).slice(0, 50));
  }, [results, rankingsFor]);

  return (
    <div className="goat-page create-goat-page soccer-page">
      <div className="controls-panel stats-panel soccer-panel">
        <div className="stats-panel-header">
          <h2 className="stats-panel-title soccer-title">
            Soccer GOAT Ranking
          </h2>
          <p className="controls-description">
            Same EI pipeline as the NBA lab — Step 1 sigmoid-normalizes each
            measure (10th/90th percentile), Step 2 rolls up with hierarchical
            weighted RMS. Lower EI is better. Drag sub-categories and tune
            weights live.
          </p>
        </div>

        <div className="soccer-mode-strip">
          <button
            type="button"
            className={`soccer-chip ${scoreType === "classic" ? "soccer-chip--on" : ""}`}
            onClick={() => setScoreType("classic")}
          >
            CLASSIC
            <span>goals / assists / shots — all eras</span>
          </button>
          <button
            type="button"
            className={`soccer-chip ${scoreType === "full" ? "soccer-chip--on" : ""}`}
            onClick={() => setScoreType("full")}
          >
            FULL
            <span>includes xG, touches, rating, dribbles…</span>
          </button>
        </div>

        <div className="goat-controls-layout">
          <div className="goat-left-controls step-panel">
            <div className="step-panel-header">
              <span className="step-panel-title">Step by Step Picks</span>
              <span className="step-panel-subtitle">
                Build your ranking one choice at a time
              </span>
            </div>

            <div className="lab-control-card lab-step-card">
              <label className="lab-control-label">
                <span className="lab-step-badge soccer-badge">1</span>
                Stat Distribution
              </label>
              <div className="player-mode-toggle">
                <button
                  type="button"
                  className={`mode-btn ${eiMode === "all_time" ? "mode-btn--active" : ""}`}
                  onClick={() => {
                    setEiMode("all_time");
                    setEraDecadeFilter("all");
                  }}
                >
                  All-Time
                </button>
                <button
                  type="button"
                  className={`mode-btn ${eiMode === "era" ? "mode-btn--active" : ""}`}
                  onClick={() => {
                    setEiMode("era");
                    setEraDecadeFilter("all");
                  }}
                >
                  Era by Era
                </button>
              </div>
              <span className="control-hint">
                {eiMode === "era"
                  ? "Each season is scored against players from the same decade — dominance vs contemporaries."
                  : "Every season is scored against the full all-time distribution."}
              </span>

              {eiMode === "era" && (
                <div className="lab-subfield">
                  <label className="lab-control-sublabel">Decade ranking</label>
                  <Select
                    options={eraDecadeOptions}
                    value={
                      eraDecadeOptions.find(
                        (o) => String(o.value) === String(eraDecadeFilter)
                      ) || null
                    }
                    onChange={(opt) =>
                      setEraDecadeFilter(opt ? opt.value : "all")
                    }
                    styles={selectStyles}
                    isDisabled={eraDecadeOptions.length === 0}
                    placeholder={
                      eraDecadeOptions.length === 0
                        ? "Loading…"
                        : "All eras…"
                    }
                    menuPortalTarget={
                      typeof document !== "undefined" ? document.body : null
                    }
                    menuPlacement="auto"
                  />
                </div>
              )}
            </div>

            {(eiMode === "all_time" ||
              (eiMode === "era" && eraDecadeFilter === "all")) && (
              <div className="lab-control-card lab-step-card">
                <label className="lab-control-label">
                  <span className="lab-step-badge soccer-badge">2</span>
                  Top Years Window
                </label>
                <Select
                  options={TOP_YEARS_OPTIONS}
                  value={topYears}
                  onChange={setTopYears}
                  styles={selectStyles}
                  menuPortalTarget={
                    typeof document !== "undefined" ? document.body : null
                  }
                  menuPlacement="auto"
                />
                <span className="control-hint">
                  Rank on a player&apos;s whole career, or his best consecutive
                  stretch (lowest average EI).
                </span>
              </div>
            )}

            <div className="lab-control-card lab-step-card">
              <label className="lab-control-label">
                <span className="lab-step-badge soccer-badge">
                  {eiMode === "all_time" || eraDecadeFilter === "all" ? "3" : "2"}
                </span>
                Your Categories
              </label>
              <div className="builder-actions">
                <input
                  className="builder-name-input"
                  type="text"
                  placeholder="New category name…"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCategory();
                    }
                  }}
                />
                <button
                  type="button"
                  className="builder-btn builder-btn--primary"
                  onClick={addCategory}
                  disabled={!newCategoryName.trim()}
                >
                  + Add
                </button>
                <button
                  type="button"
                  className="builder-btn builder-btn--ghost"
                  onClick={resetToDefaults}
                  title="Reset to the default category tree"
                >
                  Reset
                </button>
              </div>
              {unassignedSubs.length > 0 && (
                <div className="builder-warning">
                  {unassignedSubs.length} sub-categor
                  {unassignedSubs.length === 1 ? "y" : "ies"} not assigned —
                  they won&rsquo;t contribute to EI.
                </div>
              )}
            </div>
          </div>

          <div className="goat-right-controls">
            <div className="lab-builder-header">
              <h3 className="lab-builder-title">Category Builder</h3>
              <p className="lab-builder-hint">
                Drag a sub-category card onto another category to move it.
                Category weights sum to 1 · sub-categories sum to 1 within each
                category.
              </p>
            </div>

            <div className="builder-grid">
              {categoryOrder.map((cat) => {
                const subs = userGroups[cat] || [];
                const isTarget = dragTarget === cat;
                const sharePct =
                  (normalizedCategoryWeights[cat] || 0) * 100;
                const colorIndex = categoryColorMap[cat] ?? 0;
                return (
                  <div
                    key={cat}
                    className={`builder-category ${isTarget ? "builder-category--drop" : ""}`}
                    style={categoryColorStyle(colorIndex)}
                    onDragOver={(e) => onDragOver(e, cat)}
                    onDragLeave={(e) => onDragLeave(e, cat)}
                    onDrop={(e) => onDrop(e, cat)}
                  >
                    <div className="builder-category-header">
                      <span className="builder-category-dot" aria-hidden />
                      <input
                        className="builder-category-name"
                        value={nameDrafts[cat] ?? cat}
                        onChange={(e) =>
                          handleNameDraftChange(cat, e.target.value)
                        }
                        onBlur={() => commitNameDraft(cat)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.currentTarget.blur();
                          } else if (e.key === "Escape") {
                            cancelNameDraft(cat);
                            e.currentTarget.blur();
                          }
                        }}
                      />
                      <span className="builder-category-share">
                        {sharePct.toFixed(1)}%
                      </span>
                      {categoryOrder.length > 1 && (
                        <button
                          type="button"
                          className="builder-category-remove"
                          onClick={() => removeCategory(cat)}
                          title="Remove this category (sub-categories move to the first remaining one)"
                        >
                          ×
                        </button>
                      )}
                    </div>

                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={categoryWeights[cat] ?? 0}
                      onChange={(e) =>
                        handleCategoryWeightChange(
                          cat,
                          parseFloat(e.target.value)
                        )
                      }
                      className="weight-slider-input weight-group-slider builder-cat-slider"
                    />

                    <div className="builder-subs">
                      {subs.length === 0 ? (
                        <div className="builder-empty">
                          Drop sub-categories here
                        </div>
                      ) : (
                        subs.map((sub) => (
                          <div
                            key={sub}
                            className="builder-sub"
                            draggable
                            onDragStart={(e) => onDragStart(e, sub, cat)}
                            onDragEnd={onDragEnd}
                          >
                            <div className="builder-sub-row">
                              <span className="builder-sub-handle">⋮⋮</span>
                              <span className="builder-sub-name">{sub}</span>
                              <span className="builder-sub-share">
                                {(
                                  (normalizedSubCategoryWeights[sub] || 0) *
                                  100
                                ).toFixed(1)}
                                %
                              </span>
                            </div>
                            <input
                              type="range"
                              min="0"
                              max="1"
                              step="0.01"
                              value={subCategoryWeights[sub] ?? 0}
                              onChange={(e) =>
                                handleSubCategoryWeightChange(
                                  sub,
                                  parseFloat(e.target.value)
                                )
                              }
                              className="weight-slider-input builder-sub-slider"
                            />
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {loading && (
        <div className="controls-panel">
          <p className="controls-description">
            Loading season features & computing EI…
          </p>
        </div>
      )}
      {error && <div className="error-banner">{error}</div>}

      {results && !loading && (
        <div className="results-section">
          <div className="result-card soccer-result-card">
            <div className="result-card-header">
              <div>
                <h3 className="result-card-title">GOAT Leaderboard</h3>
                <p className="result-card-subtitle">
                  {scoreType.toUpperCase()} ·{" "}
                  {eiMode === "era" ? "Era-relative" : "All-time"} ·{" "}
                  {eiMode === "era" && eraDecadeFilter !== "all"
                    ? decadeLabel(Number(eraDecadeFilter))
                    : topYears.label}{" "}
                  · lower EI is better
                </p>
              </div>
              <span className="soccer-live-badge">
                Live EI · {rankedPlayers.length} shown
              </span>
            </div>
            <GoatRankingList
              players={rankedPlayers}
              onSelectPlayer={setPlayerCard}
            />
          </div>
        </div>
      )}

      {playerCard && (
        <PlayerDrawer
          player={playerCard}
          onClose={() => setPlayerCard(null)}
        />
      )}
    </div>
  );
}
