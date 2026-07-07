"""
Umbra Bridge — Risk Engine
~~~~~~~~~~~~~~~~~~~~~~~~~~
FastAPI service providing real-time risk assessment for cross-chain bridge
operations.  Evaluates transaction risk, tracks exposure per chain, monitors
liquidity depth, and detects anomalous swap patterns.

Endpoints:
    POST /risk/score       — Score a pending order for risk
    GET  /risk/exposure     — Current exposure breakdown by chain
    GET  /risk/liquidity    — Liquidity depth across chains
    POST /risk/anomaly      — Detect anomalies in recent swap patterns
    POST /v1/risk/anomaly   — Statistical drain / withdrawal anomaly scores
    GET  /health            — Liveness probe
"""

from contextlib import asynccontextmanager
from datetime import datetime, timezone

import asyncpg
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel
from pydantic_settings import BaseSettings

from models.exposure import ExposureTracker
from models.liquidity import LiquidityAnalyzer
from services.anomaly import drain_pattern_score, round_amount_ratio, zscore_anomaly
from services.risk_scorer import RiskScorer


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

class Settings(BaseSettings):
    database_url: str  # required — no default
    redis_url: str = "redis://localhost:6379"
    api_key: str = ""  # Internal API key for service-to-service auth
    # Risk thresholds
    max_single_order_usd: float = 50_000.0
    max_daily_volume_usd: float = 500_000.0
    max_chain_exposure_pct: float = 40.0  # no single chain > 40% of total
    anomaly_z_threshold: float = 2.5

    class Config:
        env_prefix = "RISK_"


settings = Settings()


# ---------------------------------------------------------------------------
# Lifespan (DB pool)
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.db = await asyncpg.create_pool(settings.database_url, min_size=2, max_size=10)
    app.state.scorer = RiskScorer(settings)
    app.state.exposure = ExposureTracker(settings)
    app.state.liquidity = LiquidityAnalyzer(settings)
    yield
    await app.state.db.close()


app = FastAPI(
    title="Umbra Risk Engine",
    version="0.1.0",
    lifespan=lifespan,
)


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

class RiskScoreRequest(BaseModel):
    order_id: str
    source_chain: str
    dest_chain: str
    from_amount: float
    to_amount: float
    from_currency: str
    to_currency: str
    dest_address: str
    ip_address: str | None = None
    telegram_user_id: int | None = None


class RiskScoreResponse(BaseModel):
    order_id: str
    risk_score: float  # 0.0 (safe) – 1.0 (critical)
    risk_level: str  # low / medium / high / critical
    flags: list[str]
    recommendation: str  # approve / review / reject
    details: dict


class AnomalyRequest(BaseModel):
    window_hours: int = 24
    chain: str | None = None


class WithdrawalAnomalyRequest(BaseModel):
    withdrawal_amounts: list[float]
    window_minutes: float = 60.0
    historical_amounts: list[float] = []


# ---------------------------------------------------------------------------
# Auth dependency for internal API calls
# ---------------------------------------------------------------------------

async def verify_api_key(x_api_key: str | None = Header(None)):
    """Verify internal API key for risk endpoints. Skipped if no key configured."""
    if settings.api_key and x_api_key != settings.api_key:
        raise HTTPException(status_code=403, detail="Invalid or missing API key")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    return {"status": "ok", "service": "risk-engine", "timestamp": datetime.now(timezone.utc).isoformat()}


@app.post("/risk/score", response_model=RiskScoreResponse, dependencies=[Depends(verify_api_key)])
async def score_order(req: RiskScoreRequest):
    """Score a bridge order for risk before execution."""
    db = app.state.db
    scorer: RiskScorer = app.state.scorer

    try:
        result = await scorer.score(db, req)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return result


@app.get("/risk/exposure", dependencies=[Depends(verify_api_key)])
async def get_exposure():
    """Return current exposure breakdown by chain."""
    db = app.state.db
    tracker: ExposureTracker = app.state.exposure

    try:
        exposure = await tracker.compute(db)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return exposure


@app.get("/risk/liquidity", dependencies=[Depends(verify_api_key)])
async def get_liquidity():
    """Return liquidity depth estimates across chains."""
    db = app.state.db
    analyzer: LiquidityAnalyzer = app.state.liquidity

    try:
        liquidity = await analyzer.compute(db)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return liquidity


@app.post("/risk/anomaly", dependencies=[Depends(verify_api_key)])
async def detect_anomalies(req: AnomalyRequest):
    """Detect anomalous swap patterns in recent history."""
    db = app.state.db
    scorer: RiskScorer = app.state.scorer

    try:
        anomalies = await scorer.detect_anomalies(db, req.window_hours, req.chain)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"anomalies": anomalies, "window_hours": req.window_hours}


@app.post("/v1/risk/anomaly", dependencies=[Depends(verify_api_key)])
async def score_withdrawal_anomaly(req: WithdrawalAnomalyRequest):
    """Score a window of withdrawals for drain-style anomalies.

    Pure statistical checks (services/anomaly.py) — no DB access, so this can
    be called on hot paths (e.g. by the backend sentinel before releasing a
    withdrawal batch).
    """
    largest = max(req.withdrawal_amounts) if req.withdrawal_amounts else 0.0
    z_result = zscore_anomaly(req.historical_amounts, largest)
    drain = drain_pattern_score(req.withdrawal_amounts, req.window_minutes)
    round_ratio = round_amount_ratio(req.withdrawal_amounts)

    z_component = (
        min(abs(z_result.robust_z) / z_result.threshold, 1.0)
        if z_result.threshold > 0
        else 0.0
    )
    score = round(min(1.0, 0.45 * drain + 0.35 * z_component + 0.20 * round_ratio), 4)
    anomalous = z_result.is_anomaly or drain >= 0.7 or score >= 0.6

    return {
        "zscore": {
            "is_anomaly": z_result.is_anomaly,
            "robust_z": round(z_result.robust_z, 4),
            "median": z_result.median,
            "mad": z_result.mad,
            "threshold": z_result.threshold,
        },
        "drain_pattern_score": round(drain, 4),
        "round_amount_ratio": round(round_ratio, 4),
        "anomalous": anomalous,
        "score": score,
    }
