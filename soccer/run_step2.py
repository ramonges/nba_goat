#!/usr/bin/env python3
"""
Soccer GOAT Lab — Step 2: Ranking engine.

  .venv/bin/python -m soccer.run_step2
  .venv/bin/python -m soccer.run_step2 --upsert   # needs soccer_player_scores table
  .venv/bin/python -m soccer.run_step2 --compare "Lionel Messi" "Cristiano Ronaldo"
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")

if __name__ == "__main__" and (__package__ is None or __package__ == ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from soccer.config import DEFAULT_COMPARE_PLAYERS, OUTPUT_DIR
from soccer.ranking.compare import compare
from soccer.ranking.engine import build_season_scores
from soccer.ranking.export import (
    export_leaderboards,
    export_season_scores_csv,
    upsert_season_scores_supabase,
)
from soccer.ranking.ranker import (
    NOTE_CROSS_DECADE,
    decade_stat_drift,
    rank_career,
    rank_category,
    rank_decade,
    rank_peak,
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Soccer Step 2 — ranking engine")
    parser.add_argument("--upsert", action="store_true", help="Upsert to Supabase")
    parser.add_argument(
        "--compare",
        nargs="*",
        default=None,
        help="Players for head-to-head (default: Messi/Ronaldo/…)",
    )
    parser.add_argument(
        "--score-type",
        choices=("classic", "full"),
        default="classic",
        help="CLASSIC = all eras; FULL = advanced-coverage seasons only",
    )
    args = parser.parse_args(argv)
    players = args.compare or DEFAULT_COMPARE_PLAYERS
    score_type = args.score_type

    print("=" * 64)
    print("Soccer GOAT Lab — Step 2: Ranking Engine")
    print("=" * 64)
    print(NOTE_CROSS_DECADE)
    print(f"score_type={score_type}  (tag every board with this)")

    features, season_scores = build_season_scores()
    csv_path = export_season_scores_csv(season_scores)
    print(f"\n  season scores → {csv_path}")

    boards: dict[str, object] = {}

    print("\n[career] adjusted primary, raw alongside…")
    career = rank_career(season_scores, mode="adjusted", score_type=score_type)
    boards[f"career_{score_type}"] = career
    if not career.empty:
        print(career.head(15).to_string(index=False))

    print("\n[peak windows]…")
    for w in ("peak_1", "peak_3", "peak_5", "peak_7"):
        boards[f"{w}_{score_type}"] = rank_peak(
            season_scores, window=w, mode="adjusted", score_type=score_type
        )
        top = boards[f"{w}_{score_type}"]
        if not top.empty:
            print(f"  {w}: #1 {top.iloc[0]['player_name']} "
                  f"(adj={top.iloc[0]['adjusted_score']:.1f}, "
                  f"raw={top.iloc[0]['raw_score']:.1f})")

    print("\n[decades]…")
    decades = sorted(features["decade"].dropna().unique())
    for d in decades:
        board = rank_decade(
            season_scores, decade=d, mode="adjusted", score_type=score_type, top_n=10
        )
        boards[f"decade_{d}_{score_type}"] = board
        if not board.empty:
            print(f"  {d}: #1 {board.iloc[0]['player_name']} "
                  f"(adj={board.iloc[0]['adjusted_score']:.1f})")

    print("\n[category leaders — career / adjusted]…")
    for cat in ("FINISHING", "CREATION", "INVOLVEMENT", "CARRYING", "IMPACT", "BIG_GAME"):
        board = rank_category(
            season_scores,
            category=cat,
            mode="adjusted",
            score_type=score_type,
            window="career",
        )
        boards[f"cat_{cat}_{score_type}"] = board
        if not board.empty:
            print(f"  {cat}: #1 {board.iloc[0]['player_name']} "
                  f"({board.iloc[0]['category_score']:.1f})")

    drift = decade_stat_drift(features)
    boards["decade_stat_drift"] = drift
    print("\n[decade drift context]")
    if not drift.empty:
        print(drift.to_string(index=False))

    rank_dir = OUTPUT_DIR / "rankings"
    rank_dir.mkdir(parents=True, exist_ok=True)

    print("\n[head-to-head]…")
    h2h = compare(season_scores, players, mode="adjusted", score_type=score_type)
    if not h2h["summary"].empty:
        cols = [
            c
            for c in h2h["summary"].columns
            if c
            in (
                "rank",
                "player_name",
                "adjusted_score",
                "raw_score",
                "delta_adjusted_minus_raw",
                "data_tier",
                "n_seasons",
            )
        ]
        print(h2h["summary"][cols].to_string(index=False))
        h2h["summary"].to_csv(rank_dir / "compare_summary.csv", index=False)
        if not h2h["categories"].empty:
            h2h["categories"].to_csv(rank_dir / "compare_categories.csv", index=False)

    export_leaderboards(boards)
    print(f"\n  leaderboards → {OUTPUT_DIR / 'rankings'}")

    if args.upsert:
        print("\n[upsert] soccer_player_scores…")
        n = upsert_season_scores_supabase(season_scores)
        print(f"  upserted {n:,} rows")
    else:
        print("\n  (skip Supabase upsert — pass --upsert after creating the table)")

    print("\nDone.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
