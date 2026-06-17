import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ensureShop } from "../services/shop.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, admin);
  return { shop: shop.domain, currency: shop.currency, countryCode: shop.countryCode, bookkeepingStart: shop.settings?.bookkeepingStart.toISOString().slice(0, 10) || `${new Date().getFullYear()}-01-01` };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, admin);
  const formData = await request.formData();
  const value = String(formData.get("bookkeepingStart") || "");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Response("Ongeldige begindatum", { status: 400 });
  await prisma.accountingSettings.upsert({ where: { shopId: shop.id }, update: { bookkeepingStart: date }, create: { shopId: shop.id, bookkeepingStart: date } });
  return redirect("/app/settings?saved=1");
};

export default function SettingsPage() {
  const data = useLoaderData<typeof loader>();
  return <s-page heading="Instellingen"><s-section heading="Shop"><s-description-list><s-description-term>Domein</s-description-term><s-description-details>{data.shop}</s-description-details><s-description-term>Valuta</s-description-term><s-description-details>{data.currency}</s-description-details><s-description-term>Land</s-description-term><s-description-details>{data.countryCode}</s-description-details></s-description-list></s-section><s-section heading="Boekhoudperiode"><Form method="post"><s-text-field name="bookkeepingStart" label="Importeren vanaf" type="date" value={data.bookkeepingStart} /><s-button type="submit" variant="primary">Opslaan</s-button></Form></s-section></s-page>;
}
