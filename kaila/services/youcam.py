"""Server-side adapters for YouCam file uploads, Skin Analysis, colour tone, and VTO."""
from __future__ import annotations

import logging
import re
from io import BytesIO
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException
from PIL import Image, UnidentifiedImageError

from ..config import settings

logger = logging.getLogger("kaila.youcam")
ALLOWED_MIME = {"image/jpeg", "image/jpg", "image/png"}
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png"}
MAX_DIMENSION = 4096


def auth_headers() -> dict[str, str]:
    if not settings.youcam_api_key:
        raise HTTPException(status_code=503, detail="This image feature is unavailable right now.")
    return {"Authorization": f"Bearer {settings.youcam_api_key}", "Content-Type": "application/json"}


def prepare_image(raw: bytes, filename: str, content_type: str, label: str) -> tuple[bytes, str, str]:
    if not raw:
        raise HTTPException(status_code=400, detail=f"Choose a {label} before continuing.")
    if len(raw) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail=f"Choose a {label} smaller than 9.5 MB.")
    ext = Path(filename or "").suffix.lower()
    mime = (content_type or "").split(";", 1)[0].strip().lower()
    if mime not in ALLOWED_MIME or (ext and ext not in ALLOWED_EXTENSIONS):
        raise HTTPException(status_code=415, detail=f"Use a JPG, JPEG or PNG {label}.")
    try:
        image = Image.open(BytesIO(raw))
        image.verify()
        image = Image.open(BytesIO(raw)).convert("RGB")
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise HTTPException(status_code=415, detail=f"The selected {label} is not a readable image.") from exc
    width, height = image.size
    if min(width, height) < 128:
        raise HTTPException(status_code=400, detail=f"The {label} is too small. Choose an image at least 128 pixels on each side.")
    if max(width, height) > MAX_DIMENSION:
        image.thumbnail((MAX_DIMENSION, MAX_DIMENSION), Image.Resampling.LANCZOS)
        width, height = image.size
    output = BytesIO()
    is_png = mime == "image/png" and not ext.endswith((".jpg", ".jpeg"))
    if is_png:
        image.save(output, format="PNG", optimize=True)
        return output.getvalue(), "image/png", (Path(filename).stem or "image") + ".png"
    image.save(output, format="JPEG", quality=90, optimize=True)
    return output.getvalue(), "image/jpeg", (Path(filename).stem or "image") + ".jpg"


async def upload_image(raw: bytes, filename: str, content_type: str, *, label: str = "photo") -> str:
    prepared, mime, clean_name = prepare_image(raw, filename, content_type, label)
    provider_mime = "image/png" if mime == "image/png" else "image/jpg"
    payload: dict[str, Any] = {"files": [{"content_type": provider_mime, "file_name": clean_name, "file_size": len(prepared)}]}
    try:
        async with httpx.AsyncClient(timeout=settings.request_timeout_seconds, follow_redirects=True) as client:
            response = await client.post(f"{settings.youcam_api_base}/s2s/v2.0/file", headers=auth_headers(), json=payload)
            if response.is_error:
                logger.warning("YouCam file metadata request failed with status %s", response.status_code)
                _raise_provider_error(response.status_code, "The photo could not be prepared for analysis.")
            try:
                file_info = response.json()["data"]["files"][0]
                file_id = file_info["file_id"]
                upload_req = file_info["requests"][0]
                upload_url = upload_req["url"]
                upload_headers = upload_req.get("headers", {})
            except (ValueError, KeyError, IndexError, TypeError) as exc:
                logger.warning("YouCam returned an invalid file-upload response")
                raise HTTPException(status_code=502, detail="The image service returned an unexpected response.") from exc
            put_response = await client.put(upload_url, headers=upload_headers, content=prepared)
            if put_response.is_error:
                logger.warning("YouCam signed upload failed with status %s", put_response.status_code)
                raise HTTPException(status_code=502, detail="The photo could not be transferred. Try another image.")
        return str(file_id)
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="The image service took too long to respond. Try again.") from exc
    except httpx.HTTPError as exc:
        logger.warning("YouCam upload transport error: %s", type(exc).__name__)
        raise HTTPException(status_code=502, detail="The image service could not be reached. Try again.") from exc


