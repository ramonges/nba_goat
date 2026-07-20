#!/usr/bin/env python3
"""
Export season features for the Soccer GOAT Ranking EI page.

  .venv/bin/python -m soccer.export_web_features
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

if __name__ == "__main__" and (__package__ is None or __package__ == ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from soccer.load import fetch_all_games
from soccer.ranking.config import (
    ADVANCED_MEASURES,
    CLASSIC_MEASURES,
    MEASURE_DIRECTION,
    SCORING_TREE,
)
from soccer.ranking.features import build_season_features
from soccer.ranking.scorer import ALL_TREE_MEASURES

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "soccer" / "season_features.json"

META_COLS = [
    "player_name",
    "player_slug",
    "season",
    "season_start",
    "decade",
    "era",
    "minutes_total",
    "games",
    "advanced_coverage",
    "primary_competition",
    "competition_tier",
]


def main() -> int:
    print("Loading games…")
    games = fetch_all_games()
    print(f"  games={len(games):,}")
    print("Building season features…")
    features = build_season_features(games, min_minutes=900)
    print(f"  rows={len(features):,}")

    measure_cols = [m for m in ALL_TREE_MEASURES if m in features.columns]
    keep = [c for c in META_COLS if c in features.columns] + measure_cols
    df = features[keep].copy()

    records = []
    for row in df.to_dict(orient="records"):
        clean = {}
        for k, v in row.items():
            if v is None:
                clean[k] = None
            elif isinstance(v, float):
                if v != v:  # NaN
                    clean[k] = None
                else:
                    clean[k] = round(v, 6) if abs(v) < 1e6 else v
            else:
                clean[k] = v
        records.append(clean)

    payload = {
        "note": (
            "Raw season measures for client-side EI "
            "(sigmoid Step 1 + hierarchical weighted RMS Step 2)."
        ),
        "n_seasons": len(records),
        "n_players": len({r["player_name"] for r in records}),
        "measures": measure_cols,
        "classic_measures": sorted(CLASSIC_MEASURES),
        "advanced_measures": sorted(ADVANCED_MEASURES & set(measure_cols)),
        "measure_direction": {
            m: MEASURE_DIRECTION[m] for m in measure_cols if m in MEASURE_DIRECTION
        },
        "scoring_tree": SCORING_TREE,
        "seasons": records,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    size_mb = OUT.stat().st_size / (1024 * 1024)
    print(f"Wrote {OUT} ({size_mb:.2f} MB, {len(records):,} seasons)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
