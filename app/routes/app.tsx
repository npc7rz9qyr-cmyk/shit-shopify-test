import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../services/shop.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  await ensureShop(session.shop, admin);
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function AppLayout() {
  const { apiKey } = useLoaderData<typeof loader>();
  return <AppProvider embedded apiKey={apiKey}><s-app-nav><s-link href="/app">Dashboard</s-link><s-link href="/app/orders">Verkoop</s-link><s-link href="/app/payouts">Uitbetalingen</s-link><s-link href="/app/expenses">Kosten</s-link><s-link href="/app/journal">Boekingen</s-link><s-link href="/app/vat">Btw</s-link><s-link href="/app/reports">Rapportages</s-link><s-link href="/app/settings">Instellingen</s-link></s-app-nav><Outlet /></AppProvider>;
}
export function ErrorBoundary() { return boundary.error(useRouteError()); }
export const headers: HeadersFunction = (args) => boundary.headers(args);
