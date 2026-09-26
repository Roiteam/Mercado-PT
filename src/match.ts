import type { ChainId, Product } from "./types";

const STOP = new Set(["de", "do", "da", "com", "e", "o", "a"]);

function stripAccents(s: string) {
  return s.normalize("NFD").replace(/\p{M}/gu, "");
}

export function normalize(s: string) {
  return stripAccents(s.toLowerCase())
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function tokens(s: string) {
  return normalize(s)
    .split(" ")
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export function scoreMatch(query: string, name: string, brand?: string): number {
  const q = tokens(query);
  if (!q.length) return 0;
  const hay = tokens(`${name} ${brand ?? ""}`);
  if (!hay.length) return 0;
  const haySet = new Set(hay);
  let hit = 0;
  for (const t of q) {
    if (
      haySet.has(t) ||
      hay.some(
        (h) =>
          (t.length >= 4 && h.includes(t)) ||
          (h.length >= 4 && t.length >= 4 && t.includes(h)),
      )
    ) {
      hit += 1;
    }
  }
  const overlap = hit / q.length;
  const contains = hay.join(" ").includes(q.join(" ")) ? 0.2 : 0;
  return Math.min(1, overlap + contains);
}

export function pickBest(
  query: string,
  products: Product[],
  minScore = 0.38,
): { item: Product; score: number } | null {
  let best: { item: Product; score: number } | null = null;
  for (const item of products) {
    const score = scoreMatch(query, item.name, item.brand);
    if (score < minScore) continue;
    if (!best) {
      best = { item, score };
      continue;
    }
    const a = item.unitPrice && item.unitPrice > 0 ? item.unitPrice : item.price;
    const b = best.item.unitPrice && best.item.unitPrice > 0 ? best.item.unitPrice : best.item.price;
    if (score > best.score + 0.12 || (Math.abs(score - best.score) <= 0.12 && a < b)) {
      best = { item, score };
    }
  }
  return best;
}

export function suggestAlternatives(
  query: string,
  products: Product[],
  limit = 3,
): Product[] {
  const q = tokens(query);
  if (!q.length) return [];
  const ranked = products
    .map((item) => ({ item, score: scoreMatch(query, item.name, item.brand) }))
    .filter((row) => row.score >= 0.22 && row.score < 0.72)
    .sort((a, b) => {
      const da = a.item.originalPrice ? a.item.originalPrice - a.item.price : 0;
      const db = b.item.originalPrice ? b.item.originalPrice - b.item.price : 0;
      if (db !== da) return db - da;
      return b.score - a.score;
    });
  const seen = new Set<string>();
  const out: Product[] = [];
  for (const row of ranked) {
    const key = `${row.item.chain}:${normalize(row.item.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row.item);
    if (out.length >= limit) break;
  }
  return out;
}

export function offersForChains(products: Product[], chains: ChainId[]) {
  if (!chains.length) return products;
  const set = new Set(chains);
  return products.filter((p) => set.has(p.chain));
}
