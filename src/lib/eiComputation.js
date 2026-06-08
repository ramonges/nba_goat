import { supabase, TABLE_NAME } from "./supabase";

/**
 * EI Framework — hierarchical (categories → sub-categories → measures)
 *
 * Two-level weighting tree (see whiteboard):
 *   - 9 top-level CATEGORIES (Volume, Rebounding, ...). Their weights sum to 1.
 *   - Each category holds several SUB-CATEGORIES (e.g. Scoring Production).
 *     Sub-category weights are relative within their category.
 *   - Each sub-category holds raw measures.
 *
 * Pipeline (lower EI is better, 0 = GOAT):
 *   Step 1: each measure → sigmoid normalization (10th/90th pct bounds → logistic → 0-1)
 *   Step 2: sub-category score = RMS of its normalized measures
 *   Step 3: category score    = weighted RMS of its sub-category scores (sub-category weights)
 *   Step 4: EI                = weighted RMS of category scores (category weights, sum to 1)
 */

// Maps each top-level CATEGORY to its SUB-CATEGORIES.
export const CATEGORY_GROUPS = {
  Volume: [
    "Scoring Production",
    "Minutes Load",
    "Games Played",
    "Plus-Minus Impact",
  ],
  Rebounding: [
    "Total Rebounding",
    "Offensive Rebounding",
    "Defensive Rebounding",
  ],
  Defense: ["Steals", "Blocks", "Defensive Activity", "Foul Discipline"],
  Efficiency: [
    "True Shooting Efficiency",
    "Field Goal Efficiency",
    "Three-Point Shooting",
    "Free Throw Shooting",
    "Turnover Control",
    "Assists",
  ],
  Stability: ["Consistency", "Bad-Game Rate"],
  Playoffs: ["Playoff Production", "Playoff Efficiency", "Playoff Consistency"],
  Legacy: ["Awards Recognition", "Championship Success"],
};

export const CATEGORIES = {
  "Scoring Production": {
    measures: ["points_per_game", "points_per36", "game_score_mean"],
    direction: "higher",
  },
  "Minutes Load": {
    measures: ["minutes_total", "minutes_per_game"],
    direction: "higher",
  },
  "Games Played": {
    measures: ["games"],
    direction: "higher",
  },
  "Total Rebounding": {
    measures: ["rebounds_per_game", "rebounds_per36"],
    direction: "higher",
  },
  "Offensive Rebounding": {
    measures: ["offensive_rebounds_per_game", "offensive_rebounds_per36"],
    direction: "higher",
  },
  "Defensive Rebounding": {
    measures: ["defensive_rebounds_per_game", "defensive_rebounds_per36"],
    direction: "higher",
  },
  Assists: {
    measures: ["assists_per_game", "assists_per36", "ast_tov_ratio"],
    direction: "higher",
  },
  Steals: {
    measures: ["steals_per_game", "steals_per36"],
    direction: "higher",
  },
  Blocks: {
    measures: ["blocks_per_game", "blocks_per36"],
    direction: "higher",
  },
  "Defensive Activity": {
    measures: ["stocks_per_game", "stocks_per36"],
    direction: "higher",
  },
  "Foul Discipline": {
    measures: ["fouls_per_game", "fouls_per36"],
    direction: "lower",
  },
  "True Shooting Efficiency": {
    measures: ["true_shooting_pct"],
    direction: "higher",
  },
  "Field Goal Efficiency": {
    measures: ["field_goal_pct", "efg_pct"],
    direction: "higher",
  },
  "Three-Point Shooting": {
    measures: ["three_point_pct", "threes_made_per_game"],
    direction: "higher",
  },
  "Free Throw Shooting": {
    measures: ["free_throw_pct"],
    direction: "higher",
  },
  "Turnover Control": {
    measures: ["turnovers_per_game", "turnovers_per36"],
    direction: "lower",
  },
  Consistency: {
    measures: ["points_cv", "game_score_cv"],
    direction: "lower",
  },
  "Bad-Game Rate": {
    measures: ["bad_game_rate"],
    direction: "lower",
  },
  "Plus-Minus Impact": {
    measures: ["plus_minus_per_game", "plus_minus_per36"],
    direction: "higher",
  },
  "Playoff Production": {
    measures: [
      "playoff_games",
      "playoff_points_per_game",
      "playoff_rebounds_per_game",
      "playoff_assists_per_game",
      "playoff_game_score_mean",
    ],
    direction: "higher",
  },
  "Playoff Efficiency": {
    measures: [
      "playoff_true_shooting_pct",
      "playoff_efg_pct",
      "playoff_free_throw_pct",
    ],
    direction: "higher",
  },
  "Playoff Consistency": {
    measures: ["playoff_bad_game_rate", "playoff_game_score_cv"],
    direction: "lower",
  },
  "Awards Recognition": {
    measures: [
      "nba_most_valuable_player",
      "all_nba",
      "all_defensive_team",
      "nba_all_star",
      "nba_defensive_player_of_the_year",
      "nba_player_of_the_month",
      "olympic_gold_medal_count",
      "hall_of_fame_inductee",
    ],
    direction: "higher",
  },
  "Championship Success": {
    measures: ["nba_champion", "nba_finals_most_valuable_player"],
    direction: "higher",
  },
};

