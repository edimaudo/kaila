"""Kaila FastAPI application."""
from __future__ import annotations

import logging
import os
import secrets
from pathlib import Path
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field
from starlette.middleware.sessions import SessionMiddleware

from .catalog import catalog_payload
from .config import settings
from .recommender import recommend
from .screen_style import get_screen_style
from .services.gemini import interpret_style
from .services.youcam import (
    create_color_tone,
    create_skin_analysis,
    create_try_on,
    prepare_image,
    task_status,
    upload_image,
    validate_reference_url,
)

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "public" / "assets"
TEMPLATES = ROOT / "templates"
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("kaila")

app = FastAPI(title="Kaila", version="1.0.0", description="Screen-inspired personal styling and virtual try-on.")
if os.getenv("VERCEL", "0") == "1" and not settings.session_secret:
    raise RuntimeError("Set SESSION_SECRET in the hosting environment before deploying Kaila.")
if settings.auth_required and not settings.oidc_enabled:
    raise RuntimeError("AUTH_REQUIRED is enabled, but OpenID Connect is not fully configured.")
secret = settings.session_secret or "local-development-only-change-this-secret"
app.add_middleware(SessionMiddleware, secret_key=secret, session_cookie="kaila_session", same_site="lax", https_only=os.getenv("VERCEL", "0") == "1", max_age=60 * 60 * 12)
if ASSETS.exists():
    app.mount("/assets", StaticFiles(directory=str(ASSETS)), name="assets")
templates = Jinja2Templates(directory=str(TEMPLATES))

oauth = None
if settings.oidc_enabled:
    from authlib.integrations.starlette_client import OAuth
    oauth = OAuth()
    oauth.register(
        name="kaila",
        server_metadata_url=settings.oidc_discovery_url,
        client_id=settings.oidc_client_id,
        client_secret=settings.oidc_client_secret,
        client_kwargs={"scope": "openid profile email"},
    )


def signed_in_user(request: Request) -> dict | None:
    user = request.session.get("user")
    return user if isinstance(user, dict) else None


def require_login(request: Request) -> None:
    if settings.auth_required and not signed_in_user(request):
        raise HTTPException(status_code=401, detail="Sign in to continue.")


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


def csrf_for(request: Request) -> str:
    token = request.session.get("csrf")
    if not token:
        token = secrets.token_urlsafe(32)
        request.session["csrf"] = token
    return token


def require_csrf(request: Request) -> None:
    given = request.headers.get("x-csrf-token", "")
    expected = str(request.session.get("csrf", ""))
    if not given or not expected or not secrets.compare_digest(given, expected):
        raise HTTPException(status_code=403, detail="Your session has expired. Refresh the page and try again.")


class RecommendationInput(BaseModel):
    profile: dict = Field(default_factory=dict)
    query: str = Field(default="", max_length=240)
    screen_style_id: str = Field(default="", max_length=80)
    limit: int = Field(default=8, ge=1, le=12)


@app.get("/health")
async def health():
    return {"status": "ok", "app": "Kaila"}


@app.get("/", response_class=HTMLResponse)
async def landing(request: Request):
    return templates.TemplateResponse(request, "landing.html", {
        "csrf_token": csrf_for(request), "auth_enabled": settings.oidc_enabled, "signed_in": bool(signed_in_user(request))
    })


@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request, error: str | None = None):
    return templates.TemplateResponse(request, "login.html", {"auth_enabled": settings.oidc_enabled, "error": bool(error)})


@app.get("/auth/login")
async def auth_login(request: Request):
    if not oauth:
        return RedirectResponse(url="/login", status_code=303)
    callback_url = str(request.url_for("auth_callback"))
    return await oauth.kaila.authorize_redirect(request, callback_url)


@app.get("/auth/callback", name="auth_callback")
async def auth_callback(request: Request):
    if not oauth:
        return RedirectResponse(url="/login", status_code=303)
    try:
        token = await oauth.kaila.authorize_access_token(request)
        userinfo = token.get("userinfo")
        if not isinstance(userinfo, dict):
            userinfo = await oauth.kaila.userinfo(token=token)
        if not isinstance(userinfo, dict) or not userinfo.get("sub"):
            raise HTTPException(status_code=403, detail="The identity provider did not return a valid user profile.")
        request.session["user"] = {
            "sub": str(userinfo.get("sub")),
            "email": str(userinfo.get("email") or ""),
            "name": str(userinfo.get("name") or userinfo.get("preferred_username") or "Signed-in user"),
        }
        return RedirectResponse(url="/app", status_code=303)
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("OIDC callback failed (%s)", type(exc).__name__)
        return RedirectResponse(url="/login?error=1", status_code=303)


@app.post("/logout")
async def logout(request: Request, csrf: str = Form(...)):
    expected = str(request.session.get("csrf", ""))
    if not expected or not secrets.compare_digest(csrf, expected):
        raise HTTPException(status_code=403, detail="Your session has expired. Refresh the page and try again.")
    request.session.clear()
    return RedirectResponse(url="/", status_code=303)


