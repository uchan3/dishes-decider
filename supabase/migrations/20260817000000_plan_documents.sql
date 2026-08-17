-- 献立・買い物リストの端末間同期（US-14）。
--
-- 献立生成も買い物リストの集約もクライアント側で完結しており、サーバーが中身を
-- 読む場面が無い。そのため正規化した meals / plan_slots / shopping_items に展開せず、
-- **クライアントが持っている入れ子ドキュメントをそのまま 1 行に保存する**。
-- 同期は 1 週あたり 1 行の upsert で済み、競合解決も doc 内の updated_at による
-- Last-Write-Wins に素直に収まる（世帯 2 人では実質競合しない）。
--
-- 既存の meals / plan_slots / shopping_items テーブルはそのまま残す（将来サーバー側で
-- 献立を扱う必要が出たときの受け皿。現時点では未使用）。

alter table meal_plans add column if not exists doc jsonb;
comment on column meal_plans.doc is
  'クライアントの週間献立ドキュメント（meals[].slots[] を含む）。真の更新時刻は doc->>''updated_at''';

alter table shopping_lists add column if not exists doc jsonb;
comment on column shopping_lists.doc is
  'クライアントの買い物リスト（shopping_items 相当の配列）。真の更新時刻は doc->>''updated_at''';

-- 1 献立につき買い物リストは 1 つ。upsert の衝突キーにする。
create unique index if not exists shopping_lists_plan_uniq on shopping_lists (meal_plan_id);

-- 相手の端末での変更（買い物中のチェックなど）を受け取るために購読対象へ追加する。
-- RLS が購読にも効くので、自分の行だけが届く。
alter publication supabase_realtime add table meal_plans;
alter publication supabase_realtime add table shopping_lists;
