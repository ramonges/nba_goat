"""
Scoring hierarchy — all weights live here.

Category / subcategory / measure weights are relative and re-normalized at
score time when measures are missing (never impute advanced stats as 0).
"""

from __future__ import annotations

# Competition tier weights for BIG GAME / peer grouping.
COMPETITION_TIER = {
    "champions_league": 1.0,  # UCL
    "regular_season": 0.85,  # treat domestic league as top-5 default
    "europa_league": 0.7,
    "europa": 0.7,
    "domestic_cup": 0.6,
    "other": 0.5,
}

# Advanced coverage threshold for FULL score eligibility (from coverage matrix).
ADVANCED_COVERAGE_THRESHOLD = 0.80

# Classic vs advanced measure tags.
CLASSIC_MEASURES = {
    "npg_p90",
    "shots_p90",
    "sot_p90",
    "conversion_rate",
    "shot_accuracy",
    "bcm_p90",
    "assists_p90",
}

ADVANCED_MEASURES = {
    "xg_overperf_p90",
    "xa_p90",
    "ast_xa_overperf_p90",
    "touches_p90",
    "touches_in_box_p90",
    "box_touch_share",
    "dribbles_p90",
    "dribble_success_pct",
    "rating_avg",
    "pct_rated_8plus",
    "rating_std",
    "win_pct_starter",
    "rating_delta_wl",
    # BIG GAME copies of the above (computed on UCL subset)
    "bg_npg_p90",
    "bg_shots_p90",
    "bg_assists_p90",
    "bg_xa_p90",
    "bg_touches_p90",
    "bg_rating_avg",
    "bg_win_pct_starter",
}

# Direction: "higher" = more is better; "lower" = less is better (invert after norm).
MEASURE_DIRECTION = {
    "npg_p90": "higher",
    "shots_p90": "higher",
    "sot_p90": "higher",
    "conversion_rate": "higher",
    "shot_accuracy": "higher",
    "bcm_p90": "lower",  # big chances missed — negative contribution
    "xg_overperf_p90": "higher",
    "assists_p90": "higher",
    "xa_p90": "higher",
    "ast_xa_overperf_p90": "higher",
    "touches_p90": "higher",
    "touches_in_box_p90": "higher",
    "box_touch_share": "higher",
    "dribbles_p90": "higher",
    "dribble_success_pct": "higher",
    "rating_avg": "higher",
    "pct_rated_8plus": "higher",
    "rating_std": "lower",  # consistency bonus
    "win_pct_starter": "higher",
    "rating_delta_wl": "higher",
    "bg_npg_p90": "higher",
    "bg_shots_p90": "higher",
    "bg_assists_p90": "higher",
    "bg_xa_p90": "higher",
    "bg_touches_p90": "higher",
    "bg_rating_avg": "higher",
    "bg_win_pct_starter": "higher",
}

# Step-1 style transform hint per measure (used in ADJUSTED mode).
# skew → log1p_z; roughly symmetric → z; bounded rates → percentile.
MEASURE_TRANSFORM = {
    "npg_p90": "log1p_z",
    "shots_p90": "log1p_z",
    "sot_p90": "log1p_z",
    "conversion_rate": "percentile",
    "shot_accuracy": "percentile",
    "bcm_p90": "log1p_z",
    "xg_overperf_p90": "z_score",  # can be negative
    "assists_p90": "log1p_z",
    "xa_p90": "log1p_z",
    "ast_xa_overperf_p90": "z_score",
    "touches_p90": "log1p_z",
    "touches_in_box_p90": "log1p_z",
    "box_touch_share": "percentile",
    "dribbles_p90": "log1p_z",
    "dribble_success_pct": "percentile",
    "rating_avg": "z_score",
    "pct_rated_8plus": "percentile",
    "rating_std": "z_score",
    "win_pct_starter": "percentile",
    "rating_delta_wl": "z_score",
    "bg_npg_p90": "log1p_z",
    "bg_shots_p90": "log1p_z",
    "bg_assists_p90": "log1p_z",
    "bg_xa_p90": "log1p_z",
    "bg_touches_p90": "log1p_z",
    "bg_rating_avg": "z_score",
    "bg_win_pct_starter": "percentile",
}

# ── Hierarchy ────────────────────────────────────────────────────────────────
# Each measure entry: weight within its subcategory.
# Category weights sum notionally to 1; subcategory weights relative within cat.

SCORING_TREE = {
    "FINISHING": {
        "weight": 0.28,
        "subcategories": {
            "volume": {
                "weight": 0.40,
                "measures": {
                    "npg_p90": 0.45,
                    "shots_p90": 0.25,
                    "sot_p90": 0.30,
                },
            },
            "efficiency": {
                "weight": 0.35,
                "measures": {
                    "conversion_rate": 0.40,
                    "shot_accuracy": 0.35,
                    "bcm_p90": 0.25,  # lower is better
                },
            },
            "overperformance": {
                "weight": 0.25,
                "measures": {
                    "xg_overperf_p90": 1.0,  # advanced-only
                },
            },
        },
    },
    "CREATION": {
        "weight": 0.20,
        "subcategories": {
            "volume": {
                "weight": 0.60,
                "measures": {
                    "assists_p90": 0.55,
                    "xa_p90": 0.45,  # advanced-only
                },
            },
            "overperformance": {
                "weight": 0.40,
                "measures": {
                    "ast_xa_overperf_p90": 1.0,  # advanced-only
                },
            },
        },
    },
    "INVOLVEMENT": {
        "weight": 0.14,
        "subcategories": {
            "volume": {
                "weight": 1.0,
                "measures": {
                    "touches_p90": 0.40,
                    "touches_in_box_p90": 0.35,
                    "box_touch_share": 0.25,
                },
            },
        },
    },
    "CARRYING": {
        "weight": 0.10,
        "subcategories": {
            "volume": {
                "weight": 1.0,
                "measures": {
                    "dribbles_p90": 0.55,
                    "dribble_success_pct": 0.45,  # from raw counts, not avg of pct
                },
            },
        },
    },
    "IMPACT": {
        "weight": 0.16,
        "subcategories": {
            "volume": {
                "weight": 1.0,
                "measures": {
                    "rating_avg": 0.30,
                    "pct_rated_8plus": 0.25,
                    "rating_std": 0.15,  # lower better
                    "win_pct_starter": 0.20,
                    "rating_delta_wl": 0.10,
                },
            },
        },
    },
    "BIG_GAME": {
        "weight": 0.12,
        "subcategories": {
            "volume": {
                "weight": 1.0,
                "measures": {
                    "bg_npg_p90": 0.22,
                    "bg_shots_p90": 0.12,
                    "bg_assists_p90": 0.18,
                    "bg_xa_p90": 0.12,
                    "bg_touches_p90": 0.12,
                    "bg_rating_avg": 0.14,
                    "bg_win_pct_starter": 0.10,
                },
            },
        },
    },
}

# Modes
MODES = ("raw", "adjusted")
SCORE_TYPES = ("classic", "full")

# Peak consecutive-season windows
PEAK_WINDOWS = {
    "peak_1": 1,
    "peak_3": 3,
    "peak_5": 5,
    "peak_7": 7,
    "career": None,  # all qualifying seasons
}
