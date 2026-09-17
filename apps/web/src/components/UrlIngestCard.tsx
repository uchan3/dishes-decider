import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { needsPastedContent, normalizeIngestUrl, submitIngest } from "../lib/ingest.ts";
import { getImportJob, isStalled, type ImportJobRow } from "../lib/importJobs.ts";
import { pullLibrary } from "../lib/sync.ts";
import { isSupabaseConfigured } from "../lib/supabase.ts";

/** 状況を確認する間隔。抽出は 5〜15 秒なので、この粒度で十分間に合う。 */
const POLL_INTERVAL_MS = 2500;

/** ここまで pending のままなら画面上は諦める（サーバー側は pg_cron が failed に落とす）。 */
const WATCH_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * URL からレシピを取り込むカード（B-4 / US-01）。
 *
 * これまで取り込みの入口は iOS ショートカットだけで、PC・Android からは手入力しか
 * 手段がなかった。ここに URL を貼れば同じ Edge Function が走る。
 *
 * 取り込みは非同期なので、依頼後は job を見に行って結果まで画面に出す
 * （失敗に気付けないと「入れたのに出てこない」になるため）。
 */
export function UrlIngestCard() {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** 本文の貼り付け欄を出しているか（Instagram などサーバーから読めない URL 用）。 */
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  /** 追跡中のジョブ。依頼のたびに差し替える。 */
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<ImportJobRow | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  const start = useCallback(async (rawUrl: string, content?: string) => {
    const checked = normalizeIngestUrl(rawUrl);
    if (!checked.ok) {
      setError(checked.reason);
      return;
    }
    // サーバーから本文を読めない URL は、貼り付けが無いと必ず失敗する。
    // 投げる前に案内して、無駄な失敗ジョブを作らない。
    if (needsPastedContent(checked.href) && !content?.trim()) {
      setPasteOpen(true);
      setError(null);
      setJob(null);
      return;
    }
    setBusy(true);
    setError(null);
    setJob(null);
    setTimedOut(false);
    try {
      const { jobId: id } = await submitIngest(checked.href, content);
      setJobId(id);
      setInput("");
      setPasted("");
      setPasteOpen(false);
    } catch (e) {
      setJobId(null);
      setError(e instanceof Error ? e.message : "取り込みの依頼に失敗しました");
    } finally {
      setBusy(false);
    }
  }, []);

  // 依頼したジョブが終わるまで状況を見に行く。Realtime でも完了は届くが、購読が
  // 張れていない端末でも結果を出せるよう、この画面は自前で確認する。
  useEffect(() => {
    if (jobId === null) return;
    let cancelled = false;
    let timer = 0;
    const startedAt = Date.now();

    async function tick() {
      try {
        const row = await getImportJob(jobId as string);
        if (cancelled) return;
        if (row) {
          setJob(row);
          if (row.status !== "pending") {
            // 成功した行を Dexie に入れてからリンクを出す（押した先が空にならないように）。
            if (row.status !== "failed") {
              await pullLibrary().catch((e) => console.error("[ingest] pullLibrary 失敗", e));
            }
            return;
          }
        }
      } catch {
        // 一時的な通信失敗で追跡をやめない（次の周期で拾い直す）。
      }
      if (cancelled) return;
      if (Date.now() - startedAt > WATCH_TIMEOUT_MS) {
        setTimedOut(true);
        return;
      }
      timer = window.setTimeout(tick, POLL_INTERVAL_MS);
    }

    timer = window.setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [jobId]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void start(input);
  }

  /** 貼り付けた本文で取り込む。 */
  function handlePasteSubmit() {
    void start(input, pasted);
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="card">
        <h2>URL から取り込む</h2>
        <p className="muted">
          Supabase が未設定のため利用できません。下のフォームから手入力で登録してください。
        </p>
      </div>
    );
  }

  const pending = jobId !== null && (job === null || job.status === "pending") && !timedOut;
  const stalled = job !== null && isStalled(job);

  return (
    <div className="card">
      <h2>URL から取り込む</h2>
      <p className="muted">
        レシピページや YouTube の URL を貼ると、材料を自動で読み取って登録します。
      </p>

      <form className="btn-row" onSubmit={handleSubmit}>
        <input
          className="token-label"
          type="url"
          inputMode="url"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="https://…"
          aria-label="レシピの URL"
        />
        <button className="btn btn--primary" type="submit" disabled={busy || input.trim() === ""}>
          {busy ? "送信中…" : "取り込む"}
        </button>
      </form>

      {error && <p className="notice notice--warn">{error}</p>}

      {pasteOpen && (
        <div className="notice">
          <p>
            {needsPastedContent(input)
              ? "Instagram はログインが必要で、サーバーからは投稿本文を読めません。"
              : "このページはサーバーからの読み取りを拒否することがあります。"}
            <strong>キャプション（材料と作り方の文章）を貼り付けてください。</strong>
          </p>
          <textarea
            className="paste-box"
            rows={6}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder={"【材料】\n玉ねぎ 1個\n豚こま切れ肉 200g\n…"}
            aria-label="投稿の本文"
          />
          <div className="btn-row">
            <button
              className="btn btn--primary"
              onClick={handlePasteSubmit}
              disabled={busy || pasted.trim() === "" || input.trim() === ""}
            >
              貼り付けた本文で取り込む
            </button>
            <button
              className="btn"
              onClick={() => {
                setPasteOpen(false);
                setPasted("");
              }}
            >
              やめる
            </button>
          </div>
        </div>
      )}

      {pending && (
        <p className="notice">
          取り込み中です（5〜15 秒ほど）。この画面を離れても処理は続きます。
        </p>
      )}

      {timedOut && (
        <div className="notice notice--warn">
          <p>3 分たっても完了しませんでした。設定画面の「取り込み状況」で結果を確認できます。</p>
          <Link to="/settings">設定を開く</Link>
        </div>
      )}

      {job !== null && job.status === "success" && (
        <div className="notice">
          <p>取り込みました。</p>
          {job.recipe_id && <Link to={`/recipe/${job.recipe_id}`}>レシピを開く</Link>}
        </div>
      )}

      {job !== null && job.status === "partial" && (
        <div className="notice notice--warn">
          <p>一部だけ読み取れました。材料が欠けていないか確認してください。</p>
          {job.recipe_id && <Link to={`/recipe/${job.recipe_id}`}>レシピを開く</Link>}
        </div>
      )}

      {job !== null && (job.status === "failed" || stalled) && (
        <div className="notice notice--warn">
          <p>
            取り込みに失敗しました{job.error ? `: ${job.error}` : "。"}
          </p>
          <p className="muted">
            ページが読み取りを拒否している場合があります。本文を貼り付けるか、iOS
            ショートカット（本文を端末側で取得する）から送ると通ることがあります。
          </p>
          <div className="btn-row">
            <button className="btn" onClick={() => void start(job.url)} disabled={busy}>
              もう一度試す
            </button>
            <button
              className="btn"
              onClick={() => {
                setInput(job.url);
                setPasteOpen(true);
              }}
              disabled={busy}
            >
              本文を貼り付ける
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
