/**
 * Soccer EI — same two-step transform as NBA GOAT Lab (eiComputation.js):
 *   Step 1: each measure → sigmoid normalization (10th/90th pct → logistic → 0–1)
 *   Step 2: sub-category = RMS of measure scores
 *           category     = weighted RMS of sub-categories
 *           EI           = weighted RMS of categories  (lower = better)
 */

export const CATEGORY_GROUPS = {
  Finishing: [
    "Finishing Volume",
    "Finishing Efficiency",
    "Finishing Overperformance",
  ],
  Creation: ["Creation Volume", "Creation Overperformance"],
  Involvement: ["Involvement Volume"],
  Carrying: ["Carrying Volume"],
  Impact: ["Impact Volume"],
  "Big Game": ["Big Game Volume"],
};

/** Leaf sub-categories → measures (+ direction per measure). */
export const CATEGORIES = {
  "Finishing Volume": {
    measures: [
      { name: "npg_p90", direction: "higher" },
      { name: "shots_p90", direction: "higher" },
      { name: "sot_p90", direction: "higher" },
    ],
  },
  "Finishing Efficiency": {
    measures: [
      { name: "conversion_rate", direction: "higher" },
      { name: "shot_accuracy", direction: "higher" },
      { name: "bcm_p90", direction: "lower" },
    ],
  },
  "Finishing Overperformance": {
    measures: [{ name: "xg_overperf_p90", direction: "higher" }],
  },
  "Creation Volume": {
    measures: [
      { name: "assists_p90", direction: "higher" },
      { name: "xa_p90", direction: "higher" },
    ],
  },
  "Creation Overperformance": {
    measures: [{ name: "ast_xa_overperf_p90", direction: "higher" }],
  },
  "Involvement Volume": {
    measures: [
      { name: "touches_p90", direction: "higher" },
      { name: "touches_in_box_p90", direction: "higher" },
      { name: "box_touch_share", direction: "higher" },
    ],
  },
  "Carrying Volume": {
    measures: [
      { name: "dribbles_p90", direction: "higher" },
      { name: "dribble_success_pct", direction: "higher" },
    ],
  },
  "Impact Volume": {
    measures: [
      { name: "rating_avg", direction: "higher" },
      { name: "pct_rated_8plus", direction: "higher" },
      { name: "rating_std", direction: "lower" },
      { name: "win_pct_starter", direction: "higher" },
      { name: "rating_delta_wl", direction: "higher" },
    ],
  },
  "Big Game Volume": {
    measures: [
      { name: "bg_npg_p90", direction: "higher" },
      { name: "bg_shots_p90", direction: "higher" },
      { name: "bg_assists_p90", direction: "higher" },
      { name: "bg_xa_p90", direction: "higher" },
      { name: "bg_touches_p90", direction: "higher" },
      { name: "bg_rating_avg", direction: "higher" },
      { name: "bg_win_pct_starter", direction: "higher" },
    ],
  },
};

/** Default category weights from soccer/ranking/config.py SCORING_TREE. */
export const DEFAULT_CATEGORY_WEIGHTS = {
  Finishing: 0.28,
  Creation: 0.2,
  Involvement: 0.14,
  Carrying: 0.1,
  Impact: 0.16,
  "Big Game": 0.12,
};

/** Default sub-category weights (relative within parent). */
export const DEFAULT_SUBCATEGORY_WEIGHTS = {
  "Finishing Volume": 0.4,
  "Finishing Efficiency": 0.35,
  "Finishing Overperformance": 0.25,
  "Creation Volume": 0.6,
  "Creation Overperformance": 0.4,
  "Involvement Volume": 1.0,
  "Carrying Volume": 1.0,
  "Impact Volume": 1.0,
  "Big Game Volume": 1.0,
};

export const CLASSIC_MEASURES = new Set([
  "npg_p90",
  "shots_p90",
  "sot_p90",
  "conversion_rate",
  "shot_accuracy",
  "bcm_p90",
  "assists_p90",
  "bg_npg_p90",
  "bg_shots_p90",
  "bg_assists_p90",
]);

