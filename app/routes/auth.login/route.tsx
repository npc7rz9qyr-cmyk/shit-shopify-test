import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";

export const loader = async ({ request }: LoaderFunctionArgs) => ({ errors: loginErrorMessage(await login(request)) });
export const action = async ({ request }: ActionFunctionArgs) => ({ errors: loginErrorMessage(await login(request)) });

export default function AuthLogin() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [shop, setShop] = useState("");
  const { errors } = actionData || loaderData;
  return <AppProvider embedded={false}><s-page heading="Shopify Boekhouding"><Form method="post"><s-section heading="Inloggen"><s-text-field name="shop" label="Shopdomein" details="bijvoorbeeld jouw-winkel.myshopify.com" value={shop} onChange={(event) => setShop(event.currentTarget.value)} autocomplete="on" error={errors.shop} /><s-button type="submit" variant="primary">Inloggen</s-button></s-section></Form></s-page></AppProvider>;
}
