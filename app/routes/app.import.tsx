import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../services/shop.server";
import { importOrders } from "../services/import-orders.server";

const ALL_ORDERS_START_DATE = new Date("2000-01-01T00:00:00.000Z");

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, admin);
  const startDate = shop.settings?.bookkeepingStart || ALL_ORDERS_START_DATE;

  try {
    const result = await importOrders(admin, shop.id, startDate);
    return redirect(
      `/app/orders?imported=${result.imported}&failed=${result.failed}&start=${startDate.toISOString().slice(0, 10)}`,
    );
  } catch (error) {
    const message = encodeURIComponent(
      error instanceof Error ? error.message : String(error),
    );
    return redirect(`/app/orders?error=${message}`);
  }
};

export const loader = async () => redirect("/app");
