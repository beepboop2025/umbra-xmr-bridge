"""Bot configuration via pydantic-settings."""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All bot configuration is read from environment variables (or .env)."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Required
    BOT_TOKEN: str

    # Backend API
    API_BASE_URL: str = "http://localhost:8000"

    # Telegram Mini App URL (served by the frontend)
    WEBAPP_URL: str = ""

    # Telegram user IDs allowed to use /admin
    ADMIN_IDS: list[int] = []

    # Webhook (optional -- when unset the bot uses long-polling)
    WEBHOOK_URL: str = ""
    WEBHOOK_PATH: str = "/webhook/telegram"

    # Rate-limiting defaults
    MAX_ORDERS_PER_HOUR: int = 3
    MAX_MESSAGES_PER_MINUTE: int = 30

    # Order status polling interval in seconds
    STATUS_POLL_INTERVAL: int = 30

    @property
    def is_webhook_mode(self) -> bool:
        return bool(self.WEBHOOK_URL)

    @property
    def full_webhook_url(self) -> str:
        return f"{self.WEBHOOK_URL.rstrip('/')}{self.WEBHOOK_PATH}"


settings = Settings()  # type: ignore[call-arg]
