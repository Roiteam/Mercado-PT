import type { Config } from "@netlify/functions";
import { errorJson, json } from "./_shared/http.ts";
import { parsePostalCode } from "./_shared/geo.ts";
import { findNearbyStores, geocodePostal } from "./_shared/stores.ts";
import { PRICED_CHAINS } from "./_shared/geo.ts";

export default async (req: Request) => {
  if (req.method !== "GET") return errorJson("Method not allowed", 405);
  const url = new URL(req.url);
  const postalCode = parsePostalCode(url.searchParams.get("postalCode") ?? "");
  if (!postalCode) return errorJson("Introduz um código postal português, ex. 1000-001.");
  const radiusKm = Math.min(
    20,
    Math.max(2, Number(url.searchParams.get("radiusKm") ?? 6) || 6),
  );

  try {
    const place = await geocodePostal(postalCode);
    const stores = await findNearbyStores(place, radiusKm);
    return json({
      place,
      radiusKm,
      stores,
      pricedChains: PRICED_CHAINS.filter((c) => stores.some((s) => s.chain === c)),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao encontrar os supermercados.";
    return errorJson(message, 502);
  }
};

export const config: Config = {
  path: "/api/stores",
};
