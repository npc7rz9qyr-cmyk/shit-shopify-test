type LoginError = { shop?: string };

export function loginErrorMessage(loginErrors: unknown): LoginError {
  if (!loginErrors) return {};
  if (typeof loginErrors === "object" && loginErrors !== null) {
    const candidate = loginErrors as Record<string, unknown>;
    if (typeof candidate.shop === "string") return { shop: candidate.shop };
  }
  return { shop: "Controleer het myshopify.com-domein." };
}
