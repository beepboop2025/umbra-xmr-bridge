"""Async HTTP client for the FastAPI backend at API_BASE_URL."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from bot.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Retry / timeout policy
# ---------------------------------------------------------------------------
_TIMEOUT = httpx.Timeout(connect=5.0, read=15.0, write=10.0, pool=5.0)
_MAX_RETRIES = 2


class APIError(Exception):
    """Raised when the backend returns an unexpected status."""

    def __init__(self, status_code: int, detail: str = ""):
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"API {status_code}: {detail}")


class BridgeAPIClient:
    """Thin wrapper around httpx.AsyncClient that speaks to the bridge backend."""

    def __init__(self) -> None:
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=settings.API_BASE_URL,
                timeout=_TIMEOUT,
                headers={"User-Agent": "XMRBridgeBot/1.0"},
            )
        return self._client

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    # ------------------------------------------------------------------
    # Generic request helper with retries
    # ------------------------------------------------------------------
    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any] | list[Any]:
        client = await self._get_client()
        last_exc: Exception | None = None

        for attempt in range(_MAX_RETRIES + 1):
            try:
                resp = await client.request(method, path, json=json, params=params)
                if resp.status_code >= 500 and attempt < _MAX_RETRIES:
                    logger.warning(
                        "Backend %s %s returned %s, retrying (%d/%d)",
                        method, path, resp.status_code, attempt + 1, _MAX_RETRIES,
                    )
                    continue
                if resp.status_code >= 400:
                    detail = resp.text[:300]
                    try:
                        detail = resp.json().get("detail", detail)
                    except Exception:
                        pass
                    raise APIError(resp.status_code, str(detail))
                return resp.json()
            except httpx.HTTPStatusError as exc:
                last_exc = exc
                if attempt < _MAX_RETRIES:
                    continue
            except httpx.TimeoutException as exc:
                last_exc = exc
                logger.warning("Timeout on %s %s (attempt %d)", method, path, attempt + 1)
                if attempt < _MAX_RETRIES:
                    continue
            except httpx.HTTPError as exc:
                last_exc = exc
                logger.error("HTTP error on %s %s: %s", method, path, exc)
                if attempt < _MAX_RETRIES:
                    continue

        raise last_exc or RuntimeError("request failed with no exception captured")

    # ------------------------------------------------------------------
    # Public API methods
    # ------------------------------------------------------------------

    async def fetch_rate(self, from_currency: str, to_currency: str) -> dict[str, Any]:
        """GET /api/rates?from=XMR&to=TON  ->  {rate, change_24h, ...}"""
        data = await self._request(
            "GET", "/api/rates",
            params={"from_currency": from_currency, "to_currency": to_currency},
        )
        return data  # type: ignore[return-value]

    async def fetch_all_rates(self) -> list[dict[str, Any]]:
        """GET /api/rates/all  ->  list of rate objects."""
        data = await self._request("GET", "/api/rates/all")
        return data  # type: ignore[return-value]

    async def create_order(
        self,
        *,
        tg_user_id: int,
        from_currency: str,
        to_currency: str,
        amount: float,
        destination_address: str,
        slippage: float = 0.5,
    ) -> dict[str, Any]:
        """POST /api/orders  ->  order object with deposit_address."""
        payload = {
            "tg_user_id": tg_user_id,
            "from_currency": from_currency,
            "to_currency": to_currency,
            "amount": amount,
            "destination_address": destination_address,
            "slippage": slippage,
        }
        data = await self._request("POST", "/api/orders", json=payload)
        return data  # type: ignore[return-value]

    async def get_order(self, order_id: str) -> dict[str, Any]:
        """GET /api/orders/{order_id}."""
        data = await self._request("GET", f"/api/orders/{order_id}")
        return data  # type: ignore[return-value]

    async def list_orders(
        self, tg_user_id: int, *, limit: int = 10, offset: int = 0,
    ) -> list[dict[str, Any]]:
        """GET /api/orders?tg_user_id=...&limit=...&offset=..."""
        data = await self._request(
            "GET", "/api/orders",
            params={"tg_user_id": tg_user_id, "limit": limit, "offset": offset},
        )
        return data  # type: ignore[return-value]

    async def cancel_order(self, order_id: str) -> dict[str, Any]:
        """POST /api/orders/{order_id}/cancel."""
        data = await self._request("POST", f"/api/orders/{order_id}/cancel")
        return data  # type: ignore[return-value]

    async def get_stats(self) -> dict[str, Any]:
        """GET /api/admin/stats  ->  aggregated stats for admin panel."""
        data = await self._request("GET", "/api/admin/stats")
        return data  # type: ignore[return-value]

    async def get_pending_orders(self) -> list[dict[str, Any]]:
        """GET /api/admin/orders/pending."""
        data = await self._request("GET", "/api/admin/orders/pending")
        return data  # type: ignore[return-value]


# Singleton instance -- import this everywhere
api_client = BridgeAPIClient()
