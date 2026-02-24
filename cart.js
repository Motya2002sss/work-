(function () {
  const STORAGE_KEY = "domeda_cart_v1";

  const safeInt = (value, fallback) => {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const toDishRef = (dish) => ({
    id: safeInt(dish.id, 0),
    title: String(dish.title || ""),
    price: safeInt(dish.price, 0),
    cook: String(dish.cook || ""),
    image_url: String(dish.image_url || ""),
  });

  const read = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .map((item) => ({
          ...item,
          id: safeInt(item.id, 0),
          qty: Math.max(1, safeInt(item.qty, 1)),
          price: safeInt(item.price, 0),
          title: String(item.title || ""),
          cook: String(item.cook || ""),
          image_url: String(item.image_url || ""),
        }))
        .filter((item) => item.id > 0);
    } catch (error) {
      return [];
    }
  };

  const write = (items) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent("domeda-cart-updated", { detail: { items } }));
  };

  const add = (dish, qty = 1) => {
    const item = toDishRef(dish);
    if (!item.id) {
      return;
    }

    const items = read();
    const existing = items.find((row) => row.id === item.id);
    if (existing) {
      existing.qty = Math.max(1, existing.qty + Math.max(1, safeInt(qty, 1)));
      existing.price = item.price;
      existing.title = item.title;
      existing.cook = item.cook;
      existing.image_url = item.image_url;
    } else {
      items.push({ ...item, qty: Math.max(1, safeInt(qty, 1)) });
    }

    write(items);
  };

  const remove = (dishId) => {
    const targetId = safeInt(dishId, -1);
    if (targetId <= 0) {
      return;
    }

    const next = read().filter((item) => item.id !== targetId);
    write(next);
  };

  const setQty = (dishId, qty) => {
    const targetId = safeInt(dishId, -1);
    const nextQty = safeInt(qty, 1);
    if (targetId <= 0) {
      return;
    }

    const items = read();
    const target = items.find((item) => item.id === targetId);
    if (!target) {
      return;
    }

    if (nextQty <= 0) {
      write(items.filter((item) => item.id !== targetId));
      return;
    }

    target.qty = nextQty;
    write(items);
  };

  const clear = () => {
    write([]);
  };

  const count = () => read().reduce((sum, item) => sum + item.qty, 0);
  const total = () => read().reduce((sum, item) => sum + item.price * item.qty, 0);

  window.DomEdaCart = {
    read,
    add,
    remove,
    setQty,
    clear,
    count,
    total,
  };
})();
