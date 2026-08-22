-- 冷蔵庫（使い切りリスト）。docs/pantry.md
--
-- 数量は持たず「ある / ない」だけを持つ。厳密な在庫管理は Spec §2.2 の非スコープであり、
-- ズレたときに献立の加点が少し変わるだけで済む置き方にしている。
--
-- 主キーに食材 ID をそのまま使うのが要点。「同じ食材は 1 行」という制約と一致し、
-- 二人が同じ食材を同時にチェックしても id が一致するので upsert が衝突しない
-- （別 id + unique 制約にすると、片方の送信が unique 違反で永久に失敗する）。
create table if not exists pantry_items (
  id uuid primary key references ingredients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
create index if not exists pantry_items_user_idx on pantry_items (user_id);

comment on table pantry_items is '家にある食材（数量は持たない）。id は ingredients.id と同じ値';

alter table pantry_items enable row level security;
create policy pantry_items_owner on pantry_items
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 既存の grant は「その時点のテーブル」に対するものなので、新しいテーブルには明示付与する
-- （症状: 42501 permission denied for table）。行レベルの認可は RLS が担う。
grant select, insert, update, delete on pantry_items to authenticated;
grant all on pantry_items to service_role;

-- 相手の端末で入れた/使い切ったものが手元にも届くようにする。
alter publication supabase_realtime add table pantry_items;
