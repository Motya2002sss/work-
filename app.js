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
const toast = document.getElementById("toast");
let dishesRequestId = 0;

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
  }, 2800);
};

const buildQuery = () => {
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

const createOrder = async (dish) => {
  const fallbackMode = (dish.delivery && dish.delivery[0]) || "pickup";

  const response = await fetch("/api/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      dish_id: dish.id,
      customer_name: "Покупатель",
      city: "Москва",
      delivery_mode: fallbackMode,
    }),
  });

  if (!response.ok) {
    throw new Error("order_request_failed");
  }

  const payload = await response.json();
  return payload.order;
};

const renderDish = (dish) => {
  const card = document.createElement("article");
  card.className = "dish-card";
  card.innerHTML = `
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
      <button class="btn small" data-add>Заказать</button>
    </div>
  `;

  card.querySelector("[data-add]").addEventListener("click", async () => {
    try {
      const order = await createOrder(dish);
      showToast(`Заказ ${order.id} создан`);
    } catch (error) {
      showToast("Ошибка заказа. Повторите позже.");
    }
  });

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
  state.innerHTML = "<h3>Сервер недоступен</h3><p>Запустите backend: `python3 backend/server.py`.</p>";
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
    const query = buildQuery();
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
};

init();
