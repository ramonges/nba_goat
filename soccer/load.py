"""Fetch game-level rows from Supabase `soccer_player_official`."""

from __future__ import annotations

import re
from typing import Iterable, Optional

import pandas as pd
import requests

from .config import (
    META_COLS,
    ALL_STAT_COLS,
    TABLE_NAME,
    resolve_supabase,
)


def _headers() -> dict:
    _, key = resolve_supabase()
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Prefer": "count=exact",
    }


def fetch_all_games(
    columns: Optional[Iterable[str]] = None,
    page_size: int = 1000,
    players: Optional[Iterable[str]] = None,
) -> pd.DataFrame:
    """Page through the full (or player-filtered) table and return a DataFrame."""
    cols = list(columns) if columns else list(dict.fromkeys(META_COLS + ALL_STAT_COLS))
    select = ",".join(cols)
    url, _ = resolve_supabase()
    base = f"{url}/rest/v1/{TABLE_NAME}"
    rows: list[dict] = []
    offset = 0
    headers = _headers()

    while True:
        params = {
            "select": select,
            "offset": str(offset),
            "limit": str(page_size),
            "order": "id.asc",
        }
        if players:
            quoted = ",".join(f'"{p}"' for p in players)
            params["player_name"] = f"in.({quoted})"

        r = requests.get(base, headers=headers, params=params, timeout=120)
        r.raise_for_status()
        batch = r.json()
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
        if offset % 20000 == 0:
            print(f"  … loaded {offset:,} rows")

    df = pd.DataFrame(rows)
    if df.empty:
        return df

    if "game_date" in df.columns:
        df["game_date"] = pd.to_datetime(df["game_date"], errors="coerce")
    for c in ALL_STAT_COLS + ["team_score", "opp_score"]:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")
    if "started" in df.columns:
        df["started"] = df["started"].astype("boolean")
    return df


def season_end_year(season: str) -> Optional[int]:
    """'2015-16' → 2016, '2024-25' → 2025."""
    if season is None or not isinstance(season, str):
        return None
    m = re.match(r"^(\d{4})-(\d{2})$", season.strip())
    if not m:
        return None
    start = int(m.group(1))
    suffix = int(m.group(2))
    end = (start // 100) * 100 + suffix
    if end < start:
        end += 100
    return end


def era_bucket(season: str, width: int = 5) -> Optional[str]:
    """Map a season to a 5-year bucket label, e.g. '2015–19'."""
    end = season_end_year(season)
    if end is None:
        return None
    start = (end // width) * width
    return f"{start}–{str(start + width - 1)[-2:]}"
