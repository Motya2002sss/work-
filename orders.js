const toast = document.getElementById("toast");
const customerOrdersNode = document.getElementById("customerOrders");
const cookOrdersNode = document.getElementById("cookOrders");
const customerRefreshBtn = document.getElementById("customerRefreshBtn");
const cookRefreshBtn = document.getElementById("cookRefreshBtn");
const customerPhoneInput = document.getElementById("customerPhoneInput");
const customerNameInput = document.getElementById("customerNameInput");
const cookSelect = document.getElementById("cookSelectOrders");
const cookStatusFilter = document.getElementById("cookStatusFilter");
const overviewTotal = document.getElementById("overviewTotal");
const overviewActive = document.getElementById("overviewActive");
const overviewDone = document.getElementById("overviewDone");

const STATUS_LABELS = {
  new: "Новый",
  paid: "Оплачен",
  accepted: "Принят",
  cooking: "Готовится",
  ready: "Готов к выдаче",
  delivering: "В пути",
  completed: "Завершен",
  cancelled: "Отменен",
};

const STATUS_OPTIONS = [
  "accepted",
  "cooking",
  "ready",
  "delivering",
  "completed",
  "cancelled",
];

const showToast = (text) => {
  toast.textContent = text;
  toast.classList.add("show");
  window.clearTimeout(window.__toastTimer);
  window.__toastTimer = window.setTimeout(() => {
    toast.classList.remove("show");
  }, 3000);
};

const formatDateTime = (value) => {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("ru-RU");
};

const formatMoney = (value) => `${Number(value || 0)} ₽`;

const renderEmpty = (node, text) => {
  node.innerHTML = `<div class='orders-empty'>${text}</div>`;
};

const renderOverview = async () => {
  try {
    const response = await fetch("/api/orders");
    if (!response.ok) {
      throw new Error("orders_request_failed");
    }
    const payload = await response.json();
    const items = payload.items || [];
    const active = items.filter((item) => !["completed", "cancelled"].includes(item.status)).length;
    const done = items.filter((item) => item.status === "completed").length;

    overviewTotal.textContent = String(items.length);
    overviewActive.textContent = String(active);
    overviewDone.textContent = String(done);
  } catch (error) {
    overviewTotal.textContent = "-";
    overviewActive.textContent = "-";
    overviewDone.textContent = "-";
  }
};

const renderTimeline = (history) => {
  if (!Array.isArray(history) || !history.length) {
    return "<div class='orders-timeline-empty'>История статусов пока пуста</div>";
  }

  return history
    .map(
      (event) => `
      <div class="timeline-item">
        <span class="timeline-status">${event.status_label || STATUS_LABELS[event.status] || event.status}</span>
        <span class="timeline-time">${formatDateTime(event.at)}</span>
        <span class="timeline-meta">${event.by || "system"}${event.note ? ` · ${event.note}` : ""}</span>
      </div>
    `
    )
    .join("");
};

const renderItems = (items) => {
  if (!Array.isArray(items) || !items.length) {
    return "<div class='orders-items-empty'>Состав заказа не заполнен</div>";
  }

  return items
    .map(
      (item) => `
      <div class="order-item-row">
        <span>${item.dish_title || "Блюдо"}</span>
        <span>x${item.qty}</span>
        <span>${formatMoney(item.subtotal || item.unit_price * item.qty)}</span>
      </div>
    `
    )
    .join("");
};

const statusOption = (status, selected, allowed) => {
  const isCurrent = status === selected;
  const isAllowed = allowed.includes(status) || isCurrent;
  return `<option value="${status}" ${isCurrent ? "selected" : ""} ${isAllowed ? "" : "disabled"}>${
    STATUS_LABELS[status] || status
  }</option>`;
};

