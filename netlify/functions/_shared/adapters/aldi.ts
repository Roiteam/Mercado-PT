import { cached, fetchText, SCRAPE_TTL_MS } from "../http.ts";
import type { Product } from "../types.ts";

type AldiPrice = {
  priceValue?: number;
  validFrom?: number;
  validUntil?: number;
};

type AldiProduct = {
  objectID?: string;
  name?: string;
  brandName?: string;
  productSlug?: string;
  salesUnit?: string;
  currentPrice?: AldiPrice;
  promotionPrices?: AldiPrice[];
  assets?: { type?: string; url?: string }[];
};

export async function searchAldi(query: string, size = 8): Promise<Product[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const tokens = q.split(/\s+/).filter(Boolean);
  const all = await aldiHomeOffers();
  return all
    .filter((p) => {
      const hay = `${p.name} ${p.brand ?? ""}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    })
    .slice(0, size);
}

export async function aldiHomeOffers(): Promise<Product[]> {
  return cached("aldi:promo:v4", SCRAPE_TTL_MS, async () => {
    const html = await fetchText("https://www.aldi.pt/oportunidades-da-semana.html", {}, 18000);
    const raw = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
    if (!raw) return [];
    const data = JSON.parse(raw) as {
      props?: { pageProps?: { apiData?: unknown } };
    };
    let apiData = data.props?.pageProps?.apiData;
    if (typeof apiData === "string") {
      try {
        apiData = JSON.parse(apiData);
      } catch {
        return [];
      }
    }
    return uniqueProducts(flattenAldi(apiData).map(toProduct).filter((p) => p.price > 0));
  });
}

function flattenAldi(data: unknown): AldiProduct[] {
  const out: AldiProduct[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === "object") {
      const rec = node as AldiProduct & Record<string, unknown>;
      if ("currentPrice" in rec && "name" in rec) {
        out.push(rec);
        return;
      }
      Object.values(rec).forEach(walk);
    }
  };
  walk(data);
  return out;
}

function toProduct(item: AldiProduct): Product {
  const now = Date.now() / 1000;
  const current = Number(item.currentPrice?.priceValue) || 0;
  const promo = (item.promotionPrices ?? []).find((p) => {
    const from = Number(p.validFrom) || 0;
    const until = Number(p.validUntil) || 0;
    return (!from || from <= now) && (!until || until >= now);
  });
  const promoPrice = Number(promo?.priceValue) || 0;
  const price = promoPrice && promoPrice < current ? promoPrice : current || promoPrice;
  const imageUrl = item.assets?.find((a) => a.type === "primary")?.url || item.assets?.[0]?.url;
  const id = String(item.objectID ?? item.productSlug ?? item.name ?? "");
  return {
    id,
    chain: "aldi",
    name: (item.name ?? "").trim(),
    brand: item.brandName?.replace(/®/g, "").trim() || undefined,
    price,
    originalPrice: current && price && current > price ? current : undefined,
    quantityLabel: item.salesUnit?.trim() || undefined,
    imageUrl,
    url: "https://www.aldi.pt/oportunidades-da-semana.html",
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
