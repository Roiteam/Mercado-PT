export function normalizeBarcode(raw: string) {
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 8 && digits.length <= 14) return digits;
  return raw.match(/\d{8,14}/)?.[0] ?? "";
}

export function isReliableBarcode(code: string) {
  const digits = normalizeBarcode(code);
  if (![8, 12, 13, 14].includes(digits.length)) return digits.length >= 8;
  return gtinCheck(digits);
}

function gtinCheck(digits: string) {
  const nums = digits.split("").map(Number);
  const check = nums.pop();
  if (check === undefined || nums.some((n) => Number.isNaN(n))) return false;
  let sum = 0;
  nums.reverse().forEach((n, i) => {
    sum += n * (i % 2 === 0 ? 3 : 1);
  });
  return (10 - (sum % 10)) % 10 === check;
}

function lookupCodes(code: string) {
  const digits = normalizeBarcode(code);
  const codes = [digits];
  if (digits.length === 12) codes.push(`0${digits}`);
  if (digits.length === 13 && digits.startsWith("0")) codes.push(digits.slice(1));
  return [...new Set(codes.filter(Boolean))];
}

function firstText(...values: (string | undefined | null)[]) {
  for (const value of values) {
    const text = value?.replace(/\s+/g, " ").trim();
    if (text) return text;
  }
  return "";
}

type OffProduct = {
  product_name?: string;
  product_name_pt?: string;
  generic_name?: string;
  generic_name_pt?: string;
  brands?: string;
  quantity?: string;
};

function labelFromProduct(product: OffProduct) {
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

async function fetchProduct(host: string, code: string, signal: AbortSignal) {
  const url = new URL(`${host}/api/v2/product/${encodeURIComponent(code)}`);
  url.searchParams.set("lc", "pt");
  url.searchParams.set(
    "fields",
    "product_name,product_name_pt,generic_name,generic_name_pt,brands,quantity",
  );
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  const data = (await res.json()) as { status?: number; product?: OffProduct };
  if (data.status !== 1 || !data.product) return null;
  return labelFromProduct(data.product);
}

const HOSTS = [
  "https://world.openfoodfacts.org",
  "https://world.openproductsfacts.org",
  "https://world.openbeautyfacts.org",
];

async function lookupOnce(code: string) {
  const codes = lookupCodes(code);
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 8000);
  try {
    const attempts = HOSTS.flatMap((host) =>
      codes.map(async (value) => {
        const name = await fetchProduct(host, value, controller.signal);
        if (!name) throw new Error("miss");
        return name;
      }),
    );
    return await Promise.any(attempts);
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function lookupBarcode(code: string): Promise<string | null> {
  const barcode = normalizeBarcode(code);
  if (!barcode) return null;
  const first = await lookupOnce(barcode);
  if (first) return first;
  await new Promise((resolve) => window.setTimeout(resolve, 400));
  return lookupOnce(barcode);
}
