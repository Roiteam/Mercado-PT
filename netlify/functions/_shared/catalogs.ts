import { searchAuchan } from "./adapters/auchan.ts";
import { searchContinente } from "./adapters/continente.ts";
import { searchLidl } from "./adapters/lidl.ts";
import { searchPingoDoce } from "./adapters/pingodoce.ts";
import type { ChainId, Product } from "./types.ts";

export async function searchChain(chain: ChainId, query: string, size = 8): Promise<Product[]> {
  switch (chain) {
    case "continente":
      return searchContinente(query, size);
    case "pingo_doce":
      return searchPingoDoce(query, size);
    case "auchan":
      return searchAuchan(query, size);
    case "lidl":
      return searchLidl(query, size);
    default:
      return [];
  }
}
