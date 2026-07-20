# Soccer GOAT Lab

Analytical layer for soccer, reading from Supabase table `soccer_player_official`.

## Setup

```bash
python3 -m venv .venv
.venv/bin/pip install -r soccer/requirements.txt
```

Credentials are read from `src/lib/supabase.js` (same project as the NBA app).
Optional overrides: `SOCCER_SUPABASE_URL`, `SOCCER_SUPABASE_KEY`.

## Step 1 — Distributions

```bash
.venv/bin/python -m soccer.run_step1
.venv/bin/python -m soccer.run_step1 --players "Lionel Messi" "Cristiano Ronaldo" "Erling Haaland"
```

Outputs in `soccer/outputs/`: coverage matrices, anomalies, normalization recommendations, player overlays.

## Step 2 — Ranking engine

Hierarchy (weights in `soccer/ranking/config.py`):
**FINISHING · CREATION · INVOLVEMENT · CARRYING · IMPACT · BIG_GAME**

Two modes always side by side:
- **RAW** — pooled min-max 0–100 (absolute numbers)
- **ADJUSTED** — Step-1 transforms within (5-year era × competition tier)

Two score types:
- **CLASSIC** — goals/assists/shots/… (all eras)
- **FULL** — includes xG/xA/rating/touches/dribbles (advanced coverage ≥ 80%)

```bash
.venv/bin/python -m soccer.run_step2
.venv/bin/python -m soccer.run_step2 --score-type full
.venv/bin/python -m soccer.run_step2 --compare "Lionel Messi" "Cristiano Ronaldo"
# After creating the table in Supabase SQL editor:
.venv/bin/python -m soccer.run_step2 --upsert
```

SQL: `soccer/sql/soccer_player_scores.sql`

### API

```python
from soccer.ranking.engine import build_season_scores
from soccer.ranking import rank_career, rank_peak, rank_decade, rank_category, compare

features, scores = build_season_scores()
rank_career(scores, mode="adjusted", score_type="classic")
rank_peak(scores, window="peak_5", mode="adjusted", score_type="classic")
rank_decade(scores, decade="2010s", mode="adjusted", score_type="classic")
rank_category(scores, "FINISHING", mode="adjusted", score_type="classic")
compare(scores, ["Lionel Messi", "Cristiano Ronaldo"], mode="adjusted")
```

**Note:** ADJUSTED scores are comparable across decades by construction. RAW scores are not.

## Modules

| Path | Role |
|---|---|
| `load.py` / `audit.py` / `per90.py` / `distributions.py` | Step 1 |
| `ranking/config.py` | Category tree + weights |
| `ranking/features.py` | Season feature matrix |
| `ranking/normalizer.py` | RAW + ADJUSTED |
| `ranking/scorer.py` | Classic/full + weight renormalization |
| `ranking/ranker.py` | Career / peak / decade / category boards |
| `ranking/compare.py` | Head-to-head + radar data |
| `ranking/export.py` | CSV + Supabase upsert |
