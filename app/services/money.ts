export function moneyToCents(value: string | number | null | undefined): bigint {
  if (value === null || value === undefined || value === "") return 0n;
  const normalized = String(value).replace(",", ".").trim();
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    throw new Error(`Ongeldig geldbedrag: ${value}`);
  }

  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole, fraction = ""] = unsigned.split(".");
  const cents = BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
  return negative ? -cents : cents;
}

export function centsToNumber(value: bigint): number {
  return Number(value) / 100;
}

export function formatEuros(value: bigint | number | string): string {
  const amount =
    typeof value === "bigint"
      ? Number(value) / 100
      : typeof value === "string"
        ? Number(value) / 100
        : value;

  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}

export function allocateProportionally(
  total: bigint,
  weights: bigint[],
): bigint[] {
  if (weights.length === 0) return [];
  const weightTotal = weights.reduce((sum, value) => sum + value, 0n);
  if (weightTotal === 0n) {
    const base = total / BigInt(weights.length);
    const result = weights.map(() => base);
    result[result.length - 1] += total - base * BigInt(weights.length);
    return result;
  }

  let allocated = 0n;
  const result = weights.map((weight, index) => {
    if (index === weights.length - 1) return total - allocated;
    const share = (total * weight) / weightTotal;
    allocated += share;
    return share;
  });
  return result;
}
