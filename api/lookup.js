/**
 * OrderVault — /api/lookup
 * Vercel Edge Function: cerca info prodotto server-side (no CORS)
 * GET /api/lookup?url=PRODUCT_URL
 */

export const config = { runtime: 'edge' };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'public, s-maxage=180'
};

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const { searchParams } = new URL(request.url);
  const productUrl = searchParams.get('url');

  if (!productUrl || !productUrl.startsWith('http')) {
    return json({ error: 'invalid_url', source: null }, 400);
  }

  /* ── 1. Try UUFinds ── */
  const uuf = await searchUUFinds(productUrl);
  if (uuf && (uuf.title || uuf.images.length > 0)) {
    return json({ source: 'uufinds', ...uuf });
  }

  /* ── 2. Try the product page directly ── */
  const page = await scrapeProductPage(productUrl);
  if (page && (page.title || page.images.length > 0)) {
    return json({ source: 'page', ...page });
  }

  /* ── 3. Nothing found ── */
  return json({ source: null, title: '', images: [], weight: 0, price: 0 });
}

/* ════════════════════════════════════════════
   UUFINDS SEARCH
════════════════════════════════════════════ */
async function searchUUFinds(productUrl) {
  const encoded = encodeURIComponent(productUrl);
  const candidates = [
    `https://www.uufinds.com/?s=${encoded}`,
    `https://www.uufinds.com/s/?q=${encoded}`,
    `https://www.uufinds.com/search?q=${encoded}`,
    `https://www.uufinds.com/?q=${encoded}`
  ];

  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' },
        signal: AbortSignal.timeout(9000),
        redirect: 'follow'
      });
      if (!res.ok) continue;
      const html = await res.text();
      if (html.length < 400) continue;

      const data = extractFromHtml(html);
      if (data.title || data.images.length > 0) return data;
    } catch { /* try next */ }
  }
  return null;
}

/* ════════════════════════════════════════════
   PRODUCT PAGE SCRAPE (CNFans, OopBuy, etc.)
════════════════════════════════════════════ */
async function scrapeProductPage(productUrl) {
  try {
    const res = await fetch(productUrl, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(9000),
      redirect: 'follow'
    });
    if (!res.ok) return null;
    const html = await res.text();
    return extractFromHtml(html);
  } catch { return null; }
}

/* ════════════════════════════════════════════
   HTML PARSER (DOMParser available in Edge)
════════════════════════════════════════════ */
function extractFromHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  /* ── Title ── */
  const ogTitle  = doc.querySelector('meta[property="og:title"]')?.content || '';
  const metaTitle = doc.querySelector('meta[name="title"]')?.content || '';
  const h1       = doc.querySelector('h1, .product-name, .product-title, .item-name, .post-title')?.textContent?.trim() || '';
  const pageTitle = doc.querySelector('title')?.textContent || '';
  const rawTitle  = ogTitle || metaTitle || h1 || pageTitle;
  const title     = rawTitle.split(/\s*[-|—–]\s*/)[0].trim().slice(0, 140);

  /* ── Images ── */
  const seen   = new Set();
  const images = [];

  // Priority selectors — most likely to have QC/product photos
  const selectors = [
    '.post-content img', '.entry-content img', 'article img',
    '.product-images img', '.gallery img', '.swiper-slide img',
    '[class*="photo"] img', '[class*="image"] img', 'figure img',
    '.woocommerce-product-gallery img', '.product img', 'main img'
  ];

  for (const sel of selectors) {
    try {
      doc.querySelectorAll(sel).forEach(img => collectImg(img, images, seen));
    } catch {}
    if (images.length >= 8) break;
  }

  // Fallback: all images
  if (images.length === 0) {
    doc.querySelectorAll('img').forEach(img => collectImg(img, images, seen));
  }

  // Also check og:image
  const ogImage = doc.querySelector('meta[property="og:image"]')?.content;
  if (ogImage && !seen.has(ogImage) && ogImage.startsWith('http')) {
    images.unshift(ogImage); // put it first
  }

  /* ── Weight ── */
  const bodyText = doc.body?.textContent || '';
  const wm =
    bodyText.match(/重量[：:]\s*(\d+\.?\d*)\s*[gG克]/) ||
    bodyText.match(/[Ww]eight[:\s]+(\d+\.?\d*)\s*g\b/) ||
    bodyText.match(/(\d{2,4})\s*g(?:ram)?s?\b/);
  const weight = wm ? Math.round(parseFloat(wm[1])) : 0;

  /* ── Price ── */
  const pm = bodyText.match(/[¥$€£]\s*([\d,]+\.?\d{0,2})/);
  const price = pm ? parseFloat(pm[1].replace(/,/g, '')) : 0;

  /* ── Description ── */
  const desc = doc.querySelector('meta[property="og:description"]')?.content ||
               doc.querySelector('meta[name="description"]')?.content || '';

  return { title, images: images.slice(0, 6), weight, price, description: desc.slice(0, 200) };
}

function collectImg(img, images, seen) {
  if (images.length >= 10) return;
  const src =
    img.getAttribute('src') ||
    img.getAttribute('data-src') ||
    img.getAttribute('data-lazy-src') ||
    img.getAttribute('data-original') ||
    img.getAttribute('data-full') || '';
  if (!src) return;
  const abs = src.startsWith('//') ? 'https:' + src : src;
  if (!abs.startsWith('http') || seen.has(abs)) return;

  const low = abs.toLowerCase();
  // Skip icons / avatars / UI elements
  if (['avatar', 'logo', 'icon', 'loading', 'placeholder', 'spinner', 'banner', 'bg-', 'background', '.svg', 'emoji', 'star-'].some(k => low.includes(k))) return;

  // Skip tiny images (by attributes)
  const w = parseInt(img.getAttribute('width') || '0');
  const h = parseInt(img.getAttribute('height') || '0');
  if ((w > 0 && w < 80) || (h > 0 && h < 80)) return;

  seen.add(abs);
  images.push(abs);
}

/* ── Helpers ── */
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}
