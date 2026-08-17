import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // アプリシェル（JS/CSS/HTML）は Precache。Supabase レスポンスは Dexie が担うためキャッシュしない。
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png}"],
      },
      manifest: {
        name: "週間献立プランナー",
        short_name: "献立",
        description: "集めたレシピから週間献立と買い物リストを自動生成する",
        theme_color: "#2f855a",
        background_color: "#ffffff",
        display: "standalone",
        lang: "ja",
        start_url: "/",
        // アイコンは `scripts/generate-icons.py` で再生成できる（依存ゼロ）。
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
  // @recipe-planner/core は .ts ソースを直接 export する workspace パッケージ。
  // プリバンドルを避けて Vite の transform に処理させる。
  optimizeDeps: {
    exclude: ["@recipe-planner/core"],
  },
});
