import { NavLink, Outlet } from "react-router-dom";

/** 下部ナビの項目定義。 */
const NAV = [
  { to: "/", label: "献立", icon: "🍽️", end: true },
  { to: "/library", label: "レシピ", icon: "📚", end: false },
  { to: "/add", label: "追加", icon: "➕", end: false },
  { to: "/shopping", label: "買い物", icon: "🛒", end: false },
  { to: "/settings", label: "設定", icon: "⚙️", end: false },
] as const;

/** 全画面共通のシェル。コンテンツ + 下部タブナビゲーション。 */
export function Layout() {
  return (
    <div className="app">
      <main className="content">
        <Outlet />
      </main>
      <nav className="tabbar">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => (isActive ? "tab tab--active" : "tab")}
          >
            <span className="tab__icon">{item.icon}</span>
            <span className="tab__label">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
