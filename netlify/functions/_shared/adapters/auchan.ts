import * as cheerio from "cheerio";
import { cached, fetchText, mapPool } from "../http.ts";
import { parseEuro, parseUnitPrice } from "../geo.ts";
import type { Product } from "../types.ts";

const SEARCH =
  "https://www.auchan.pt/on/demandware.store/Sites-AuchanPT-Site/default/Search-UpdateGrid";

export async function searchAuchan(query: string, size = 8): Promise<Product[]> {
  const q = query.trim();
  if (!q) return [];
  return cached(`auchan:search:v1:${q}:${size}`, 45 * 60 * 1000, async () => {
    const url = `${SEARCH}?q=${encodeURIComponent(q)}&start=0&sz=${size}`;
    const html = await fetchText(url, {}, 15000);
    return parseAuchanTiles(html);
  });
}

export async function auchanHomeOffers(): Promise<Product[]> {
  return cached("auchan:promo:v2", 45 * 60 * 1000, async () => {
    const starts = [0, 48];
    const pages = await mapPool(starts, 2, async (start) => {
      try {
        const url = `${SEARCH}?cgid=alimentacao&prefn1=promoInStores&prefv1=000&start=${start}&sz=48`;
        const html = await fetchText(url, {}, 18000);
        return parseAuchanTiles(html);
      } catch {
        return [] as Product[];
      }
    });
    const home = await fetchText("https://www.auchan.pt/", {}, 15000)
      .then(parseAuchanTiles)
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

function parseAuchanTiles(html: string): Product[] {
  const $ = cheerio.load(html);
  const products: Product[] = [];
  const seen = new Set<string>();

  $(".auc-js-product-tile, .product-tile").each((_, el) => {
    const $el = $(el);
    const raw = $el.attr("data-gtm") || $el.attr("data-gtm-new");
    if (!raw) return;
    let meta: {
      name?: string;
      item_name?: string;
      id?: string;
      item_id?: string;
      price?: string | number;
      brand?: string;
      item_brand?: string;
      discount?: string | number;
    };
    try {
      meta = JSON.parse(raw);
    } catch {
      return;
    }
    const id = String(meta.id ?? meta.item_id ?? $el.attr("data-pid") ?? "");
    const name = (meta.name ?? meta.item_name ?? "").trim();
    const price = Number(meta.price) || parseEuro($el.text()) || 0;
    if (!id || !name || !price || seen.has(id)) return;
    seen.add(id);

    const href =
      $el.find("a[href*='.html']").first().attr("href") ||
      $el.find("a").first().attr("href") ||
      "";
    const url = href.startsWith("http") ? href : `https://www.auchan.pt${href}`;
    const imageUrl =
      $el.find("img.tile-image").attr("data-src") ||
      $el.find("img.tile-image").attr("src") ||
      $el.find("img").attr("data-src") ||
      $el.find("img").attr("src");
    const unitText = $el.find(".auc-measures--price-per-unit").text();
    const { unitPrice, unitLabel } = parseUnitPrice(unitText);
    const discount = Number(meta.discount) || 0;
    const original =
      discount > 0 && discount < price * 3 ? price + discount : undefined;

    products.push({
      id,
      chain: "auchan",
      name,
      brand: meta.brand ?? meta.item_brand,
      price,
      originalPrice: original && original > price ? original : undefined,
      unitPrice,
      unitLabel,
      imageUrl,
      url,
    });
  });

  return products;
}
