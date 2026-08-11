-- Realtime 対象テーブルの登録。
--
-- PWA は取り込みジョブ（import_jobs）の変更を購読し、success/partial になったら
-- ライブラリを再プルする。既定では新規テーブルが supabase_realtime publication に
-- 含まれないため、明示的に追加する。RLS が購読にも適用され、自分のジョブのみ届く。

alter publication supabase_realtime add table import_jobs;
