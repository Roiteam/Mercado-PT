import * as cheerio from "cheerio";
import { cached, fetchText, mapPool } from "../http.ts";
import { parseEuro, parseUnitPrice } from "../geo.ts";
import type { Product } from "../types.ts";

const SEARCH =
  "https://www.continente.pt/on/demandware.store/Sites-continente-Site/default/Search-ShowAjax";
const GRID =
  "https://www.continente.pt/on/demandware.store/Sites-continente-Site/default/Search-UpdateGrid";

export async function searchContinente(query: string, size = 8): Promise<Product[]> {
  const q = query.trim();
  if (!q) return [];
  return cached(`cont:search:${q}:${size}`, 45 * 60 * 1000, async () => {
    const url = `${SEARCH}?q=${encodeURIComponent(q)}&cgid=col-produtos&start=0&sz=${size}&pmin=0.01`;
    const html = await fetchText(url, {}, 15000);
    return parseContinenteTiles(html);
  });
}

export async function continenteHomeOffers(): Promise<Product[]> {
  return cached("cont:promo:v1", 45 * 60 * 1000, async () => {
    const starts = Array.from({ length: 12 }, (_, i) => i * 35);
    const pages = await mapPool(starts, 4, async (start) => {
      try {
        const url = `${GRID}?cgid=col-produtos&pmin=0.01&prefn1=isOpportunity&prefv1=Com%20Desconto&start=${start}&sz=35`;
        const html = await fetchText(url, {}, 18000);
        return parseContinenteTiles(html);
      } catch {
        return [] as Product[];
      }
    });
    const home = await fetchText("https://www.continente.pt/", {}, 15000)
      .then(parseContinenteTiles)
      .catch(() => [] as Product[]);
    return uniqueProducts([...home, ...pages.flat()]);
  });
}

function uniqueProducts(products: Product[]) {
  const seen = new Set<string>();
  const out: Product[] = [];
  for (const p of products) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

function parseContinenteTiles(html: string): Product[] {
  const $ = cheerio.load(html);
  const products: Product[] = [];
  const seen = new Set<string>();

  $("[data-product-tile-impression]").each((_, el) => {
    const $el = $(el);
    const raw = $el.attr("data-product-tile-impression");
    if (!raw) return;
    let meta: {
      name?: string;
      id?: string;
      price?: number;
      brand?: string;
    };
    try {
      meta = JSON.parse(raw);
    } catch {
      return;
    }
    const id = String(meta.id ?? $el.attr("data-pid") ?? "");
    if (!id || seen.has(id)) return;
    seen.add(id);

    const name = (meta.name ?? "").trim();
    if (!name) return;

    const href =
      $el.find('a[href*="/produto/"]').first().attr("href") ||
      `https://www.continente.pt/on/demandware.store/Sites-continente-Site/default/Product-Show?pid=${id}`;
    const url = href.startsWith("http")
      ? href
      : `https://www.continente.pt${href}`;

    const img =
      $el.find("img.ct-tile-image").attr("data-src") ||
      $el.find("img.ct-tile-image").attr("src") ||
      $el.find("img").attr("data-src") ||
      $el.find("img").attr("src");

    const unitText = $el.find(".pwc-tile--price-secondary").text();
    const { unitPrice, unitLabel } = parseUnitPrice(unitText);
    const quantityLabel = $el.find(".pwc-tile--quantity").text().trim() || undefined;

    const strike =
      parseEuro($el.find(".strike-through .value").first().text()) ||
      parseEuro($el.find(".strike-through").first().text());

    const pvprAlt = $el.find(".ct-product-tile-badge img").attr("alt") ?? "";
    const pvpr = parseEuro(pvprAlt);
    const badgePct = $el
      .find(".ct-product-tile-badge-value--pvpr")
      .first()
      .text()
      .trim();

    const price = Number(meta.price) || parseEuro($el.find(".pwc-tile--price-primary").text()) || 0;
    if (!price) return;

    products.push({
      id,
      chain: "continente",
      name,
      brand: meta.brand,
      price,
      originalPrice: strike || (pvpr && pvpr > price ? pvpr : undefined),
      unitPrice,
      unitLabel,
      quantityLabel,
      imageUrl: img,
      url,
      promoLabel: badgePct ? `-${badgePct}%` : undefined,
    });
  });

  return products;
}
