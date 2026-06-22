import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ensureShop } from "../services/shop.server";
import { postExpense } from "../services/expenses.server";

function safeYear(value: FormDataEntryValue | null) {
  const parsed = Number(value);
  const currentYear = new Date().getFullYear();
  return Number.isInteger(parsed) && parsed >= 2020 && parsed <= 2100 ? parsed : currentYear;
}

function safeQuarter(value: FormDataEntryValue | null) {
  const parsed = Number(value);
  const currentQuarter = Math.floor(new Date().getMonth() / 3) + 1;
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 4 ? parsed : currentQuarter;
}

function quarterRange(year: number, quarter: number) {
  const startMonth = (quarter - 1) * 3;
  return {
    start: new Date(Date.UTC(year, startMonth, 1, 0, 0, 0, 0)),
    end: new Date(Date.UTC(year, startMonth + 3, 0, 23, 59, 59, 999)),
  };
}

function redirectToDashboard(year: number, quarter: number, params: Record<string, string>) {
  const search = new URLSearchParams({ year: String(year), quarter: String(quarter), ...params });
  return redirect(`/app?${search.toString()}`);
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, admin);
  const formData = await request.formData();
  const year = safeYear(formData.get("year"));
  const quarter = safeQuarter(formData.get("quarter"));
  const { start, end } = quarterRange(year, quarter);
  const invoiceNumber = `AUTO-SHIPPING-${year}-Q${quarter}`;

  try {
    const existing = await prisma.expense.findFirst({
      where: { shopId: shop.id, invoiceNumber },
      select: { id: true },
    });

    if (existing) {
      return redirectToDashboard(year, quarter, {
        shippingExpense: "exists",
        notice: "shipping-costs",
      });
    }

    const shippingTotals = await prisma.orderSnapshot.aggregate({
      where: { shopId: shop.id, processedAt: { gte: start, lte: end } },
      _sum: { shippingCents: true },
    });

    const totalCents = shippingTotals._sum.shippingCents || 0n;
    if (totalCents <= 0n) {
      return redirectToDashboard(year, quarter, {
        shippingExpense: "none",
        notice: "shipping-costs",
      });
    }

    await postExpense(shop.id, {
      date: end,
      supplier: "Automatisch uit Shopify",
      description: `Verzendkosten ${year} Q${quarter} op basis van Shopify-orders`,
      invoiceNumber,
      netCents: totalCents,
      vatCents: 0n,
      totalCents,
    });

    return redirectToDashboard(year, quarter, {
      shippingExpense: "booked",
      shippingTotal: totalCents.toString(),
      notice: "shipping-costs",
    });
  } catch (error) {
    return redirectToDashboard(year, quarter, {
      shippingExpense: "error",
      notice: "shipping-costs",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const loader = async () => redirect("/app");
