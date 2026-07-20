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
    "Plus-Minus Impact",
  ],
  Rebounding: [
    "Total Rebounding",
    "Offensive Rebounding",
    "Defensive Rebounding",
  ],
  Defense: ["Steals", "Blocks", "Foul Discipline"],
  Efficiency: [
    "True Shooting Efficiency",
    "Field Goal Efficiency",
    "Three-Point Shooting",
    "Free Throw Shooting",
    "Turnover Control",
    "Assists",
  ],
  Stability: ["Consistency", "Bad-Game Rate", "Win Percentage Regular Season"],
  Playoffs: [
    "Playoff Production",
    "Playoff Efficiency",
    "Playoff Consistency",
    "Playoff Buzzer shot made",
  ],
  Legacy: ["Awards Recognition", "Championship Success"],
};

export const CATEGORIES = {
  "Scoring Production": {
    measures: ["points_per_game", "game_score_mean"],
    direction: "higher",
  },
  "Minutes Load": {
    measures: ["minutes_total", "minutes_per_game"],
    direction: "higher",
  },
  "Total Rebounding": {
    measures: ["rebounds_per_game"],
    direction: "higher",
  },
  "Offensive Rebounding": {
    measures: ["offensive_rebounds_per_game"],
    direction: "higher",
  },
  "Defensive Rebounding": {
    measures: ["defensive_rebounds_per_game"],
    direction: "higher",
  },
  Assists: {
    measures: ["assists_per_game", "ast_tov_ratio"],
    direction: "higher",
  },
  Steals: {
    measures: ["steals_per_game"],
    direction: "higher",
  },
  Blocks: {
    measures: ["blocks_per_game"],
    direction: "higher",
  },
  "Foul Discipline": {
    measures: ["fouls_per_game"],
    direction: "lower",
  },
  "True Shooting Efficiency": {
    measures: ["true_shooting_pct"],
    direction: "higher",
  },
  "Field Goal Efficiency": {
    measures: ["efg_pct"],
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
    measures: ["turnovers_per_game"],
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
  "Win Percentage Regular Season": {
    measures: ["win_percentage"],
    direction: "higher",
  },
  "Plus-Minus Impact": {
    measures: ["plus_minus_per_game"],
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
    measures: ["playoff_bad_game_rate"],
    direction: "lower",
  },
  "Playoff Buzzer shot made": {
    measures: ["playoff_buzzer_makes"],
    direction: "higher",
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

export const WIN_PERCENTAGE_MIN_GAMES = 41;

/** Decade games required for True Shooting / Field Goal Efficiency to count toward EI. */
export const TRUE_SHOOTING_DECADE_GAMES_FLOOR = 200;
export const FIELD_GOAL_EFFICIENCY_DECADE_GAMES_FLOOR = 200;

/**
 * Total regular-season games per player per decade (same decade keys as
 * seasonDecadeKey). Used for measure eligibility gates.
 */
function buildPlayerDecadeGames(seasonData) {
  const out = new Map(); // player → Map(decadeKey → games)
  for (const s of seasonData) {
    const dk = seasonDecadeKey(s.season);
    if (dk == null) continue;
    if (!out.has(s.player_name)) out.set(s.player_name, new Map());
    const m = out.get(s.player_name);
    m.set(dk, (m.get(dk) || 0) + (Number(s.games) || 0));
  }
  return out;
}

/**
 * Null out shooting-efficiency measures on seasons where the player has fewer
 * than the decade-games floor for that measure.
 */
function applyShootingEfficiencyDecadeGates(seasonData) {
  const decadeGames = buildPlayerDecadeGames(seasonData);
  return seasonData.map((s) => {
    const dk = seasonDecadeKey(s.season);
    const g =
      dk == null ? 0 : decadeGames.get(s.player_name)?.get(dk) || 0;
    let next = s;
    if (
      g < TRUE_SHOOTING_DECADE_GAMES_FLOOR &&
      s.true_shooting_pct != null
    ) {
      next = { ...next, true_shooting_pct: null };
    }
    if (
      g < FIELD_GOAL_EFFICIENCY_DECADE_GAMES_FLOOR &&
      s.efg_pct != null
    ) {
      next = { ...next, efg_pct: null };
    }
    return next;
  });
}

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
  "playoff_buzzer_make",
  "win_percentage",
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

      // Season-level win % (one value per season). Only eligible with enough
      // regular-season games so partial seasons don't enter the ranking.
      let winPct = null;
      if (games >= WIN_PERCENTAGE_MIN_GAMES) {
        for (const r of regular) {
          const v = parseFloat(r.win_percentage);
          if (!isNaN(v) && isFinite(v)) {
            winPct = v;
            break;
          }
        }
      }
      measures.win_percentage = winPct;

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

        // Game-winning playoff buzzer makes only (misses not tracked).
        // Count rows with playoff_buzzer_make = 1 among playoff games.
        measures.playoff_buzzer_makes = playoff.reduce((sum, r) => {
          const v = parseFloat(r.playoff_buzzer_make);
          return sum + (!isNaN(v) && v === 1 ? 1 : 0);
        }, 0);
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
        measures.playoff_buzzer_makes = 0;
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
  const gated = applyShootingEfficiencyDecadeGates(seasonData);
  const measureBounds = computeMeasureBounds(gated);
  const careerLegacy = computeCareerLegacyScores(gated);
  const legacySubCats = CATEGORY_GROUPS.Legacy ?? [];

  const seasonScores = gated.map((s) => {
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
  const gated = applyShootingEfficiencyDecadeGates(seasonData);
  const measureBounds = computeMeasureBounds(gated);
  const careerLegacy = computeCareerLegacyScores(gated);

  // Legacy sub-categories are still defined globally; the user's category tree
  // may place them in arbitrary parents but the leaf-level career override
  // should still apply wherever they appear.
  const legacyLeafSet = new Set(CATEGORY_GROUPS.Legacy ?? []);

  const seasonScores = gated.map((s) => {
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

/**
 * Two career EI values tie only when equal to within a tight numeric tolerance.
 * The leaderboard shows EI rounded to 3 decimals, but ranking on the rounded
 * value makes players who differ only at the 4th–5th decimal (common when
 * weighting heavily on Championship Success, where EIs are tiny) share a rank
 * and the crown. Comparing the raw values gives a single winner whenever the
 * players are actually distinct; only genuinely identical résumés still tie.
 */
export function eiScoresTied(a, b) {
  return Math.abs(a - b) < 1e-9;
}

/**
 * Per-decade raw value arrays for every era measure, drawn from the SAME
 * eligible season pool the By-Era EI uses (players who cleared the decade games
 * floor). Stats untracked in a decade are omitted (never imputed). Powers the
 * "Explore Eras" distribution viewer.
 * Returns { decades: number[], byDecade: { [dk]: { [measure]: number[] } } }.
 */
export function computeEraDistributions(seasonData) {
  const byPlayer = new Map();
  for (const s of seasonData) {
    const dk = seasonDecadeKey(s.season);
    if (dk == null || dk === PRE_1950_BUCKET) continue;
    if (!byPlayer.has(s.player_name)) byPlayer.set(s.player_name, new Map());
    const decades = byPlayer.get(s.player_name);
    if (!decades.has(dk)) decades.set(dk, { seasons: [], games: 0 });
    const bucket = decades.get(dk);
    bucket.seasons.push(s);
    bucket.games += Number(s.games) || 0;
  }

  const seasonsByDecade = new Map();
  for (const decades of byPlayer.values()) {
    for (const [dk, bucket] of decades) {
      if (bucket.games < ERA_DECADE_GAMES_FLOOR) continue;
      if (!seasonsByDecade.has(dk)) seasonsByDecade.set(dk, []);
      for (const s of bucket.seasons) seasonsByDecade.get(dk).push(s);
    }
  }

  const byDecade = {};
  for (const [dk, seasons] of seasonsByDecade) {
    byDecade[dk] = {};
    for (const m of ERA_MEASURES) {
      if (!statTrackedInDecade(m, dk)) continue;
      const vals = seasons
        .map((s) => s[m])
        .filter((v) => v != null && !isNaN(v) && isFinite(v));
      if (vals.length > 0) byDecade[dk][m] = vals;
    }
  }

  const decades = Object.keys(byDecade)
    .map(Number)
    .sort((a, b) => a - b);
  return { decades, byDecade };
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

// ═══════════════════════════════════════════════════════════════════════════
// By-Era EI — normalize each player against the distribution of HIS OWN ERA
// ═══════════════════════════════════════════════════════════════════════════
//
// IDENTICAL pipeline to All-Time — the ONLY difference is which distribution a
// season is normalized against:
//   • normalize each SEASON's measures via the same sigmoid (10th/90th pct)
//   • Step 2: RMS sub-category → weighted RMS category → weighted RMS EI → one
//     EI per season (with the Legacy override)
//   • roll up a career/decade by AVERAGING the per-season EIs (equal weight)
//
// All-Time bounds each measure over ALL player-seasons. Era bounds it PER DECADE
// over the seasons of players who logged >= ERA_DECADE_GAMES_FLOOR games in that
// decade, so every player is judged against his contemporaries. A player's:
//   • decade EI  = average of his per-season EIs within that decade
//   • "all eras" EI = average of his per-season EIs across the whole career,
//     each season judged vs its own decade
// A player appears in every decade where he cleared the games floor.

const PRE_1950_BUCKET = "Pre-1950";

// A player enters a decade's distribution / ranking only if his TOTAL games
// across his seasons in that decade reach this floor. Keeps fringe/cup-of-coffee
// decade stints from distorting a thin era's percentiles, and mirrors the 200
// career-games rule used for the all-time leaderboard.
const ERA_DECADE_GAMES_FLOOR = 200;

/** End year of a "YYYY-YY" season string (1999-00 → 2000, 1985-86 → 1986). */
export function seasonEndYear(season) {
  if (season == null) return null;
  const str = String(season).trim();
  const m = str.match(/^(\d{4})-(\d{2})$/);
  if (m) {
    const start = parseInt(m[1], 10);
    const suffix = parseInt(m[2], 10);
    let end = Math.floor(start / 100) * 100 + suffix;
    if (end < start) end += 100; // century rollover (1999-00 → 2000)
    return end;
  }
  const y = parseInt(str.slice(0, 4), 10);
  return isNaN(y) ? null : y;
}

/** decade_key = floor(end_year / 10) * 10 (1995-96 → 1996 → 1990). */
export function seasonDecadeKey(season) {
  const end = seasonEndYear(season);
  if (end == null) return null;
  // Pre-1950 seasons are excluded from era boards (thin / incomplete coverage).
  if (end < 1950) return PRE_1950_BUCKET;
  return Math.floor(end / 10) * 10;
}

export function decadeLabel(decadeKey) {
  if (decadeKey === PRE_1950_BUCKET) return "Pre-1950";
  const now = new Date().getFullYear();
  if (Number(decadeKey) === Math.floor(now / 10) * 10) {
    return `${decadeKey}s (so far)`;
  }
  return `${decadeKey}s`;
}

// Every measure → its category's direction ("higher"/"lower is better").
const MEASURE_DIRECTION = (() => {
  const d = {};
  for (const cat of Object.values(CATEGORIES)) {
    for (const m of cat.measures) d[m] = cat.direction;
  }
  return d;
})();

// Non-Legacy measures participate in era normalization; Legacy (rings, MVPs …)
// is cumulative and handled by the shared career/decade legacy override.
const ERA_MEASURES = (() => {
  const legacy = new Set(legacyMeasureNames());
  const names = new Set();
  for (const cat of Object.values(CATEGORIES)) {
    for (const m of cat.measures) if (!legacy.has(m)) names.add(m);
  }
  return [...names];
})();

// ─── Stat tracking eras ──────────────────────────────────────────────────────
// Several stats did not exist league-wide in early decades, and the source rows
// can even contain bogus values for them (e.g. ABA-era 3P attributed to a 1970s
// NBA line). We must never rank a stat in a decade where the rule didn't exist,
// regardless of what's in the table. Each measure maps to the earliest decade
// the NBA tracked it for the FULL decade; earlier decades get a null baseline,
// so the component is dropped and the EI weights renormalize (never imputed).
//   3PM/3PA/3P%          first 1979-80  → from the 1980s
//   Steals/Blocks        first 1973-74  → 70s partial → from the 1980s
//   ORB/DRB split        first 1973-74  → 70s partial → from the 1980s
//   Turnovers (+AST/TOV) first 1977-78  → 70s ~2 seasons → from the 1980s
const STAT_FIRST_DECADE = {
  three_point_pct: 1980,
  threes_made_per_game: 1980,
  steals_per_game: 1980,
  steals_per36: 1980,
  blocks_per_game: 1980,
  blocks_per36: 1980,
  stocks_per_game: 1980,
  stocks_per36: 1980,
  offensive_rebounds_per_game: 1980,
  offensive_rebounds_per36: 1980,
  defensive_rebounds_per_game: 1980,
  defensive_rebounds_per36: 1980,
  turnovers_per_game: 1980,
  turnovers_per36: 1980,
  ast_tov_ratio: 1980,
  // Legacy: the Finals MVP award was first given in 1969, so it did not exist
  // for the 1960s decade. Only meaningful from the 1970s onward — drop it for
  // the 60s so it can't inject a flat, non-differentiating score.
  nba_finals_most_valuable_player: 1970,
};

function statTrackedInDecade(measure, decadeKey) {
  if (decadeKey === PRE_1950_BUCKET) return false;
  const first = STAT_FIRST_DECADE[measure];
  return first == null || Number(decadeKey) >= first;
}

// 10th/90th-percentile bounds over a raw value array (same recipe/anchors as the
// All-Time computeMeasureBounds); returns null when fewer than 5 observations.
function percentileBounds(rawValues) {
  const values = rawValues
    .filter((v) => v != null && !isNaN(v) && isFinite(v))
    .sort((a, b) => a - b);
  const n = values.length;
  if (n < 5) return null;
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
  return { minVal, maxVal, nObs: n };
}

// Single measure → sigmoid [0,1] score (identical transform to Step 1), with
// direction applied. Returns null for missing values or missing bounds.
function normalizeMeasureScore(val, bounds, direction) {
  if (val == null || isNaN(val) || !isFinite(val) || !bounds) return null;
  const { minVal, maxVal } = bounds;
  const span = maxVal - minVal;
  let mHat =
    SIGMOID_X_C + ((SIGMOID_X_D - SIGMOID_X_C) / span) * (val - minVal);
  mHat = Math.max(-50, Math.min(50, mHat));
  const mTilde = 1 / (1 + Math.exp(-mHat));
  return direction === "higher" ? 1 - mTilde : mTilde;
}

// Sub-category score = RMS of its already-normalized [0,1] measure scores.
function subCatScoresFromMeasureScores(measureScores) {
  const out = {};
  for (const [catName, cat] of Object.entries(CATEGORIES)) {
    const arr = [];
    for (const m of cat.measures) {
      const sc = measureScores[m];
      if (sc == null) continue;
      arr.push(sc);
    }
    out[catName] =
      arr.length === 0
        ? null
        : Math.sqrt(arr.reduce((s, v) => s + v * v, 0) / arr.length);
  }
  return out;
}

// Per-decade 10th/90th-percentile anchors over the SEASONS of players who cleared
// the decade games floor. Stats untracked in a decade are forced null (dropped),
// so the component is dropped and the EI weights renormalize (never imputed).
//   seasonsByDecade: Map(decadeKey → array of season objects)
function computeEraBaselines(seasonsByDecade) {
  const baselines = {};
  for (const [dk, seasons] of seasonsByDecade) {
    const b = {};
    for (const m of ERA_MEASURES) {
      b[m] = statTrackedInDecade(m, dk)
        ? percentileBounds(seasons.map((s) => s[m]))
        : null;
    }
    baselines[dk] = b;
  }
  return baselines;
}

// Career-cumulative Legacy, but scoped PER DECADE: rings/MVPs/etc. earned within
// each decade, percentile-normalized against that decade's players. Used by the
// per-decade rankings so a player's 2020s entry reflects 2020s honors, not his
// whole career. Returns { [decadeKey]: { [player]: legacySubScores } }.
function computeDecadeLegacyScores(seasonData) {
  const measures = legacyMeasureNames();
  const byDecade = {};
  for (const s of seasonData) {
    const dk = seasonDecadeKey(s.season);
    if (dk == null || dk === PRE_1950_BUCKET) continue;
    if (!byDecade[dk]) byDecade[dk] = {};
    const pool = byDecade[dk];
    if (!pool[s.player_name]) {
      pool[s.player_name] = { player_name: s.player_name };
      for (const m of measures) pool[s.player_name][m] = 0;
    }
    const c = pool[s.player_name];
    for (const m of measures) {
      const v = s[m];
      if (v == null || isNaN(v) || !isFinite(v)) continue;
      if (LEGACY_MAX_MEASURES.has(m)) {
        if (v > c[m]) c[m] = v;
      } else {
        c[m] += v;
      }
    }
  }
  const out = {};
  for (const dk of Object.keys(byDecade)) {
    const arr = Object.values(byDecade[dk]);
    const bounds = computeCareerLegacyBounds(arr);
    // Drop legacy awards that didn't exist in this decade (e.g. Finals MVP in
    // the 1960s) so they don't contribute a flat, non-differentiating score.
    for (const m of measures) {
      if (!statTrackedInDecade(m, Number(dk))) bounds[m] = null;
    }
    out[dk] = {};
    for (const row of arr) {
      out[dk][row.player_name] = computeLegacySubScoresFor(row, bounds);
    }
  }
  return out;
}

// Shared Step 2 for the era paths: sub-category RMS → Legacy override → weighted
// RMS category → weighted RMS EI. `legacySubScores` is the (career or per-decade)
// Legacy override for this player. Returns null-safe scores + an eligibility flag.
function eraStep2(
  measureScores,
  categoryWeights,
  subCategoryWeights,
  groups,
  legacySubScores
) {
  const subCategoryScores = subCatScoresFromMeasureScores(measureScores);
  if (legacySubScores) {
    for (const sc of CATEGORY_GROUPS.Legacy ?? []) {
      if (legacySubScores[sc] !== undefined) {
        subCategoryScores[sc] = legacySubScores[sc];
      }
    }
  }
  const categoryGroupScores = {};
  for (const [group, subCats] of Object.entries(groups)) {
    const groupScores = {};
    for (const subCat of subCats) groupScores[subCat] = subCategoryScores[subCat];
    const hasAny = subCats.some((c) => subCategoryScores[c] != null);
    categoryGroupScores[group] = hasAny
      ? weightedRMS(groupScores, subCategoryWeights)
      : null;
  }
  // Eligible only if something the user actually weighted is available.
  const hasScorableWeighted = Object.entries(categoryGroupScores).some(
    ([g, sc]) => sc != null && (Number(categoryWeights?.[g]) || 0) > 0
  );
  const eiScore = weightedRMS(categoryGroupScores, categoryWeights);
  return { subCategoryScores, categoryGroupScores, eiScore, hasScorableWeighted };
}

// Per-measure sigmoid scores for a single SEASON vs its decade's baselines.
function measureScoresForSeason(season, decadeKey, eraBaselines) {
  const ms = {};
  for (const m of ERA_MEASURES) {
    const bounds = eraBaselines[decadeKey]?.[m];
    const sc = normalizeMeasureScore(season[m], bounds, MEASURE_DIRECTION[m]);
    if (sc != null) ms[m] = sc;
  }
  return ms;
}

const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

/**
 * By-Era EI. IDENTICAL pipeline to All-Time (normalize each SEASON → per-season
 * EI → average the per-season EIs); the ONLY change is the reference distribution
 * (per decade instead of global). Returns:
 *   - playerRankings: one "all eras" EI per player = average of his per-season
 *     EIs, each season normalized vs its own decade. Filtered by career games.
 *   - decadeRankings: { [decadeKey]: { players, allEIScores } } — a SEPARATE
 *     ranking per decade; a player's decade EI = average of his per-season EIs
 *     in that decade. A player appears in every decade where his total games
 *     reached ERA_DECADE_GAMES_FLOOR.
 *
 * Same base signature/return keys as computeEIScoresHierarchical so the page can
 * swap compute paths freely. `opts.topYears` applies the same best-consecutive
 * window to the "all eras" career roll-up as All-Time mode (default "all" =
 * average every season). The per-decade rankings always average the full decade.
 */
export function computeEIScoresByEra(
  seasonData,
  categoryWeights,
  subCategoryWeights,
  opts = {}
) {
  const { minGames = 0, categoryGroups, topYears = "all" } = opts;
  const groups = categoryGroups ?? CATEGORY_GROUPS;
  const gated = applyShootingEfficiencyDecadeGates(seasonData);
  const careerLegacy = computeCareerLegacyScores(gated);
  const decadeLegacy = computeDecadeLegacyScores(gated);

  // Group each player's seasons by decade, tracking total games per decade.
  const byPlayer = new Map(); // name → Map(decadeKey → { seasons[], games, minutes })
  for (const s of gated) {
    const dk = seasonDecadeKey(s.season);
    if (dk == null || dk === PRE_1950_BUCKET) continue; // excluded by default
    if (!byPlayer.has(s.player_name)) byPlayer.set(s.player_name, new Map());
    const decades = byPlayer.get(s.player_name);
    if (!decades.has(dk)) decades.set(dk, { seasons: [], games: 0, minutes: 0 });
    const bucket = decades.get(dk);
    bucket.seasons.push(s);
    bucket.games += Number(s.games) || 0;
    bucket.minutes += Number(s.minutes_total) || 0;
  }

  // Decade distribution = the SEASONS of players who cleared the games floor in
  // that decade. Below the floor, none of the player's seasons enter the pool.
  const seasonsByDecade = new Map();
  for (const decades of byPlayer.values()) {
    for (const [dk, bucket] of decades) {
      if (bucket.games < ERA_DECADE_GAMES_FLOOR) continue;
      if (!seasonsByDecade.has(dk)) seasonsByDecade.set(dk, []);
      for (const s of bucket.seasons) seasonsByDecade.get(dk).push(s);
    }
  }
  const eraBaselines = computeEraBaselines(seasonsByDecade);

  const decadeBuckets = new Map(); // decadeKey → array of ranking entries
  const playerRankings = [];
  const allEIScores = [];

  for (const [name, decades] of byPlayer) {
    let totalGames = 0;
    let totalMinutes = 0;
    const minutesByDecade = {};
    for (const [dk, bucket] of decades) {
      totalGames += bucket.games;
      totalMinutes += bucket.minutes;
      minutesByDecade[dk] = bucket.minutes;
    }
    let primaryDecade = null;
    let bestMin = -Infinity;
    for (const [dk, mins] of Object.entries(minutesByDecade)) {
      if (mins > bestMin) {
        bestMin = mins;
        primaryDecade = Number(dk);
      }
    }

    // ── (1) "All eras": per-season EIs across the whole career, each season
    //        normalized vs its own decade (career-cumulative Legacy). The best
    //        consecutive `topYears` window is then averaged, exactly like the
    //        All-Time path (default "all" → average every season). Keep the
    //        real per-season objects in selectedSeasons/allSeasons so charts
    //        (overlay / curves over seasons) can plot the full career path. ──
    const careerSeasons = [];
    for (const [dk, bucket] of decades) {
      for (const s of bucket.seasons) {
        const step = eraStep2(
          measureScoresForSeason(s, dk, eraBaselines),
          categoryWeights,
          subCategoryWeights,
          groups,
          careerLegacy[name]
        );
        if (!step.hasScorableWeighted) continue;
        careerSeasons.push({
          player_name: name,
          season: s.season,
          games: s.games,
          eiScore: step.eiScore,
          categoryScores: step.subCategoryScores,
          categoryGroupScores: step.categoryGroupScores,
        });
      }
    }
    if (careerSeasons.length > 0) {
      const { selectedSeasons, careerEI } = pickBestSlidingWindow(
        careerSeasons,
        topYears
      );
      allEIScores.push(careerEI);
      playerRankings.push({
        player_name: name,
        careerEI,
        peakEI: Math.min(...careerSeasons.map((x) => x.eiScore)),
        totalSeasons: careerSeasons.length,
        totalGames,
        totalMinutes,
        minutesByDecade,
        primaryDecade,
        selectedSeasons,
        allSeasons: careerSeasons,
      });
    }

    // ── (2) Per-decade: average per-season EIs within each qualifying decade,
    //        each season normalized vs that decade (per-decade Legacy). Store
    //        the real per-season scores so decade graphics can plot a curve. ─
    for (const [dk, bucket] of decades) {
      if (bucket.games < ERA_DECADE_GAMES_FLOOR) continue;
      const decSeasons = [];
      for (const s of bucket.seasons) {
        const step = eraStep2(
          measureScoresForSeason(s, dk, eraBaselines),
          categoryWeights,
          subCategoryWeights,
          groups,
          decadeLegacy[dk]?.[name]
        );
        if (!step.hasScorableWeighted) continue;
        decSeasons.push({
          player_name: name,
          season: s.season,
          games: s.games,
          eiScore: step.eiScore,
          categoryScores: step.subCategoryScores,
          categoryGroupScores: step.categoryGroupScores,
        });
      }
      if (decSeasons.length === 0) continue;

      const decadeEI = mean(decSeasons.map((x) => x.eiScore));
      if (!decadeBuckets.has(dk)) decadeBuckets.set(dk, []);
      decadeBuckets.get(dk).push({
        player_name: name,
        careerEI: decadeEI,
        peakEI: Math.min(...decSeasons.map((x) => x.eiScore)),
        totalSeasons: decSeasons.length,
        totalGames: bucket.games,
        totalMinutes: bucket.minutes,
        minutesByDecade,
        primaryDecade: dk, // the decade this entry represents
        selectedSeasons: decSeasons,
        allSeasons: decSeasons,
      });
    }
  }

  const filtered =
    minGames > 0
      ? playerRankings.filter((p) => p.totalGames >= minGames)
      : playerRankings;

  filtered.sort((a, b) => a.careerEI - b.careerEI);

  const decadeRankings = {};
  for (const [dk, entries] of decadeBuckets) {
    entries.sort((a, b) => a.careerEI - b.careerEI);
    decadeRankings[dk] = {
      players: entries,
      allEIScores: entries.map((e) => e.careerEI),
    };
  }

  return {
    decadeRankings,
    playerRankings: filtered,
    seasonScores: [],
    allEIScores,
    measureBounds: null,
    eraBaselines,
  };
}
