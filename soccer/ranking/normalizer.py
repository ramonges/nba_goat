"""
RAW vs ADJUSTED normalization.

RAW: min-max → 0–100 within the pooled sample of all qualifying seasons.
ADJUSTED: Step-1 transform (z / log1p+z / percentile) within peer group
          = (5-year era bucket × competition tier), then map to 0–100.
"""

from __future__ import annotations

from typing import Iterable

import numpy as np
import pandas as pd
from scipy import stats as sps

from .config import MEASURE_DIRECTION, MEASURE_TRANSFORM


def _to_0_100_minmax(s: pd.Series) -> pd.Series:
    v = pd.to_numeric(s, errors="coerce")
    lo, hi = v.min(), v.max()
    if pd.isna(lo) or pd.isna(hi) or abs(hi - lo) < 1e-12:
        return pd.Series(np.nan, index=s.index)
    return (v - lo) / (hi - lo) * 100.0


def _z_to_0_100(z: pd.Series) -> pd.Series:
    """Map z-scores to ~0–100 via Φ, clipped."""
    # scipy cdf; NaNs stay NaN
    p = z.apply(lambda x: float(sps.norm.cdf(x)) if pd.notna(x) else np.nan)
    return p * 100.0


def _percentile_0_100(s: pd.Series) -> pd.Series:
    v = pd.to_numeric(s, errors="coerce")
    rank = v.rank(method="average", pct=True)
    return rank * 100.0


def _apply_transform(s: pd.Series, transform: str) -> pd.Series:
    v = pd.to_numeric(s, errors="coerce")
    if transform == "percentile":
        return _percentile_0_100(v)
    if transform == "log1p_z":
        # shift if negatives (overperformance can be < 0 — those use z_score)
        base = np.log1p(v.clip(lower=0))
        mu, sd = base.mean(), base.std(ddof=1)
        if sd is None or sd < 1e-12 or pd.isna(sd):
            return pd.Series(np.nan, index=s.index)
        z = (base - mu) / sd
        return _z_to_0_100(z)
    if transform == "z_score":
        mu, sd = v.mean(), v.std(ddof=1)
        if sd is None or sd < 1e-12 or pd.isna(sd):
            return pd.Series(np.nan, index=s.index)
        z = (v - mu) / sd
        return _z_to_0_100(z)
    # default
    return _to_0_100_minmax(v)


def _apply_direction(norm: pd.Series, direction: str) -> pd.Series:
    if direction == "lower":
        return 100.0 - norm
    return norm


def normalize_raw(
    features: pd.DataFrame,
    measures: Iterable[str],
) -> pd.DataFrame:
    """Pooled min-max 0–100 for each measure (direction-adjusted)."""
    out = features[["player_name", "player_slug", "season"]].copy()
    for m in measures:
        if m not in features.columns:
            out[m] = np.nan
            continue
        scaled = _to_0_100_minmax(features[m])
        out[m] = _apply_direction(scaled, MEASURE_DIRECTION.get(m, "higher"))
    return out


def normalize_adjusted(
    features: pd.DataFrame,
    measures: Iterable[str],
) -> pd.DataFrame:
    """
    Within-peer-group transforms. Peer group = era × round(competition_tier, 2).
    """
    work = features.copy()
    work["_peer"] = (
        work["era"].astype(str)
        + "|"
        + work["competition_tier"].round(2).astype(str)
    )
    out = features[["player_name", "player_slug", "season"]].copy()
    for m in measures:
        out[m] = np.nan
        if m not in work.columns:
            continue
        transform = MEASURE_TRANSFORM.get(m, "z_score")
        direction = MEASURE_DIRECTION.get(m, "higher")
        pieces = []
        for _, g in work.groupby("_peer"):
            scaled = _apply_transform(g[m], transform)
            scaled = _apply_direction(scaled, direction)
            pieces.append(scaled)
        if pieces:
            out[m] = pd.concat(pieces).sort_index()
    return out


def normalize_all(
    features: pd.DataFrame,
    measures: Iterable[str],
) -> dict[str, pd.DataFrame]:
    return {
        "raw": normalize_raw(features, measures),
        "adjusted": normalize_adjusted(features, measures),
    }
