import type { Config } from "@netlify/functions";
import { errorJson, json, mapPool } from "./_shared/http.ts";
import { parsePostalCode } from "./_shared/geo.ts";
import { findNearbyStores, geocodePostal } from "./_shared/stores.ts";
import { homeOffersForChain } from "./_shared/catalogs.ts";
import { loadFlyers } from "./_shared/flyers.ts";
import type { Flyer, Place, Product } from "./_shared/types.ts";

export default async (req: Request) => {
  if (req.method !== "GET") return errorJson("Method not allowed", 405);
  const url = new URL(req.url);
  const postalCode = parsePostalCode(url.searchParams.get("postalCode") ?? "");
  if (!postalCode) return errorJson("Código postal em falta.");
  const radiusKm = Math.min(
    20,
    Math.max(2, Number(url.searchParams.get("radiusKm") ?? 6) || 6),
  );

  try {
    const place = await geocodePostal(postalCode);
    const stores = await findNearbyStores(place, radiusKm);
    const nearby = [...new Set(stores.map((s) => s.chain))].filter((c) => c !== "other");
    const [lists, rawFlyers] = await Promise.all([
      mapPool(nearby, 3, async (chain) => {
        try {
          return await homeOffersForChain(chain);
        } catch (err) {
          console.error(`[offers] ${chain}`, err);
          return [] as Product[];
        }
      }),
      loadFlyers(nearby).catch(() => [] as Flyer[]),
    ]);
    const offers = interleaveByChain(lists).slice(0, 800);
    const flyers = rawFlyers.filter((f) => isFlyerForPlace(place, f));
    return json({ place, offers, flyers, nearbyChains: nearby });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao carregar as ofertas.";
    return errorJson(message, 502);
  }
};

function discountRatio(p: Product) {
  if (p.originalPrice && p.originalPrice > 0) {
    return (p.originalPrice - p.price) / p.originalPrice;
  }
  return 0;
}

function sortDeals(products: Product[]) {
  return [...products].sort((a, b) => {
    const d = discountRatio(b) - discountRatio(a);
    if (d) return d;
    return a.price - b.price;
  });
}

function interleaveByChain(lists: Product[][]) {
  const ranked = lists.map(sortDeals);
  const out: Product[] = [];
  const seen = new Set<string>();
  const max = Math.max(0, ...ranked.map((list) => list.length));
  for (let i = 0; i < max; i++) {
    for (const list of ranked) {
      const p = list[i];
      if (!p) continue;
      const key = `${p.chain}:${p.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
  }
  return out;
}

function isFlyerForPlace(place: Place, flyer: Flyer) {
  const hay = `${flyer.title} ${flyer.url}`.toLowerCase();
  const loc = `${place.city} ${place.label}`.toLowerCase();
  const islands = /madeira|a[cç]ores/;
  if (islands.test(loc)) return true;
  return !islands.test(hay);
}

export const config: Config = {
  path: "/api/offers",
};
