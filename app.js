const dishes = [
  {
    id: 1,
    title: "Курица с пюре",
    cook: "Светлана К.",
    district: "ЮЗАО",
    rating: 4.9,
    price: 450,
    tags: ["hot", "comfort"],
    delivery: ["pickup", "cook"],
    wait: "45 мин",
  },
  {
    id: 2,
    title: "Борщ с пампушками",
    cook: "Ирина П.",
    district: "САО",
    rating: 4.7,
    price: 380,
    tags: ["soup"],
    delivery: ["pickup"],
    wait: "35 мин",
  },
  {
    id: 3,
    title: "Сырники с ягодами",
    cook: "Татьяна М.",
    district: "ЦАО",
    rating: 4.8,
    price: 320,
    tags: ["dessert"],
    delivery: ["pickup", "courier"],
    wait: "25 мин",
  },
  {
    id: 4,
    title: "Поке с лососем",
    cook: "Арман М.",
    district: "ЦАО",
    rating: 4.8,
    price: 690,
    tags: ["healthy"],
    delivery: ["cook", "courier"],
    wait: "40 мин",
  },
  {
    id: 5,
    title: "Лазанья домашняя",
    cook: "Алина Р.",
    district: "ЮЗАО",
    rating: 4.6,
    price: 520,
    tags: ["hot"],
    delivery: ["pickup", "cook"],
    wait: "50 мин",
  },
  {
    id: 6,
    title: "Суп-пюре тыквенный",
    cook: "Мария С.",
    district: "СВАО",
    rating: 4.5,
    price: 310,
    tags: ["soup", "healthy"],
    delivery: ["pickup", "courier"],
    wait: "30 мин",
  },
  {
    id: 7,
    title: "Плов узбекский",
    cook: "Арман М.",
    district: "ЦАО",
    rating: 4.9,
    price: 560,
    tags: ["hot"],
    delivery: ["cook", "courier"],
    wait: "45 мин",
  },
  {
    id: 8,
    title: "Гречка с котлетами",
    cook: "Светлана К.",
    district: "ЮЗАО",
    rating: 4.7,
    price: 390,
    tags: ["hot"],
    delivery: ["pickup"],
    wait: "35 мин",
  },
];

const filters = {
  city: "Москва",
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
      ${dish.tags.map((tag) => `<span>${labelTag(tag)}</span>`).join("")}
    </div>
    <div class="dish-meta">
      <span>Рейтинг ${dish.rating.toFixed(1)}</span>
      <span>${dish.wait}</span>
    </div>
    <div class="dish-actions">
      <strong>${dish.price} ₽</strong>
      <button class="btn small" data-add>Добавить</button>
    </div>
  `;
  card.querySelector("[data-add]").addEventListener("click", () => {
    toast.classList.add("show");
    window.clearTimeout(window.__toastTimer);
    window.__toastTimer = window.setTimeout(() => {
      toast.classList.remove("show");
    }, 2400);
  });
  return card;
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

const applyFilters = () => {
  let items = [...dishes];

  if (filters.district !== "all") {
    items = items.filter((dish) => dish.district === filters.district);
  }

  if (filters.categories.size > 0) {
    items = items.filter((dish) =>
      [...filters.categories].some((cat) => dish.tags.includes(cat))
    );
  }

  if (filters.ratings.size > 0) {
    const minRating = Math.max(...[...filters.ratings].map(Number));
    items = items.filter((dish) => dish.rating >= minRating);
  }

  if (filters.delivery.size > 0) {
    items = items.filter((dish) =>
      [...filters.delivery].some((type) => dish.delivery.includes(type))
    );
  }

  items = items.filter((dish) => dish.price <= filters.maxPrice);

  if (filters.search) {
    const term = filters.search.toLowerCase();
    items = items.filter(
      (dish) =>
        dish.title.toLowerCase().includes(term) ||
        dish.cook.toLowerCase().includes(term) ||
        dish.district.toLowerCase().includes(term)
    );
  }

  if (filters.sort === "price-asc") {
    items.sort((a, b) => a.price - b.price);
  } else if (filters.sort === "price-desc") {
    items.sort((a, b) => b.price - a.price);
  } else {
    items.sort((a, b) => b.rating - a.rating);
  }

  renderGrid(items);
};

const renderGrid = (items) => {
  dishGrid.innerHTML = "";
  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "dish-card";
    empty.innerHTML = `
      <h3>Ничего не найдено</h3>
      <p>Попробуйте изменить фильтры или запрос.</p>
    `;
    dishGrid.appendChild(empty);
    return;
  }

  items.forEach((dish) => dishGrid.appendChild(renderDish(dish)));
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
  applyFilters();
};

const init = () => {
  priceValue.textContent = String(filters.maxPrice);
  priceInput.value = String(filters.maxPrice);
  applyFilters();

  priceInput.addEventListener("input", (event) => {
    filters.maxPrice = Number(event.target.value);
    priceValue.textContent = event.target.value;
    applyFilters();
  });

  districtSelect.addEventListener("change", (event) => {
    filters.district = event.target.value;
    applyFilters();
  });

  sortSelect.addEventListener("change", (event) => {
    filters.sort = event.target.value;
    applyFilters();
  });

  searchInput.addEventListener("input", (event) => {
    filters.search = event.target.value.trim();
    applyFilters();
  });

  document.querySelectorAll("input[type=checkbox]").forEach((checkbox) => {
    checkbox.addEventListener("change", (event) => {
      const group = event.target.dataset.group;
      updateFilterSet(group, event.target.value, event.target.checked);
    });
  });

  resetButton.addEventListener("click", () => {
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

    applyFilters();
  });
};

init();
