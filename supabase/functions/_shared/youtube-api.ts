/**
 * YouTube Data API v3 で動画のタイトル・概要欄を取得する（仕様書 F-01-1）。
 *
 * watch ページの端末取得は「Web ページオブジェクト化 → JSON 本文で可視テキスト（空）に
 * 変換」されて概要欄が失われるため、公式 API で snippet を直接取る。API キーは Edge Function
 * の環境変数 `YOUTUBE_API_KEY` にのみ格納（PWA バンドルには含めない）。
 * videos.list は 1 リクエスト 1 ユニット（無料枠 1 万ユニット/日）。
 */

/** 動画スニペット（必要部分）。 */
export interface YouTubeSnippet {
  title: string;
  description: string;
  /** 投稿チャンネルの ID。収集元（sources）の識別子に使う。 */
  channelId: string | null;
  /** 投稿チャンネル名。収集元の表示名に使う。 */
  channelTitle: string | null;
}

/**
 * 動画 ID から snippet（title / description）を取得する。
 *
 * @throws API がエラー応答（非 2xx）を返した場合
 * @returns スニペット。動画が見つからなければ null
 */
export async function fetchYouTubeSnippet(
  videoId: string,
  apiKey: string,
): Promise<YouTubeSnippet | null> {
  const url =
    `https://www.googleapis.com/youtube/v3/videos` +
    `?part=snippet&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`YouTube API エラー: HTTP ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    items?: {
      snippet?: {
        title?: string;
        description?: string;
        channelId?: string;
        channelTitle?: string;
      };
    }[];
  };
  const snippet = data.items?.[0]?.snippet;
  if (!snippet) return null;
  return {
    title: snippet.title ?? "",
    description: snippet.description ?? "",
    channelId: snippet.channelId ?? null,
    channelTitle: snippet.channelTitle ?? null,
  };
}