def _raise_provider_error(status_code: int, fallback: str) -> None:
    if status_code == 401:
        detail = "The image service could not authorize this request."
    elif status_code == 429:
        detail = "The image service is at its current usage limit. Try again later."
    elif status_code >= 500:
        detail = "The image service is temporarily unavailable. Try again later."
    else:
        detail = fallback
    raise HTTPException(status_code=502, detail=detail)


def _task_id(payload: dict[str, Any]) -> str:
    task_id = payload.get("data", {}).get("task_id") if isinstance(payload.get("data"), dict) else None
    if not isinstance(task_id, (str, int)) or not str(task_id):
        raise HTTPException(status_code=502, detail="The image service did not return a task ID.")
    return str(task_id)


async def create_try_on(person_file_id: str, reference_file_id: str, garment_category: str = "auto") -> str:
    if garment_category not in {"auto", "full_body", "upper_body", "lower_body", "outer", "shoes"}:
        garment_category = "auto"
    body = {"src_file_id": person_file_id, "ref_file_id": reference_file_id, "garment_category": garment_category}
    return await _post_task("/s2s/v2.0/task/cloth-v4", body)


async def create_skin_analysis(file_id: str, actions: list[str] | None = None) -> str:
    allowed = {"hd_redness", "hd_oiliness", "hd_age_spot", "hd_radiance", "hd_moisture", "hd_dark_circle", "hd_eye_bag", "hd_firmness", "hd_texture", "hd_acne", "hd_pore", "hd_wrinkle", "hd_tear_trough", "hd_skin_type"}
    requested = [act for act in (actions or []) if act in allowed]
    # These are all HD outputs; don't mix HD and SD actions in a single task.
    if not requested:
        requested = ["hd_redness", "hd_oiliness", "hd_texture", "hd_acne", "hd_pore", "hd_moisture", "hd_skin_type"]
    body = {"src_file_id": file_id, "dst_actions": list(dict.fromkeys(requested)), "format": "json"}
    return await _post_task("/s2s/v2.1/task/skin-analysis", body)


async def create_color_tone(file_id: str) -> str:
    return await _post_task("/s2s/v2.0/task/skin-tone-analysis", {"src_file_id": file_id, "face_angle_strictness_level": "high"})


async def _post_task(path: str, body: dict[str, Any]) -> str:
    try:
        async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
            response = await client.post(f"{settings.youcam_api_base}{path}", headers=auth_headers(), json=body)
            if response.is_error:
                logger.warning("YouCam task creation failed (%s), endpoint family=%s", response.status_code, path.rsplit("/", 1)[-1])
                _raise_provider_error(response.status_code, "The image service could not start this request.")
            try:
                return _task_id(response.json())
            except ValueError as exc:
                raise HTTPException(status_code=502, detail="The image service returned an unexpected response.") from exc
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="The image service took too long to respond. Try again.") from exc
    except httpx.HTTPError as exc:
        logger.warning("YouCam task transport error: %s", type(exc).__name__)
        raise HTTPException(status_code=502, detail="The image service could not be reached. Try again.") from exc


