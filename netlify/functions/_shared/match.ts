const IT_PT: Record<string, string> = {
  latte: "leite",
  pane: "pão",
  pasta: "massa",
  riso: "arroz",
  olio: "azeite",
  "olio d'oliva": "azeite",
  "olio di oliva": "azeite",
  zucchero: "açúcar",
  sale: "sal",
  uova: "ovos",
  pollo: "frango",
  carne: "carne",
  pesce: "peixe",
  pomodori: "tomate",
  pomodoro: "tomate",
  acqua: "água",
  birra: "cerveja",
  vino: "vinho",
  caffè: "café",
  caffe: "café",
  yogurt: "iogurte",
  yoghurt: "iogurte",
  burro: "manteiga",
  formaggio: "queijo",
  prosciutto: "presunto",
  dentifricio: "pasta de dentes",
  sapone: "sabão",
  "carta igienica": "papel higiénico",
  detersivo: "detergente",
  biscotti: "bolachas",
  farina: "farinha",
  succo: "sumo",
  mela: "maçã",
  mele: "maçã",
  banana: "banana",
  patate: "batata",
  cipolla: "cebola",
  aglio: "alho",
};

const STOP = new Set([
  "di",
  "da",
  "del",
  "della",
  "e",
  "o",
  "un",
  "una",
  "the",
  "de",
  "do",
  "da",
  "com",
]);

function stripAccents(s: string) {
  return s.normalize("NFD").replace(/\p{M}/gu, "");
}

export function expandQuery(query: string): string {
  const q = query.trim().toLowerCase();
  if (IT_PT[q]) return IT_PT[q];
  const words = q.split(/\s+/).map((w) => IT_PT[w] ?? w);
  return words.join(" ");
}

export function normalize(s: string) {
  return stripAccents(s.toLowerCase())
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function tokens(s: string) {
  return normalize(s)
    .split(" ")
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export function scoreMatch(query: string, name: string, brand?: string): number {
  const q = tokens(expandQuery(query));
  if (!q.length) return 0;
  const hay = tokens(`${name} ${brand ?? ""}`);
  if (!hay.length) return 0;
  const haySet = new Set(hay);
  let hit = 0;
  for (const t of q) {
    if (haySet.has(t) || hay.some((h) => h.includes(t) || t.includes(h))) hit += 1;
  }
  const overlap = hit / q.length;
  const joinedQ = q.join(" ");
  const joinedH = hay.join(" ");
  const contains = joinedH.includes(joinedQ) ? 0.2 : 0;
  return Math.min(1, overlap + contains);
}

export function pickBest<T extends { name: string; brand?: string; price: number; unitPrice?: number }>(
  query: string,
  products: T[],
): { item: T; score: number } | null {
  let best: { item: T; score: number } | null = null;
  for (const item of products) {
    const score = scoreMatch(query, item.name, item.brand);
    if (score < 0.38) continue;
    if (!best) {
      best = { item, score };
      continue;
    }
    const a = comparablePrice(item);
    const b = comparablePrice(best.item);
    if (score > best.score + 0.12 || (Math.abs(score - best.score) <= 0.12 && a < b)) {
      best = { item, score };
    }
  }
  return best;
}

function comparablePrice(p: { price: number; unitPrice?: number }) {
  return p.unitPrice && p.unitPrice > 0 ? p.unitPrice : p.price;
}
