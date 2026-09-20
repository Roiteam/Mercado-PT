import type {
  ListItem,
  OffersResponse,
  OptimizeResponse,
  ShoppingList,
  StoresResponse,
} from "./types";

async function readJson<T>(res: Response): Promise<T> {
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

function householdHeaders(householdId: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    "x-household-id": householdId,
  };
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

export function fetchLists(householdId: string) {
  return fetch("/api/lists", {
    headers: householdHeaders(householdId),
  }).then((res) => readJson<{ lists: ShoppingList[] }>(res));
}

export function createRemoteList(
  householdId: string,
  body: { title?: string; postalCode?: string; items?: ListItem[] },
) {
  return fetch("/api/lists", {
    method: "POST",
    headers: householdHeaders(householdId),
    body: JSON.stringify(body),
  }).then((res) => readJson<{ list: ShoppingList }>(res));
}

export function patchRemoteList(
  householdId: string,
  id: string,
  body: {
    title?: string;
    postalCode?: string;
    items?: ListItem[];
    status?: "open" | "done";
    split?: OptimizeResponse | null;
  },
) {
  return fetch(`/api/lists/${id}`, {
    method: "PATCH",
    headers: householdHeaders(householdId),
    body: JSON.stringify(body),
  }).then((res) => readJson<{ list: ShoppingList }>(res));
}

export function deleteRemoteList(householdId: string, id: string) {
  return fetch(`/api/lists/${id}`, {
    method: "DELETE",
    headers: householdHeaders(householdId),
  }).then((res) => readJson<{ ok: boolean }>(res));
}
