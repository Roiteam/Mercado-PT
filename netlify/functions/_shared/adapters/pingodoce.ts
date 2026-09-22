import * as cheerio from "cheerio";
import { cached, fetchText, mapPool, SCRAPE_TTL_MS } from "../http.ts";
import { parseEuro, parseUnitPrice } from "../geo.ts";
import type { Product } from "../types.ts";

const SEARCH =
  "https://www.pingodoce.pt/on/demandware.store/Sites-pingo-doce-Site/default/Search-UpdateGrid";

export async function searchPingoDoce(query: string, size = 8): Promise<Product[]> {
  const q = query.trim();
  if (!q) return [];
  return cached(`pd:search:v2:${q}:${size}`, SCRAPE_TTL_MS, async () => {
    const url = `${SEARCH}?q=${encodeURIComponent(q)}&start=0&sz=${size}`;
    const html = await fetchText(url, {}, 15000);
    return parsePingoTiles(html);
  });
}

export async function pingoDoceOffers(): Promise<Product[]> {
  return cached("pd:promo:v4", SCRAPE_TTL_MS, async () => {
    const starts = Array.from({ length: 10 }, (_, i) => i * 48);
    const pages = await mapPool(starts, 4, async (start) => {
      try {
        const html = await fetchText(
          `${SEARCH}?cgid=promocoes&start=${start}&sz=48`,
          {},
          18000,
        );
        return parsePingoTiles(html);
      } catch {
        return [] as Product[];
      }
    });
    const seen = new Set<string>();
    const out: Product[] = [];
    for (const p of pages.flat()) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      out.push(p);
    }
    return out;
  });
}

function parsePingoTiles(html: string): Product[] {
  const $ = cheerio.load(html);
  const products: Product[] = [];
  const seen = new Set<string>();

  $(".product-tile-pd").each((_, el) => {
    const $el = $(el);
    const raw = $el.attr("data-gtm-info");
    const pid = $el.attr("data-pid") ?? "";
    let name = "";
    let brand: string | undefined;
    let price = 0;
    let discount = 0;

    if (raw) {
      try {
        const gtm = JSON.parse(raw) as {
          value?: number;
          items?: {
            item_id?: string;
            item_name?: string;
            item_brand?: string;
            price?: number;
            discount?: number;
          }[];
        };
        const item = gtm.items?.[0];
        name = (item?.item_name ?? "").trim();
        brand = item?.item_brand;
        price = Number(item?.price ?? gtm.value ?? 0);
        discount = Number(item?.discount ?? 0);
      } catch {
        /* fall through */
      }
    }

    if (!name) {
      name = $el.find(".product-name-link a").first().text().trim();
    }
    if (!price) {
      price =
        parseEuro($el.find("span.sales .value").attr("content")) ||
        parseEuro($el.find("span.sales").text()) ||
        0;
    }
    const id = pid || name;
    if (!id || !name || !price || seen.has(id)) return;
    seen.add(id);

    const href =
      $el.find("a.product-tile-image-link").attr("href") ||
      $el.find(".product-name-link a").attr("href") ||
      "";
    const url = href.startsWith("http")
      ? href
      : `https://www.pingodoce.pt${href}`;
    const imageUrl = $el.find("img.product-tile-component-image").attr("src");
    const unitText = $el.find(".product-unit").text();
    const { unitPrice, unitLabel } = parseUnitPrice(unitText);
    const quantityLabel = unitText.split("|")[0]?.trim() || undefined;
    const original =
      parseEuro($el.find(".strike-through .value").attr("content")) ||
      (discount > 0 && discount < price * 3 ? price + discount : undefined);
    const originalPrice =
      original && original > price && original < price * 4 ? original : undefined;

    const promo = $el.find(".product-tile-promo-label").text().trim();

    products.push({
      id,
      chain: "pingo_doce",
      name,
      brand,
      price,
      originalPrice,
      unitPrice,
      unitLabel,
      quantityLabel,
      imageUrl,
      url,
      promoLabel: promo || undefined,
    });
  });

  return products;
}
