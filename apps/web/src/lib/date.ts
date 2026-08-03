/** 献立の週管理に使う軽量な日付ユーティリティ（UI 層。core には置かない）。 */

/** `YYYY-MM-DD` 形式に整形する。 */
export function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 今日を `YYYY-MM-DD` で返す。 */
export function today(): string {
  return formatDate(new Date());
}

/** 指定日に n 日加算した `YYYY-MM-DD` を返す。 */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + n);
  return formatDate(d);
}

/** その日を含む週の月曜日を返す（週開始 = 月曜）。 */
export function startOfWeek(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  const dow = d.getDay(); // 0=Sun ... 6=Sat
  const diff = (dow + 6) % 7; // Mon=0
  return addDays(date, -diff);
}

/** 曜日ラベル（日本語 1 文字）。 */
export function weekdayLabel(date: string): string {
  const labels = ["日", "月", "火", "水", "木", "金", "土"];
  return labels[new Date(`${date}T00:00:00`).getDay()] ?? "";
}

/** 土日か。 */
export function isWeekend(date: string): boolean {
  const dow = new Date(`${date}T00:00:00`).getDay();
  return dow === 0 || dow === 6;
}
