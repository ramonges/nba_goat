"""Build season-level feature matrix for the soccer ranking engine."""

from __future__ import annotations

import re
from typing import Optional

import numpy as np
import pandas as pd

from ..config import MIN_MINUTES_SEASON
from ..load import era_bucket, season_end_year
from .config import COMPETITION_TIER


def season_start_year(season: str) -> Optional[int]:
    """'1999-00' → 1999 (decade bucketing uses start year)."""
    if season is None or not isinstance(season, str):
        return None
    m = re.match(r"^(\d{4})-\d{2}$", season.strip())
    return int(m.group(1)) if m else None


def decade_label(season: str) -> Optional[str]:
    y = season_start_year(season)
    if y is None:
        return None
    d = (y // 10) * 10
    return f"{d}s"


def competition_tier(comp: str) -> float:
    if comp is None or (isinstance(comp, float) and np.isnan(comp)):
        return COMPETITION_TIER["other"]
    return COMPETITION_TIER.get(str(comp).lower(), COMPETITION_TIER["other"])


def _safe_div(a: pd.Series, b: pd.Series) -> pd.Series:
    b = b.replace(0, np.nan)
    return a / b


def _aggregate_block(g: pd.DataFrame, prefix: str = "") -> dict:
    """Aggregate one player-season (optionally UCL-only) into feature dict."""
    mins = pd.to_numeric(g["minutes"], errors="coerce").fillna(0)
    total_min = float(mins.sum())
    if total_min <= 0:
        return {}

    def s(col: str) -> float:
        if col not in g.columns:
            return np.nan
        return float(pd.to_numeric(g[col], errors="coerce").fillna(0).sum())

    def p90(col: str) -> float:
        v = s(col)
        if np.isnan(v):
            return np.nan
        return v / total_min * 90.0

    goals = s("goals")
    pens = s("penalties")
    shots = s("shots")
    sot = s("shots_on_target")
    assists = s("assists")
    xg = s("xg")
    xa = s("xa")
    touches = s("touches")
    tib = s("touches_in_box")
    dribbles = s("dribbles")
    bcm = s("big_chances_missed")

    # Dribble success % from raw counts: Σ(dribble_pct/100 * dribbles) / Σ(dribbles)
    # Never average game percentages unweighted.
    dribble_success_pct = np.nan
    if "dribbles" in g.columns and "dribble_pct" in g.columns:
        d = pd.to_numeric(g["dribbles"], errors="coerce").fillna(0)
        pct = pd.to_numeric(g["dribble_pct"], errors="coerce")
        succ = (pct / 100.0) * d
        ok = d > 0
        if ok.any() and pct.notna().any():
            denom = d[ok & pct.notna()].sum()
            if denom > 0:
                dribble_success_pct = float(succ[ok & pct.notna()].sum() / denom * 100)

    rating = pd.to_numeric(g.get("rating"), errors="coerce")
    started = g["started"].fillna(False).astype(bool) if "started" in g.columns else pd.Series(False, index=g.index)
    result = g["result"].astype(str).str.upper().str.strip() if "result" in g.columns else pd.Series("", index=g.index)

    rating_avg = float(rating.mean()) if rating.notna().any() else np.nan
    rating_std = float(rating.std(ddof=1)) if rating.notna().sum() > 1 else np.nan
    pct_8 = float((rating >= 8).mean()) if rating.notna().any() else np.nan

    starter = started
    if starter.any():
        wins = (starter & (result == "W")).sum()
        starter_n = int(starter.sum())
        win_pct_starter = wins / starter_n if starter_n else np.nan
    else:
        win_pct_starter = np.nan

    # Rating delta: mean rating in wins − mean rating in losses (among rated games)
    r_w = rating[result == "W"].dropna()
    r_l = rating[result == "L"].dropna()
    if len(r_w) and len(r_l):
        rating_delta_wl = float(r_w.mean() - r_l.mean())
    else:
        rating_delta_wl = np.nan

    # Advanced coverage for this block: fraction of key advanced cols non-null at game level
    adv_cols = ["xg", "xa", "rating", "touches", "dribbles"]
    present = [c for c in adv_cols if c in g.columns]
    if present:
        cov = float(np.mean([pd.to_numeric(g[c], errors="coerce").notna().mean() for c in present]))
    else:
        cov = 0.0

    base = {
        f"{prefix}npg_p90": (goals - pens) / total_min * 90 if not np.isnan(goals) else np.nan,
        f"{prefix}shots_p90": p90("shots"),
        f"{prefix}sot_p90": p90("shots_on_target"),
        f"{prefix}conversion_rate": (goals / shots) if shots and shots > 0 else np.nan,
        f"{prefix}shot_accuracy": (sot / shots) if shots and shots > 0 else np.nan,
        f"{prefix}bcm_p90": p90("big_chances_missed"),
        f"{prefix}xg_overperf_p90": ((goals - xg) / total_min * 90)
        if not np.isnan(xg)
        else np.nan,
        f"{prefix}assists_p90": p90("assists"),
        f"{prefix}xa_p90": p90("xa") if not np.isnan(xa) else np.nan,
        f"{prefix}ast_xa_overperf_p90": ((assists - xa) / total_min * 90)
        if not np.isnan(xa)
        else np.nan,
        f"{prefix}touches_p90": p90("touches") if not np.isnan(touches) else np.nan,
        f"{prefix}touches_in_box_p90": p90("touches_in_box") if not np.isnan(tib) else np.nan,
        f"{prefix}box_touch_share": (tib / touches) if touches and touches > 0 else np.nan,
        f"{prefix}dribbles_p90": p90("dribbles") if not np.isnan(dribbles) else np.nan,
        f"{prefix}dribble_success_pct": dribble_success_pct,
        f"{prefix}rating_avg": rating_avg,
        f"{prefix}pct_rated_8plus": pct_8,
        f"{prefix}rating_std": rating_std,
        f"{prefix}win_pct_starter": win_pct_starter,
        f"{prefix}rating_delta_wl": rating_delta_wl,
        f"{prefix}minutes_total": total_min,
        f"{prefix}advanced_coverage": cov,
        f"{prefix}games": len(g),
    }
    return base


def build_season_features(
    games: pd.DataFrame,
    min_minutes: int = MIN_MINUTES_SEASON,
) -> pd.DataFrame:
    """
    One row per (player_name, season) aggregating all competitions, plus
    BIG_GAME features from champions_league only.
    """
    if games.empty:
        return pd.DataFrame()

    g = games.copy()
    g["minutes"] = pd.to_numeric(g["minutes"], errors="coerce")
    rows = []

    for (player, season), grp in g.groupby(["player_name", "season"], dropna=False):
        mins = float(grp["minutes"].fillna(0).sum())
        if mins < min_minutes:
            continue

        feats = _aggregate_block(grp, prefix="")
        if not feats:
            continue

        # BIG GAME: UCL subset (tier-weighted conceptually; we restrict to UCL)
        ucl = grp[grp["competition"].astype(str).str.lower() == "champions_league"]
        if len(ucl) and float(ucl["minutes"].fillna(0).sum()) >= 180:
            bg = _aggregate_block(ucl, prefix="")
            feats.update(
                {
                    "bg_npg_p90": bg.get("npg_p90"),
                    "bg_shots_p90": bg.get("shots_p90"),
                    "bg_assists_p90": bg.get("assists_p90"),
                    "bg_xa_p90": bg.get("xa_p90"),
                    "bg_touches_p90": bg.get("touches_p90"),
                    "bg_rating_avg": bg.get("rating_avg"),
                    "bg_win_pct_starter": bg.get("win_pct_starter"),
                    "bg_minutes": bg.get("minutes_total"),
                }
            )
        else:
            for k in (
                "bg_npg_p90",
                "bg_shots_p90",
                "bg_assists_p90",
                "bg_xa_p90",
                "bg_touches_p90",
                "bg_rating_avg",
                "bg_win_pct_starter",
            ):
                feats[k] = np.nan

        # Primary competition for peer grouping = competition with most minutes
        if "competition" in grp.columns:
            by_comp = grp.groupby("competition")["minutes"].sum()
            primary_comp = by_comp.idxmax() if len(by_comp) else "other"
        else:
            primary_comp = "other"

        slug = None
        if "player_slug" in grp.columns and grp["player_slug"].notna().any():
            slug = grp["player_slug"].dropna().iloc[0]

        rows.append(
            {
                "player_name": player,
                "player_slug": slug or str(player).lower().replace(" ", "-"),
                "season": season,
                "season_start": season_start_year(season),
                "season_end": season_end_year(season),
                "era": era_bucket(season),
                "decade": decade_label(season),
                "primary_competition": primary_comp,
                "competition_tier": competition_tier(primary_comp),
                **feats,
            }
        )

    out = pd.DataFrame(rows)
    if not out.empty:
        out = out.sort_values(["player_name", "season_start"]).reset_index(drop=True)
    return out
