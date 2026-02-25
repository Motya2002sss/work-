const filters = {
  district: "all",
  categories: new Set(),
  ratings: new Set(),
  delivery: new Set(),
  maxPrice: 650,
  search: "",
  sort: "rating",
  availableOnly: false,
};

let activeCook = null;

const dishGrid = document.getElementById("dishGrid");
const priceInput = document.getElementById("price");
const priceValue = document.getElementById("priceValue");
const resetButton = document.getElementById("resetFilters");
const districtSelect = document.getElementById("district");
const sortSelect = document.getElementById("sort");
const searchInput = document.getElementById("searchInput");
const availableOnlyInput = document.getElementById("availableOnly");
const mapPoints = document.getElementById("mapPoints");
const mapStatus = document.getElementById("mapStatus");
const liveCookMapNode = document.getElementById("liveCookMap");
const activeCookFilter = document.getElementById("activeCookFilter");
const activeCookFilterName = document.getElementById("activeCookFilterName");
const clearCookFilterBtn = document.getElementById("clearCookFilter");
const goCartBtn = document.getElementById("goCartBtn");

const cartItemsNode = document.getElementById("cartItems");
const cartSummaryNode = document.getElementById("cartSummary");
const checkoutForm = document.getElementById("checkoutForm");
const clearCartBtn = document.getElementById("clearCartBtn");
const checkoutCardNumberInput = document.getElementById("checkoutCardNumber");
const checkoutExpMonthInput = document.getElementById("checkoutExpMonth");
const checkoutExpYearInput = document.getElementById("checkoutExpYear");
const checkoutCvcInput = document.getElementById("checkoutCvc");
const toast = document.getElementById("toast");

let dishesRequestId = 0;
let mapRequestId = 0;
let mapPointsCache = [];
let liveMapInstance = null;
let liveMapLayer = null;

const cartApi = window.DomEdaCart || {
  read: () => [],
  add: () => {},
  remove: () => {},
  setQty: () => {},
  clear: () => {},
  count: () => 0,
  total: () => 0,
};

const labelTag = (tag) => {
  const map = {
    hot: "Горячее",
    soup: "Суп",
    dessert: "Десерт",
    healthy: "ПП",
    comfort: "Домашнее",
  };
  return map[tag] || tag;
};

const labelDelivery = (mode) => {
  const map = {
    pickup: "Самовывоз",
    cook: "Доставка поваром",
    courier: "Курьер",
  };
  return map[mode] || mode;
};

const showToast = (text) => {
  toast.textContent = text;
  toast.classList.add("show");
  window.clearTimeout(window.__toastTimer);
  window.__toastTimer = window.setTimeout(() => {
    toast.classList.remove("show");
  }, 3200);
};

const normalizeCardNumber = (value) => String(value || "").replace(/\D/g, "").slice(0, 19);

const formatCardNumber = (digits) => {
  const groups = [];
  for (let i = 0; i < digits.length; i += 4) {
    groups.push(digits.slice(i, i + 4));
  }
  return groups.join(" ");
};

const normalizeCvc = (value) => String(value || "").replace(/\D/g, "").slice(0, 4);

const escapeHtml = (value) => {
  const div = document.createElement("div");
  div.textContent = String(value || "");
  return div.innerHTML;
};

const numberValue = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const activeCookLabel = () => {
  if (!activeCook) {
    return "";
  }
  if (activeCook.name) {
    return activeCook.name;
  }
  return `Повар #${activeCook.id}`;
};

const syncActiveCookFilterBar = () => {
  if (!activeCookFilter || !activeCookFilterName) {
    return;
  }

  if (!activeCook) {
    activeCookFilter.hidden = true;
    activeCookFilterName.textContent = "Не выбран";
    return;
  }

  activeCookFilter.hidden = false;
  activeCookFilterName.textContent = activeCookLabel();
};

