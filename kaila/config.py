"""Environment-based configuration for Kaila."""
from __future__ import annotations

import os
from dataclasses import dataclass

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass


@dataclass(frozen=True)
class Settings:
    youcam_api_key: str = os.getenv("YCE_API_KEY", "").strip()
    youcam_api_base: str = os.getenv("YCE_API_BASE", "https://yce-api-01.makeupar.com").strip().rstrip("/")
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "").strip()
    gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-3.6-flash").strip() or "gemini-3.6-flash"
    session_secret: str = os.getenv("SESSION_SECRET", "").strip()
    oidc_discovery_url: str = os.getenv("OIDC_DISCOVERY_URL", "").strip()
    oidc_client_id: str = os.getenv("OIDC_CLIENT_ID", "").strip()
    oidc_client_secret: str = os.getenv("OIDC_CLIENT_SECRET", "").strip()
    auth_required: bool = os.getenv("AUTH_REQUIRED", "0").strip().lower() in {"1", "true", "yes"}
    max_upload_bytes: int = 9_500_000
    request_timeout_seconds: float = 30.0

    @property
    def oidc_enabled(self) -> bool:
        return bool(self.oidc_discovery_url and self.oidc_client_id and self.oidc_client_secret)


settings = Settings()
