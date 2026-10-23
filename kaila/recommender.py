"""Deterministic, bounded matching: output IDs always come from the curated catalogue."""
from __future__ import annotations

import re
from typing import Any

from .catalog import CATALOG
from .screen_style import SCREEN_STYLES, get_screen_style


def _terms(text: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9]+", str(text).lower()) if len(t) > 2}


def recommend(profile: dict[str, Any], *, query: str = "", screen_style_id: str = "", limit: int = 8) -> dict:
    style = get_screen_style(screen_style_id) if screen_style_id else None
    query_terms = _terms(query)
    selected_aesthetics = _terms(" ".join(profile.get("aesthetics", []) or []))
    occasions = _terms(" ".join(profile.get("occasions", []) or []))
    preferred_colours = _terms(" ".join(profile.get("colours", []) or []))
    if profile.get("colour_notes"):
        preferred_colours |= _terms(profile["colour_notes"])
    style_terms = set(_terms(" ".join((style or {}).get("tags", [])))) | set(_terms(" ".join((style or {}).get("aesthetic", []))))
    if style:
        occasions |= _terms(" ".join(style.get("occasions", [])))
        preferred_colours |= _terms(" ".join(style.get("colours", [])))
    market = "US" if str(profile.get("market", "CA")).upper() in {"US", "USA", "UNITED STATES"} else "CA"
    requested_item_budget = _as_number(profile.get("per_item_budget"))
    total_budget = _as_number(profile.get("total_budget"))
    # A total-look budget conservatively sets a three-piece planning ceiling (e.g. top,
    # bottom, layer). This affects the retailer search query, not an asserted item price.
    total_budget_ceiling = total_budget / 3 if total_budget is not None and total_budget > 0 else None
    if requested_item_budget is None:
        budget = total_budget_ceiling
    elif total_budget_ceiling is None:
        budget = requested_item_budget
    else:
        budget = min(requested_item_budget, total_budget_ceiling)
    audience = str(profile.get("audience", "all")).lower()
    ranked: list[tuple[float, dict, list[str]]] = []
    for item in CATALOG:
        item_terms = _terms(" ".join([item["name"], item["category"], item["query"], *item["tags"]]))
        item_colours = _terms(" ".join(item.get("colours", [])))
        item_occasions = _terms(" ".join(item.get("occasions", [])))
        score = 0.0
        reasons: list[str] = []
        if style_terms:
            overlap = item_terms & style_terms
            if overlap:
                score += min(4.0, 1.4 * len(overlap))
                reasons.append("matches the selected style direction")
        if selected_aesthetics:
            overlap = item_terms & selected_aesthetics
            if overlap:
                score += min(2.5, 1.2 * len(overlap))
                reasons.append("reflects your preferred aesthetics")
        if occasions:
            overlap = item_occasions & occasions
            if overlap:
                score += min(2.0, 0.8 * len(overlap))
                reasons.append("suits your selected occasions")
        if preferred_colours:
            overlap = item_colours & preferred_colours
            if overlap:
                score += min(2.4, 0.8 * len(overlap))
                reasons.append("works with your colour preferences")
        if query_terms:
            overlap = item_terms & query_terms
            if overlap:
                score += min(3.2, 1.0 * len(overlap))
                reasons.append("matches your search")
        if audience not in {"all", "any", "unisex", "no preference"} and item.get("audience") not in {audience, "all"}:
            continue
        # Catalog entries are inspiration categories, not SKUs: apply budget as search guidance,
        # not as a false assertion about current sale price or inventory.
        if budget is not None:
            score += 0.25 if budget > 0 else -0.5
        if score <= 0 and not (style or query_terms):
            score = 0.2
        if score <= 0 and (style or query_terms):
            continue
        ranked.append((score, item, reasons))
    ranked.sort(key=lambda row: (-row[0], row[1]["name"]))
    chosen = []
    seen_images: set[str] = set()
    for score, item, reasons in ranked:
        if item["image_url"] in seen_images:
            continue
        seen_images.add(item["image_url"])
        out = {**item, "match_score": round(score, 2), "match_reasons": reasons or ["versatile match for your profile"], "market": market}
        out["retailer_search"] = retail_search(item["query"], market, budget)
        out["target_guidance"] = _budget_guidance(budget, total_budget, market)
        chosen.append(out)
        if len(chosen) >= max(1, min(limit, 12)):
            break
    return {"recommendations": chosen, "selected_style": style, "market": market, "currency": "USD" if market == "US" else "CAD", "total_budget": total_budget, "per_item_budget": budget, "requested_per_item_budget": requested_item_budget}


def retail_search(query: str, market: str, budget: float | None = None) -> list[dict]:
    import urllib.parse
    suffix = " Canada" if market == "CA" else " US"
    q = query + suffix
    if budget is not None:
        q += f" under {int(budget)}"
    encoded = urllib.parse.quote_plus(q)
    shopping = "https://www.google.com/search?tbm=shop&gl=ca&hl=en&q=" if market == "CA" else "https://www.google.com/search?tbm=shop&gl=us&hl=en&q="
    results = [{"label": "Search current listings", "url": shopping + encoded, "type": "Retail search"}]
    if market == "CA":
        results.append({"label": "Search Amazon Canada", "url": "https://www.amazon.ca/s?k=" + encoded, "type": "Retail search"})
    else:
        results.append({"label": "Search Amazon US", "url": "https://www.amazon.com/s?k=" + encoded, "type": "Retail search"})
    return results


def beauty_searches(market: str, concern: str, budget: float | None = None) -> list[dict]:
    import urllib.parse
    market = "US" if str(market).upper() in {"US", "USA"} else "CA"
    query = concern.strip() or "gentle skincare"
    if budget is not None:
        query += f" under {int(budget)}"
    q = urllib.parse.quote_plus(query)
    if market == "CA":
        hosts = [
            ("Sephora Canada", "https://www.sephora.com/ca/en/search?keyword="),
            ("Kiehl's Canada", "https://www.kiehls.ca/en/search?q="),
            ("Clinique Canada", "https://www.clinique.ca/search?query="),
            ("Amazon Canada", "https://www.amazon.ca/s?k="),
        ]
    else:
        hosts = [
            ("Sephora US", "https://www.sephora.com/search?keyword="),
            ("Kiehl's US", "https://www.kiehls.com/search?q="),
            ("Clinique US", "https://www.clinique.com/search?query="),
            ("Amazon US", "https://www.amazon.com/s?k="),
        ]
    return [{"label": label, "url": base + q, "type": "Retail search"} for label, base in hosts]


def _as_number(value: Any) -> float | None:
    try:
        num = float(value)
        return max(0.0, num) if num == num and num < 1e9 else None
    except (TypeError, ValueError):
        return None


def _budget_guidance(per_item: float | None, total: float | None, market: str) -> str:
    code = "USD" if market == "US" else "CAD"
    if per_item is not None and total is not None:
        return f"Retail search target: up to {code} {per_item:.0f} per item, within a {code} {total:.0f} total-look budget. Confirm live prices with the seller."
    if per_item is not None:
        return f"Retail search target: up to {code} {per_item:.0f} per item. Confirm live prices with the seller."
    if total is not None:
        return f"Your total-look budget is {code} {total:.0f}. Confirm item prices and total with the seller."
    return "Set a budget to add a spending target to retail searches. Current prices are shown by the retailer, not estimated here."
