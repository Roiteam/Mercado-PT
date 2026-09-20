export const CHAIN_LABEL: Record<string, string> = {
  continente: "Continente",
  pingo_doce: "Pingo Doce",
  auchan: "Auchan",
  lidl: "Lidl",
  aldi: "Aldi",
  minipreco: "Minipreço",
  intermarche: "Intermarché",
  mercadona: "Mercadona",
  other: "Altro",
};

export const CHAIN_TONE: Record<string, string> = {
  continente: "#d62828",
  pingo_doce: "#2d6a4f",
  auchan: "#f77f00",
  lidl: "#0050aa",
  aldi: "#1d3557",
  minipreco: "#e63946",
  intermarche: "#e9c46a",
  mercadona: "#588157",
  other: "#6d4c41",
};

export function storeMapsLink(store: { lat: number; lon: number }) {
  return `https://www.google.com/maps/search/?api=1&query=${store.lat},${store.lon}`;
}

export function euro(n: number) {
  return n.toLocaleString("pt-PT", {
    style: "currency",
    currency: "EUR",
  });
}

export function uid() {
  return crypto.randomUUID();
}

const POSTAL_KEY = "poupaja.postal";
const LIST_KEY = "poupaja.list";
const RADIUS_KEY = "poupaja.radius";

export function loadPostal() {
  return localStorage.getItem(POSTAL_KEY) ?? "";
}
export function savePostal(v: string) {
  localStorage.setItem(POSTAL_KEY, v);
}
export function loadRadius() {
  const n = Number(localStorage.getItem(RADIUS_KEY));
  return Number.isFinite(n) && n >= 2 ? n : 6;
}
export function saveRadius(v: number) {
  localStorage.setItem(RADIUS_KEY, String(v));
}
export function loadList<T>(fallback: T): T {
  try {
    const raw = localStorage.getItem(LIST_KEY);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function saveList(v: unknown) {
  localStorage.setItem(LIST_KEY, JSON.stringify(v));
}
