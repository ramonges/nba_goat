import { useMemo } from "react";
import Plotly from "plotly.js-dist-min";
import factoryModule from "react-plotly.js/factory";
const createPlotlyComponent = factoryModule.default || factoryModule;
import { PLAYER_COLORS, STAT_COLUMNS } from "../lib/supabase";

const Plot = createPlotlyComponent(Plotly);

function kernelDensityEstimate(data, bandwidth, nPoints = 200) {
  if (data.length < 4) return { x: [], y: [] };

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const lo = min - range * 0.15;
  const hi = max + range * 0.15;
  const step = (hi - lo) / nPoints;

  const h =
    bandwidth ||
    1.06 * standardDeviation(data) * Math.pow(data.length, -0.2);
  if (h === 0) return { x: [], y: [] };

  const xOut = [];
  const yOut = [];

  for (let i = 0; i <= nPoints; i++) {
    const x = lo + i * step;
    let sum = 0;
    for (const xi of data) {
      const u = (x - xi) / h;
      sum += Math.exp(-0.5 * u * u) / Math.sqrt(2 * Math.PI);
    }
    xOut.push(x);
    yOut.push(sum / (data.length * h));
  }

  return { x: xOut, y: yOut };
}

function standardDeviation(arr) {
  const n = arr.length;
  if (n < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  const variance =
    arr.reduce((sum, val) => sum + (val - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance);
}

function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

const DARK_LAYOUT = {
  paper_bgcolor: "transparent",
  plot_bgcolor: "rgba(20,24,33,0.6)",
  font: {
    family: "Inter, -apple-system, sans-serif",
    size: 11,
    color: "#8b92a5",
  },
  xaxis: {
    gridcolor: "rgba(255,255,255,0.04)",
    zerolinecolor: "rgba(255,255,255,0.06)",
    tickfont: { color: "#565d72", size: 10 },
  },
  yaxis: {
    gridcolor: "rgba(255,255,255,0.04)",
    zerolinecolor: "rgba(255,255,255,0.06)",
    tickfont: { color: "#565d72", size: 10 },
  },
  legend: {
    font: { color: "#8b92a5", size: 11 },
    bgcolor: "transparent",
  },
};

export default function DistributionChart({ stat, playersData, viewMode }) {
  const label = STAT_COLUMNS[stat] || stat;

  const traces = useMemo(() => {
    const result = [];

    playersData.forEach((player, pIdx) => {
      const color = PLAYER_COLORS[pIdx % PLAYER_COLORS.length];

      if (viewMode === "career") {
        const values = player.data
          .map((g) => g[stat])
          .filter((v) => v != null && !isNaN(v));

        if (values.length === 0) return;

        result.push({
          type: "histogram",
          x: values,
          name: player.name,
          marker: {
            color,
            line: { color: "rgba(20,24,33,0.8)", width: 0.5 },
          },
          opacity: 0.5,
          histnorm: "probability density",
          nbinsx: 30,
          legendgroup: player.name,
        });

        if (values.length > 3) {
          const kde = kernelDensityEstimate(values);
          result.push({
            type: "scatter",
            mode: "lines",
            x: kde.x,
            y: kde.y,
            name: `${player.name} (KDE)`,
            line: { color, width: 2.5 },
            legendgroup: player.name,
            showlegend: false,
          });
        }

        const m = mean(values);
        const maxKde =
          values.length > 3
            ? Math.max(...kernelDensityEstimate(values).y)
            : 0;
        result.push({
          type: "scatter",
          mode: "lines",
          x: [m, m],
          y: [0, maxKde * 1.1 || 1],
          name: `${player.name} mean`,
          line: { color, width: 1.5, dash: "dot" },
          legendgroup: player.name,
          showlegend: false,
        });
      }
    });

    return result;
  }, [playersData, stat, viewMode]);

  const seasonTraces = useMemo(() => {
    if (viewMode !== "season") return null;

    const allSeasons = new Set();
    playersData.forEach((p) =>
      p.data.forEach((g) => allSeasons.add(g.season))
    );
    const seasons = [...allSeasons].sort();

    return { seasons, playersData };
  }, [playersData, viewMode]);

  if (viewMode === "career") {
    return (
      <div className="chart-card">
        <h3 className="chart-title">{label}</h3>
        <Plot
          data={traces}
          layout={{
            ...DARK_LAYOUT,
            barmode: "overlay",
            xaxis: { ...DARK_LAYOUT.xaxis, title: { text: label, font: { size: 11, color: "#565d72" } } },
            yaxis: { ...DARK_LAYOUT.yaxis, title: { text: "Density", font: { size: 11, color: "#565d72" } } },
            margin: { t: 16, r: 24, b: 48, l: 56 },
            legend: { ...DARK_LAYOUT.legend, orientation: "h", y: -0.22 },
            height: 360,
          }}
          config={{ responsive: true, displayModeBar: false }}
          style={{ width: "100%" }}
        />
        <div className="chart-stats-row">
          {playersData.map((player, pIdx) => {
            const values = player.data
              .map((g) => g[stat])
              .filter((v) => v != null && !isNaN(v));
            if (values.length === 0) return null;
            const m = mean(values);
            const sd = standardDeviation(values);
            const color = PLAYER_COLORS[pIdx % PLAYER_COLORS.length];
            return (
              <div
                key={player.name}
                className="chart-stat-pill"
                style={{ borderColor: color }}
              >
                <span
                  className="stat-player-dot"
                  style={{ background: color }}
                />
                <strong>{player.name}</strong>
                <span>μ {m.toFixed(1)}</span>
                <span>σ {sd.toFixed(1)}</span>
                <span>n {values.length}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (viewMode === "season" && seasonTraces) {
    const { seasons } = seasonTraces;
    const cols = 4;
    const rows = Math.ceil(seasons.length / cols);

    const subplotTraces = [];
    const annotations = [];

    seasons.forEach((season, sIdx) => {
      const xRef = sIdx === 0 ? "x" : `x${sIdx + 1}`;
      const yRef = sIdx === 0 ? "y" : `y${sIdx + 1}`;

      annotations.push({
        text: `<b>${season}</b>`,
        xref: `${xRef} domain`,
        yref: `${yRef} domain`,
        x: 0.5,
        y: 1.12,
        showarrow: false,
        font: { size: 10, color: "#8b92a5" },
      });

      playersData.forEach((player, pIdx) => {
        const color = PLAYER_COLORS[pIdx % PLAYER_COLORS.length];
        const seasonGames = player.data.filter((g) => g.season === season);
        const values = seasonGames
          .map((g) => g[stat])
          .filter((v) => v != null && !isNaN(v));

        if (values.length === 0) return;

        subplotTraces.push({
          type: "histogram",
          x: values,
          name: player.name,
          marker: {
            color,
            line: { color: "rgba(20,24,33,0.8)", width: 0.5 },
          },
          opacity: 0.5,
          histnorm: "probability density",
          nbinsx: 20,
          xaxis: xRef,
          yaxis: yRef,
          legendgroup: player.name,
          showlegend: sIdx === 0,
        });

        if (values.length > 3) {
          const kde = kernelDensityEstimate(values);
          subplotTraces.push({
            type: "scatter",
            mode: "lines",
            x: kde.x,
            y: kde.y,
            line: { color, width: 2 },
            xaxis: xRef,
            yaxis: yRef,
            legendgroup: player.name,
            showlegend: false,
          });
        }
      });
    });

    const subplotLayout = {
      ...DARK_LAYOUT,
      grid: {
        rows,
        columns: cols,
        pattern: "independent",
        ygap: 0.15,
        xgap: 0.08,
      },
      annotations,
      barmode: "overlay",
      margin: { t: 36, r: 16, b: 24, l: 36 },
      legend: { ...DARK_LAYOUT.legend, orientation: "h", y: -0.05 },
      height: rows * 200 + 60,
      showlegend: true,
    };

    return (
      <div className="chart-card">
        <h3 className="chart-title">{label} — Per Season</h3>
        <Plot
          data={subplotTraces}
          layout={subplotLayout}
          config={{ responsive: true, displayModeBar: false }}
          style={{ width: "100%" }}
        />
      </div>
    );
  }

  return null;
}
