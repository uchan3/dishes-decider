/**
 * 認証ゲート。未認証ならログイン画面、認証済みならアプリ本体を表示する。
 * 認証済みになったらライブラリを一度プルし、取り込みジョブの Realtime を購読し、
 * 送信キュー（outbox）のフラッシュを開始する。
 */

import { useEffect } from "react";
import { RouterProvider } from "react-router-dom";
import { router } from "./router.tsx";
import { useAuth } from "./lib/auth.tsx";
import { LoginPage } from "./routes/LoginPage.tsx";
import { pullLibrary, subscribeImports } from "./lib/sync.ts";
import { startOutboxSync } from "./lib/outboxSync.ts";

export function AppGate() {
  const { ready, userId, configured } = useAuth();

  useEffect(() => {
    if (!configured || !userId) return;
    // ログイン時に一度プル。以降は取り込み完了の Realtime で再プル。
    void pullLibrary().catch((e) => console.error("[sync] pullLibrary 失敗", e));
    const unsubscribe = subscribeImports((count) =>
      console.log(`[sync] realtime pull done: ${count} recipes`),
    );
    // ローカルに溜まった変更を送る（オンライン復帰時にも自動で流れる）。
    const stopOutbox = startOutboxSync(userId);
    return () => {
      unsubscribe();
      stopOutbox();
    };
  }, [configured, userId]);

  if (!ready) return <div className="login"><p className="muted">読み込み中…</p></div>;
  // Supabase 未設定でもローカル Dexie で動かせるよう、その場合はアプリを表示する。
  if (configured && !userId) return <LoginPage />;
  return <RouterProvider router={router} />;
}