// ─── Default weights for the two-level tree ──────────────────────────────────

// Top-level category weights. Must sum to 1 (the computation normalizes anyway).
export const DEFAULT_CATEGORY_WEIGHTS = (() => {
  const groups = Object.keys(CATEGORY_GROUPS);
  const w = {};
  for (const g of groups) w[g] = 1 / groups.length;
  return w;
})();

// Sub-category weights are relative within their parent category (default: equal).
export const DEFAULT_SUBCATEGORY_WEIGHTS = (() => {
  const w = {};
  for (const subCats of Object.values(CATEGORY_GROUPS)) {
    for (const subCat of subCats) w[subCat] = 1.0;
  }
  return w;
})();

const SIGMOID_ALPHA = 0.10;

// Minimum career games required to enter the ranking when comparing "all
// players" at once. Filters role players on title rosters from artificially
// topping Championship/Legacy-heavy weightings. Shared across pages so they
// produce identical rankings given identical inputs.
export const MIN_GAMES_ALL_PLAYERS = 200;

// Stat columns required by the EI pipeline. Always selected from Supabase.
const STAT_COLS = [
  "player_name",
  "season",
  "game_type",
  "minutes",
  "points",
  "rebounds",
  "assists",
  "steals",
  "blocks",
  "field_goals_made",
  "field_goals_attempted",
  "three_pointers_made",
  "three_pointers_attempted",
  "free_throws_made",
  "free_throws_attempted",
  "true_shooting_percentage",
  "offensive_rebounds",
  "defensive_rebounds",
  "turnovers",
  "personal_fouls",
  "plus_minus",
];

// Candidate award / legacy columns. Each candidate has a clean JS `key` used
// throughout the codebase, and (optionally) a `source` if the actual Supabase
// column name uses characters that don't translate to a JS identifier (e.g.
// hyphens in `all-nba`, `nba_all-star`, etc.). When `source` is given we
// fetch with a PostgREST alias so the row still arrives keyed by `key`.
const CANDIDATE_AWARD_COLS = [
  { key: "nba_most_valuable_player" },
  { key: "nba_champion" },
  { key: "nba_finals_most_valuable_player" },
  { key: "all_nba", source: "all-nba" },
  { key: "all_defensive_team", source: "all-defensive_team" },
  { key: "nba_all_star", source: "nba_all-star" },
  { key: "nba_defensive_player_of_the_year" },
  { key: "olympic_gold_medal_count" },
  { key: "nba_player_of_the_month" },
  { key: "hall_of_fame_inductee" },
];

const sourceOf = (c) => c.source ?? c.key;
const selectFragmentOf = (c) =>
  c.source ? `${c.key}:"${c.source}"` : c.key;

// Filled lazily by `ensureFetchCols()`. Both `null` until the first probe.
let availableAwardCols = null;
let cachedFetchCols = null;

