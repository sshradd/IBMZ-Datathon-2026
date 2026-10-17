"""Wire types shared by the engine, the API and the simulator."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

AgeBand = Literal["18-34", "35-64", "65+"]
Action = Literal["allow", "step_up", "hold"]


class Txn(BaseModel):
    id: str
    ts: float = Field(description="Event time in seconds (simulated clock or epoch)")
    sender_id: str
    receiver_id: str
    amount: float = Field(gt=0)
    channel: Literal["instant"] = "instant"
    memo: str = ""
    sender_age_band: AgeBand = "35-64"
    sender_account_age_days: int = Field(default=365, ge=0)
    receiver_account_age_days: int = Field(default=365, ge=0)
    # Ground truth from the simulator. Never read by the scoring path.
    label_fraud: bool | None = None
    scenario: str | None = None


class Reason(BaseModel):
    code: str
    text: str
    weight: float


class Decision(BaseModel):
    txn_id: str
    risk: float
    action: Action
    reasons: list[Reason]
    sender_score: float
    receiver_score: float
    latency_ms: float
