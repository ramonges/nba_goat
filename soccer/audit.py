"""Data audit: coverage, anomalies, duplicates."""

from __future__ import annotations

from typing import Iterable

import numpy as np
import pandas as pd

from .config import ALL_STAT_COLS, OUTPUT_DIR


def summarize_stat(series: pd.Series) -> dict:
    s = pd.to_numeric(series, errors="coerce")
    n = len(s)
    nulls = int(s.isna().sum())
    valid = s.dropna()
    if valid.empty:
        return {
            "count": n,
            "null_count": nulls,
            "null_rate": nulls / n if n else np.nan,
            "min": np.nan,
            "max": np.nan,
            "mean": np.nan,
            "median": np.nan,
            "std": np.nan,
            "p01": np.nan,
            "p05": np.nan,
            "p25": np.nan,
            "p75": np.nan,
            "p95": np.nan,
            "p99": np.nan,
        }
    qs = valid.quantile([0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99])
    return {
        "count": n,
        "null_count": nulls,
        "null_rate": nulls / n,
        "min": float(valid.min()),
        "max": float(valid.max()),
        "mean": float(valid.mean()),
        "median": float(qs.loc[0.5]),
        "std": float(valid.std(ddof=1)) if len(valid) > 1 else 0.0,
        "p01": float(qs.loc[0.01]),
        "p05": float(qs.loc[0.05]),
        "p25": float(qs.loc[0.25]),
        "p75": float(qs.loc[0.75]),
        "p95": float(qs.loc[0.95]),
        "p99": float(qs.loc[0.99]),
    }


def audit_summary(df: pd.DataFrame, stats: Iterable[str] = ALL_STAT_COLS) -> pd.DataFrame:
    """Per-stat summary table (count, nulls, percentiles, …)."""
    rows = []
    for col in stats:
        if col not in df.columns:
            continue
        row = summarize_stat(df[col])
        row["stat"] = col
        rows.append(row)
    out = pd.DataFrame(rows).set_index("stat")
    out.to_csv(OUTPUT_DIR / "audit_stat_summary.csv")
    return out


def coverage_matrix(
    df: pd.DataFrame,
    stats: Iterable[str] = ALL_STAT_COLS,
    by: str = "season",
) -> pd.DataFrame:
    """
    Coverage matrix: stat × {season|competition} → % non-null.
    Advanced stats (xG, xA, rating, touches) typically appear only from a
    certain season onward and differ by competition/source.
    """
    if by not in df.columns:
        raise ValueError(f"column {by!r} missing")
    mats = []
    for col in stats:
        if col not in df.columns:
            continue
        cov = df.groupby(by)[col].apply(lambda s: float(s.notna().mean()))
        mats.append(cov.rename(col))
    mat = pd.concat(mats, axis=1).T  # rows = stats, cols = seasons/comps
    mat.index.name = "stat"
    mat.to_csv(OUTPUT_DIR / f"coverage_matrix_by_{by}.csv")
    return mat


def find_anomalies(df: pd.DataFrame) -> pd.DataFrame:
    """
    Flag impossible / inconsistent values.
    Returns a tidy anomaly report (one row per flagged game × rule).
    """
    flags = []

    def add(mask: pd.Series, rule: str):
        hit = df.loc[mask]
        if hit.empty:
            return
        for idx, row in hit.iterrows():
            flags.append(
                {
                    "rule": rule,
                    "id": row.get("id"),
                    "player_name": row.get("player_name"),
                    "season": row.get("season"),
                    "game_date": row.get("game_date"),
                    "competition": row.get("competition"),
                    "minutes": row.get("minutes"),
                    "goals": row.get("goals"),
                    "shots": row.get("shots"),
                    "shots_on_target": row.get("shots_on_target"),
                    "dribble_pct": row.get("dribble_pct"),
                    "result": row.get("result"),
                    "team_score": row.get("team_score"),
                    "opp_score": row.get("opp_score"),
                }
            )

    if "minutes" in df.columns:
        add(df["minutes"] > 120, "minutes_gt_120")
        add(df["minutes"] < 0, "minutes_negative")

    for col in [
        "goals",
        "assists",
        "shots",
        "shots_on_target",
        "dribbles",
        "touches",
        "touches_in_box",
        "penalties",
        "big_chances_missed",
        "offsides",
        "xg",
        "xa",
    ]:
        if col in df.columns:
            add(df[col] < 0, f"{col}_negative")

    if {"shots", "shots_on_target"}.issubset(df.columns):
        add(
            df["shots_on_target"].notna()
            & df["shots"].notna()
            & (df["shots_on_target"] > df["shots"]),
            "shots_on_target_gt_shots",
        )

    if {"goals", "shots"}.issubset(df.columns):
        add(
            df["goals"].notna()
            & df["shots"].notna()
            & (df["goals"] > df["shots"]),
            "goals_gt_shots",
        )

    if "dribble_pct" in df.columns:
        add(
            df["dribble_pct"].notna()
            & ((df["dribble_pct"] < 0) | (df["dribble_pct"] > 100)),
            "dribble_pct_out_of_range",
        )

    if {"result", "team_score", "opp_score"}.issubset(df.columns):
        ts, os_ = df["team_score"], df["opp_score"]
        res = df["result"].astype(str).str.upper().str.strip()
        both = ts.notna() & os_.notna() & res.notna()
        add(both & (res == "W") & ~(ts > os_), "result_W_inconsistent")
        add(both & (res == "L") & ~(ts < os_), "result_L_inconsistent")
        add(both & (res == "D") & ~(ts == os_), "result_D_inconsistent")

    out = pd.DataFrame(flags)
    out.to_csv(OUTPUT_DIR / "anomaly_report.csv", index=False)
    return out


def find_duplicate_games(df: pd.DataFrame) -> pd.DataFrame:
    """
    Flag likely duplicate game rows that slip past uniqueness
    (same player + date, often with null/blank opponent).
    """
    keys = ["player_name", "game_date"]
    if not all(k in df.columns for k in keys):
        return pd.DataFrame()

    work = df.copy()
    work["_opp"] = work["opponent"].fillna("").astype(str).str.strip() if "opponent" in work.columns else ""
    work["_comp"] = work["competition"].fillna("").astype(str) if "competition" in work.columns else ""

    # Exact duplicates on player + date + opponent + competition
    dup_exact = work.duplicated(
        subset=["player_name", "game_date", "_opp", "_comp"], keep=False
    )
    # Soft: same player + date (regardless of opponent) — catches null-opponent slips
    dup_soft = work.duplicated(subset=["player_name", "game_date"], keep=False)

    flagged = work.loc[dup_exact | dup_soft].copy()
    flagged["dup_exact"] = dup_exact.loc[flagged.index]
    flagged["dup_soft_same_date"] = dup_soft.loc[flagged.index]
    cols = [
        c
        for c in [
            "id",
            "player_name",
            "season",
            "game_date",
            "competition",
            "opponent",
            "club",
            "minutes",
            "goals",
            "dup_exact",
            "dup_soft_same_date",
        ]
        if c in flagged.columns
    ]
    out = flagged[cols].sort_values(["player_name", "game_date"])
    out.to_csv(OUTPUT_DIR / "duplicate_games.csv", index=False)
    return out
