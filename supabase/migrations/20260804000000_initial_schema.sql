-- 週間献立プランナー 初期スキーマ（仕様書 §7 / architecture §3.2）。
--
-- 方針:
--   - 全テーブルで RLS。基本は user_id = auth.uid()。子テーブルは親経由で判定。
--   - ingest トークンはハッシュのみ保存（生トークンは保存しない）。
--   - 手順の原文は保存しない（recipes.step_summaries は要約のみ）。

-- 更新時刻の自動更新トリガ関数。
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- ユーザー設定
-- ============================================================
create table user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  household_size int not null default 2,
  week_start_day int not null default 1,          -- 1=Monday
  cooldown_days int not null default 14,
  weekday_max_cook_min int,
  weekend_max_cook_min int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger user_settings_updated_at before update on user_settings
  for each row execute function set_updated_at();

-- ============================================================
-- 収集元
-- ============================================================
create table sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  kind text not null,                             -- 'youtube'|'instagram'|'web'|'manual'
  identifier text not null,
  icon_url text,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, kind, identifier)
);
create index sources_user_idx on sources (user_id);

-- ============================================================
-- 正規化食材マスタ
-- ============================================================
create table ingredients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,  -- null = システム共通
  canonical_name text not null,
  kana text,
  aliases text[] not null default '{}',
  category text not null,
  default_unit text,
  is_pantry_staple boolean not null default false,
  sort_order int not null default 0
);
create index ingredients_user_idx on ingredients (user_id);
create index ingredients_aliases_idx on ingredients using gin (aliases);

-- ============================================================
-- レシピ（手順原文は保持しない。要約のみ）
-- ============================================================
create table recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_id uuid references sources(id) on delete set null,
  title text not null,
  source_url text not null,
  thumbnail_url text,
  step_summaries jsonb not null default '[]',     -- [{position, summary, similarity_score}]
  extraction_status text not null default 'pending', -- 'pending'|'success'|'partial'|'failed'
  extracted_by text,                              -- 'jsonld'|'llm_text'|'llm_caption'|'llm_ocr'|'manual'
  extracted_at timestamptz,
  embed_type text,                                -- 'youtube'|'tiktok'|'instagram'|null
  embed_id text,
  embed_available boolean not null default false,
  dish_roles text[] not null default '{}',
  cook_time_min int,
  servings int not null default 2,
  main_ingredient_category text,
  cooking_method text,                            -- 'fry'|'simmer'|'grill'|'steam'|'raw'
  tags text[] not null default '{}',
  is_favorite boolean not null default false,
  is_excluded boolean not null default false,
  cook_count int not null default 0,
  last_cooked_at date,
  reject_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index recipes_user_source_idx on recipes (user_id, source_id);
create index recipes_dish_roles_idx on recipes using gin (dish_roles);
create trigger recipes_updated_at before update on recipes
  for each row execute function set_updated_at();

-- ============================================================
-- レシピ材料
-- ============================================================
create table recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  ingredient_id uuid references ingredients(id) on delete set null,
  raw_text text not null,
  display_name text not null,
  quantity numeric,
  unit text,
  is_ambiguous boolean not null default false,
  position int not null default 0
);
create index recipe_ingredients_recipe_idx on recipe_ingredients (recipe_id);

-- ============================================================
-- 献立テンプレート
-- ============================================================
create table meal_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,  -- null = プリセット
  name text not null,
  slots text[] not null
);
create index meal_templates_user_idx on meal_templates (user_id);

-- ============================================================
-- 週間献立 / 1食 / スロット
-- ============================================================
create table meal_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  start_date date not null,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, start_date)
);
create trigger meal_plans_updated_at before update on meal_plans
  for each row execute function set_updated_at();

create table meals (
  id uuid primary key default gen_random_uuid(),
  meal_plan_id uuid not null references meal_plans(id) on delete cascade,
  date date not null,
  meal_type text not null default 'dinner',
  template_id uuid references meal_templates(id) on delete set null,
  is_skipped boolean not null default false,
  note text,
  unique (meal_plan_id, date, meal_type)
);
create index meals_plan_idx on meals (meal_plan_id);

create table plan_slots (
  id uuid primary key default gen_random_uuid(),
  meal_id uuid not null references meals(id) on delete cascade,
  dish_role text not null,
  recipe_id uuid references recipes(id) on delete set null,
  is_locked boolean not null default false,
  position int not null default 0
);
create index plan_slots_meal_idx on plan_slots (meal_id);

-- ============================================================
-- 買い物リスト
-- ============================================================
create table shopping_lists (
  id uuid primary key default gen_random_uuid(),
  meal_plan_id uuid not null references meal_plans(id) on delete cascade,
  generated_at timestamptz not null default now()
);
create index shopping_lists_plan_idx on shopping_lists (meal_plan_id);

create table shopping_items (
  id uuid primary key default gen_random_uuid(),
  shopping_list_id uuid not null references shopping_lists(id) on delete cascade,
  ingredient_id uuid references ingredients(id) on delete set null,
  display_name text not null,
  quantity numeric,
  unit text,
  ambiguous_note text,
  category text not null,
  is_checked boolean not null default false,
  is_manual boolean not null default false,
  source_recipe_ids uuid[] not null default '{}',
  position int not null default 0
);
create index shopping_items_list_idx on shopping_items (shopping_list_id);

-- ============================================================
-- 取り込みジョブ / ingest トークン（architecture §3.1・§3.2）
-- ============================================================
create table import_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  url text not null,
  status text not null default 'pending',         -- 'pending'|'success'|'partial'|'failed'
  recipe_id uuid references recipes(id) on delete set null,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index import_jobs_user_idx on import_jobs (user_id);
create index import_jobs_status_idx on import_jobs (status, created_at);
create trigger import_jobs_updated_at before update on import_jobs
  for each row execute function set_updated_at();

create table ingest_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,                -- 生トークンは保存しない
  label text,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index ingest_tokens_user_idx on ingest_tokens (user_id);
