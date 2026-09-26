export function normalizeBarcode(raw: string) {
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 8 && digits.length <= 14) return digits;
  return raw.match(/\d{8,14}/)?.[0] ?? "";
}

function firstText(...values: (string | undefined | null)[]) {
  for (const value of values) {
    const text = value?.replace(/\s+/g, " ").trim();
    if (text) return text;
  }
  return "";
}

export async function lookupBarcode(code: string): Promise<string | null> {
  const barcode = normalizeBarcode(code);
  if (!barcode) return null;
  const url = new URL(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}`);
  url.searchParams.set("lc", "pt");
  url.searchParams.set(
    "fields",
    "product_name,product_name_pt,generic_name,generic_name_pt,brands,quantity",
  );
  const res = await fetch(url, {
    headers: { "User-Agent": "Mercado.pt/1.0 (grocery list)" },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    status?: number;
    product?: {
      product_name?: string;
      product_name_pt?: string;
      generic_name?: string;
      generic_name_pt?: string;
      brands?: string;
      quantity?: string;
    };
  };
  if (data.status !== 1 || !data.product) return null;
  const product = data.product;
  const name = firstText(
    product.product_name_pt,
    product.product_name,
    product.generic_name_pt,
    product.generic_name,
  );
  const brand = firstText(product.brands?.split(",")[0]);
  if (!name && !brand) return null;
  let label = name || brand;
  if (name && brand && !name.toLowerCase().includes(brand.toLowerCase())) {
    label = `${brand} ${name}`;
  }
  const qty = firstText(product.quantity?.replace(/\s+e$/i, ""));
  if (qty && qty.length <= 12) label = `${label} ${qty}`;
  return label;
}
