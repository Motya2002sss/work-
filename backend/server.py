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
STATIC_FILES = {
    "/": "index.html",
    "/index.html": "index.html",
    "/dish.html": "dish.html",
    "/cook.html": "cook.html",
    "/styles.css": "styles.css",
    "/app.js": "app.js",
    "/dish.js": "dish.js",
    "/cook.js": "cook.js",
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


def safe_int(value: str, fallback: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


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


def map_cook_points(cooks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    points: List[Dict[str, Any]] = []
    for cook in cooks:
        location = cook.get("location", {})
        if "lat" not in location or "lng" not in location:
            continue

        points.append(
            {
                "id": cook.get("id"),
                "name": cook.get("name"),
                "district": cook.get("district"),
                "rating": cook.get("rating"),
                "verified": cook.get("verified", False),
                "lat": location.get("lat"),
                "lng": location.get("lng"),
                "label": location.get("label", ""),
            }
        )

    return points


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

        if parsed.path == "/api/orders":
            self.handle_create_order()
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

        if path.startswith("/api/dishes/"):
            dish_id = safe_int(path.rsplit("/", 1)[-1], -1)
            if dish_id <= 0:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "dish_id_invalid"})
                return

            dishes = read_dishes()
            cooks = read_json("cooks.json", [])
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
            cooks = read_json("cooks.json", [])
            district = self.query_value(query, "district", "all")
            if district and district != "all":
                cooks = [item for item in cooks if item.get("district") == district]
            self.send_json(HTTPStatus.OK, {"items": cooks, "total": len(cooks)})
            return

        if path == "/api/cooks/map":
            cooks = read_json("cooks.json", [])
            district = self.query_value(query, "district", "all")
            if district and district != "all":
                cooks = [item for item in cooks if item.get("district") == district]

            points = map_cook_points(cooks)
            self.send_json(HTTPStatus.OK, {"items": points, "total": len(points)})
            return

        if path == "/api/subscriptions":
            plans = read_json("subscriptions.json", [])
            self.send_json(HTTPStatus.OK, {"items": plans, "total": len(plans)})
            return

        if path == "/api/orders":
            orders = read_orders()
            self.send_json(HTTPStatus.OK, {"items": orders, "total": len(orders)})
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
        dishes = read_dishes()

        district = self.query_value(query, "district", "all")
        categories = csv_set(self.query_value(query, "categories", ""))
        delivery = csv_set(self.query_value(query, "delivery", ""))
        search = self.query_value(query, "search", "").strip().lower()
        max_price = safe_float(self.query_value(query, "max_price", "999999"), 999999)
        min_rating = safe_float(self.query_value(query, "min_rating", "0"), 0)
        sort_key = self.query_value(query, "sort", "rating")

        if district and district != "all":
            dishes = [dish for dish in dishes if dish.get("district") == district]

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
            "image_url": image_url,
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

        delivery_mode = payload.get("delivery_mode") or (dish.get("delivery") or ["pickup"])[0]
        if delivery_mode not in set(dish.get("delivery", [])):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "delivery_mode_not_available"})
            return

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
            "delivery_mode": delivery_mode,
            "status": "new",
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
        "Endpoints: /api/health, /api/dishes (GET/POST), /api/dishes/<id>, /api/cooks, "
        "/api/cooks/map, /api/subscriptions, /api/orders"
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
