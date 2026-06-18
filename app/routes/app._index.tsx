import type { LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ensureShop } from "../services/shop.server";
import { formatEuros } from "../services/money";

function currentQuarterSelection() {
  const now = new Date();
  return {
    year: now.getFullYear(),
    quarter: Math.floor(now.getMonth() / 3) + 1,
  };
}

function parseQuarter(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 4 ? parsed : fallback;
}

function parseYear(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 2020 && parsed <= 2100 ? parsed : fallback;
}

function quarterRange(year: number, quarter: number) {
  const startMonth = (quarter - 1) * 3;
  return {
    start: new Date(Date.UTC(year, startMonth, 1, 0, 0, 0, 0)),
    end: new Date(Date.UTC(year, startMonth + 3, 0, 23, 59, 59, 999)),
  };
}

function quarterLabel(year: number, quarter: number) {
  return `Q${quarter} ${year}`;
}

function yearOptions(selectedYear: number) {
  const currentYear = new Date().getFullYear();
  const years = new Set<number>();

  for (let year = currentYear + 1; year >= currentYear - 5; year -= 1) {
    years.add(year);
  }
  years.add(selectedYear);

  return Array.from(years).sort((a, b) => b - a);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, admin);
  const url = new URL(request.url);
  const fallback = currentQuarterSelection();
  const selectedYear = parseYear(url.searchParams.get("year"), fallback.year);
  const selectedQuarter = parseQuarter(
    url.searchParams.get("quarter"),
    fallback.quarter,
  );
  const { start, end } = quarterRange(selectedYear, selectedQuarter);
  const periodWhere = { shopId: shop.id, processedAt: { gte: start, lte: end } };
  const expenseWhere = { shopId: shop.id, date: { gte: start, lte: end } };

  const [orders, journals, errors, totals, expenseTotals] = await Promise.all([
    prisma.orderSnapshot.count({ where: periodWhere }),
    prisma.journalEntry.count({
      where: { shopId: shop.id, status: "POSTED", date: { gte: start, lte: end } },
    }),
    prisma.syncError.count({ where: { shopId: shop.id, resolvedAt: null } }),
    prisma.orderSnapshot.aggregate({
      where: periodWhere,
      _sum: { grossCents: true, taxCents: true, refundCents: true },
    }),
    prisma.expense.aggregate({
      where: expenseWhere,
      _sum: { netCents: true, vatCents: true, totalCents: true },
    }),
  ]);

  const salesVat = totals._sum.taxCents || 0n;
  const purchaseVat = expenseTotals._sum.vatCents || 0n;
  const vatDue = salesVat - purchaseVat;

  return {
    shop: shop.domain,
    orders,
    journals,
    errors,
    selectedYear,
    selectedQuarter,
    yearOptions: yearOptions(selectedYear),
    periodLabel: quarterLabel(selectedYear, selectedQuarter),
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
    grossCents: (totals._sum.grossCents || 0n).toString(),
    taxCents: salesVat.toString(),
    refundCents: (totals._sum.refundCents || 0n).toString(),
    costNetCents: (expenseTotals._sum.netCents || 0n).toString(),
    costVatCents: purchaseVat.toString(),
    costTotalCents: (expenseTotals._sum.totalCents || 0n).toString(),
    vatDueCents: vatDue.toString(),
  };
};

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();
  return (
    <s-page heading="Boekhouding">
      <s-button slot="primary-action" href="/app/orders">Bekijk verkoop</s-button>

      <s-section heading="Dashboard kwartaal">
        <Form method="get">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))", gap: "0.75rem", alignItems: "end", maxWidth: "42rem" }}>
            <div style={{ display: "grid", gap: "0.35rem" }}>
              <label htmlFor="year" style={{ fontWeight: 600 }}>Jaar</label>
              <select id="year" name="year" defaultValue={String(data.selectedYear)} style={{ padding: "0.65rem", border: "1px solid #8c9196", borderRadius: "0.5rem", background: "white" }}>
                {data.yearOptions.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </div>
            <div style={{ display: "grid", gap: "0.35rem" }}>
              <label htmlFor="quarter" style={{ fontWeight: 600 }}>Kwartaal</label>
              <select id="quarter" name="quarter" defaultValue={String(data.selectedQuarter)} style={{ padding: "0.65rem", border: "1px solid #8c9196", borderRadius: "0.5rem", background: "white" }}>
                <option value="1">Q1 — januari t/m maart</option>
                <option value="2">Q2 — april t/m juni</option>
                <option value="3">Q3 — juli t/m september</option>
                <option value="4">Q4 — oktober t/m december</option>
              </select>
            </div>
            <div><s-button type="submit">Dashboard tonen</s-button></div>
          </div>
        </Form>
      </s-section>

      <s-section heading={`Administratie ${data.periodLabel}`}>
        <s-paragraph>
          Periode: {new Date(data.periodStart).toLocaleDateString("nl-NL")} t/m {new Date(data.periodEnd).toLocaleDateString("nl-NL")}
        </s-paragraph>
        <s-stack direction="inline" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base"><s-text type="strong">Omzet na refunds</s-text><s-heading>{formatEuros(BigInt(data.grossCents))}</s-heading></s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base"><s-text type="strong">Btw verkoop</s-text><s-heading>{formatEuros(BigInt(data.taxCents))}</s-heading></s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base"><s-text type="strong">Refunds</s-text><s-heading>{formatEuros(BigInt(data.refundCents))}</s-heading></s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base"><s-text type="strong">Kosten excl. btw</s-text><s-heading>{formatEuros(BigInt(data.costNetCents))}</s-heading></s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base"><s-text type="strong">Btw inkopen</s-text><s-heading>{formatEuros(BigInt(data.costVatCents))}</s-heading></s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base"><s-text type="strong">Te betalen btw</s-text><s-heading>{formatEuros(BigInt(data.vatDueCents))}</s-heading></s-box>
        </s-stack>
      </s-section>

      <s-section heading="Status"><s-unordered-list><s-list-item>{data.orders} Shopify-orders opgeslagen in dit kwartaal</s-list-item><s-list-item>{data.journals} definitieve journaalposten in dit kwartaal</s-list-item><s-list-item>{data.errors} openstaande verwerkingsfouten</s-list-item></s-unordered-list></s-section>
      <s-section heading="Synchronisatie">
        <s-paragraph>Importeer alle bestellingen vanaf de ingestelde boekhoudstartdatum. De import is idempotent: dezelfde order wordt niet dubbel geboekt.</s-paragraph>
        <Form method="post" action="/app/import"><s-button type="submit" variant="primary">Alle orders importeren</s-button></Form>
      </s-section>
    </s-page>
  );
}
