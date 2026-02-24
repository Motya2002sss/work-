const detailLayout = document.getElementById("detailLayout");
const detailState = document.getElementById("detailState");
const recommendedSection = document.getElementById("recommendedSection");
const recommendedGrid = document.getElementById("recommendedGrid");
const reviewsSummary = document.getElementById("reviewsSummary");
const reviewsList = document.getElementById("reviewsList");
const reviewForm = document.getElementById("reviewForm");
const dishGoCartBtn = document.getElementById("dishGoCartBtn");
const toast = document.getElementById("toast");

const cartApi = window.DomEdaCart || {
  read: () => [],
  add: () => {},
  count: () => 0,
};

let currentDish = null;

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
    courier: "Курьер на день",
  };
  return map[mode] || mode;
};

const showToast = (text) => {
  toast.textContent = text;
  toast.classList.add("show");
  window.clearTimeout(window.__toastTimer);
  window.__toastTimer = window.setTimeout(() => {
    toast.classList.remove("show");
  }, 3000);
};

const getDishIdFromUrl = () => {
  const params = new URLSearchParams(window.location.search);
  const value = Number(params.get("id"));

  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }

  return value;
};

const updateCartButton = () => {
  if (!dishGoCartBtn) {
    return;
  }
  dishGoCartBtn.textContent = `Корзина (${cartApi.count()})`;
};

const renderErrorState = (message) => {
  detailLayout.innerHTML = `
    <div class="detail-state">
      <h3>Не удалось открыть карточку</h3>
      <p>${message}</p>
      <a class="btn" href="/index.html#market">Вернуться в витрину</a>
    </div>
  `;
};