const applyInitialFiltersFromUrl = () => {
  const params = new URLSearchParams(window.location.search);
  const queryDistrict = String(params.get("district") || "").trim();
  const queryCookId = numberValue(params.get("cook_id"));
  const queryCookName = String(params.get("cook_name") || "").trim();

  if (queryDistrict && districtSelect) {
    const validDistrict = [...districtSelect.options].some((item) => item.value === queryDistrict);
    if (validDistrict) {
      filters.district = queryDistrict;
    }
  }

  if (queryCookId > 0) {
    activeCook = {
      id: queryCookId,
      name: queryCookName,
    };
  }
};

const clearActiveCook = (withToast = false) => {
  if (!activeCook) {
    return;
  }
  activeCook = null;
  syncActiveCookFilterBar();
  fetchDishes();
  fetchMapPoints();
  if (withToast) {
    showToast("Фильтр повара сброшен");
  }
};

const ensureLiveCookMap = () => {
  if (!liveCookMapNode) {
    return null;
  }
  if (liveMapInstance) {
    return liveMapInstance;
  }
  if (!window.L) {
    liveCookMapNode.classList.add("fallback");
    liveCookMapNode.textContent = "Карта недоступна, используйте список точек справа.";
    return null;
  }

  liveCookMapNode.classList.remove("fallback");
  liveCookMapNode.textContent = "";
  liveMapInstance = window.L.map(liveCookMapNode, {
    zoomControl: true,
  });
  liveMapLayer = window.L.layerGroup().addTo(liveMapInstance);
  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap",
    maxZoom: 19,
  }).addTo(liveMapInstance);
  liveMapInstance.setView([55.751244, 37.618423], 10);
  return liveMapInstance;
};

const formatPointPrice = (point) => {
  const minPrice = numberValue(point.min_price);
  if (minPrice > 0) {
    return `от ${minPrice} ₽`;
  }
  return "цена уточняется";
};

