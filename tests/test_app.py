from __future__ import annotations

import io
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from fastapi import HTTPException

from kaila.main import app
from kaila.catalog import CATALOG
from kaila.screen_style import SCREEN_STYLES
from kaila.services import youcam


@pytest.fixture()
def client():
    with TestClient(app) as test_client:
        yield test_client


def csrf_from_app(client: TestClient) -> str:
    response = client.get("/app")
    assert response.status_code == 200
    token = re.search(r'<meta name="csrf-token" content="([^"]+)"', response.text)
    assert token
    return token.group(1)


def png_bytes(size=(320, 420)) -> bytes:
    image = Image.new("RGB", size, (180, 120, 100))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def test_health_landing_app_and_static_assets(client: TestClient):
    assert client.get("/health").json() == {"status": "ok", "app": "Kaila"}
    landing = client.get("/")
    app_page = client.get("/app")
    css = client.get("/assets/style.css")
    js = client.get("/assets/app.js")
    assert landing.status_code == app_page.status_code == 200
    assert "Your favourite looks" in landing.text
    assert "Kaila" in app_page.text
    assert 'data-view-panel="colour-tone"' in app_page.text
    assert 'id="walkthrough-open"' in app_page.text
    assert css.status_code == js.status_code == 200
    assert "--font-scale" in css.text or "--scale" in css.text
    assert "IndexedDB" not in js.text  # no unnecessary internal/technical jargon in UI strings


def test_catalog_has_distinct_style_references_and_inspiration_not_skus(client: TestClient):
    payload = client.get("/api/catalog").json()
    assert len(payload["items"]) == len(CATALOG)
    assert len(payload["screen_styles"]) == len(SCREEN_STYLES) >= 6
    assert len({item["id"] for item in payload["items"]}) == len(CATALOG)
    assert all(item["image_url"].startswith("https://images.unsplash.com/") for item in CATALOG)
    assert all(style["source_url"].startswith("https://") for style in SCREEN_STYLES)


def test_config_only_exposes_capability_flags(client: TestClient):
    response = client.get("/api/config")
    assert response.status_code == 200
    payload = response.json()
    assert set(payload["capabilities"]) == {"virtual_try_on", "skin_analysis", "color_tone_analysis", "style_interpretation"}
    dumped = str(payload)
    assert "YCE_API_KEY" not in dumped and "GEMINI_API_KEY" not in dumped
    assert "local_profile" in payload


def test_recommendations_require_csrf(client: TestClient):
    csrf_from_app(client)
    response = client.post("/api/recommendations", json={"profile": {}, "limit": 4})
    assert response.status_code == 403


def test_recommendations_only_return_catalogue_ids_and_market_links(client: TestClient):
    csrf = csrf_from_app(client)
    payload = {
        "profile": {"market": "CA", "total_budget": 150, "per_item_budget": 45, "aesthetics": ["Minimal and modern"], "occasions": ["Everyday"], "colours": ["Cream", "Navy"]},
        "screen_style_id": "quiet-luxury-drama", "query": "tailored neutral", "limit": 5,
    }
    response = client.post("/api/recommendations", headers={"X-CSRF-Token": csrf}, json=payload)
    assert response.status_code == 200
    body = response.json()
    valid_ids = {item["id"] for item in CATALOG}
    assert body["recommendations"]
    assert len(body["recommendations"]) <= 5
    assert all(item["id"] in valid_ids for item in body["recommendations"])
    assert all(item["market"] == "CA" for item in body["recommendations"])
    assert all("google.com/search?tbm=shop&gl=ca" in item["retailer_search"][0]["url"] for item in body["recommendations"])
    assert all("under+45" in item["retailer_search"][0]["url"] or "under%2045" in item["retailer_search"][0]["url"] for item in body["recommendations"])
    assert all(item["target_guidance"].find("CAD 45") >= 0 for item in body["recommendations"])


def test_invalid_screen_style_rejected(client: TestClient):
    csrf = csrf_from_app(client)
    response = client.post("/api/recommendations", headers={"X-CSRF-Token": csrf}, json={"profile": {}, "screen_style_id": "not-a-real-style"})
    assert response.status_code == 400


