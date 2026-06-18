import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../services/shop.server";
import { importOrders } from "../services/import-orders.server";

function recentOrdersStartDate() {
  const date = new Date();
  date.setDate(date.getDate() - 59);
  date.setHours(0, 0, 0, 0);
  return date;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, admin);
  const earliestAllowedDate = recentOrdersStartDate();
  const configuredStartDate = shop.settings?.bookkeepingStart || earliestAllowedDate;
  const startDate = configuredStartDate < earliestAllowedDate ? earliestAllowedDate : configuredStartDate;

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
