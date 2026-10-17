"""Synthetic instant-payment stream with injected scam scenarios.

All data is generated from a seed, so a demo or benchmark run is repeatable.
No real customer data is used.
"""

from __future__ import annotations

import heapq
import itertools
import math
import random
from dataclasses import dataclass, field

from .models import Txn

NORMAL_MEMOS = ["", "", "", "groceries", "rent", "dinner", "utilities", "gas", "phone bill", "thanks!"]
LEGIT_LARGE_MEMOS = ["apartment deposit", "tuition", "used car", "contractor", "wedding gift"]
GIFT_CARD_MEMOS = ["gift cards", "IRS payment urgent", "for grandson bail", "tax fix", "customs fee"]
LARGE_SCAM_MEMOS = ["urgent", "verify account", "refund processing", "", "safe account transfer"]

SCENARIOS = {"mule_fan_in": 0.35, "gift_card": 0.25, "new_payee_large": 0.25, "rapid_repeat": 0.15}


@dataclass
class User:
    id: str
    age_band: str
    account_age_days: int
    typical: float
    payees: list[str] = field(default_factory=list)


class Simulator:
    def __init__(
        self,
        seed: int = 7,
        n_users: int = 2000,
        fraud_rate: float = 0.02,
        mean_gap_s: float = 2.0,
        start_ts: float = 8 * 3600.0,
    ) -> None:
        self.rng = random.Random(seed)
        self.fraud_rate = fraud_rate
        self.mean_gap_s = mean_gap_s
        self.ts = start_ts
        self._seq = itertools.count()
        self._pending: list[tuple[float, int, Txn]] = []
        self.account_age: dict[str, int] = {}

        rng = self.rng
        self.merchants = [f"m{i:03d}" for i in range(60)]
        for m in self.merchants:
            self.account_age[m] = rng.randint(800, 5000)
        self.mules = [f"x{i:03d}" for i in range(40)]
        for m in self.mules:
            # Most mules are fresh accounts; some are aged or bought accounts.
            self.account_age[m] = rng.randint(3, 25) if rng.random() < 0.7 else rng.randint(40, 600)
        self.exchanges = [f"e{i:02d}" for i in range(5)]
        for e in self.exchanges:
            self.account_age[e] = rng.randint(1000, 3000)

        self.users: list[User] = []
        for i in range(n_users):
            band = rng.choices(["18-34", "35-64", "65+"], weights=[0.35, 0.5, 0.15])[0]
            u = User(
                id=f"u{i:05d}",
                age_band=band,
                account_age_days=rng.randint(10, 400) if band == "18-34" else rng.randint(200, 9000),
                typical=math.exp(rng.gauss(math.log(60), 0.6)),
            )
            self.account_age[u.id] = u.account_age_days
            self.users.append(u)
        for u in self.users:
            k = rng.randint(3, 6)
            u.payees = rng.sample(self.merchants, k - 1) + [rng.choice(self.users).id]
        self.seniors = [u for u in self.users if u.age_band == "65+"]
        self._by_id = {u.id: u for u in self.users}
        self._new_ids = itertools.count()

    # ---- helpers -------------------------------------------------------
    def _txn(self, ts: float, sender: User | str, receiver: str, amount: float, memo: str,
             fraud: bool, scenario: str | None) -> Txn:
        if isinstance(sender, str):
            s_id, band, s_age = sender, "18-34", self.account_age.get(sender, 365)
        else:
            s_id, band, s_age = sender.id, sender.age_band, sender.account_age_days
        return Txn(
            id=f"t{next(self._seq):08d}",
            ts=ts,
            sender_id=s_id,
            receiver_id=receiver,
            amount=round(max(amount, 1.0), 2),
            memo=memo,
            sender_age_band=band,
            sender_account_age_days=s_age,
            receiver_account_age_days=self.account_age.get(receiver, 365),
            label_fraud=fraud,
            scenario=scenario,
        )

    def _schedule(self, t: Txn) -> None:
        heapq.heappush(self._pending, (t.ts, next(self._seq), t))

    def _new_account(self, prefix: str, age_lo: int, age_hi: int) -> str:
        acct = f"{prefix}{next(self._new_ids):05d}"
        self.account_age[acct] = self.rng.randint(age_lo, age_hi)
        return acct

    def _victim(self, senior_p: float) -> User:
        if self.seniors and self.rng.random() < senior_p:
            return self.rng.choice(self.seniors)
        return self.rng.choice(self.users)

    # ---- normal traffic ------------------------------------------------
    def _normal(self, ts: float) -> Txn:
        rng = self.rng
        u = rng.choice(self.users)
        roll = rng.random()
        if roll < 0.88:
            to = rng.choice(u.payees)
            amt = math.exp(rng.gauss(math.log(u.typical), 0.5))
            memo = rng.choice(NORMAL_MEMOS)
        elif roll < 0.95:
            # New friend or merchant; some friends just opened their account.
            to = (self._new_account("n", 2, 29) if rng.random() < 0.3
                  else rng.choice(self.users).id)
            amt = math.exp(rng.gauss(math.log(u.typical), 0.6))
            memo = rng.choice(NORMAL_MEMOS)
        elif roll < 0.98:
            # Legitimate large payment to a new, established payee.
            to = self._new_account("p", 400, 4000)
            amt = u.typical * rng.uniform(5, 15)
            memo = rng.choice(LEGIT_LARGE_MEMOS)
        else:
            to = rng.choice(u.payees)
            amt = math.exp(rng.gauss(math.log(u.typical), 0.5))
            memo = rng.choice(["refund", "urgent - rent late", "bitcoin meetup dinner"])
        return self._txn(ts, u, to, amt, memo, False, None)

    # ---- scam scenarios ------------------------------------------------
    def _start_scenario(self, ts: float) -> None:
        rng = self.rng
        kind = rng.choices(list(SCENARIOS), weights=list(SCENARIOS.values()))[0]
        mule = rng.choice(self.mules)
        if kind == "gift_card":
            v = self._victim(0.8)
            t = ts
            memo = rng.choice(GIFT_CARD_MEMOS)
            for _ in range(rng.randint(3, 5)):
                self._schedule(self._txn(t, v, mule, rng.uniform(200, 500), memo, True, kind))
                t += rng.uniform(120, 480)
        elif kind == "new_payee_large":
            v = self._victim(0.6)
            self._schedule(self._txn(ts, v, mule, v.typical * rng.uniform(8, 20),
                                     rng.choice(LARGE_SCAM_MEMOS), True, kind))
        elif kind == "rapid_repeat":
            v = self._victim(0.5)
            t = ts
            for _ in range(rng.randint(4, 6)):
                self._schedule(self._txn(t, v, mule, v.typical * rng.uniform(2, 4), "", True, kind))
                t += rng.uniform(60, 180)
        else:  # mule_fan_in, then cash-out to an exchange
            total = 0.0
            t = ts
            for v in rng.sample(self.users, rng.randint(6, 10)):
                if rng.random() < 0.4 and self.seniors:
                    v = rng.choice(self.seniors)
                amt = rng.uniform(150, 900)
                total += amt
                self._schedule(self._txn(t, v, mule, amt, rng.choice(["", "", "invoice", "deposit"]),
                                         True, kind))
                t += rng.uniform(60, 420)
            self._schedule(self._txn(t + rng.uniform(60, 300), mule, rng.choice(self.exchanges),
                                     total * rng.uniform(0.8, 0.95), "", True, "cash_out"))

    # ---- public API ----------------------------------------------------
    def warmup(self) -> list[Txn]:
        """Two ordinary payments to every regular payee, so history exists."""
        out = []
        ts = self.ts - 7 * 24 * 3600.0
        for u in self.users:
            for p in u.payees:
                for _ in range(2):
                    ts += 1.0
                    amt = math.exp(self.rng.gauss(math.log(u.typical), 0.4))
                    out.append(self._txn(ts, u, p, amt, "", False, None))
        return out

    def next(self) -> Txn:
        self.ts += self.rng.expovariate(1.0 / self.mean_gap_s)
        if not (self._pending and self._pending[0][0] <= self.ts):
            if self.rng.random() >= self.fraud_rate:
                return self._normal(self.ts)
            self._start_scenario(self.ts)
        t = heapq.heappop(self._pending)[2]
        t.ts = self.ts  # keep the stream time-ordered
        return t
