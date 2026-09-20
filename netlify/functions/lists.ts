import type { Config, Context } from "@netlify/functions";
import { errorJson, jsonPrivate } from "./_shared/http.ts";
import {
  createShoppingList,
  deleteShoppingList,
  listShoppingLists,
  updateShoppingList,
} from "./_shared/lists.ts";
import type { ListItem, OptimizeResponse } from "./_shared/types.ts";

const HOUSEHOLD = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function householdId(req: Request) {
  const raw = req.headers.get("x-household-id")?.trim() ?? "";
  if (!HOUSEHOLD.test(raw)) return null;
  return raw.toLowerCase();
}

type Body = {
  title?: string;
  postalCode?: string;
  items?: ListItem[];
  status?: "open" | "done";
  split?: OptimizeResponse | null;
};

export default async (req: Request, context: Context) => {
  const household = householdId(req);
  if (!household) return errorJson("Identificação da casa em falta.", 401);
  const id = context.params.id;

  try {
    if (req.method === "GET" && !id) {
      return jsonPrivate({ lists: await listShoppingLists(household) });
    }
    if (req.method === "POST" && !id) {
      const body = await readBody(req);
      const list = await createShoppingList({
        householdId: household,
        title: body.title,
        postalCode: body.postalCode,
        items: body.items,
      });
      return jsonPrivate({ list }, 201);
    }
    if (!id) return errorJson("Lista em falta.", 400);
    if (req.method === "PATCH" || req.method === "PUT") {
      const body = await readBody(req);
      const list = await updateShoppingList(household, id, body);
      return jsonPrivate({ list });
    }
    if (req.method === "DELETE") {
      await deleteShoppingList(household, id);
      return jsonPrivate({ ok: true });
    }
    return errorJson("Method not allowed", 405);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro nas listas de compras.";
    const missingTable =
      /schema cache|does not exist|Could not find the table/i.test(message);
    return errorJson(
      missingTable
        ? "Falta criar a tabela no Supabase. Corre o SQL em supabase/schema.sql."
        : message,
      missingTable ? 503 : 502,
    );
  }
};

async function readBody(req: Request): Promise<Body> {
  try {
    return (await req.json()) as Body;
  } catch {
    return {};
  }
}

export const config: Config = {
  path: ["/api/lists", "/api/lists/:id"],
};
