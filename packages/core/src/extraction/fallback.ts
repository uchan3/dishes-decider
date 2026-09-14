/**
 * 抽出プロバイダの再試行とフォールバック（techstack §5.3）。
 *
 * 無料枠の Gemini は混雑すると 429 を返す。これまでは 1 回失敗しただけで
 * `import_jobs` が `failed` になり、ユーザーには手入力しか残らなかった。
 *
 * ここで **同じプロバイダを指数バックオフで再試行 → 駄目なら次のプロバイダ**の順に
 * 落としていく。純粋な制御ロジックなので core に置き（`sleep` は注入可能）、
 * Deno を起動せずに vitest で検証する。
 */

import type { ExtractionInput, ExtractionProvider, ProviderExtraction } from "./types.ts";

/**
 * HTTP ステータスを持つプロバイダ側のエラー。
 *
 * 「待てば直るのか（429・5xx）」「何度やっても同じか（400・401）」を呼び出し側が
 * 判断できるよう、各プロバイダはこの型で投げる。
 */
export class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

/** 待てば直る見込みのあるステータス。 */
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/**
 * そのエラーで**同じプロバイダに**もう一度投げる価値があるか。
 *
 * HTTP エラーはステータスで判断する（401 や 400 を繰り返しても無駄）。
 * それ以外（ネットワーク断・空応答・JSON 崩れ）は一度きりの事故であることが
 * 多いので再試行する。回数は呼び出し側が上限で抑える。
 *
 * @example
 * ```ts
 * isRetryableExtractionError(new ProviderHttpError(429, "quota")); // → true
 * isRetryableExtractionError(new ProviderHttpError(401, "bad key")); // → false
 * ```
 */
export function isRetryableExtractionError(error: unknown): boolean {
  if (error instanceof ProviderHttpError) return RETRYABLE_STATUS.has(error.status);
  return true;
}

/**
 * 指数バックオフの待ち時間。
 *
 * @param attempt - 何回目の試行が失敗したか（1 始まり）
 * @param baseMs - 1 回目の待ち時間
 * @returns `baseMs * 2^(attempt-1)` ミリ秒
 */
export function retryDelayMs(attempt: number, baseMs = 1000): number {
  return baseMs * 2 ** (attempt - 1);
}

/** 試行が失敗したときに通知される内容。 */
export interface AttemptFailure {
  provider: string;
  /** このプロバイダで何回目の試行か（1 始まり）。 */
  attempt: number;
  error: Error;
  /** 同じプロバイダでもう一度試すか。 */
  willRetry: boolean;
  /** 次のプロバイダに移るか。 */
  willFallBack: boolean;
}

/** フォールバックの設定。 */
export interface FallbackOptions {
  /** 同一プロバイダでの**追加**試行回数（既定 2 = 最大 3 回投げる）。 */
  maxRetries?: number;
  /** 1 回目の待ち時間（既定 1000ms）。 */
  baseDelayMs?: number;
  /** 待機（テストでは即時に差し替える）。 */
  sleep?: (ms: number) => Promise<void>;
  /** 失敗のたびに呼ばれる（ログ用）。 */
  onAttemptFailed?: (failure: AttemptFailure) => void;
  /** 成功したプロバイダの通知（どれが実際に使われたかを残す）。 */
  onSuccess?: (info: { provider: string; attempt: number }) => void;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 複数のプロバイダを順に試す 1 つのプロバイダを作る。
 *
 * 並び順が優先順位（例: 無料の Gemini → 無料の軽量モデル → 有料の Claude）。
 * 各プロバイダで再試行し尽くしてから次に移り、**全部駄目なら最後のエラーを投げる**
 * （呼び出し側から見た振る舞いは単一プロバイダと同じ）。
 *
 * @param providers - 優先順位の高い順。空配列は設定ミスなので即エラー
 * @throws 最後に発生したエラー（全プロバイダが失敗した場合）
 *
 * @example
 * ```ts
 * const provider = createFallbackProvider([gemini, claude], { maxRetries: 2 });
 * await provider.extract({ url, text }); // gemini を 3 回試して駄目なら claude へ
 * ```
 */
export function createFallbackProvider(
  providers: readonly ExtractionProvider[],
  options: FallbackOptions = {},
): ExtractionProvider {
  if (providers.length === 0) throw new Error("抽出プロバイダが 1 つも指定されていません");
  const first = providers[0] as ExtractionProvider;
  const maxRetries = options.maxRetries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const sleep = options.sleep ?? defaultSleep;

  return {
    // 合成後も 1 つのプロバイダとして振る舞う。実際に使われたものは
    // `onSuccess` で通知する（この名前は先頭のものを表示用に借りているだけ）。
    name: first.name,

    async extract(input: ExtractionInput): Promise<ProviderExtraction> {
      let lastError: unknown = new Error("抽出プロバイダが実行されませんでした");

      for (let i = 0; i < providers.length; i++) {
        const provider = providers[i] as ExtractionProvider;
        const isLastProvider = i === providers.length - 1;

        for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
          try {
            const result = await provider.extract(input);
            options.onSuccess?.({ provider: provider.name, attempt });
            return result;
          } catch (caught) {
            const error = caught instanceof Error ? caught : new Error(String(caught));
            lastError = error;
            const willRetry = attempt <= maxRetries && isRetryableExtractionError(error);
            options.onAttemptFailed?.({
              provider: provider.name,
              attempt,
              error,
              willRetry,
              willFallBack: !willRetry && !isLastProvider,
            });
            if (!willRetry) break; // 次のプロバイダへ（無ければループを抜けて throw）
            await sleep(retryDelayMs(attempt, baseDelayMs));
          }
        }
      }

      throw lastError;
    },
  };
}
