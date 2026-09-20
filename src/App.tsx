import { useEffect, useMemo, useState } from "react";
import { getOffers, getStores, optimizeList } from "./api";
import {
  CHAIN_LABEL,
  CHAIN_TONE,
  euro,
  storeMapsLink,
  loadList,
  loadPostal,
  loadRadius,
  saveList,
  savePostal,
  saveRadius,
  uid,
} from "./format";
import type {
  ChainId,
  Flyer,
  ListItem,
  OffersResponse,
  OptimizeResponse,
  Store,
  StoresResponse,
} from "./types";

const DEMO = [
  { cap: "1000-001", city: "Lisboa" },
  { cap: "4000-001", city: "Porto" },
  { cap: "8000-001", city: "Faro" },
];

export default function App() {
  const [postal, setPostal] = useState("");
  const [draftCap, setDraftCap] = useState("");
  const [radiusKm, setRadiusKm] = useState(6);
  const [storesData, setStoresData] = useState<StoresResponse | null>(null);
  const [offers, setOffers] = useState<OffersResponse | null>(null);
  const [list, setList] = useState<ListItem[]>([]);
  const [draftItem, setDraftItem] = useState("");
  const [loading, setLoading] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [error, setError] = useState("");
  const [split, setSplit] = useState<OptimizeResponse | null>(null);
  const [listOpen, setListOpen] = useState(false);

  useEffect(() => {
    const saved = loadPostal();
    const savedList = loadList<ListItem[]>([]);
    const savedRadius = loadRadius();
    setList(savedList);
    setRadiusKm(savedRadius);
    if (saved) {
      setPostal(saved);
      setDraftCap(saved);
      void boot(saved, savedRadius);
    }
  }, []);

  useEffect(() => {
    saveList(list);
  }, [list]);

  useEffect(() => {
    if (!listOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setListOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listOpen]);

  async function boot(cap: string, radius: number) {
    setLoading(true);
    setError("");
    setSplit(null);
    try {
      const [stores, nextOffers] = await Promise.all([
        getStores(cap, radius),
        getOffers(cap, radius).catch(() => null),
      ]);
      setStoresData(stores);
      setOffers(nextOffers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Qualcosa è andato storto.");
      setStoresData(null);
    } finally {
      setLoading(false);
    }
  }

  function submitCap(cap: string) {
    const value = cap.trim().toUpperCase();
    setPostal(value);
    savePostal(value);
    void boot(value, radiusKm);
  }

  function changeRadius(next: number) {
    setRadiusKm(next);
    saveRadius(next);
    if (postal) void boot(postal, next);
  }

  function addItem(raw: string) {
    const query = raw.trim();
    if (query.length < 2) return;
    setList((prev) => {
      const existing = prev.find(
        (it) => it.query.toLowerCase() === query.toLowerCase(),
      );
      if (existing) {
        return prev.map((it) =>
          it.id === existing.id ? { ...it, qty: it.qty + 1 } : it,
        );
      }
      return [...prev, { id: uid(), query, qty: 1 }];
    });
    setDraftItem("");
    setSplit(null);
  }

  async function closeList() {
    if (!postal || !list.length) return;
    setOptimizing(true);
    setError("");
    try {
      const result = await optimizeList(postal, radiusKm, list);
      setSplit(result);
      setListOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Confronto non riuscito.");
    } finally {
      setOptimizing(false);
    }
  }

  const pricedNearby = storesData?.pricedChains ?? [];
  const storeCount = storesData?.stores.length ?? 0;

  return (
    <div className="page">
      <header className="top">
        <div>
          <p className="kicker">Portogallo · prezzi veri dai cataloghi</p>
          <h1>PoupaJá</h1>
        </div>
        {postal ? (
          <button
            className="ghost"
            onClick={() => {
              setPostal("");
              savePostal("");
              setStoresData(null);
              setOffers(null);
              setSplit(null);
              setListOpen(false);
            }}
          >
            Cambia CAP
          </button>
        ) : null}
      </header>

      {!postal ? (
        <PostalGate
          draft={draftCap}
          setDraft={setDraftCap}
          onSubmit={submitCap}
          loading={loading}
          error={error}
        />
      ) : (
        <main className="layout">
          <section className="col">
            <LocationBar
              placeLabel={storesData?.place.label ?? postal}
              radiusKm={radiusKm}
              onRadius={changeRadius}
              loading={loading}
              storeCount={storeCount}
            />
            {error ? <p className="banner">{error}</p> : null}

            {split ? (
              <SplitView
                split={split}
                onBack={() => setSplit(null)}
                onReset={() => {
                  setList([]);
                  setSplit(null);
                }}
              />
            ) : (
              <>
                <StoreStrip stores={storesData?.stores ?? []} loading={loading} />
                <DealsBoard
                  offers={offers?.offers ?? []}
                  flyers={offers?.flyers ?? []}
                  chains={[...new Set((storesData?.stores ?? []).map((s) => s.chain))]}
                  loading={loading}
                  onAdd={(name) => addItem(name)}
                />
              </>
            )}
          </section>
        </main>
      )}

      {postal ? (
        <>
          <button
            type="button"
            className="list-fab"
            onClick={() => setListOpen(true)}
            hidden={listOpen}
            aria-expanded={listOpen}
          >
            Lista della spesa
            <span className="list-fab-count">{list.reduce((n, it) => n + it.qty, 0)}</span>
          </button>

          {listOpen ? (
            <div className="list-layer">
              <button
                type="button"
                className="list-backdrop"
                aria-label="Chiudi lista"
                onClick={() => setListOpen(false)}
              />
              <aside className="list-panel" role="dialog" aria-label="Lista della spesa">
                <div className="list-panel-head">
                  <h2>Lista della spesa</h2>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setListOpen(false)}
                  >
                    Chiudi
                  </button>
                </div>
                <p className="hint">
                  Aggiungi i prodotti in italiano o portoghese. Quando chiudi la
                  lista, PoupaJá la spezza sui supermercati più convenienti vicino a
                  te
                  {pricedNearby.length
                    ? ` (prezzi live: ${pricedNearby
                        .map((c) => (c === "pingo_doce" ? "Pingo Doce" : "Continente"))
                        .join(" e ")}).`
                    : "."}
                </p>
                <form
                  className="add-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    addItem(draftItem);
                  }}
                >
                  <input
                    autoFocus
                    value={draftItem}
                    onChange={(e) => setDraftItem(e.target.value)}
                    placeholder="es. latte, pão, azeite..."
                  />
                  <button type="submit">Aggiungi</button>
                </form>
                <ul className="list">
                  {list.map((item) => (
                    <li key={item.id}>
                      <span className="item-name">{item.query}</span>
                      <div className="qty">
                        <button
                          type="button"
                          onClick={() =>
                            setList((prev) =>
                              prev.map((it) =>
                                it.id === item.id
                                  ? { ...it, qty: Math.max(1, it.qty - 1) }
                                  : it,
                              ),
                            )
                          }
                        >
                          −
                        </button>
                        <strong>{item.qty}</strong>
                        <button
                          type="button"
                          onClick={() =>
                            setList((prev) =>
                              prev.map((it) =>
                                it.id === item.id ? { ...it, qty: it.qty + 1 } : it,
                              ),
                            )
                          }
                        >
                          +
                        </button>
                      </div>
                      <button
                        className="remove"
                        type="button"
                        onClick={() =>
                          setList((prev) => prev.filter((it) => it.id !== item.id))
                        }
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
                {!list.length ? (
                  <p className="empty">La lista è vuota. Aggiungi il primo prodotto.</p>
                ) : null}
                <button
                  className="primary close-btn"
                  disabled={!list.length || optimizing}
                  onClick={() => void closeList()}
                >
                  {optimizing ? "Confronto i prezzi…" : "Chiudi lista e spezza per negozio"}
                </button>
              </aside>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function PostalGate({
  draft,
  setDraft,
  onSubmit,
  loading,
  error,
}: {
  draft: string;
  setDraft: (v: string) => void;
  onSubmit: (v: string) => void;
  loading: boolean;
  error: string;
}) {
  return (
    <section className="gate">
      <h2>Dove fai la spesa?</h2>
      <p>
        Inserisci il codice postale portoghese. Ti mostro i supermercati nel raggio
        e le offerte, poi spezzo la tua lista dove costa meno.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(draft);
        }}
      >
        <input
          autoFocus
          inputMode="numeric"
          placeholder="1000-001"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button className="primary" type="submit" disabled={loading}>
          {loading ? "Cerco i negozi…" : "Vedi supermercati"}
        </button>
      </form>
      {error ? <p className="banner">{error}</p> : null}
      <div className="chips">
        {DEMO.map((d) => (
          <button key={d.cap} type="button" onClick={() => onSubmit(d.cap)}>
            {d.city} · {d.cap}
          </button>
        ))}
      </div>
    </section>
  );
}

function LocationBar({
  placeLabel,
  radiusKm,
  onRadius,
  loading,
  storeCount,
}: {
  placeLabel: string;
  radiusKm: number;
  onRadius: (n: number) => void;
  loading: boolean;
  storeCount: number;
}) {
  return (
    <div className="location">
      <div>
        <p className="kicker">Zona</p>
        <strong>{placeLabel}</strong>
        <p className="hint">
          {loading ? "Aggiorno i negozi…" : `${storeCount} supermercati nel raggio`}
        </p>
      </div>
      <label>
        Raggio
        <select
          value={radiusKm}
          onChange={(e) => onRadius(Number(e.target.value))}
        >
          <option value={3}>3 km</option>
          <option value={6}>6 km</option>
          <option value={10}>10 km</option>
          <option value={15}>15 km</option>
        </select>
      </label>
    </div>
  );
}

function StoreStrip({ stores, loading }: { stores: Store[]; loading: boolean }) {
  if (loading && !stores.length) {
    return <div className="skeleton-row" />;
  }
  return (
    <section>
      <h2>Supermercati vicino a te</h2>
      <div className="store-row">
        {stores.slice(0, 12).map((store) => (
          <a
            key={store.id}
            className="store-card"
            href={storeMapsLink(store)}
            target="_blank"
            rel="noreferrer"
          >
            <span
              className="dot"
              style={{ background: CHAIN_TONE[store.chain] ?? "#6d4c41" }}
            />
            <strong>{store.name}</strong>
            <em>{store.distanceKm.toFixed(1)} km</em>
            <span>{store.address}</span>
          </a>
        ))}
      </div>
    </section>
  );
}

function DealsBoard({
  offers,
  flyers,
  chains,
  loading,
  onAdd,
}: {
  offers: OffersResponse["offers"];
  flyers: Flyer[];
  chains: ChainId[];
  loading: boolean;
  onAdd: (name: string) => void;
}) {
  const [tab, setTab] = useState<"offers" | "flyers">("offers");
  const [chain, setChain] = useState<"all" | ChainId>("all");
  const [q, setQ] = useState("");
  const [onlySale, setOnlySale] = useState(false);
  const [visible, setVisible] = useState(48);

  const nearbyChains = chains.filter((c) => c !== "other");
  const query = q.trim().toLowerCase();

  const filteredOffers = offers.filter((p) => {
    if (chain !== "all" && p.chain !== chain) return false;
    if (onlySale && !p.originalPrice && !p.promoLabel) return false;
    if (query && !`${p.name} ${p.brand ?? ""}`.toLowerCase().includes(query)) {
      return false;
    }
    return true;
  });
  const shownOffers = filteredOffers.slice(0, visible);

  const filteredFlyers = flyers.filter((f) => {
    if (chain !== "all" && f.chain !== chain) return false;
    if (query && !`${f.title} ${f.period ?? ""}`.toLowerCase().includes(query)) {
      return false;
    }
    return true;
  });

  return (
    <section>
      <div className="deals-head">
        <h2>Offerte e volantini</h2>
        <div className="tabs">
          <button
            type="button"
            className={tab === "offers" ? "tab on" : "tab"}
            onClick={() => setTab("offers")}
          >
            Prodotti ({filteredOffers.length})
          </button>
          <button
            type="button"
            className={tab === "flyers" ? "tab on" : "tab"}
            onClick={() => setTab("flyers")}
          >
            Volantini ({filteredFlyers.length})
          </button>
        </div>
      </div>

      <div className="filters">
        <input
          value={q}
          placeholder="Filtra per nome…"
          onChange={(e) => {
            setQ(e.target.value);
            setVisible(48);
          }}
        />
        {tab === "offers" ? (
          <label className="check">
            <input
              type="checkbox"
              checked={onlySale}
              onChange={(e) => {
                setOnlySale(e.target.checked);
                setVisible(48);
              }}
            />
            Solo scontati
          </label>
        ) : null}
      </div>
      <div className="chips">
        <button
          type="button"
          className={chain === "all" ? "on" : ""}
          onClick={() => {
            setChain("all");
            setTab("offers");
            setVisible(48);
          }}
        >
          Tutti
        </button>
        {nearbyChains.map((id) => (
          <button
            key={id}
            type="button"
            className={chain === id ? "on" : ""}
            onClick={() => {
              setChain(id);
              setVisible(48);
              if (id !== "continente" && id !== "pingo_doce") setTab("flyers");
            }}
          >
            {CHAIN_LABEL[id]}
          </button>
        ))}
      </div>

      {tab === "offers" ? (
        <>
          {loading && !offers.length ? <div className="skeleton-grid" /> : null}
          {!loading && !filteredOffers.length ? (
            <p className="hint">
              {chain !== "all" && chain !== "continente" && chain !== "pingo_doce"
                ? `I prezzi prodotto di ${CHAIN_LABEL[chain]} arrivano dal volantino. Apri la scheda Volantini.`
                : "Nessuna offerta con questi filtri."}
            </p>
          ) : null}
          <div className="offer-grid">
            {shownOffers.map((p) => (
              <article key={`${p.chain}-${p.id}`} className="offer">
                {p.imageUrl ? <img src={p.imageUrl} alt="" /> : <div className="ph" />}
                <span className="chain" style={{ background: CHAIN_TONE[p.chain] }}>
                  {CHAIN_LABEL[p.chain]}
                </span>
                <h3>{p.name}</h3>
                {p.brand ? <p className="brand">{p.brand}</p> : null}
                <p className="price">
                  <strong>{euro(p.price)}</strong>
                  {p.originalPrice ? <s>{euro(p.originalPrice)}</s> : null}
                </p>
                <button type="button" onClick={() => onAdd(p.name)}>
                  Aggiungi alla lista
                </button>
              </article>
            ))}
          </div>
          {shownOffers.length < filteredOffers.length ? (
            <button
              type="button"
              className="more"
              onClick={() => setVisible((n) => n + 48)}
            >
              Mostra altri ({filteredOffers.length - shownOffers.length} rimanenti)
            </button>
          ) : null}
          {!loading && filteredOffers.length ? (
            <p className="hint">
              Prezzi dai cataloghi online di Continente e Pingo Doce. Lidl, Aldi,
              Auchan e Intermarché si sfogliano dai volantini.
            </p>
          ) : null}
        </>
      ) : (
        <>
          {loading && !flyers.length ? <div className="skeleton-grid" /> : null}
          {!loading && !filteredFlyers.length ? (
            <p className="hint">Nessun volantino per questi filtri.</p>
          ) : null}
          <div className="flyer-grid">
            {filteredFlyers.map((f) => (
              <a
                key={f.id}
                className="flyer"
                href={f.url}
                target="_blank"
                rel="noreferrer"
              >
                {f.imageUrl ? <img src={f.imageUrl} alt="" /> : <div className="ph" />}
                <span className="chain" style={{ background: CHAIN_TONE[f.chain] }}>
                  {CHAIN_LABEL[f.chain]}
                </span>
                <h3>{f.title}</h3>
                {f.period ? <p className="brand">{f.period}</p> : null}
                <em>Sfoglia volantino</em>
              </a>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function SplitView({
  split,
  onBack,
  onReset,
}: {
  split: OptimizeResponse;
  onBack: () => void;
  onReset: () => void;
}) {
  const storeCount = split.groups.length;
  const headline = useMemo(() => {
    if (!storeCount) return "Nessun match sui cataloghi vicini.";
    return `Fai la spesa in ${storeCount} supermercat${storeCount === 1 ? "o" : "i"}`;
  }, [storeCount]);

  return (
    <section className="split">
      <div className="split-head">
        <div>
          <p className="kicker">Lista chiusa</p>
          <h2>{headline}</h2>
        </div>
        <div className="split-actions">
          <button className="ghost" onClick={onBack}>
            Modifica lista
          </button>
          <button className="ghost" onClick={onReset}>
            Nuova lista
          </button>
        </div>
      </div>
      <div className="totals">
        <div>
          <p>Totale spezzato</p>
          <strong>{euro(split.totals.split)}</strong>
        </div>
        {split.totals.oneStore ? (
          <div>
            <p>Tutto da {split.totals.oneStore.chainLabel}</p>
            <strong>{euro(split.totals.oneStore.total)}</strong>
            {split.totals.oneStore.missing ? (
              <em>mancano {split.totals.oneStore.missing} prodotti</em>
            ) : null}
          </div>
        ) : null}
        {split.totals.savings > 0 ? (
          <div className="save">
            <p>Risparmio stimato</p>
            <strong>{euro(split.totals.savings)}</strong>
          </div>
        ) : null}
      </div>
      <div className="groups">
        {split.groups.map((g) => (
          <article key={g.chain} className="group">
            <header>
              <span className="dot" style={{ background: CHAIN_TONE[g.chain] }} />
              <div>
                <h3>Questi li prendi da {g.chainLabel}</h3>
                <a href={storeMapsLink(g.store)} target="_blank" rel="noreferrer">
                  {g.store.name} · {g.store.distanceKm.toFixed(1)} km ·{" "}
                  {g.store.address}
                </a>
              </div>
              <strong>{euro(g.subtotal)}</strong>
            </header>
            <ul>
              {g.items.map((it) => (
                <li key={it.query}>
                  {it.product?.imageUrl ? (
                    <img src={it.product.imageUrl} alt="" />
                  ) : (
                    <div className="ph sm" />
                  )}
                  <div>
                    <p>
                      {it.qty}× {it.product?.name ?? it.query}
                    </p>
                    <span>
                      {it.product?.brand ? `${it.product.brand} · ` : ""}
                      cercavi “{it.query}”
                    </span>
                  </div>
                  <b>{euro(it.lineTotal)}</b>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
      {split.unmatched.length ? (
        <div className="unmatched">
          <h3>Non trovati con certezza</h3>
          <ul>
            {split.unmatched.map((u) => (
              <li key={u.query}>
                {u.qty}× {u.query}
                <span>{u.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="disclaimer">
        Prezzi prodotto dai cataloghi online di Continente e Pingo Doce; Lidl,
        Aldi, Auchan e Intermarché si consultano dai volantini. In negozio i
        prezzi possono differire.
      </p>
    </section>
  );
}
