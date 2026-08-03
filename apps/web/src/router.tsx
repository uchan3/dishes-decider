import { createBrowserRouter } from "react-router-dom";
import { Layout } from "./components/Layout.tsx";
import { HomePage } from "./routes/HomePage.tsx";
import { LibraryPage } from "./routes/LibraryPage.tsx";
import { RecipeDetailPage } from "./routes/RecipeDetailPage.tsx";
import { AddPage } from "./routes/AddPage.tsx";
import { ShoppingPage } from "./routes/ShoppingPage.tsx";
import { SettingsPage } from "./routes/SettingsPage.tsx";

/** アプリのルート定義。全画面が共通レイアウト（下部ナビ）の下に入る。 */
export const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "library", element: <LibraryPage /> },
      { path: "recipe/:id", element: <RecipeDetailPage /> },
      { path: "add", element: <AddPage /> },
      { path: "shopping", element: <ShoppingPage /> },
      { path: "settings", element: <SettingsPage /> },
    ],
  },
]);
