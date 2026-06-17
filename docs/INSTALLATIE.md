# Installatiechecklist Shopify + Render

## Shopify Dev Dashboard

- [ ] App aangemaakt
- [ ] Custom distribution geselecteerd
- [ ] Client ID/API key genoteerd
- [ ] Client secret genoteerd
- [ ] `shopify.app.toml` voorzien van client ID en Render-URL
- [ ] App URL en redirect-URL's ingesteld
- [ ] Scopes `read_orders` en `read_shopify_payments_payouts` toegestaan
- [ ] `read_all_orders` toegestaan, of uit de configuratie verwijderd wanneer alleen 60 dagen nodig zijn
- [ ] `shopify app config link` uitgevoerd
- [ ] `shopify app deploy` uitgevoerd
- [ ] App in de juiste Shopify-winkel geïnstalleerd

## Render

- [ ] GitHub-repository via **New > Blueprint** gekoppeld
- [ ] Webservice en PostgreSQL-database aangemaakt
- [ ] `SHOPIFY_API_KEY` ingevuld
- [ ] `SHOPIFY_API_SECRET` ingevuld
- [ ] `SHOPIFY_APP_URL` ingevuld met volledige HTTPS-URL
- [ ] Eerste deploy is groen
- [ ] Pre-deploy migration is geslaagd
- [ ] `/healthz` geeft een succesvolle reactie

## Eerste functionele controle

- [ ] Dashboard opent embedded in Shopify Admin
- [ ] Boekhoudbegindatum ingesteld
- [ ] Testorder geïmporteerd
- [ ] Journaalpost van de testorder is in balans
- [ ] Testrefund geeft een tegenboeking en een nieuwe actuele boeking
- [ ] De refund wordt niet dubbel van Shopify `current*`-totalen afgetrokken
- [ ] Dezelfde webhook opnieuw versturen maakt geen dubbele boeking
- [ ] Een payout met status `PAID` boekt bank, kosten en tussenrekening
- [ ] Een nog niet betaalde of mislukte payout maakt geen bankboeking
- [ ] Handmatige kostenboeking boekt kosten, voorbelasting en bank
- [ ] Btw-overzicht is gecontroleerd
- [ ] Proefbalans is in evenwicht
- [ ] CSV-export opent correct in Excel

## Voor live gebruik laten controleren

- [ ] Grootboekcodes akkoord door boekhouder
- [ ] Btw-behandeling van alle verkochte productsoorten gecontroleerd
- [ ] EU/OSS/ICP en export beoordeeld
- [ ] Beginbalans ingevoerd of apart gedocumenteerd
- [ ] Back-up- en bewaarbeleid ingericht
- [ ] Maandelijkse aansluiting Shopify-tussenrekening op payouts vastgelegd
