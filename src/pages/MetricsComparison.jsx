import { useState, useCallback, useMemo, useEffect } from "react";
import Select from "react-select";
import Plotly from "plotly.js-dist-min";
import factoryModule from "react-plotly.js/factory";
import { PLAYER_COLORS } from "../lib/supabase";
import { ALL_PLAYERS } from "../lib/players";
import {
  CATEGORY_GROUPS,
  MIN_GAMES_ALL_PLAYERS,
  CATEGORIES,
  DEFAULT_CATEGORY_WEIGHTS,
  DEFAULT_SUBCATEGORY_WEIGHTS,
  fetchAllPlayersSeasonAverages,
  computeEIScoresHierarchical,
  assignDisplayRanks,
} from "../lib/eiComputation";
import "./DiscoverGoat.css";
import "./CreateGoatRanking.css";
import "./MetricsComparison.css";

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
  multiValue: (base) => ({ ...base, borderRadius: 4, background: "#1f2537" }),
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

const CATEGORY_INFO = {
  "Scoring Production": {
    summary: "Measures overall offensive output per season",
    metrics: ["Points per game", "Points per 36 minutes", "Game Score mean"],
    calculation: "Each metric is sigmoid-normalized using league-wide 10th and 90th percentile bounds. The category score is the Root Mean Square (RMS) of the normalized metrics. Lower score = better scorer.",
    direction: "Higher raw values are better",
  },
  "Minutes Load": {
    summary: "Measures total playing time contribution",
    metrics: ["Total minutes in season", "Minutes per game"],
    calculation: "Sigmoid normalization on each metric, then RMS aggregation. Rewards players who log heavy minutes consistently.",
    direction: "Higher raw values are better",
  },
  "Games Played": {
    summary: "Availability and durability in a season",
    metrics: ["Games played"],
    calculation: "Single metric, sigmoid-normalized. Rewards players who suit up for more games.",
    direction: "Higher raw values are better",
  },
  "Total Rebounding": {
    summary: "Overall rebounding ability",
    metrics: ["Rebounds per game", "Rebounds per 36 minutes"],
    calculation: "RMS of sigmoid-normalized metrics. Captures both volume and rate.",
    direction: "Higher raw values are better",
  },
  "Offensive Rebounding": {
    summary: "Ability to grab offensive boards",
    metrics: ["Offensive rebounds per game", "Offensive rebounds per 36 minutes"],
    calculation: "RMS of sigmoid-normalized metrics.",
    direction: "Higher raw values are better",
  },
  "Defensive Rebounding": {
    summary: "Ability to secure defensive rebounds",
    metrics: ["Defensive rebounds per game", "Defensive rebounds per 36 minutes"],
    calculation: "RMS of sigmoid-normalized metrics.",
    direction: "Higher raw values are better",
  },
  Assists: {
    summary: "Playmaking and ball distribution",
    metrics: ["Assists per game", "Assists per 36 minutes", "Assist-to-Turnover ratio"],
    calculation: "RMS of three sigmoid-normalized metrics. Rewards both volume passing and efficiency of passing (low turnovers relative to assists).",
    direction: "Higher raw values are better",
  },
  Steals: {
    summary: "Ball-hawking ability on defense",
    metrics: ["Steals per game", "Steals per 36 minutes"],
    calculation: "RMS of sigmoid-normalized metrics.",
    direction: "Higher raw values are better",
  },
  Blocks: {
    summary: "Shot-blocking ability",
    metrics: ["Blocks per game", "Blocks per 36 minutes"],
    calculation: "RMS of sigmoid-normalized metrics.",
    direction: "Higher raw values are better",
  },
  "Defensive Activity": {
    summary: "Combined defensive disruption (stocks = steals + blocks)",
    metrics: ["Stocks per game", "Stocks per 36 minutes"],
    calculation: "RMS of sigmoid-normalized metrics. Stocks combine steals and blocks into a single defensive activity measure.",
    direction: "Higher raw values are better",
  },
  "Foul Discipline": {
    summary: "Ability to defend without fouling excessively",
    metrics: ["Personal fouls per game", "Personal fouls per 36 minutes"],
    calculation: "RMS of sigmoid-normalized metrics. Direction is inverted: fewer fouls means a better (lower) category score.",
    direction: "Lower raw values are better (fewer fouls)",
  },
  "True Shooting Efficiency": {
    summary: "Overall shooting efficiency accounting for all shot types",
    metrics: ["True Shooting % = PTS / (2 × (FGA + 0.44 × FTA))"],
    calculation: "Single metric, sigmoid-normalized. TS% is the gold standard for shooting efficiency.",
    direction: "Higher raw values are better",
  },
  "Field Goal Efficiency": {
    summary: "Shooting accuracy from the field",
    metrics: ["Field Goal %", "Effective FG% = (FGM + 0.5 × 3PM) / FGA"],
    calculation: "RMS of sigmoid-normalized FG% and eFG%. The eFG% rewards three-point shooting.",
    direction: "Higher raw values are better",
  },
  "Three-Point Shooting": {
    summary: "Three-point accuracy and volume",
    metrics: ["Three-Point %", "Three-pointers made per game"],
    calculation: "RMS of sigmoid-normalized metrics. Combines accuracy with volume.",
    direction: "Higher raw values are better",
  },
  "Free Throw Shooting": {
    summary: "Accuracy from the free throw line",
    metrics: ["Free Throw %"],
    calculation: "Single metric, sigmoid-normalized.",
    direction: "Higher raw values are better",
  },
  "Turnover Control": {
    summary: "Ability to take care of the ball",
    metrics: ["Turnovers per game", "Turnovers per 36 minutes"],
    calculation: "RMS of sigmoid-normalized metrics. Direction is inverted: fewer turnovers means a better (lower) category score.",
    direction: "Lower raw values are better (fewer turnovers)",
  },
  Consistency: {
    summary: "How stable performance is game to game",
    metrics: ["Points coefficient of variation (CV)", "Game Score CV"],
    calculation: "RMS of sigmoid-normalized CVs. CV = standard deviation / mean. Lower CV means the player performs more consistently night to night.",
    direction: "Lower raw values are better (less variation)",
  },
  "Bad-Game Rate": {
    summary: "Frequency of poor performances",
    metrics: ["% of games with Game Score < 5"],
    calculation: "Single metric, sigmoid-normalized, inverted. A player with fewer bad games gets a better score.",
    direction: "Lower raw values are better (fewer bad games)",
  },
  "Plus-Minus Impact": {
    summary: "Net impact on team scoring margin when on court",
    metrics: ["Plus/Minus per game", "Plus/Minus per 36 minutes"],
    calculation: "RMS of sigmoid-normalized metrics. Positive +/- means the team outscores opponents with this player on court.",
    direction: "Higher raw values are better",
  },
  "Playoff Production": {
    summary: "Overall output in playoff games",
    metrics: ["Playoff games", "Playoff PPG", "Playoff RPG", "Playoff APG", "Playoff Game Score mean"],
    calculation: "RMS of five sigmoid-normalized metrics. Rewards both reaching playoffs (games) and performing at high level.",
    direction: "Higher raw values are better",
  },
  "Playoff Efficiency": {
    summary: "Shooting efficiency in playoff games",
    metrics: ["Playoff TS%", "Playoff eFG%", "Playoff FT%"],
    calculation: "RMS of three sigmoid-normalized metrics. Measures if a player maintains or elevates efficiency in high-pressure games.",
    direction: "Higher raw values are better",
  },
  "Playoff Consistency": {
    summary: "Stability of performance in playoffs",
    metrics: ["Playoff bad-game rate", "Playoff Game Score CV"],
    calculation: "RMS of sigmoid-normalized metrics, inverted. Rewards players who avoid poor playoff performances.",
    direction: "Lower raw values are better (fewer bad playoff games)",
  },
  "Awards Recognition": {
    summary: "Individual league recognition and honors",
    metrics: [
      "MVP (nba_most_valuable_player)",
      "All-NBA team selection",
      "All-Defensive team selection",
      "All-Star appearance",
      "Defensive Player of the Year",
      "Player of the Month",
      "Olympic gold medals (career total)",
      "Hall of Fame inductee (career)",
    ],
    calculation: "Each season takes the max value of every award column across that season's rows. The eight measures are sigmoid-normalized league-wide then combined via RMS, so a season with multiple honors lowers the EI further.",
    direction: "Higher raw values are better",
  },
  "Championship Success": {
    summary: "Team success — rings and Finals impact",
    metrics: [
      "NBA Champion (nba_champion)",
      "Finals MVP (nba_finals_most_valuable_player)",
    ],
    calculation: "Two season-level flags, sigmoid-normalized and combined via RMS. Title seasons (especially with a Finals MVP) drive EI sharply lower.",
    direction: "Higher raw values are better",
  },
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

function categoryColorStyle(colorIndex) {
  const c = getCategoryColor(colorIndex);
  return {
    "--cat-color": c.main,
    "--cat-soft": c.soft,
    "--cat-border": c.border,
    "--cat-glow": c.glow,
  };
}

const CATEGORY_GROUP_ORDER = Object.keys(CATEGORY_GROUPS);

const CATEGORY_TO_GROUP_INDEX = (() => {
  const map = {};
  CATEGORY_GROUP_ORDER.forEach((group, idx) => {
    for (const cat of CATEGORY_GROUPS[group]) map[cat] = idx;
  });
  return map;
})();

function InfoTooltip({ category }) {
  const [show, setShow] = useState(false);
  const info = CATEGORY_INFO[category];
  if (!info) return null;

  return (
    <span className="info-tooltip-wrapper">
      <span className="info-icon" onClick={() => setShow(!show)}>
        i
      </span>
      {show && (
        <div className="info-popup-overlay" onClick={() => setShow(false)}>
          <div className="info-popup" onClick={(e) => e.stopPropagation()}>
            <div className="info-popup-header">
              <h4>{category}</h4>
              <button
                className="info-popup-close"
                onClick={() => setShow(false)}
              >
                &times;
              </button>
            </div>
            <p className="info-popup-summary">{info.summary}</p>
            <div className="info-popup-section">
              <span className="info-popup-label">Metrics used:</span>
              <ul className="info-popup-list">
                {info.metrics.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
            <div className="info-popup-section">
              <span className="info-popup-label">Calculation:</span>
              <p className="info-popup-text">{info.calculation}</p>
            </div>
            <div className="info-popup-section">
              <span className="info-popup-label">Direction:</span>
              <p className="info-popup-text info-popup-direction">
                {info.direction}
              </p>
            </div>
          </div>
        </div>
      )}
    </span>
  );
}

function WeightSlider({ category, value, share, onChange }) {
  return (
    <div className="builder-sub">
      <div className="builder-sub-row">
        <span className="builder-sub-name">
          {category}
          <InfoTooltip category={category} />
        </span>
        <span className="builder-sub-share">
          {(share * 100).toFixed(1)}%
        </span>
      </div>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={value}
        onChange={(e) => onChange(category, parseFloat(e.target.value))}
        className="weight-slider-input builder-sub-slider"
      />
    </div>
  );
}

function PlayerCard({ player, allEIScores, totalPlayers, onClose }) {
  if (!player) return null;

  const bestSeason = player.allSeasons.reduce(
    (best, s) => (s.eiScore < best.eiScore ? s : best),
    player.allSeasons[0]
  );

  const playerEI = player.peakEI;
  const percentile =
    allEIScores.length > 0
      ? ((allEIScores.filter((s) => s > playerEI).length / allEIScores.length) * 100).toFixed(1)
      : 0;

  const rank = player._rank || "—";

  // Category percentiles: for each category, what % of all player-seasons score worse (higher)
  const catPercentiles = {};
  for (const [catName] of Object.entries(CATEGORIES)) {
    const score = bestSeason.categoryScores?.[catName];
    if (score == null) {
      catPercentiles[catName] = null;
      continue;
    }
    catPercentiles[catName] = score != null ? (1 - score) * 100 : null;
  }

  // Group-level percentiles: average of category percentiles in the group
  const groupPercentiles = {};
  for (const [group, cats] of Object.entries(CATEGORY_GROUPS)) {
    const vals = cats
      .map((c) => catPercentiles[c])
      .filter((v) => v != null);
    groupPercentiles[group] =
      vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }

  // dEI distribution for the top chart
  const sortedEI = [...allEIScores].sort((a, b) => a - b);
  const median =
    sortedEI.length > 0
      ? sortedEI[Math.floor(sortedEI.length * 0.5)]
      : 0.5;

  const groupBarColors = CATEGORY_GROUP_ORDER.map(
    (_, i) => getCategoryColor(i).main
  );

  const subBarColors = Object.keys(catPercentiles).map(
    (catName) =>
      getCategoryColor(CATEGORY_TO_GROUP_INDEX[catName] ?? 0).main
  );

  return (
    <div className="player-card-overlay" onClick={onClose}>
      <div className="player-card" onClick={(e) => e.stopPropagation()}>
        <div className="player-card-header">
          <h3>
            EI Framework: {player.player_name} · Best Season (
            {bestSeason.season})
          </h3>
          <button className="player-card-close" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="player-card-top">
          <div className="player-card-info-box">
            <div className="info-line">
              <strong>Best Season:</strong> {bestSeason.season}
            </div>
            <div className="info-line">
              <strong>EI:</strong> {playerEI.toFixed(3)}
            </div>
            <div className="info-line">
              <strong>EI Percentile:</strong> {percentile}th
            </div>
            <div className="info-line">
              <strong>Rank:</strong> {rank}/{totalPlayers}
            </div>
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
                  line: { color: "#4a7fff", width: 1.5, dash: "dash" },
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
                    color: "#4a7fff",
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
                  title: { text: "Percentile", font: { size: 9, color: "#565d72" } },
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
                  title: { text: "Percentile", font: { size: 9, color: "#565d72" } },
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

function LeagueDistributionChart({ seasonScores, topYears }) {
  const seasonStats = useMemo(() => {
    if (!seasonScores || seasonScores.length === 0) return null;

    const bySeason = {};
    for (const s of seasonScores) {
      if (!bySeason[s.season]) bySeason[s.season] = [];
      bySeason[s.season].push(s.eiScore);
    }

    const seasons = Object.keys(bySeason).sort();
    const medians = [];
    const p25 = [];
    const p75 = [];
    const p10 = [];
    const p90 = [];

    for (const season of seasons) {
      const vals = bySeason[season].sort((a, b) => a - b);
      const n = vals.length;
      medians.push(vals[Math.floor(n * 0.5)]);
      p25.push(vals[Math.floor(n * 0.25)]);
      p75.push(vals[Math.floor(n * 0.75)]);
      p10.push(vals[Math.floor(n * 0.1)]);
      p90.push(vals[Math.floor(n * 0.9)]);
    }

    return { seasons, medians, p25, p75, p10, p90 };
  }, [seasonScores]);

  if (!seasonStats) return null;

  const windowLabel =
    topYears.value === "all" ? "All Seasons" : `${topYears.value}-Year Window`;

  return (
    <div className="result-card">
      <h3 className="result-card-title">
        League-Wide dEI Distribution · {windowLabel}
      </h3>
      <Plot
        data={[
          // Layer 1 (back): 10th–90th pct band
          {
            type: "scatter",
            mode: "lines",
            x: seasonStats.seasons,
            y: seasonStats.p10,
            line: { width: 0 },
            showlegend: false,
            hoverinfo: "skip",
          },
          {
            type: "scatter",
            mode: "lines",
            x: seasonStats.seasons,
            y: seasonStats.p90,
            fill: "tonexty",
            fillcolor: "rgba(180,210,255,0.15)",
            line: { width: 0 },
            name: "10th–90th pct",
            showlegend: true,
            hoverinfo: "skip",
          },
          // Layer 2 (middle): IQR band
          {
            type: "scatter",
            mode: "lines",
            x: seasonStats.seasons,
            y: seasonStats.p25,
            line: { width: 0 },
            showlegend: false,
            hoverinfo: "skip",
          },
          {
            type: "scatter",
            mode: "lines",
            x: seasonStats.seasons,
            y: seasonStats.p75,
            fill: "tonexty",
            fillcolor: "rgba(130,180,255,0.25)",
            line: { width: 0 },
            name: "IQR",
            showlegend: true,
            hoverinfo: "skip",
          },
          // Layer 3 (front): Median line
          {
            type: "scatter",
            mode: "lines",
            x: seasonStats.seasons,
            y: seasonStats.medians,
            line: { color: "#5B9CF6", width: 2 },
            name: "Median",
            showlegend: true,
          },
        ]}
        layout={{
          paper_bgcolor: "transparent",
          plot_bgcolor: "rgba(20,24,33,0.6)",
          font: { family: "Inter, sans-serif", size: 11, color: "#8b92a5" },
          xaxis: {
            title: { text: "Season", font: { size: 11, color: "#565d72" } },
            gridcolor: "rgba(255,255,255,0.30)",
            tickangle: -45,
            tickfont: { size: 9 },
          },
          yaxis: {
            title: { text: "dEI", font: { size: 11, color: "#565d72" } },
            gridcolor: "rgba(255,255,255,0.30)",
          },
          legend: {
            font: { color: "#8b92a5", size: 10 },
            bgcolor: "transparent",
            x: 1,
            xanchor: "right",
            y: 1,
          },
          margin: { t: 20, r: 30, b: 70, l: 50 },
          height: 360,
        }}
        config={{ responsive: true, displayModeBar: false }}
        style={{ width: "100%" }}
      />
    </div>
  );
}

export default function MetricsComparison() {
  const [playerMode, setPlayerMode] = useState("all");
  const [selectedPlayers, setSelectedPlayers] = useState([]);
  // Top-level category weights (Volume, Rebounding, ...). Constrained to sum to 1
  // by normalization at compute time; raw slider values are kept here.
  const [categoryWeights, setCategoryWeights] = useState(() => ({
    ...DEFAULT_CATEGORY_WEIGHTS,
  }));
  // Sub-category weights within each category (Scoring Production, ...).
  const [subCategoryWeights, setSubCategoryWeights] = useState(() => ({
    ...DEFAULT_SUBCATEGORY_WEIGHTS,
  }));
  const [topYears, setTopYears] = useState(TOP_YEARS_OPTIONS[0]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState(null);
  const [seasonData, setSeasonData] = useState(null);
  const [results, setResults] = useState(null);
  const [showGraphic, setShowGraphic] = useState(false);
  const [graphicMode, setGraphicMode] = useState("overlay");
  const [graphicTopN, setGraphicTopN] = useState(15);
  const [playerCard, setPlayerCard] = useState(null);

  const handleCategoryWeightChange = useCallback((category, value) => {
    setCategoryWeights((prev) => ({ ...prev, [category]: value }));
  }, []);

  const handleSubCategoryWeightChange = useCallback((subCategory, value) => {
    setSubCategoryWeights((prev) => ({ ...prev, [subCategory]: value }));
  }, []);

  // Category weights normalized so they sum to exactly 1 (display + compute).
  const normalizedCategoryWeights = useMemo(() => {
    const entries = Object.entries(categoryWeights);
    const total = entries.reduce((s, [, v]) => s + (v || 0), 0);
    if (total <= 0) {
      const n = entries.length;
      return Object.fromEntries(entries.map(([k]) => [k, 1 / n]));
    }
    return Object.fromEntries(entries.map(([k, v]) => [k, (v || 0) / total]));
  }, [categoryWeights]);

  // Sub-category weights normalized to sum to 1 within each parent category.
  const normalizedSubCategoryWeights = useMemo(() => {
    const result = {};
    for (const [, subs] of Object.entries(CATEGORY_GROUPS)) {
      const total = subs.reduce(
        (s, sub) => s + (subCategoryWeights[sub] || 0),
        0
      );
      if (total <= 0) {
        const n = subs.length;
        for (const sub of subs) result[sub] = 1 / n;
      } else {
        for (const sub of subs) {
          result[sub] = (subCategoryWeights[sub] || 0) / total;
        }
      }
    }
    return result;
  }, [subCategoryWeights]);

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
    setShowGraphic(false);
    setPlayerCard(null);

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

  // Recompute EI scores whenever weights, topYears, or seasonData changes.
  // In "All Players" mode we apply the same min-games gate as the other two
  // EI pages so all three rank identically given identical inputs.
  useEffect(() => {
    if (!seasonData || seasonData.length === 0) return;
    const minGames = playerMode === "all" ? MIN_GAMES_ALL_PLAYERS : 0;
    const eiResults = computeEIScoresHierarchical(
      seasonData,
      normalizedCategoryWeights,
      normalizedSubCategoryWeights,
      topYears.value,
      { minGames }
    );
    setResults(eiResults);
  }, [
    seasonData,
    normalizedCategoryWeights,
    normalizedSubCategoryWeights,
    topYears,
    playerMode,
  ]);

  const top15 = useMemo(() => {
    if (!results) return [];
    return assignDisplayRanks(results.playerRankings.slice(0, 15));
  }, [results]);

  const graphData = useMemo(() => {
    if (!results || !showGraphic) return null;

    const topPlayers = results.playerRankings
      .slice(0, graphicTopN)
      .map((p) => p.player_name);

    const traces = topPlayers.map((name, idx) => {
      const player = results.playerRankings.find(
        (p) => p.player_name === name
      );

      if (graphicMode === "overlay") {
        const chronological = [...player.selectedSeasons].sort((a, b) =>
          a.season.localeCompare(b.season)
        );
        return {
          type: "scatter",
          mode: "lines+markers",
          name,
          x: chronological.map((_, i) => i + 1),
          y: chronological.map((s) => s.eiScore),
          line: {
            color: PLAYER_COLORS[idx % PLAYER_COLORS.length],
            width: 2,
          },
          marker: { size: 4 },
        };
      }

      const seasons = [...player.selectedSeasons].sort((a, b) =>
        a.season.localeCompare(b.season)
      );
      return {
        type: "scatter",
        mode: "lines+markers",
        name,
        x: seasons.map((s) => s.season),
        y: seasons.map((s) => s.eiScore),
        line: {
          color: PLAYER_COLORS[idx % PLAYER_COLORS.length],
          width: 2,
        },
        marker: { size: 4 },
      };
    });

    return traces;
  }, [results, showGraphic, graphicTopN, graphicMode]);

  const graphXCategories = useMemo(() => {
    if (!results || !showGraphic || graphicMode !== "seasons") return null;

    const topPlayers = results.playerRankings.slice(0, graphicTopN);
    const allSeasons = new Set();
    for (const player of topPlayers) {
      for (const s of player.selectedSeasons) {
        allSeasons.add(s.season);
      }
    }
    return [...allSeasons].sort();
  }, [results, showGraphic, graphicTopN, graphicMode]);

  return (
    <div className="goat-page metrics-comparison-page">
      <div className="controls-panel">
        <h2 className="controls-title">NBA Metrics Player Comparison</h2>
        <p className="controls-description">
          Configure metric weights, select players, and choose a consecutive
          season window. Each player is ranked by their best stretch of that
          length (lowest mean EI). Lower is better.
        </p>

        <div className="goat-controls-layout">
          <div className="goat-left-controls">
            <div className="control-group">
              <label className="control-label">Player Selection</label>
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
                  filterOption={(option, input) =>
                    option.label.toLowerCase().includes(input.toLowerCase())
                  }
                />
              )}
            </div>

            <div className="control-group">
              <label className="control-label">Top Years Window</label>
              <Select
                options={TOP_YEARS_OPTIONS}
                value={topYears}
                onChange={setTopYears}
                styles={selectStyles}
              />
            </div>
          </div>

          <div className="goat-right-controls">
            <div className="weights-header">
              <label className="control-label">Category Weights</label>
              <span className="weights-hint-inline">
                Category weights sum to 1 · sub-category weights sum to 1
                within each category
              </span>
            </div>
            <div className="builder-grid">
              {CATEGORY_GROUP_ORDER.map((group, groupIdx) => {
                const cats = CATEGORY_GROUPS[group];
                const sharePct =
                  (normalizedCategoryWeights[group] || 0) * 100;
                return (
                  <div
                    key={group}
                    className="builder-category"
                    style={categoryColorStyle(groupIdx)}
                  >
                    <div className="builder-category-header">
                      <span className="builder-category-dot" aria-hidden />
                      <span className="builder-category-title">{group}</span>
                      <span className="builder-category-share">
                        {sharePct.toFixed(1)}%
                      </span>
                    </div>

                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={categoryWeights[group]}
                      onChange={(e) =>
                        handleCategoryWeightChange(
                          group,
                          parseFloat(e.target.value)
                        )
                      }
                      className="weight-slider-input weight-group-slider builder-cat-slider"
                    />

                    <div className="builder-subs">
                      {cats.map((catName) => (
                        <WeightSlider
                          key={catName}
                          category={catName}
                          value={subCategoryWeights[catName]}
                          share={normalizedSubCategoryWeights[catName]}
                          onChange={handleSubCategoryWeightChange}
                        />
                      ))}
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
            "Reload Data"
          ) : (
            "Analyze"
          )}
        </button>

        {error && <div className="error-banner">{error}</div>}
      </div>

      {results && (
        <div className="results-section">
          <LeagueDistributionChart
            seasonScores={results.seasonScores}
            topYears={topYears}
          />

          <div className="result-card">
            <div className="result-card-header">
              <div>
                <h3 className="result-card-title">
                  Ranking Best NBA Players
                </h3>
                <p className="result-card-subtitle">
                  Top 15 by career EI (lower = better)
                </p>
              </div>
              <button
                className="graphic-btn"
                onClick={() => setShowGraphic(!showGraphic)}
              >
                {showGraphic ? "Hide Graphic" : "Graphic"}
              </button>
            </div>

            {showGraphic && graphData && (
              <div className="graphic-section">
                <div className="graphic-controls">
                  <label className="control-label-inline">Show top</label>
                  <input
                    type="number"
                    min="1"
                    max="15"
                    value={graphicTopN}
                    onChange={(e) =>
                      setGraphicTopN(
                        Math.max(1, Math.min(15, parseInt(e.target.value) || 1))
                      )
                    }
                    className="graphic-input"
                  />
                  <label className="control-label-inline">players</label>
                  <div className="graphic-mode-toggle">
                    <button
                      className={`mode-btn ${graphicMode === "overlay" ? "mode-btn--active" : ""}`}
                      onClick={() => setGraphicMode("overlay")}
                    >
                      Overlay
                    </button>
                    <button
                      className={`mode-btn ${graphicMode === "seasons" ? "mode-btn--active" : ""}`}
                      onClick={() => setGraphicMode("seasons")}
                    >
                      Curves over seasons
                    </button>
                  </div>
                </div>
                <Plot
                  data={graphData}
                  layout={{
                    paper_bgcolor: "transparent",
                    plot_bgcolor: "rgba(20,24,33,0.6)",
                    font: {
                      family: "Inter, sans-serif",
                      size: 10,
                      color: "#8b92a5",
                    },
                    xaxis: {
                      gridcolor: "rgba(255,255,255,0.04)",
                      tickangle: graphicMode === "seasons" ? -45 : 0,
                      tickfont: { size: 9 },
                      title: {
                        text:
                          graphicMode === "overlay"
                            ? "Season #"
                            : "Season",
                        font: { size: 10, color: "#565d72" },
                      },
                      dtick: graphicMode === "overlay" ? 1 : undefined,
                      type: graphicMode === "seasons" ? "category" : undefined,
                      categoryorder:
                        graphicMode === "seasons" ? "array" : undefined,
                      categoryarray:
                        graphicMode === "seasons"
                          ? graphXCategories
                          : undefined,
                    },
                    yaxis: {
                      gridcolor: "rgba(255,255,255,0.04)",
                      title: {
                        text: "EI Score",
                        font: { size: 11, color: "#565d72" },
                      },
                    },
                    legend: {
                      font: { color: "#8b92a5", size: 10 },
                      bgcolor: "transparent",
                      orientation: "h",
                      y: -0.3,
                    },
                    margin: { t: 20, r: 20, b: 80, l: 50 },
                    height: 400,
                  }}
                  config={{ responsive: true, displayModeBar: false }}
                  style={{ width: "100%" }}
                />
              </div>
            )}

            <div className="ranking-table-container">
              <table className="ranking-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Player</th>
                    <th>Career EI</th>
                    <th>Peak EI</th>
                    <th>Seasons</th>
                    <th>Games</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {top15.map((player) => (
                    <tr
                      key={player.player_name}
                      className={
                        player.displayRank === 1
                          ? "ranking-row--first"
                          : undefined
                      }
                    >
                      <td className="rank-cell">
                        {player.displayRank === 1 ? "👑" : player.displayRank}
                      </td>
                      <td className="name-cell">{player.player_name}</td>
                      <td className="score-cell">
                        {player.careerEI.toFixed(3)}
                      </td>
                      <td className="score-cell">
                        {player.peakEI.toFixed(3)}
                      </td>
                      <td className="num-cell">{player.totalSeasons}</td>
                      <td className="num-cell">{player.totalGames}</td>
                      <td className="action-cell">
                        <button
                          className="card-btn"
                          onClick={() =>
                            setPlayerCard({
                              ...player,
                              _rank: player.displayRank,
                            })
                          }
                        >
                          Player Card
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {playerCard && (
        <PlayerCard
          player={playerCard}
          allEIScores={results?.allEIScores || []}
          totalPlayers={results?.playerRankings.length || 0}
          onClose={() => setPlayerCard(null)}
        />
      )}
    </div>
  );
}
