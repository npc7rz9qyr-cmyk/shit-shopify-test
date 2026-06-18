import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../services/shop.server";
import { importOrders } from "../services/import-orders.server";

const ALL_ORDERS_START_DATE = new Date("2000-01-01T00:00:00.000Z");

function safeYear(value: FormDataEntryValue | null) {
  const parsed = Number(value);
  const currentYear = new Date().getFullYear();
  return Number.isInteger(parsed) && parsed >= 2020 && parsed <= 2100
    ? parsed
    : currentYear;
}

function safeQuarter(value: FormDataEntryValue | null) {
  const parsed = Number(value);
  const currentQuarter = Math.floor(new Date().getMonth() / 3) + 1;
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 4
    ? parsed
    : currentQuarter;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, admin);
  const formData = await request.formData();
  const year = safeYear(formData.get("year"));
  const quarter = safeQuarter(formData.get("quarter"));
  const startDate = shop.settings?.bookkeepingStart || ALL_ORDERS_START_DATE;
  const redirectParams = `year=${year}&quarter=${quarter}`;

  try {
    const result = await importOrders(admin, shop.id, startDate);
    return redirect(
      `/app/orders?${redirectParams}&imported=${result.imported}&failed=${result.failed}&start=${startDate.toISOString().slice(0, 10)}`,
    );
  } catch (error) {
    const message = encodeURIComponent(
      error instanceof Error ? error.message : String(error),
    );
    return redirect(`/app/orders?${redirectParams}&error=${message}`);
  }
};

export const loader = async () => redirect("/app");