const selectCookFromPoint = (point, shouldScroll) => {
  if (!point || numberValue(point.id) <= 0) {
    return;
  }

  activeCook = {
    id: numberValue(point.id),
    name: String(point.name || "").trim(),
  };
  syncActiveCookFilterBar();
  renderMapPoints(mapPointsCache);
  fetchDishes();

  if (shouldScroll) {
    const market = document.getElementById("market");
    if (market) {
      market.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
};

const renderMapMarkers = (points) => {
  const map = ensureLiveCookMap();
  if (!map || !liveMapLayer) {
    return;
  }

  liveMapLayer.clearLayers();

  if (!points.length) {
    map.setView([55.751244, 37.618423], 10);
    return;
  }

  const bounds = [];
  points.forEach((point) => {
    const lat = numberValue(point.lat);
    const lng = numberValue(point.lng);
    if (!lat || !lng) {
      return;
    }

    const marker = window.L.marker([lat, lng]);
    marker.bindPopup(
      `
        <strong>${escapeHtml(point.name)}</strong><br />
        ${escapeHtml(point.district)}<br />
        Рейтинг: ${numberValue(point.rating).toFixed(1)}<br />
        Меню: ${numberValue(point.available_dishes_count)}/${numberValue(point.dishes_count)}<br />
        ${formatPointPrice(point)}
      `
    );
    marker.on("click", () => {
      selectCookFromPoint(point, true);
    });
    marker.addTo(liveMapLayer);
    bounds.push([lat, lng]);

    if (activeCook && numberValue(activeCook.id) === numberValue(point.id)) {
      marker.openPopup();
      map.setView([lat, lng], 12);
    }
  });

  if (!bounds.length) {
    return;
  }

  if (!activeCook) {
    map.fitBounds(bounds, { padding: [25, 25] });
  }
};

const buildDishesQuery = () => {
  const params = new URLSearchParams();
  params.set("max_price", String(filters.maxPrice));

  if (filters.district !== "all") {
    params.set("district", filters.district);
  }

  if (filters.categories.size > 0) {
    params.set("categories", [...filters.categories].join(","));
  }

  if (filters.delivery.size > 0) {
    params.set("delivery", [...filters.delivery].join(","));
  }

  if (filters.search) {
    params.set("search", filters.search);
  }

  if (filters.ratings.size > 0) {
    const minRating = Math.max(...[...filters.ratings].map(Number));
    params.set("min_rating", String(minRating));
  }

  if (filters.availableOnly) {
    params.set("available_only", "1");
  }

  if (activeCook && activeCook.id > 0) {
    params.set("cook_id", String(activeCook.id));
  }

  params.set("sort", filters.sort);
  return params.toString();
};

const updateCartButton = () => {
  if (!goCartBtn) {
    return;
  }
  goCartBtn.textContent = `Корзина (${cartApi.count()})`;
};

const renderDish = (dish) => {
  const card = document.createElement("article");
  card.className = "dish-card";

  const imageBlock = dish.image_url
    ? `
      <img
        class="dish-image"
        src="${dish.image_url}"
        alt="${dish.title}"
        onerror="this.closest('.dish-image-wrap').classList.add('dish-image-missing')"
      />
      <span class="dish-image-fallback">Фото недоступно</span>
    `
    : `
      <div class="dish-image-empty">Фото скоро загрузят</div>
    `;

  const availabilityClass = dish.is_available ? "availability-ok" : "availability-off";
  const addDisabled = dish.is_available ? "" : "disabled";

  card.innerHTML = `
    <div class="dish-image-wrap">
      ${imageBlock}
    </div>
    <div class="dish-meta">
      <span>${dish.cook}</span>
      <span>${dish.district}</span>
    </div>
    <h3>${dish.title}</h3>
    <div class="dish-tags">
      ${(dish.tags || []).map((tag) => `<span>${labelTag(tag)}</span>`).join("")}
    </div>
    <div class="dish-meta">
      <span>Рейтинг ${Number(dish.rating).toFixed(1)} (${dish.reviews_count || 0})</span>
      <span>${dish.wait || "40 мин"}</span>
    </div>
    <div class="dish-meta">
      <span>Доставка: ${(dish.delivery || []).map(labelDelivery).join(", ")}</span>
    </div>
    <div class="dish-availability ${availabilityClass}">${dish.availability_label || "Проверка наличия"}</div>
    <div class="dish-actions">
      <strong>${dish.price} ₽</strong>
      <div class="dish-buttons">
        <button class="btn small ghost" type="button" data-add-cart ${addDisabled}>В корзину</button>
        <a class="btn small" href="/dish.html?id=${dish.id}">Открыть</a>
      </div>
    </div>
  `;

  const addButton = card.querySelector("[data-add-cart]");
  if (addButton) {
    addButton.addEventListener("click", () => {
      cartApi.add(dish, 1);
      showToast(`Добавлено в корзину: ${dish.title}`);
    });
  }

  return card;
};

const renderLoading = () => {
  dishGrid.innerHTML = "";
  const state = document.createElement("div");
  state.className = "dish-card";
  state.innerHTML = "<h3>Загрузка блюд...</h3><p>Обновляем предложения в вашем районе.</p>";
  dishGrid.appendChild(state);
};

const renderError = () => {
  dishGrid.innerHTML = "";
  const state = document.createElement("div");
  state.className = "dish-card";
  state.innerHTML = "<h3>Сервер недоступен</h3><p>Запустите backend: <code>python3 backend/server.py</code>.</p>";
  dishGrid.appendChild(state);
};

const renderGrid = (items) => {
  dishGrid.innerHTML = "";

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "dish-card";
    empty.innerHTML = "<h3>Ничего не найдено</h3><p>Попробуйте изменить фильтры или поисковый запрос.</p>";
    dishGrid.appendChild(empty);
    return;
  }

  items.forEach((dish) => {
    dishGrid.appendChild(renderDish(dish));
  });
};

const fetchDishes = async () => {
  const requestId = ++dishesRequestId;
  renderLoading();

  try {
    const query = buildDishesQuery();
    const response = await fetch(`/api/dishes?${query}`);
    if (!response.ok) {
      throw new Error("dishes_request_failed");
    }

    const payload = await response.json();
    if (requestId !== dishesRequestId) {
      return;
    }
    renderGrid(payload.items || []);
  } catch (error) {
    if (requestId !== dishesRequestId) {
      return;
    }
    renderError();
  }
};

const renderMapLoading = () => {
  if (!mapStatus || !mapPoints) {
    return;
  }
  mapStatus.textContent = "Загружаем точки поваров...";
  mapPoints.innerHTML = "";
  renderMapMarkers([]);
};

const renderMapError = () => {
  if (!mapStatus || !mapPoints) {
    return;
  }
  mapStatus.textContent = "Не удалось загрузить точки. Проверьте API.";
  mapPoints.innerHTML = "";
  renderMapMarkers([]);
};

const renderMapPoints = (items) => {
  if (!mapStatus || !mapPoints) {
    return;
  }

  mapPoints.innerHTML = "";
  const active = items.filter((point) => numberValue(point.available_dishes_count) > 0).length;
  mapStatus.textContent = `Найдено точек: ${items.length} · с активным меню: ${active}`;

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "map-point";
    empty.textContent = "В выбранном районе пока нет поваров.";
    mapPoints.appendChild(empty);
    renderMapMarkers(items);
    return;
  }

  items.forEach((point) => {
    const item = document.createElement("article");
    const isActive = activeCook && numberValue(activeCook.id) === numberValue(point.id);
    item.className = `map-point${isActive ? " active" : ""}`;
    item.innerHTML = `
      <div class="map-point-head">
        <strong>${escapeHtml(point.name)}</strong>
        <span>${escapeHtml(point.district)}</span>
      </div>
      <div class="map-point-body">
        <div>Рейтинг: ${numberValue(point.rating).toFixed(1)}</div>
        <div>Меню: ${numberValue(point.available_dishes_count)}/${numberValue(point.dishes_count)}</div>
        <div>${formatPointPrice(point)}</div>
        <div>${escapeHtml(point.label)}</div>
      </div>
      <div class="map-point-actions">
        <button class="btn small ghost" type="button" data-open-menu>Показать блюда</button>
      </div>
    `;
    item.querySelector("[data-open-menu]").addEventListener("click", () => {
      selectCookFromPoint(point, true);
    });
    mapPoints.appendChild(item);
  });

  renderMapMarkers(items);
};

