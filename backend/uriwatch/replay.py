"""Storm replays: recorded county-hours played back as a live stream.

Each bundle (data/replay/<key>.json.gz) holds, for every hour of a real storm,
the feature vector of every Texas county plus the outage count the utilities
actually reported. The model only ever sees the features up to the current
hour, never the outage count it is trying to predict.
"""

from __future__ import annotations

import gzip
import json
from functools import lru_cache
from pathlib import Path

from .engine import Engine
from .model import LogisticModel

REPLAY_DIR = Path(__file__).resolve().parents[2] / "data" / "replay"

# Which model each replay uses by default. The honest model never saw any of
# these storms; the final model did.
DEFAULT_MODEL = {"uri": "honest", "elliott": "honest", "ice2023": "honest", "heat2023": "honest"}


def available() -> list[str]:
    return sorted(p.name.removesuffix(".json.gz") for p in REPLAY_DIR.glob("*.json.gz"))


@lru_cache(maxsize=3)
def load_bundle(key: str) -> dict:
    path = REPLAY_DIR / f"{key}.json.gz"
    if not path.exists():
        raise KeyError(key)
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return json.load(fh)


@lru_cache(maxsize=2)
def load_model(name: str) -> LogisticModel:
    return LogisticModel.load(name)


class Session:
    """One replay in progress: a bundle, a model, and a cursor."""

    def __init__(self, key: str, model_name: str | None = None) -> None:
        self.key = key
        self.bundle = load_bundle(key)
        self.model_name = model_name or DEFAULT_MODEL.get(key, "honest")
        self.engine = Engine(load_model(self.model_name), self.bundle["counties"])
        self.i = 0

    @property
    def n(self) -> int:
        return len(self.bundle["hours"])

    @property
    def done(self) -> bool:
        return self.i >= self.n

    def step(self) -> dict | None:
        if self.done:
            return None
        res = self.engine.score_hour(self.i, self.bundle["hours"][self.i])
        res["type"] = "hour"
        res["i"] = self.i
        res["n"] = self.n
        self.i += 1
        return res

    def seek(self, i: int) -> None:
        """Jump to hour i by silently re-scoring from the start (cheap: ~1 s)."""
        self.engine.reset()
        self.i = 0
        target = max(0, min(i, self.n))
        while self.i < target:
            self.step()
