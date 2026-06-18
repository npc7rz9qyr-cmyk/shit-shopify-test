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
  const { start: quarterStart, end: quarterEnd } = quarterRange(
    selectedYear,
    selectedQuarter,
  );

  const orders = await prisma.orderSnapshot.findMany({
    where: {
      shopId: shop.id,
      processedAt: {
        gte: quarterStart,
        lte: quarterEnd,
      },
    },
    orderBy: { processedAt: "desc" },
    include: { activeJournalEntry: true },
  });

  return {
    imported: url.searchParams.get("imported"),
    failed: url.searchParams.get("failed"),
    start: url.searchParams.get("start"),
    error: url.searchParams.get("error"),
    selectedYear,
    selectedQuarter,
    yearOptions: yearOptions(selectedYear),
    periodLabel: quarterLabel(selectedYear, selectedQuarter),
    periodStart: quarterStart.toISOString().slice(0, 10),
    periodEnd: quarterEnd.toISOString().slice(0, 10),
    orderCount: orders.length,
    orders: orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      processedAt: order.processedAt.toISOString(),
      grossCents: order.grossCents.toString(),
      taxCents: order.taxCents.toString(),
      refundCents: order.refundCents.toString(),
      status: order.syncStatus,
      entryNumber: order.activeJournalEntry?.entryNumber || null,
    })),
  };
};

export default function OrdersPage() {
  const {
    orders,
    imported,
    failed,
    start,
    error,
    selectedYear,
    selectedQuarter,
    yearOptions,
    periodLabel,
    periodStart,
    periodEnd,
    orderCount,
  } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Verkoop">
      <s-button slot="primary-action" href="/app">
        Nieuwe import
      </s-button>

      {error ? (
        <s-section>
          <s-banner tone="critical">Import mislukt: {error}</s-banner>
        </s-section>
      ) : null}

      {imported ? (
        <s-section>
          <s-banner tone={failed && failed !== "0" ? "warning" : "success"}>
            Import klaar vanaf {start || "de ingestelde datum"}: {imported} orders verwerkt, {failed || "0"} mislukt.
          </s-banner>
        </s-section>
      ) : null}

      <s-section heading="Orders per kwartaal bekijken">
        <Form method="get">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))",
              gap: "0.75rem",
              alignItems: "end",
              maxWidth: "42rem",
            }}
          >
            <div style={{ display: "grid", gap: "0.35rem" }}>
              <label htmlFor="year" style={{ fontWeight: 600 }}>
                Jaar
              </label>
              <select
                id="year"
                name="year"
                defaultValue={String(selectedYear)}
                style={{
                  padding: "0.65rem",
                  border: "1px solid #8c9196",
                  borderRadius: "0.5rem",
                  background: "white",
                }}
              >
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "grid", gap: "0.35rem" }}>
              <label htmlFor="quarter" style={{ fontWeight: 600 }}>
                Kwartaal
              </label>
              <select
                id="quarter"
                name="quarter"
                defaultValue={String(selectedQuarter)}
                style={{
                  padding: "0.65rem",
                  border: "1px solid #8c9196",
                  borderRadius: "0.5rem",
                  background: "white",
                }}
              >
                <option value="1">Q1 — januari t/m maart</option>
                <option value="2">Q2 — april t/m juni</option>
                <option value="3">Q3 — juli t/m september</option>
                <option value="4">Q4 — oktober t/m december</option>
              </select>
            </div>

            <div>
              <s-button type="submit">Orders tonen</s-button>
            </div>
          </div>
        </Form>
      </s-section>

      <s-section heading={`Orders ${periodLabel}`}>
        <s-paragraph>
          Periode: {new Date(periodStart).toLocaleDateString("nl-NL")} t/m {new Date(periodEnd).toLocaleDateString("nl-NL")} — {orderCount} orders gevonden.
        </s-paragraph>

        {orders.length === 0 ? (
          <s-paragraph>Geen orders gevonden in dit kwartaal.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Order</s-table-header>
              <s-table-header>Datum</s-table-header>
              <s-table-header>Bruto</s-table-header>
              <s-table-header>Btw</s-table-header>
              <s-table-header>Refund</s-table-header>
              <s-table-header>Boeking</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {orders.map((order) => (
                <s-table-row key={order.id}>
                  <s-table-cell>{order.orderNumber}</s-table-cell>
                  <s-table-cell>{new Date(order.processedAt).toLocaleDateString("nl-NL")}</s-table-cell>
                  <s-table-cell>{formatEuros(BigInt(order.grossCents))}</s-table-cell>
                  <s-table-cell>{formatEuros(BigInt(order.taxCents))}</s-table-cell>
                  <s-table-cell>{formatEuros(BigInt(order.refundCents))}</s-table-cell>
                  <s-table-cell>{order.entryNumber ? `#${order.entryNumber}` : order.status}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}