def test_us_market_uses_usd_and_us_retailer_search(client: TestClient):
    csrf = csrf_from_app(client)
    response = client.post("/api/recommendations", headers={"X-CSRF-Token": csrf}, json={"profile": {"market": "US", "per_item_budget": 30}, "limit": 2})
    assert response.status_code == 200
    body = response.json()
    assert body["currency"] == "USD"
    assert body["recommendations"]
    assert all("gl=us" in item["retailer_search"][0]["url"] for item in body["recommendations"])
    assert all("Search Amazon US" == item["retailer_search"][1]["label"] for item in body["recommendations"])


def test_image_validation_reads_real_image_and_rejects_bad_content():
    raw = png_bytes()
    prepared, mime, name = youcam.prepare_image(raw, "selfie.png", "image/png", "selfie")
    assert prepared and mime == "image/png" and name.endswith(".png")
    with pytest.raises(HTTPException) as exc:
        youcam.prepare_image(b"not really an image", "selfie.png", "image/png", "selfie")
    assert exc.value.status_code == 415
    with pytest.raises(HTTPException) as exc2:
        youcam.prepare_image(raw, "selfie.gif", "image/png", "selfie")
    assert exc2.value.status_code == 415


def test_photo_selection_does_not_start_analysis_without_consent(client: TestClient):
    csrf = csrf_from_app(client)
    response = client.post(
        "/api/skin-analysis",
        headers={"X-CSRF-Token": csrf},
        data={"consent": "false", "actions": "hd_acne"},
        files={"photo": ("selfie.png", png_bytes(), "image/png")},
    )
    assert response.status_code == 400
    assert "Consent" in response.json()["detail"]


def test_skin_analysis_missing_provider_key_fails_gracefully(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    csrf = csrf_from_app(client)
    def unavailable():
        raise HTTPException(status_code=503, detail="This image feature is unavailable right now.")
    monkeypatch.setattr(youcam, "auth_headers", unavailable)
    response = client.post(
        "/api/skin-analysis",
        headers={"X-CSRF-Token": csrf},
        data={"consent": "true", "actions": "hd_redness,hd_acne"},
        files={"photo": ("selfie.png", png_bytes(), "image/png")},
    )
    assert response.status_code == 503
    assert response.json()["detail"] == "This image feature is unavailable right now."


def test_task_status_rejects_unknown_task_family(client: TestClient):
    response = client.get("/api/tasks/unknown/not-a-task")
    assert response.status_code == 404



def test_login_route_is_honest_when_oidc_is_not_configured(client: TestClient):
    response = client.get("/login")
    assert response.status_code == 200
    assert "Continue without an account" in response.text
    assert "no account is configured" in response.text.lower()
    assert client.get("/auth/login", follow_redirects=False).status_code == 303


def test_quiz_show_notes_feed_recommendations_and_try_on_accepts_individual_items():
    source = (Path(__file__).resolve().parents[1] / "public" / "assets" / "app.js").read_text(encoding="utf-8")
    assert "state.profile.showNotes || ''" in source
    assert "state.profile.screenStyles?.[0]" in source
    assert "state.catalog.items.find(item => `item:${item.id}` === selection)" in source
    assert "renderSkincareLinks(result.analysis || [])" in source
    assert "reported signals" in source or "reported" in source.lower()


def test_discovery_includes_the_requested_external_celebrity_style_sources(client: TestClient):
    sources = client.get("/api/catalog").json().get("style_sources", [])
    by_name = {source["name"]: source["url"] for source in sources}
    assert by_name["StarStyle"].startswith("https://")
    assert by_name["Star Style Man"].startswith("https://")
    assert by_name["The Budget Babe"].startswith("https://")
    assert by_name["CelebMafia"].startswith("https://")
    assert by_name["Steal Her Style"].startswith("https://")
    html = client.get("/app").text
    assert 'id="style-source-links"' in html
