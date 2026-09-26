import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  createRemoteList,
  deleteRemoteList,
  fetchLists,
  getOffers,
  getStores,
  optimizeList,
  patchRemoteList,
} from "./api";
import {
  CHAIN_LABEL,
  CHAIN_TONE,
  euro,
  formatDate,
  joinPt,
  loadHouseholdId,
  loadList,
  loadPostal,
  loadRadius,
  saveList,
  savePostal,
  saveRadius,
  storeMapsLink,
  uid,
} from "./format";
import { BarcodeScan } from "./BarcodeScan";
import type {
  ChainId,
  Flyer,
  ListItem,
  OffersResponse,
  OptimizeResponse,
  ShoppingList,
  Store,
  StoresResponse,
} from "./types";

const DEMO = [
  { cap: "1000-001", city: "Lisboa" },
  { cap: "4000-001", city: "Porto" },
  { cap: "8000-001", city: "Faro" },
];

export default function App() {
  const householdId = useMemo(() => loadHouseholdId(), []);
  const [postal, setPostal] = useState("");
  const [draftCap, setDraftCap] = useState("");
  const [radiusKm, setRadiusKm] = useState(6);
  const [storesData, setStoresData] = useState<StoresResponse | null>(null);
  const [offers, setOffers] = useState<OffersResponse | null>(null);
  const [list, setList] = useState<ListItem[]>([]);
  const [listTitle, setListTitle] = useState("Lista de compras");
  const [remoteListId, setRemoteListId] = useState("");
  const [archives, setArchives] = useState<ShoppingList[]>([]);
  const [view, setView] = useState<"ofertas" | "listas">("ofertas");
  const [draftItem, setDraftItem] = useState("");
  const [loading, setLoading] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [error, setError] = useState("");
  const [split, setSplit] = useState<OptimizeResponse | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [pendingAdd, setPendingAdd] = useState<{ name: string; qty: number } | null>(null);
  const [listFlash, setListFlash] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [syncNote, setSyncNote] = useState("");
  const hydrated = useRef(false);
  const dirtyList = useRef(false);
  const saveTimer = useRef<number>(0);
  const itemInputRef = useRef<HTMLInputElement>(null);
  const flashTimer = useRef<number>(0);
  const flashRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const saved = loadPostal();
    const savedList = loadList<ListItem[]>([]);
    const savedRadius = loadRadius();
    setList(savedList);
    setRadiusKm(savedRadius);
    void hydrateLists(savedList, saved);
    if (saved) {
      setPostal(saved);
      setDraftCap(saved);
      void boot(saved, savedRadius);
    }
  }, []);

  useEffect(() => {
    saveList(list);
    if (!hydrated.current || !remoteListId) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void patchRemoteList(householdId, remoteListId, {
        items: list,
        title: listTitle,
        postalCode: postal || undefined,
      }).catch(() => setSyncNote("A lista fica neste telemóvel até o Supabase responder."));
    }, 500);
    return () => window.clearTimeout(saveTimer.current);
  }, [list, listTitle, postal, remoteListId, householdId]);

  useEffect(() => {
    if (!listOpen && !scanning && !pendingAdd) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (scanning) setScanning(false);
      else if (pendingAdd) setPendingAdd(null);
      else setListOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listOpen, scanning, pendingAdd]);

  async function hydrateLists(localItems: ListItem[], cap: string) {
    try {
      const { lists } = await fetchLists(householdId);
      const open = lists.find((l) => l.status === "open");
      setArchives(lists.filter((l) => l.status === "done"));
      if (open) {
        setRemoteListId(open.id);
        setListTitle(open.title);
        if (!dirtyList.current) setList(open.items.length ? open.items : localItems);
      } else {
        const created = await createRemoteList(householdId, {
          postalCode: cap || undefined,
          items: localItems,
        });
        setRemoteListId(created.list.id);
        setListTitle(created.list.title);
        if (!dirtyList.current) setList(created.list.items);
      }
      setSyncNote("");
    } catch {
      setSyncNote("A lista fica gravada neste telemóvel. O histórico aparece quando o Supabase ligar.");
    } finally {
      hydrated.current = true;
    }
  }

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
      setError(err instanceof Error ? err.message : "Algo correu mal.");
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

  function showFlash(kind: "ok" | "err", text: string, ms = kind === "err" ? 6000 : 3200) {
    window.clearTimeout(flashTimer.current);
    flushSync(() => setListFlash({ kind, text }));
    flashTimer.current = window.setTimeout(() => setListFlash(null), ms);
  }

  function addItem(raw: string, amount = 1) {
    const query = raw.trim();
    const n = Math.max(1, Math.floor(Number(amount) || 1));
    if (query.length < 2) {
      showFlash("err", "Erro");
      return false;
    }
    dirtyList.current = true;
    setList((prev) => {
      const existing = prev.find(
        (it) => it.query.toLowerCase() === query.toLowerCase(),
      );
      if (existing) {
        return prev.map((it) =>
          it.id === existing.id ? { ...it, qty: it.qty + n } : it,
        );
      }
      return [...prev, { id: uid(), query, qty: n }];
    });
    setDraftItem("");
    setPendingAdd(null);
    setSplit(null);
    showFlash("ok", "Adicionado");
    return true;
  }

  function askQty(raw: string) {
    const name = raw.trim();
    if (name.length < 2) {
      showFlash("err", "Erro");
      return;
    }
    setPendingAdd({ name, qty: 1 });
  }

  function confirmPending() {
    if (!pendingAdd) return;
    addItem(pendingAdd.name, pendingAdd.qty);
  }

  async function comparePrices() {
    if (!postal || !list.length) return;
    setOptimizing(true);
    setError("");
    try {
      const result = await optimizeList(postal, radiusKm, list);
      setSplit(result);
      setListOpen(false);
      setView("ofertas");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível comparar os preços.");
    } finally {
      setOptimizing(false);
    }
  }

  async function finishShopping(withSplit?: OptimizeResponse | null) {
    if (!remoteListId) {
      setList([]);
      setSplit(null);
      return;
    }
    try {
      const done = await patchRemoteList(householdId, remoteListId, {
        items: list,
        title: listTitle,
        postalCode: postal || undefined,
        status: "done",
        split: withSplit ?? split,
      });
      setArchives((prev) => [done.list, ...prev.filter((l) => l.id !== done.list.id)]);
      const created = await createRemoteList(householdId, { postalCode: postal || undefined });
      setRemoteListId(created.list.id);
      setListTitle(created.list.title);
      setList([]);
      setSplit(null);
      setListOpen(false);
      setView("listas");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível guardar a lista.");
    }
  }

  async function removeArchive(id: string) {
    try {
      await deleteRemoteList(householdId, id);
    } catch {
      /* still drop locally */
    }
    setArchives((prev) => prev.filter((l) => l.id !== id));
  }

  function reuseArchive(done: ShoppingList) {
    setList((prev) => {
      const next = [...prev];
      for (const item of done.items) {
        const existing = next.find(
          (it) => it.query.toLowerCase() === item.query.toLowerCase(),
        );
        if (existing) existing.qty += item.qty;
        else next.push({ id: uid(), query: item.query, qty: item.qty });
      }
      return next;
    });
    setListOpen(true);
    setView("ofertas");
  }

  const pricedNearby = storesData?.pricedChains ?? [];
  const storeCount = storesData?.stores.length ?? 0;
  const qty = list.reduce((n, it) => n + it.qty, 0);

  return (
    <div className="page">
      <header className="top">
        <div>
          <p className="kicker">Portugal · preços reais dos catálogos</p>
          <h1>Mercado.pt</h1>
        </div>
        {postal ? (
          <div className="top-actions">
            <nav className="app-nav">
              <button
                type="button"
                className={view === "ofertas" ? "on" : ""}
                onClick={() => setView("ofertas")}
              >
                Ofertas
              </button>
              <button
                type="button"
                className={view === "listas" ? "on" : ""}
                onClick={() => setView("listas")}
              >
                Listas
              </button>
            </nav>
            <button
              className="ghost"
              onClick={() => {
                setPostal("");
                savePostal("");
                setStoresData(null);
                setOffers(null);
                setSplit(null);
                setListOpen(false);
                setView("ofertas");
              }}
            >
              Mudar código postal
            </button>
          </div>
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
            {syncNote ? <p className="hint">{syncNote}</p> : null}

            {view === "listas" ? (
              <ListsBoard
                currentTitle={listTitle}
                currentCount={qty}
                onOpenCurrent={() => setListOpen(true)}
                archives={archives}
                onReuse={reuseArchive}
                onDelete={removeArchive}
              />
            ) : split ? (
              <SplitView
                split={split}
                onBack={() => setSplit(null)}
                onFinish={() => void finishShopping(split)}
              />
            ) : (
              <>
                <StoreStrip stores={storesData?.stores ?? []} loading={loading} />
                <DealsBoard
                  offers={offers?.offers ?? []}
                  flyers={offers?.flyers ?? []}
                  chains={[...new Set((storesData?.stores ?? []).map((s) => s.chain))]}
                  loading={loading}
                  onAdd={(name) => {
                    addItem(name);
                  }}
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
            Lista de compras
            <span className="list-fab-count">{qty}</span>
          </button>

          {listOpen ? (
            <div className="list-layer">
              <button
                type="button"
                className="list-backdrop"
                aria-label="Fechar lista"
                onClick={() => setListOpen(false)}
              />
              <aside className="list-panel" role="dialog" aria-label="Lista de compras">
                <div className="list-panel-head">
                  <h2>Lista de compras</h2>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setListOpen(false)}
                  >
                    Fechar
                  </button>
                </div>
                <input
                  className="list-title"
                  value={listTitle}
                  onChange={(e) => setListTitle(e.target.value)}
                  placeholder="Nome da lista"
                />
                <p className="hint">
                  Podes ir acrescentando produtos ao longo dos dias, a escrever ou a
                  apontar a câmara para o código de barras. Quando fores às compras,
                  comparamos os preços nos supermercados perto de ti
                  {pricedNearby.length
                    ? ` (preços online: ${joinPt(
                        pricedNearby.map((c) => CHAIN_LABEL[c]),
                      )}). Sem catálogo público, os preços ficam no folheto.`
                    : "."}
                </p>
                {pendingAdd ? (
                  <div className="qty-ask">
                    <p className="qty-ask-name">{pendingAdd.name}</p>
                    <p className="hint">Quantas unidades?</p>
                    <div className="qty">
                      <button
                        type="button"
                        onClick={() =>
                          setPendingAdd((prev) =>
                            prev ? { ...prev, qty: Math.max(1, prev.qty - 1) } : prev,
                          )
                        }
                      >
                        −
                      </button>
                      <strong>{pendingAdd.qty}</strong>
                      <button
                        type="button"
                        onClick={() =>
                          setPendingAdd((prev) =>
                            prev ? { ...prev, qty: prev.qty + 1 } : prev,
                          )
                        }
                      >
                        +
                      </button>
                    </div>
                    <div className="add-row-actions">
                      <button type="button" className="ghost" onClick={() => setPendingAdd(null)}>
                        Cancelar
                      </button>
                      <button type="button" className="primary" onClick={confirmPending}>
                        Adicionar
                      </button>
                    </div>
                  </div>
                ) : (
                  <form
                    className="add-row"
                    onSubmit={(e) => {
                      e.preventDefault();
                      askQty(draftItem);
                    }}
                  >
                    <input
                      ref={itemInputRef}
                      autoFocus
                      value={draftItem}
                      onChange={(e) => setDraftItem(e.target.value)}
                      placeholder="ex. leite, pão, azeite..."
                    />
                    <div className="add-row-actions">
                      <button
                        type="button"
                        className="scan"
                        onClick={() => {
                          setListFlash(null);
                          setScanning(true);
                        }}
                      >
                        Código de barras
                      </button>
                      <button type="button" onClick={() => askQty(draftItem)}>
                        Adicionar
                      </button>
                    </div>
                  </form>
                )}
                <p
                  ref={flashRef}
                  className={`list-note${listFlash ? ` ${listFlash.kind}` : ""}`}
                  role="status"
                  aria-live="assertive"
                >
                  {listFlash?.text ?? ""}
                </p>
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
                  <p className="empty">
                    A lista está vazia. Escreve um produto ou lê o código de barras.
                  </p>
                ) : null}
                <button
                  className="primary close-btn"
                  disabled={!list.length || optimizing}
                  onClick={() => void comparePrices()}
                >
                  {optimizing ? "A comparar preços…" : "Comparar preços por loja"}
                </button>
                <button
                  className="ghost close-btn"
                  disabled={!list.length}
                  onClick={() => void finishShopping()}
                >
                  Concluir compras e guardar
                </button>
              </aside>
            </div>
          ) : null}
          {scanning ? (
            <BarcodeScan
              onClose={() => setScanning(false)}
              onProduct={(name, amount) => addItem(name, amount)}
              onGiveUp={() => {
                setScanning(false);
                setListOpen(true);
                showFlash("err", "Erro. Escreve o produto à mão.", 6000);
                window.setTimeout(() => itemInputRef.current?.focus(), 50);
              }}
            />
          ) : null}
          {listFlash && !scanning && !listOpen ? (
            <p className={`list-flash ${listFlash.kind}`} role="status">
              {listFlash.text}
            </p>
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
      <h2>Onde fazes as compras?</h2>
      <p>
        Introduz o código postal português. Mostramos os supermercados no raio e as
        ofertas, depois partimos a lista onde fica mais barato.
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
          {loading ? "A procurar lojas…" : "Ver supermercados"}
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
          {loading ? "A atualizar as lojas…" : `${storeCount} supermercados no raio`}
        </p>
      </div>
      <label>
        Raio
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

function ListsBoard({
  currentTitle,
  currentCount,
  onOpenCurrent,
  archives,
  onReuse,
  onDelete,
}: {
  currentTitle: string;
  currentCount: number;
  onOpenCurrent: () => void;
  archives: ShoppingList[];
  onReuse: (list: ShoppingList) => void;
  onDelete: (id: string) => void;
}) {
  const [openId, setOpenId] = useState("");
  return (
    <section>
      <h2>Listas de compras</h2>
      <p className="hint">
        A lista atual guarda-se sozinha. Quando concluis as compras, passa para o
        histórico.
      </p>
      <article className="list-card current">
        <div>
          <p className="kicker">Em curso</p>
          <h3>{currentTitle}</h3>
          <p className="hint">
            {currentCount
              ? `${currentCount} artigo${currentCount === 1 ? "" : "s"} · podes ir acrescentando`
              : "Ainda vazia · adiciona produtos ao longo dos dias"}
          </p>
        </div>
        <button type="button" className="primary" onClick={onOpenCurrent}>
          Abrir lista
        </button>
      </article>
      <h3 className="archive-title">Compras feitas</h3>
      {!archives.length ? (
        <p className="empty">Ainda não há compras guardadas.</p>
      ) : (
        <div className="archive-grid">
          {archives.map((done) => {
            const count = done.items.reduce((n, it) => n + it.qty, 0);
            const expanded = openId === done.id;
            return (
              <article key={done.id} className="list-card">
                <button
                  type="button"
                  className="list-card-main"
                  onClick={() => setOpenId(expanded ? "" : done.id)}
                >
                  <h3>{done.title}</h3>
                  <p className="hint">
                    {formatDate(done.completedAt || done.updatedAt)} · {count} artigo
                    {count === 1 ? "" : "s"}
                    {done.split?.totals.split
                      ? ` · ${euro(done.split.totals.split)}`
                      : ""}
                  </p>
                </button>
                {expanded ? (
                  <div className="list-card-body">
                    <ul className="list">
                      {done.items.map((it) => (
                        <li key={it.id}>
                          <span>{it.query}</span>
                          <strong>{it.qty}×</strong>
                        </li>
                      ))}
                    </ul>
                    <div className="split-actions">
                      <button type="button" className="ghost" onClick={() => onReuse(done)}>
                        Voltar a usar
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => onDelete(done.id)}
                      >
                        Apagar
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function StoreStrip({ stores, loading }: { stores: Store[]; loading: boolean }) {
  if (loading && !stores.length) {
    return <div className="skeleton-row" />;
  }
  return (
    <section>
      <h2>Supermercados perto de ti</h2>
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
  const productChains = new Set(offers.map((p) => p.chain));
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
        <div>
          <h2>Ofertas e folhetos</h2>
          <p className="hint refresh-note">
            Produtos e folhetos atualizam no máximo 2 vezes por dia.
          </p>
        </div>
        <div className="tabs">
          <button
            type="button"
            className={tab === "offers" ? "tab on" : "tab"}
            onClick={() => setTab("offers")}
          >
            Produtos ({filteredOffers.length})
          </button>
          <button
            type="button"
            className={tab === "flyers" ? "tab on" : "tab"}
            onClick={() => setTab("flyers")}
          >
            Folhetos ({filteredFlyers.length})
          </button>
        </div>
      </div>

      <div className="filters">
        <input
          value={q}
          placeholder="Filtrar por nome…"
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
            Só com desconto
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
          Todos
        </button>
        {nearbyChains.map((id) => (
          <button
            key={id}
            type="button"
            className={chain === id ? "on" : ""}
            onClick={() => {
              setChain(id);
              setVisible(48);
              setTab(productChains.has(id) ? "offers" : "flyers");
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
              {chain !== "all" && !productChains.has(chain)
                ? `Os preços de ${CHAIN_LABEL[chain]} estão no folheto. Abre o separador Folhetos.`
                : "Nenhuma oferta com estes filtros."}
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
                  Adicionar à lista
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
              Mostrar mais ({filteredOffers.length - shownOffers.length} restantes)
            </button>
          ) : null}
          {!loading && filteredOffers.length ? (
            <p className="hint">
              {productChains.size
                ? `Preços dos catálogos online de ${joinPt(
                    [...productChains].map((id) => CHAIN_LABEL[id]),
                  )}. Sem catálogo público, consulta o folheto.`
                : "Sem catálogo público para estas cadeias: consulta o folheto."}
            </p>
          ) : null}
        </>
      ) : (
        <>
          {loading && !flyers.length ? <div className="skeleton-grid" /> : null}
          {!loading && !filteredFlyers.length ? (
            <p className="hint">Nenhum folheto com estes filtros.</p>
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
                <FlyerCover src={f.imageUrl} title={f.title} />
                <span className="chain" style={{ background: CHAIN_TONE[f.chain] }}>
                  {CHAIN_LABEL[f.chain]}
                </span>
                <h3>{f.title}</h3>
                {f.period ? <p className="brand">{f.period}</p> : null}
                <em>Ver folheto</em>
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
  onFinish,
}: {
  split: OptimizeResponse;
  onBack: () => void;
  onFinish: () => void;
}) {
  const storeCount = split.groups.length;
  const headline = useMemo(() => {
    if (!storeCount) return "Sem correspondência nos catálogos próximos.";
    return `Faz as compras em ${storeCount} supermercado${storeCount === 1 ? "" : "s"}`;
  }, [storeCount]);

  return (
    <section className="split">
      <div className="split-head">
        <div>
          <p className="kicker">Lista comparada</p>
          <h2>{headline}</h2>
        </div>
        <div className="split-actions">
          <button className="ghost" onClick={onBack}>
            Continuar a adicionar
          </button>
          <button className="primary" onClick={onFinish}>
            Concluir e guardar
          </button>
        </div>
      </div>
      <div className="totals">
        <div>
          <p>Total dividido</p>
          <strong>{euro(split.totals.split)}</strong>
        </div>
        {split.totals.oneStore ? (
          <div>
            <p>Tudo no {split.totals.oneStore.chainLabel}</p>
            <strong>{euro(split.totals.oneStore.total)}</strong>
            {split.totals.oneStore.missing ? (
              <em>faltam {split.totals.oneStore.missing} produtos</em>
            ) : null}
          </div>
        ) : null}
        {split.totals.savings > 0 ? (
          <div className="save">
            <p>Poupança estimada</p>
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
                <h3>Leva estes no {g.chainLabel}</h3>
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
                      procuravas “{it.query}”
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
          <h3>Não encontrados com certeza</h3>
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
        {split.pricedChains?.length
          ? `Comparamos preços online das cadeias próximas com catálogo: ${joinPt(
              split.pricedChains.map((c) => CHAIN_LABEL[c]),
            )}. `
          : "Comparamos os catálogos online das cadeias próximas. "}
        Sem catálogo público, os preços ficam no folheto. Em loja os preços podem ser diferentes.
      </p>
    </section>
  );
}

function FlyerCover({ src, title }: { src?: string; title: string }) {
  const [failed, setFailed] = useState(!src);
  if (!src || failed) return <div className="ph" aria-hidden="true" />;
  return (
    <img
      src={src}
      alt={title}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
