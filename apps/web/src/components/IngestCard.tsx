import { useCallback, useEffect, useState } from "react";
import {
  ingestEndpoint,
  issueIngestToken,
  listIngestTokens,
  revokeIngestToken,
  type IngestTokenRow,
} from "../lib/ingestTokens.ts";
import { isStalled, listRecentImportJobs, type ImportJobRow } from "../lib/importJobs.ts";

const STATUS_LABEL: Record<ImportJobRow["status"], string> = {
  pending: "処理中",
  success: "完了",
  partial: "一部のみ",
  failed: "失敗",
};

/** 日時を「08-16 21:34」形式にする（一覧で並べたときに読みやすい範囲まで）。 */
function shortDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 取り込み（iOS ショートカット）の設定カード。
 *
 * トークンの発行・失効と、直近の取り込みジョブの状況を表示する。取り込みは非同期で
 * 進むため、ここを見ないと失敗に気付けない（architecture §3.1）。
 *
 * @param userId - ログイン中のユーザー ID
 */
export function IngestCard({ userId }: { userId: string }) {
  const [tokens, setTokens] = useState<IngestTokenRow[] | null>(null);
  const [jobs, setJobs] = useState<ImportJobRow[] | null>(null);
  const [label, setLabel] = useState("iPhone のショートカット");
  /** 発行直後の生トークン。画面を離れると二度と見られない。 */
  const [issued, setIssued] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const endpoint = ingestEndpoint();

  const reload = useCallback(async () => {
    try {
      const [t, j] = await Promise.all([listIngestTokens(), listRecentImportJobs()]);
      setTokens(t);
      setJobs(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleIssue() {
    setBusy(true);
    setError(null);
    try {
      const { token } = await issueIngestToken(userId, label);
      setIssued(token);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "発行に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(id: string) {
    setBusy(true);
    setError(null);
    try {
      await revokeIngestToken(id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "失効に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  const activeTokens = (tokens ?? []).filter((t) => t.revoked_at === null);

  return (
    <div className="card">
      <h2>取り込み（iOS ショートカット）</h2>
      <p className="muted">
        ショートカットからレシピ URL を送るためのトークンです。発行時に一度だけ表示されます。
      </p>

      {endpoint && (
        <p className="muted">
          送信先: <code className="code-inline">{endpoint}</code>
        </p>
      )}

      <div className="btn-row">
        <input
          className="token-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="端末名など"
          aria-label="トークンの覚え書き"
        />
        <button className="btn btn--primary" onClick={handleIssue} disabled={busy}>
          トークンを発行
        </button>
      </div>

      {issued && (
        <div className="notice notice--warn">
          <p>
            <strong>この値は今だけ表示されます。</strong>ショートカットに貼り付けてください。
          </p>
          <code className="code-block">{issued}</code>
          <div className="btn-row">
            <button
              className="btn"
              onClick={() => {
                void navigator.clipboard?.writeText(issued);
              }}
            >
              コピー
            </button>
            <button className="btn" onClick={() => setIssued(null)}>
              閉じる
            </button>
          </div>
        </div>
      )}

      {tokens === null ? (
        <p className="muted">読み込み中…</p>
      ) : activeTokens.length === 0 ? (
        <p className="muted">有効なトークンはありません。</p>
      ) : (
        <ul className="token-list">
          {activeTokens.map((t) => (
            <li key={t.id} className="token-item">
              <div className="token-item__main">
                <span className="token-item__name">{t.label ?? "（名前なし）"}</span>
                <span className="token-item__meta">
                  発行 {shortDateTime(t.created_at)}
                  {" ・ "}
                  {t.last_used_at ? `最終利用 ${shortDateTime(t.last_used_at)}` : "未使用"}
                </span>
              </div>
              <button className="btn btn--danger" onClick={() => handleRevoke(t.id)} disabled={busy}>
                失効
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3 className="card__subhead">取り込み状況</h3>
      <div className="btn-row">
        <button className="btn" onClick={() => void reload()} disabled={busy}>
          更新
        </button>
      </div>
      {jobs === null ? (
        <p className="muted">読み込み中…</p>
      ) : jobs.length === 0 ? (
        <p className="muted">取り込み履歴はまだありません。</p>
      ) : (
        <ul className="job-list">
          {jobs.map((job) => {
            const stalled = isStalled(job);
            const bad = job.status === "failed" || stalled;
            return (
              <li key={job.id} className="job-item">
                <span className={bad ? "job-item__status job-item__status--bad" : "job-item__status"}>
                  {stalled ? "停止" : STATUS_LABEL[job.status]}
                </span>
                <span className="job-item__main">
                  <span className="job-item__url">{job.url}</span>
                  <span className="job-item__meta">
                    {shortDateTime(job.created_at)}
                    {stalled && " ・ 10 分以上応答がありません。送り直してください"}
                    {job.error && ` ・ ${job.error}`}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {error && <p className="notice notice--warn">{error}</p>}
    </div>
  );
}
