# Shopify Boekhouding

Een embedded Shopify-app met een React Router/Node-backend en PostgreSQL op Render. Deze eerste werkende versie verwerkt de verkoopadministratie van één Shopify-winkel en vormt de basis voor een zelfstandig Nederlands boekhoudprogramma.

## Wat deze MVP doet

- Shopify OAuth en sessieopslag in PostgreSQL
- Historische orders importeren vanaf een instelbare datum
- Webhooks voor nieuwe, gewijzigde en geannuleerde orders
- Refund-webhook die de actuele order opnieuw ophaalt
- Shopify `current*`-bedragen gebruiken, zodat refunds niet dubbel worden afgetrokken
- Idempotente verwerking via webhook-ID en SHA-256-bronhash
- Dubbele journaalposten voor omzet, verzending, btw en Shopify-tussenrekening
- Wijzigingen corrigeren met tegenboekingen; journaalposten worden niet verwijderd
- Shopify Payments-payouts en balance transactions importeren
- Alleen payouts met status `PAID` op bank en tussenrekening boeken
- Positieve en negatieve payouts en fee-correcties verwerken
- Handmatig betaalde bedrijfskosten met voorbelasting boeken
- Dashboard, verkoop, kosten, payouts, journaal, btw-overzicht en proefbalans
- CSV-export van het volledige journaal
- Render Blueprint met webservice en PostgreSQL
- GitHub Actions voor typecheck, tests en productie-build

## Grenzen van deze eerste versie

Gebruik deze MVP eerst als controleerbare verkoop- en kostenadministratie. Laat vóór een echte btw-aangifte een boekhouder de inrichting en uitkomsten controleren. Nog niet volledig uitgewerkt zijn:

- uitsplitsing van gemengde btw-tarieven per aangifterubriek;
- EU/ICP/OSS, export en verlegde btw;
- cadeaubonnen, fooien, invoerrechten en complexe orderaanpassingen;
- bankbestandimport of PSD2-bankkoppeling;
- inkoopfactuur-PDF's en OCR;
- beginbalans, debiteuren/crediteuren en boekjaarafsluiting;
- gebruikersrollen, periodeblokkering en externe back-uparchieven.

De app boekt bedragen in Shopify `shopMoney`, dus in de basisvaluta van de winkel. Bij gemengde btw-tarieven wordt de totale Shopify-btw geboekt, maar nog niet uitgesplitst over 21%, 9% en 0%.

## Installatie in het kort

### 1. Shopify-app maken

Maak in het Shopify Dev Dashboard een app met custom distribution en noteer:

- Client ID / API key;
- Client secret;
- het permanente `myshopify.com`-domein.

Pas in `shopify.app.toml` aan:

- `client_id`;
- `application_url`;
- de drie `redirect_urls`.

`read_all_orders` is nodig voor orders ouder dan 60 dagen en kan aanvullende goedkeuring vereisen. Zonder dit recht kun je de scope tijdelijk verwijderen en alleen recente orders importeren.

### 2. Render Blueprint maken

1. Koppel deze GitHub-repository in Render via **New > Blueprint**.
2. Render leest `render.yaml` en maakt een webservice plus PostgreSQL-database.
3. Vul in Render in:
   - `SHOPIFY_API_KEY`;
   - `SHOPIFY_API_SECRET`;
   - `SHOPIFY_APP_URL`, bijvoorbeeld `https://jouw-app.onrender.com`.
4. Start de deploy en controleer `/healthz`.

### 3. Shopify-configuratie publiceren

Voer lokaal uit:

```bash
npm install
npx prisma generate
npm run typecheck
npm test
shopify app config link
shopify app deploy
```

Installeer de app daarna via de custom installatielink uit het Shopify Dev Dashboard.

### 4. Eerste gebruik

1. Open **Apps > Shopify Boekhouding**.
2. Stel onder **Instellingen** de begindatum in.
3. Importeer orders vanaf het dashboard.
4. Importeer payouts via **Uitbetalingen**.
5. Boek overige uitgaven via **Kosten**.
6. Controleer **Boekingen**, **Btw** en **Rapportages**.
7. Download een CSV voor archief of boekhouder.

De uitgebreide checklist staat in [`docs/INSTALLATIE.md`](docs/INSTALLATIE.md).

## Lokaal ontwikkelen

```bash
cp .env.example .env
npm install
npx prisma generate
shopify app dev
```

Lokale PostgreSQL:

```bash
docker run --name shopify-accounting-db \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=shopify_boekhouding \
  -p 5432:5432 -d postgres:17
```

`.env`:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/shopify_boekhouding
DIRECT_URL=postgresql://postgres:postgres@localhost:5432/shopify_boekhouding
```

## Veiligheid en audit

- Geen secrets in GitHub.
- Shopify-authenticatie en webhook-HMAC via de officiële Shopify-library.
- Webhook-ID's blokkeren dubbele verwerking.
- Gewijzigde orders en payouts krijgen eerst een tegenboeking.
- Geldbedragen worden als gehele centen (`BigInt`) opgeslagen.
- Brondata en bronhash blijven bewaard.
- Journaalposten worden niet hard verwijderd via de interface.

## Projectstructuur

```text
.github/workflows/ci.yml  typecheck, tests en build
app/routes/               Shopify-interface, exports en webhooks
app/services/             normalisatie en boekingsmotor
prisma/                   PostgreSQL-schema en migratie
tests/                    boekingsmotortests
render.yaml               Render webservice + database
shopify.app.toml          Shopify-appconfiguratie
```