const SIGMOID_ALPHA = 0.1;
const SIGMOID_X_C = -Math.log(1 / SIGMOID_ALPHA - 1);
const SIGMOID_X_D = -Math.log(1 / (1 - SIGMOID_ALPHA) - 1);

/** Career games floor when ranking the full pool (role-player filter). */
export const MIN_GAMES_ALL_PLAYERS = 80;

/** Decade eligibility for era-relative boards (minutes in that decade). */
export const ERA_DECADE_MINUTES_FLOOR = 1800;

export function decadeKeyFromSeason(seasonOrStart) {
  if (typeof seasonOrStart === "number" && Number.isFinite(seasonOrStart)) {
    return Math.floor(seasonOrStart / 10) * 10;
  }
  if (typeof seasonOrStart === "string") {
    const m = seasonOrStart.match(/^(\d{4})/);
    if (m) return Math.floor(Number(m[1]) / 10) * 10;
  }
  return null;
}

export function decadeLabel(dk) {
  return `${dk}s`;
}

export function eiScoresTied(a, b) {
  return Math.abs(a - b) < 1e-9;
}

export function assignDisplayRanks(players, scoreKey = "careerEI") {
  let rank = 1;
  return players.map((p, i) => {
    if (i > 0 && !eiScoresTied(p[scoreKey], players[i - 1][scoreKey])) {
      rank = i + 1;
    }
    return { ...p, displayRank: rank };
  });
}

function measureAllowed(name, scoreType) {
  if (scoreType === "full") return true;
  return CLASSIC_MEASURES.has(name);
}

function computeMeasureBounds(seasonData, scoreType) {
  const names = new Set();
  for (const cat of Object.values(CATEGORIES)) {
    for (const m of cat.measures) {
      if (measureAllowed(m.name, scoreType)) names.add(m.name);
    }
  }

  const measureBounds = {};
  for (const m of names) {
    const values = seasonData
      .map((s) => s[m])
      .filter((v) => v != null && !Number.isNaN(v) && Number.isFinite(v))
      .sort((a, b) => a - b);

    const n = values.length;
    if (n < 5) {
      measureBounds[m] = null;
      continue;
    }

    const minIdx = Math.floor(n * SIGMOID_ALPHA);
    const maxIdx = Math.floor(n * (1 - SIGMOID_ALPHA));
    let minVal = values[minIdx];
    let maxVal = values[maxIdx];

    if (Math.abs(maxVal - minVal) < 1e-9) {
      minVal = values[0];
      maxVal = values[n - 1];
    }
    if (Math.abs(maxVal - minVal) < 1e-9) {
      minVal -= 1e-6;
      maxVal += 1e-6;
    }

    measureBounds[m] = { minVal, maxVal };
  }

  return measureBounds;
}

function normalizeMeasureScore(val, bounds, direction) {
  if (val == null || Number.isNaN(val) || !Number.isFinite(val) || !bounds) {
    return null;
  }
  const { minVal, maxVal } = bounds;
  const span = maxVal - minVal;
  let mHat = SIGMOID_X_C + ((SIGMOID_X_D - SIGMOID_X_C) / span) * (val - minVal);
  mHat = Math.max(-50, Math.min(50, mHat));
  const mTilde = 1 / (1 + Math.exp(-mHat));
  return direction === "higher" ? 1 - mTilde : mTilde;
}

function computeSubCategoryScores(s, measureBounds, scoreType) {
  const subCategoryScores = {};

  for (const [catName, cat] of Object.entries(CATEGORIES)) {
    const transformed = [];
    for (const m of cat.measures) {
      if (!measureAllowed(m.name, scoreType)) continue;
      const score = normalizeMeasureScore(s[m.name], measureBounds[m.name], m.direction);
      if (score != null) transformed.push(score);
    }
    subCategoryScores[catName] =
      transformed.length === 0
        ? null
        : Math.sqrt(
            transformed.reduce((sum, v) => sum + v * v, 0) / transformed.length
          );
  }

  return subCategoryScores;
}

