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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  await ensureShop(session.shop, admin);
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
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
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <nav
        aria-label="Hoofdnavigatie"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.5rem",
          padding: "0.75rem 1rem",
          borderBottom: "1px solid #e1e3e5",
          background: "#ffffff",
        }}
      >
        {navigationItems.map(([to, label]) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/app"}
            style={({ isActive }) => ({
              display: "inline-flex",
              alignItems: "center",
              minHeight: "2.25rem",
              padding: "0 0.75rem",
              borderRadius: "0.5rem",
              textDecoration: "none",
              fontWeight: isActive ? 700 : 500,
              color: "#202223",
              background: isActive ? "#f1f2f3" : "transparent",
            })}
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (args) => boundary.headers(args);
