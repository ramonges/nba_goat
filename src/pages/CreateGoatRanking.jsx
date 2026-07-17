import { useState, useCallback, useMemo, useEffect, useRef } from "react";
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
  computeEIScoresByEra,
  assignDisplayRanks,
  decadeLabel,
} from "../lib/eiComputation";
import "./DiscoverGoat.css";
import "./CreateGoatRanking.css";

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

// Gamified one-click leaderboards. Each preset loads every player, resets to the
// balanced default weighting, and jumps to that decade's era-relative ranking
// (or the all-time board). `dk: "all"` = all-time; a number = that decade.
const DECADE_PRESETS = [
  { dk: "all", decade: "All-Time", tag: "GOATs", color: "#f2c14e" },
  { dk: 1960, decade: "1960s", tag: "Best Players", color: "#e8894a" },
  { dk: 1970, decade: "1970s", tag: "Best Players", color: "#e05a6d" },
  { dk: 1980, decade: "1980s", tag: "Best Players", color: "#b86ce0" },
  { dk: 1990, decade: "1990s", tag: "Best Players", color: "#6c7ae0" },
  { dk: 2000, decade: "2000s", tag: "Best Players", color: "#4ab5e8" },
  { dk: 2010, decade: "2010s", tag: "Best Players", color: "#3fbf9b" },
  { dk: 2020, decade: "2020s", tag: "Best Players", color: "#7ac74f" },
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

// All sub-category names that exist in the library, used as the master pool.
const ALL_SUBCATEGORIES = Object.keys(CATEGORIES);

// Golden-angle hues so each new category gets a distinct color on dark UI.
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

// Build initial user state from the library defaults.
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
  const cats = Object.keys(CATEGORY_GROUPS);
  const equal = 1 / cats.length;
  const w = {};
  for (const c of cats) w[c] = equal;
  return w;
}

function initialSubCategoryWeights() {
  const w = {};
  for (const subs of Object.values(CATEGORY_GROUPS)) {
    for (const s of subs) w[s] = 1.0;
  }
  return w;
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
            <div className="goat-rank-ei">{player.careerEI.toFixed(3)}</div>
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
  );
}