function weightedRMS(scores, weights) {
  let weightedSumSq = 0;
  let totalWeight = 0;
  for (const [key, score] of Object.entries(scores)) {
    const w = weights[key] ?? 0;
    if (w === 0 || score == null) continue;
    weightedSumSq += w * score * score;
    totalWeight += w;
  }
  return totalWeight > 0 ? Math.sqrt(weightedSumSq / totalWeight) : 1;
}

function pickBestSlidingWindow(seasons, windowSize) {
  const chronological = [...seasons].sort((a, b) => {
    const as = a.season_start ?? 0;
    const bs = b.season_start ?? 0;
    if (as !== bs) return as - bs;
    return String(a.season).localeCompare(String(b.season));
  });

  if (chronological.length === 0) {
    return { selectedSeasons: [], careerEI: 1 };
  }

  if (windowSize === "all" || windowSize >= chronological.length) {
    const careerEI =
      chronological.reduce((sum, s) => sum + s.eiScore, 0) /
      chronological.length;
    return { selectedSeasons: chronological, careerEI };
  }

  let bestMean = Infinity;
  let bestStart = 0;
  for (let i = 0; i <= chronological.length - windowSize; i++) {
    const window = chronological.slice(i, i + windowSize);
    const mean = window.reduce((sum, s) => sum + s.eiScore, 0) / windowSize;
    if (mean < bestMean) {
      bestMean = mean;
      bestStart = i;
    }
  }

  return {
    selectedSeasons: chronological.slice(bestStart, bestStart + windowSize),
    careerEI: bestMean,
  };
}

function buildPlayerRankings(seasonScores, topYears, minGames = 0) {
  const playerSeasons = {};
  for (const s of seasonScores) {
    if (!playerSeasons[s.player_name]) playerSeasons[s.player_name] = [];
    playerSeasons[s.player_name].push(s);
  }

  const playerRankings = [];
  for (const [name, seasons] of Object.entries(playerSeasons)) {
    const { selectedSeasons, careerEI } = pickBestSlidingWindow(
      seasons,
      topYears
    );
    const peakEI =
      seasons.length > 0 ? Math.min(...seasons.map((s) => s.eiScore)) : 1;
    const totalSeasons = seasons.length;
    const totalGames = seasons.reduce((sum, s) => sum + (s.games || 0), 0);
    const totalMinutes = seasons.reduce(
      (sum, s) => sum + (s.minutes_total || 0),
      0
    );

    playerRankings.push({
      player_name: name,
      careerEI,
      peakEI,
      totalSeasons,
      totalGames,
      totalMinutes,
      selectedSeasons,
      allSeasons: seasons,
    });
  }

  const filtered =
    minGames > 0
      ? playerRankings.filter((p) => p.totalGames >= minGames)
      : playerRankings;

  filtered.sort((a, b) => a.careerEI - b.careerEI);
  const allEIScores = seasonScores.map((s) => s.eiScore);
  return { playerRankings: filtered, allEIScores };
}

function scoreSeasonsHierarchical(
  seasonData,
  categoryWeights,
  subCategoryWeights,
  measureBounds,
  scoreType,
  categoryGroups
) {
  const groups = categoryGroups ?? CATEGORY_GROUPS;

  return seasonData.map((s) => {
    const categoryScores = computeSubCategoryScores(s, measureBounds, scoreType);

    const categoryGroupScores = {};
    for (const [group, subCats] of Object.entries(groups)) {
      const groupScores = {};
      for (const subCat of subCats) {
        groupScores[subCat] = categoryScores[subCat];
      }
      const hasAny = subCats.some((c) => categoryScores[c] != null);
      categoryGroupScores[group] = hasAny
        ? weightedRMS(groupScores, subCategoryWeights)
        : null;
    }

    const ei = weightedRMS(categoryGroupScores, categoryWeights);
    return { ...s, categoryScores, categoryGroupScores, eiScore: ei };
  });
}

