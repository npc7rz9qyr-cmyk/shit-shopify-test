#!/usr/bin/env bash
set -u
cd "$(dirname "$0")"
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'
CSRF='https://myconnections.alibaba.com/ajax/ecology/csrf/token'
API='https://myconnections.alibaba.com/ajax/ecology/distribution/product/search'
rm -f cookies.txt csrf.json api-summary.json results.ndjson api-test-*.json
csrf_code=$(curl -L -sS -A "$UA" -H 'Accept: application/json, text/plain, */*' -c cookies.txt -o csrf.json -w '%{http_code}' "$CSRF" || true)
token=$(jq -r '.token // .data.token // empty' csrf.json 2>/dev/null || true)
printf 'CSRF HTTP %s token_len=%s\n' "$csrf_code" "${#token}"
if [ -z "$token" ]; then jq -n --arg code "$csrf_code" '{error:"no_csrf",csrf_http:$code}' > api-summary.json; exit 0; fi
base='{"categoryId":"","index":1,"size":20,"sortBy":"relevance","useNewSearchEngine":true,"cur":"EUR","disableCorrection":false,"tag":"europe"}'
tests=(
 'keyword_id|{"keyword":"1601622528018"}'
 'keyword_title|{"keyword":"Akko 5098B"}'
 'searchText_id|{"searchText":"1601622528018"}'
 'searchText_title|{"searchText":"Akko 5098B"}'
 'query_id|{"query":"1601622528018"}'
 'q_id|{"q":"1601622528018"}'
 'productId_string|{"productId":"1601622528018"}'
 'productId_number|{"productId":1601622528018}'
 'productIds|{"productIds":[1601622528018]}'
 'offerId|{"offerId":"1601622528018"}'
)
for entry in "${tests[@]}"; do
  label=${entry%%|*}; extra=${entry#*|}
  payload=$(jq -nc --argjson b "$base" --argjson e "$extra" '$b * $e')
  out="api-test-${label}.json"
  code=$(curl -L -sS -A "$UA" -H 'Accept: application/json, text/plain, */*' -H 'Content-Type: application/json' -H "X-XSRF-TOKEN: $token" -b cookies.txt -c cookies.txt --data "$payload" -o "$out" -w '%{http_code}' "$API" || true)
  jq -nc --arg label "$label" --arg code "$code" --slurpfile j "$out" '{label:$label,http:$code,success:($j[0].success//null),message:($j[0].message//null),total:($j[0].data.pagination.totalProductCount//null),offers:[($j[0].data.offerList//[])[:5][]|{id:(.productId//.id),title:.information.title,price:(.promotionInfoVO.localPromotionPriceFromStr//.promotionInfoVO.localOriginalPriceFromStr//.promotionInfoVO.priceV2),range:(.promotionInfoVO.localPromotionPriceRangeStr//.promotionInfoVO.localOriginalPriceRangeStr//.promotionInfoVO.priceV2)}]}' >> results.ndjson
  echo "$label HTTP $code first=$(jq -r '.data.offerList[0].productId // empty' "$out") total=$(jq -r '.data.pagination.totalProductCount // empty' "$out")"
done
jq -s --arg csrf_http "$csrf_code" '{csrf_http:$csrf_http,tests:.}' results.ndjson > api-summary.json
cp api-test-keyword_id.json api-page-1.json
cp api-test-searchText_id.json api-page-2.json
