import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session } = await authenticate.webhook(request);
  await prisma.shop.updateMany({ where: { domain: shop }, data: { uninstalledAt: new Date() } });
  if (session) await prisma.session.deleteMany({ where: { shop } });
  return new Response();
};
