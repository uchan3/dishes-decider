-- Row Level Security（仕様書 §7）。
--
-- 基本: user_id = auth.uid()。子テーブル（recipe_ingredients / meals / plan_slots /
-- shopping_lists / shopping_items）は親を辿って所有者を判定する。
-- ingredients / meal_templates は「システム共通(user_id is null)は全員 SELECT 可、
-- 書き込みは自分の行のみ」とする。

-- ---- user_settings ----
alter table user_settings enable row level security;
create policy user_settings_owner on user_settings
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---- sources ----
alter table sources enable row level security;
create policy sources_owner on sources
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---- ingredients（共通マスタは読み取り可、書き込みは自分の行のみ） ----
alter table ingredients enable row level security;
create policy ingredients_select on ingredients
  for select using (user_id = auth.uid() or user_id is null);
create policy ingredients_insert on ingredients
  for insert with check (user_id = auth.uid());
create policy ingredients_update on ingredients
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy ingredients_delete on ingredients
  for delete using (user_id = auth.uid());

-- ---- recipes ----
alter table recipes enable row level security;
create policy recipes_owner on recipes
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---- recipe_ingredients（親 recipes 経由） ----
alter table recipe_ingredients enable row level security;
create policy recipe_ingredients_owner on recipe_ingredients
  using (exists (select 1 from recipes r where r.id = recipe_id and r.user_id = auth.uid()))
  with check (exists (select 1 from recipes r where r.id = recipe_id and r.user_id = auth.uid()));

-- ---- meal_templates（プリセットは読み取り可、書き込みは自分の行のみ） ----
alter table meal_templates enable row level security;
create policy meal_templates_select on meal_templates
  for select using (user_id = auth.uid() or user_id is null);
create policy meal_templates_insert on meal_templates
  for insert with check (user_id = auth.uid());
create policy meal_templates_update on meal_templates
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy meal_templates_delete on meal_templates
  for delete using (user_id = auth.uid());

-- ---- meal_plans ----
alter table meal_plans enable row level security;
create policy meal_plans_owner on meal_plans
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---- meals（親 meal_plans 経由） ----
alter table meals enable row level security;
create policy meals_owner on meals
  using (exists (select 1 from meal_plans p where p.id = meal_plan_id and p.user_id = auth.uid()))
  with check (exists (select 1 from meal_plans p where p.id = meal_plan_id and p.user_id = auth.uid()));

-- ---- plan_slots（親 meals→meal_plans 経由） ----
alter table plan_slots enable row level security;
create policy plan_slots_owner on plan_slots
  using (exists (
    select 1 from meals m join meal_plans p on p.id = m.meal_plan_id
    where m.id = meal_id and p.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from meals m join meal_plans p on p.id = m.meal_plan_id
    where m.id = meal_id and p.user_id = auth.uid()
  ));

-- ---- shopping_lists（親 meal_plans 経由） ----
alter table shopping_lists enable row level security;
create policy shopping_lists_owner on shopping_lists
  using (exists (select 1 from meal_plans p where p.id = meal_plan_id and p.user_id = auth.uid()))
  with check (exists (select 1 from meal_plans p where p.id = meal_plan_id and p.user_id = auth.uid()));

-- ---- shopping_items（親 shopping_lists→meal_plans 経由） ----
alter table shopping_items enable row level security;
create policy shopping_items_owner on shopping_items
  using (exists (
    select 1 from shopping_lists l join meal_plans p on p.id = l.meal_plan_id
    where l.id = shopping_list_id and p.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from shopping_lists l join meal_plans p on p.id = l.meal_plan_id
    where l.id = shopping_list_id and p.user_id = auth.uid()
  ));

-- ---- import_jobs（PWA が自分のジョブを購読するため SELECT を許可） ----
alter table import_jobs enable row level security;
create policy import_jobs_owner on import_jobs
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---- ingest_tokens（生トークンは返さない前提。行の管理は本人のみ） ----
alter table ingest_tokens enable row level security;
create policy ingest_tokens_owner on ingest_tokens
  using (user_id = auth.uid()) with check (user_id = auth.uid());
