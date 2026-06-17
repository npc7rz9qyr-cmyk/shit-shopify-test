export const loader = async () => Response.json({ status: "ok", service: "shopify-boekhouding", time: new Date().toISOString() });