const fetchMapPoints = async () => {
  if (!mapStatus || !mapPoints) {
    return;
  }

  const requestId = ++mapRequestId;
  renderMapLoading();

  try {
    const params = new URLSearchParams();
    if (filters.district !== "all") {
      params.set("district", filters.district);
    }
    if (filters.availableOnly) {
      params.set("available_only", "1");
    }

    const query = params.toString();
    const url = query ? `/api/cooks/map?${query}` : "/api/cooks/map";
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error("map_request_failed");
    }

    const payload = await response.json();
    if (requestId !== mapRequestId) {
      return;
    }

    mapPointsCache = payload.items || [];
    if (activeCook) {
      const selectedPoint = mapPointsCache.find(
        (point) => numberValue(point.id) === numberValue(activeCook.id)
      );
      if (!selectedPoint) {
        activeCook = null;
        syncActiveCookFilterBar();
      } else if (!activeCook.name) {
        activeCook.name = String(selectedPoint.name || "").trim();
        syncActiveCookFilterBar();
      }
    }
    renderMapPoints(mapPointsCache);
  } catch (error) {
    if (requestId !== mapRequestId) {
      return;
    }
    renderMapError();
  }
};

const syncCheckoutAddressControl = () => {
  if (!checkoutForm) {
    return;
  }

  const selected = checkoutForm.querySelector("input[name=delivery_mode]:checked");
  const addressField = checkoutForm.querySelector("textarea[name=address]");
  if (!selected || !addressField) {
    return;
  }

  if (selected.value === "pickup") {
    addressField.required = false;
    addressField.disabled = true;
    addressField.placeholder = "Для самовывоза адрес не нужен";
    return;
  }

  addressField.disabled = false;
  addressField.required = true;
  addressField.placeholder = "Укажите адрес доставки";
};

