"""Soccer GOAT Lab — shared config (table, columns, thresholds)."""

from __future__ import annotations

import os
import re
from pathlib import Path

TABLE_NAME = "soccer_player_official"

ROOT = Path(__file__).resolve().parent
OUTPUT_DIR = ROOT / "outputs"
OUTPUT_DIR.mkdir(exist_ok=True)

# Populated by resolve_supabase() — prefer the frontend project's URL/key so we
# don't accidentally hit a different SUPABASE_URL from the shell environment.
SUPABASE_URL = ""
SUPABASE_KEY = ""


def resolve_supabase() -> tuple[str, str]:
    """Return (url, key) for the same project as src/lib/supabase.js."""
    global SUPABASE_URL, SUPABASE_KEY
    if SUPABASE_URL and SUPABASE_KEY:
        return SUPABASE_URL, SUPABASE_KEY

    js_path = ROOT.parent / "src" / "lib" / "supabase.js"
    text = js_path.read_text(encoding="utf-8")
    url_m = re.search(r'https://[a-z0-9]+\.supabase\.co', text)
    key_m = re.search(r'eyJ[a-zA-Z0-9_\-\.]+', text)
    if not url_m or not key_m:
        raise RuntimeError("Could not parse Supabase URL/key from src/lib/supabase.js")

    # Explicit env overrides only when SOCCER_SUPABASE_* is set (opt-in).
    SUPABASE_URL = os.environ.get("SOCCER_SUPABASE_URL") or url_m.group(0)
    SUPABASE_KEY = os.environ.get("SOCCER_SUPABASE_KEY") or key_m.group(0)
    return SUPABASE_URL, SUPABASE_KEY

# Counting / rate stats used in Step 1 distributions.
COUNT_STATS = [
    "goals",
    "assists",
    "xg",
    "xa",
    "shots",
    "shots_on_target",
    "dribbles",
    "touches",
    "touches_in_box",
    "penalties",
    "big_chances_missed",
    "offsides",
]

# Already rate-like (do not convert with *90 / minutes).
RATE_STATS = [
    "dribble_pct",
    "rating",
    "minutes",
]

ALL_STAT_COLS = COUNT_STATS + RATE_STATS

# Identity / meta columns.
META_COLS = [
    "id",
    "player_name",
    "player_slug",
    "season",
    "game_date",
    "competition",
    "club",
    "opponent",
    "home_away",
    "result",
    "score",
    "team_score",
    "opp_score",
    "started",
    "match_id",
]

# Game-level per-90: exclude short cameos (they explode rates).
MIN_MINUTES_GAME = 20

# Season-level distribution pool: qualifying player-seasons.
MIN_MINUTES_SEASON = 900

# 5-year era buckets (end year of season string "YYYY-YY").
ERA_BUCKET_YEARS = 5

# Default overlay comparison set (names that exist in the table).
DEFAULT_COMPARE_PLAYERS = [
    "Lionel Messi",
    "Cristiano Ronaldo",
    "Erling Haaland",
    "Kylian Mbappé",  # may be missing — loader will skip absentees
    "Neymar",
    "Karim Benzema",
]


def load_key_from_frontend_if_needed() -> str:
    """Compatibility helper — returns the resolved anon key."""
    _, key = resolve_supabase()
    return key
