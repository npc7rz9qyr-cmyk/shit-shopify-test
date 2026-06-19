import type { CSSProperties } from "react";
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

function positive(value: bigint) {
  return value > 0n ? value : 0n;
}

const nativeButtonStyle: CSSProperties = {
  minHeight: "2.25rem",
  padding: "0 0.9rem",
  border: "1px solid #303030",
  borderRadius: "0.5rem",
  background: "#303030",
  color: "white",
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryButtonStyle: CSSProperties = {
  ...nativeButtonStyle,
  background: "white",
  color: "#303030",
};

const zeroCents = "0";

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

  const grossSales = totals._sum.grossCents || 0n;
  const salesVat = totals._sum.taxCents || 0n;
  const purchaseVat = expenseTotals._sum.vatCents || 0n;
  const salesExVat = positive(grossSales - salesVat);
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
    grossCents: grossSales.toString(),
    salesExVatCents: salesExVat.toString(),
    taxCents: salesVat.toString(),
    refundCents: (totals._sum.refundCents || 0n).toString(),
    costNetCents: (expenseTotals._sum.netCents || 0n).toString(),
    costVatCents: purchaseVat.toString(),
    costTotalCents: (expenseTotals._sum.totalCents || 0n).toString(),
    vatDueCents: vatDue.toString(),
    declarationRows: [
      {
        code: "1a",
        label: "Leveringen/diensten belast met hoog tarief",
        amountCents: salesExVat.toString(),
        vatCents: salesVat.toString(),
        note: "Automatisch gevuld met Shopify-omzet. Controleer of alles 21% is.",
      },
      {
        code: "1b",
        label: "Leveringen/diensten belast met laag tarief",
        amountCents: zeroCents,
        vatCents: zeroCents,
        note: "Vul handmatig aan als je 9%-producten verkoopt.",
      },
      {
        code: "1c",
        label: "Leveringen/diensten belast met overige tarieven, behalve 0%",
        amountCents: zeroCents,
        vatCents: zeroCents,
        note: "Meestal niet van toepassing voor een normale webshop.",
      },
      {
        code: "1d",
        label: "Privégebruik",
        amountCents: zeroCents,
        vatCents: zeroCents,
        note: "Alleen invullen indien van toepassing, vaak in Q4/eind-aangifte.",
      },
      {
        code: "1e",
        label: "Leveringen/diensten belast met 0% of niet bij jou belast",
        amountCents: zeroCents,
        vatCents: zeroCents,
        note: "Gebruik voor 0%-omzet/verlegde binnenlandse omzet indien van toepassing.",
      },
      {
        code: "2a",
        label: "Leveringen/diensten waarbij de btw naar jou is verlegd",
        amountCents: zeroCents,
        vatCents: zeroCents,
        note: "Handmatig invullen bij facturen met ‘btw verlegd’.",
      },
      {
        code: "3a",
        label: "Leveringen naar landen buiten de EU",
        amountCents: zeroCents,
        vatCents: zeroCents,
        note: "Handmatig invullen bij export buiten de EU.",
      },
      {
        code: "3b",
        label: "Leveringen naar of diensten in landen binnen de EU",
        amountCents: zeroCents,
        vatCents: zeroCents,
        note: "Handmatig invullen bij B2B EU/ICP.",
      },
      {
        code: "3c",
        label: "Installatie/afstandsverkopen binnen de EU",
        amountCents: zeroCents,
        vatCents: zeroCents,
        note: "Handmatig invullen als je geen OSS/eénloketsysteem gebruikt.",
      },
      {
        code: "4a",
        label: "Leveringen/diensten uit landen buiten de EU",
        amountCents: zeroCents,
        vatCents: zeroCents,
        note: "Handmatig invullen bij buitenlandse diensten/invoer met verlegging.",
      },
      {
        code: "4b",
        label: "Leveringen/diensten uit landen binnen de EU",
        amountCents: zeroCents,
        vatCents: zeroCents,
        note: "Handmatig invullen bij EU-inkopen/diensten met verlegde btw.",
      },
      {
        code: "5a",
        label: "Verschuldigde btw",
        amountCents: zeroCents,
        vatCents: salesVat.toString(),
        note: "Totaal btw uit verkooprubrieken die nu automatisch bekend zijn.",
      },
      {
        code: "5b",
        label: "Voorbelasting",
        amountCents: (expenseTotals._sum.netCents || 0n).toString(),
        vatCents: purchaseVat.toString(),
        note: "Btw op ingevoerde zakelijke kosten/inkopen.",
      },
      {
        code: "Saldo",
        label: "Te betalen / terug te vragen",
        amountCents: zeroCents,
        vatCents: vatDue.toString(),
        note: "5a min 5b. Negatief bedrag betekent terug te vragen.",
      },
    ],
  };
};

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();
  return (
    <s-page heading="Boekhouding">
      <s-button slot="primary-action" href={`/app/orders?year=${data.selectedYear}&quarter=${data.selectedQuarter}`}>Bekijk verkoop</s-button>

      <s-section heading="Dashboard kwartaal">
        <Form method="get">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))", gap: "0.75rem", alignItems: "end", maxWidth: "52rem" }}>
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
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
              <button type="submit" style={secondaryButtonStyle}>Dashboard tonen</button>
              <button type="submit" formMethod="post" formAction="/app/import" style={nativeButtonStyle}>Importeer dit kwartaal</button>
            </div>
          </div>
        </Form>
      </s-section>

      <s-section heading={`Administratie ${data.periodLabel}`}>
        <s-paragraph>
          Periode: {new Date(data.periodStart).toLocaleDateString("nl-NL")} t/m {new Date(data.periodEnd).toLocaleDateString("nl-NL")}
        </s-paragraph>
        <s-stack direction="inline" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base"><s-text type="strong">Omzet excl. btw</s-text><s-heading>{formatEuros(BigInt(data.salesExVatCents))}</s-heading></s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base"><s-text type="strong">Btw verkoop</s-text><s-heading>{formatEuros(BigInt(data.taxCents))}</s-heading></s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base"><s-text type="strong">Refunds</s-text><s-heading>{formatEuros(BigInt(data.refundCents))}</s-heading></s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base"><s-text type="strong">Kosten excl. btw</s-text><s-heading>{formatEuros(BigInt(data.costNetCents))}</s-heading></s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base"><s-text type="strong">Btw inkopen / 5b</s-text><s-heading>{formatEuros(BigInt(data.costVatCents))}</s-heading></s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base"><s-text type="strong">Te betalen btw</s-text><s-heading>{formatEuros(BigInt(data.vatDueCents))}</s-heading></s-box>
        </s-stack>
      </s-section>

      <s-section heading={`BTW-aangifte overnemen ${data.periodLabel}`}>
        <s-banner tone="warning">
          Controleer dit altijd vóór indienen. De app zet alle geïmporteerde Shopify-omzet voorlopig onder 1a hoog tarief. Splits 9%, 0%, EU/OSS, export en verlegde btw handmatig als dat bij jou voorkomt.
        </s-banner>

        <div style={{ overflowX: "auto", marginTop: "1rem" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "58rem" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: "1px solid #dfe3e8", padding: "0.6rem" }}>Rubriek</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #dfe3e8", padding: "0.6rem" }}>Omschrijving</th>
                <th style={{ textAlign: "right", borderBottom: "1px solid #dfe3e8", padding: "0.6rem" }}>Omzet / waarde excl. btw</th>
                <th style={{ textAlign: "right", borderBottom: "1px solid #dfe3e8", padding: "0.6rem" }}>Btw-bedrag</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #dfe3e8", padding: "0.6rem" }}>Opmerking</th>
              </tr>
            </thead>
            <tbody>
              {data.declarationRows.map((row) => (
                <tr key={row.code}>
                  <td style={{ borderBottom: "1px solid #f1f2f4", padding: "0.6rem", fontWeight: 700 }}>{row.code}</td>
                  <td style={{ borderBottom: "1px solid #f1f2f4", padding: "0.6rem" }}>{row.label}</td>
                  <td style={{ borderBottom: "1px solid #f1f2f4", padding: "0.6rem", textAlign: "right", whiteSpace: "nowrap" }}>{formatEuros(BigInt(row.amountCents))}</td>
                  <td style={{ borderBottom: "1px solid #f1f2f4", padding: "0.6rem", textAlign: "right", whiteSpace: "nowrap" }}>{formatEuros(BigInt(row.vatCents))}</td>
                  <td style={{ borderBottom: "1px solid #f1f2f4", padding: "0.6rem" }}>{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </s-section>

      <s-section heading="Status"><s-unordered-list><s-list-item>{data.orders} Shopify-orders opgeslagen in dit kwartaal</s-list-item><s-list-item>{data.journals} definitieve journaalposten in dit kwartaal</s-list-item><s-list-item>{data.errors} openstaande verwerkingsfouten</s-list-item></s-unordered-list></s-section>
      <s-section heading="Synchronisatie">
        <s-paragraph>Kies hierboven een jaar en kwartaal. Klik daarna op “Importeer dit kwartaal”; de app haalt dan precies die periode uit Shopify op.</s-paragraph>
      </s-section>
    </s-page>
  );
}
