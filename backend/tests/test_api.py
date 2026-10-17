from fastapi.testclient import TestClient

from scamstopper.api import app


def test_score_stats_and_system():
    with TestClient(app) as client:
        assert client.get("/api/healthz").json() == {"ok": True}
        assert client.get("/api/system").json()["machine"]

        r = client.post("/api/score", json={
            "id": "t1", "ts": 30000, "sender_id": "u00001", "receiver_id": "x777",
            "amount": 2500, "memo": "urgent verify account", "sender_age_band": "65+",
            "receiver_account_age_days": 4,
        })
        assert r.status_code == 200
        d = r.json()
        assert d["action"] in {"hold", "step_up"}
        assert d["reasons"]

        s = client.get("/api/stats").json()
        assert s["processed"] == 1
        assert "precision" in s["model"]


def test_rejects_bad_amount():
    with TestClient(app) as client:
        r = client.post("/api/score", json={"id": "t", "ts": 1, "sender_id": "a",
                                            "receiver_id": "b", "amount": -5})
        assert r.status_code == 422
