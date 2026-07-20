"""Orchestrate features → normalize → score for the ranking engine."""

from __future__ import annotations

from typing import Optional

import pandas as pd

from ..load import fetch_all_games
from .features import build_season_features
from .normalizer import normalize_all
from .scorer import ALL_TREE_MEASURES, score_all_modes


def build_season_scores(
    games: Optional[pd.DataFrame] = None,
    min_minutes: int = 900,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Returns (features, season_scores) where season_scores stacks
    mode ∈ {raw, adjusted} × score_type ∈ {classic, full}.
    """
    if games is None:
        print("  Loading games from Supabase…")
        games = fetch_all_games()
        print(f"  games={len(games):,}")

    print("  Building season features…")
    features = build_season_features(games, min_minutes=min_minutes)
    print(f"  qualifying player-seasons={len(features):,}")

    print("  Normalizing (raw + adjusted)…")
    measures = [m for m in ALL_TREE_MEASURES if m in features.columns]
    norm_by_mode = normalize_all(features, measures)

    print("  Scoring (classic + full)…")
    season_scores = score_all_modes(features, norm_by_mode)
    print(f"  scored rows={len(season_scores):,}")
    return features, season_scores
