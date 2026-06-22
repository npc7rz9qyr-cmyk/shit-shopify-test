import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { postExpense } from "../services/expenses.server";
import { ensureShop } from "../services/shop.server";

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

function splitInclusiveVat(totalCents: bigint, vatRate: number) {
  if (vatRate <= 0) return { netCents: totalCents, vatCents: 0n };
  const vatCents = (totalCents * BigInt(vatRate)) / BigInt(100 + vatRate);
  return { netCents: totalCents - vatCents, vatCents };
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
  const oldInvoiceNumber = `AUTO-SHIPPING-${year}-Q${quarter}`;
  const invoiceNumber = `AUTO-SHIPPING-21VAT-${year}-Q${quarter}`;

  try {
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

    const existingAutoExpenses = await prisma.expense.findMany({
      where: {
        shopId: shop.id,
        invoiceNumber: { in: [oldInvoiceNumber, invoiceNumber] },
      },
      select: { id: true },
    });

    for (const expense of existingAutoExpenses) {
      await deleteExpenseWithEntry(shop.id, expense.id);
    }

    const { netCents, vatCents } = splitInclusiveVat(totalCents, 21);

    await postExpense(shop.id, {
      date: end,
      supplier: "PostNL / verzendlabels",
      description: `Verzendkosten ${year} Q${quarter} automatisch berekend met 21% btw`,
      invoiceNumber,
      netCents,
      vatCents,
      totalCents,
    });

    return redirectToDashboard(year, quarter, {
      shippingExpense: existingAutoExpenses.length ? "rebooked" : "booked",
      shippingTotal: totalCents.toString(),
      shippingVat: vatCents.toString(),
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
