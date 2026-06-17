import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ensureShop } from "../services/shop.server";
import { importPayouts } from "../services/import-payouts.server";
import { formatEuros } from "../services/money";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, admin);
  const payouts = await prisma.payout.findMany({ where: { shopId: shop.id }, orderBy: { issuedAt: "desc" }, take: 100, include: { journalEntry: true } });
  return { payouts: payouts.map((payout) => ({ id: payout.id, legacyResourceId: payout.legacyResourceId, issuedAt: payout.issuedAt.toISOString(), status: payout.status, netCents: payout.netCents.toString(), feeCents: payout.feeCents.toString(), clearingCents: payout.clearingCents.toString(), entryNumber: payout.journalEntry?.entryNumber || null })) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, admin);
  const startDate = shop.settings?.bookkeepingStart || new Date(new Date().getFullYear(), 0, 1);
  const result = await importPayouts(admin, shop.id, startDate);
  return redirect(`/app/payouts?imported=${result.imported}`);
};

export default function PayoutsPage() {
  const { payouts } = useLoaderData<typeof loader>();
  return <s-page heading="Shopify-uitbetalingen"><Form method="post"><s-button slot="primary-action" type="submit" variant="primary">Uitbetalingen importeren</s-button></Form><s-section>{payouts.length === 0 ? <s-paragraph>Nog geen uitbetalingen geïmporteerd.</s-paragraph> : <s-table><s-table-header-row><s-table-header>Uitbetaling</s-table-header><s-table-header>Datum</s-table-header><s-table-header>Netto bank</s-table-header><s-table-header>Kosten</s-table-header><s-table-header>Tussenrekening</s-table-header><s-table-header>Boeking</s-table-header></s-table-header-row><s-table-body>{payouts.map((payout) => <s-table-row key={payout.id}><s-table-cell>{payout.legacyResourceId}</s-table-cell><s-table-cell>{new Date(payout.issuedAt).toLocaleDateString("nl-NL")}</s-table-cell><s-table-cell>{formatEuros(BigInt(payout.netCents))}</s-table-cell><s-table-cell>{formatEuros(BigInt(payout.feeCents))}</s-table-cell><s-table-cell>{formatEuros(BigInt(payout.clearingCents))}</s-table-cell><s-table-cell>{payout.entryNumber ? `#${payout.entryNumber}` : payout.status}</s-table-cell></s-table-row>)}</s-table-body></s-table>}</s-section></s-page>;
}
