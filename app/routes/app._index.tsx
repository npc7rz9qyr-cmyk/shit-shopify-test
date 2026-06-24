import type { CSSProperties } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ensureShop } from "../services/shop.server";
import { formatEuros } from "../services/money";

function currentQuarterSelection() {
  const now = new Date();
  return { year: now.getFullYear(), quarter: Math.floor(now.getMonth() / 3) + 1 };
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

function quarterLabel(year: number, quarter: number) { return `Q${quarter} ${year}`; }
function positive(value: bigint) { return value > 0n ? value : 0n; }
function effectiveVatRate(exVatCents: bigint, vatCents: bigint) { if (exVatCents <= 0n || vatCents <= 0n) return 0; return Number((vatCents * 10000n) / exVatCents) / 100; }
function addToBox(box: { amount: bigint; vat: bigint }, amount: bigint, vat: bigint) { box.amount += amount; box.vat += vat; }
function yearOptions(selectedYear: number) { const currentYear = new Date().getFullYear(); const years = new Set<number>(); for (let year = currentYear + 1; year >= currentYear - 5; year -= 1) years.add(year); years.add(selectedYear); return Array.from(years).sort((a, b) => b - a); }

const nativeButtonStyle: CSSProperties = { minHeight: "2.25rem", padding: "0 0.9rem", border: "1px solid #303030", borderRadius: "0.5rem", background: "#303030", color: "white", fontWeight: 600, cursor: "pointer" };
const secondaryButtonStyle: CSSProperties = { ...nativeButtonStyle, background: "white", color: "#303030" };
const zeroCents = "0";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, admin);
  const url = new URL(request.url);
  const fallback = currentQuarterSelection();
  const selectedYear = parseYear(url.searchParams.get("year"), fallback.year);
  const selectedQuarter = parseQuarter(url.searchParams.get("quarter"), fallback.quarter);
  const { start, end } = quarterRange(selectedYear, selectedQuarter);
  const periodWhere = { shopId: shop.id, processedAt: { gte: start, lte: end } };
  const expenseWhere = { shopId: shop.id, date: { gte: start, lte: end } };

  const [orders, journals, errors, orderRows, expenseTotals, shippingTotals] = await Promise.all([
    prisma.orderSnapshot.count({ where: periodWhere }),
    prisma.journalEntry.count({ where: { shopId: shop.id, status: "POSTED", date: { gte: start, lte: end } } }),
    prisma.syncError.count({ where: { shopId: shop.id, resolvedAt: null } }),
    prisma.orderSnapshot.findMany({ where: periodWhere, select: { grossCents: true, taxCents: true, refundCents: true, refundTaxCents: true } }),
    prisma.expense.aggregate({ where: expenseWhere, _sum: { netCents: true, vatCents: true, totalCents: true } }),
    prisma.orderSnapshot.aggregate({ where: periodWhere, _sum: { shippingCents: true } }),
  ]);

  const vatBoxes = { high: { amount: 0n, vat: 0n }, low: { amount: 0n, vat: 0n }, zero: { amount: 0n, vat: 0n }, other: { amount: 0n, vat: 0n } };
  let grossSales = 0n;
  let refundCents = 0n;

  for (const order of orderRows) {
    const orderRefund = positive(order.refundCents || 0n);
    const orderRefundTax = positive(order.refundTaxCents || 0n);
    const grossAfterRefund = positive((order.grossCents || 0n) - orderRefund);
    const vatAfterRefund = positive((order.taxCents || 0n) - orderRefundTax);
    const exVat = positive(grossAfterRefund - vatAfterRefund);
    const rate = effectiveVatRate(exVat, vatAfterRefund);
    grossSales += grossAfterRefund;
    refundCents += orderRefund;
    if (vatAfterRefund === 0n) addToBox(vatBoxes.zero, exVat, vatAfterRefund);
    else if (rate >= 18 && rate <= 24) addToBox(vatBoxes.high, exVat, vatAfterRefund);
    else if (rate >= 6 && rate <= 12) addToBox(vatBoxes.low, exVat, vatAfterRefund);
    else addToBox(vatBoxes.other, exVat, vatAfterRefund);
  }

  const salesVat = vatBoxes.high.vat + vatBoxes.low.vat + vatBoxes.other.vat + vatBoxes.zero.vat;
  const purchaseVat = expenseTotals._sum.vatCents || 0n;
  const salesExVat = vatBoxes.high.amount + vatBoxes.low.amount + vatBoxes.other.amount + vatBoxes.zero.amount;
  const costNetCents = expenseTotals._sum.netCents || 0n;
  const vatDue = salesVat - purchaseVat;
  const shippingCents = shippingTotals._sum.shippingCents || 0n;
  const netAfterCostsCents = salesExVat - costNetCents;

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
    refundCents: refundCents.toString(),
    shippingCents: shippingCents.toString(),
    costNetCents: costNetCents.toString(),
    costVatCents: purchaseVat.toString(),
    costTotalCents: (expenseTotals._sum.totalCents || 0n).toString(),
    netAfterCostsCents: netAfterCostsCents.toString(),
    vatDueCents: vatDue.toString(),
    shippingExpenseStatus: url.searchParams.get("shippingExpense") || "",
    shippingExpenseError: url.searchParams.get("error") || "",
    shippingExpenseTotal: url.searchParams.get("shippingTotal") || "",
    shippingExpenseVat: url.searchParams.get("shippingVat") || "",
    declarationRows: [
      { code: "1a", label: "Leveringen/diensten belast met hoog tarief", amountCents: vatBoxes.high.amount.toString(), vatCents: vatBoxes.high.vat.toString(), note: "Automatisch gedetecteerd op effectief btw-tarief rond 21%." },
      { code: "1b", label: "Leveringen/diensten belast met laag tarief", amountCents: vatBoxes.low.amount.toString(), vatCents: vatBoxes.low.vat.toString(), note: "Automatisch gedetecteerd op effectief btw-tarief rond 9%." },
      { code: "1c", label: "Leveringen/diensten belast met overige tarieven, behalve 0%", amountCents: vatBoxes.other.amount.toString(), vatCents: vatBoxes.other.vat.toString(), note: "Orders met een afwijkend effectief btw-tarief. Controleer handmatig." },
      { code: "1d", label: "Privégebruik", amountCents: zeroCents, vatCents: zeroCents, note: "Alleen handmatig invullen indien van toepassing." },
      { code: "1e", label: "Leveringen/diensten belast met 0% of niet bij jou belast", amountCents: vatBoxes.zero.amount.toString(), vatCents: zeroCents, note: "Automatisch als order geen btw bevat. Controleer export/0%/verlegging handmatig." },
      { code: "2a", label: "Leveringen/diensten waarbij de btw naar jou is verlegd", amountCents: zeroCents, vatCents: zeroCents, note: "Nog handmatig; hiervoor bouwen we later kosten-/inkooptypes." },
      { code: "3a", label: "Leveringen naar landen buiten de EU", amountCents: zeroCents, vatCents: zeroCents, note: "Nog handmatig; exportdetectie op land volgt later." },
      { code: "3b", label: "Leveringen naar of diensten in landen binnen de EU", amountCents: zeroCents, vatCents: zeroCents, note: "Nog handmatig; ICP/B2B btw-id detectie volgt later." },
      { code: "3c", label: "Installatie/afstandsverkopen binnen de EU", amountCents: zeroCents, vatCents: zeroCents, note: "Nog handmatig; OSS-afhandeling volgt later." },
      { code: "4a", label: "Leveringen/diensten uit landen buiten de EU", amountCents: zeroCents, vatCents: zeroCents, note: "Nog handmatig; gebruik kostenfunctie voor normale voorbelasting." },
      { code: "4b", label: "Leveringen/diensten uit landen binnen de EU", amountCents: zeroCents, vatCents: zeroCents, note: "Nog handmatig; voor EU-diensten/verlegde btw komt aparte kostensoort." },
      { code: "5a", label: "Verschuldigde btw", amountCents: zeroCents, vatCents: salesVat.toString(), note: "Som van automatisch herkende btw uit 1a/1b/1c." },
      { code: "5b", label: "Voorbelasting", amountCents: costNetCents.toString(), vatCents: purchaseVat.toString(), note: "Btw op ingevoerde zakelijke kosten/inkopen, inclusief automatisch geboekte verzendkosten met 21% btw." },
      { code: "Saldo", label: "Te betalen / terug te vragen", amountCents: zeroCents, vatCents: vatDue.toString(), note: "5a min 5b. Negatief bedrag betekent terug te vragen." },
    ],
  };
};

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();
  return (
    <s-page heading="Boekhouding">
      <s-button slot="primary-action" href={`/app/orders?year=${data.selectedYear}&quarter=${data.selectedQuarter}`}>Bekijk verkoop</s-button>
      <s-section heading="Dashboard kwartaal">
        <Form method="get"><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))", gap: "0.75rem", alignItems: "end", maxWidth: "52rem" }}><div style={{ display: "grid", gap: "0.35rem" }}><label htmlFor="year" style={{ fontWeight: 600 }}>Jaar</label><select id="year" name="year" defaultValue={String(data.selectedYear)} style={{ padding: "0.65rem", border: "1px solid #8c9196", borderRadius: "0.5rem", background: "white" }}>{data.yearOptions.map((year) => <option key={year} value={year}>{year}</option>)}</select></div><div style={{ display: "grid", gap: "0.35rem" }}><label htmlFor="quarter" style={{ fontWeight: 600 }}>Kwartaal</label><select id="quarter" name="quarter" defaultValue={String(data.selectedQuarter)} style={{ padding: "0.65rem", border: "1px solid #8c9196", borderRadius: "0.5rem", background: "white" }}><option value="1">Q1 — januari t/m maart</option><option value="2">Q2 — april t/m juni</option><option value="3">Q3 — juli t/m september</option><option value="4">Q4 — oktober t/m december</option></select></div><div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}><button type="submit" style={secondaryButtonStyle}>Dashboard tonen</button><button type="submit" formMethod="post" formAction="/app/import" style={nativeButtonStyle}>Importeer dit kwartaal</button></div></div></Form>
      </s-section>
      <s-section heading={`Administratie ${data.periodLabel}`}>
        <s-paragraph>Periode: {new Date(data.periodStart).toLocaleDateString("nl-NL")} t/m {new Date(data.periodEnd).toLocaleDateString("nl-NL")}</s-paragraph>
        <s-stack direction="inline" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base"><s-text type="strong">Omzet excl. btw</s-text><s-heading>{formatEuros(BigInt(data.salesExVatCents))}</s-heading></s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base"><s-text type="strong">Btw verkoop</s-text><s-heading>{formatEuros(BigInt(data.taxCents))}</s-heading></s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base"><s-text type="strong">Verzendbedragen orders</s-text><s-heading>{formatEuros(BigInt(data.shippingCents))}</s-heading></s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base"><s-text type="strong">Refunds</s-text><s-heading>{formatEuros(BigInt(data.refundCents))}</s-heading></s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base"><s-text type="strong">Kosten excl. btw</s-text><s-heading>{formatEuros(BigInt(data.costNetCents))}</s-heading></s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base"><s-text type="strong">Netto na kosten</s-text><s-heading>{formatEuros(BigInt(data.netAfterCostsCents))}</s-heading></s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base"><s-text type="strong">Btw inkopen / 5b</s-text><s-heading>{formatEuros(BigInt(data.costVatCents))}</s-heading></s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base"><s-text type="strong">Te betalen btw</s-text><s-heading>{formatEuros(BigInt(data.vatDueCents))}</s-heading></s-box>
        </s-stack>
      </s-section>
      <s-section heading="Automatische verzendkosten boeken"><s-paragraph>Boek één kwartaalpost voor PostNL/verzendlabels op basis van de verzendbedragen uit de geïmporteerde Shopify-orders. De app behandelt het verzendbedrag als inclusief 21% btw en zet de btw automatisch op voorbelasting / 5b.</s-paragraph><Form method="post" action="/app/shipping-costs"><input type="hidden" name="year" value={data.selectedYear} /><input type="hidden" name="quarter" value={data.selectedQuarter} /><button type="submit" style={secondaryButtonStyle}>Boek/herboek verzendkosten met 21% btw</button></Form>{data.shippingExpenseStatus === "booked" ? <s-banner tone="success">Verzendkosten zijn geboekt: totaal {formatEuros(BigInt(data.shippingExpenseTotal || "0"))}, waarvan btw {formatEuros(BigInt(data.shippingExpenseVat || "0"))}.</s-banner> : null}{data.shippingExpenseStatus === "rebooked" ? <s-banner tone="success">Oude automatische verzendkostenpost is vervangen door een nieuwe post met 21% btw. Totaal {formatEuros(BigInt(data.shippingExpenseTotal || "0"))}, waarvan voorbelasting {formatEuros(BigInt(data.shippingExpenseVat || "0"))}.</s-banner> : null}{data.shippingExpenseStatus === "none" ? <s-banner tone="warning">Er zijn geen verzendbedragen gevonden in de geïmporteerde orders van dit kwartaal.</s-banner> : null}{data.shippingExpenseStatus === "error" ? <s-banner tone="critical">Verzendkosten boeken mislukt: {data.shippingExpenseError}</s-banner> : null}</s-section>
      <s-section heading={`BTW-aangifte overnemen ${data.periodLabel}`}><s-banner tone="warning">Controleer dit altijd vóór indienen. De app detecteert nu hoog/laag/0/overig via effectief btw-tarief per order. EU/OSS/export/verlegd blijven handmatig totdat die gegevens apart worden vastgelegd.</s-banner><div style={{ overflowX: "auto", marginTop: "1rem" }}><table style={{ width: "100%", borderCollapse: "collapse", minWidth: "58rem" }}><thead><tr><th style={{ textAlign: "left", borderBottom: "1px solid #dfe3e8", padding: "0.6rem" }}>Rubriek</th><th style={{ textAlign: "left", borderBottom: "1px solid #dfe3e8", padding: "0.6rem" }}>Omschrijving</th><th style={{ textAlign: "right", borderBottom: "1px solid #dfe3e8", padding: "0.6rem" }}>Omzet / waarde excl. btw</th><th style={{ textAlign: "right", borderBottom: "1px solid #dfe3e8", padding: "0.6rem" }}>Btw-bedrag</th><th style={{ textAlign: "left", borderBottom: "1px solid #dfe3e8", padding: "0.6rem" }}>Opmerking</th></tr></thead><tbody>{data.declarationRows.map((row) => <tr key={row.code}><td style={{ borderBottom: "1px solid #f1f2f4", padding: "0.6rem", fontWeight: 700 }}>{row.code}</td><td style={{ borderBottom: "1px solid #f1f2f4", padding: "0.6rem" }}>{row.label}</td><td style={{ borderBottom: "1px solid #f1f2f4", padding: "0.6rem", textAlign: "right", whiteSpace: "nowrap" }}>{formatEuros(BigInt(row.amountCents))}</td><td style={{ borderBottom: "1px solid #f1f2f4", padding: "0.6rem", textAlign: "right", whiteSpace: "nowrap" }}>{formatEuros(BigInt(row.vatCents))}</td><td style={{ borderBottom: "1px solid #f1f2f4", padding: "0.6rem" }}>{row.note}</td></tr>)}</tbody></table></div></s-section>
      <s-section heading="Status"><s-unordered-list><s-list-item>{data.orders} Shopify-orders opgeslagen in dit kwartaal</s-list-item><s-list-item>{data.journals} definitieve journaalposten in dit kwartaal</s-list-item><s-list-item>{data.errors} openstaande verwerkingsfouten</s-list-item></s-unordered-list></s-section>
      <s-section heading="Synchronisatie"><s-paragraph>Kies hierboven een jaar en kwartaal. Importeer eerst het kwartaal. Daarna kun je verzendkosten automatisch boeken/herboeken.</s-paragraph></s-section>
    </s-page>
  );
}
