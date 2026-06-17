import { createHash } from "node:crypto";
import prisma from "../db.server";

export async function startWebhookDelivery(args: {
  webhookId: string;
  shop: string;
  topic: string;
  payload: unknown;
}) {
  const payloadHash = createHash("sha256")
    .update(JSON.stringify(args.payload))
    .digest("hex");

  try {
    const delivery = await prisma.webhookDelivery.create({
      data: {
        id: args.webhookId,
        shopDomain: args.shop,
        topic: args.topic,
        payloadHash,
        status: "PROCESSING",
      },
    });
    return { duplicate: false as const, delivery };
  } catch {
    return { duplicate: true as const, delivery: null };
  }
}

export async function finishWebhook(
  webhookId: string,
  status: "PROCESSED" | "FAILED",
  error?: string,
) {
  await prisma.webhookDelivery.update({
    where: { id: webhookId },
    data: {
      status,
      error,
      processedAt: new Date(),
    },
  });
}
