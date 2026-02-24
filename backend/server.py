#!/usr/bin/env python3
"""MVP server for DomEda landing + API without external dependencies."""

from __future__ import annotations

import json
import mimetypes
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List
from urllib.parse import parse_qs, urlparse

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(__file__).resolve().parent / "data"
RUNTIME_DIR = DATA_DIR / "runtime"
STATIC_FILES = {
    "/": "index.html",
    "/index.html": "index.html",
    "/styles.css": "styles.css",
    "/app.js": "app.js",
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

        if path == "/api/cooks":
            cooks = read_json("cooks.json", [])
            self.send_json(HTTPStatus.OK, {"items": cooks, "total": len(cooks)})
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

    def filtered_dishes(self, query: Dict[str, List[str]]) -> List[Dict[str, Any]]:
        dishes = read_json("dishes.json", [])

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

        dishes = read_json("dishes.json", [])
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
            "cook": dish.get("cook"),
            "price": dish.get("price"),
            "district": dish.get("district"),
            "city": payload.get("city", "Москва"),
            "customer_name": payload.get("customer_name", "Гость"),
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
    print("Endpoints: /api/health, /api/dishes, /api/cooks, /api/subscriptions, /api/orders")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        print("Server stopped")


if __name__ == "__main__":
    run()
