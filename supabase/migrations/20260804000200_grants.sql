-- ロール権限の明示付与。
--
-- Edge Function は service_role で ingest_tokens / import_jobs / recipes 等を
-- 横断参照する（ショートカットにはユーザーセッションが無く、トークンから user_id を
-- 解決するため）。マイグレーションで作成したテーブルは、db push の適用ロール次第で
-- Supabase の default privileges が効かず service_role に権限が付かないことがある
-- （症状: 42501 permission denied for table）。そこで明示的に付与する。
--
-- 行レベルの認可は RLS が担うため、anon/authenticated にテーブル権限を与えても
-- 他人の行は見えない（RLS がフィルタする）。

grant usage on schema public to anon, authenticated, service_role;

-- service_role: RLS を貫通してテーブル横断アクセス（Edge Function 用）。
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- anon / authenticated: RLS 下でのアクセス（PWA 用）。
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

-- 今後追加されるテーブル/シーケンスにも既定で同様に付与する。
alter default privileges in schema public
  grant all on tables to service_role;
alter default privileges in schema public
  grant all on sequences to service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated;
