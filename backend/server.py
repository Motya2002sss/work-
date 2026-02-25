#!/usr/bin/env python3
"""MVP server for DomEda landing + API without external dependencies."""

from __future__ import annotations

import cgi
import json
import mimetypes
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(__file__).resolve().parent / "data"
RUNTIME_DIR = DATA_DIR / "runtime"
UPLOADS_DIR = Path(__file__).resolve().parent / "uploads"
MAX_IMAGE_BYTES = 6 * 1024 * 1024
ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
ORDER_STATUS_LABELS = {
    "new": "Новый",
    "paid": "Оплачен",
    "accepted": "Принят",
    "cooking": "Готовится",
    "ready": "Готов к выдаче",
    "delivering": "В пути",
    "completed": "Завершен",
    "cancelled": "Отменен",
}
ORDER_STATUS_FLOW = ["new", "paid", "accepted", "cooking", "ready", "delivering", "completed", "cancelled"]
ORDER_STATUS_TRANSITIONS = {
    "new": {"accepted", "cancelled"},
    "paid": {"accepted", "cancelled"},
    "accepted": {"cooking", "cancelled"},
    "cooking": {"ready", "cancelled"},
    "ready": {"delivering", "completed", "cancelled"},
    "delivering": {"completed", "cancelled"},
    "completed": set(),
    "cancelled": set(),
}
STATIC_FILES = {
    "/": "index.html",
    "/index.html": "index.html",
    "/dish.html": "dish.html",
    "/cook.html": "cook.html",
    "/orders.html": "orders.html",
    "/styles.css": "styles.css",
    "/app.js": "app.js",
    "/dish.js": "dish.js",
    "/cook.js": "cook.js",
    "/cart.js": "cart.js",
    "/orders.js": "orders.js",
}


def read_json(filename: str, default: Any) -> Any:
    path = DATA_DIR / filename
    if not path.exists():
        return default

    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except (json.JSONDecodeError, OSError):
        return default


def write_json(filename: str, payload: Any) -> None:
    path = DATA_DIR / filename
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)


def read_dishes() -> List[Dict[str, Any]]:
    runtime_file = RUNTIME_DIR / "dishes.json"
    if runtime_file.exists():
        try:
            with runtime_file.open("r", encoding="utf-8") as handle:
                return json.load(handle)
        except (json.JSONDecodeError, OSError):
            return []

    return read_json("dishes.json", [])


def write_dishes(dishes: List[Dict[str, Any]]) -> None:
    runtime_file = RUNTIME_DIR / "dishes.json"
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    with runtime_file.open("w", encoding="utf-8") as handle:
        json.dump(dishes, handle, ensure_ascii=False, indent=2)


def read_orders() -> List[Dict[str, Any]]:
    runtime_file = RUNTIME_DIR / "orders.json"
    if runtime_file.exists():
        try:
            with runtime_file.open("r", encoding="utf-8") as handle:
                return json.load(handle)
        except (json.JSONDecodeError, OSError):
            return []

    return read_json("orders.json", [])


def write_orders(orders: List[Dict[str, Any]]) -> None:
    runtime_file = RUNTIME_DIR / "orders.json"
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    with runtime_file.open("w", encoding="utf-8") as handle:
        json.dump(orders, handle, ensure_ascii=False, indent=2)


def read_payments() -> List[Dict[str, Any]]:
    runtime_file = RUNTIME_DIR / "payments.json"
    if runtime_file.exists():
        try:
            with runtime_file.open("r", encoding="utf-8") as handle:
                return json.load(handle)
        except (json.JSONDecodeError, OSError):
            return []

    return read_json("payments.json", [])


def write_payments(payments: List[Dict[str, Any]]) -> None:
    runtime_file = RUNTIME_DIR / "payments.json"
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    with runtime_file.open("w", encoding="utf-8") as handle:
        json.dump(payments, handle, ensure_ascii=False, indent=2)


def read_reviews() -> List[Dict[str, Any]]:
    runtime_file = RUNTIME_DIR / "reviews.json"
    if runtime_file.exists():
        try:
            with runtime_file.open("r", encoding="utf-8") as handle:
                return json.load(handle)
        except (json.JSONDecodeError, OSError):
            return []

    return read_json("reviews.json", [])


def write_reviews(reviews: List[Dict[str, Any]]) -> None:
    runtime_file = RUNTIME_DIR / "reviews.json"
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    with runtime_file.open("w", encoding="utf-8") as handle:
        json.dump(reviews, handle, ensure_ascii=False, indent=2)


def csv_set(value: str) -> set[str]:
    if not value:
        return set()
    return {item.strip() for item in value.split(",") if item.strip()}


