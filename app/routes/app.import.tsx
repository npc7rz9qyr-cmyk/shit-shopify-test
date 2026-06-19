import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../services/shop.server";
import { importOrders } from "../services/import-orders.server";

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

function quarterRange(year: number, quarter: number) {
  const startMonth = (quarter - 1) * 3;
  return {
    start: new Date(Date.UTC(year, startMonth, 1, 0, 0, 0, 0)),
    end: new Date(Date.UTC(year, startMonth + 3, 0, 23, 59, 59, 999)),
  };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, admin);
  const formData = await request.formData();
  const year = safeYear(formData.get("year"));
  const quarter = safeQuarter(formData.get("quarter"));
  const { start, end } = quarterRange(year, quarter);
  const redirectParams = `year=${year}&quarter=${quarter}`;

  try {
    const result = await importOrders(admin, shop.id, start, end);
    return redirect(
      `/app/orders?${redirectParams}&imported=${result.imported}&failed=${result.failed}&start=${start.toISOString().slice(0, 10)}&end=${end.toISOString().slice(0, 10)}`,
    );
  } catch (error) {
    const message = encodeURIComponent(
      error instanceof Error ? error.message : String(error),
    );
    return redirect(`/app/orders?${redirectParams}&error=${message}`);
  }
};

export const loader = async () => redirect("/app");