/**
 * All-time hierarchical EI (global sigmoid bounds).
 */
export function computeEIScoresHierarchical(
  seasonData,
  categoryWeights,
  subCategoryWeights,
  topYears,
  opts = {}
) {
  const { minGames = 0, categoryGroups, scoreType = "classic" } = opts;
  const measureBounds = computeMeasureBounds(seasonData, scoreType);
  const seasonScores = scoreSeasonsHierarchical(
    seasonData,
    categoryWeights,
    subCategoryWeights,
    measureBounds,
    scoreType,
    categoryGroups
  );
  const { playerRankings, allEIScores } = buildPlayerRankings(
    seasonScores,
    topYears,
    minGames
  );
  return { playerRankings, seasonScores, allEIScores, measureBounds };
}

/**
 * Era-relative EI: each season normalized vs its decade peer pool.
 * Career "all eras" = mean of per-season EIs; optional topYears window.
 */
export function computeEIScoresByEra(
  seasonData,
  categoryWeights,
  subCategoryWeights,
  opts = {}
) {
  const {
    minGames = 0,
    categoryGroups,
    scoreType = "classic",
    topYears = "all",
    minutesFloor = ERA_DECADE_MINUTES_FLOOR,
  } = opts;

  // Build per-player decade minutes for eligibility.
  const playerDecadeMinutes = new Map();
  for (const s of seasonData) {
    const dk = decadeKeyFromSeason(s.season_start ?? s.season);
    if (dk == null) continue;
    if (!playerDecadeMinutes.has(s.player_name)) {
      playerDecadeMinutes.set(s.player_name, new Map());
    }
    const m = playerDecadeMinutes.get(s.player_name);
    m.set(dk, (m.get(dk) || 0) + (s.minutes_total || 0));
  }

  const byDecade = new Map();
  for (const s of seasonData) {
    const dk = decadeKeyFromSeason(s.season_start ?? s.season);
    if (dk == null) continue;
    if (!byDecade.has(dk)) byDecade.set(dk, []);
    byDecade.get(dk).push(s);
  }

  const seasonScores = [];
  const decadeRankings = {};

  for (const [dk, seasons] of byDecade.entries()) {
    const eligible = seasons.filter((s) => {
      const mins = playerDecadeMinutes.get(s.player_name)?.get(dk) || 0;
      return mins >= minutesFloor;
    });
    if (eligible.length < 5) continue;

    const bounds = computeMeasureBounds(eligible, scoreType);
    const scored = scoreSeasonsHierarchical(
      eligible,
      categoryWeights,
      subCategoryWeights,
      bounds,
      scoreType,
      categoryGroups
    );
    seasonScores.push(...scored);

    // Per-decade board: average EI across seasons in this decade.
    const byPlayer = {};
    for (const s of scored) {
      if (!byPlayer[s.player_name]) {
        byPlayer[s.player_name] = { eis: [], games: 0, minutes: 0 };
      }
      byPlayer[s.player_name].eis.push(s.eiScore);
      byPlayer[s.player_name].games += s.games || 0;
      byPlayer[s.player_name].minutes += s.minutes_total || 0;
    }
    const players = Object.entries(byPlayer)
      .map(([name, v]) => ({
        player_name: name,
        careerEI: v.eis.reduce((a, b) => a + b, 0) / v.eis.length,
        peakEI: Math.min(...v.eis),
        totalSeasons: v.eis.length,
        totalGames: v.games,
        totalMinutes: v.minutes,
        selectedSeasons: scored.filter((s) => s.player_name === name),
        allSeasons: scored.filter((s) => s.player_name === name),
      }))
      .sort((a, b) => a.careerEI - b.careerEI);

    decadeRankings[dk] = {
      players: assignDisplayRanks(players),
      n: players.length,
    };
  }

  const { playerRankings, allEIScores } = buildPlayerRankings(
    seasonScores,
    topYears,
    minGames
  );

  return {
    playerRankings: assignDisplayRanks(playerRankings),
    seasonScores,
    allEIScores,
    decadeRankings,
  };
}
