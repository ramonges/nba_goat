"""Per-90 conversion at game and season level."""

from __future__ import annotations

from typing import Iterable

import pandas as pd

from .config import COUNT_STATS, MIN_MINUTES_GAME, MIN_MINUTES_SEASON, OUTPUT_DIR


NOTE_SEASON_VS_GAME = (
    "Season per-90 = sum(stat)/sum(minutes)*90 — NOT the mean of game-level "
    "per-90s. Averaging game per-90s overweight short games even after the "
    "minutes floor; the ratio of totals is the minutes-weighted rate."
)


def add_game_per90(
    df: pd.DataFrame,
    stats: Iterable[str] = COUNT_STATS,
    min_minutes: int = MIN_MINUTES_GAME,
) -> pd.DataFrame:
    """
    Game-level per-90 for counting stats, only when minutes >= min_minutes.
    Short cameos are left as NaN (excluded from later distributions).
    """
    out = df.copy()
    mins = pd.to_numeric(out.get("minutes"), errors="coerce")
    ok = mins >= min_minutes
    for col in stats:
        if col not in out.columns:
            continue
        rate = pd.to_numeric(out[col], errors="coerce") / mins * 90
        out[f"{col}_p90"] = rate.where(ok)
    return out


def season_per90(
    df: pd.DataFrame,
    stats: Iterable[str] = COUNT_STATS,
    min_minutes: int = MIN_MINUTES_SEASON,
) -> pd.DataFrame:
    """
    Season-level per-90: sum(stat) / sum(minutes) * 90 per player-season
    (and competition, if present — kept separate so comps don't mix).
    """
    group_cols = ["player_name", "season"]
    if "competition" in df.columns:
        group_cols.append("competition")

    present = [c for c in stats if c in df.columns]
    agg = {c: "sum" for c in present}
    agg["minutes"] = "sum"
    if "rating" in df.columns:
        # minutes-weighted mean rating at season level
        df = df.copy()
        df["_rating_w"] = pd.to_numeric(df["rating"], errors="coerce") * pd.to_numeric(
            df["minutes"], errors="coerce"
        )
        agg["_rating_w"] = "sum"

    g = df.groupby(group_cols, dropna=False).agg(agg).reset_index()
    g = g.rename(columns={"minutes": "minutes_total"})
    g = g[g["minutes_total"] >= min_minutes].copy()

    for col in present:
        g[f"{col}_p90"] = g[col] / g["minutes_total"] * 90

    if "_rating_w" in g.columns:
        g["rating_mean"] = g["_rating_w"] / g["minutes_total"]
        g = g.drop(columns=["_rating_w"])

    if "dribble_pct" in df.columns:
        # Minutes-weighted mean of game dribble_pct within the season.
        tmp = df.copy()
        tmp["_dp"] = pd.to_numeric(tmp["dribble_pct"], errors="coerce")
        tmp["_m"] = pd.to_numeric(tmp["minutes"], errors="coerce")
        tmp["_w"] = tmp["_dp"] * tmp["_m"]
        w = (
            tmp.groupby(group_cols, dropna=False)[["_w", "_m"]]
            .sum()
            .reset_index()
        )
        w["dribble_pct_mean"] = w["_w"] / w["_m"].replace(0, pd.NA)
        g = g.merge(w[group_cols + ["dribble_pct_mean"]], on=group_cols, how="left")

    g.to_csv(OUTPUT_DIR / "season_per90.csv", index=False)
    return g
