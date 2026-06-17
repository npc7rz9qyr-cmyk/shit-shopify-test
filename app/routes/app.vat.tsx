import type { LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ensureShop } from "../services/shop.server";
import { formatEuros } from "../services/money";

function defaultQuarter() { const now = new Date(); const startMonth = Math.floor(now.getMonth() / 3) * 3; return { start: new Date(Date.UTC(now.getFullYear(), startMonth, 1)), end: new Date(Date.UTC(now.getFullYear(), startMonth + 3, 0, 23, 59, 59)) }; }
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, admin);
  const url = new URL(request.url); const fallback = defaultQuarter();
  const start = url.searchParams.get("start") ? new Date(`${url.searchParams.get("start")}T00:00:00.000Z`) : fallback.start;
  const end = url.searchParams.get("end") ? new Date(`${url.searchParams.get("end")}T23:59:59.999Z`) : fallback.end;
  const accounts = await prisma.ledgerAccount.findMany({ where: { shopId: shop.id, systemKey: { in: ["VAT_PAYABLE", "VAT_RECEIVABLE", "SALES", "SHIPPING_REVENUE"] } }, include: { lines: { where: { entry: { date: { gte: start, lte: end }, status: { in: ["POSTED", "REVERSED"] } } } } } });
  const balance = (key: string) => { const account = accounts.find((item) => item.systemKey === key); return account ? account.lines.reduce((sum, line) => sum + line.creditCents - line.debitCents, 0n) : 0n; };
  const payable = balance("VAT_PAYABLE"); const receivable = -balance("VAT_RECEIVABLE"); const revenue = balance("SALES") + balance("SHIPPING_REVENUE");
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), payable: payable.toString(), receivable: receivable.toString(), net: (payable - receivable).toString(), revenue: revenue.toString() };
};
export default function VatPage() { const data = useLoaderData<typeof loader>(); return <s-page heading="Btw-overzicht"><s-section heading="Periode"><Form method="get"><s-stack direction="inline" gap="base"><s-text-field name="start" label="Van" type="date" value={data.start} /><s-text-field name="end" label="Tot en met" type="date" value={data.end} /><s-button type="submit">Berekenen</s-button></s-stack></Form></s-section><s-section heading="Voorlopige berekening"><s-description-list><s-description-term>Netto omzet</s-description-term><s-description-details>{formatEuros(BigInt(data.revenue))}</s-description-details><s-description-term>Af te dragen btw</s-description-term><s-description-details>{formatEuros(BigInt(data.payable))}</s-description-details><s-description-term>Voorbelasting</s-description-term><s-description-details>{formatEuros(BigInt(data.receivable))}</s-description-details><s-description-term>Per saldo</s-description-term><s-description-details>{formatEuros(BigInt(data.net))}</s-description-details></s-description-list><s-banner tone="warning">Dit MVP-overzicht bundelt alle btw. Controleer gemengde tarieven, EU/OSS en uitzonderingen vóór aangifte.</s-banner></s-section></s-page>; }
