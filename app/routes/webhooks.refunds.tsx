import type { ActionFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { ensureShop } from "../services/shop.server";
import { importSingleOrder } from "../services/refund-refresh.server";
import { finishWebhook, startWebhookDelivery } from "../services/webhook.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const webhookId = request.headers.get("x-shopify-webhook-id") || `${shop}:${topic}:${Date.now()}`;
  const delivery = await startWebhookDelivery({ webhookId, shop, topic, payload });
  if (delivery.duplicate) return new Response(null, { status: 200 });
  try {
    const orderId = (payload as { order_id?: number }).order_id;
    if (!orderId) throw new Error("Refund webhook bevat geen order_id");
    const shopRecord = await ensureShop(shop);
    const { admin } = await unauthenticated.admin(shop);
    await importSingleOrder(admin, shopRecord.id, `gid://shopify/Order/${orderId}`);
    await finishWebhook(webhookId, "PROCESSED");
    return new Response(null, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishWebhook(webhookId, "FAILED", message);
    return new Response(message, { status: 500 });
  }
};
