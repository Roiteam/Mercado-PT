export type ChainId =
  | "continente"
  | "pingo_doce"
  | "auchan"
  | "lidl"
  | "aldi"
  | "minipreco"
  | "intermarche"
  | "mercadona"
  | "other";

export type Place = {
  lat: number;
  lon: number;
  city: string;
  postalCode: string;
  label: string;
};

export type Store = {
  id: string;
  chain: ChainId;
  name: string;
  address: string;
  city: string;
  postalCode?: string;
  lat: number;
  lon: number;
  distanceKm: number;
  mapsUrl: string;
};

export type Product = {
  id: string;
  chain: ChainId;
  name: string;
  brand?: string;
  price: number;
  originalPrice?: number;
  unitPrice?: number;
  unitLabel?: string;
  quantityLabel?: string;
  imageUrl?: string;
  url: string;
  promoLabel?: string;
};

export type ListItem = {
  id: string;
  query: string;
  qty: number;
};

export type MatchResult = {
  query: string;
  qty: number;
  product: Product | null;
  score: number;
  lineTotal: number;
};

export type StoreGroup = {
  chain: ChainId;
  chainLabel: string;
  store: Store;
  items: MatchResult[];
  subtotal: number;
};

export type OptimizeResponse = {
  place: Place;
  radiusKm: number;
  groups: StoreGroup[];
  unmatched: { query: string; qty: number; reason: string }[];
  totals: {
    split: number;
    oneStore?: { chain: ChainId; chainLabel: string; total: number; missing: number };
    savings: number;
  };
  generatedAt: string;
};

export type StoresResponse = {
  place: Place;
  radiusKm: number;
  stores: Store[];
  pricedChains: ChainId[];
};

export type OffersResponse = {
  place: Place;
  offers: Product[];
  flyers: Flyer[];
};

export type Flyer = {
  id: string;
  chain: ChainId;
  title: string;
  period?: string;
  imageUrl?: string;
  url: string;
};

export type ShoppingList = {
  id: string;
  householdId: string;
  title: string;
  status: "open" | "done";
  postalCode?: string;
  items: ListItem[];
  split?: OptimizeResponse | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
};