export default function CreateGoatRanking() {
  const [playerMode, setPlayerMode] = useState("all");
  const [selectedPlayers, setSelectedPlayers] = useState([]);
  const [topYears, setTopYears] = useState(TOP_YEARS_OPTIONS[0]);
  // "all_time" = normalize vs the whole distribution.
  // "era"      = normalize each player vs the players of his own decade(s).
  const [eiMode, setEiMode] = useState("all_time");
  const [eraDecadeFilter, setEraDecadeFilter] = useState("all");

  // ── User-built category tree ────────────────────────────────────────────
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
  // Draft buffer for category-name inputs. Without this we'd mutate
  // `categoryOrder` (and therefore React keys) on every keystroke, causing the
  // input to remount and lose focus after each typed character.
  const [nameDrafts, setNameDrafts] = useState({});
  // Active drag state — used purely for visual affordance on drop targets.
  const dragInfo = useRef(null);
  const [dragTarget, setDragTarget] = useState(null);

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState(null);
  const [seasonData, setSeasonData] = useState(null);
  const [results, setResults] = useState(null);
  const [playerCard, setPlayerCard] = useState(null);
  const [showComparison, setShowComparison] = useState(false);

  // ── Category / sub-category mutations ───────────────────────────────────
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
        // Re-home the sub-categories into the first remaining category, if any,
        // so they aren't silently dropped.
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
          // Defer so the React state update for the input value happens first.
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
      // Avoid duplicates if the user drops the same sub-cat repeatedly.
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

  // One-click gamified preset: balanced default weights + the chosen board
  // (all-time or a single decade), loading every player if needed.
  const applyDecadePreset = useCallback(
    async (dk) => {
      resetToDefaults();
      setPlayerMode("all");
      setShowComparison(false);
      if (dk === "all") {
        setEiMode("all_time");
        setEraDecadeFilter("all");
      } else {
        setEiMode("era");
        setEraDecadeFilter(dk);
      }
      if (seasonData) return; // already loaded → live recompute handles the rest
      setLoading(true);
      setError(null);
      setResults(null);
      setPlayerCard(null);
      try {
        const data = await fetchAllPlayersSeasonAverages(
          ALL_PLAYERS,
          (current, total, name) =>
            setProgress(`Fetching ${name} (${current}/${total})`)
        );
        setSeasonData(data);
      } catch (err) {
        setError(err.message || "Failed to fetch data.");
      } finally {
        setLoading(false);
        setProgress("");
      }
    },
    [seasonData, resetToDefaults]
  );

  // ── Drag handlers ───────────────────────────────────────────────────────
  const onDragStart = useCallback((e, subCat, fromCat) => {
    dragInfo.current = { subCat, fromCat };
    e.dataTransfer.effectAllowed = "move";
    try {
      e.dataTransfer.setData("text/plain", subCat);
    } catch {
      /* ignore — some browsers throw on certain MIME types */
    }
  }, []);

  const onDragEnd = useCallback(() => {
    dragInfo.current = null;
    setDragTarget(null);
  }, []);

  const onDragOver = useCallback((e, toCat) => {
    if (!dragInfo.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragTarget !== toCat) setDragTarget(toCat);
  }, [dragTarget]);

  const onDragLeave = useCallback((e, toCat) => {
    // Only clear when leaving the zone for a non-child element.
    if (e.currentTarget.contains(e.relatedTarget)) return;
    if (dragTarget === toCat) setDragTarget(null);
  }, [dragTarget]);

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

  // ── Normalized weights for computation & display ────────────────────────
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

  // ── Data fetch ──────────────────────────────────────────────────────────
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
    setShowComparison(false);
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

  // ── Live recompute on every state change ────────────────────────────────
  const userCategoryGroups = useMemo(
    () => buildUserCategoryGroups(categoryOrder, userGroups),
    [categoryOrder, userGroups]
  );

  useEffect(() => {
    if (!seasonData || seasonData.length === 0) return;
    const minGames = playerMode === "all" ? MIN_GAMES_ALL_PLAYERS : 0;
    const eiResults =
      eiMode === "era"
        ? computeEIScoresByEra(
            seasonData,
            normalizedCategoryWeights,
            normalizedSubCategoryWeights,
            {
              minGames,
              categoryGroups: userCategoryGroups,
              topYears: topYears.value,
            }
          )
        : computeEIScoresHierarchical(
            seasonData,
            normalizedCategoryWeights,
            normalizedSubCategoryWeights,
            topYears.value,
            { minGames, categoryGroups: userCategoryGroups }
          );
    setResults(eiResults);
  }, [
    seasonData,
    eiMode,
    userCategoryGroups,
    normalizedCategoryWeights,
    normalizedSubCategoryWeights,
    topYears,
    playerMode,
  ]);

  const defaultResults = useMemo(() => {
    if (!seasonData || seasonData.length === 0) return null;
    const minGames = playerMode === "all" ? MIN_GAMES_ALL_PLAYERS : 0;
    return eiMode === "era"
      ? computeEIScoresByEra(
          seasonData,
          DEFAULT_CATEGORY_WEIGHTS,
          DEFAULT_SUBCATEGORY_WEIGHTS,
          {
            minGames,
            categoryGroups: CATEGORY_GROUPS,
            topYears: topYears.value,
          }
        )
      : computeEIScoresHierarchical(
          seasonData,
          DEFAULT_CATEGORY_WEIGHTS,
          DEFAULT_SUBCATEGORY_WEIGHTS,
          topYears.value,
          { minGames, categoryGroups: CATEGORY_GROUPS }
        );
  }, [seasonData, eiMode, topYears, playerMode]);

  // Decade options for the era leaderboard filter. "All eras" = career-blended;
  // each decade = a separate ranking of that decade's performances.
  const eraDecadeOptions = useMemo(() => {
    if (eiMode !== "era" || !results?.decadeRankings) return [];
    const opts = Object.entries(results.decadeRankings)
      .map(([dk, r]) => ({ dk: Number(dk), n: r.players.length }))
      .sort((a, b) => a.dk - b.dk)
      .map(({ dk, n }) => ({ value: dk, label: `${decadeLabel(dk)} (${n})` }));
    return [{ value: "all", label: "All eras" }, ...opts];
  }, [eiMode, results]);

  // Pick the ranking source: blended career list, or the selected decade's list.
  const rankingsFor = useCallback(
    (res) => {
      if (!res) return [];
      if (eiMode === "era" && eraDecadeFilter !== "all") {
        return res.decadeRankings?.[eraDecadeFilter]?.players ?? [];
      }
      return res.playerRankings;
    },
    [eiMode, eraDecadeFilter]
  );

  const top15 = useMemo(() => {
    if (!results) return [];
    return assignDisplayRanks(rankingsFor(results).slice(0, 15));
  }, [results, rankingsFor]);

  const defaultTop15 = useMemo(() => {
    if (!defaultResults) return [];
    return assignDisplayRanks(rankingsFor(defaultResults).slice(0, 15));
  }, [defaultResults, rankingsFor]);

  // EI distribution + player count for the currently displayed ranking (used by
  // the player card so its histogram/percentile match the visible list).
  const activeEIContext = useMemo(() => {
    if (eiMode === "era" && eraDecadeFilter !== "all" && results?.decadeRankings) {
      const r = results.decadeRankings[eraDecadeFilter];
      return {
        allEIScores: r?.allEIScores ?? [],
        totalPlayers: r?.players.length ?? 0,
      };
    }
    return {
      allEIScores: results?.allEIScores ?? [],
      totalPlayers: results?.playerRankings.length ?? 0,
    };
  }, [eiMode, eraDecadeFilter, results]);

  // Track which sub-categories aren't in any user category so we can warn.
  const unassignedSubs = useMemo(() => {
    const placed = new Set();
    for (const subs of Object.values(userGroups)) {
      for (const s of subs) placed.add(s);
    }
    return ALL_SUBCATEGORIES.filter((s) => !placed.has(s));
  }, [userGroups]);

  return (
    <div className="goat-page create-goat-page">
      <div className="controls-panel">
        <h2 className="controls-title">The NBA GOAT Lab</h2>
        <p className="controls-description">
          Build your own categories and drag the available sub-categories into
          them. Category weights and sub-category weights are each normalized
          to sum to 1. Rankings use each player&apos;s best consecutive season
          window (lowest mean EI). Lower EI = better.
        </p>

        <div className="decade-presets">
          <div className="decade-presets-label">
            Quick Picks · one-click leaderboards
          </div>
          <div className="decade-presets-row">
            {DECADE_PRESETS.map((p) => {
              const active =
                p.dk === "all"
                  ? eiMode === "all_time"
                  : eiMode === "era" &&
                    String(eraDecadeFilter) === String(p.dk);
              return (
                <button
                  key={String(p.dk)}
                  type="button"
                  className={`decade-preset ${active ? "decade-preset--active" : ""}`}
                  style={{ "--preset-color": p.color }}
                  onClick={() => applyDecadePreset(p.dk)}
                  disabled={loading}
                >
                  <span className="decade-preset-decade">{p.decade}</span>
                  <span className="decade-preset-tag">{p.tag}</span>
                </button>
              );
            })}
          </div>
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
                <span className="lab-step-badge">1</span>
                Players
              </label>
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
                  menuPortalTarget={
                    typeof document !== "undefined" ? document.body : null
                  }
                  menuPlacement="auto"
                  filterOption={(option, input) =>
                    option.label.toLowerCase().includes(input.toLowerCase())
                  }
                />
              )}
              <span className="control-hint">
                Rank every NBA player, or only the ones you pick.
              </span>
            </div>

            <div className="lab-control-card lab-step-card">
              <label className="lab-control-label">
                <span className="lab-step-badge">2</span>
                Stat Distribution
              </label>
              <div className="player-mode-toggle">
                <button
                  className={`mode-btn ${eiMode === "all_time" ? "mode-btn--active" : ""}`}
                  onClick={() => {
                    setEiMode("all_time");
                    setEraDecadeFilter("all");
                  }}
                >
                  All-Time
                </button>
                <button
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
                  ? "Every player is ranked together, but each player's score is adjusted to the distribution of the players from his own era (decade). Dominance relative to his contemporaries."
                  : "Every player is scored against the stats of all players since the beginning of the NBA."}
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
                        ? "Load players first…"
                        : "All eras…"
                    }
                    menuPortalTarget={
                      typeof document !== "undefined" ? document.body : null
                    }
                    menuPlacement="auto"
                  />
                  <span className="control-hint">
                    &ldquo;All eras&rdquo; ranks every player&apos;s full career.
                    Pick a decade to rank players by how they performed in that
                    decade only — a player who spanned decades appears in each.
                  </span>
                </div>
              )}
            </div>

            {(eiMode === "all_time" ||
              (eiMode === "era" && eraDecadeFilter === "all")) && (
              <div className="lab-control-card lab-step-card">
                <label className="lab-control-label">
                  <span className="lab-step-badge">3</span>
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
                  Rank on a player&apos;s whole career, or on his best
                  consecutive stretch — the lowest average EI over the chosen
                  window of seasons.
                </span>
              </div>
            )}

            <div className="lab-control-card lab-step-card">
              <label className="lab-control-label">
                <span className="lab-step-badge">4</span>
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
                  className="builder-btn builder-btn--primary"
                  onClick={addCategory}
                  disabled={!newCategoryName.trim()}
                >
                  + Add
                </button>
                <button
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
                Category weights sum to 1 · sub-categories sum to 1 within
                each category.
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
                <h3 className="result-card-title">Your GOAT Ranking</h3>
                <p className="result-card-subtitle">
                  {eiMode === "era"
                    ? eraDecadeFilter === "all"
                      ? "Era-relative career EI · "
                      : `${decadeLabel(Number(eraDecadeFilter))} performances · `
                    : ""}
                  {showComparison
                    ? "Side-by-side comparison · lower EI is better · Click for more details"
                    : "Top 15 by EI · lower is better · Click for more details"}
                </p>
              </div>
              <div className="result-card-header-actions">
                {!showComparison && (
                  <span className="goat-ranking-badge">Live update</span>
                )}
                <button
                  type="button"
                  className="compare-default-btn"
                  onClick={() => setShowComparison((v) => !v)}
                >
                  {showComparison
                    ? "Back to single ranking"
                    : "Compare with default equally weighted ranking"}
                </button>
              </div>
            </div>

            {showComparison ? (
              <div className="compare-rankings">
                <div className="compare-ranking-panel">
                  <div className="compare-ranking-panel-header">
                    <h4 className="compare-ranking-panel-title">
                      Default Equal Weights
                    </h4>
                    <p className="compare-ranking-panel-subtitle">
                      Library categories · equal category &amp; sub-category
                      weights
                    </p>
                  </div>
                  <GoatRankingList
                    players={defaultTop15}
                    onSelectPlayer={setPlayerCard}
                  />
                </div>
                <div className="compare-ranking-panel compare-ranking-panel--custom">
                  <div className="compare-ranking-panel-header">
                    <h4 className="compare-ranking-panel-title">
                      Your Custom Weights
                    </h4>
                    <p className="compare-ranking-panel-subtitle">
                      Your category tree · your weight sliders
                    </p>
                  </div>
                  <GoatRankingList
                    players={top15}
                    onSelectPlayer={setPlayerCard}
                  />
                </div>
              </div>
            ) : (
              <GoatRankingList
                players={top15}
                onSelectPlayer={setPlayerCard}
              />
            )}
          </div>
        </div>
      )}

      {playerCard && (
        <PlayerCard
          player={playerCard}
          allEIScores={activeEIContext.allEIScores}
          totalPlayers={activeEIContext.totalPlayers}
          userGroups={userGroups}
          categoryOrder={categoryOrder}
          categoryColorMap={categoryColorMap}
          eiMode={eiMode}
          onClose={() => setPlayerCard(null)}
        />
      )}
    </div>
  );
}

