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

  const accounts = await prisma.ledgerAccount.findMany({
    where: {
      shopId: shop.id,
      systemKey: {
        in: ["VAT_PAYABLE", "VAT_RECEIVABLE", "SALES", "SHIPPING_REVENUE"],
      },
    },
    include: {
      lines: {
        where: {
          entry: {
            date: { gte: start, lte: end },
            status: { in: ["POSTED", "REVERSED"] },
          },
        },
      },
    },
  });

  const balance = (key: string) => {
    const account = accounts.find((item) => item.systemKey === key);
    return account
      ? account.lines.reduce(
          (sum, line) => sum + line.creditCents - line.debitCents,
          0n,
        )
      : 0n;
  };

  const payable = balance("VAT_PAYABLE");
  const receivable = -balance("VAT_RECEIVABLE");
  const revenue = balance("SALES") + balance("SHIPPING_REVENUE");

  return {
    selectedYear,
    selectedQuarter,
    yearOptions: yearOptions(selectedYear),
    periodLabel: quarterLabel(selectedYear, selectedQuarter),
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    payable: payable.toString(),
    receivable: receivable.toString(),
    net: (payable - receivable).toString(),
    revenue: revenue.toString(),
  };
};

export default function VatPage() {
  const data = useLoaderData<typeof loader>();

  return (
    <s-page heading="Btw-overzicht">
      <s-section heading="Btw-kwartaal selecteren">
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
                defaultValue={String(data.selectedYear)}
                style={{
                  padding: "0.65rem",
                  border: "1px solid #8c9196",
                  borderRadius: "0.5rem",
                  background: "white",
                }}
              >
                {data.yearOptions.map((year) => (
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
                defaultValue={String(data.selectedQuarter)}
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
              <s-button type="submit">Kwartaal berekenen</s-button>
            </div>
          </div>
        </Form>
      </s-section>

      <s-section heading={`Voorlopige berekening ${data.periodLabel}`}>
        <s-paragraph>
          Periode: {new Date(data.start).toLocaleDateString("nl-NL")} t/m {new Date(data.end).toLocaleDateString("nl-NL")}
        </s-paragraph>

        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "12rem 1fr",
            gap: "0.5rem 1rem",
            margin: "0 0 1rem",
          }}
        >
          <dt style={{ fontWeight: 600 }}>Netto omzet</dt>
          <dd style={{ margin: 0 }}>{formatEuros(BigInt(data.revenue))}</dd>
          <dt style={{ fontWeight: 600 }}>Af te dragen btw</dt>
          <dd style={{ margin: 0 }}>{formatEuros(BigInt(data.payable))}</dd>
          <dt style={{ fontWeight: 600 }}>Voorbelasting</dt>
          <dd style={{ margin: 0 }}>{formatEuros(BigInt(data.receivable))}</dd>
          <dt style={{ fontWeight: 600 }}>Per saldo</dt>
          <dd style={{ margin: 0 }}>{formatEuros(BigInt(data.net))}</dd>
        </dl>

        <s-banner tone="warning">
          Dit MVP-overzicht bundelt alle btw. Controleer gemengde tarieven,
          EU/OSS en uitzonderingen vóór aangifte.
        </s-banner>
      </s-section>
    </s-page>
  );
}
