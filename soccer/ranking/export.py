"""Persist season scores to CSV and optionally Supabase `soccer_player_scores`."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import pandas as pd
import requests

from ..config import OUTPUT_DIR, resolve_supabase


SCORE_TABLE = "soccer_player_scores"


def export_season_scores_csv(
    season_scores: pd.DataFrame,
    path: Optional[Path] = None,
) -> Path:
    path = path or (OUTPUT_DIR / "soccer_player_scores.csv")
    season_scores.to_csv(path, index=False)
    return path


def export_leaderboards(
    boards: dict[str, pd.DataFrame],
    folder: Optional[Path] = None,
) -> None:
    folder = folder or (OUTPUT_DIR / "rankings")
    folder.mkdir(parents=True, exist_ok=True)
    for name, df in boards.items():
        if df is None or df.empty:
            continue
        safe = name.replace("/", "_").replace(" ", "_")
        df.to_csv(folder / f"{safe}.csv", index=False)


def upsert_season_scores_supabase(
    season_scores: pd.DataFrame,
    batch_size: int = 500,
) -> int:
    """
    Upsert into `soccer_player_scores` keyed by
    (player_slug, season, mode, score_type).

    Requires the table from soccer/sql/soccer_player_scores.sql to exist.
    Returns number of rows attempted.
    """
    if season_scores.empty:
        return 0

    url, key = resolve_supabase()
    endpoint = f"{url}/rest/v1/{SCORE_TABLE}"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }

    keep = [
        c
        for c in [
            "player_slug",
            "player_name",
            "season",
            "mode",
            "score_type",
            "data_tier",
            "total",
            "era",
            "decade",
            "season_start",
            "primary_competition",
            "competition_tier",
            "minutes_total",
            "advanced_coverage",
            "cat_FINISHING",
            "cat_CREATION",
            "cat_INVOLVEMENT",
            "cat_CARRYING",
            "cat_IMPACT",
            "cat_BIG_GAME",
        ]
        if c in season_scores.columns
    ]
    records = season_scores[keep].where(pd.notna(season_scores[keep]), None).to_dict(
        orient="records"
    )

    # PostgREST upsert needs on_conflict
    params = {"on_conflict": "player_slug,season,mode,score_type"}
    sent = 0
    for i in range(0, len(records), batch_size):
        batch = records[i : i + batch_size]
        r = requests.post(endpoint, headers=headers, params=params, json=batch, timeout=120)
        if r.status_code >= 400:
            raise RuntimeError(
                f"Supabase upsert failed ({r.status_code}): {r.text[:500]}\n"
                "Create the table with soccer/sql/soccer_player_scores.sql first."
            )
        sent += len(batch)
    return sent
