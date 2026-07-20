"""Soccer GOAT Lab — Step 2 ranking engine."""

from .ranker import (
    rank_career,
    rank_category,
    rank_decade,
    rank_peak,
)
from .compare import compare

__all__ = [
    "rank_career",
    "rank_peak",
    "rank_decade",
    "rank_category",
    "compare",
]
