import * as cheerio from "cheerio";
import { cached, fetchText } from "./http.ts";
import type { ChainId, Flyer } from "./types.ts";

export async function loadFlyers(chains: ChainId[]): Promise<Flyer[]> {
  const unique = [...new Set(chains.filter((c) => c !== "other"))];
  const lists = await Promise.all(
    unique.map((chain) => loadChainFlyers(chain).catch(() => [] as Flyer[])),
  );
  const seen = new Set<string>();
  return lists.flat().filter((f) => {
    if (seen.has(f.url)) return false;
    seen.add(f.url);
    return true;
  });
}

async function loadChainFlyers(chain: ChainId): Promise<Flyer[]> {
  switch (chain) {
    case "continente":
      return cached("flyers:continente:v2", 6 * 60 * 60 * 1000, scrapeContinenteFlyers);
    case "pingo_doce":
      return cached("flyers:pingo:v2", 6 * 60 * 60 * 1000, scrapePingoFlyers);
    case "auchan":
      return cached("flyers:auchan:v2", 6 * 60 * 60 * 1000, scrapeAuchanFlyers);
    case "lidl":
      return cached("flyers:lidl:v2", 6 * 60 * 60 * 1000, scrapeLidlFlyers);
    case "aldi":
      return cached("flyers:aldi:v2", 6 * 60 * 60 * 1000, scrapeAldiFlyers);
    case "intermarche":
      return cached("flyers:intermarche:v2", 6 * 60 * 60 * 1000, async () => {
        try {
          return await scrapeIntermarcheFlyers();
        } catch {
          return [
            flyer(
              "intermarche",
              "Folhetos Intermarché",
              "https://intermarche.pt/sign/brands/catalog-page",
            ),
          ];
        }
      });
    case "minipreco":
      return [
        flyer("minipreco", "Folhetos Minipreço", "https://www.minipreco.pt/folhetos"),
      ];
    default:
      return [];
  }
}

function flyer(
  chain: ChainId,
  title: string,
  url: string,
  extra: Partial<Flyer> = {},
): Flyer {
  return {
    id: `${chain}:${url}`,
    chain,
    title,
    url,
    ...extra,
  };
}

function firstSrcsetUrl(srcset?: string) {
  if (!srcset) return "";
  return srcset.split(",")[0]?.trim().split(/\s+/)[0] ?? "";
}

function pickImage($el: cheerio.Cheerio<cheerio.Element>, base: string) {
  const img = $el.find("img").first();
  const noscript = $el.find("noscript").first().html() ?? "";
  const noscriptSrc = noscript.match(/\b(?:data-src|src)="([^"]+)"/i)?.[1] ?? "";
  const raw =
    img.attr("data-src") ||
    img.attr("data-original") ||
    img.attr("data-lazy-src") ||
    firstSrcsetUrl(img.attr("srcset") || $el.find("source").first().attr("srcset")) ||
    img.attr("src") ||
    noscriptSrc;
  const url = abs(raw, base);
  if (!url || url.startsWith("data:")) return undefined;
  return url;
}

function prettySlug(value: string) {
  const cleaned = decodeURIComponent(value)
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return value;
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

async function scrapeContinenteFlyers(): Promise<Flyer[]> {
  const html = await fetchText("https://www.continente.pt/folhetos/", {}, 15000);
  const $ = cheerio.load(html);
  const out: Flyer[] = [];
  const seen = new Set<string>();
  $(".ipaper-tile").each((_, el) => {
    const $el = $(el);
    const href = $el.find("a.ipaper-tile--image-link").attr("href") || $el.find("a").attr("href");
    if (!href || seen.has(href)) return;
    seen.add(href);
    const title =
      $el.find(".ipaper-tile--title").text().trim() ||
      $el.find("img").attr("alt") ||
      $el.find("img").attr("title") ||
      "Folheto Continente";
    const period = $el.find(".ipaper-tile--description").text().trim() || undefined;
    out.push(
      flyer("continente", title, abs(href, "https://www.continente.pt"), {
        period,
        imageUrl: pickImage($el, "https://www.continente.pt"),
      }),
    );
  });
  return out.length
    ? out.slice(0, 12)
    : [flyer("continente", "Folhetos Continente", "https://www.continente.pt/folhetos/")];
}

async function scrapePingoFlyers(): Promise<Flyer[]> {
  const html = await fetchText("https://www.pingodoce.pt/folhetos/", {}, 15000);
  const $ = cheerio.load(html);
  const out: Flyer[] = [];
  $("a.leaflet-card").each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href");
    if (!href) return;
    out.push(
      flyer(
        "pingo_doce",
        $el.find(".title").text().trim() || "Folheto Pingo Doce",
        abs(href, "https://www.pingodoce.pt"),
        {
          period: $el.find(".date").text().trim() || undefined,
          imageUrl: pickImage($el, "https://www.pingodoce.pt"),
        },
      ),
    );
  });
  return out.length
    ? out.slice(0, 12)
    : [flyer("pingo_doce", "Folhetos Pingo Doce", "https://www.pingodoce.pt/folhetos/")];
}

