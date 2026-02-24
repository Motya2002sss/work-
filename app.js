const filters = {
  district: "all",
  categories: new Set(),
  ratings: new Set(),
  delivery: new Set(),
  maxPrice: 650,
  search: "",
  sort: "rating",
};

const dishGrid = document.getElementById("dishGrid");
const priceInput = document.getElementById("price");
const priceValue = document.getElementById("priceValue");
const resetButton = document.getElementById("resetFilters");
const districtSelect = document.getElementById("district");
const sortSelect = document.getElementById("sort");
const searchInput = document.getElementById("searchInput");
const mapPoints = document.getElementById("mapPoints");
const mapStatus = document.getElementById("mapStatus");

let dishesRequestId = 0;
let mapRequestId = 0;

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

  params.set("sort", filters.sort);
  return params.toString();
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
      <span>Рейтинг ${Number(dish.rating).toFixed(1)}</span>
      <span>${dish.wait || "40 мин"}</span>
    </div>
    <div class="dish-meta">
      <span>Доставка: ${(dish.delivery || []).map(labelDelivery).join(", ")}</span>
    </div>
    <div class="dish-actions">
      <strong>${dish.price} ₽</strong>
      <a class="btn small" href="/dish.html?id=${dish.id}">Открыть</a>
    </div>
  `;

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
};

const renderMapError = () => {
  if (!mapStatus || !mapPoints) {
    return;
  }
  mapStatus.textContent = "Не удалось загрузить точки. Проверьте API.";
  mapPoints.innerHTML = "";
};

const renderMapPoints = (items) => {
  if (!mapStatus || !mapPoints) {
    return;
  }

  mapPoints.innerHTML = "";
  mapStatus.textContent = `Найдено точек: ${items.length}`;

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "map-point";
    empty.textContent = "В выбранном районе пока нет поваров.";
    mapPoints.appendChild(empty);
    return;
  }

  items.forEach((point) => {
    const item = document.createElement("article");
    item.className = "map-point";
    item.innerHTML = `
      <div class="map-point-head">
        <strong>${point.name}</strong>
        <span>${point.district}</span>
      </div>
      <div class="map-point-body">
        <div>Рейтинг: ${Number(point.rating).toFixed(1)}</div>
        <div>${point.label}</div>
        <div>Координаты: ${point.lat}, ${point.lng}</div>
      </div>
    `;
    mapPoints.appendChild(item);
  });
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

    renderMapPoints(payload.items || []);
  } catch (error) {
    if (requestId !== mapRequestId) {
      return;
    }
    renderMapError();
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

  districtSelect.value = "all";
  priceInput.value = String(filters.maxPrice);
  priceValue.textContent = String(filters.maxPrice);
  sortSelect.value = "rating";
  searchInput.value = "";

  document.querySelectorAll("input[type=checkbox]").forEach((checkbox) => {
    checkbox.checked = false;
  });

  fetchDishes();
  fetchMapPoints();
};

const init = () => {
  priceValue.textContent = String(filters.maxPrice);
  priceInput.value = String(filters.maxPrice);

  priceInput.addEventListener("input", (event) => {
    filters.maxPrice = Number(event.target.value);
    priceValue.textContent = event.target.value;
    fetchDishes();
  });

  districtSelect.addEventListener("change", (event) => {
    filters.district = event.target.value;
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

  document.querySelectorAll("input[type=checkbox]").forEach((checkbox) => {
    checkbox.addEventListener("change", (event) => {
      const group = event.target.dataset.group;
      updateFilterSet(group, event.target.value, event.target.checked);
    });
  });

  resetButton.addEventListener("click", () => {
    resetFilters();
  });

  fetchDishes();
  fetchMapPoints();
};

init();
