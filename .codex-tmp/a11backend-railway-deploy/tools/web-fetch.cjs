const axios = require('axios');
const playwright = require('playwright');

async function web_fetch(args) {
  const url = args.url;
  if (!url) throw new Error('web_fetch: missing url');
  const browser = await playwright.chromium.launch();
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  const html = await page.content();
  const text = await page.evaluate(() => document.body?.innerText || '');
  const title = await page.title();
  const links = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map(a => ({ href: a.href, text: a.innerText || '' })));
  await browser.close();
  return { url, fetchedAt: Date.now(), title, html, text, links };
}

module.exports = { web_fetch };