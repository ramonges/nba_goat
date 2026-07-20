#!/usr/bin/env python3
"""
Soccer GOAT Lab — Step 1: Stat Distribution Comparison.

Run from repo root:
  python -m soccer.run_step1
  python -m soccer.run_step1 --players "Lionel Messi" "Cristiano Ronaldo" "Erling Haaland"

Deliverables written to soccer/outputs/:
  (a) coverage_matrix_by_season.csv, coverage_matrix_by_competition.csv
  (b) anomaly_report.csv, duplicate_games.csv, audit_stat_summary.csv
  (c) normalization_recommendations.csv
  (d) player_comparison_summary.csv + plots/overlay_*.png
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # headless-safe before any pyplot import in submodules

# Allow `python soccer/run_step1.py` as well as `python -m soccer.run_step1`
if __name__ == "__main__" and (__package__ is None or __package__ == ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from soccer.audit import (
    audit_summary,
    coverage_matrix,
    find_anomalies,
    find_duplicate_games,
)
from soccer.config import COUNT_STATS, DEFAULT_COMPARE_PLAYERS, OUTPUT_DIR
from soccer.distributions import (
    drift_by_competition,
    drift_by_era,
    league_distribution_table,
    plot_era_drift,
    plot_stat_distributions,
)
from soccer.load import fetch_all_games
from soccer.per90 import NOTE_SEASON_VS_GAME, add_game_per90, season_per90
from soccer.player_compare import player_summary_table, plot_player_overlays


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Soccer Step 1 — distributions")
    parser.add_argument(
        "--players",
        nargs="*",
        default=None,
        help="Players for overlay comparison (default: Messi/Ronaldo/Haaland/…)",
    )
    parser.add_argument(
        "--skip-plots",
        action="store_true",
        help="Skip matplotlib figure generation",
    )
    args = parser.parse_args(argv)
    players = args.players or DEFAULT_COMPARE_PLAYERS

    print("=" * 64)
    print("Soccer GOAT Lab — Step 1: Stat Distribution Comparison")
    print("=" * 64)
    print(f"Outputs → {OUTPUT_DIR}")

    print("\n[1/6] Loading game-level rows from Supabase…")
    df = fetch_all_games()
    print(f"  rows={len(df):,}  players={df['player_name'].nunique():,}")

    print("\n[2/6] Data audit (summary, coverage, anomalies, duplicates)…")
    summary = audit_summary(df)
    cov_season = coverage_matrix(df, by="season")
    cov_comp = coverage_matrix(df, by="competition")
    anomalies = find_anomalies(df)
    dups = find_duplicate_games(df)
    print(f"  stat summary: {len(summary)} stats")
    print(f"  coverage seasons: {cov_season.shape[1]} · competitions: {cov_comp.shape[1]}")
    print(f"  anomalies flagged: {len(anomalies):,}")
    print(f"  duplicate-suspect rows: {len(dups):,}")

    print("\n[3/6] Per-90 conversion…")
    print(f"  NOTE: {NOTE_SEASON_VS_GAME}")
    game_p90 = add_game_per90(df)
    season_df = season_per90(df)
    print(f"  qualifying player-seasons (≥900′): {len(season_df):,}")

    p90_cols = [f"{c}_p90" for c in COUNT_STATS if f"{c}_p90" in season_df.columns]
    # Include rate-like season aggregates when present
    for extra in ("rating_mean", "dribble_pct_mean"):
        if extra in season_df.columns:
            p90_cols.append(extra)

    print("\n[4/6] League distributions + normalization recommendations…")
    recs = league_distribution_table(season_df, p90_cols)
    era_drift = drift_by_era(season_df, p90_cols)
    comp_drift = drift_by_competition(season_df, p90_cols)
    print(recs.to_string(index=False))
    if not args.skip_plots:
        plot_stat_distributions(season_df, p90_cols)
        plot_era_drift(era_drift, stats=p90_cols[:8])

    print("\n[5/6] Player overlays + era/competition-relative percentiles…")
    summary_tbl = player_summary_table(season_df, players, p90_cols)
    if not args.skip_plots:
        game_p90_cols = [f"{c}_p90" for c in COUNT_STATS if f"{c}_p90" in game_p90.columns]
        plot_player_overlays(game_p90, players, game_p90_cols)
    if not summary_tbl.empty:
        # Pretty pivot for the console
        pivot = summary_tbl.pivot(
            index="player_name", columns="stat", values="era_comp_percentile"
        )
        print("\n  Era×competition percentile (higher = better):")
        print(pivot.round(1).to_string())

    print("\n[6/6] Done. Deliverables:")
    for name in [
        "audit_stat_summary.csv",
        "coverage_matrix_by_season.csv",
        "coverage_matrix_by_competition.csv",
        "anomaly_report.csv",
        "duplicate_games.csv",
        "season_per90.csv",
        "normalization_recommendations.csv",
        "drift_by_era.csv",
        "drift_by_competition.csv",
        "player_comparison_summary.csv",
    ]:
        path = OUTPUT_DIR / name
        flag = "✓" if path.exists() else "·"
        print(f"  {flag} {path.relative_to(OUTPUT_DIR.parent.parent)}")
    print(f"  plots → {OUTPUT_DIR / 'plots'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
