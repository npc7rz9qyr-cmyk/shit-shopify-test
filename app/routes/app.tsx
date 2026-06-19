import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import {
  NavLink,
  Outlet,
  useLoaderData,
  useRouteError,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../services/shop.server";
import "../styles.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  await ensureShop(session.shop, admin);
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shop: session.shop,
  };
};

const navigationItems = [
  ["/app", "Dashboard"],
  ["/app/orders", "Verkoop"],
  ["/app/payouts", "Uitbetalingen"],
  ["/app/expenses", "Kosten"],
  ["/app/journal", "Boekingen"],
  ["/app/vat", "Btw"],
  ["/app/reports", "Rapportages"],
  ["/app/settings", "Instellingen"],
] as const;

export default function AppLayout() {
  const { apiKey, shop } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <div className="modern-shell">
        <aside className="modern-sidebar">
          <div className="modern-brand">
            <div className="brand-row">
              <div className="brand-logo">B</div>
              <div>
                <div className="brand-name">Boekhouder</div>
                <div className="brand-desc">Shopify btw & administratie</div>
              </div>
            </div>
            <div className="brand-metrics">
              <div className="brand-metric">
                <strong>Status</strong>
                <span>Live</span>
              </div>
              <div className="brand-metric">
                <strong>Focus</strong>
                <span>BTW</span>
              </div>
            </div>
          </div>

          <div className="modern-nav-card">
            <nav className="modern-nav" aria-label="Hoofdnavigatie">
              {navigationItems.map(([to, label]) => (
                <NavLink key={to} to={to} end={to === "/app"}>
                  {label}
                </NavLink>
              ))}
            </nav>
          </div>

          <div className="modern-help-card">
            <strong>Kwartaal klaarzetten</strong>
            <p>Importeer orders, boek kosten en neem daarna de btw-rubrieken direct over vanaf het dashboard.</p>
          </div>
        </aside>

        <main className="modern-main">
          <header className="modern-topbar">
            <div>
              <div className="topbar-kicker">Administratie actief</div>
              <h1>Financieel dashboard</h1>
              <p>Omzet, kosten, btw-aangifte en boekingen in één modern overzicht.</p>
            </div>
            <div className="shop-pill">{shop}</div>
          </header>

          <div className="modern-page">
            <Outlet />
          </div>
        </main>
      </div>
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (args) => boundary.headers(args);
