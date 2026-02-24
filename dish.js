const detailLayout = document.getElementById("detailLayout");
const detailState = document.getElementById("detailState");
const recommendedSection = document.getElementById("recommendedSection");
const recommendedGrid = document.getElementById("recommendedGrid");
const toast = document.getElementById("toast");

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
        <a class="btn small" href="/dish.html?id=${dish.id}">Открыть</a>
      </div>
    `;
    recommendedGrid.appendChild(card);
  });
};

const syncAddressControl = (form) => {
  const selected = form.querySelector("input[name=delivery_mode]:checked");
  const addressField = form.querySelector("textarea[name=address]");

  if (!selected || !addressField) {
    return;
  }

  if (selected.value === "pickup") {
    addressField.value = "";
    addressField.disabled = true;
    addressField.required = false;
    addressField.placeholder = "Для самовывоза адрес не нужен";
    return;
  }

  addressField.disabled = false;
  addressField.required = true;
  addressField.placeholder = "Укажите адрес доставки";
};

const attachOrderFormHandlers = (dish) => {
  const form = document.getElementById("orderForm");
  if (!form) {
    return;
  }

  form.querySelectorAll("input[name=delivery_mode]").forEach((radio) => {
    radio.addEventListener("change", () => {
      syncAddressControl(form);
    });
  });

  syncAddressControl(form);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const submitButton = form.querySelector("button[type=submit]");
    submitButton.disabled = true;
    submitButton.textContent = "Отправляем...";

    const formData = new FormData(form);
    const payload = {
      dish_id: dish.id,
      customer_name: formData.get("customer_name"),
      customer_phone: formData.get("customer_phone"),
      city: "Москва",
      address: formData.get("address"),
      comment: formData.get("comment"),
      delivery_mode: formData.get("delivery_mode"),
    };

    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error("order_request_failed");
      }

      const result = await response.json();
      showToast(`Заказ ${result.order.id} создан`);
      form.reset();
      const defaultMode = form.querySelector("input[name=delivery_mode]");
      if (defaultMode) {
        defaultMode.checked = true;
      }
      syncAddressControl(form);
    } catch (error) {
      showToast("Не удалось оформить заказ. Повторите попытку.");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Подтвердить заказ";
    }
  });
};

const renderDishDetails = ({ dish, cook }) => {
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
          <div>Рейтинг: ${Number(dish.rating).toFixed(1)}</div>
          <div>${cook && cook.verified ? "Верифицирован" : "Ожидает верификации"}</div>
        </div>
        <div class="detail-block">
          <div class="detail-block-title">Порция</div>
          <div>${dish.portion || "~400 г"}</div>
          <div>Доставка: ${(dish.delivery || []).map(labelDelivery).join(", ")}</div>
        </div>
        <div class="detail-block">
          <div class="detail-block-title">Локация повара</div>
          <div>${cook && cook.location ? cook.location.label : "Москва"}</div>
          <div>
            ${
              cook && cook.location
                ? `Координаты: ${cook.location.lat}, ${cook.location.lng}`
                : "Координаты появятся после подключения карты"
            }
          </div>
        </div>
      </div>
    </article>

    <article class="order-card">
      <h3>Оформить заказ</h3>
      <form id="orderForm" class="order-form">
        <label>
          Имя
          <input name="customer_name" type="text" required placeholder="Как к вам обращаться" />
        </label>

        <label>
          Телефон
          <input name="customer_phone" type="tel" placeholder="+7 (999) 000-00-00" />
        </label>

        <fieldset>
          <legend>Способ получения</legend>
          ${(dish.delivery || [])
            .map(
              (mode, index) => `
            <label class="radio-row">
              <input type="radio" name="delivery_mode" value="${mode}" ${index === 0 ? "checked" : ""} />
              ${labelDelivery(mode)}
            </label>
          `
            )
            .join("")}
        </fieldset>

        <label>
          Адрес
          <textarea name="address" rows="2" placeholder="Укажите адрес доставки"></textarea>
        </label>

        <label>
          Комментарий к заказу
          <textarea name="comment" rows="3" placeholder="Например: без лука"></textarea>
        </label>

        <button class="btn full" type="submit">Подтвердить заказ</button>
      </form>
    </article>
  `;

  attachOrderFormHandlers(dish);
};

const init = async () => {
  const dishId = getDishIdFromUrl();
  if (!dishId) {
    renderErrorState("Укажите корректный id блюда в адресе страницы.");
    return;
  }

  try {
    const response = await fetch(`/api/dishes/${dishId}`);
    if (!response.ok) {
      throw new Error("dish_request_failed");
    }

    const payload = await response.json();
    renderDishDetails(payload);
    renderRecommended(payload.recommended || []);
  } catch (error) {
    renderErrorState("Блюдо не найдено или сервер недоступен.");
  }
};

if (detailState) {
  detailState.textContent = "Загрузка карточки блюда...";
}

init();
