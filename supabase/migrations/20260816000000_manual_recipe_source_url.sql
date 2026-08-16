-- 手動登録レシピ（US-02）は原典 URL を持たないことがあるため、source_url を任意にする。
-- 取り込み経路（F-01-1）は従来どおり必ず URL を入れる。
alter table recipes alter column source_url drop not null;
