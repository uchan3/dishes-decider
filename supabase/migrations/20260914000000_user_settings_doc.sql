-- 設定の端末間同期（A-2）。
--
-- 曜日ごとの献立テンプレ・世帯人数・クールダウン・調理時間上限は Dexie にしか無く、
-- 二人が別々の設定で週を生成していた（ブラウザのデータを消すと設定も消えた）。
--
-- 保存方式は献立ドキュメント（meal_plans.doc）と同じ考え方にする。**サーバーが設定の
-- 中身を読む場面が無い**ため、既存の型付き列に展開せず、クライアントが持っている形の
-- まま 1 ユーザー 1 行の jsonb に入れる。曜日テンプレのように既存列に無い項目も
-- そのまま乗るし、競合解決も doc 内の updatedAt による Last-Write-Wins に収まる。
--
-- 既存の household_size / cooldown_days などの列はそのまま残す（サーバー側で設定を
-- 読む必要が出たときの受け皿。現時点では未使用）。

alter table user_settings add column if not exists doc jsonb;
comment on column user_settings.doc is
  'クライアントの設定ドキュメント（曜日テンプレ・生成設定）。真の更新時刻は doc->>''updatedAt''';

-- 相手の端末での設定変更を受け取るために購読対象へ追加する。
-- RLS が購読にも効くので、自分の行だけが届く。
alter publication supabase_realtime add table user_settings;
