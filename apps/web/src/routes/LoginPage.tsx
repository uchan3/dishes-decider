import { useState, type FormEvent } from "react";
import { useAuth } from "../lib/auth.tsx";

/** メール＋パスワードのログイン画面（未認証時に表示）。 */
export function LoginPage() {
  const { signIn, configured } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error } = await signIn(email.trim(), password);
      if (error) setError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="login__card">
        <h1>週間献立プランナー</h1>
        {!configured && (
          <p className="notice notice--warn">
            Supabase が未設定です（`.env.local` に URL / anon key を設定してください）。
          </p>
        )}
        <form onSubmit={handleSubmit} className="form">
          <label className="field">
            <span className="field__label">メールアドレス</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="field">
            <span className="field__label">パスワード</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && <p className="notice notice--warn">{error}</p>}
          <button type="submit" className="btn btn--primary btn--block" disabled={busy || !configured}>
            {busy ? "サインイン中…" : "サインイン"}
          </button>
        </form>
      </div>
    </div>
  );
}