async def task_status(task_kind: str, task_id: str) -> dict[str, Any]:
    paths = {"try-on": "/s2s/v2.0/task/cloth-v4", "skin-analysis": "/s2s/v2.1/task/skin-analysis", "color-tone": "/s2s/v2.0/task/skin-tone-analysis"}
    if task_kind not in paths or not task_id or len(task_id) > 256 or not re.fullmatch(r"[A-Za-z0-9_./+=-]+", task_id) or ".." in task_id:
        raise HTTPException(status_code=400, detail="This result request is invalid.")
    try:
        async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
            response = await client.get(f"{settings.youcam_api_base}{paths[task_kind]}/{task_id}", headers=auth_headers())
            if response.is_error:
                logger.warning("YouCam status request failed (%s), feature=%s", response.status_code, task_kind)
                _raise_provider_error(response.status_code, "The result could not be retrieved.")
            try:
                payload = response.json()
            except ValueError as exc:
                raise HTTPException(status_code=502, detail="The image service returned an unexpected result.") from exc
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="The image service took too long to return a result.") from exc
    except httpx.HTTPError as exc:
        logger.warning("YouCam result transport error: %s", type(exc).__name__)
        raise HTTPException(status_code=502, detail="The image service could not be reached. Try again.") from exc
    status = _normalize_status(payload)
    result: dict[str, Any] = {"status": status, "feature": task_kind}
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    if status == "error":
        result["message"] = data.get("error_message") or payload.get("error_message") or "The image service could not finish processing this photo. Try another image."
    elif status == "success":
        if task_kind == "try-on":
            result["image_url"] = _find_image_url(payload)
            if not result["image_url"]:
                result["status"] = "error"
                result["message"] = "The image service finished but did not return a usable result image. Try another reference photo."
        elif task_kind == "color-tone":
            results = data.get("results", {}) if isinstance(data.get("results"), dict) else {}
            result["colors"] = results.get("color") or data.get("color") or {}
            result["message"] = "Detected colour cues are optional styling guidance, not a rule about what you can wear."
        else:
            result["analysis"] = _summarize_skin_results(data)
            result["message"] = "These are cosmetic signals from a photograph, not a diagnosis. Lighting, makeup and image quality can affect results."
    return result


def _normalize_status(payload: dict[str, Any]) -> str:
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    raw = data.get("task_status") or data.get("status") or payload.get("task_status") or payload.get("status")
    if isinstance(raw, str):
        value = raw.lower()
        if value in {"success", "succeeded", "completed", "complete", "done"}:
            return "success"
        if value in {"error", "failed", "failure", "cancelled", "canceled"}:
            return "error"
    if data.get("results"):
        return "success"
    return "running"


def _find_image_url(value: Any) -> str | None:
    if isinstance(value, dict):
        for key, child in value.items():
            if key.lower() in {"image_url", "url", "result_url", "preview_url"} and isinstance(child, str) and child.startswith("https://"):
                if any(term in key.lower() for term in ("image", "result", "preview")) or key.lower() == "url":
                    return child
            found = _find_image_url(child)
            if found:
                return found
    elif isinstance(value, list):
        for child in value:
            found = _find_image_url(child)
            if found:
                return found
    return None


def _summarize_skin_results(data: dict[str, Any]) -> list[dict[str, Any]]:
    results = data.get("results") if isinstance(data.get("results"), dict) else data
    measures = results.get("measures") if isinstance(results.get("measures"), (dict, list)) else results
    output: list[dict[str, Any]] = []
    if isinstance(measures, dict):
        for key, value in measures.items():
            score = _extract_numeric(value)
            if score is None:
                continue
            normalized_key = str(key).replace("hd_", "").replace("_", " ").strip().title()
            output.append({"key": str(key), "label": normalized_key, "value": round(score, 2), "raw": _simple_value(value)})
    elif isinstance(measures, list):
        for item in measures:
            if not isinstance(item, dict):
                continue
            key = str(item.get("key") or item.get("name") or item.get("type") or "Measure")
            score = _extract_numeric(item)
            if score is None:
                continue
            output.append({"key": key, "label": key.replace("hd_", "").replace("_", " ").title(), "value": round(score, 2), "raw": _simple_value(item)})
    return output[:24]


def _extract_numeric(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, dict):
        for key in ("score", "value", "severity", "result"):
            if key in value:
                found = _extract_numeric(value[key])
                if found is not None:
                    return found
    return None


def _simple_value(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, dict):
        return {str(k): _simple_value(v) for k, v in list(value.items())[:12] if isinstance(v, (str, int, float, bool)) or v is None}
    return None


def validate_reference_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in {"images.unsplash.com", "images.pexels.com"}:
        raise HTTPException(status_code=400, detail="Choose a supported style reference image.")
    return url
