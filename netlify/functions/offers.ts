import type { Config } from "@netlify/functions";
import { errorJson, json } from "./_shared/http.ts";
import { parsePostalCode } from "./_shared/geo.ts";
import { findNearbyStores, geocodePostal } from "./_shared/stores.ts";
import { continenteHomeOffers } from "./_shared/adapters/continente.ts";
import { pingoDoceOffers } from "./_shared/adapters/pingodoce.ts";
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
    const nearby = [...new Set(stores.map((s) => s.chain))];
    const jobs: Promise<Product[]>[] = [];
    if (nearby.includes("continente")) jobs.push(continenteHomeOffers());
    if (nearby.includes("pingo_doce")) jobs.push(pingoDoceOffers());
    const [lists, rawFlyers] = await Promise.all([
      Promise.all(jobs.map((j) => j.catch(() => [] as Product[]))),
      loadFlyers(nearby).catch(() => [] as Flyer[]),
    ]);
    const offers = lists
      .flat()
      .sort((a, b) => {
        const pa =
          a.originalPrice && a.originalPrice > 0
            ? (a.originalPrice - a.price) / a.originalPrice
            : 0;
        const pb =
          b.originalPrice && b.originalPrice > 0
            ? (b.originalPrice - b.price) / b.originalPrice
            : 0;
        if (pb !== pa) return pb - pa;
        return a.price - b.price;
      })
      .slice(0, 800);
    const flyers = rawFlyers.filter((f) => isFlyerForPlace(place, f));
    return json({ place, offers, flyers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao carregar as ofertas.";
    return errorJson(message, 502);
  }
};

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
