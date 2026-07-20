"""League-wide distribution analysis + normalization recommendations."""

from __future__ import annotations

from typing import Iterable, Optional

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
from scipy import stats as sps

from .config import OUTPUT_DIR
from .load import era_bucket


def _skewness(s: pd.Series) -> float:
    v = s.dropna()
    if len(v) < 8:
        return float("nan")
    return float(sps.skew(v, bias=False))


def recommend_normalization(skew: float) -> str:
    """
    Heuristic: |skew| < 0.75 → z-score; else log1p + z-score (counts) or
    percentile rank (bounded rates).
    """
    if np.isnan(skew):
        return "insufficient_data"
    if abs(skew) < 0.75:
        return "z_score"
    return "log1p_z_score_or_percentile_rank"


def league_distribution_table(
    season_df: pd.DataFrame,
    p90_cols: Iterable[str],
) -> pd.DataFrame:
    """Describe each per-90 season-level stat across qualifying player-seasons."""
    rows = []
    for col in p90_cols:
        if col not in season_df.columns:
            continue
        s = pd.to_numeric(season_df[col], errors="coerce").dropna()
        sk = _skewness(s)
        rows.append(
            {
                "stat": col,
                "n": len(s),
                "mean": float(s.mean()) if len(s) else np.nan,
                "std": float(s.std(ddof=1)) if len(s) > 1 else np.nan,
                "median": float(s.median()) if len(s) else np.nan,
                "skewness": sk,
                "shape": (
                    "roughly_symmetric"
                    if abs(sk) < 0.75
                    else ("right_skewed" if sk >= 0.75 else "left_skewed")
                ),
                "normalization": recommend_normalization(sk),
            }
        )
    out = pd.DataFrame(rows)
    out.to_csv(OUTPUT_DIR / "normalization_recommendations.csv", index=False)
    return out


def plot_stat_distributions(
    season_df: pd.DataFrame,
    p90_cols: Iterable[str],
    max_plots: int = 12,
) -> None:
    """Histogram + KDE for each per-90 season-level stat."""
    plot_dir = OUTPUT_DIR / "plots"
    plot_dir.mkdir(exist_ok=True)
    sns.set_theme(style="darkgrid")

    for i, col in enumerate(p90_cols):
        if i >= max_plots:
            break
        if col not in season_df.columns:
            continue
        s = pd.to_numeric(season_df[col], errors="coerce").dropna()
        if len(s) < 20:
            continue
        fig, ax = plt.subplots(figsize=(7, 4))
        sns.histplot(s, bins=40, kde=True, stat="density", ax=ax, color="#5b9cf6")
        ax.set_title(f"{col} — player-seasons (≥900′)\nskew={_skewness(s):.2f}")
        ax.set_xlabel(col)
        fig.tight_layout()
        fig.savefig(plot_dir / f"dist_{col}.png", dpi=120)
        plt.close(fig)


def drift_by_era(
    season_df: pd.DataFrame,
    p90_cols: Iterable[str],
) -> pd.DataFrame:
    """Mean/std of each per-90 stat by 5-year era bucket."""
    work = season_df.copy()
    work["era"] = work["season"].map(era_bucket)
    rows = []
    for col in p90_cols:
        if col not in work.columns:
            continue
        for era, g in work.groupby("era"):
            if era is None:
                continue
            s = pd.to_numeric(g[col], errors="coerce").dropna()
            if s.empty:
                continue
            rows.append(
                {
                    "stat": col,
                    "era": era,
                    "n": len(s),
                    "mean": float(s.mean()),
                    "std": float(s.std(ddof=1)) if len(s) > 1 else 0.0,
                    "median": float(s.median()),
                }
            )
    out = pd.DataFrame(rows)
    out.to_csv(OUTPUT_DIR / "drift_by_era.csv", index=False)
    return out


def drift_by_competition(
    season_df: pd.DataFrame,
    p90_cols: Iterable[str],
) -> pd.DataFrame:
    """Mean/std of each per-90 stat by competition."""
    if "competition" not in season_df.columns:
        return pd.DataFrame()
    rows = []
    for col in p90_cols:
        if col not in season_df.columns:
            continue
        for comp, g in season_df.groupby("competition"):
            s = pd.to_numeric(g[col], errors="coerce").dropna()
            if s.empty:
                continue
            rows.append(
                {
                    "stat": col,
                    "competition": comp,
                    "n": len(s),
                    "mean": float(s.mean()),
                    "std": float(s.std(ddof=1)) if len(s) > 1 else 0.0,
                    "median": float(s.median()),
                }
            )
    out = pd.DataFrame(rows)
    out.to_csv(OUTPUT_DIR / "drift_by_competition.csv", index=False)
    return out


def plot_era_drift(
    drift: pd.DataFrame,
    stats: Optional[Iterable[str]] = None,
) -> None:
    """Line charts of league mean over eras for selected stats."""
    if drift.empty:
        return
    plot_dir = OUTPUT_DIR / "plots"
    plot_dir.mkdir(exist_ok=True)
    stats = list(stats) if stats else sorted(drift["stat"].unique())[:8]
    for col in stats:
        sub = drift[drift["stat"] == col].sort_values("era")
        if sub.empty:
            continue
        fig, ax = plt.subplots(figsize=(7, 3.5))
        ax.plot(sub["era"], sub["mean"], marker="o", color="#5b9cf6", label="mean")
        ax.fill_between(
            sub["era"],
            sub["mean"] - sub["std"],
            sub["mean"] + sub["std"],
            alpha=0.15,
            color="#5b9cf6",
        )
        ax.set_title(f"League drift — {col}")
        ax.set_xlabel("Era")
        ax.tick_params(axis="x", rotation=30)
        fig.tight_layout()
        fig.savefig(plot_dir / f"drift_{col}.png", dpi=120)
        plt.close(fig)
