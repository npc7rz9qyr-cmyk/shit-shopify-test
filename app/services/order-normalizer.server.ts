import { moneyToCents } from "./money";

export type NormalizedOrder = {
  shopifyOrderId: string;
  orderNumber: string;
  processedAt: Date;
  currency: string;
  subtotalCents: bigint;
  taxCents: bigint;
  shippingCents: bigint;
  discountCents: bigint;
  grossCents: bigint;
  refundCents: bigint;
  refundTaxCents: bigint;
  taxesIncluded: boolean;
  source: unknown;
};

type MoneyBag = {
  shopMoney?: { amount?: string; currencyCode?: string };
};

type GraphqlOrder = {
  id: string;
  name: string;
  createdAt?: string | null;
  processedAt?: string | null;
  currencyCode: string;
  currentSubtotalPriceSet?: MoneyBag;
  currentTotalTaxSet?: MoneyBag;
  currentTotalPriceSet?: MoneyBag;
  currentTotalDiscountsSet?: MoneyBag;
  currentShippingPriceSet?: MoneyBag;
  taxesIncluded?: boolean;
  refunds?: Array<{
    id: string;
    totalRefundedSet?: MoneyBag;
    refundLineItems?: {
      nodes?: Array<{
        subtotalSet?: MoneyBag;
        totalTaxSet?: MoneyBag;
      }>;
    };
  }>;
};

function bagAmount(bag?: MoneyBag): bigint {
  return moneyToCents(bag?.shopMoney?.amount);
}

function orderDate(createdAt?: string | null, processedAt?: string | null) {
  return new Date(createdAt || processedAt || new Date().toISOString());
}

export function normalizeGraphqlOrder(order: GraphqlOrder): NormalizedOrder {
  const refunds = order.refunds || [];
  const refundCents = refunds.reduce(
    (sum, refund) => sum + bagAmount(refund.totalRefundedSet),
    0n,
  );
  const refundTaxCents = refunds.reduce(
    (refundSum, refund) =>
      refundSum +
      (refund.refundLineItems?.nodes || []).reduce(
        (lineSum, line) => lineSum + bagAmount(line.totalTaxSet),
        0n,
      ),
    0n,
  );

  return {
    shopifyOrderId: order.id,
    orderNumber: order.name,
    processedAt: orderDate(order.createdAt, order.processedAt),
    currency: order.currencyCode,
    subtotalCents: bagAmount(order.currentSubtotalPriceSet),
    taxCents: bagAmount(order.currentTotalTaxSet),
    shippingCents: bagAmount(order.currentShippingPriceSet),
    discountCents: bagAmount(order.currentTotalDiscountsSet),
    grossCents: bagAmount(order.currentTotalPriceSet),
    refundCents,
    refundTaxCents,
    taxesIncluded: Boolean(order.taxesIncluded),
    source: order,
  };
}

type WebhookOrder = Record<string, any>;

export function normalizeWebhookOrder(order: WebhookOrder): NormalizedOrder {
  const shippingAmount =
    order.total_shipping_price_set?.shop_money?.amount ??
    order.current_total_shipping_price_set?.shop_money?.amount ??
    "0";

  const refunds = Array.isArray(order.refunds) ? order.refunds : [];
  let refundCents = 0n;
  let refundTaxCents = 0n;

  for (const refund of refunds) {
    const transactions = Array.isArray(refund.transactions)
      ? refund.transactions
      : [];
    refundCents += transactions
      .filter((transaction: any) =>
        ["refund", "void"].includes(String(transaction.kind).toLowerCase()),
      )
      .reduce(
        (sum: bigint, transaction: any) =>
          sum + moneyToCents(transaction.amount),
        0n,
      );

    const lines = Array.isArray(refund.refund_line_items)
      ? refund.refund_line_items
      : [];
    refundTaxCents += lines.reduce(
      (sum: bigint, line: any) => sum + moneyToCents(line.total_tax),
      0n,
    );
  }

  return {
    shopifyOrderId: `gid://shopify/Order/${order.id}`,
    orderNumber: order.name || String(order.order_number || order.id),
    processedAt: orderDate(order.created_at, order.processed_at),
    currency: order.currency || order.presentment_currency || "EUR",
    subtotalCents: moneyToCents(
      order.current_subtotal_price ?? order.subtotal_price,
    ),
    taxCents: moneyToCents(order.current_total_tax ?? order.total_tax),
    shippingCents: moneyToCents(shippingAmount),
    discountCents: moneyToCents(
      order.current_total_discounts ?? order.total_discounts,
    ),
    grossCents: moneyToCents(order.current_total_price ?? order.total_price),
    refundCents,
    refundTaxCents,
    taxesIncluded: Boolean(order.taxes_included),
    source: order,
  };
}