function PlayerCard({
  player,
  allEIScores,
  totalPlayers,
  userGroups,
  categoryOrder,
  categoryColorMap,
  eiMode,
  onClose,
}) {
  if (!player) return null;

  const isEra = eiMode === "era";

  const bestSeason = player.allSeasons.reduce(
    (best, s) => (s.eiScore < best.eiScore ? s : best),
    player.allSeasons[0]
  );

  // Minutes distribution across decades (era mode only), sorted chronologically.
  const decadeMix = isEra
    ? Object.entries(player.minutesByDecade || {})
        .map(([dk, mins]) => ({ dk: Number(dk), mins }))
        .sort((a, b) => a.dk - b.dk)
    : [];
  const totalMixMinutes = decadeMix.reduce((a, d) => a + d.mins, 0) || 1;

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

  // Section averages follow the USER's tree, not the library defaults.
  const groupPercentiles = {};
  for (const group of categoryOrder) {
    const subs = userGroups[group] || [];
    const vals = subs.map((c) => catPercentiles[c]).filter((v) => v != null);
    groupPercentiles[group] =
      vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }

  const sortedEI = [...allEIScores].sort((a, b) => a - b);
  const median =
    sortedEI.length > 0 ? sortedEI[Math.floor(sortedEI.length * 0.5)] : 0.5;

  const groupBarColors = categoryOrder.map(
    (group) => getCategoryColor(categoryColorMap[group] ?? 0).main
  );

  const subBarColors = Object.keys(catPercentiles).map((catName) => {
    for (const group of categoryOrder) {
      if ((userGroups[group] || []).includes(catName)) {
        return getCategoryColor(categoryColorMap[group] ?? 0).main;
      }
    }
    return "rgba(91,156,246,0.7)";
  });

  return (
    <div className="player-card-overlay" onClick={onClose}>
      <div className="player-card" onClick={(e) => e.stopPropagation()}>
        <div className="player-card-header">
          <h3>
            EI Framework: {player.player_name} ·{" "}
            {isEra ? bestSeason.season : `Best Season (${bestSeason.season})`}
          </h3>
          <button className="player-card-close" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="player-card-top">
          <div className="player-card-info-box">
            {isEra ? (
              <div className="info-line">
                <strong>Era:</strong> {decadeLabel(player.primaryDecade)}
              </div>
            ) : (
              <div className="info-line">
                <strong>Best Season:</strong> {bestSeason.season}
              </div>
            )}
            <div className="info-line">
              <strong>{isEra ? "Era-Relative EI:" : "Career EI:"}</strong>{" "}
              {player.careerEI.toFixed(5)}
            </div>
            <div className="info-line">
              <strong>Peak EI:</strong> {playerEI.toFixed(5)}
            </div>
            <div className="info-line">
              <strong>EI Percentile:</strong> {percentile}th
            </div>
            <div className="info-line">
              <strong>Rank:</strong> {rank}/{totalPlayers}
            </div>
            {isEra && decadeMix.length > 0 && (
              <div className="era-minutes-mix">
                <div className="era-minutes-mix-label">Minutes by decade</div>
                <div className="era-minutes-bar">
                  {decadeMix.map((d) => (
                    <div
                      key={d.dk}
                      className="era-minutes-seg"
                      style={{
                        width: `${(d.mins / totalMixMinutes) * 100}%`,
                        background: getCategoryColor(d.dk % 9).main,
                      }}
                      title={`${decadeLabel(d.dk)}: ${Math.round(d.mins)} min`}
                    />
                  ))}
                </div>
                <div className="era-minutes-legend">
                  {decadeMix.map((d) => (
                    <span key={d.dk} className="era-minutes-legend-item">
                      <span
                        className="era-minutes-legend-dot"
                        style={{ background: getCategoryColor(d.dk % 9).main }}
                      />
                      {decadeLabel(d.dk)}{" "}
                      {Math.round((d.mins / totalMixMinutes) * 100)}%
                    </span>
                  ))}
                </div>
              </div>
            )}
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
                  marker: { color: groupBarColors },
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
                  marker: { color: subBarColors },
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
