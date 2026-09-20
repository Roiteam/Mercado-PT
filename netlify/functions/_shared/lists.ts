import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { env } from "./env.ts";
import type { ListItem, OptimizeResponse } from "./types.ts";

export type ShoppingListRecord = {
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

type Row = {
  id: string;
  household_id: string;
  title: string;
  status: "open" | "done";
  postal_code: string | null;
  items: ListItem[] | string;
  split: OptimizeResponse | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

const SCHEMA = `
create table if not exists shopping_lists (
  id uuid primary key,
  household_id text not null,
  title text not null default 'Lista de compras',
  status text not null default 'open',
  postal_code text,
  items jsonb not null default '[]'::jsonb,
  split jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists shopping_lists_household_idx
  on shopping_lists (household_id, status, updated_at desc);
`;

let ready = false;
let sb: SupabaseClient | null = null;
let sql: ReturnType<typeof postgres> | null = null;

function supabaseUrl() {
  const value = env("SUPABASE_URL") || env("SUPABASE_DATABASE_URL");
  return value.startsWith("http") ? value.replace(/\/$/, "") : "";
}

function supabaseKey() {
  return (
    env("SUPABASE_SERVICE_ROLE_KEY") ||
    env("SUPABASE_SECRET_KEY") ||
    env("SUPABASE_ANON_KEY")
  );
}

function postgresUrl() {
  const candidates = [
    env("NETLIFY_DB_URL"),
    env("DATABASE_URL"),
    env("SUPABASE_DB_URL"),
  ];
  const extra = env("SUPABASE_DATABASE_URL");
  if (extra.startsWith("postgres")) candidates.unshift(extra);
  return candidates.find((v) => v.startsWith("postgres")) ?? "";
}

async function connect() {
  if (!sb && supabaseUrl() && supabaseKey()) {
    sb = createClient(supabaseUrl(), supabaseKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  if (!sql && postgresUrl()) {
    sql = postgres(postgresUrl(), {
      max: 1,
      idle_timeout: 5,
      connect_timeout: 8,
    });
  }
  if (!sb && !sql) {
    throw new Error(
      "Supabase ainda não está disponível neste ambiente. Confirma a ligação no Netlify.",
    );
  }
  if (!ready) {
    if (sql) await sql.unsafe(SCHEMA);
    ready = true;
  }
}

function parseItems(raw: Row["items"]): ListItem[] {
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw || "[]")) as ListItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function fromRow(row: Row): ShoppingListRecord {
  return {
    id: row.id,
    householdId: row.household_id,
    title: row.title,
    status: row.status === "done" ? "done" : "open",
    postalCode: row.postal_code ?? undefined,
    items: parseItems(row.items),
    split: row.split ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export async function listShoppingLists(
  householdId: string,
): Promise<ShoppingListRecord[]> {
  await connect();
  if (sb) {
    const { data, error } = await sb
      .from("shopping_lists")
      .select("*")
      .eq("household_id", householdId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[]).map(fromRow);
  }
  const rows = await sql!`
    select * from shopping_lists
    where household_id = ${householdId}
    order by updated_at desc
  `;
  return (rows as unknown as Row[]).map(fromRow);
}

export async function createShoppingList(input: {
  householdId: string;
  title?: string;
  postalCode?: string;
  items?: ListItem[];
}): Promise<ShoppingListRecord> {
  await connect();
  const now = new Date().toISOString();
  const row = {
    id: crypto.randomUUID(),
    household_id: input.householdId,
    title: input.title?.trim() || defaultTitle(),
    status: "open" as const,
    postal_code: input.postalCode ?? null,
    items: input.items ?? [],
    split: null,
    created_at: now,
    updated_at: now,
    completed_at: null,
  };
  if (sb) {
    const { data, error } = await sb.from("shopping_lists").insert(row).select("*").single();
    if (error) throw new Error(error.message);
    return fromRow(data as Row);
  }
  const inserted = await sql!`
    insert into shopping_lists (
      id, household_id, title, status, postal_code, items, split, created_at, updated_at, completed_at
    ) values (
      ${row.id}, ${row.household_id}, ${row.title}, ${row.status}, ${row.postal_code},
      ${sql!.json(row.items)}, ${null}, ${row.created_at}, ${row.updated_at}, ${row.completed_at}
    )
    returning *
  `;
  return fromRow(inserted[0] as Row);
}

export async function getShoppingList(
  householdId: string,
  id: string,
): Promise<ShoppingListRecord | null> {
  await connect();
  if (sb) {
    const { data, error } = await sb
      .from("shopping_lists")
      .select("*")
      .eq("id", id)
      .eq("household_id", householdId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? fromRow(data as Row) : null;
  }
  const rows = await sql!`
    select * from shopping_lists
    where id = ${id} and household_id = ${householdId}
    limit 1
  `;
  return rows[0] ? fromRow(rows[0] as Row) : null;
}

export async function updateShoppingList(
  householdId: string,
  id: string,
  patch: {
    title?: string;
    items?: ListItem[];
    postalCode?: string;
    status?: "open" | "done";
    split?: OptimizeResponse | null;
  },
): Promise<ShoppingListRecord> {
  const current = await getShoppingList(householdId, id);
  if (!current) throw new Error("Lista não encontrada.");
  const now = new Date().toISOString();
  const next: Row = {
    id: current.id,
    household_id: current.householdId,
    title: patch.title !== undefined ? patch.title.trim() || current.title : current.title,
    status: patch.status ?? current.status,
    postal_code:
      patch.postalCode !== undefined ? patch.postalCode : current.postalCode ?? null,
    items: patch.items ?? current.items,
    split: patch.split !== undefined ? patch.split : current.split ?? null,
    created_at: current.createdAt,
    updated_at: now,
    completed_at:
      patch.status === "done"
        ? now
        : patch.status === "open"
          ? null
          : current.completedAt ?? null,
  };
  await connect();
  if (sb) {
    const { data, error } = await sb
      .from("shopping_lists")
      .update({
        title: next.title,
        status: next.status,
        postal_code: next.postal_code,
        items: next.items,
        split: next.split,
        updated_at: next.updated_at,
        completed_at: next.completed_at,
      })
      .eq("id", id)
      .eq("household_id", householdId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return fromRow(data as Row);
  }
  const rows = await sql!`
    update shopping_lists
    set
      title = ${next.title},
      status = ${next.status},
      postal_code = ${next.postal_code},
      items = ${sql!.json(next.items)},
      split = ${next.split ? sql!.json(next.split) : null},
      updated_at = ${next.updated_at},
      completed_at = ${next.completed_at}
    where id = ${id} and household_id = ${householdId}
    returning *
  `;
  if (!rows[0]) throw new Error("Lista não encontrada.");
  return fromRow(rows[0] as Row);
}

export async function deleteShoppingList(householdId: string, id: string) {
  await connect();
  if (sb) {
    const { error } = await sb
      .from("shopping_lists")
      .delete()
      .eq("id", id)
      .eq("household_id", householdId);
    if (error) throw new Error(error.message);
    return;
  }
  await sql!`
    delete from shopping_lists
    where id = ${id} and household_id = ${householdId}
  `;
}

function defaultTitle() {
  return `Lista de ${new Date().toLocaleDateString("pt-PT", {
    day: "numeric",
    month: "short",
  })}`;
}
