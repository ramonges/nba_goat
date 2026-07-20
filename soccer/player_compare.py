"""Player-level distribution overlays + era/competition-relative percentiles."""

from __future__ import annotations

from typing import Iterable, Sequence

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns

from .config import OUTPUT_DIR
from .load import era_bucket


def _percentile_in_peer(
    value: float, peer_values: pd.Series
) -> float:
    """Percentile of `value` within peer group (higher = better for counts)."""
    peers = peer_values.dropna()
    if peers.empty or value is None or (isinstance(value, float) and np.isnan(value)):
        return float("nan")
    return float((peers < value).mean() * 100)


def player_summary_table(
    season_df: pd.DataFrame,
    players: Sequence[str],
    p90_cols: Iterable[str],
) -> pd.DataFrame:
    """
    Summary: player × stat → career per-90, peak-season per-90,
    era-relative percentile (within era × competition peer group).
    """
    work = season_df.copy()
    work["era"] = work["season"].map(era_bucket)
    present = [p for p in players if p in set(work["player_name"])]
    missing = [p for p in players if p not in set(work["player_name"])]
    if missing:
        print(f"  (skipping missing players: {missing})")

    rows = []
    for player in present:
        me = work[work["player_name"] == player]
        for col in p90_cols:
            if col not in work.columns:
                continue
            vals = pd.to_numeric(me[col], errors="coerce").dropna()
            if vals.empty:
                continue
            # Career per-90: minutes-weighted across this player's seasons
            if "minutes_total" in me.columns:
                w = me.loc[vals.index, "minutes_total"]
                career = float((vals * w).sum() / w.sum()) if w.sum() else float(vals.mean())
            else:
                career = float(vals.mean())
            peak = float(vals.max())
            # Era-relative: average of season-level percentiles vs peers
            season_pcts = []
            for idx, row in me.iterrows():
                v = row.get(col)
                if pd.isna(v):
                    continue
                mask = work["era"] == row["era"]
                if "competition" in work.columns:
                    mask = mask & (work["competition"] == row["competition"])
                peers = work.loc[mask, col]
                season_pcts.append(_percentile_in_peer(float(v), peers))
            era_pct = float(np.nanmean(season_pcts)) if season_pcts else float("nan")
            rows.append(
                {
                    "player_name": player,
                    "stat": col,
                    "career_p90": career,
                    "peak_season_p90": peak,
                    "era_comp_percentile": era_pct,
                    "n_seasons": int(vals.count()),
                }
            )

    out = pd.DataFrame(rows)
    out.to_csv(OUTPUT_DIR / "player_comparison_summary.csv", index=False)
    return out


def plot_player_overlays(
    game_p90: pd.DataFrame,
    players: Sequence[str],
    stats: Sequence[str],
    max_stats: int = 6,
) -> None:
    """
    Overlay KDE of game-level per-90 for selected players on each stat.
    Uses games with a non-null per-90 (already minutes-gated).
    """
    plot_dir = OUTPUT_DIR / "plots"
    plot_dir.mkdir(exist_ok=True)
    present = [p for p in players if p in set(game_p90["player_name"])]
    sns.set_theme(style="darkgrid")
    palette = sns.color_palette("tab10", n_colors=max(len(present), 1))

    for i, col in enumerate(stats[:max_stats]):
        if col not in game_p90.columns:
            continue
        fig, ax = plt.subplots(figsize=(8, 4.5))
        any_data = False
        for j, player in enumerate(present):
            s = pd.to_numeric(
                game_p90.loc[game_p90["player_name"] == player, col],
                errors="coerce",
            ).dropna()
            if len(s) < 8:
                continue
            any_data = True
            sns.kdeplot(s, ax=ax, label=player, color=palette[j], linewidth=2)
        if not any_data:
            plt.close(fig)
            continue
        ax.set_title(f"Game-level {col} — player overlays")
        ax.legend(fontsize=8)
        fig.tight_layout()
        safe = col.replace("/", "_")
        fig.savefig(plot_dir / f"overlay_{safe}.png", dpi=120)
        plt.close(fig)
