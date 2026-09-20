import type { ChainId, Coords } from "./types.ts";

export const CHAIN_LABEL: Record<ChainId, string> = {
  continente: "Continente",
  pingo_doce: "Pingo Doce",
  auchan: "Auchan",
  lidl: "Lidl",
  aldi: "Aldi",
  minipreco: "Minipreço",
  intermarche: "Intermarché",
  mercadona: "Mercadona",
  other: "Outro",
};

export const PRICED_CHAINS: ChainId[] = [
  "continente",
  "pingo_doce",
  "auchan",
  "lidl",
];

const RULES: { chain: ChainId; test: RegExp }[] = [
  { chain: "continente", test: /continente/i },
  { chain: "pingo_doce", test: /pingo\s*doce/i },
  { chain: "auchan", test: /auchan|jumbo/i },
  { chain: "lidl", test: /\blidl\b/i },
  { chain: "aldi", test: /\baldi\b/i },
  { chain: "minipreco", test: /minipre[cç]o|miniprecio|\bdia\b/i },
  { chain: "intermarche", test: /intermarch[eé]/i },
  { chain: "mercadona", test: /mercadona/i },
];

export function detectChain(name: string): ChainId {
  for (const rule of RULES) {
    if (rule.test.test(name)) return rule.chain;
  }
  return "other";
}

export function haversineKm(a: Coords, b: Coords): number {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function toRad(d: number) {
  return (d * Math.PI) / 180;
}

export function mapsUrl(lat: number, lon: number) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
}

export function parsePostalCode(raw: string): string | null {
  const compact = raw.trim().toUpperCase().replace(/\s+/g, "");
  const m = compact.match(/^(\d{4})-?(\d{3})$/);
  if (!m) return null;
  return `${m[1]}-${m[2]}`;
}

export function parseEuro(raw: string | number | undefined | null): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (!raw) return undefined;
  let s = String(raw)
    .replace(/\s/g, "")
    .replace("€", "")
    .replace("&euro;", "");
  if (s.includes(",") && s.includes(".")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const n = Number.parseFloat(s.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

export function parseUnitPrice(raw: string | undefined | null): {
  unitPrice?: number;
  unitLabel?: string;
} {
  if (!raw) return {};
  const text = raw.replace(/\s+/g, " ").trim();
  const m = text.match(/([\d.,]+)\s*€?\s*\/\s*([a-zA-Zµμ]+)/);
  if (!m) return {};
  return { unitPrice: parseEuro(m[1]), unitLabel: m[2].toLowerCase() };
}

export function round1(n: number) {
  return Math.round(n * 10) / 10;
}

export function round2(n: number) {
  return Math.round(n * 100) / 100;
}
