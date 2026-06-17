import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../services/shop.server";
import { importOrders } from "../services/import-orders.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, admin);
  const startDate = shop.settings?.bookkeepingStart || new Date(new Date().getFullYear(), 0, 1);
  const result = await importOrders(admin, shop.id, startDate);
  return redirect(`/app/orders?imported=${result.imported}&failed=${result.failed}`);
};

export const loader = async () => redirect("/app");
