import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../services/shop.server";
import { normalizeWebhookOrder } from "../services/order-normalizer.server";
import { postOrder } from "../services/accounting.server";
import { finishWebhook, startWebhookDelivery } from "../services/webhook.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const webhookId = request.headers.get("x-shopify-webhook-id") || `${shop}:${topic}:${Date.now()}`;
  const delivery = await startWebhookDelivery({ webhookId, shop, topic, payload });
  if (delivery.duplicate) return new Response(null, { status: 200 });
  try {
    const shopRecord = await ensureShop(shop);
    await postOrder(shopRecord.id, normalizeWebhookOrder(payload as Record<string, any>));
    await finishWebhook(webhookId, "PROCESSED");
    return new Response(null, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishWebhook(webhookId, "FAILED", message);
    return new Response(message, { status: 500 });
  }
};
