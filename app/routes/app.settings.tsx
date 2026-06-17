import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ensureShop } from "../services/shop.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, admin);
  return {
    shop: shop.domain,
    currency: shop.currency,
    countryCode: shop.countryCode,
    bookkeepingStart:
      shop.settings?.bookkeepingStart.toISOString().slice(0, 10) ||
      `${new Date().getFullYear()}-01-01`,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, admin);
  const formData = await request.formData();
  const value = String(formData.get("bookkeepingStart") || "");
  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    throw new Response("Ongeldige begindatum", { status: 400 });
  }

  await prisma.accountingSettings.upsert({
    where: { shopId: shop.id },
    update: { bookkeepingStart: date },
    create: { shopId: shop.id, bookkeepingStart: date },
  });

  return redirect("/app/settings?saved=1");
};

export default function SettingsPage() {
  const data = useLoaderData<typeof loader>();

  return (
    <s-page heading="Instellingen">
      <s-section heading="Shop">
        <dl style={{ display: "grid", gridTemplateColumns: "10rem 1fr", gap: "0.5rem 1rem", margin: 0 }}>
          <dt style={{ fontWeight: 600 }}>Domein</dt>
          <dd style={{ margin: 0 }}>{data.shop}</dd>
          <dt style={{ fontWeight: 600 }}>Valuta</dt>
          <dd style={{ margin: 0 }}>{data.currency}</dd>
          <dt style={{ fontWeight: 600 }}>Land</dt>
          <dd style={{ margin: 0 }}>{data.countryCode}</dd>
        </dl>
      </s-section>

      <s-section heading="Boekhoudperiode">
        <Form method="post">
          <div style={{ display: "grid", gap: "0.75rem", maxWidth: "24rem" }}>
            <label htmlFor="bookkeepingStart" style={{ fontWeight: 600 }}>
              Importeren vanaf
            </label>
            <input
              id="bookkeepingStart"
              name="bookkeepingStart"
              type="date"
              defaultValue={data.bookkeepingStart}
              required
              style={{ padding: "0.65rem", border: "1px solid #8c9196", borderRadius: "0.5rem" }}
            />
            <div>
              <s-button type="submit" variant="primary">
                Opslaan
              </s-button>
            </div>
          </div>
        </Form>
      </s-section>
    </s-page>
  );
}
