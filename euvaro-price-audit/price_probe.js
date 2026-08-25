import { chromium } from 'playwright-core';
import fs from 'fs';

const IDS = ['1601710618572','1601622528018','1601418450054','1601706114588','1601439204847'];

function priceish(obj, path='', depth=0, out=[]) {
  if (depth > 7 || obj == null) return out;
  if (Array.isArray(obj)) {
    for (let i=0; i<Math.min(obj.length,60); i++) priceish(obj[i], `${path}[${i}]`, depth+1, out);
    return out;
  }
  if (typeof obj !== 'object') return out;
  for (const [k,v] of Object.entries(obj)) {
    const p = path ? `${path}.${k}` : k;
    if (/price|sku|range|promotion|moq|quantity/i.test(k)) {
      let val=v;
      try {
        const s=JSON.stringify(v);
        if (s && s.length > 2500) val = s.slice(0,2500)+'…';
      } catch {}
      out.push({path:p,value:val});
      if (out.length > 500) return out;
    }
    if (typeof v === 'object' && v !== null) priceish(v,p,depth+1,out);
    if (out.length > 500) return out;
  }
  return out;
}

(async()=>{
  const browser = await chromium.launch({headless:true, executablePath:'/usr/bin/google-chrome', args:['--no-sandbox','--disable-dev-shm-usage']});
  const context = await browser.newContext({
    locale:'en-US',
    timezoneId:'Europe/Amsterdam',
    viewport:{width:1440,height:1000},
    userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
  });
  const results=[];
  for (const id of IDS) {
    const page=await context.newPage();
    const rec={id};
    try {
      const url=`https://www.alibaba.com/product-detail/_${id}.html`;
      const resp=await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
      rec.http_status=resp ? resp.status() : null;
      await page.waitForTimeout(5000);
      rec.url=page.url();
      rec.title=await page.title();
      rec.h1=await page.locator('h1').first().textContent().catch(()=>null);
      rec.body_head=(await page.locator('body').innerText().catch(()=>'' )).slice(0,10000);
      rec.data=await page.evaluate(()=>{
        const pick={};
        for (const k of ['detailData','__INITIAL_STATE__','__NEXT_DATA__','__APOLLO_STATE__']) {
          try { if (window[k]) pick[k]=window[k]; } catch(e) {}
        }
        const scripts=[...document.scripts].map(s=>s.textContent||'').filter(t=>/productRangePrices|sku|price/i.test(t)).slice(0,10).map(t=>t.slice(0,12000));
        pick.__price_scripts=scripts;
        return pick;
      });
      rec.priceish=priceish(rec.data);
      rec.dom_price_texts=await page.locator('[class*="price" i], [data-testid*="price" i]').allTextContents().catch(()=>[]);
      rec.dom_price_texts=[...new Set(rec.dom_price_texts.map(x=>x.trim()).filter(Boolean))].slice(0,100);
      console.log('PROBE',id,JSON.stringify({status:rec.http_status,url:rec.url,title:rec.title,h1:rec.h1,dom:rec.dom_price_texts.slice(0,15),paths:rec.priceish.slice(0,30)},null,2));
    } catch(e) {
      rec.error=String(e && e.stack || e);
      console.error('ERROR',id,rec.error);
    } finally {
      results.push(rec);
      await page.close();
    }
  }
  fs.writeFileSync('probe-results.json',JSON.stringify(results,null,2));
  await browser.close();
})();
