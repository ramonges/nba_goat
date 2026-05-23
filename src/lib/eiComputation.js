import { supabase, TABLE_NAME } from "./supabase";

/**
 * EI Framework — 24 categories
 * Follows the notebook's exact 2-step transformation:
 *   Step 1: Sigmoid normalization (10th/90th percentile bounds → logistic → 0-1)
 *   Step 2: Category RMS + Weighted RMS
 * Result: EI ∈ [0, 1] where LOWER is BETTER (0 = GOAT)
 */

export const CATEGORY_GROUPS = {
  "Volume / Availability": [
    "Scoring Production",
    "Minutes Load",
    "Games Played",
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
  ],
  Stability: ["Consistency", "Bad-Game Rate"],
  Impact: ["Plus-Minus Impact"],
  Assists: ["Assists"],
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
    measures: [],
    direction: "higher",
  },
  "Championship Success": {
    measures: [],
    direction: "higher",
  },
};

const SIGMOID_ALPHA = 0.10;

const FETCH_COLS = [
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
].join(", ");

// ─── Data Fetching ───────────────────────────────────────────────────────────

export async function fetchPlayerSeasonAverages(playerName) {
  let allRows = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select(FETCH_COLS)
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

      return { player_name: playerName, season, games, ...measures };
    })
    .filter(Boolean);
}

// ─── EI Computation (2-step sigmoid transformation) ──────────────────────────

export function computeEIScores(seasonData, weights, topYears) {
  // Step 1: Compute percentile bounds for each measure (10th and 90th)
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

  // Sigmoid anchor points
  const x_c = -Math.log(1 / SIGMOID_ALPHA - 1); // ≈ -2.197
  const x_d = -Math.log(1 / (1 - SIGMOID_ALPHA) - 1); // ≈ 2.197

  // Step 2: Transform each measure to [0,1] using sigmoid, then compute EI
  const seasonScores = seasonData.map((s) => {
    const categoryScores = {};

    for (const [catName, cat] of Object.entries(CATEGORIES)) {
      if (cat.measures.length === 0) {
        categoryScores[catName] = null;
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
        let mHat = x_c + ((x_d - x_c) / span) * (val - minVal);
        mHat = Math.max(-50, Math.min(50, mHat)); // clip
        const mTilde = 1 / (1 + Math.exp(-mHat)); // sigmoid → [0,1]

        // Direction: for "higher is better" → score = 1 - mTilde (so top player → low score)
        // For "lower is better" → score = mTilde
        const score =
          cat.direction === "higher" ? 1 - mTilde : mTilde;

        transformedScores.push(score);
      }

      if (transformedScores.length === 0) {
        categoryScores[catName] = null;
      } else {
        // Category score = RMS of transformed measures (as in notebook)
        const rms = Math.sqrt(
          transformedScores.reduce((sum, v) => sum + v * v, 0) /
            transformedScores.length
        );
        categoryScores[catName] = rms;
      }
    }

    // Final EI = Weighted RMS of category scores
    let weightedSumSq = 0;
    let totalWeight = 0;

    for (const [catName, score] of Object.entries(categoryScores)) {
      const w = weights[catName] ?? 0;
      if (w === 0 || score === null) continue;
      weightedSumSq += w * score * score;
      totalWeight += w;
    }

    const ei = totalWeight > 0 ? Math.sqrt(weightedSumSq / totalWeight) : 1;

    return {
      ...s,
      categoryScores,
      eiScore: ei,
    };
  });

  // Group by player, apply top years (lowest EI seasons = best)
  const playerSeasons = {};
  for (const s of seasonScores) {
    if (!playerSeasons[s.player_name]) {
      playerSeasons[s.player_name] = [];
    }
    playerSeasons[s.player_name].push(s);
  }

  const playerRankings = [];

  for (const [name, seasons] of Object.entries(playerSeasons)) {
    // Sort ascending: lowest EI = best season
    const sorted = [...seasons].sort((a, b) => a.eiScore - b.eiScore);

    let selectedSeasons;
    if (topYears === "all" || topYears >= sorted.length) {
      selectedSeasons = sorted;
    } else {
      selectedSeasons = sorted.slice(0, topYears);
    }

    const careerEI =
      selectedSeasons.length > 0
        ? selectedSeasons.reduce((sum, s) => sum + s.eiScore, 0) /
          selectedSeasons.length
        : 1;

    const peakEI = sorted.length > 0 ? sorted[0].eiScore : 1;
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

  // Sort ascending: lowest careerEI = best player = rank 1
  playerRankings.sort((a, b) => a.careerEI - b.careerEI);

  const allEIScores = seasonScores.map((s) => s.eiScore);

  return {
    playerRankings,
    seasonScores,
    allEIScores,
    measureBounds,
  };
}
