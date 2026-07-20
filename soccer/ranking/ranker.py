"""Leaderboard builders: career, peak windows, decade, category."""

from __future__ import annotations

from typing import Optional

import numpy as np
import pandas as pd

from .config import PEAK_WINDOWS, SCORING_TREE


NOTE_CROSS_DECADE = (
    "ADJUSTED scores are comparable across decades by construction "
    "(normalized within era × competition-tier peer groups). "
    "RAW scores are absolute and NOT comparable across eras."
)


def _best_consecutive(seasons: pd.DataFrame, window: int) -> tuple[float, list[str], Optional[int]]:
    """
    Best mean `total` over `window` consecutive seasons (by season_start).
    Returns (score, season_list, peak_age_proxy=mid season_start).
    """
    s = seasons.sort_values("season_start")
    vals = s["total"].to_numpy(dtype=float)
    labels = s["season"].tolist()
    starts = s["season_start"].tolist()
    n = len(vals)
    if n == 0:
        return np.nan, [], None
    if window is None or window >= n:
        return float(np.nanmean(vals)), labels, starts[n // 2] if starts else None
    best = -np.inf
    best_i = 0
    for i in range(n - window + 1):
        m = float(np.mean(vals[i : i + window]))
        if m > best:
            best = m
            best_i = i
    peak_seasons = labels[best_i : best_i + window]
    peak_start = starts[best_i + window // 2]
    return best, peak_seasons, peak_start


def _career_base(
    season_scores: pd.DataFrame, mode: str, score_type: str
) -> pd.DataFrame:
    sub = season_scores[
        (season_scores["mode"] == mode) & (season_scores["score_type"] == score_type)
    ].copy()
    if sub.empty:
        return pd.DataFrame()
    rows = []
    for player, g in sub.groupby("player_name"):
        score, _, _ = _best_consecutive(g, window=None)
        rows.append(
            {
                "player_name": player,
                "player_slug": g["player_slug"].iloc[0],
                "score": score,
                "n_seasons": len(g),
                "minutes_total": float(g["minutes_total"].sum()),
                "data_tier": g["data_tier"].mode().iloc[0]
                if len(g["data_tier"].mode())
                else "B",
                "mode": mode,
                "score_type": score_type,
                "primary_decade": g["decade"].mode().iloc[0]
                if len(g["decade"].mode())
                else None,
            }
        )
    return pd.DataFrame(rows)


def _attach_raw_adjusted(base: pd.DataFrame, other: pd.DataFrame, score_col: str = "score") -> pd.DataFrame:
    """Merge raw + adjusted side by side and compute delta."""
    if base.empty:
        return base
    mode = base["mode"].iloc[0]
    out = base.copy()
    if other.empty:
        if mode == "adjusted":
            out = out.rename(columns={score_col: "adjusted_score"})
            out["raw_score"] = np.nan
        else:
            out = out.rename(columns={score_col: "raw_score"})
            out["adjusted_score"] = np.nan
        out["delta_adjusted_minus_raw"] = np.nan
        return out

    o = other[["player_name", score_col]].rename(columns={score_col: "_other"})
    out = out.merge(o, on="player_name", how="left")
    if mode == "adjusted":
        out = out.rename(columns={score_col: "adjusted_score", "_other": "raw_score"})
    else:
        out = out.rename(columns={score_col: "raw_score", "_other": "adjusted_score"})
    out["delta_adjusted_minus_raw"] = out["adjusted_score"] - out["raw_score"]
    return out


def rank_career(
    season_scores: pd.DataFrame,
    mode: str = "adjusted",
    score_type: str = "classic",
) -> pd.DataFrame:
    """
    Career aggregate = mean of qualifying season totals.
    Always returns raw_score, adjusted_score, and delta side by side.
    """
    primary = _career_base(season_scores, mode, score_type)
    other_mode = "raw" if mode == "adjusted" else "adjusted"
    other = _career_base(season_scores, other_mode, score_type)
    out = _attach_raw_adjusted(primary, other, score_col="score")
    if out.empty:
        return out
    sort_col = "adjusted_score" if mode == "adjusted" else "raw_score"
    out = out.sort_values(sort_col, ascending=False).reset_index(drop=True)
    out["rank"] = np.arange(1, len(out) + 1)
    out.attrs["note"] = NOTE_CROSS_DECADE
    return out


def _peak_base(
    season_scores: pd.DataFrame, window: str, mode: str, score_type: str
) -> pd.DataFrame:
    w = PEAK_WINDOWS.get(window)
    sub = season_scores[
        (season_scores["mode"] == mode) & (season_scores["score_type"] == score_type)
    ].copy()
    if sub.empty:
        return pd.DataFrame()
    rows = []
    for player, g in sub.groupby("player_name"):
        if w is not None and len(g) < w:
            score, seasons, peak_start = _best_consecutive(g, window=None)
        else:
            score, seasons, peak_start = _best_consecutive(g, window=w or 1)
        rows.append(
            {
                "player_name": player,
                "player_slug": g["player_slug"].iloc[0],
                "window": window,
                "score": score,
                "peak_seasons": ",".join(seasons) if isinstance(seasons, list) else seasons,
                "peak_season_start": peak_start,
                "n_seasons_used": len(seasons) if isinstance(seasons, list) else 0,
                "mode": mode,
                "score_type": score_type,
                "data_tier": g["data_tier"].mode().iloc[0]
                if len(g["data_tier"].mode())
                else "B",
            }
        )
    return pd.DataFrame(rows)


def rank_peak(
    season_scores: pd.DataFrame,
    window: str = "peak_5",
    mode: str = "adjusted",
    score_type: str = "classic",
) -> pd.DataFrame:
    """Leaderboard for a peak window key in PEAK_WINDOWS."""
    if window == "career":
        return rank_career(season_scores, mode=mode, score_type=score_type)

    primary = _peak_base(season_scores, window, mode, score_type)
    other_mode = "raw" if mode == "adjusted" else "adjusted"
    other = _peak_base(season_scores, window, other_mode, score_type)
    out = _attach_raw_adjusted(primary, other, score_col="score")
    if out.empty:
        return out
    sort_col = "adjusted_score" if mode == "adjusted" else "raw_score"
    out = out.sort_values(sort_col, ascending=False).reset_index(drop=True)
    out["rank"] = np.arange(1, len(out) + 1)
    out.attrs["note"] = NOTE_CROSS_DECADE
    return out


def _decade_base(
    season_scores: pd.DataFrame, decade: str, mode: str, score_type: str
) -> pd.DataFrame:
    sub = season_scores[
        (season_scores["mode"] == mode)
        & (season_scores["score_type"] == score_type)
        & (season_scores["decade"] == decade)
    ].copy()
    if sub.empty:
        return pd.DataFrame()
    return (
        sub.groupby(["player_name", "player_slug"], as_index=False)
        .agg(
            score=("total", "mean"),
            n_seasons=("season", "count"),
            minutes_total=("minutes_total", "sum"),
            data_tier=("data_tier", lambda s: s.mode().iloc[0] if len(s.mode()) else "B"),
        )
        .assign(decade=decade, mode=mode, score_type=score_type)
    )


def rank_decade(
    season_scores: pd.DataFrame,
    decade: str,
    mode: str = "adjusted",
    score_type: str = "classic",
    top_n: int = 10,
) -> pd.DataFrame:
    """
    Top-N in a decade by mean season composite within that decade.
    Primary sort is ADJUSTED when mode='adjusted'; RAW shown alongside.
    """
    primary = _decade_base(season_scores, decade, mode, score_type)
    other_mode = "raw" if mode == "adjusted" else "adjusted"
    other = _decade_base(season_scores, decade, other_mode, score_type)
    out = _attach_raw_adjusted(primary, other, score_col="score")
    if out.empty:
        return out
    sort_col = "adjusted_score" if mode == "adjusted" else "raw_score"
    out = out.sort_values(sort_col, ascending=False).head(top_n).reset_index(drop=True)
    out["rank"] = np.arange(1, len(out) + 1)
    out.attrs["note"] = NOTE_CROSS_DECADE
    return out


def rank_category(
    season_scores: pd.DataFrame,
    category: str,
    subcategory: Optional[str] = None,
    mode: str = "adjusted",
    score_type: str = "classic",
    window: str = "career",
) -> pd.DataFrame:
    """
    Leaderboard for one category (or subcategory) using the same window logic.
    """
    if category not in SCORING_TREE:
        raise ValueError(f"Unknown category {category!r}")

    col = f"cat_{category}" if subcategory is None else f"sub_{category}_{subcategory}"
    # subcategory keys were stored as sub_FINISHING_volume style
    if subcategory is not None:
        col = f"sub_{category}_{subcategory}"

    sub = season_scores[
        (season_scores["mode"] == mode) & (season_scores["score_type"] == score_type)
    ].copy()
    if col not in sub.columns:
        # try alternate key from scorer
        alt = f"sub_{category}.{subcategory}" if subcategory else col
        alt2 = f"sub_{category}_{subcategory}" if subcategory else col
        for c in (alt, alt2, col):
            if c in sub.columns:
                col = c
                break
        else:
            return pd.DataFrame()

    w = PEAK_WINDOWS.get(window)
    rows = []
    for player, g in sub.groupby("player_name"):
        # Use a dedicated metric column — never overwrite composite `total`.
        g2 = g[["season", "season_start", col]].dropna(subset=[col]).copy()
        if g2.empty:
            continue
        g2 = g2.rename(columns={col: "total"})
        if window == "career" or w is None:
            score, seasons, peak_start = _best_consecutive(g2, window=None)
        else:
            score, seasons, peak_start = _best_consecutive(g2, window=w)
        if score is None or (isinstance(score, float) and np.isnan(score)):
            continue
        rows.append(
            {
                "player_name": player,
                "player_slug": g["player_slug"].iloc[0],
                "category": category,
                "subcategory": subcategory,
                "category_score": score,
                "window": window,
                "peak_seasons": ",".join(seasons) if isinstance(seasons, list) else seasons,
                "mode": mode,
                "score_type": score_type,
            }
        )
    out = pd.DataFrame(rows)
    if out.empty:
        return out
    out = out.sort_values("category_score", ascending=False).reset_index(drop=True)
    out["rank"] = np.arange(1, len(out) + 1)
    return out


def decade_stat_drift(features: pd.DataFrame) -> pd.DataFrame:
    """Context: mean goals/90 etc. and advanced coverage by decade."""
    cols = [
        c
        for c in [
            "npg_p90",
            "assists_p90",
            "xg_overperf_p90",
            "touches_p90",
            "rating_avg",
            "advanced_coverage",
        ]
        if c in features.columns
    ]
    rows = []
    for decade, g in features.groupby("decade"):
        row = {"decade": decade, "n_player_seasons": len(g)}
        for c in cols:
            row[f"mean_{c}"] = float(pd.to_numeric(g[c], errors="coerce").mean())
        rows.append(row)
    return pd.DataFrame(rows).sort_values("decade")
