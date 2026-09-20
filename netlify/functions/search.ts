import type { Config } from "@netlify/functions";
import { errorJson, json } from "./_shared/http.ts";
import { searchContinente } from "./_shared/adapters/continente.ts";
import { searchPingoDoce } from "./_shared/adapters/pingodoce.ts";
import { expandQuery } from "./_shared/match.ts";
import type { ChainId, Product } from "./_shared/types.ts";

export default async (req: Request) => {
  if (req.method !== "GET") return errorJson("Method not allowed", 405);
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return errorJson("Pesquisa com pelo menos 2 caracteres.");
  const chains = (url.searchParams.get("chains") ?? "continente,pingo_doce")
    .split(",")
    .map((c) => c.trim()) as ChainId[];
  const query = expandQuery(q);

  try {
    const jobs: Promise<Product[]>[] = [];
    if (chains.includes("continente")) jobs.push(searchContinente(query, 8));
    if (chains.includes("pingo_doce")) jobs.push(searchPingoDoce(query, 8));
    const products = (await Promise.all(jobs.map((j) => j.catch(() => [] as Product[]))))
      .flat()
      .sort((a, b) => a.price - b.price)
      .slice(0, 16);
    return json({ query, products });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Pesquisa falhou.";
    return errorJson(message, 502);
  }
};

export const config: Config = {
  path: "/api/search",
};
