import type { ListItem, OffersResponse, OptimizeResponse, StoresResponse } from "./types";

async function readJson<T>(res: Response): Promise<T> {
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `Errore ${res.status}`);
  return data;
}

export function getStores(postalCode: string, radiusKm: number) {
  return fetch(
    `/api/stores?postalCode=${encodeURIComponent(postalCode)}&radiusKm=${radiusKm}`,
  ).then((res) => readJson<StoresResponse>(res));
}

export function getOffers(postalCode: string, radiusKm: number) {
  return fetch(
    `/api/offers?postalCode=${encodeURIComponent(postalCode)}&radiusKm=${radiusKm}&v=3`,
  ).then((res) => readJson<OffersResponse>(res));
}

export function optimizeList(
  postalCode: string,
  radiusKm: number,
  items: ListItem[],
) {
  return fetch("/api/optimize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ postalCode, radiusKm, items }),
  }).then((res) => readJson<OptimizeResponse>(res));
}
