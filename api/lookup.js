/**
 * OrderVault — /api/lookup  (v2)
 * Vercel Edge Function
 * GET /api/lookup?url=PRODUCT_URL
 *
 * Strategy:
 *  1. Product page  → og:tags + JSON-LD + embedded SSR JSON (Nuxt/Next)
 *  2. UUFinds       → WordPress REST API → Next.js _next/data → direct scrape
 *  3. Return best result
 */

export const config = { runtime: 'edge' };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const CORS_H = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'public, s-maxage=120'
};

export default async function handler(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_H });

  const { searchParams } = new URL(request.url);
  const productUrl = searchParams.get('url');
  if (!productUrl?.startsWith('http')) return json({ error: 'invalid_url', source: null }, 400);

  /* Run product page + UUFinds in parallel for speed */
  const [pageData, uufData] = await Promise.allSettled([
    scrapeProductPage(productUrl),
    searchUUFinds(productUrl)
  ]);

  const page = pageData.status === 'fulfilled' ? pageData.value : null;
  const uuf  = uufData.status  === 'fulfilled' ? uufData.value  : null;

  /* Prefer UUFinds (has QC photos), fall back to product page */
  if (uuf && (uuf.title || uuf.images.length > 0)) {
    return json({
      source: 'uufinds',
      title:  uuf.title  || page?.title  || '',
      images: uuf.images.length ? uuf.images : (page?.images || []),
      weight: uuf.weight || page?.weight || 0,
      price:  uuf.price  || page?.price  || 0
    });
  }

  if (page && (page.title || page.images.length > 0)) {
    return json({ source: 'page', ...page });
  }

  return json({ source: null, title: '', images: [], weight: 0, price: 0 });
}

/* ════════════════════════════════════════════
   1 — PRODUCT PAGE (CNFans, OopBuy, Pandabuy…)
════════════════════════════════════════════ */
async function scrapeProductPage(url) {
  const html = await fetchHtml(url, 10000);
  if (!html) return null;
  return parseHtml(html);
}

/* ════════════════════════════════════════════
   2 — UUFINDS  (try 3 methods)
════════════════════════════════════════════ */
async function searchUUFinds(productUrl) {

  /* ── Method A: WordPress REST API ── */
  try {
    const q = encodeURIComponent(productUrl);
    const wpUrl = `https://www.uufinds.com/wp-json/wp/v2/posts?search=${q}&per_page=5&_embed=true`;
    const res = await fetchJSON(wpUrl, 7000);
    if (Array.isArray(res) && res.length > 0) {
      const post  = res[0];
      const title = stripHtmlTags(post.title?.rendered || '');
      const imgs  = [];
      // Featured image
      const feat  = post._embedded?.['wp:featuredmedia']?.[0];
      if (feat?.source_url) imgs.push(feat.source_url);
      // Images from media gallery in _embedded
      const gallery = post._embedded?.['wp:attachment'] || [];
      gallery.flat().forEach(m => { if (m?.source_url) imgs.push(m.source_url); });
      // Images from content HTML
      if (post.content?.rendered) {
        const contentImgs = extractImagesFromHtml(post.content.rendered);
        imgs.push(...contentImgs);
      }
      if (title || imgs.length) return { title, images: [...new Set(imgs)].slice(0, 6), weight: 0, price: 0 };
    }
  } catch { /* try next */ }

  /* ── Method B: Next.js _next/data endpoint ── */
  try {
    const mainHtml = await fetchHtml('https://www.uufinds.com', 6000);
    if (mainHtml) {
      const buildIdMatch = mainHtml.match(/"buildId"\s*:\s*"([^"]+)"/);
      if (buildIdMatch) {
        const buildId = buildIdMatch[1];
        const q = encodeURIComponent(productUrl);
        /* Try common Next.js search page paths */
        const paths = ['s', 'search', 'find'];
        for (const path of paths) {
          const dataUrl = `https://www.uufinds.com/_next/data/${buildId}/${path}.json?q=${q}`;
          const data = await fetchJSON(dataUrl, 6000);
          if (data) {
            const extracted = parseNextData(data);
            if (extracted?.title || extracted?.images?.length) return extracted;
          }
        }
      }
    }
  } catch { /* try next */ }

  /* ── Method C: Direct scrape (works if SSR) ── */
  try {
    const q = encodeURIComponent(productUrl);
    const urls = [
      `https://www.uufinds.com/?s=${q}`,
      `https://www.uufinds.com/s/?q=${q}`,
      `https://www.uufinds.com/search?q=${q}`
    ];
    for (const u of urls) {
      const html = await fetchHtml(u, 7000);
      if (!html || html.length < 500) continue;
      const data = parseHtml(html);
      if (data.title || data.images.length) return data;
    }
  } catch { /* give up */ }

  return null;
}

