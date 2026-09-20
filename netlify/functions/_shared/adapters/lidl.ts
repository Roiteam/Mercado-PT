import { cached, fetchText } from "../http.ts";
import type { Product } from "../types.ts";

export async function searchLidl(query: string, size = 8): Promise<Product[]> {
  const q = query.trim();
  if (!q) return [];
  return cached(`lidl:search:v2:${q}:${size}`, 45 * 60 * 1000, async () => {
    const html = await fetchText(
      `https://www.lidl.pt/q/search?q=${encodeURIComponent(q)}`,
      {},
      18000,
    );
    return parseLidlSearch(html, size);
  });
}

function decode(html: string) {
  return html
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseLidlSearch(html: string, size: number): Product[] {
  const text = decode(html);
  const products: Product[] = [];
  const seen = new Set<string>();
  const re = /"itemId":(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) && products.length < size) {
    const id = match[1];
    if (seen.has(id)) continue;
    const window = text.slice(Math.max(0, match.index - 1800), match.index + 4200);
    const name = window.match(/"fullTitle":"([^"]+)"/)?.[1];
    const price = Number(window.match(/"price":([0-9.]+),"priceTheme"/)?.[1]);
    if (!name || !price) continue;
    seen.add(id);
    const imageUrl = window.match(/"image":"(https:[^"]+)"/)?.[1];
    const path = window.match(/"canonicalUrl":"(\/p\/[^"]+)"/)?.[1];
    const deleted = Number(window.match(/"deletedPrice":([0-9.]+)/)?.[1]);
    const quantityLabel = window.match(/"packaging":\{"text":"([^"]+)"/)?.[1];
    products.push({
      id,
      chain: "lidl",
      name,
      price,
      originalPrice: deleted && deleted > price ? deleted : undefined,
      quantityLabel,
      imageUrl,
      url: path ? `https://www.lidl.pt${path}` : `https://www.lidl.pt/q/search?q=${encodeURIComponent(name)}`,
    });
  }
  return products;
}