async function ensureFetchCols() {
  if (cachedFetchCols) return cachedFetchCols;

  try {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select("*")
      .limit(1);
    if (error) throw error;
    if (data && data.length > 0) {
      const present = new Set(Object.keys(data[0]));
      availableAwardCols = CANDIDATE_AWARD_COLS.filter((c) =>
        present.has(sourceOf(c))
      );
      const missing = CANDIDATE_AWARD_COLS.filter(
        (c) => !present.has(sourceOf(c))
      ).map(sourceOf);
      if (missing.length > 0) {
        console.warn(
          `[EI] Award columns missing from ${TABLE_NAME}: ${missing.join(", ")}. ` +
            "These will be skipped in the Legacy category."
        );
      }
    } else {
      availableAwardCols = [];
    }
  } catch (err) {
    console.warn(
      "[EI] Failed to probe table columns, proceeding without awards:",
      err
    );
    availableAwardCols = [];
  }

  cachedFetchCols = [
    ...STAT_COLS,
    ...availableAwardCols.map(selectFragmentOf),
  ].join(", ");
  return cachedFetchCols;
}

// ─── Data Fetching ───────────────────────────────────────────────────────────

export async function fetchPlayerSeasonAverages(playerName) {
  const cols = await ensureFetchCols();
  let allRows = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select(cols)
      .eq("player_name", playerName)
      .range(offset, offset + pageSize - 1);

    if (error) throw error;
    const rows = data || [];
    allRows = allRows.concat(rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  return computeSeasonMeasures(playerName, allRows);
}

export async function fetchAllPlayersSeasonAverages(playerNames, onProgress) {
  const allSeasonData = [];
  const total = playerNames.length;

  for (let i = 0; i < total; i++) {
    const name = playerNames[i];
    if (onProgress) onProgress(i + 1, total, name);
    const playerSeasons = await fetchPlayerSeasonAverages(name);
    allSeasonData.push(...playerSeasons);
  }

  return allSeasonData;
}

export async function fetchSeasonData(season, onProgress) {
  const cols = await ensureFetchCols();
  let allRows = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select(cols)
      .eq("season", season)
      .range(offset, offset + pageSize - 1);

    if (error) throw error;
    const rows = data || [];
    allRows = allRows.concat(rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  if (onProgress) onProgress(allRows.length);

  const playerMap = {};
  for (const row of allRows) {
    if (!playerMap[row.player_name]) playerMap[row.player_name] = [];
    playerMap[row.player_name].push(row);
  }

  const seasonData = [];
  for (const [name, rows] of Object.entries(playerMap)) {
    const measures = computeSeasonMeasures(name, rows);
    seasonData.push(...measures);
  }

  return seasonData;
}


// ─── Season Measure Computation ──────────────────────────────────────────────

function computeSeasonMeasures(playerName, rows) {
  const seasonMap = {};

  for (const row of rows) {
    const key = row.season;
    if (!seasonMap[key]) {
      seasonMap[key] = { regular: [], playoff: [] };
    }
    const gameType = row.game_type === "playoffs" ? "playoff" : "regular";
    seasonMap[key][gameType].push(row);
  }

  return Object.entries(seasonMap)
    .map(([season, { regular, playoff }]) => {
      const games = regular.length;
      if (games === 0) return null;

      const measures = {};
      measures.games = games;

      const nums = (arr, field) =>
        arr.map((r) => parseFloat(r[field])).filter((v) => !isNaN(v));
      const sum = (arr) => arr.reduce((a, b) => a + b, 0);
      const mean = (arr) => (arr.length ? sum(arr) / arr.length : null);
      const std = (arr) => {
        if (arr.length < 2) return null;
        const m = mean(arr);
        return Math.sqrt(
          arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1)
        );
      };

      const minutes = nums(regular, "minutes");
      const points = nums(regular, "points");
      const rebounds = nums(regular, "rebounds");
      const offReb = nums(regular, "offensive_rebounds");
      const defReb = nums(regular, "defensive_rebounds");
      const assists = nums(regular, "assists");
      const steals = nums(regular, "steals");
      const blocks = nums(regular, "blocks");
      const turnovers = nums(regular, "turnovers");
      const fouls = nums(regular, "personal_fouls");
      const plusMinus = nums(regular, "plus_minus");
      const fgm = nums(regular, "field_goals_made");
      const fga = nums(regular, "field_goals_attempted");
      const tpm = nums(regular, "three_pointers_made");
      const tpa = nums(regular, "three_pointers_attempted");
      const ftm = nums(regular, "free_throws_made");
      const fta = nums(regular, "free_throws_attempted");

      const totalMin = sum(minutes);
      measures.minutes_total = totalMin;
      measures.minutes_per_game = games > 0 ? totalMin / games : null;
      measures.points_per_game = mean(points);
      measures.points_per36 =
        totalMin > 0 ? (sum(points) / totalMin) * 36 : null;
      measures.rebounds_per_game = mean(rebounds);
      measures.rebounds_per36 =
        totalMin > 0 ? (sum(rebounds) / totalMin) * 36 : null;
      measures.offensive_rebounds_per_game = mean(offReb);
      measures.offensive_rebounds_per36 =
        totalMin > 0 ? (sum(offReb) / totalMin) * 36 : null;
      measures.defensive_rebounds_per_game = mean(defReb);
      measures.defensive_rebounds_per36 =
        totalMin > 0 ? (sum(defReb) / totalMin) * 36 : null;
      measures.assists_per_game = mean(assists);
      measures.assists_per36 =
        totalMin > 0 ? (sum(assists) / totalMin) * 36 : null;
      measures.steals_per_game = mean(steals);
      measures.steals_per36 =
        totalMin > 0 ? (sum(steals) / totalMin) * 36 : null;
      measures.blocks_per_game = mean(blocks);
      measures.blocks_per36 =
        totalMin > 0 ? (sum(blocks) / totalMin) * 36 : null;

      const stocksTotal = sum(steals) + sum(blocks);
      measures.stocks_per_game = games > 0 ? stocksTotal / games : null;
      measures.stocks_per36 =
        totalMin > 0 ? (stocksTotal / totalMin) * 36 : null;

      measures.turnovers_per_game = mean(turnovers);
      measures.turnovers_per36 =
        totalMin > 0 ? (sum(turnovers) / totalMin) * 36 : null;
      measures.fouls_per_game = mean(fouls);
      measures.fouls_per36 =
        totalMin > 0 ? (sum(fouls) / totalMin) * 36 : null;
      measures.plus_minus_per_game = mean(plusMinus);
      measures.plus_minus_per36 =
        totalMin > 0 ? (sum(plusMinus) / totalMin) * 36 : null;

      const totalPts = sum(points);
      const totalFga = sum(fga);
      const totalFta = sum(fta);
      const totalFgm = sum(fgm);
      const totalTpm = sum(tpm);
      const totalTpa = sum(tpa);
      const totalFtm = sum(ftm);

      measures.true_shooting_pct =
        totalFga + 0.44 * totalFta > 0
          ? totalPts / (2 * (totalFga + 0.44 * totalFta))
          : null;
      measures.field_goal_pct = totalFga > 0 ? totalFgm / totalFga : null;
      measures.efg_pct =
        totalFga > 0 ? (totalFgm + 0.5 * totalTpm) / totalFga : null;
      measures.three_point_pct =
        totalTpa > 30 ? totalTpm / totalTpa : null;
      measures.threes_made_per_game = games > 0 ? totalTpm / games : null;
      measures.free_throw_pct = totalFta > 0 ? totalFtm / totalFta : null;
      measures.ast_tov_ratio =
        sum(turnovers) > 0 ? sum(assists) / sum(turnovers) : null;

      // Game Score
      const gameScores = regular.map((r) => {
        const p = parseFloat(r.points) || 0;
        const fg = parseFloat(r.field_goals_made) || 0;
        const fgAtt = parseFloat(r.field_goals_attempted) || 0;
        const ft = parseFloat(r.free_throws_made) || 0;
        const ftAtt = parseFloat(r.free_throws_attempted) || 0;
        const rb = parseFloat(r.rebounds) || 0;
        const st = parseFloat(r.steals) || 0;
        const ast = parseFloat(r.assists) || 0;
        const bl = parseFloat(r.blocks) || 0;
        const pf = parseFloat(r.personal_fouls) || 0;
        const to = parseFloat(r.turnovers) || 0;
        return (
          p + 0.4 * fg - 0.7 * fgAtt - 0.4 * (ftAtt - ft) +
          0.4 * rb + st + 0.7 * ast + 0.7 * bl - 0.4 * pf - to
        );
      });
      measures.game_score_mean = mean(gameScores);

      // Stability
      const ptsStd = std(points);
      const gsStd = std(gameScores);
      const ptsMean = Math.abs(measures.points_per_game || 1);
      const gsMean = Math.abs(measures.game_score_mean || 1);
      measures.points_cv =
        ptsStd != null && ptsMean > 0 ? ptsStd / ptsMean : null;
      measures.game_score_cv =
        gsStd != null && gsMean > 0 ? gsStd / gsMean : null;
      measures.bad_game_rate =
        gameScores.length > 0
          ? gameScores.filter((gs) => gs < 5).length / gameScores.length
          : null;

      // Playoff measures
      const pGames = playoff.length;
      measures.playoff_games = pGames;

      if (pGames > 0) {
        const pPts = nums(playoff, "points");
        const pReb = nums(playoff, "rebounds");
        const pAst = nums(playoff, "assists");
        const pFgm = nums(playoff, "field_goals_made");
        const pFga = nums(playoff, "field_goals_attempted");
        const pTpm = nums(playoff, "three_pointers_made");
        const pFtm = nums(playoff, "free_throws_made");
        const pFta = nums(playoff, "free_throws_attempted");

        measures.playoff_points_per_game = mean(pPts);
        measures.playoff_rebounds_per_game = mean(pReb);
        measures.playoff_assists_per_game = mean(pAst);

        const pTotalPts = sum(pPts);
        const pTotalFga = sum(pFga);
        const pTotalFta = sum(pFta);
        const pTotalFgm = sum(pFgm);
        const pTotalTpm = sum(pTpm);
        const pTotalFtm = sum(pFtm);

        measures.playoff_true_shooting_pct =
          pTotalFga + 0.44 * pTotalFta > 0
            ? pTotalPts / (2 * (pTotalFga + 0.44 * pTotalFta))
            : null;
        measures.playoff_efg_pct =
          pTotalFga > 0
            ? (pTotalFgm + 0.5 * pTotalTpm) / pTotalFga
            : null;
        measures.playoff_free_throw_pct =
          pTotalFta > 0 ? pTotalFtm / pTotalFta : null;

        const pGameScores = playoff.map((r) => {
          const p = parseFloat(r.points) || 0;
          const fg = parseFloat(r.field_goals_made) || 0;
          const fgAtt = parseFloat(r.field_goals_attempted) || 0;
          const ft = parseFloat(r.free_throws_made) || 0;
          const ftAtt = parseFloat(r.free_throws_attempted) || 0;
          const rb = parseFloat(r.rebounds) || 0;
          const st = parseFloat(r.steals) || 0;
          const a = parseFloat(r.assists) || 0;
          const bl = parseFloat(r.blocks) || 0;
          const pf = parseFloat(r.personal_fouls) || 0;
          const to = parseFloat(r.turnovers) || 0;
          return (
            p + 0.4 * fg - 0.7 * fgAtt - 0.4 * (ftAtt - ft) +
            0.4 * rb + st + 0.7 * a + 0.7 * bl - 0.4 * pf - to
          );
        });
        measures.playoff_game_score_mean = mean(pGameScores);
        const pGsStd = std(pGameScores);
        const pGsMean = Math.abs(measures.playoff_game_score_mean || 1);
        measures.playoff_game_score_cv =
          pGsStd != null && pGsMean > 0 ? pGsStd / pGsMean : null;
        measures.playoff_bad_game_rate =
          pGameScores.length > 0
            ? pGameScores.filter((gs) => gs < 5).length / pGameScores.length
            : null;
      } else {
        measures.playoff_points_per_game = 0;
        measures.playoff_rebounds_per_game = 0;
        measures.playoff_assists_per_game = 0;
        measures.playoff_true_shooting_pct = null;
        measures.playoff_efg_pct = null;
        measures.playoff_free_throw_pct = null;
        measures.playoff_game_score_mean = 0;
        measures.playoff_game_score_cv = null;
        measures.playoff_bad_game_rate = 1.0;
      }

      // Award / legacy aggregation. Awards live on a single row of the season
      // (typically the season-final row), so we take the max across all rows.
      // The row key matches `c.key` because hyphenated columns are fetched
      // through a PostgREST alias.
      const awardSourceRows = [...regular, ...playoff];
      const awardColsToUse = availableAwardCols ?? CANDIDATE_AWARD_COLS;
      for (const c of awardColsToUse) {
        const col = c.key;
        let best = 0;
        for (const r of awardSourceRows) {
          const v = parseFloat(r[col]);
          if (!isNaN(v) && v > best) best = v;
        }
        measures[col] = best;
      }

      return { player_name: playerName, season, games, ...measures };
    })
    .filter(Boolean);
}

// ─── EI Computation (2-step sigmoid transformation) ──────────────────────────

// Step 1: percentile bounds (10th/90th) for every measure across the dataset.
function computeMeasureBounds(seasonData) {
  const allMeasureNames = new Set();
  for (const cat of Object.values(CATEGORIES)) {
    cat.measures.forEach((m) => allMeasureNames.add(m));
  }

  const measureBounds = {};
  for (const m of allMeasureNames) {
    const values = seasonData
      .map((s) => s[m])
      .filter((v) => v != null && !isNaN(v) && isFinite(v))
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

// Sigmoid anchor points (shared across seasons).
const SIGMOID_X_C = -Math.log(1 / SIGMOID_ALPHA - 1); // ≈ -2.197
const SIGMOID_X_D = -Math.log(1 / (1 - SIGMOID_ALPHA) - 1); // ≈ 2.197

// Step 2: per-season sub-category scores = RMS of sigmoid-normalized measures.
function computeSubCategoryScores(s, measureBounds) {
  const subCategoryScores = {};

  for (const [catName, cat] of Object.entries(CATEGORIES)) {
    if (cat.measures.length === 0) {
      subCategoryScores[catName] = null;
      continue;
    }

    const transformedScores = [];

    for (const m of cat.measures) {
      const val = s[m];
      if (val == null || isNaN(val) || !isFinite(val)) continue;
      const bounds = measureBounds[m];
      if (!bounds) continue;

      const { minVal, maxVal } = bounds;
      const span = maxVal - minVal;

      // Sigmoid normalization
      let mHat =
        SIGMOID_X_C + ((SIGMOID_X_D - SIGMOID_X_C) / span) * (val - minVal);
      mHat = Math.max(-50, Math.min(50, mHat)); // clip
      const mTilde = 1 / (1 + Math.exp(-mHat)); // sigmoid → [0,1]

      // "higher is better" → score = 1 - mTilde (top player → low score)
      // "lower is better"  → score = mTilde
      const score = cat.direction === "higher" ? 1 - mTilde : mTilde;

      transformedScores.push(score);
    }

    if (transformedScores.length === 0) {
      subCategoryScores[catName] = null;
    } else {
      subCategoryScores[catName] = Math.sqrt(
        transformedScores.reduce((sum, v) => sum + v * v, 0) /
          transformedScores.length
      );
    }
  }

  return subCategoryScores;
}

// ─── Career-level Legacy normalization ───────────────────────────────────────
// Legacy is intrinsically cumulative (career rings, MVP count, All-NBA
// selections, …). Per-season aggregation gives 1-season role players on title
// teams artificially perfect Championship Success. We instead compute one
// career-cumulative value per player, percentile-normalize across the player
// pool, and reuse that constant score for all of that player's seasons.
//
// Aggregation rule per measure:
//   - MAX: columns that already carry the cumulative value end-of-season
//     (Olympic medal running counts, binary Hall-of-Fame flag).
//   - SUM: per-season binary/integer flags that should accumulate over career
//     (rings, MVPs, All-NBA / All-Defensive / All-Star selections, etc.).
const LEGACY_MAX_MEASURES = new Set([
  "olympic_gold_medal_count",
  "hall_of_fame_inductee",
]);

function legacyMeasureNames() {
  const subCats = CATEGORY_GROUPS.Legacy ?? [];
  const names = new Set();
  for (const sc of subCats) {
    const cat = CATEGORIES[sc];
    if (!cat) continue;
    cat.measures.forEach((m) => names.add(m));
  }
  return [...names];
}

function aggregateCareerLegacy(seasonData) {
  const measures = legacyMeasureNames();
  const byPlayer = {};
  for (const s of seasonData) {
    if (!byPlayer[s.player_name]) {
      byPlayer[s.player_name] = { player_name: s.player_name };
      for (const m of measures) byPlayer[s.player_name][m] = 0;
    }
    const c = byPlayer[s.player_name];
    for (const m of measures) {
      const v = s[m];
      if (v == null || isNaN(v) || !isFinite(v)) continue;
      if (LEGACY_MAX_MEASURES.has(m)) {
        if (v > c[m]) c[m] = v;
      } else {
        c[m] = c[m] + v;
      }
    }
  }
  return Object.values(byPlayer);
}

function computeCareerLegacyBounds(careerArray) {
  const measures = legacyMeasureNames();
  const bounds = {};
  for (const m of measures) {
    const values = careerArray
      .map((c) => c[m])
      .filter((v) => v != null && !isNaN(v) && isFinite(v))
      .sort((a, b) => a - b);
    const n = values.length;
    if (n < 5) {
      bounds[m] = null;
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
    bounds[m] = { minVal, maxVal };
  }
  return bounds;
}

function computeLegacySubScoresFor(careerRow, careerBounds) {
  const result = {};
  for (const subCat of CATEGORY_GROUPS.Legacy ?? []) {
    const cat = CATEGORIES[subCat];
    if (!cat) continue;
    const transformed = [];
    for (const m of cat.measures) {
      const val = careerRow[m];
      if (val == null || isNaN(val) || !isFinite(val)) continue;
      const bounds = careerBounds[m];
      if (!bounds) continue;
      const { minVal, maxVal } = bounds;
      const span = maxVal - minVal;
      let mHat =
        SIGMOID_X_C + ((SIGMOID_X_D - SIGMOID_X_C) / span) * (val - minVal);
      mHat = Math.max(-50, Math.min(50, mHat));
      const mTilde = 1 / (1 + Math.exp(-mHat));
      const score = cat.direction === "higher" ? 1 - mTilde : mTilde;
      transformed.push(score);
    }
    result[subCat] =
      transformed.length === 0
        ? null
        : Math.sqrt(
            transformed.reduce((sum, v) => sum + v * v, 0) / transformed.length
          );
  }
  return result;
}

function computeCareerLegacyScores(seasonData) {
  const careerArray = aggregateCareerLegacy(seasonData);
  const careerBounds = computeCareerLegacyBounds(careerArray);
  const out = {};
  for (const row of careerArray) {
    out[row.player_name] = computeLegacySubScoresFor(row, careerBounds);
  }
  return out;
}

// Weighted RMS of {key: score} pairs given a weights lookup. Weights are
// normalized by their own sum, so they need not sum to exactly 1.
function weightedRMS(scores, weights) {
  let weightedSumSq = 0;
  let totalWeight = 0;
  for (const [key, score] of Object.entries(scores)) {
    const w = weights[key] ?? 0;
    if (w === 0 || score === null || score === undefined) continue;
    weightedSumSq += w * score * score;
    totalWeight += w;
  }
  return totalWeight > 0 ? Math.sqrt(weightedSumSq / totalWeight) : 1;
}

// Pick the consecutive season window with the lowest mean EI (best stretch).
// If the career is shorter than the window, use all seasons as a single window.
function pickBestSlidingWindow(seasons, windowSize) {
  const chronological = [...seasons].sort((a, b) =>
    a.season.localeCompare(b.season)
  );

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
    const mean =
      window.reduce((sum, s) => sum + s.eiScore, 0) / windowSize;
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

// Group seasons by player, pick best consecutive window, build rankings.
// `minGames` (optional) drops any player whose total games < threshold; useful
// for the "all players" mode where role players on title rosters would
// otherwise spike Championship / Legacy scores after only a handful of games.
function buildPlayerRankings(seasonScores, topYears, minGames = 0) {
  const playerSeasons = {};
  for (const s of seasonScores) {
    if (!playerSeasons[s.player_name]) {
      playerSeasons[s.player_name] = [];
    }
    playerSeasons[s.player_name].push(s);
  }

  const playerRankings = [];

  for (const [name, seasons] of Object.entries(playerSeasons)) {
    const { selectedSeasons, careerEI } = pickBestSlidingWindow(
      seasons,
      topYears
    );

    const peakEI =
      seasons.length > 0
        ? Math.min(...seasons.map((s) => s.eiScore))
        : 1;
    const totalSeasons = seasons.length;
    const totalGames = seasons.reduce((sum, s) => sum + s.games, 0);

    playerRankings.push({
      player_name: name,
      careerEI,
      peakEI,
      totalSeasons,
      totalGames,
      selectedSeasons,
      allSeasons: seasons,
    });
  }

  const filtered =
    minGames > 0
      ? playerRankings.filter((p) => p.totalGames >= minGames)
      : playerRankings;

  // Sort ascending: lowest careerEI = best player = rank 1
  filtered.sort((a, b) => a.careerEI - b.careerEI);

  const allEIScores = seasonScores.map((s) => s.eiScore);

  return { playerRankings: filtered, allEIScores };
}

/**
 * Flat EI: single weighted RMS over all (sub-)categories.
 * `weights` is keyed by sub-category name. Used by DiscoverGoat & WembyIndicator.
 */
export function computeEIScores(seasonData, weights, topYears, opts = {}) {
  const { minGames = 0 } = opts;
  const measureBounds = computeMeasureBounds(seasonData);
  const careerLegacy = computeCareerLegacyScores(seasonData);
  const legacySubCats = CATEGORY_GROUPS.Legacy ?? [];

  const seasonScores = seasonData.map((s) => {
    const categoryScores = computeSubCategoryScores(s, measureBounds);
    // Override Legacy sub-categories with the player's career-cumulative value
    // so a 1-season ring on a title roster doesn't outrank a multi-ring HOFer.
    const careerLeg = careerLegacy[s.player_name];
    if (careerLeg) {
      for (const sc of legacySubCats) {
        if (careerLeg[sc] !== undefined) categoryScores[sc] = careerLeg[sc];
      }
    }
    const ei = weightedRMS(categoryScores, weights);
    return { ...s, categoryScores, eiScore: ei };
  });

  const { playerRankings, allEIScores } = buildPlayerRankings(
    seasonScores,
    topYears,
    minGames
  );

  return { playerRankings, seasonScores, allEIScores, measureBounds };
}

/**
 * Hierarchical EI following the two-level weight tree:
 *   sub-category scores → (sub-category weights) → category scores
 *                       → (category weights, sum to 1) → EI
 *
 * @param {object} categoryWeights    keyed by category (Volume, Rebounding, ...)
 * @param {object} subCategoryWeights keyed by sub-category (Scoring Production, ...)
 */
export function computeEIScoresHierarchical(
  seasonData,
  categoryWeights,
  subCategoryWeights,
  topYears,
  opts = {}
) {
  const { minGames = 0, categoryGroups } = opts;
  // Allow callers to pass a custom category → sub-category tree (used by the
  // "Create your own GOAT" page where users build groupings interactively).
  const groups = categoryGroups ?? CATEGORY_GROUPS;
  const measureBounds = computeMeasureBounds(seasonData);
  const careerLegacy = computeCareerLegacyScores(seasonData);

  // Legacy sub-categories are still defined globally; the user's category tree
  // may place them in arbitrary parents but the leaf-level career override
  // should still apply wherever they appear.
  const legacyLeafSet = new Set(CATEGORY_GROUPS.Legacy ?? []);

  const seasonScores = seasonData.map((s) => {
    // Step 2: sub-category (leaf) scores. Kept on `categoryScores` for the
    // player-card percentile charts that read per-sub-category values.
    const categoryScores = computeSubCategoryScores(s, measureBounds);

    // Override Legacy sub-categories with the player's career-cumulative
    // score (same across all of the player's seasons) so a 1-ring role
    // player on a title roster doesn't outrank a multi-ring HOFer.
    const careerLeg = careerLegacy[s.player_name];
    if (careerLeg) {
      for (const sc of legacyLeafSet) {
        if (careerLeg[sc] !== undefined) categoryScores[sc] = careerLeg[sc];
      }
    }

    // Step 3: category score = weighted RMS of its sub-category scores.
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

    // Step 4: EI = weighted RMS of category scores (category weights sum to 1).
    const ei = weightedRMS(categoryGroupScores, categoryWeights);

    return { ...s, categoryScores, categoryGroupScores, eiScore: ei };
  });

  const { playerRankings, allEIScores } = buildPlayerRankings(
    seasonScores,
    topYears,
    minGames
  );

  return { playerRankings, seasonScores, allEIScores, measureBounds };
}

/** Two career EI values tie when they display the same at 3 decimals. */
export function eiScoresTied(a, b) {
  return a.toFixed(3) === b.toFixed(3);
}

/**
 * Assign display ranks with ties (1, 1, 3 …). Assumes players are already
 * sorted best-first (lowest careerEI = rank 1).
 */
export function assignDisplayRanks(players) {
  let currentRank = 1;
  return players.map((player, i) => {
    if (i > 0 && !eiScoresTied(player.careerEI, players[i - 1].careerEI)) {
      currentRank = i + 1;
    }
    return { ...player, displayRank: currentRank };
  });
}