const renderOrderCard = (order, mode) => {
  const historyHtml = renderTimeline(order.status_history || []);
  const itemsHtml = renderItems(order.items || []);
  const canManage = mode === "cook";
  const nextStatuses = Array.isArray(order.next_statuses) ? order.next_statuses : [];

  const controls = canManage
    ? `
      <div class="order-controls">
        <select data-next-status>
          ${STATUS_OPTIONS.map((status) => statusOption(status, order.status, nextStatuses)).join("")}
        </select>
        <input data-note type="text" placeholder="Комментарий (опционально)" />
        <button class="btn small" type="button" data-update>Обновить</button>
      </div>
    `
    : "";

  const card = document.createElement("article");
  card.className = "order-card-view";
  card.innerHTML = `
    <div class="order-head">
      <div>
        <strong>${order.id}</strong>
        <div class="order-sub">${formatDateTime(order.created_at)}</div>
      </div>
      <span class="order-status order-status-${order.status}">${order.status_label || STATUS_LABELS[order.status] || order.status}</span>
    </div>

    <div class="order-meta-grid">
      <div><span>Клиент:</span> ${order.customer_name || "-"}</div>
      <div><span>Телефон:</span> ${order.customer_phone || "-"}</div>
      <div><span>Доставка:</span> ${order.delivery_mode || "-"}</div>
      <div><span>Сумма:</span> ${formatMoney(order.total_price)}</div>
    </div>

    <div class="order-items">${itemsHtml}</div>

    <div class="orders-timeline">${historyHtml}</div>

    ${controls}
  `;

  if (canManage) {
    const updateBtn = card.querySelector("[data-update]");
    const statusSelect = card.querySelector("[data-next-status]");
    const noteInput = card.querySelector("[data-note]");

    updateBtn.addEventListener("click", async () => {
      const status = statusSelect.value;
      const note = noteInput.value.trim();
      updateBtn.disabled = true;
      updateBtn.textContent = "Сохраняем...";

      try {
        const response = await fetch(`/api/orders/${encodeURIComponent(order.id)}/status`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status, actor: "cook", note }),
        });

        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "status_update_failed");
        }

        showToast(`Статус заказа ${order.id} обновлен`);
        await loadCookOrders();
        await renderOverview();
      } catch (error) {
        const known = {
          status_transition_invalid: "Недопустимый переход статуса.",
          order_not_found: "Заказ не найден.",
          status_invalid: "Неверный статус.",
        };
        showToast(known[error.message] || "Не удалось обновить статус.");
      } finally {
        updateBtn.disabled = false;
        updateBtn.textContent = "Обновить";
      }
    });
  }

  return card;
};

const buildCustomerParams = () => {
  const params = new URLSearchParams();
  params.set("role", "customer");

  const phone = customerPhoneInput.value.trim();
  const name = customerNameInput.value.trim();
  if (phone) {
    params.set("customer_phone", phone);
  }
  if (name) {
    params.set("customer_name", name);
  }

  return params;
};

const buildCookParams = () => {
  const params = new URLSearchParams();
  params.set("role", "cook");

  const cookId = cookSelect.value;
  if (cookId) {
    params.set("cook_id", cookId);
  }

  const status = cookStatusFilter.value;
  if (status && status !== "all") {
    params.set("status", status);
  }

  return params;
};

const fetchOrders = async (params) => {
  const query = params.toString();
  const url = query ? `/api/orders?${query}` : "/api/orders";
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("orders_request_failed");
  }
  const payload = await response.json();
  return payload.items || [];
};

const loadCustomerOrders = async () => {
  customerOrdersNode.innerHTML = "<div class='orders-empty'>Загрузка заказов...</div>";
  try {
    const items = await fetchOrders(buildCustomerParams());
    if (!items.length) {
      renderEmpty(customerOrdersNode, "Заказы не найдены.");
      return;
    }

    customerOrdersNode.innerHTML = "";
    items.forEach((order) => customerOrdersNode.appendChild(renderOrderCard(order, "customer")));
  } catch (error) {
    renderEmpty(customerOrdersNode, "Не удалось загрузить заказы клиента.");
  }
};

const loadCookOrders = async () => {
  cookOrdersNode.innerHTML = "<div class='orders-empty'>Загрузка заказов...</div>";
  try {
    const items = await fetchOrders(buildCookParams());
    if (!items.length) {
      renderEmpty(cookOrdersNode, "Заказы для выбранного повара не найдены.");
      return;
    }

    cookOrdersNode.innerHTML = "";
    items.forEach((order) => cookOrdersNode.appendChild(renderOrderCard(order, "cook")));
  } catch (error) {
    renderEmpty(cookOrdersNode, "Не удалось загрузить заказы повара.");
  }
};

const loadCookOptions = async () => {
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

    cooks.forEach((cook, index) => {
      const option = document.createElement("option");
      option.value = String(cook.id);
      option.textContent = `${cook.name} · ${cook.district} · ${Number(cook.rating).toFixed(2)}`;
      if (index === 0) {
        option.selected = true;
      }
      cookSelect.appendChild(option);
    });
  } catch (error) {
    cookSelect.innerHTML = "<option value=''>Ошибка загрузки поваров</option>";
  }
};

const init = async () => {
  await loadCookOptions();
  await Promise.all([loadCustomerOrders(), loadCookOrders(), renderOverview()]);

  customerRefreshBtn.addEventListener("click", loadCustomerOrders);
  cookRefreshBtn.addEventListener("click", async () => {
    await Promise.all([loadCookOrders(), renderOverview()]);
  });

  customerPhoneInput.addEventListener("change", loadCustomerOrders);
  customerNameInput.addEventListener("change", loadCustomerOrders);
  cookSelect.addEventListener("change", loadCookOrders);
  cookStatusFilter.addEventListener("change", loadCookOrders);
};

init();