const cartErrorMessage = (code) => {
  const map = {
    items_required: "Корзина пуста.",
    dish_unavailable: "Одно из блюд уже недоступно.",
    dish_stock_not_enough: "Недостаточно порций по одному из блюд.",
    delivery_mode_not_available: "Для одного из блюд выбранный тип доставки недоступен.",
    delivery_mode_invalid: "Проверьте способ доставки.",
    payment_required: "Данные карты обязательны.",
    payment_method_not_supported: "Поддерживается только оплата картой.",
    card_number_invalid: "Проверьте номер карты.",
    card_expiry_invalid: "Проверьте срок действия карты.",
    card_expired: "Срок действия карты истек.",
    card_cvc_invalid: "Проверьте CVC код.",
    card_holder_invalid: "Проверьте имя держателя карты.",
  };
  return map[code] || "Не удалось оформить заказ. Повторите попытку.";
};

const validateCheckoutPaymentFields = (formData) => {
  const holder = String(formData.get("card_holder") || "").trim();
  const cardNumber = normalizeCardNumber(formData.get("card_number"));
  const expMonth = Number(formData.get("exp_month"));
  const expYear = Number(formData.get("exp_year"));
  const cvc = normalizeCvc(formData.get("cvc"));

  if (holder.length < 2) {
    return { ok: false, message: "Укажите имя держателя карты" };
  }
  if (cardNumber.length < 13 || cardNumber.length > 19) {
    return { ok: false, message: "Проверьте номер карты" };
  }
  if (!Number.isFinite(expMonth) || expMonth < 1 || expMonth > 12) {
    return { ok: false, message: "Проверьте месяц срока карты" };
  }
  const currentYear = new Date().getFullYear();
  if (!Number.isFinite(expYear) || expYear < currentYear || expYear > 2100) {
    return { ok: false, message: "Проверьте год срока карты" };
  }
  if (cvc.length < 3 || cvc.length > 4) {
    return { ok: false, message: "Проверьте CVC" };
  }

  return {
    ok: true,
    payment: {
      method: "card",
      holder,
      card_number: cardNumber,
      exp_month: expMonth,
      exp_year: expYear,
      cvc,
    },
  };
};

