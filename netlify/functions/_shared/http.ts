const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 PoupaJa/0.1";

export async function fetchText(
  url: string,
  init: RequestInit = {},
  timeoutMs = 12000,
): Promise<string> {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "User-Agent": BROWSER_UA,
      Accept:
        "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      "Accept-Language": "pt-PT,pt;q=0.9,it;q=0.8,en;q=0.7",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.text();
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = 12000,
): Promise<T> {
  const text = await fetchText(
    url,
    {
      ...init,
      headers: {
        Accept: "application/json,text/plain,*/*",
        ...(init.headers ?? {}),
      },
    },
    timeoutMs,
  );
  return JSON.parse(text) as T;
}

/** Catalogs, flyers, and OSM stores: at most twice a day. */
export const SCRAPE_TTL_MS = 12 * 60 * 60 * 1000;
export const GEO_TTL_MS = 24 * 60 * 60 * 1000;

const mem = new Map<string, { exp: number; value: unknown }>();

function blobKey(key: string) {
  return key.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180);
}

export async function cached<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const hit = mem.get(key);
  if (hit && hit.exp > now) return hit.value as T;

  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore("poupaja-cache");
    const rec = (await store.get(blobKey(key), { type: "json" })) as
      | { exp: number; value: T }
      | null;
    if (rec && rec.exp > now && !(Array.isArray(rec.value) && rec.value.length === 0)) {
      mem.set(key, rec);
      return rec.value;
    }
    const value = await fn();
    const next = { exp: now + ttlMs, value };
    const cacheable = !(Array.isArray(value) && value.length === 0);
    if (cacheable) {
      mem.set(key, next);
      await store.setJSON(blobKey(key), next).catch(() => undefined);
    }
    return value;
  } catch {
    const value = await fn();
    if (!(Array.isArray(value) && value.length === 0)) {
      mem.set(key, { exp: now + ttlMs, value });
    }
    return value;
  }
}

export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "public, max-age=60",
    },
  });
}

export function jsonPrivate(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export function errorJson(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return out;
}
