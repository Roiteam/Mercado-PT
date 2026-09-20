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
      return cached("flyers:continente:v1", 6 * 60 * 60 * 1000, scrapeContinenteFlyers);
    case "pingo_doce":
      return cached("flyers:pingo:v1", 6 * 60 * 60 * 1000, scrapePingoFlyers);
    case "auchan":
      return cached("flyers:auchan:v1", 6 * 60 * 60 * 1000, scrapeAuchanFlyers);
    case "lidl":
      return cached("flyers:lidl:v1", 6 * 60 * 60 * 1000, scrapeLidlFlyers);
    case "aldi":
      return cached("flyers:aldi:v1", 6 * 60 * 60 * 1000, scrapeAldiFlyers);
    case "intermarche":
      return [
        flyer(
          "intermarche",
          "Folhetos Intermarché",
          "https://intermarche.pt/sign/brands/catalog-page",
        ),
      ];
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
    const imageUrl =
      $el.find("img").attr("data-src") ||
      $el.find("source").attr("srcset") ||
      $el.find("img").attr("src");
    out.push(
      flyer("continente", title, abs(href, "https://www.continente.pt"), {
        period,
        imageUrl,
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
          imageUrl: $el.find("img").attr("src"),
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
          period: card.find(".auc-leaflets__item__period").text().replace(/\s+/g, " ").trim() || undefined,
          imageUrl: abs(img.attr("src") ?? "", "https://www.auchan.pt") || undefined,
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
  $('a[href*="/l/pt/folhetos/"]').each((_, el) => {
    const href = $(el).attr("href");
    if (!href || seen.has(href)) return;
    seen.add(href);
    const slug = href.split("/folhetos/")[1]?.split("/")[0] ?? "folheto";
    const title = slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    out.push(flyer("lidl", title, abs(href, "https://www.lidl.pt")));
  });
  return out.length
    ? out.slice(0, 10)
    : [flyer("lidl", "Folhetos Lidl", "https://www.lidl.pt/c/folhetos/s10020672")];
}

async function scrapeAldiFlyers(): Promise<Flyer[]> {
  const html = await fetchText("https://www.aldi.pt/folhetosaldi.html", {}, 15000);
  const $ = cheerio.load(html);
  const out: Flyer[] = [];
  const seen = new Set<string>();
  $('a[href*="folheto"], a[href*="leaflet"], a[href*="ipaper"], a[href*="publitas"]').each(
    (_, el) => {
      const href = $(el).attr("href");
      if (!href || href.startsWith("#") || seen.has(href)) return;
      seen.add(href);
      const title = $(el).text().replace(/\s+/g, " ").trim() || "Folheto Aldi";
      out.push(flyer("aldi", title.slice(0, 80), abs(href, "https://www.aldi.pt")));
    },
  );
  return out.length
    ? out.slice(0, 8)
    : [flyer("aldi", "Folhetos Aldi", "https://www.aldi.pt/folhetosaldi.html")];
}

function abs(href: string, base: string) {
  if (!href) return href;
  if (href.startsWith("http")) return href;
  return new URL(href, base).toString();
}