/* ════════════════════════════════════════════
   HTML PARSER — multi-strategy
════════════════════════════════════════════ */
function parseHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  /* ── Title ── */
  let title = '';
  // 1. og:title
  title = doc.querySelector('meta[property="og:title"]')?.content?.trim() || '';
  // 2. JSON-LD Product
  if (!title) {
    const ld = findJsonLd(doc, ['Product', 'ItemPage']);
    if (ld) title = ld.name || ld.headline || '';
  }
  // 3. Embedded SSR JSON (Nuxt/Next)
  if (!title) {
    const ssrData = extractSsrJson(html);
    if (ssrData) title = extractTitle(ssrData);
  }
  // 4. Visible heading
  if (!title) {
    title = doc.querySelector('h1, h2, .product-name, .product-title, .item-name, .goods-name')?.textContent?.trim() || '';
  }
  // 5. Page <title>
  if (!title) title = doc.querySelector('title')?.textContent || '';
  title = title.split(/\s*[-|—–|_]\s*/)[0].trim().slice(0, 140);

  /* ── Images ── */
  const images = [];
  const seen   = new Set();

  // og:image first
  const ogImg = doc.querySelector('meta[property="og:image"]')?.content;
  if (ogImg && ogImg.startsWith('http')) { seen.add(ogImg); images.push(ogImg); }

  // JSON-LD images
  const ld = findJsonLd(doc, ['Product', 'ImageGallery', 'ItemPage']);
  if (ld) {
    const ldImgs = Array.isArray(ld.image) ? ld.image : ld.image ? [ld.image] : [];
    ldImgs.forEach(i => {
      const url = typeof i === 'string' ? i : i?.url || i?.contentUrl || '';
      if (url && !seen.has(url)) { seen.add(url); images.push(url); }
    });
  }

  // SSR JSON images
  const ssrData = extractSsrJson(html);
  if (ssrData) extractImagesFromObject(ssrData, images, seen);

  // DOM images (priority selectors)
  const selectors = [
    '.product-images img', '.swiper-slide img', '.gallery img',
    '[class*="product"] img', '[class*="goods"] img', '[class*="item"] img',
    'figure img', '.post-content img', '.entry-content img', 'article img', 'main img'
  ];
  for (const sel of selectors) {
    try { doc.querySelectorAll(sel).forEach(img => collectImg(img, images, seen)); } catch {}
    if (images.length >= 8) break;
  }
  if (images.length < 2) doc.querySelectorAll('img').forEach(img => collectImg(img, images, seen));

  /* ── Weight ── */
  const text = doc.body?.textContent || '';
  const wm = text.match(/重量[：:]\s*(\d+\.?\d*)\s*[gG克]/) ||
             text.match(/[Ww]eight[:\s]+(\d+\.?\d*)\s*g\b/) ||
             text.match(/(\d{2,4})\s*g(?:ram)?s?\b/);
  const weight = wm ? Math.round(parseFloat(wm[1])) : 0;

  /* ── Price ── */
  const pm = text.match(/[¥$€£]\s*([\d,]+\.?\d{0,2})/);
  const price = pm ? parseFloat(pm[1].replace(/,/g, '')) : 0;

  return { title, images: images.slice(0, 6), weight, price };
}

/* ════════════════════════════════════════════
   SSR JSON EXTRACTION
   (finds window.__NUXT__ / __NEXT_DATA__ / initialData etc.)
════════════════════════════════════════════ */
function extractSsrJson(html) {
  const patterns = [
    // Next.js
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i,
    // Nuxt 2
    /window\.__NUXT__\s*=\s*(\{[\s\S]*?\})(?:\s*;|\s*<)/,
    /window\.__NUXT__\s*=\s*([\s\S]*?);<\/script>/,
    // Generic
    /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})(?:\s*;)/,
    /window\.initialData\s*=\s*(\{[\s\S]*?\})(?:\s*;)/,
    /window\.__APP_STATE__\s*=\s*(\{[\s\S]*?\})(?:\s*;)/
  ];
  for (const pat of patterns) {
    const m = html.match(pat);
    if (m) {
      try { return JSON.parse(m[1]); } catch {}
    }
  }
  return null;
}

