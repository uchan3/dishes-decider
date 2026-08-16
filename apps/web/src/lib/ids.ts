/**
 * ID の生成と判定。
 *
 * Supabase 側の主キーはすべて `uuid` 型なので、UUID でない ID（開発用シードの
 * `src-ryuji` など、ローカルにしか存在しない行）をそのままクエリに渡すと
 * Postgres が型エラーを返す。書き戻す前にこの関数で「同期対象の行か」を判定する。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** UUID 形式か（＝ Supabase にも存在しうる ID か）。 */
export const isUuid = (id: string): boolean => UUID_RE.test(id);

/** 新しい行の ID を作る。 */
export const newId = (): string => crypto.randomUUID();