@app.get("/app", response_class=HTMLResponse)
async def app_page(request: Request):
    if settings.auth_required and not signed_in_user(request):
        return RedirectResponse(url="/login", status_code=303)
    user = signed_in_user(request)
    return templates.TemplateResponse(request, "app.html", {
        "csrf_token": csrf_for(request), "auth_enabled": settings.oidc_enabled,
        "signed_in": bool(user), "user_name": user.get("name", "") if user else ""
    })


@app.get("/api/config")
async def public_config(request: Request):
    return {
        "csrf_token": csrf_for(request),
        "capabilities": {
            "virtual_try_on": bool(settings.youcam_api_key),
            "skin_analysis": bool(settings.youcam_api_key),
            "color_tone_analysis": bool(settings.youcam_api_key),
            "style_interpretation": bool(settings.gemini_api_key),
        },
        "local_profile": True,
    }


@app.get("/api/catalog")
async def get_catalog(request: Request):
    return catalog_payload()


@app.post("/api/recommendations")
async def recommendations(body: RecommendationInput, request: Request):
    require_login(request)
    require_csrf(request)
    style = get_screen_style(body.screen_style_id) if body.screen_style_id else None
    if body.screen_style_id and style is None:
        raise HTTPException(status_code=400, detail="Choose a screen-style reference from the available collection.")
    interpretation = await interpret_style(body.query, style)
    enriched_query = body.query
    if interpretation:
        enriched_query = " ".join([enriched_query, *interpretation.get("tags", []), *interpretation.get("colours", [])]).strip()
    result = recommend(body.profile, query=enriched_query, screen_style_id=body.screen_style_id, limit=body.limit)
    result["style_interpretation"] = interpretation
    result["explanation"] = (
        "Matches are selected from Kaila's curated style catalogue using your chosen reference, preferences and budget search targets. "
        "Retailer links open current search listings; Kaila does not claim that a specific product or price is verified."
    )
    return result


async def read_upload(upload: UploadFile, label: str) -> tuple[bytes, str, str]:
    raw = await upload.read(settings.max_upload_bytes + 1)
    return prepare_image(raw, upload.filename or "image.jpg", upload.content_type or "", label)


async def download_reference(url: str) -> tuple[bytes, str, str]:
    validate_reference_url(url)
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=False) as client:
            response = await client.get(url)
            if response.is_error:
                raise HTTPException(status_code=502, detail="The selected style reference could not be loaded. Choose another style.")
            content_type = response.headers.get("content-type", "").split(";", 1)[0].lower()
            raw = response.content
            filename = Path(urlparse(url).path).name or "style-reference.jpg"
            return prepare_image(raw, filename, content_type, "style reference image")
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="The style reference took too long to load. Choose another style.") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="The selected style reference could not be loaded.") from exc


@app.post("/api/try-on")
async def start_try_on(
    request: Request,
    photo: UploadFile = File(...),
    consent: bool = Form(...),
    item_image_url: str = Form(...),
    garment_category: str = Form(default="auto"),
):
    require_login(request)
    require_csrf(request)
    if not consent:
        raise HTTPException(status_code=400, detail="Consent is required before sending photos for virtual try-on.")
    person_bytes, person_mime, person_name = await read_upload(photo, "full-body try-on photo")
    ref_bytes, ref_mime, ref_name = await download_reference(item_image_url)
    person_id = await upload_image(person_bytes, person_name, person_mime, label="full-body try-on photo")
    ref_id = await upload_image(ref_bytes, ref_name, ref_mime, label="style reference image")
    task_id = await create_try_on(person_id, ref_id, garment_category)
    return {"task_id": task_id, "feature": "try-on", "message": "Your virtual try-on has started."}


async def _start_analysis(request: Request, photo: UploadFile, consent: bool, kind: str, actions: str = "") -> dict:
    require_login(request)
    require_csrf(request)
    if not consent:
        raise HTTPException(status_code=400, detail="Consent is required before sending this photo for analysis.")
    raw, mime, filename = await read_upload(photo, "front-facing selfie")
    file_id = await upload_image(raw, filename, mime, label="front-facing selfie")
    if kind == "skin-analysis":
        selected = [part.strip() for part in actions.split(",") if part.strip()]
        task_id = await create_skin_analysis(file_id, selected)
    else:
        task_id = await create_color_tone(file_id)
    return {"task_id": task_id, "feature": kind, "message": "Your analysis has started."}


@app.post("/api/skin-analysis")
async def skin_analysis(request: Request, photo: UploadFile = File(...), consent: bool = Form(...), actions: str = Form(default="")):
    return await _start_analysis(request, photo, consent, "skin-analysis", actions)


@app.post("/api/color-tone-analysis")
async def color_tone_analysis(request: Request, photo: UploadFile = File(...), consent: bool = Form(...)):
    return await _start_analysis(request, photo, consent, "color-tone")


@app.get("/api/tasks/{feature}/{task_id:path}")
async def get_task(feature: str, task_id: str, request: Request):
    require_login(request)
    csrf_for(request)
    if feature not in {"try-on", "skin-analysis", "color-tone"}:
        raise HTTPException(status_code=404, detail="This result type is not available.")
    return await task_status(feature, task_id)


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    if request.url.path.startswith("/api/"):
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
