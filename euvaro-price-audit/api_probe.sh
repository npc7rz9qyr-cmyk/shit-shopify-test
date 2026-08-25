#!/usr/bin/env bash
set -u
cd "$(dirname "$0")"
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'
CSRF='https://myconnections.alibaba.com/ajax/ecology/csrf/token'
API='https://myconnections.alibaba.com/ajax/ecology/distribution/product/search'
rm -f cookies.txt csrf.json api-page-1.json api-page-2.json api-summary.json
csrf_code=$(curl -L -sS -A "$UA" -H 'Accept: application/json, text/plain, */*' -c cookies.txt -o csrf.json -w '%{http_code}' "$CSRF" || true)
token=$(jq -r '.token // .data.token // empty' csrf.json 2>/dev/null || true)
printf 'CSRF HTTP %s token_len=%s\n' "$csrf_code" "${#token}"
if [ -z "$token" ]; then
  jq -n --arg csrf_http "$csrf_code" --arg csrf_body "$(head -c 2000 csrf.json 2>/dev/null || true)" '{csrf_http:$csrf_http,csrf_body:$csrf_body,error:"no_csrf_token"}' > api-summary.json
  exit 0
fi
for page in 1 2; do
  payload=$(jq -nc --argjson page "$page" '{categoryId:"",index:$page,size:20,sortBy:"relevance",useNewSearchEngine:true,cur:"EUR",disableCorrection:false,tag:"europe"}')
  code=$(curl -L -sS -A "$UA" -H 'Accept: application/json, text/plain, */*' -H 'Content-Type: application/json' -H "X-XSRF-TOKEN: $token" -b cookies.txt -c cookies.txt --data "$payload" -o "api-page-${page}.json" -w '%{http_code}' "$API" || true)
  printf 'API page %s HTTP %s bytes=%s\n' "$page" "$code" "$(wc -c < "api-page-${page}.json" 2>/dev/null || echo 0)"
done
jq -n --arg csrf_http "$csrf_code" --slurpfile p1 api-page-1.json --slurpfile p2 api-page-2.json '{csrf_http:$csrf_http,page1:($p1[0]//null),page2:($p2[0]//null)}' > api-summary.json 2>/dev/null || true
