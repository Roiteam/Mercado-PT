import { aldiHomeOffers, searchAldi } from "./adapters/aldi.ts";
import { auchanHomeOffers, searchAuchan } from "./adapters/auchan.ts";
import { continenteHomeOffers, searchContinente } from "./adapters/continente.ts";
import { lidlHomeOffers, searchLidl } from "./adapters/lidl.ts";
import { mercadonaHomeOffers, searchMercadona } from "./adapters/mercadona.ts";
import { pingoDoceOffers, searchPingoDoce } from "./adapters/pingodoce.ts";
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
    case "aldi":
      return searchAldi(query, size);
    case "mercadona":
      return searchMercadona(query, size);
    default:
      return [];
  }
}

export async function homeOffersForChain(chain: ChainId): Promise<Product[]> {
  switch (chain) {
    case "continente":
      return continenteHomeOffers();
    case "pingo_doce":
      return pingoDoceOffers();
    case "auchan":
      return auchanHomeOffers();
    case "lidl":
      return lidlHomeOffers();
    case "aldi":
      return aldiHomeOffers();
    case "mercadona":
      return mercadonaHomeOffers();
    default:
      return [];
  }
}
