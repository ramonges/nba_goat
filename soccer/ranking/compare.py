"""Head-to-head player comparison + radar-ready category vectors."""

from __future__ import annotations

from typing import Sequence

import numpy as np
import pandas as pd

from .config import SCORING_TREE
from .ranker import rank_career


def compare(
    season_scores: pd.DataFrame,
    players: Sequence[str],
    mode: str = "adjusted",
    score_type: str = "classic",
) -> dict:
    """
    Return:
      - summary: career raw/adjusted/delta for each player
      - categories: player × category scores (0–100), both modes
      - radar: list of {player, categories: {cat: score}} for charting
    """
    career = rank_career(season_scores, mode=mode, score_type=score_type)
    summary = career[career["player_name"].isin(players)].copy()

    cats = list(SCORING_TREE.keys())
    cat_cols = [f"cat_{c}" for c in cats]

    frames = []
    for m in ("raw", "adjusted"):
        sub = season_scores[
            (season_scores["mode"] == m)
            & (season_scores["score_type"] == score_type)
            & (season_scores["player_name"].isin(players))
        ]
        if sub.empty:
            continue
        present = [c for c in cat_cols if c in sub.columns]
        agg = sub.groupby("player_name")[present].mean().reset_index()
        agg["mode"] = m
        frames.append(agg)

    categories = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()

    radar = []
    if not categories.empty:
        for player in players:
            entry = {"player": player, "modes": {}}
            for m in ("raw", "adjusted"):
                row = categories[
                    (categories["player_name"] == player) & (categories["mode"] == m)
                ]
                if row.empty:
                    continue
                entry["modes"][m] = {
                    c.replace("cat_", ""): float(row.iloc[0][c])
                    if pd.notna(row.iloc[0][c])
                    else np.nan
                    for c in cat_cols
                    if c in row.columns
                }
            radar.append(entry)

    return {
        "summary": summary,
        "categories": categories,
        "radar": radar,
        "note": (
            "Category vectors are 0–100. ADJUSTED is era×tier relative; "
            "RAW is absolute pooled min-max."
        ),
    }
