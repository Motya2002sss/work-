const form = document.getElementById("cookDishForm");
const cookSelect = document.getElementById("cookSelect");
const imageInput = document.getElementById("imageInput");
const previewImage = document.getElementById("previewImage");
const previewPlaceholder = document.getElementById("previewPlaceholder");
const previewMeta = document.getElementById("previewMeta");
const cookSuccess = document.getElementById("cookSuccess");
const toast = document.getElementById("toast");

const showToast = (text) => {
  toast.textContent = text;
  toast.classList.add("show");
  window.clearTimeout(window.__toastTimer);
  window.__toastTimer = window.setTimeout(() => {
    toast.classList.remove("show");
  }, 3000);
};

const escapeHtml = (value) => {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
};

const selectedCookLabel = () => {
  const option = cookSelect.selectedOptions[0];
  return option ? option.textContent : "Повар не выбран";
};

const updatePreviewMeta = () => {
  const formData = new FormData(form);
  const title = String(formData.get("title") || "").trim();
  const price = String(formData.get("price") || "").trim();
  const grams = String(formData.get("portion_grams") || "").trim();
  const wait = String(formData.get("wait_minutes") || "").trim();

  const lines = [
    `<strong>${escapeHtml(title || "Название блюда")}</strong>`,
    `<span>Повар: ${escapeHtml(selectedCookLabel())}</span>`,
    `<span>Цена: ${escapeHtml(price || "-")} ₽</span>`,
    `<span>Порция: ${escapeHtml(grams || "-")} г</span>`,
    `<span>Готовность: ${escapeHtml(wait || "-")} мин</span>`,
  ];

  previewMeta.innerHTML = lines.join("");
};

const updateImagePreview = () => {
  const file = imageInput.files && imageInput.files[0];
  if (!file) {
    previewImage.removeAttribute("src");
    previewImage.hidden = true;
    previewPlaceholder.hidden = false;
    return;
  }

  const objectUrl = URL.createObjectURL(file);
  previewImage.src = objectUrl;
  previewImage.hidden = false;
  previewPlaceholder.hidden = true;
};

const populateCooks = async () => {
  try {
    const response = await fetch("/api/cooks");
    if (!response.ok) {
      throw new Error("cooks_request_failed");
    }

    const payload = await response.json();
    const cooks = payload.items || [];

    cookSelect.innerHTML = "";
    if (!cooks.length) {
      cookSelect.innerHTML = "<option value=''>Повара не найдены</option>";
      return;
    }

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Выберите повара";
    cookSelect.appendChild(placeholder);

    cooks.forEach((cook) => {
      const option = document.createElement("option");
      option.value = String(cook.id);
      option.textContent = `${cook.name} · ${cook.district} · ${Number(cook.rating).toFixed(1)}`;
      cookSelect.appendChild(option);
    });
  } catch (error) {
    cookSelect.innerHTML = "<option value=''>Ошибка загрузки поваров</option>";
  }
};

const hasDeliveryMode = () => {
  return form.querySelectorAll("input[name=delivery]:checked").length > 0;
};

const resetPreview = () => {
  previewImage.removeAttribute("src");
  previewImage.hidden = true;
  previewPlaceholder.hidden = false;
  cookSuccess.textContent = "";
  updatePreviewMeta();
};

const submitDish = async (event) => {
  event.preventDefault();

  if (!hasDeliveryMode()) {
    showToast("Выберите хотя бы один способ доставки");
    return;
  }

  const submitButton = form.querySelector("button[type=submit]");
  submitButton.disabled = true;
  submitButton.textContent = "Публикуем...";
  cookSuccess.textContent = "";

  try {
    const formData = new FormData(form);

    const response = await fetch("/api/dishes", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      throw new Error(errorPayload.error || "dish_create_failed");
    }

    const payload = await response.json();
    const dish = payload.dish;

    showToast(`Блюдо опубликовано: ${dish.title}`);
    cookSuccess.innerHTML = `Опубликовано успешно. <a href="/dish.html?id=${dish.id}">Открыть карточку блюда</a>`;

    const selectedCook = cookSelect.value;
    form.reset();
    cookSelect.value = selectedCook;
    resetPreview();
  } catch (error) {
    const knownErrors = {
      image_required: "Загрузите фото блюда.",
      image_too_large: "Фото слишком большое. Максимум 6 MB.",
      image_format_not_supported: "Поддерживаются PNG/JPG/WEBP.",
      title_required: "Укажите название блюда.",
      cook_id_required: "Выберите повара.",
      price_invalid: "Проверьте цену.",
      portion_grams_invalid: "Проверьте граммовку.",
    };
    showToast(knownErrors[error.message] || "Не удалось опубликовать блюдо.");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Опубликовать блюдо";
  }
};

const init = async () => {
  await populateCooks();
  resetPreview();

  form.addEventListener("input", updatePreviewMeta);
  form.addEventListener("change", updatePreviewMeta);
  imageInput.addEventListener("change", updateImagePreview);
  form.addEventListener("submit", submitDish);
};

init();
