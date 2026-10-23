"""Optional bounded Gemini interpretation. Recommendations still come from the known catalogue."""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from ..config import settings
from ..catalog import CATALOG
from ..screen_style import SCREEN_STYLES

logger = logging.getLogger("kaila.gemini")


async def interpret_style(query: str, selected_style: dict | None) -> dict[str, Any] | None:
    if not settings.gemini_api_key or not query.strip():
        return None
    try:
        from google import genai  # optional runtime dependency
        allowed_tags = sorted({tag for item in CATALOG for tag in item["tags"]})
        allowed_colours = sorted({colour for item in CATALOG for colour in item["colours"]})
        context = {"selected_reference": {"title": selected_style.get("title"), "description": selected_style.get("description"), "tags": selected_style.get("tags")} if selected_style else None,
                   "user_request": query,
                   "allowed_tags": allowed_tags,
                   "allowed_colours": allowed_colours}
        prompt = (
            "Translate the user's fashion inspiration into bounded styling tags. Return JSON only with keys `tags`, `colours`, `summary`. "
            "Use only strings in allowed_tags for tags and allowed_colours for colours. Do not name products, retailers, prices, SKUs, or assert inventory. "
            "Keep summary under 35 words, practical and non-prescriptive. Context: " + json.dumps(context)
        )
        def run() -> Any:
            client = genai.Client(api_key=settings.gemini_api_key)
            response = client.models.generate_content(model=settings.gemini_model, contents=prompt, config={"response_mime_type": "application/json"})
            return json.loads(response.text or "{}")
        payload = await asyncio.wait_for(asyncio.to_thread(run), timeout=8.0)
        if not isinstance(payload, dict):
            return None
        tags = [x for x in payload.get("tags", []) if isinstance(x, str) and x in allowed_tags][:10]
        colours = [x for x in payload.get("colours", []) if isinstance(x, str) and x in allowed_colours][:8]
        summary = payload.get("summary", "")
        return {"tags": tags, "colours": colours, "summary": summary[:240] if isinstance(summary, str) else ""}
    except Exception as exc:
        logger.info("Optional style interpretation unavailable (%s)", type(exc).__name__)
        return None
