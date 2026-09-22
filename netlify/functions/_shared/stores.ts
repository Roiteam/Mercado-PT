import { cached, fetchJson, GEO_TTL_MS, SCRAPE_TTL_MS } from "./http.ts";
import {
  CHAIN_LABEL,
  detectChain,
  haversineKm,
  mapsUrl,
  parsePostalCode,
  round1,
} from "./geo.ts";
import type { Place, Store } from "./types.ts";

type GeoApi = {
  CP?: string;
  Localidade?: string;
  Concelho?: string;
  centroide?: [number, number];
  centro?: [number, number];
};

type ContinenteStores = {
  stores?: {
    ID: string;
    name: string;
    address1?: string;
    city?: string;
    postalCode?: string;
    latitude: number;
    longitude: number;
  }[];
};

type NominatimHit = {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  class?: string;
  type?: string;
};

export async function geocodePostal(postalCode: string): Promise<Place> {
  const cp = parsePostalCode(postalCode);
  if (!cp) throw new Error("Código postal português inválido. Usa o formato 1000-001.");

  return cached(`geo:${cp}`, GEO_TTL_MS, async () => {
    try {
      const data = await fetchJson<GeoApi>(`https://json.geoapi.pt/cp/${cp}`);
      const pair = data.centroide ?? data.centro;
      if (!pair) throw new Error("no centroid");
      const [lat, lon] = pair;
      const city = data.Localidade || data.Concelho || "Portugal";
      return {
        lat,
        lon,
        city,
        postalCode: data.CP || cp,
        label: `${city} · ${data.CP || cp}`,
      };
    } catch {
      const hits = await fetchJson<NominatimHit[]>(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
          `${cp}, Portugal`,
        )}&format=json&limit=1`,
        { headers: { "User-Agent": "PoupaJa/0.1 (grocery comparison)" } },
      );
      if (!hits[0]) throw new Error(`Código postal ${cp} não encontrado.`);
      return {
        lat: Number(hits[0].lat),
        lon: Number(hits[0].lon),
        city: hits[0].display_name.split(",")[0] ?? "Portugal",
        postalCode: cp,
        label: hits[0].display_name.split(",").slice(0, 3).join(","),
      };
    }
  });
}

const SEARCH_PAD_KM = 5;
const CLUSTER_KM = 1.6;

export async function findNearbyStores(
  place: Place,
  radiusKm: number,
): Promise<Store[]> {
  const pool = await cached(`stores:v7:${place.postalCode}`, SCRAPE_TTL_MS, async () => {
    const searchKm = 20;
    const [continente, osm] = await Promise.all([
      findContinenteStores(place, searchKm).catch(() => [] as Store[]),
      findOsmStores(place, searchKm).catch(() => [] as Store[]),
    ]);
    return [...continente, ...osm];
  });
  return mergeStores(pool, radiusKm);
}

async function findContinenteStores(
  place: Place,
  radiusKm: number,
): Promise<Store[]> {
  const data = await fetchJson<ContinenteStores>(
    `https://www.continente.pt/on/demandware.store/Sites-continente-Site/default/Stores-FindStores?lat=${place.lat}&long=${place.lon}&radius=${Math.ceil(radiusKm)}`,
  );
  return (data.stores ?? []).map((s) => toStore({
    id: s.ID,
    name: s.name,
    address: [s.address1, s.city].filter(Boolean).join(", "),
    city: s.city ?? place.city,
    postalCode: s.postalCode,
    lat: s.latitude,
    lon: s.longitude,
    source: "continente",
    place,
  }));
}

async function findOsmStores(place: Place, radiusKm: number): Promise<Store[]> {
  const queries = ["supermarket", "Lidl", "Aldi", "Intermarche", "Continente", "Pingo Doce"];
  const batches = await Promise.all(
    queries.map((q) => nominatimBox(place, radiusKm, q).catch(() => [] as NominatimHit[])),
  );
  return batches
    .flat()
    .filter((h) => isShopHit(h))
    .map((h) => osmStore(h, place));
}

function isShopHit(h: NominatimHit) {
  const kind = `${h.class ?? ""} ${h.type ?? ""}`.toLowerCase();
  return (
    kind.includes("shop") ||
    kind.includes("supermarket") ||
    kind.includes("convenience") ||
    kind.includes("hypermarket")
  );
}

function nominatimBox(place: Place, radiusKm: number, query: string) {
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.cos((place.lat * Math.PI) / 180));
  const viewbox = [
    place.lon - dLon,
    place.lat + dLat,
    place.lon + dLon,
    place.lat - dLat,
  ].join(",");
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=40&bounded=1&viewbox=${viewbox}&q=${encodeURIComponent(
    query,
  )}`;
  return fetchJson<NominatimHit[]>(url, {
    headers: { "User-Agent": "PoupaJa/0.1 (grocery comparison)" },
  });
}

function osmStore(h: NominatimHit, place: Place): Store {
  const lat = Number(h.lat);
  const lon = Number(h.lon);
  const name = (h.name || h.display_name.split(",")[0] || "Supermercato").trim();
  return toStore({
    id: `osm-${h.place_id}`,
    name,
    address: h.display_name.split(",").slice(1, 4).join(",").trim(),
    city: place.city,
    lat,
    lon,
    source: "osm",
    place,
  });
}

function toStore(input: {
  id: string;
  name: string;
  address: string;
  city: string;
  postalCode?: string;
  lat: number;
  lon: number;
  source: Store["source"];
  place: Place;
}): Store {
  const chain = detectChain(input.name);
  return {
    id: input.id,
    chain,
    name: input.name,
    address: input.address,
    city: input.city,
    postalCode: input.postalCode,
    lat: input.lat,
    lon: input.lon,
    distanceKm: round1(haversineKm(input.place, { lat: input.lat, lon: input.lon })),
    source: input.source,
    mapsUrl: mapsUrl(input.lat, input.lon),
  };
}

function mergeStores(stores: Store[], radiusKm: number): Store[] {
  const seen = new Set<string>();
  const unique: Store[] = [];
  for (const store of stores) {
    if (store.chain === "other") continue;
    const bucket = `${store.chain}:${store.lat.toFixed(4)}:${store.lon.toFixed(4)}`;
    if (seen.has(bucket)) continue;
    seen.add(bucket);
    unique.push({
      ...store,
      name: store.name.toLowerCase().includes(CHAIN_LABEL[store.chain].toLowerCase())
        ? store.name
        : `${CHAIN_LABEL[store.chain]} — ${store.name}`,
    });
    for (const other of unique) {
      if (other === unique[unique.length - 1]) continue;
      if (other.chain === store.chain && haversineKm(other, store) < 0.2) {
        unique.pop();
        seen.delete(bucket);
        break;
      }
    }
  }

  const inRadius = unique.filter((s) => s.distanceKm <= radiusKm + 0.5);
  const clustered = unique.filter(
    (s) =>
      s.distanceKm > radiusKm + 0.5 &&
      s.distanceKm <= radiusKm + SEARCH_PAD_KM &&
      inRadius.some(
        (other) => haversineKm(other, s) <= CLUSTER_KM,
      ),
  );

  return [...inRadius, ...clustered]
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 40);
}

export function nearestByChain(stores: Store[]) {
  const map = new Map<Store["chain"], Store>();
  for (const store of stores) {
    if (!map.has(store.chain)) map.set(store.chain, store);
  }
  return map;
}

export { CHAIN_LABEL };