const renderCart = async () => {
  if (!cartItemsNode || !cartSummaryNode) {
    return;
  }

  updateCartButton();

  const items = cartApi.read();
  if (!items.length) {
    cartItemsNode.innerHTML = "<div class='cart-empty'>Корзина пуста. Добавьте блюда из витрины.</div>";
    cartSummaryNode.textContent = "Итого: 0 ₽";
    return;
  }

  const ids = items.map((item) => item.id).join(",");
  const response = await fetch(`/api/cart/preview?ids=${encodeURIComponent(ids)}`);
  if (!response.ok) {
    cartItemsNode.innerHTML = "<div class='cart-empty'>Не удалось загрузить корзину.</div>";
    return;
  }

  const payload = await response.json();
  const liveMap = new Map((payload.items || []).map((dish) => [dish.id, dish]));

  let total = 0;
  cartItemsNode.innerHTML = "";

  items.forEach((item) => {
    const live = liveMap.get(item.id);
    const price = live ? Number(live.price) : Number(item.price);
    const title = live ? live.title : item.title;
    const availability = live ? live.availability_label : "Проверьте наличие";
    const isAvailable = live ? !!live.is_available : false;
    const portionsAvailable = live ? Number(live.portions_available || 0) : 0;
    const safeQty = isAvailable ? Math.min(item.qty, Math.max(1, portionsAvailable || item.qty)) : item.qty;

    const subtotal = price * safeQty;
    total += subtotal;

    const row = document.createElement("article");
    row.className = "cart-item";
    row.innerHTML = `
      <div class="cart-item-main">
        <strong>${escapeHtml(title)}</strong>
        <span>${availability}</span>
      </div>
      <div class="cart-item-controls">
        <button type="button" class="btn ghost small" data-dec>-</button>
        <span>${safeQty}</span>
        <button type="button" class="btn ghost small" data-inc ${isAvailable ? "" : "disabled"}>+</button>
      </div>
      <div class="cart-item-price">${subtotal} ₽</div>
      <button type="button" class="btn ghost small" data-remove>Удалить</button>
    `;

    row.querySelector("[data-dec]").addEventListener("click", () => {
      cartApi.setQty(item.id, safeQty - 1);
    });

    row.querySelector("[data-inc]").addEventListener("click", () => {
      const nextQty = safeQty + 1;
      if (portionsAvailable > 0 && nextQty > portionsAvailable) {
        showToast("Превышено доступное количество порций");
        return;
      }
      cartApi.setQty(item.id, nextQty);
    });

    row.querySelector("[data-remove]").addEventListener("click", () => {
      cartApi.remove(item.id);
    });

    cartItemsNode.appendChild(row);
  });

  cartSummaryNode.textContent = `Итого: ${total} ₽ · Позиций: ${cartApi.count()}`;
};

const submitCheckout = async (event) => {
  event.preventDefault();

  const items = cartApi.read();
  if (!items.length) {
    showToast("Корзина пуста");
    return;
  }

  const formData = new FormData(checkoutForm);
  const deliveryMode = String(formData.get("delivery_mode") || "pickup");
  const paymentValidation = validateCheckoutPaymentFields(formData);
  if (!paymentValidation.ok) {
    showToast(paymentValidation.message);
    return;
  }

  const payload = {
    items: items.map((item) => ({ dish_id: item.id, qty: item.qty })),
    customer_name: String(formData.get("customer_name") || ""),
    customer_phone: String(formData.get("customer_phone") || ""),
    address: String(formData.get("address") || ""),
    comment: String(formData.get("comment") || ""),
    delivery_mode: deliveryMode,
    city: "Москва",
    payment: paymentValidation.payment,
  };

  const submitButton = checkoutForm.querySelector("button[type=submit]");
  submitButton.disabled = true;
  submitButton.textContent = "Оформляем...";

  try {
    const response = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "checkout_failed");
    }

    cartApi.clear();
    checkoutForm.reset();
    if (checkoutCardNumberInput) {
      checkoutCardNumberInput.value = "";
    }
    if (checkoutCvcInput) {
      checkoutCvcInput.value = "";
    }
    syncCheckoutAddressControl();
    showToast(`Оплата прошла. Заказ ${result.order.id} оформлен`);

    fetchDishes();
    fetchMapPoints();
  } catch (error) {
    showToast(cartErrorMessage(error.message));
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Оформить заказ";
  }
};

const updateFilterSet = (group, value, checked) => {
  if (!filters[group]) {
    return;
  }

  if (checked) {
    filters[group].add(value);
  } else {
    filters[group].delete(value);
  }

  fetchDishes();
};