function extractTitle(obj, depth = 0) {
  if (depth > 6 || !obj || typeof obj !== 'object') return '';
  for (const key of ['name', 'title', 'productName', 'goodsName', 'itemName', 'headline', 'subject']) {
    if (typeof obj[key] === 'string' && obj[key].length > 2) return obj[key];
  }
  for (const val of Object.values(obj)) {
    const t = extractTitle(val, depth + 1);
    if (t) return t;
  }
  return '';
}

function extractImagesFromObject(obj, images, seen, depth = 0) {
  if (depth > 8 || !obj || typeof obj !== 'object') return;
  if (images.length >= 8) return;
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === 'string' && val.startsWith('http') &&
        /\.(jpg|jpeg|png|webp|avif)/i.test(val) && !seen.has(val)) {
      const low = val.toLowerCase();
      if (!['logo', 'avatar', 'icon', 'spinner', 'placeholder'].some(k => low.includes(k))) {
        seen.add(val); images.push(val);
      }
    } else if (typeof val === 'object') {
      extractImagesFromObject(val, images, seen, depth + 1);
    }
  }
}

function extractImagesFromHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const imgs = [];
  const seen = new Set();
  doc.querySelectorAll('img').forEach(img => collectImg(img, imgs, seen));
  return imgs;
}

/* ════════════════════════════════════════════
   JSON-LD PARSER
════════════════════════════════════════════ */
function findJsonLd(doc, types) {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const s of scripts) {
    try {
      const data = JSON.parse(s.textContent);
      const items = Array.isArray(data) ? data : [data, ...(data['@graph'] || [])];
      for (const item of items) {
        if (types.some(t => (item['@type'] || '').includes(t))) return item;
      }
    } catch {}
  }
  return null;
}

/* ════════════════════════════════════════════
   NEXT.JS PAGE DATA PARSER
════════════════════════════════════════════ */
function parseNextData(data) {
  if (!data) return null;
  const props = data.pageProps || data.props?.pageProps || data;
  const title = extractTitle(props);
  const images = [];
  const seen = new Set();
  extractImagesFromObject(props, images, seen);
  return { title, images, weight: 0, price: 0 };
}

/* ════════════════════════════════════════════
   IMAGE COLLECTOR
════════════════════════════════════════════ */
function collectImg(img, images, seen) {
  if (images.length >= 10) return;
  const src = img.getAttribute('src') || img.getAttribute('data-src') ||
              img.getAttribute('data-lazy-src') || img.getAttribute('data-original') ||
              img.getAttribute('data-full') || img.getAttribute('data-zoom') || '';
  if (!src) return;
  const abs = src.startsWith('//') ? 'https:' + src : src;
  if (!abs.startsWith('http') || seen.has(abs)) return;
  const low = abs.toLowerCase();
  if (['avatar', 'logo', 'icon', 'loading', 'placeholder', 'spinner', 'banner', '.svg', 'emoji', 'star-rating', 'rating'].some(k => low.includes(k))) return;
  const w = parseInt(img.getAttribute('width') || '0');
  const h = parseInt(img.getAttribute('height') || '0');
  if ((w > 0 && w < 80) || (h > 0 && h < 80)) return;
  seen.add(abs);
  images.push(abs);
}

/* ════════════════════════════════════════════
   FETCH HELPERS
════════════════════════════════════════════ */
async function fetchHtml(url, timeout = 9000) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br'
      },
      signal: AbortSignal.timeout(timeout),
      redirect: 'follow'
    });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
}

async function fetchJSON(url, timeout = 7000) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json, */*' },
      signal: AbortSignal.timeout(timeout),
      redirect: 'follow'
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json') && !ct.includes('javascript')) return null;
    return await res.json();
  } catch { return null; }
}

function stripHtmlTags(str) {
  return str.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#[0-9]+;/g, '').trim();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS_H });
}
