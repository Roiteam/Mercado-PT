import { cached, fetchJson, SCRAPE_TTL_MS } from "../http.ts";
import type { Product } from "../types.ts";

type MercadonaPrice = {
  unit_price?: string;
  previous_unit_price?: string | null;
  bulk_price?: string;
  size_format?: string;
  reference_price?: string;
  reference_format?: string;
};

type MercadonaItem = {
  id?: string | number;
  display_name?: string;
  share_url?: string;
  thumbnail?: string;
  packaging?: string;
  price_instructions?: MercadonaPrice;
};

type HomeResponse = {
  sections?: {
    layout?: string;
    content?: { items?: MercadonaItem[] };
  }[];
};

export async function searchMercadona(query: string, size = 8): Promise<Product[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const tokens = q.split(/\s+/).filter(Boolean);
  const all = await mercadonaHomeOffers();
  return all
    .filter((p) => {
      const hay = p.name.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    })
    .slice(0, size);
}

export async function mercadonaHomeOffers(): Promise<Product[]> {
  return cached("mercadona:home:v1", SCRAPE_TTL_MS, async () => {
    const data = await fetchJson<HomeResponse>("https://tienda.mercadona.es/api/home/", {}, 15000);
    const items = (data.sections ?? []).flatMap((section) => section.content?.items ?? []);
    return uniqueProducts(items.map(toProduct).filter((p) => p.price > 0 && p.name));
  });
}

function toProduct(item: MercadonaItem): Product {
  const priceInfo = item.price_instructions ?? {};
  const price = Number(priceInfo.unit_price) || Number(priceInfo.bulk_price) || 0;
  const previous = Number(String(priceInfo.previous_unit_price ?? "").trim());
  return {
    id: String(item.id ?? item.display_name ?? ""),
    chain: "mercadona",
    name: (item.display_name ?? "").trim(),
    price,
    originalPrice: previous && previous > price ? previous : undefined,
    quantityLabel: item.packaging || undefined,
    unitPrice: Number(priceInfo.reference_price) || undefined,
    unitLabel: priceInfo.reference_format || priceInfo.size_format || undefined,
    imageUrl: item.thumbnail,
    url: item.share_url || `https://tienda.mercadona.es/product/${item.id}`,
  };
}

function uniqueProducts(products: Product[]) {
  const seen = new Set<string>();
  const out: Product[] = [];
  for (const p of products) {
    if (!p.id || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}
