"""
Composite scorer.

Subcategory = weighted mean of available normalized measures (renormalize weights).
Category    = weighted mean of available subcategories.
Total       = weighted mean of available categories.

CLASSIC: only classic measures (valid across eras).
FULL: all measures; row kept only if advanced_coverage >= threshold.
Never impute missing advanced stats as 0.
"""

from __future__ import annotations

from typing import Optional

import numpy as np
import pandas as pd

from .config import (
    ADVANCED_COVERAGE_THRESHOLD,
    ADVANCED_MEASURES,
    CLASSIC_MEASURES,
    SCORING_TREE,
)


def _weighted_mean(values: dict[str, float], weights: dict[str, float]) -> Optional[float]:
    num = 0.0
    den = 0.0
    for k, v in values.items():
        if v is None or (isinstance(v, float) and np.isnan(v)):
            continue
        w = float(weights.get(k, 0) or 0)
        if w <= 0:
            continue
        num += w * float(v)
        den += w
    if den <= 0:
        return None
    return num / den


def _all_measures_in_tree() -> list[str]:
    ms = []
    for cat in SCORING_TREE.values():
        for sub in cat["subcategories"].values():
            ms.extend(sub["measures"].keys())
    return list(dict.fromkeys(ms))


ALL_TREE_MEASURES = _all_measures_in_tree()


def score_row(
    norm_row: pd.Series,
    feature_row: pd.Series,
    score_type: str = "full",
) -> dict:
    """
    Score one player-season given normalized measure columns + feature metadata.
    Returns dict with subcategory/category/total scores + completeness tier.
    """
    allowed = CLASSIC_MEASURES if score_type == "classic" else (CLASSIC_MEASURES | ADVANCED_MEASURES)

    # FULL eligibility
    adv_cov = feature_row.get("advanced_coverage", 0) or 0
    if score_type == "full" and adv_cov < ADVANCED_COVERAGE_THRESHOLD:
        return {
            "total": np.nan,
            "score_type": score_type,
            "data_tier": "B",
            "eligible": False,
            "advanced_coverage": adv_cov,
        }

    cat_scores = {}
    cat_weights = {}
    sub_detail = {}

    for cat_name, cat in SCORING_TREE.items():
        sub_scores = {}
        sub_weights = {}
        for sub_name, sub in cat["subcategories"].items():
            meas_vals = {}
            meas_w = {}
            for m, w in sub["measures"].items():
                if m not in allowed:
                    continue
                val = norm_row.get(m, np.nan)
                if val is None or (isinstance(val, float) and np.isnan(val)):
                    continue
                meas_vals[m] = float(val)
                meas_w[m] = float(w)
            sc = _weighted_mean(meas_vals, meas_w)
            if sc is not None:
                sub_scores[sub_name] = sc
                sub_weights[sub_name] = float(sub["weight"])
                sub_detail[f"{cat_name}.{sub_name}"] = sc

        cat_sc = _weighted_mean(sub_scores, sub_weights)
        if cat_sc is not None:
            cat_scores[cat_name] = cat_sc
            cat_weights[cat_name] = float(cat["weight"])

    total = _weighted_mean(cat_scores, cat_weights)
    # Completeness tier
    if score_type == "full" and adv_cov >= ADVANCED_COVERAGE_THRESHOLD:
        tier = "A"
    else:
        tier = "B"

    out = {
        "total": total if total is not None else np.nan,
        "score_type": score_type,
        "data_tier": tier,
        "eligible": total is not None,
        "advanced_coverage": adv_cov,
        **{f"cat_{k}": v for k, v in cat_scores.items()},
        **{f"sub_{k.replace('.', '_')}": v for k, v in sub_detail.items()},
    }
    return out


def score_seasons(
    features: pd.DataFrame,
    normalized: pd.DataFrame,
    mode: str,
    score_type: str,
) -> pd.DataFrame:
    """
    Score every player-season for one (mode, score_type) pair.
    `normalized` must align with `features` on index / player+season.
    """
    # Align on player_name + season
    feat = features.set_index(["player_name", "season"])
    norm = normalized.set_index(["player_name", "season"])
    common = feat.index.intersection(norm.index)

    rows = []
    for key in common:
        frow = feat.loc[key]
        nrow = norm.loc[key]
        scored = score_row(nrow, frow, score_type=score_type)
        if score_type == "full" and not scored.get("eligible"):
            # Still emit classic-eligible rows? Spec: FULL only for high coverage.
            # Skip ineligible full rows.
            continue
        if scored.get("total") is None or (
            isinstance(scored.get("total"), float) and np.isnan(scored["total"])
        ):
            continue
        rows.append(
            {
                "player_name": key[0],
                "season": key[1],
                "player_slug": frow.get("player_slug"),
                "era": frow.get("era"),
                "decade": frow.get("decade"),
                "season_start": frow.get("season_start"),
                "primary_competition": frow.get("primary_competition"),
                "competition_tier": frow.get("competition_tier"),
                "minutes_total": frow.get("minutes_total"),
                "mode": mode,
                **scored,
            }
        )

    return pd.DataFrame(rows)


def score_all_modes(
    features: pd.DataFrame,
    norm_by_mode: dict[str, pd.DataFrame],
) -> pd.DataFrame:
    """Compute raw/adjusted × classic/full season scores and stack."""
    frames = []
    for mode, norm in norm_by_mode.items():
        for score_type in ("classic", "full"):
            part = score_seasons(features, norm, mode=mode, score_type=score_type)
            frames.append(part)
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)
