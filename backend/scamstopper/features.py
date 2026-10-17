"""Streaming feature state.

Features are computed from what the bank already knew *before* this payment,
then the state is updated. Everything is pure Python so it runs unchanged on
x86 laptops and on s390x LinuxONE.
"""

from __future__ import annotations

import math
from collections import Counter, deque
from dataclasses import dataclass, field

from .models import Txn

HOUR = 3600.0
DAY = 24 * HOUR

FEATURES = [
    "amount_vs_usual",
    "new_payee",
    "senior_sender",
    "urgent_memo",
    "repeat_to_payee_10m",
    "spend_burst_1h",
    "night_time",
    "young_sender",
    "young_receiver",
    "established_receiver",
    "new_account_fan_in",
    "receiver_fast_cashout",
]
SENDER_FEATURES = set(FEATURES[:8])
RECEIVER_FEATURES = set(FEATURES[8:])

SCAM_KEYWORDS = (
    "gift card",
    "urgent",
    "irs",
    "bail",
    "bitcoin",
    "crypto",
    "verify",
    "grandson",
    "granddaughter",
    "lawyer",
    "customs",
    "prize",
    "tax fix",
    "refund processing",
)


def find_scam_keyword(memo: str) -> str | None:
    text = memo.lower()
    for kw in SCAM_KEYWORDS:
        if kw in text:
            return kw
    return None


@dataclass
class SenderState:
    n: int = 0
    total: float = 0.0
    payees: set[str] = field(default_factory=set)
    recent: deque = field(default_factory=deque)  # (ts, payee, amount), last hour

    def avg(self, fallback: float) -> float:
        return self.total / self.n if self.n else fallback


@dataclass
class ReceiverState:
    senders: deque = field(default_factory=deque)  # (ts, sender), last 24h
    sender_counts: Counter = field(default_factory=Counter)
    inflow: deque = field(default_factory=deque)  # (ts, amount), last hour
    outflow: deque = field(default_factory=deque)  # (ts, amount), last hour
    inflow_sum: float = 0.0
    outflow_sum: float = 0.0


class FeatureState:
    def __init__(self) -> None:
        self.senders: dict[str, SenderState] = {}
        self.receivers: dict[str, ReceiverState] = {}

    # ---- pruning -------------------------------------------------------
    @staticmethod
    def _prune_sender(s: SenderState, now: float) -> None:
        while s.recent and now - s.recent[0][0] > HOUR:
            s.recent.popleft()

    @staticmethod
    def _prune_receiver(r: ReceiverState, now: float) -> None:
        while r.senders and now - r.senders[0][0] > DAY:
            _, who = r.senders.popleft()
            r.sender_counts[who] -= 1
            if r.sender_counts[who] <= 0:
                del r.sender_counts[who]
        while r.inflow and now - r.inflow[0][0] > HOUR:
            r.inflow_sum -= r.inflow.popleft()[1]
        while r.outflow and now - r.outflow[0][0] > HOUR:
            r.outflow_sum -= r.outflow.popleft()[1]

    # ---- features ------------------------------------------------------
    def extract(self, t: Txn) -> tuple[list[float], dict]:
        """Feature vector plus raw context used for plain-English reasons."""
        s = self.senders.get(t.sender_id)
        r = self.receivers.get(t.receiver_id)
        if s:
            self._prune_sender(s, t.ts)
        if r:
            self._prune_receiver(r, t.ts)

        avg = s.avg(t.amount) if s else t.amount
        ratio = t.amount / max(avg, 1.0)
        is_new_payee = not s or t.receiver_id not in s.payees
        repeats = sum(1 for ts, p, _ in s.recent if p == t.receiver_id and t.ts - ts <= 600) if s else 0
        burst = (sum(a for _, _, a in s.recent) if s else 0.0) + t.amount
        burst_ratio = burst / max(avg, 1.0)
        kw = find_scam_keyword(t.memo)
        hour = (t.ts % DAY) / HOUR
        fan_in = 0
        if r:
            fan_in = len(r.sender_counts) - (1 if t.sender_id in r.sender_counts else 0)
        young_recv = t.receiver_account_age_days < 30
        new_acct_fan_in = math.log1p(fan_in) if t.receiver_account_age_days < 90 else 0.0
        fast_cashout = bool(r and r.inflow_sum >= 300 and r.outflow_sum >= 0.6 * r.inflow_sum)

        x = [
            math.log1p(min(ratio, 100.0)),
            1.0 if is_new_payee else 0.0,
            1.0 if t.sender_age_band == "65+" else 0.0,
            1.0 if kw else 0.0,
            math.log1p(repeats),
            math.log1p(min(burst_ratio, 200.0)),
            1.0 if hour < 5 else 0.0,
            1.0 if t.sender_account_age_days < 30 else 0.0,
            1.0 if young_recv else 0.0,
            math.log1p(t.receiver_account_age_days / 365.0),
            new_acct_fan_in,
            1.0 if fast_cashout else 0.0,
        ]
        ctx = {
            "amount": t.amount,
            "avg": avg,
            "ratio": ratio,
            "repeats": repeats + 1,
            "burst": burst,
            "burst_ratio": burst_ratio,
            "keyword": kw,
            "fan_in": fan_in + 1,
            "sender_age_days": t.sender_account_age_days,
            "receiver_age_days": t.receiver_account_age_days,
            "senior": t.sender_age_band == "65+",
        }
        return x, ctx

    def update(self, t: Txn) -> None:
        s = self.senders.get(t.sender_id)
        if s is None:
            s = self.senders[t.sender_id] = SenderState()
        s.n += 1
        s.total += t.amount
        s.payees.add(t.receiver_id)
        s.recent.append((t.ts, t.receiver_id, t.amount))

        r = self.receivers.get(t.receiver_id)
        if r is None:
            r = self.receivers[t.receiver_id] = ReceiverState()
        r.senders.append((t.ts, t.sender_id))
        r.sender_counts[t.sender_id] += 1
        r.inflow.append((t.ts, t.amount))
        r.inflow_sum += t.amount

        # The sender's own outflow feeds the "fast cash-out" signal when
        # that sender is later on the receiving end.
        out = self.receivers.get(t.sender_id)
        if out is not None:
            out.outflow.append((t.ts, t.amount))
            out.outflow_sum += t.amount