const resetFilters = () => {
  filters.district = "all";
  filters.categories.clear();
  filters.ratings.clear();
  filters.delivery.clear();
  filters.maxPrice = 650;
  filters.search = "";
  filters.sort = "rating";
  filters.availableOnly = false;
  activeCook = null;

  districtSelect.value = "all";
  priceInput.value = String(filters.maxPrice);
  priceValue.textContent = String(filters.maxPrice);
  sortSelect.value = "rating";
  searchInput.value = "";
  if (availableOnlyInput) {
    availableOnlyInput.checked = false;
  }

  document.querySelectorAll("input[type=checkbox][data-group]").forEach((checkbox) => {
    checkbox.checked = false;
  });

  syncActiveCookFilterBar();
  fetchDishes();
  fetchMapPoints();
};

const bindCheckoutPaymentInputs = () => {
  if (checkoutCardNumberInput) {
    checkoutCardNumberInput.addEventListener("input", (event) => {
      const digits = normalizeCardNumber(event.target.value);
      event.target.value = formatCardNumber(digits);
    });
  }

  if (checkoutCvcInput) {
    checkoutCvcInput.addEventListener("input", (event) => {
      event.target.value = normalizeCvc(event.target.value);
    });
  }

  if (checkoutExpMonthInput) {
    checkoutExpMonthInput.addEventListener("input", (event) => {
      const month = Math.max(1, Math.min(12, Number(event.target.value) || 0));
      if (event.target.value !== "") {
        event.target.value = String(month);
      }
    });
  }

  if (checkoutExpYearInput) {
    checkoutExpYearInput.addEventListener("input", (event) => {
      const year = Number(event.target.value) || 0;
      if (year > 2100) {
        event.target.value = "2100";
      }
    });
  }
};

const init = () => {
  applyInitialFiltersFromUrl();
  syncActiveCookFilterBar();
  ensureLiveCookMap();

  priceValue.textContent = String(filters.maxPrice);
  priceInput.value = String(filters.maxPrice);
  if (districtSelect) {
    districtSelect.value = filters.district;
  }

  priceInput.addEventListener("input", (event) => {
    filters.maxPrice = Number(event.target.value);
    priceValue.textContent = event.target.value;
    fetchDishes();
  });

  districtSelect.addEventListener("change", (event) => {
    const selectedDistrict = event.target.value;
    const hasChanged = filters.district !== selectedDistrict;
    filters.district = selectedDistrict;
    if (hasChanged && activeCook) {
      activeCook = null;
      syncActiveCookFilterBar();
    }
    fetchDishes();
    fetchMapPoints();
  });

  sortSelect.addEventListener("change", (event) => {
    filters.sort = event.target.value;
    fetchDishes();
  });

  searchInput.addEventListener("input", (event) => {
    filters.search = event.target.value.trim();
    fetchDishes();
  });

  if (availableOnlyInput) {
    availableOnlyInput.addEventListener("change", (event) => {
      filters.availableOnly = event.target.checked;
      fetchDishes();
      fetchMapPoints();
    });
  }

  document.querySelectorAll("input[type=checkbox][data-group]").forEach((checkbox) => {
    checkbox.addEventListener("change", (event) => {
      const group = event.target.dataset.group;
      updateFilterSet(group, event.target.value, event.target.checked);
    });
  });

  resetButton.addEventListener("click", () => {
    resetFilters();
  });

  if (clearCookFilterBtn) {
    clearCookFilterBtn.addEventListener("click", () => {
      clearActiveCook(true);
    });
  }

  if (clearCartBtn) {
    clearCartBtn.addEventListener("click", () => {
      cartApi.clear();
    });
  }

  if (checkoutForm) {
    checkoutForm.addEventListener("submit", submitCheckout);
    checkoutForm.querySelectorAll("input[name=delivery_mode]").forEach((radio) => {
      radio.addEventListener("change", syncCheckoutAddressControl);
    });
    syncCheckoutAddressControl();
    bindCheckoutPaymentInputs();
  }

  window.addEventListener("domeda-cart-updated", () => {
    renderCart();
  });

  fetchDishes();
  fetchMapPoints();
  renderCart();
  updateCartButton();
};

init();