const renderRecommended = (items) => {
  if (!items || !items.length) {
    recommendedSection.hidden = true;
    recommendedGrid.innerHTML = "";
    return;
  }

  recommendedSection.hidden = false;
  recommendedGrid.innerHTML = "";

  items.forEach((dish) => {
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
      <div class="dish-actions">
        <strong>${dish.price} ₽</strong>
        <div class="dish-buttons">
          <button class="btn small ghost" type="button" data-add ${dish.is_available ? "" : "disabled"}>В корзину</button>
          <a class="btn small" href="/dish.html?id=${dish.id}">Открыть</a>
        </div>
      </div>
    `;

    const addBtn = card.querySelector("[data-add]");
    addBtn.addEventListener("click", () => {
      cartApi.add(dish, 1);
      showToast(`Добавлено: ${dish.title}`);
    });

    recommendedGrid.appendChild(card);
  });
};

const renderReviews = (payload) => {
  if (!reviewsSummary || !reviewsList) {
    return;
  }

  const items = payload.items || [];
  const total = Number(payload.total || 0);
  const avg = Number(payload.average_rating || 0);
  reviewsSummary.textContent = total
    ? `Средняя оценка: ${avg.toFixed(2)} · отзывов: ${total}`
    : "Пока нет отзывов. Будьте первым.";

  reviewsList.innerHTML = "";
  if (!items.length) {
    reviewsList.innerHTML = "<div class='review-empty'>Отзывов пока нет.</div>";
    return;
  }

  items.forEach((item) => {
    const node = document.createElement("article");
    node.className = "review-item";
    node.innerHTML = `
      <div class="review-head">
        <strong>${item.customer_name}</strong>
        <span>${Number(item.rating).toFixed(1)} / 5</span>
      </div>
      <p>${item.text}</p>
      <div class="review-meta">${item.created_at ? new Date(item.created_at).toLocaleString("ru-RU") : ""}</div>
    `;
    reviewsList.appendChild(node);
  });
};

const fetchReviews = async (dishId) => {
  try {
    const response = await fetch(`/api/dishes/${dishId}/reviews`);
    if (!response.ok) {
      throw new Error("reviews_request_failed");
    }
    const payload = await response.json();
    renderReviews(payload);
  } catch (error) {
    if (reviewsSummary) {
      reviewsSummary.textContent = "Не удалось загрузить отзывы.";
    }
  }
};

const attachReviewFormHandlers = (dishId) => {
  if (!reviewForm) {
    return;
  }

  reviewForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(reviewForm);
    const payload = {
      dish_id: dishId,
      customer_name: formData.get("customer_name"),
      rating: Number(formData.get("rating")),
      order_id: formData.get("order_id"),
      text: formData.get("text"),
    };

    const submitButton = reviewForm.querySelector("button[type=submit]");
    submitButton.disabled = true;
    submitButton.textContent = "Отправляем...";

    try {
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "review_failed");
      }

      showToast("Отзыв сохранен");
      reviewForm.reset();
      await reloadDishCard(dishId);
    } catch (error) {
      const known = {
        text_too_short: "Добавьте более подробный отзыв.",
        rating_invalid: "Выберите корректную оценку.",
      };
      showToast(known[error.message] || "Не удалось отправить отзыв.");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Отправить отзыв";
    }
  });
};

const renderDishDetails = ({ dish, cook }) => {
  currentDish = dish;
  const imageBlock = dish.image_url
    ? `
      <img
        class="detail-image"
        src="${dish.image_url}"
        alt="${dish.title}"
        onerror="this.closest('.detail-image-wrap').classList.add('dish-image-missing')"
      />
      <span class="dish-image-fallback">Фото недоступно</span>
    `
    : `
      <div class="detail-image-empty">Повар еще не загрузил фото блюда</div>
    `;

  const isAvailable = !!dish.is_available;

  detailLayout.innerHTML = `
    <article class="detail-card">
      <div class="detail-image-wrap">
        ${imageBlock}
      </div>
      <div class="detail-head">
        <div>
          <div class="detail-meta">${dish.district} · ${dish.wait}</div>
          <h3>${dish.title}</h3>
          <p>${dish.description || "Домашнее блюдо от локального повара."}</p>
        </div>
        <div class="detail-price">${dish.price} ₽</div>
      </div>

      <div class="detail-tags">
        ${(dish.tags || []).map((tag) => `<span>${labelTag(tag)}</span>`).join("")}
      </div>

      <div class="detail-grid">
        <div class="detail-block">
          <div class="detail-block-title">Повар</div>
          <div>${dish.cook}</div>
          <div>Рейтинг: ${Number(dish.rating).toFixed(2)} (${dish.reviews_count || 0})</div>
          <div>${cook && cook.verified ? "Верифицирован" : "Ожидает верификации"}</div>
        </div>
        <div class="detail-block">
          <div class="detail-block-title">Порция</div>
          <div>${dish.portion || "~400 г"}</div>
          <div>Доставка: ${(dish.delivery || []).map(labelDelivery).join(", ")}</div>
        </div>
        <div class="detail-block">
          <div class="detail-block-title">Доступность</div>
          <div>${dish.availability_label || "Проверка"}</div>
          <div>Остаток: ${dish.portions_available || 0} порц.</div>
        </div>
      </div>
    </article>

    <article class="order-card">
      <h3>Корзина</h3>
      <p>Добавьте блюдо в корзину и оформите заказ на главной странице.</p>
      <div class="detail-cart-controls">
        <label>
          Количество
          <input id="detailQty" type="number" min="1" value="1" ${isAvailable ? "" : "disabled"} />
        </label>
        <button id="detailAddToCartBtn" class="btn full" type="button" ${isAvailable ? "" : "disabled"}>
          ${isAvailable ? "Добавить в корзину" : "Сейчас недоступно"}
        </button>
        <a class="btn ghost full" href="/index.html#cart-checkout">Перейти к оформлению</a>
      </div>
    </article>
  `;

  const addBtn = document.getElementById("detailAddToCartBtn");
  const qtyInput = document.getElementById("detailQty");
  if (addBtn && qtyInput && isAvailable) {
    addBtn.addEventListener("click", () => {
      const qty = Math.max(1, Number.parseInt(qtyInput.value, 10) || 1);
      if (dish.portions_available && qty > dish.portions_available) {
        showToast("Недостаточно порций в наличии");
        return;
      }
      cartApi.add(dish, qty);
      showToast(`Добавлено в корзину: ${dish.title} x${qty}`);
    });
  }
};

const reloadDishCard = async (dishId) => {
  const response = await fetch(`/api/dishes/${dishId}`);
  if (!response.ok) {
    throw new Error("dish_request_failed");
  }
  const payload = await response.json();
  renderDishDetails(payload);
  renderRecommended(payload.recommended || []);
  await fetchReviews(dishId);
  updateCartButton();
};

const init = async () => {
  const dishId = getDishIdFromUrl();
  if (!dishId) {
    renderErrorState("Укажите корректный id блюда в адресе страницы.");
    return;
  }

  attachReviewFormHandlers(dishId);

  try {
    await reloadDishCard(dishId);
  } catch (error) {
    renderErrorState("Блюдо не найдено или сервер недоступен.");
  }
};

if (detailState) {
  detailState.textContent = "Загрузка карточки блюда...";
}

window.addEventListener("domeda-cart-updated", updateCartButton);
updateCartButton();
init();
