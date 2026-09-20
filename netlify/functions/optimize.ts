import type { Config } from "@netlify/functions";
import { errorJson, json, mapPool } from "./_shared/http.ts";
import { CHAIN_LABEL, parsePostalCode, PRICED_CHAINS, round2 } from "./_shared/geo.ts";
import { findNearbyStores, geocodePostal, nearestByChain } from "./_shared/stores.ts";
import { searchContinente } from "./_shared/adapters/continente.ts";
import { searchPingoDoce } from "./_shared/adapters/pingodoce.ts";
import { expandQuery, pickBest } from "./_shared/match.ts";
import type {
  ChainId,
  ListItem,
  MatchResult,
  OptimizeResponse,
  Product,
  StoreGroup,
} from "./_shared/types.ts";

type Body = {
  postalCode?: string;
  radiusKm?: number;
  items?: { id?: string; query: string; qty?: number }[];
};

export default async (req: Request) => {
  if (req.method !== "POST") return errorJson("Method not allowed", 405);
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return errorJson("JSON inválido.");
  }
  const postalCode = parsePostalCode(body.postalCode ?? "");
  if (!postalCode) return errorJson("Código postal em falta.");
  const items = (body.items ?? [])
    .map((it) => ({
      id: it.id ?? crypto.randomUUID(),
      query: it.query.trim(),
      qty: Math.max(1, Number(it.qty) || 1),
    }))
    .filter((it) => it.query.length >= 2)
    .slice(0, 20);
  if (!items.length) return errorJson("Adiciona pelo menos um produto à lista.");
  const radiusKm = Math.min(20, Math.max(2, Number(body.radiusKm) || 6));

  try {
    const place = await geocodePostal(postalCode);
    const stores = await findNearbyStores(place, radiusKm);
    const nearest = nearestByChain(stores);
    const chains = PRICED_CHAINS.filter((c) => nearest.has(c));
    const usable = chains.length ? chains : PRICED_CHAINS;

    const perItem = await mapPool(items, 4, async (item) => {
      const query = expandQuery(item.query);
      const catalogs = await Promise.all(
        usable.map(async (chain) => ({
          chain,
          products: await searchChain(chain, query).catch(() => [] as Product[]),
        })),
      );
      const matches: { chain: ChainId; product: Product; score: number }[] = [];
      for (const cat of catalogs) {
        const best = pickBest(item.query, cat.products);
        if (best) matches.push({ chain: cat.chain, product: best.item, score: best.score });
      }
      return { item, matches };
    });

    const groupsMap = new Map<ChainId, MatchResult[]>();
    const unmatched: OptimizeResponse["unmatched"] = [];

    for (const row of perItem) {
      if (!row.matches.length) {
        unmatched.push({
          query: row.item.query,
          qty: row.item.qty,
          reason: "Nenhum produto suficientemente parecido nos catálogos próximos.",
        });
        continue;
      }
      row.matches.sort((a, b) => compareDeal(a.product, b.product));
      const win = row.matches[0];
      const result: MatchResult = {
        query: row.item.query,
        qty: row.item.qty,
        product: win.product,
        score: win.score,
        lineTotal: round2(win.product.price * row.item.qty),
      };
      const list = groupsMap.get(win.chain) ?? [];
      list.push(result);
      groupsMap.set(win.chain, list);
    }

    const groups: StoreGroup[] = [];
    for (const [chain, groupItems] of groupsMap) {
      const store = nearest.get(chain);
      if (!store) continue;
      groups.push({
        chain,
        chainLabel: CHAIN_LABEL[chain],
        store,
        items: groupItems,
        subtotal: round2(groupItems.reduce((s, it) => s + it.lineTotal, 0)),
      });
    }
    groups.sort((a, b) => b.subtotal - a.subtotal);

    const split = round2(groups.reduce((s, g) => s + g.subtotal, 0));
    const oneStore = cheapestOneStore(perItem, nearest);

    const payload: OptimizeResponse = {
      place,
      radiusKm,
      groups,
      unmatched,
      totals: {
        split,
        oneStore,
        savings: oneStore ? round2(Math.max(0, oneStore.total - split)) : 0,
      },
      generatedAt: new Date().toISOString(),
    };
    return json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Não foi possível comparar os preços.";
    return errorJson(message, 502);
  }
};

function searchChain(chain: ChainId, query: string) {
  if (chain === "continente") return searchContinente(query, 8);
  if (chain === "pingo_doce") return searchPingoDoce(query, 8);
  return Promise.resolve([] as Product[]);
}

function compareDeal(a: Product, b: Product) {
  const pa = a.unitPrice && a.unitPrice > 0 ? a.unitPrice : a.price;
  const pb = b.unitPrice && b.unitPrice > 0 ? b.unitPrice : b.price;
  if (pa !== pb) return pa - pb;
  return a.price - b.price;
}

function cheapestOneStore(
  perItem: { item: ListItem; matches: { chain: ChainId; product: Product; score: number }[] }[],
  nearest: Map<ChainId, { chain: ChainId }>,
): OptimizeResponse["totals"]["oneStore"] {
  const chains = PRICED_CHAINS.filter((c) => nearest.has(c));
  let best: OptimizeResponse["totals"]["oneStore"];
  for (const chain of chains) {
    let total = 0;
    let missing = 0;
    for (const row of perItem) {
      const hit = row.matches.find((m) => m.chain === chain);
      if (!hit) {
        missing += 1;
        continue;
      }
      total += hit.product.price * row.item.qty;
    }
    const candidate = {
      chain,
      chainLabel: CHAIN_LABEL[chain],
      total: round2(total),
      missing,
    };
    if (
      !best ||
      candidate.missing < best.missing ||
      (candidate.missing === best.missing && candidate.total < best.total)
    ) {
      best = candidate;
    }
  }
  return best;
}

export const config: Config = {
  path: "/api/optimize",
};