async function scrapeAuchanFlyers(): Promise<Flyer[]> {
  const html = await fetchText("https://www.auchan.pt/pt/folhetos/", {}, 15000);
  const $ = cheerio.load(html);
  const out: Flyer[] = [];
  const seen = new Set<string>();
  $("a.auc-leaflets__item__title, a.auc-leaflets__item__image").each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href");
    if (!href || seen.has(href)) return;
    seen.add(href);
    const card = $el.closest(".auc-leaflets__item").length
      ? $el.closest(".auc-leaflets__item")
      : $el.parent();
    const img = card.find("img.auc-leaflets__item__image__content");
    out.push(
      flyer(
        "auchan",
        ($el.text().trim() || img.attr("alt") || "Folheto Auchan").trim(),
        abs(href, "https://www.auchan.pt"),
        {
          period:
            card.find(".auc-leaflets__item__period").text().replace(/\s+/g, " ").trim() ||
            undefined,
          imageUrl: pickImage(card, "https://www.auchan.pt"),
        },
      ),
    );
  });
  return out.length
    ? out.slice(0, 12)
    : [flyer("auchan", "Folhetos Auchan", "https://www.auchan.pt/pt/folhetos/")];
}

async function scrapeLidlFlyers(): Promise<Flyer[]> {
  const html = await fetchText(
    "https://www.lidl.pt/c/folhetos/s10020672",
    {},
    15000,
  );
  const $ = cheerio.load(html);
  const out: Flyer[] = [];
  const seen = new Set<string>();
  $("a.flyer, a[href*='/l/pt/folhetos/']").each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href");
    if (!href || seen.has(href)) return;
    seen.add(href);
    const name = $el.find(".flyer__name").text().replace(/\s+/g, " ").trim();
    const when = $el.find(".flyer__title").text().replace(/\s+/g, " ").trim();
    const slug = href.split("/folhetos/")[1]?.split("/")[0] ?? "folheto";
    out.push(
      flyer("lidl", name || prettySlug(slug), abs(href, "https://www.lidl.pt"), {
        period: when || undefined,
        imageUrl: pickImage($el, "https://www.lidl.pt"),
      }),
    );
  });
  return out.length
    ? out.slice(0, 10)
    : [flyer("lidl", "Folhetos Lidl", "https://www.lidl.pt/c/folhetos/s10020672")];
}

type AldiTile = {
  title?: string;
  description?: string;
  tileImage?: string;
  reference?: { path?: string };
};

async function scrapeAldiFlyers(): Promise<Flyer[]> {
  const html = await fetchText("https://www.aldi.pt/folheto.html", {}, 15000);
  const raw = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
  )?.[1];
  if (raw) {
    try {
      const data = JSON.parse(raw) as {
        props?: { pageProps?: { page?: { leaflets?: Record<string, { tiles?: Record<string, unknown> }> } } };
      };
      const tiles = data.props?.pageProps?.page?.leaflets?.["0"]?.tiles ?? {};
      const keys = Array.isArray(tiles["@nodes"])
        ? (tiles["@nodes"] as string[])
        : Object.keys(tiles).filter((k) => k.startsWith("tiles"));
      const out: Flyer[] = [];
      for (const key of keys) {
        const tile = tiles[key] as AldiTile | undefined;
        const path = tile?.reference?.path;
        if (!tile || !path) continue;
        out.push(
          flyer("aldi", tile.title || "Folheto Aldi", abs(`${path}.html`, "https://www.aldi.pt"), {
            period: tile.description,
            imageUrl: tile.tileImage,
          }),
        );
      }
      if (out.length) return out.slice(0, 8);
    } catch {
      /* fall through to hub link */
    }
  }
  return [flyer("aldi", "Folhetos Aldi", "https://www.aldi.pt/folheto.html")];
}

async function scrapeIntermarcheFlyers(): Promise<Flyer[]> {
  const html = await fetchText("https://intermarche.pt/sign/brands/catalog-page", {}, 15000);
  const $ = cheerio.load(html);
  const out: Flyer[] = [];
  const seen = new Set<string>();
  $('a[href*="folhetos.intermarche.pt"]').each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href");
    if (!href || seen.has(href)) return;
    seen.add(href);
    const slug = href.split("/").filter(Boolean).at(-1) || "folheto";
    const title =
      $el.attr("title")?.trim() ||
      $el.find("img").attr("alt")?.trim() ||
      prettySlug(slug);
    out.push(
      flyer("intermarche", title === "cmsImage" ? prettySlug(slug) : title, href, {
        imageUrl: pickImage($el, "https://intermarche.pt"),
      }),
    );
  });
  return out.length
    ? out.slice(0, 12)
    : [
        flyer(
          "intermarche",
          "Folhetos Intermarché",
          "https://intermarche.pt/sign/brands/catalog-page",
        ),
      ];
}

function abs(href: string, base: string) {
  if (!href) return href;
  const trimmed = href.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  try {
    return new URL(trimmed, base).toString();
  } catch {
    return trimmed;
  }
}