def safe_float(value: str, fallback: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def next_order_id(orders: List[Dict[str, Any]]) -> str:
    return f"ORD-{datetime.now().strftime('%Y%m%d')}-{len(orders) + 1:04d}"


def next_payment_id(payments: List[Dict[str, Any]]) -> str:
    return f"PAY-{datetime.now().strftime('%Y%m%d')}-{len(payments) + 1:04d}"


def safe_int(value: str, fallback: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def round_rating(value: float) -> float:
    return round(value + 1e-8, 2)


def digits_only(value: Any) -> str:
    return "".join(char for char in clean_str(value) if char.isdigit())


def mask_card_number(value: str) -> str:
    if len(value) < 8:
        return ""
    return f"{value[:4]} **** **** {value[-4:]}"


def card_brand(value: str) -> str:
    if value.startswith("4"):
        return "VISA"
    if value.startswith(("51", "52", "53", "54", "55")):
        return "MASTERCARD"
    if value.startswith(("34", "37")):
        return "AMEX"
    if value.startswith("2200"):
        return "MIR"
    return "CARD"


def valid_card_luhn(value: str) -> bool:
    if not value or not value.isdigit():
        return False
    checksum = 0
    parity = len(value) % 2
    for index, char in enumerate(value):
        digit = int(char)
        if index % 2 == parity:
            digit *= 2
            if digit > 9:
                digit -= 9
        checksum += digit
    return checksum % 10 == 0


def clean_str(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def next_dish_id(dishes: List[Dict[str, Any]]) -> int:
    if not dishes:
        return 1
    max_id = max(safe_int(str(item.get("id", 0)), 0) for item in dishes)
    return max_id + 1


def cook_delivery_modes(cook: Dict[str, Any]) -> List[str]:
    delivery = cook.get("delivery_modes") or []
    if isinstance(delivery, list) and delivery:
        return [str(item) for item in delivery]
    return ["pickup"]


def detect_image_extension(filename: str, content_type: str) -> str:
    ext = Path(filename or "").suffix.lower()
    if ext in ALLOWED_IMAGE_EXTENSIONS:
        return ext

    fallback_map = {
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
    }
    return fallback_map.get(content_type, "")


def valid_hhmm(value: str) -> bool:
    if not value:
        return True
    parts = value.split(":")
    if len(parts) != 2:
        return False
    hours = safe_int(parts[0], -1)
    minutes = safe_int(parts[1], -1)
    return 0 <= hours <= 23 and 0 <= minutes <= 59


def hhmm_to_minutes(value: str) -> int:
    if not valid_hhmm(value) or not value:
        return -1
    hours, minutes = value.split(":")
    return safe_int(hours, 0) * 60 + safe_int(minutes, 0)


def now_local_minutes() -> int:
    current = datetime.now()
    return current.hour * 60 + current.minute


def dish_portions_available(dish: Dict[str, Any]) -> int:
    portions = safe_int(str(dish.get("portions_available", 8)), 8)
    return max(0, portions)


def dish_is_time_available(dish: Dict[str, Any]) -> bool:
    now_minutes = now_local_minutes()
    available_from = clean_str(dish.get("available_from", ""))
    available_until = clean_str(dish.get("available_until", ""))

    from_minutes = hhmm_to_minutes(available_from)
    until_minutes = hhmm_to_minutes(available_until)

    if from_minutes >= 0 and now_minutes < from_minutes:
        return False
    if until_minutes >= 0 and now_minutes > until_minutes:
        return False

    return True


def dish_availability(dish: Dict[str, Any]) -> Dict[str, Any]:
    portions = dish_portions_available(dish)
    in_time_window = dish_is_time_available(dish)
    is_available = portions > 0 and in_time_window
    available_until = clean_str(dish.get("available_until", ""))

    if portions <= 0:
        label = "Закончилось"
    elif not in_time_window:
        label = "Вне времени приема"
    elif available_until:
        label = f"В наличии · до {available_until} · {portions} порц."
    else:
        label = f"В наличии · {portions} порц."

    return {
        "is_available": is_available,
        "availability_label": label,
        "portions_available": portions,
        "available_from": clean_str(dish.get("available_from", "")),
        "available_until": available_until,
    }


def build_review_stats(
    dishes: List[Dict[str, Any]], reviews: List[Dict[str, Any]]
) -> tuple[Dict[int, Dict[str, float]], Dict[int, Dict[str, float]]]:
    dish_to_cook: Dict[int, int] = {}
    for dish in dishes:
        dish_id = safe_int(str(dish.get("id", 0)), 0)
        cook_id = safe_int(str(dish.get("cook_id", 0)), 0)
        if dish_id > 0 and cook_id > 0:
            dish_to_cook[dish_id] = cook_id

    dish_stats: Dict[int, Dict[str, float]] = {}
    cook_stats: Dict[int, Dict[str, float]] = {}
    for review in reviews:
        dish_id = safe_int(str(review.get("dish_id", 0)), 0)
        rating = safe_float(str(review.get("rating", 0)), 0)
        if dish_id <= 0 or rating <= 0:
            continue

        if dish_id not in dish_stats:
            dish_stats[dish_id] = {"sum": 0.0, "count": 0.0}
        dish_stats[dish_id]["sum"] += rating
        dish_stats[dish_id]["count"] += 1

        cook_id = dish_to_cook.get(dish_id)
        if cook_id:
            if cook_id not in cook_stats:
                cook_stats[cook_id] = {"sum": 0.0, "count": 0.0}
            cook_stats[cook_id]["sum"] += rating
            cook_stats[cook_id]["count"] += 1

    return dish_stats, cook_stats


def enrich_dishes_with_reviews_and_availability(
    dishes: List[Dict[str, Any]], reviews: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    dish_stats, _ = build_review_stats(dishes, reviews)
    enriched: List[Dict[str, Any]] = []
    for dish in dishes:
        item = dict(dish)
        dish_id = safe_int(str(item.get("id", 0)), 0)
        stats = dish_stats.get(dish_id)
        if stats and stats["count"] > 0:
            item["rating"] = round_rating(stats["sum"] / stats["count"])
            item["reviews_count"] = int(stats["count"])
        else:
            item["rating"] = safe_float(str(item.get("rating", 0)), 0)
            item["reviews_count"] = 0

        item.update(dish_availability(item))
        enriched.append(item)

    return enriched


def enrich_cooks_with_reviews(
    cooks: List[Dict[str, Any]],
    dishes: List[Dict[str, Any]],
    reviews: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    _, cook_stats = build_review_stats(dishes, reviews)
    enriched: List[Dict[str, Any]] = []
    for cook in cooks:
        item = dict(cook)
        cook_id = safe_int(str(item.get("id", 0)), 0)
        stats = cook_stats.get(cook_id)
        if stats and stats["count"] > 0:
            item["rating"] = round_rating(stats["sum"] / stats["count"])
            item["reviews_count"] = int(stats["count"])
        else:
            item["rating"] = safe_float(str(item.get("rating", 0)), 0)
            item["reviews_count"] = 0
        enriched.append(item)
    return enriched


def next_review_id(reviews: List[Dict[str, Any]]) -> str:
    return f"REV-{datetime.now().strftime('%Y%m%d')}-{len(reviews) + 1:04d}"


def map_cook_points(cooks: List[Dict[str, Any]], dishes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    cook_menu: Dict[int, Dict[str, Any]] = {}
    for dish in dishes:
        cook_id = safe_int(str(dish.get("cook_id", 0)), 0)
        if cook_id <= 0:
            continue

        if cook_id not in cook_menu:
            cook_menu[cook_id] = {
                "dishes_count": 0,
                "available_dishes_count": 0,
                "min_price": 0,
            }

        stats = cook_menu[cook_id]
        stats["dishes_count"] += 1
        if bool(dish.get("is_available")):
            stats["available_dishes_count"] += 1

        price = safe_int(str(dish.get("price", 0)), 0)
        if price > 0 and (stats["min_price"] == 0 or price < stats["min_price"]):
            stats["min_price"] = price

    points: List[Dict[str, Any]] = []
    for cook in cooks:
        location = cook.get("location", {})
        if "lat" not in location or "lng" not in location:
            continue
        cook_id = safe_int(str(cook.get("id", 0)), 0)
        menu = cook_menu.get(
            cook_id,
            {
                "dishes_count": 0,
                "available_dishes_count": 0,
                "min_price": 0,
            },
        )

        points.append(
            {
                "id": cook.get("id"),
                "name": cook.get("name"),
                "district": cook.get("district"),
                "rating": cook.get("rating"),
                "reviews_count": cook.get("reviews_count", 0),
                "verified": cook.get("verified", False),
                "lat": location.get("lat"),
                "lng": location.get("lng"),
                "label": location.get("label", ""),
                "dishes_count": menu["dishes_count"],
                "available_dishes_count": menu["available_dishes_count"],
                "min_price": menu["min_price"],
            }
        )

    return points


def order_items(order: Dict[str, Any]) -> List[Dict[str, Any]]:
    if isinstance(order.get("items"), list) and order.get("items"):
        return [item for item in order.get("items", []) if isinstance(item, dict)]

    dish_id = safe_int(str(order.get("dish_id", 0)), 0)
    if dish_id <= 0:
        return []

    qty = max(1, safe_int(str(order.get("qty", 1)), 1))
    unit_price = safe_int(str(order.get("price", 0)), 0)
    return [
        {
            "dish_id": dish_id,
            "dish_title": clean_str(order.get("dish_title")),
            "cook_id": safe_int(str(order.get("cook_id", 0)), 0),
            "cook": clean_str(order.get("cook")),
            "qty": qty,
            "unit_price": unit_price,
            "subtotal": unit_price * qty,
        }
    ]


def order_cook_ids(order: Dict[str, Any]) -> List[int]:
    ids = set()
    for item in order_items(order):
        cook_id = safe_int(str(item.get("cook_id", 0)), 0)
        if cook_id > 0:
            ids.add(cook_id)
    if not ids:
        fallback = safe_int(str(order.get("cook_id", 0)), 0)
        if fallback > 0:
            ids.add(fallback)
    return sorted(ids)


def order_total_price(order: Dict[str, Any]) -> int:
    if safe_int(str(order.get("total_price", 0)), 0) > 0:
        return safe_int(str(order.get("total_price", 0)), 0)
    total = 0
    for item in order_items(order):
        subtotal = safe_int(str(item.get("subtotal", 0)), 0)
        if subtotal <= 0:
            qty = max(1, safe_int(str(item.get("qty", 1)), 1))
            unit_price = safe_int(str(item.get("unit_price", 0)), 0)
            subtotal = qty * unit_price
        total += subtotal
    return total


def normalize_order_status(status: str) -> str:
    value = clean_str(status).lower()
    if value in ORDER_STATUS_LABELS:
        return value
    return "new"


def order_status_history(order: Dict[str, Any]) -> List[Dict[str, Any]]:
    history = order.get("status_history")
    if isinstance(history, list) and history:
        normalized = []
        for event in history:
            if not isinstance(event, dict):
                continue
            normalized.append(
                {
                    "status": normalize_order_status(event.get("status", "")),
                    "at": clean_str(event.get("at")) or clean_str(order.get("created_at")),
                    "by": clean_str(event.get("by")) or "system",
                    "note": clean_str(event.get("note")),
                }
            )
        if normalized:
            return normalized

    created_at = clean_str(order.get("created_at")) or datetime.now(timezone.utc).isoformat()
    return [
        {
            "status": normalize_order_status(order.get("status", "new")),
            "at": created_at,
            "by": "system",
            "note": "",
        }
    ]


def append_order_status_history(order: Dict[str, Any], status: str, actor: str, note: str) -> None:
    history = order_status_history(order)
    history.append(
        {
            "status": normalize_order_status(status),
            "at": datetime.now(timezone.utc).isoformat(),
            "by": clean_str(actor) or "system",
            "note": clean_str(note),
        }
    )
    order["status_history"] = history


def order_status_label(status: str) -> str:
    return ORDER_STATUS_LABELS.get(status, status)


def order_allows_status(order: Dict[str, Any], next_status: str) -> bool:
    current = normalize_order_status(order.get("status", "new"))
    if next_status == current:
        return True
    allowed = set(ORDER_STATUS_TRANSITIONS.get(current, set()))

    if current == "ready" and clean_str(order.get("delivery_mode")) == "pickup":
        allowed.discard("delivering")

    return next_status in allowed


def enrich_order(order: Dict[str, Any]) -> Dict[str, Any]:
    item = dict(order)
    item["items"] = order_items(item)
    item["item_count"] = sum(max(1, safe_int(str(row.get("qty", 1)), 1)) for row in item["items"])
    item["total_price"] = order_total_price(item)
    item["cook_ids"] = order_cook_ids(item)
    item["status"] = normalize_order_status(item.get("status", "new"))
    item["status_label"] = order_status_label(item["status"])
    history = order_status_history(item)
    item["status_history"] = [
        {
            **event,
            "status_label": order_status_label(event.get("status", "")),
        }
        for event in history
    ]
    allowed = set(ORDER_STATUS_TRANSITIONS.get(item["status"], set()))
    if item["status"] == "ready" and clean_str(item.get("delivery_mode")) == "pickup":
        allowed.discard("delivering")
    item["next_statuses"] = [status for status in ORDER_STATUS_FLOW if status in allowed]
    return item


class AppHandler(BaseHTTPRequestHandler):
    server_version = "DomEdaMVP/1.0"

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/"):
            self.handle_api_get(path, parse_qs(parsed.query))
            return

        self.serve_static(path)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)

        if parsed.path == "/api/dishes":
            self.handle_create_dish()
            return

        if parsed.path == "/api/checkout":
            self.handle_checkout()
            return

        if parsed.path.startswith("/api/orders/") and parsed.path.endswith("/status"):
            order_id = parsed.path.split("/")[3]
            self.handle_update_order_status(order_id)
            return

        if parsed.path == "/api/orders":
            self.handle_create_order()
            return

        if parsed.path == "/api/reviews":
            self.handle_create_review()
            return

        if parsed.path == "/api/courier/book":
            self.handle_courier_booking()
            return

        if parsed.path == "/api/cooks/verification":
            self.handle_cook_verification()
            return

        self.send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})

    def handle_api_get(self, path: str, query: Dict[str, List[str]]) -> None:
        if path == "/api/health":
            self.send_json(
                HTTPStatus.OK,
                {
                    "status": "ok",
                    "service": "domeda-api",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
            )
            return

        if path == "/api/dishes":
            items = self.filtered_dishes(query)
            self.send_json(HTTPStatus.OK, {"items": items, "total": len(items)})
            return

        if path.startswith("/api/dishes/") and path.endswith("/reviews"):
            dish_id = safe_int(path.split("/")[3], -1)
            if dish_id <= 0:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "dish_id_invalid"})
                return

            reviews = read_reviews()
            items = [item for item in reviews if safe_int(str(item.get("dish_id", 0)), 0) == dish_id]
            items.sort(key=lambda item: item.get("created_at", ""), reverse=True)
            total = len(items)
            average = (
                round_rating(sum(safe_float(str(item.get("rating", 0)), 0) for item in items) / total)
                if total
                else 0
            )
            self.send_json(
                HTTPStatus.OK,
                {"items": items, "total": total, "average_rating": average},
            )
            return

        if path.startswith("/api/dishes/"):
            dish_id = safe_int(path.rsplit("/", 1)[-1], -1)
            if dish_id <= 0:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "dish_id_invalid"})
                return

            raw_dishes = read_dishes()
            reviews = read_reviews()
            dishes = enrich_dishes_with_reviews_and_availability(raw_dishes, reviews)
            cooks = enrich_cooks_with_reviews(read_json("cooks.json", []), raw_dishes, reviews)
            dish = next((item for item in dishes if item.get("id") == dish_id), None)
            if not dish:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "dish_not_found"})
                return

            cook = self.find_dish_cook(dish, cooks)
            recommended = [
                item
                for item in dishes
                if item.get("id") != dish_id and item.get("district") == dish.get("district")
            ][:3]

            self.send_json(
                HTTPStatus.OK,
                {
                    "dish": dish,
                    "cook": cook,
                    "recommended": recommended,
                },
            )
            return

        if path == "/api/cooks":
            raw_dishes = read_dishes()
            reviews = read_reviews()
            cooks = enrich_cooks_with_reviews(read_json("cooks.json", []), raw_dishes, reviews)
            district = self.query_value(query, "district", "all")
            if district and district != "all":
                cooks = [item for item in cooks if item.get("district") == district]
            self.send_json(HTTPStatus.OK, {"items": cooks, "total": len(cooks)})
            return

        if path == "/api/cooks/map":
            raw_dishes = read_dishes()
            reviews = read_reviews()
            dishes = enrich_dishes_with_reviews_and_availability(raw_dishes, reviews)
            cooks = enrich_cooks_with_reviews(read_json("cooks.json", []), raw_dishes, reviews)
            district = self.query_value(query, "district", "all")
            if district and district != "all":
                cooks = [item for item in cooks if item.get("district") == district]
            available_only = self.query_value(query, "available_only", "0") == "1"

            points = map_cook_points(cooks, dishes)
            if available_only:
                points = [item for item in points if safe_int(str(item.get("available_dishes_count", 0)), 0) > 0]
            self.send_json(HTTPStatus.OK, {"items": points, "total": len(points)})
            return

        if path == "/api/cart/preview":
            ids_raw = self.query_value(query, "ids", "")
            ids = {safe_int(item, -1) for item in ids_raw.split(",") if item.strip()}
            ids = {item for item in ids if item > 0}
            dishes = enrich_dishes_with_reviews_and_availability(read_dishes(), read_reviews())
            if ids:
                dishes = [item for item in dishes if safe_int(str(item.get("id", 0)), 0) in ids]
            self.send_json(HTTPStatus.OK, {"items": dishes, "total": len(dishes)})
            return

        if path == "/api/subscriptions":
            plans = read_json("subscriptions.json", [])
            self.send_json(HTTPStatus.OK, {"items": plans, "total": len(plans)})
            return

        if path == "/api/orders":
            orders = [enrich_order(item) for item in read_orders()]
            role = self.query_value(query, "role", "all")
            cook_id = safe_int(self.query_value(query, "cook_id", "0"), 0)
            requested_status = clean_str(self.query_value(query, "status", "all")).lower()
            customer_phone = clean_str(self.query_value(query, "customer_phone", ""))
            customer_name = clean_str(self.query_value(query, "customer_name", "")).lower()
            order_id = clean_str(self.query_value(query, "order_id", ""))

            if role == "cook" and cook_id > 0:
                orders = [item for item in orders if cook_id in item.get("cook_ids", [])]

            if role == "customer":
                if customer_phone:
                    phone_digits = digits_only(customer_phone)
                    orders = [
                        item
                        for item in orders
                        if phone_digits
                        and phone_digits in digits_only(item.get("customer_phone", ""))
                    ]
                if customer_name:
                    orders = [
                        item
                        for item in orders
                        if customer_name in clean_str(item.get("customer_name", "")).lower()
                    ]

            if order_id:
                orders = [item for item in orders if clean_str(item.get("id")) == order_id]

            if requested_status != "all":
                if requested_status in ORDER_STATUS_LABELS:
                    orders = [item for item in orders if item.get("status") == requested_status]
                else:
                    orders = []

            orders.sort(key=lambda item: item.get("created_at", ""), reverse=True)
            self.send_json(HTTPStatus.OK, {"items": orders, "total": len(orders)})
            return

        if path.startswith("/api/orders/") and not path.endswith("/status"):
            order_id = path.rsplit("/", 1)[-1]
            orders = [enrich_order(item) for item in read_orders()]
            order = next((item for item in orders if clean_str(item.get("id")) == order_id), None)
            if not order:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "order_not_found"})
                return
            self.send_json(HTTPStatus.OK, {"order": order})
            return

        if path == "/api/payments":
            payments = read_payments()
            payments.sort(key=lambda item: item.get("created_at", ""), reverse=True)
            self.send_json(HTTPStatus.OK, {"items": payments, "total": len(payments)})
            return

        self.send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})

    def find_dish_cook(self, dish: Dict[str, Any], cooks: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        cook_id = dish.get("cook_id")
        if cook_id is not None:
            cook = next((item for item in cooks if item.get("id") == cook_id), None)
            if cook:
                return cook

        cook_name = dish.get("cook")
        return next((item for item in cooks if item.get("name") == cook_name), None)

    def filtered_dishes(self, query: Dict[str, List[str]]) -> List[Dict[str, Any]]:
        raw_dishes = read_dishes()
        dishes = enrich_dishes_with_reviews_and_availability(raw_dishes, read_reviews())

        district = self.query_value(query, "district", "all")
        categories = csv_set(self.query_value(query, "categories", ""))
        delivery = csv_set(self.query_value(query, "delivery", ""))
        search = self.query_value(query, "search", "").strip().lower()
        max_price = safe_float(self.query_value(query, "max_price", "999999"), 999999)
        min_rating = safe_float(self.query_value(query, "min_rating", "0"), 0)
        sort_key = self.query_value(query, "sort", "rating")
        cook_id = safe_int(self.query_value(query, "cook_id", "0"), 0)
        ids = {
            safe_int(item, -1)
            for item in self.query_value(query, "ids", "").split(",")
            if item.strip()
        }
        ids = {item for item in ids if item > 0}
        available_only = self.query_value(query, "available_only", "0") == "1"

        if ids:
            dishes = [dish for dish in dishes if safe_int(str(dish.get("id", 0)), 0) in ids]

        if district and district != "all":
            dishes = [dish for dish in dishes if dish.get("district") == district]

        if cook_id > 0:
            dishes = [
                dish
                for dish in dishes
                if safe_int(str(dish.get("cook_id", 0)), 0) == cook_id
            ]

        if categories:
            dishes = [
                dish
                for dish in dishes
                if categories.intersection(set(dish.get("tags", [])))
            ]

        if delivery:
            dishes = [
                dish
                for dish in dishes
                if delivery.intersection(set(dish.get("delivery", [])))
            ]

        if search:
            dishes = [
                dish
                for dish in dishes
                if search in str(dish.get("title", "")).lower()
                or search in str(dish.get("cook", "")).lower()
                or search in str(dish.get("district", "")).lower()
            ]

        dishes = [dish for dish in dishes if safe_float(str(dish.get("price", 0)), 0) <= max_price]
        dishes = [dish for dish in dishes if safe_float(str(dish.get("rating", 0)), 0) >= min_rating]
        if available_only:
            dishes = [dish for dish in dishes if bool(dish.get("is_available"))]

        if sort_key == "price-asc":
            dishes.sort(key=lambda dish: dish.get("price", 0))
        elif sort_key == "price-desc":
            dishes.sort(key=lambda dish: dish.get("price", 0), reverse=True)
        else:
            dishes.sort(key=lambda dish: dish.get("rating", 0), reverse=True)

        return dishes

    def handle_create_dish(self) -> None:
        content_type = self.headers.get("Content-Type", "")
        if not content_type.startswith("multipart/form-data"):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "multipart_required"})
            return

        form = self.read_multipart_form()
        if form is None:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_form_data"})
            return

        title = clean_str(form.getvalue("title"))
        description = clean_str(form.getvalue("description"))
        cook_id = safe_int(clean_str(form.getvalue("cook_id")), -1)
        price = safe_int(clean_str(form.getvalue("price")), 0)
        grams = safe_int(clean_str(form.getvalue("portion_grams")), 0)
        wait_minutes = safe_int(clean_str(form.getvalue("wait_minutes")), 40)
        portions_available = safe_int(clean_str(form.getvalue("portions_available")), 0)
        available_from = clean_str(form.getvalue("available_from"))
        available_until = clean_str(form.getvalue("available_until"))
        tags = {clean_str(item) for item in form.getlist("tags") if clean_str(item)}
        delivery = {clean_str(item) for item in form.getlist("delivery") if clean_str(item)}
        allowed_delivery = {"pickup", "cook", "courier"}

        if not title:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "title_required"})
            return
        if cook_id <= 0:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "cook_id_required"})
            return
        if price <= 0:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "price_invalid"})
            return
        if grams <= 0:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "portion_grams_invalid"})
            return
        if wait_minutes <= 0:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "wait_minutes_invalid"})
            return
        if portions_available <= 0:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "portions_available_invalid"})
            return
        if not valid_hhmm(available_from):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "available_from_invalid"})
            return
        if not valid_hhmm(available_until):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "available_until_invalid"})
            return
        if available_from and available_until and hhmm_to_minutes(available_from) > hhmm_to_minutes(available_until):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "availability_window_invalid"})
            return
        if delivery and not delivery.issubset(allowed_delivery):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "delivery_invalid"})
            return

        cooks = read_json("cooks.json", [])
        cook = next((item for item in cooks if item.get("id") == cook_id), None)
        if not cook:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "cook_not_found"})
            return

        image_field = form["image"] if "image" in form else None
        image_result = self.save_uploaded_image(image_field)
        if image_result.get("error"):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": image_result["error"]})
            return

        image_url = image_result.get("image_url", "")
        if not image_url:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "image_required"})
            return

        dishes = read_dishes()
        dish = {
            "id": next_dish_id(dishes),
            "cook_id": cook.get("id"),
            "title": title,
            "cook": cook.get("name"),
            "district": cook.get("district", "Москва"),
            "rating": cook.get("rating", 0),
            "price": price,
            "tags": sorted(tags) if tags else ["hot"],
            "delivery": sorted(delivery) if delivery else cook_delivery_modes(cook),
            "wait": f"{wait_minutes} мин",
            "description": description or "Домашнее блюдо от локального повара.",
            "portion": f"{grams} г",
            "portion_grams": grams,
            "image_url": image_url,
            "portions_available": portions_available,
            "available_from": available_from,
            "available_until": available_until,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        dishes.append(dish)
        write_dishes(dishes)

        self.send_json(HTTPStatus.CREATED, {"dish": dish})

    def save_uploaded_image(self, image_field: Any) -> Dict[str, Any]:
        if image_field is None:
            return {"error": "image_required"}
        if not getattr(image_field, "filename", ""):
            return {"error": "image_required"}

        extension = detect_image_extension(
            clean_str(getattr(image_field, "filename", "")),
            clean_str(getattr(image_field, "type", "")),
        )
        if not extension:
            return {"error": "image_format_not_supported"}

        UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
        filename = f"{datetime.now().strftime('%Y%m%d%H%M%S')}_{uuid4().hex[:10]}{extension}"
        target = UPLOADS_DIR / filename

        source = getattr(image_field, "file", None)
        if source is None:
            return {"error": "image_invalid"}

        total_size = 0
        try:
            with target.open("wb") as handle:
                while True:
                    chunk = source.read(64 * 1024)
                    if not chunk:
                        break
                    total_size += len(chunk)
                    if total_size > MAX_IMAGE_BYTES:
                        handle.close()
                        target.unlink(missing_ok=True)
                        return {"error": "image_too_large"}
                    handle.write(chunk)
        except OSError:
            return {"error": "image_save_failed"}

        if total_size == 0:
            target.unlink(missing_ok=True)
            return {"error": "image_invalid"}

        return {"image_url": f"/uploads/{filename}"}

    def validate_checkout_items(
        self, payload_items: Any, dishes: List[Dict[str, Any]]
    ) -> tuple[List[Dict[str, Any]], Optional[str]]:
        if not isinstance(payload_items, list) or not payload_items:
            return [], "items_required"

        dish_map = {
            safe_int(str(dish.get("id", 0)), 0): dish
            for dish in dishes
            if safe_int(str(dish.get("id", 0)), 0) > 0
        }

        validated: List[Dict[str, Any]] = []
        for row in payload_items:
            if not isinstance(row, dict):
                return [], "items_invalid"
            dish_id = safe_int(str(row.get("dish_id", 0)), -1)
            qty = safe_int(str(row.get("qty", 0)), 0)
            if dish_id <= 0 or qty <= 0:
                return [], "items_invalid"

            dish = dish_map.get(dish_id)
            if not dish:
                return [], "dish_not_found"

            enriched_dish = dict(dish)
            enriched_dish.update(dish_availability(enriched_dish))
            if not enriched_dish.get("is_available"):
                return [], "dish_unavailable"
            if qty > dish_portions_available(enriched_dish):
                return [], "dish_stock_not_enough"

            validated.append({"dish": dish, "qty": qty})

        return validated, None

    def validate_payment_payload(self, payload: Dict[str, Any], expected_amount: int) -> tuple[Optional[Dict[str, Any]], Optional[str]]:
        payment = payload.get("payment")
        if not isinstance(payment, dict):
            return None, "payment_required"

        method = clean_str(payment.get("method")).lower()
        if method != "card":
            return None, "payment_method_not_supported"

        card_number = digits_only(payment.get("card_number"))
        exp_month = safe_int(str(payment.get("exp_month", 0)), 0)
        exp_year = safe_int(str(payment.get("exp_year", 0)), 0)
        cvc = digits_only(payment.get("cvc"))
        holder = clean_str(payment.get("holder"))

        if len(card_number) < 13 or len(card_number) > 19:
            return None, "card_number_invalid"
        if not valid_card_luhn(card_number):
            return None, "card_number_invalid"
        if exp_month < 1 or exp_month > 12:
            return None, "card_expiry_invalid"
        if exp_year < 2000 or exp_year > 2100:
            return None, "card_expiry_invalid"
        if len(cvc) < 3 or len(cvc) > 4:
            return None, "card_cvc_invalid"
        if len(holder) < 2:
            return None, "card_holder_invalid"

        now = datetime.now()
        if exp_year < now.year or (exp_year == now.year and exp_month < now.month):
            return None, "card_expired"

        return (
            {
                "method": "card",
                "card_brand": card_brand(card_number),
                "card_masked": mask_card_number(card_number),
                "card_last4": card_number[-4:],
                "holder": holder,
                "amount": expected_amount,
                "currency": "RUB",
            },
            None,
        )

    def create_payment_record(self, order_id: str, payment_data: Dict[str, Any]) -> Dict[str, Any]:
        payments = read_payments()
        payment = {
            "id": next_payment_id(payments),
            "order_id": order_id,
            "status": "captured",
            "provider": "domeda_pay_mock",
            "method": payment_data.get("method", "card"),
            "card_brand": payment_data.get("card_brand", "CARD"),
            "card_masked": payment_data.get("card_masked", ""),
            "card_last4": payment_data.get("card_last4", ""),
            "holder": payment_data.get("holder", ""),
            "amount": payment_data.get("amount", 0),
            "currency": payment_data.get("currency", "RUB"),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        payments.append(payment)
        write_payments(payments)
        return payment

    def handle_checkout(self) -> None:
        payload = self.read_json_body()
        raw_dishes = read_dishes()

        checkout_rows, error = self.validate_checkout_items(payload.get("items"), raw_dishes)
        if error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": error})
            return

        delivery_mode = clean_str(payload.get("delivery_mode")) or "pickup"
        if delivery_mode not in {"pickup", "cook", "courier"}:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "delivery_mode_invalid"})
            return

        total = 0
        items: List[Dict[str, Any]] = []
        for row in checkout_rows:
            dish = row["dish"]
            qty = row["qty"]
            dish_delivery = set(dish.get("delivery", []))
            if delivery_mode not in dish_delivery:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "delivery_mode_not_available"})
                return
            price = safe_int(str(dish.get("price", 0)), 0)
            total += price * qty
            items.append(
                {
                    "dish_id": dish.get("id"),
                    "dish_title": dish.get("title"),
                    "cook_id": dish.get("cook_id"),
                    "cook": dish.get("cook"),
                    "qty": qty,
                    "unit_price": price,
                    "subtotal": price * qty,
                }
            )

        payment_data, payment_error = self.validate_payment_payload(payload, total)
        if payment_error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": payment_error})
            return

        for row in checkout_rows:
            dish = row["dish"]
            qty = row["qty"]
            current = dish_portions_available(dish)
            dish["portions_available"] = max(0, current - qty)

        write_dishes(raw_dishes)

        orders = read_orders()
        order = {
            "id": next_order_id(orders),
            "items": items,
            "total_price": total,
            "districts": [],
            "city": clean_str(payload.get("city")) or "Москва",
            "customer_name": clean_str(payload.get("customer_name")) or "Гость",
            "customer_phone": clean_str(payload.get("customer_phone")),
            "address": clean_str(payload.get("address")),
            "comment": clean_str(payload.get("comment")),
            "delivery_mode": delivery_mode,
            "status": "paid",
            "status_label": order_status_label("paid"),
            "status_history": [
                {
                    "status": "paid",
                    "at": datetime.now(timezone.utc).isoformat(),
                    "by": "payment",
                    "note": "Оплата подтверждена",
                }
            ],
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        order["districts"] = sorted(
            {
                clean_str(item["dish"].get("district", ""))
                for item in checkout_rows
                if clean_str(item["dish"].get("district", ""))
            }
        )
        payment = self.create_payment_record(order["id"], payment_data or {})
        order["payment_id"] = payment.get("id")
        order["payment_status"] = payment.get("status")
        order["payment_summary"] = {
            "method": payment.get("method"),
            "card_brand": payment.get("card_brand"),
            "card_masked": payment.get("card_masked"),
            "amount": payment.get("amount"),
            "currency": payment.get("currency"),
        }
        orders.append(order)
        write_orders(orders)

        self.send_json(HTTPStatus.CREATED, {"order": order, "payment": payment})

    def handle_create_review(self) -> None:
        payload = self.read_json_body()
        dish_id = safe_int(str(payload.get("dish_id", 0)), -1)
        rating = safe_float(str(payload.get("rating", 0)), 0)
        customer_name = clean_str(payload.get("customer_name")) or "Покупатель"
        text = clean_str(payload.get("text"))
        order_id = clean_str(payload.get("order_id"))

        if dish_id <= 0:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "dish_id_invalid"})
            return
        if rating < 1 or rating > 5:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "rating_invalid"})
            return
        if len(text) < 3:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "text_too_short"})
            return

        dishes = read_dishes()
        dish = next((item for item in dishes if safe_int(str(item.get("id", 0)), 0) == dish_id), None)
        if not dish:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "dish_not_found"})
            return

        reviews = read_reviews()
        review = {
            "id": next_review_id(reviews),
            "dish_id": dish_id,
            "cook_id": dish.get("cook_id"),
            "order_id": order_id,
            "customer_name": customer_name,
            "rating": round_rating(rating),
            "text": text,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        reviews.append(review)
        write_reviews(reviews)

        self.send_json(HTTPStatus.CREATED, {"review": review})

    def handle_update_order_status(self, order_id: str) -> None:
        payload = self.read_json_body()
        requested_status = clean_str(payload.get("status")).lower()
        actor = clean_str(payload.get("actor")) or "cook"
        note = clean_str(payload.get("note"))

        if requested_status not in ORDER_STATUS_LABELS:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "status_invalid"})
            return

        orders = read_orders()
        target = next((item for item in orders if clean_str(item.get("id")) == order_id), None)
        if not target:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "order_not_found"})
            return

        current_status = normalize_order_status(target.get("status", "new"))
        if not order_allows_status(target, requested_status):
            self.send_json(
                HTTPStatus.BAD_REQUEST,
                {
                    "error": "status_transition_invalid",
                    "current_status": current_status,
                    "requested_status": requested_status,
                },
            )
            return

        if current_status != requested_status:
            target["status"] = requested_status
            target["status_label"] = order_status_label(requested_status)
            append_order_status_history(target, requested_status, actor, note)
            if requested_status == "completed":
                target["completed_at"] = datetime.now(timezone.utc).isoformat()
            if requested_status == "cancelled":
                target["cancelled_at"] = datetime.now(timezone.utc).isoformat()
            write_orders(orders)

        self.send_json(HTTPStatus.OK, {"order": enrich_order(target)})

    def handle_create_order(self) -> None:
        payload = self.read_json_body()
        dish_id = payload.get("dish_id")

        if dish_id is None:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "dish_id_required"})
            return

        try:
            dish_id = int(dish_id)
        except (TypeError, ValueError):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "dish_id_invalid"})
            return

        dishes = read_dishes()
        dish = next((item for item in dishes if item.get("id") == dish_id), None)
        if not dish:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "dish_not_found"})
            return

        dish_with_availability = dict(dish)
        dish_with_availability.update(dish_availability(dish_with_availability))
        if not dish_with_availability.get("is_available"):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "dish_unavailable"})
            return

        delivery_mode = payload.get("delivery_mode") or (dish.get("delivery") or ["pickup"])[0]
        if delivery_mode not in set(dish.get("delivery", [])):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "delivery_mode_not_available"})
            return

        qty = safe_int(str(payload.get("qty", 1)), 1)
        if qty <= 0:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "qty_invalid"})
            return
        if qty > dish_portions_available(dish):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "dish_stock_not_enough"})
            return

        dish["portions_available"] = max(0, dish_portions_available(dish) - qty)
        write_dishes(dishes)

        orders = read_orders()
        order = {
            "id": next_order_id(orders),
            "dish_id": dish.get("id"),
            "dish_title": dish.get("title"),
            "cook_id": dish.get("cook_id"),
            "cook": dish.get("cook"),
            "price": dish.get("price"),
            "district": dish.get("district"),
            "city": payload.get("city", "Москва"),
            "customer_name": payload.get("customer_name", "Гость"),
            "customer_phone": payload.get("customer_phone", ""),
            "address": payload.get("address", ""),
            "comment": payload.get("comment", ""),
            "qty": qty,
            "total_price": safe_int(str(dish.get("price", 0)), 0) * qty,
            "delivery_mode": delivery_mode,
            "status": "new",
            "status_label": order_status_label("new"),
            "status_history": [
                {
                    "status": "new",
                    "at": datetime.now(timezone.utc).isoformat(),
                    "by": "customer",
                    "note": "Заказ создан",
                }
            ],
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        orders.append(order)
        write_orders(orders)

        self.send_json(HTTPStatus.CREATED, {"order": order})

    def handle_courier_booking(self) -> None:
        payload = self.read_json_body()
        tier = (payload.get("tier") or "start").lower()

        discount_by_tier = {
            "start": 0,
            "pro": 0.1,
            "studio": 0.2,
        }
        base_price = 1590
        discount = discount_by_tier.get(tier, 0)
        final_price = int(base_price * (1 - discount))

        booking = {
            "booking_id": f"CR-{datetime.now().strftime('%Y%m%d%H%M%S')}",
            "cook_name": payload.get("cook_name", "Повар"),
            "date": payload.get("date", datetime.now().strftime("%Y-%m-%d")),
            "status": "confirmed",
            "price": final_price,
            "currency": "RUB",
        }

        self.send_json(HTTPStatus.CREATED, {"booking": booking})

    def handle_cook_verification(self) -> None:
        payload = self.read_json_body()

        if not payload.get("full_name"):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "full_name_required"})
            return

        request_data = {
            "request_id": f"VR-{datetime.now().strftime('%Y%m%d%H%M%S')}",
            "full_name": payload.get("full_name"),
            "district": payload.get("district", "Москва"),
            "status": "pending",
        }

        self.send_json(HTTPStatus.CREATED, {"verification": request_data})

    def serve_static(self, path: str) -> None:
        if path.startswith("/uploads/"):
            self.serve_upload(path)
            return

        target_name = STATIC_FILES.get(path)
        if not target_name:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return

        target = PROJECT_ROOT / target_name
        if not target.exists():
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "file_not_found"})
            return

        mime = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        try:
            body = target.read_bytes()
        except OSError:
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "file_read_error"})
            return

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def serve_upload(self, path: str) -> None:
        filename = Path(path).name
        if not filename:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return

        target = UPLOADS_DIR / filename
        if not target.exists() or not target.is_file():
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "file_not_found"})
            return

        mime = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        try:
            body = target.read_bytes()
        except OSError:
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "file_read_error"})
            return

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def read_multipart_form(self) -> Optional[cgi.FieldStorage]:
        content_length = safe_int(self.headers.get("Content-Length", "0"), 0)
        if content_length <= 0:
            return None
        if content_length > (MAX_IMAGE_BYTES + 1024 * 1024):
            return None

        environ = {
            "REQUEST_METHOD": "POST",
            "CONTENT_TYPE": self.headers.get("Content-Type", ""),
            "CONTENT_LENGTH": str(content_length),
        }

        try:
            return cgi.FieldStorage(
                fp=self.rfile,
                headers=self.headers,
                environ=environ,
                keep_blank_values=True,
            )
        except (TypeError, ValueError):
            return None

    def read_json_body(self) -> Dict[str, Any]:
        size = int(self.headers.get("Content-Length", "0"))
        if size <= 0:
            return {}

        try:
            raw = self.rfile.read(size)
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return {}

    def query_value(self, query: Dict[str, List[str]], name: str, fallback: str) -> str:
        values = query.get(name)
        if not values:
            return fallback
        return values[0]

    def send_json(self, status: HTTPStatus, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)


def run() -> None:
    host = "127.0.0.1"
    port = 8080

    server = ThreadingHTTPServer((host, port), AppHandler)
    print(f"DomEda MVP server running on http://{host}:{port}")
    print(
        "Endpoints: /api/health, /api/dishes (GET/POST), /api/dishes/<id>, "
        "/api/dishes/<id>/reviews, /api/reviews, /api/cart/preview, /api/checkout, "
        "/api/orders, /api/orders/<id>, /api/orders/<id>/status, /api/payments, "
        "/api/cooks, /api/cooks/map, /api/subscriptions"
    )

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        print("Server stopped")


if __name__ == "__main__":
    run()
