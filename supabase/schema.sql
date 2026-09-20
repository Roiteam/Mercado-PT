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
