const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

async function request(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(data?.message || data?.error || res.statusText);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

export const api = {
  health: () => request("/health"),
  products: () => request("/products"),
  inventory: (sku, locationId) =>
    request(
      `/inventory?${new URLSearchParams({ ...(sku && { sku }), ...(locationId && { locationId }) }).toString()}`,
    ),
  suppliers: () => request("/suppliers"),
  locations: () => request("/locations"),
  purchaseOrders: () => request("/purchase-orders"),
  purchaseOrder: (id) => request(`/purchase-orders/${id}`),
  approve: (id, actor) =>
    request(`/purchase-orders/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ actor }),
    }),
  reject: (id, actor, reason) =>
    request(`/purchase-orders/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ actor, reason }),
    }),
  commit: (id) =>
    request(`/purchase-orders/${id}/commit`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  validation: (id) => request(`/purchase-orders/${id}/validation`),
  analyze: (payload) =>
    request("/agent/analyze", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  runs: () => request("/agent/runs"),
  run: (runId) => request(`/agent/runs/${runId}`),
};
