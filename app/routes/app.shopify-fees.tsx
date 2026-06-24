import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { postExpense } from "../services/expenses.server";
import { ensureShop } from "../services/shop.server";

const SHOPIFY_FEE_PERCENT = 2n;

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

async function deleteExpenseWithEntry(shopId: string, expenseId: string) {
  const expense = await prisma.expense.findFirst({ where: { id: expenseId, shopId } });
  if (!expense) return;
  await prisma.$transaction([
    prisma.expense.delete({ where: { id: expense.id } }),
    prisma.journalEntry.delete({ where: { id: expense.journalEntryId } }),
  ]);
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, admin);
  const formData = await request.formData();
  const year = safeYear(formData.get("year"));
  const quarter = safeQuarter(formData.get("quarter"));
  const { start, end } = quarterRange(year, quarter);
  const invoiceNumber = `AUTO-SHOPIFY-FEES-${year}-Q${quarter}`;

  try {
    const totals = await prisma.orderSnapshot.aggregate({
      where: { shopId: shop.id, processedAt: { gte: start, lte: end } },
      _sum: { grossCents: true, refundCents: true },
    });

    const grossCents = totals._sum.grossCents || 0n;
    const refundCents = totals._sum.refundCents || 0n;
    const paymentBaseCents = grossCents > refundCents ? grossCents - refundCents : 0n;
    const feeCents = (paymentBaseCents * SHOPIFY_FEE_PERCENT) / 100n;

    if (feeCents <= 0n) {
      return redirectToDashboard(year, quarter, {
        shopifyFees: "none",
        notice: "shopify-fees",
      });
    }

    const existingAutoExpenses = await prisma.expense.findMany({
      where: { shopId: shop.id, invoiceNumber },
      select: { id: true },
    });

    for (const expense of existingAutoExpenses) {
      await deleteExpenseWithEntry(shop.id, expense.id);
    }

    await postExpense(shop.id, {
      date: end,
      supplier: "Shopify Payments",
      description: `Shopify transactiekosten ${year} Q${quarter} automatisch berekend op 2%`,
      invoiceNumber,
      netCents: feeCents,
      vatCents: 0n,
      totalCents: feeCents,
    });

    return redirectToDashboard(year, quarter, {
      shopifyFees: existingAutoExpenses.length ? "rebooked" : "booked",
      shopifyFeeTotal: feeCents.toString(),
      notice: "shopify-fees",
    });
  } catch (error) {
    return redirectToDashboard(year, quarter, {
      shopifyFees: "error",
      notice: "shopify-fees",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const loader = async () => redirect("/app");
