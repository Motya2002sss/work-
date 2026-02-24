# ДомЕда MVP

Локальный MVP маркетплейса домашней еды (Москва):
- любой повар после верификации и подписки может продавать блюда;
- покупатель выбирает блюда по району, рейтингу и способу доставки;
- доставка: самовывоз, доставка поваром, курьер на день.

## Стек на текущем этапе

- Frontend: `index.html`, `styles.css`, `app.js` (чистый JS)
- Backend: `backend/server.py` (Python stdlib, без внешних зависимостей)
- Хранилище MVP: JSON-файлы в `backend/data`

## Быстрый запуск

1. Запустить сервер:
```bash
python3 backend/server.py
```

2. Открыть сайт:
```text
http://127.0.0.1:8080
```

## API (MVP)

- `GET /api/health` - проверка сервиса
- `GET /api/dishes` - блюда с фильтрами (`district`, `categories`, `delivery`, `min_rating`, `max_price`, `search`, `sort`)
- `GET /api/cooks` - список поваров
- `GET /api/subscriptions` - тарифы подписки
- `GET /api/orders` - список заказов
- `POST /api/orders` - создать заказ
- `POST /api/courier/book` - аренда курьера на день
- `POST /api/cooks/verification` - заявка на верификацию повара

## Структура

```text
.
├── backend/
│   ├── server.py
│   └── data/
│       ├── dishes.json
│       ├── cooks.json
│       ├── subscriptions.json
│       ├── orders.json
│       └── runtime/
├── index.html
├── styles.css
├── app.js
└── README.md
```

## Что уже готово

- Локальный landing + витрина блюд
- Фильтрация, сортировка, поиск
- Оформление заказа через API
- Блоки подписки, верификации, рейтинга и доставки

## Следующий этап (когда начнем "приложение")

- Авторизация (покупатель/повар/админ)
- Личный кабинет повара (меню, заказы, статус верификации)
- Кабинет покупателя (история заказов, избранное)
- Оплата и комиссии
- Переход на PostgreSQL + backend framework + мобильный клиент
