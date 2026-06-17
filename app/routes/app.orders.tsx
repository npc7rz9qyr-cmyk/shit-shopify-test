import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ensureShop } from "../services/shop.server";
import { formatEuros } from "../services/money";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, admin);
  const orders = await prisma.orderSnapshot.findMany({ where: { shopId: shop.id }, orderBy: { processedAt: "desc" }, take: 100, include: { activeJournalEntry: true } });
  return { orders: orders.map((order) => ({ id: order.id, orderNumber: order.orderNumber, processedAt: order.processedAt.toISOString(), grossCents: order.grossCents.toString(), taxCents: order.taxCents.toString(), refundCents: order.refundCents.toString(), status: order.syncStatus, entryNumber: order.activeJournalEntry?.entryNumber || null })) };
};

export default function OrdersPage() {
  const { orders } = useLoaderData<typeof loader>();
  return <s-page heading="Verkoop"><s-button slot="primary-action" href="/app">Nieuwe import</s-button><s-section>{orders.length === 0 ? <s-paragraph>Nog geen orders geïmporteerd.</s-paragraph> : <s-table><s-table-header-row><s-table-header>Order</s-table-header><s-table-header>Datum</s-table-header><s-table-header>Bruto</s-table-header><s-table-header>Btw</s-table-header><s-table-header>Refund</s-table-header><s-table-header>Boeking</s-table-header></s-table-header-row><s-table-body>{orders.map((order) => <s-table-row key={order.id}><s-table-cell>{order.orderNumber}</s-table-cell><s-table-cell>{new Date(order.processedAt).toLocaleDateString("nl-NL")}</s-table-cell><s-table-cell>{formatEuros(BigInt(order.grossCents))}</s-table-cell><s-table-cell>{formatEuros(BigInt(order.taxCents))}</s-table-cell><s-table-cell>{formatEuros(BigInt(order.refundCents))}</s-table-cell><s-table-cell>{order.entryNumber ? `#${order.entryNumber}` : order.status}</s-table-cell></s-table-row>)}</s-table-body></s-table>}</s-section></s-page>;
}
