import type { LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ensureShop } from "../services/shop.server";
import { formatEuros } from "../services/money";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, admin);

  const [orders, journals, errors, totals] = await Promise.all([
    prisma.orderSnapshot.count({ where: { shopId: shop.id } }),
    prisma.journalEntry.count({ where: { shopId: shop.id, status: "POSTED" } }),
    prisma.syncError.count({ where: { shopId: shop.id, resolvedAt: null } }),
    prisma.orderSnapshot.aggregate({
      where: { shopId: shop.id },
      _sum: { grossCents: true, taxCents: true, refundCents: true },
    }),
  ]);

  return {
    shop: shop.domain,
    orders,
    journals,
    errors,
    grossCents: (totals._sum.grossCents || 0n).toString(),
    taxCents: (totals._sum.taxCents || 0n).toString(),
    refundCents: (totals._sum.refundCents || 0n).toString(),
  };
};

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();
  return (
    <s-page heading="Boekhouding">
      <s-button slot="primary-action" href="/app/orders">Bekijk verkoop</s-button>
      <s-section heading="Administratie">
        <s-stack direction="inline" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base"><s-text type="strong">Omzet na refunds</s-text><s-heading>{formatEuros(BigInt(data.grossCents))}</s-heading></s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base"><s-text type="strong">Btw</s-text><s-heading>{formatEuros(BigInt(data.taxCents))}</s-heading></s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base"><s-text type="strong">Refunds</s-text><s-heading>{formatEuros(BigInt(data.refundCents))}</s-heading></s-box>
        </s-stack>
      </s-section>
      <s-section heading="Status"><s-unordered-list><s-list-item>{data.orders} Shopify-orders opgeslagen</s-list-item><s-list-item>{data.journals} definitieve journaalposten</s-list-item><s-list-item>{data.errors} openstaande verwerkingsfouten</s-list-item></s-unordered-list></s-section>
      <s-section heading="Eerste synchronisatie">
        <s-paragraph>Importeer bestellingen vanaf de ingestelde begindatum. De import is idempotent: dezelfde order wordt niet dubbel geboekt.</s-paragraph>
        <Form method="post" action="/app/import"><s-button type="submit" variant="primary">Orders importeren</s-button></Form>
      </s-section>
    </s-page>
  );
}
