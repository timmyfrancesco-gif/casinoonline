/**
 * OrderVault — /api/lookup  (v3)
 * GET /api/lookup?url=PRODUCT_URL
 *
 * Flow:
 *  1. Fetch product page → og:tags + SSR JSON + platform-specific API
 *  2. Search UUFinds via: RSS feed → WP REST API → Next.js data → scrape
 *  3. Merge: UUFinds photos + product page title/weight/price
 */
export const config = { runtime: 'edge' };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const H = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, s-maxage=120'
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: H });
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get('url') || '';
  if (!raw.startsWith('http')) return resp({ error: 'invalid_url', source: null }, 400);

  /* Run both in parallel */
  const [pageRes, uufRes] = await Promise.allSettled([
    getProductPage(raw),
    getUUFinds(raw)
  ]);

  const page = pageRes.status === 'fulfilled' ? pageRes.value : null;
  const uuf  = uufRes.status  === 'fulfilled' ? uufRes.value  : null;

  /* UUFinds wins for QC photos; product page wins for title/weight/price */
  if (uuf && (uuf.images.length > 0 || uuf.title)) {
    return resp({
      source:  'uufinds',
      title:   uuf.title  || page?.title  || '',
      images:  uuf.images.length ? uuf.images : (page?.images || []),
      weight:  page?.weight || uuf.weight || 0,
      price:   page?.price  || uuf.price  || 0,
    });
  }
  if (page && (page.title || page.images.length)) {
    return resp({ source: 'page', ...page });
  }
  return resp({ source: null, title: '', images: [], weight: 0, price: 0 });
}

/* ══════════════════════════════════════════════
   PRODUCT PAGE (CNFans / OopBuy / Pandabuy …)
   ══════════════════════════════════════════════ */
async function getProductPage(url) {
  /* 1. Try platform-specific API first (JSON, most reliable) */
  const apiData = await tryPlatformAPI(url);
  if (apiData?.title || apiData?.images?.length) return apiData;

  /* 2. Fetch raw HTML */
  const html = await get(url);
  if (!html) return null;

  /* 3. Parse */
  const doc = parse(html);
  const title   = pickTitle(doc, html);
  const images  = pickImages(doc, html);
  const weight  = pickWeight(doc.body?.textContent || '');
  const price   = pickPrice(doc.body?.textContent || '');
  return { title, images, weight, price };
}

/* Platform-specific API attempts */
async function tryPlatformAPI(url) {
  /* CNFans: extract id param → call their goods API */
  if (url.includes('cnfans.com')) {
    const id = new URL(url).searchParams.get('id');
    if (id) {
      const candidates = [
        `https://cnfans.com/api/ware/waresinfo?ware_id=${id}`,
        `https://cnfans.com/api/goods/detail?id=${id}`,
        `https://cnfans.com/index.php?route=product/product/getInfo&goods_id=${id}`,
      ];
      for (const api of candidates) {
        const data = await getJSON(api);
        if (data) {
          const p = data.data || data.result || data;
          const title = p.goods_name || p.name || p.title || '';
          const imgs = [];
          if (p.goods_images) {
            (Array.isArray(p.goods_images) ? p.goods_images : [p.goods_images])
              .forEach(i => { if (typeof i === 'string') imgs.push(i); else if (i?.img_url) imgs.push(i.img_url); });
          }
          if (p.image) imgs.push(p.image);
          if (title || imgs.length) return { title, images: imgs.slice(0, 6), weight: p.weight || 0, price: p.price || p.sell_price || 0 };
        }
      }
    }
  }

  /* OopBuy: /product/detail/ID */
  if (url.includes('oopbuy.com')) {
    const m = url.match(/\/detail\/([^/?#]+)/);
    if (m) {
      const id = m[1];
      const data = await getJSON(`https://www.oopbuy.com/api/product/detail?id=${id}`);
      if (data) {
        const p = data.data || data;
        const title = p.name || p.product_name || '';
        const imgs = (p.images || p.gallery || []).map(i => typeof i === 'string' ? i : i.url || '').filter(Boolean);
        if (title || imgs.length) return { title, images: imgs.slice(0, 6), weight: p.weight || 0, price: p.price || 0 };
      }
    }
  }

  return null;
}

/* ══════════════════════════════════════════════
   UUFINDS — 4 METHODS
   ══════════════════════════════════════════════ */
async function getUUFinds(productUrl) {
  const q = encodeURIComponent(productUrl);

  /* ── METHOD 1: RSS feed (always SSR on WordPress) ── */
  try {
    const xml = await get(`https://www.uufinds.com/feed/?s=${q}&post_type=post`, 8000);
    if (xml && xml.includes('<item>')) {
      const result = parseRSS(xml);
      if (result?.title || result?.images?.length) return result;
    }
  } catch {}

  /* ── METHOD 2: WordPress REST API ── */
  try {
    const posts = await getJSON(
      `https://www.uufinds.com/wp-json/wp/v2/posts?search=${q}&per_page=3&_embed=true&_fields=id,title,content,_embedded`,
      8000
    );
    if (Array.isArray(posts) && posts.length > 0) {
      const result = parseWPPosts(posts);
      if (result?.title || result?.images?.length) return result;
    }
  } catch {}

  /* ── METHOD 3: Next.js _next/data ── */
  try {
    const home = await get('https://www.uufinds.com/', 6000);
    if (home) {
      const bid = home.match(/"buildId"\s*:\s*"([^"]+)"/)?.[1];
      if (bid) {
        for (const path of ['s', 'search']) {
          const data = await getJSON(
            `https://www.uufinds.com/_next/data/${bid}/${path}.json?q=${q}`,
            6000
          );
          if (data) {
            const r = parseNextData(data);
            if (r?.title || r?.images?.length) return r;
          }
        }
      }
    }
  } catch {}

  /* ── METHOD 4: Direct HTML scrape (works if SSR) ── */
  for (const su of [
    `https://www.uufinds.com/?s=${q}`,
    `https://www.uufinds.com/s/?q=${q}`,
  ]) {
    try {
      const html = await get(su, 7000);
      if (!html || html.length < 1000) continue;
      const doc = parse(html);
      const title  = pickTitle(doc, html);
      const images = pickImages(doc, html);
      if (title || images.length) return { title, images, weight: 0, price: 0 };
    } catch {}
  }

  return null;
}

/* ══════════════════════════════════════════════
   RSS PARSER
   ══════════════════════════════════════════════ */
function parseRSS(xml) {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  if (!items.length) return null;

  const raw = items[0][1];
  const cdata = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();

  const title = cdata(raw.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '');
  const content = cdata(
    raw.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/)?.[1] ||
    raw.match(/<description>([\s\S]*?)<\/description>/)?.[1] || ''
  );

  const images = [];
  const re = /(?:src|href)=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp|gif)[^"']*)/gi;
  let m;
  while ((m = re.exec(content)) !== null && images.length < 6) images.push(m[1]);

  return { title, images, weight: 0, price: 0 };
}

/* ══════════════════════════════════════════════
   WP REST API PARSER
   ══════════════════════════════════════════════ */
function parseWPPosts(posts) {
  const p = posts[0];
  const title = stripTags(p.title?.rendered || '');
  const images = [];

  /* Featured image */
  const feat = p._embedded?.['wp:featuredmedia']?.[0];
  if (feat?.source_url) images.push(feat.source_url);
  /* Media gallery */
  (p._embedded?.['wp:attachment'] || []).flat()
    .forEach(a => { if (a?.source_url) images.push(a.source_url); });
  /* Images in post content */
  if (p.content?.rendered) {
    const re = /src=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)/gi;
    let m;
    while ((m = re.exec(p.content.rendered)) !== null && images.length < 6) images.push(m[1]);
  }

  return { title, images: [...new Set(images)].slice(0, 6), weight: 0, price: 0 };
}

/* ══════════════════════════════════════════════
   NEXT.JS DATA PARSER
   ══════════════════════════════════════════════ */
function parseNextData(data) {
  const props = data?.pageProps || data?.props?.pageProps || data;
  return {
    title:  deepFind(props, ['name','title','productName','goodsName','headline']) || '',
    images: deepImages(props),
    weight: 0, price: 0
  };
}

/* ══════════════════════════════════════════════
   HTML PARSING HELPERS
   ══════════════════════════════════════════════ */
function parse(html) {
  return new DOMParser().parseFromString(html, 'text/html');
}

function pickTitle(doc, html) {
  /* og:title */
  let t = doc.querySelector('meta[property="og:title"]')?.content?.trim() || '';
  /* JSON-LD */
  if (!t) {
    const ld = findLD(doc, ['Product','ItemPage','Thing']);
    t = ld?.name || ld?.headline || '';
  }
  /* SSR JSON */
  if (!t) t = deepFind(extractSSR(html), ['name','title','productName','goodsName']) || '';
  /* Heading */
  if (!t) t = doc.querySelector('h1,.product-name,.goods-name,.item-name')?.textContent?.trim() || '';
  /* Page title */
  if (!t) t = doc.querySelector('title')?.textContent?.trim() || '';
  return t.split(/\s*[-|—–|_]\s*/)[0].trim().slice(0, 140);
}

function pickImages(doc, html) {
  const seen = new Set(), imgs = [];

  const add = (src) => {
    if (!src || seen.has(src)) return;
    const abs = src.startsWith('//') ? 'https:' + src : src;
    if (!abs.startsWith('http')) return;
    const lo = abs.toLowerCase();
    if (['avatar','logo','icon','placeholder','spinner','banner','.svg','star-'].some(k => lo.includes(k))) return;
    seen.add(abs); imgs.push(abs);
  };

  /* og:image */
  add(doc.querySelector('meta[property="og:image"]')?.content || '');

  /* JSON-LD */
  const ld = findLD(doc, ['Product','ImageGallery']);
  if (ld) {
    const raw = Array.isArray(ld.image) ? ld.image : [ld.image];
    raw.forEach(i => add(typeof i === 'string' ? i : i?.url || i?.contentUrl || ''));
  }

  /* SSR JSON images */
  deepImages_add(extractSSR(html), imgs, seen);

  /* DOM */
  const sels = ['.swiper-slide img','.product-images img','[class*="goods"] img','[class*="product"] img','figure img','.post-content img','article img','main img'];
  for (const s of sels) {
    try {
      doc.querySelectorAll(s).forEach(el => {
        const src = el.getAttribute('src') || el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || el.getAttribute('data-original') || '';
        const w = parseInt(el.getAttribute('width') || '0');
        const h = parseInt(el.getAttribute('height') || '0');
        if ((w && w < 80) || (h && h < 80)) return;
        add(src);
      });
    } catch {}
    if (imgs.length >= 8) break;
  }
  if (imgs.length < 2) {
    doc.querySelectorAll('img').forEach(el => add(el.getAttribute('src') || el.getAttribute('data-src') || ''));
  }

  return imgs.slice(0, 6);
}

function pickWeight(text) {
  const m = text.match(/重量[：:]\s*(\d+\.?\d*)\s*[gG克]/) ||
            text.match(/[Ww]eight[:\s]+(\d+\.?\d*)\s*g\b/) ||
            text.match(/(\d{2,4})\s*g(?:ram)?s?\b/);
  return m ? Math.round(parseFloat(m[1])) : 0;
}
function pickPrice(text) {
  const m = text.match(/[¥$€£]\s*([\d,]+\.?\d{0,2})/);
  return m ? parseFloat(m[1].replace(/,/g, '')) : 0;
}

/* ══════════════════════════════════════════════
   SSR JSON EXTRACTION
   ══════════════════════════════════════════════ */
function extractSSR(html) {
  const pats = [
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i,
    /window\.__NUXT__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/,
    /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*;/,
    /window\.initialData\s*=\s*(\{[\s\S]*?\})\s*;/,
  ];
  for (const p of pats) {
    const m = html.match(p);
    if (m) { try { return JSON.parse(m[1]); } catch {} }
  }
  return null;
}

function deepFind(obj, keys, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 8) return '';
  for (const k of keys) if (typeof obj[k] === 'string' && obj[k].length > 2) return obj[k];
  for (const v of Object.values(obj)) {
    const r = deepFind(v, keys, depth + 1);
    if (r) return r;
  }
  return '';
}

function deepImages(obj, depth = 0) {
  const imgs = []; const seen = new Set();
  deepImages_add(obj, imgs, seen, depth);
  return imgs;
}
function deepImages_add(obj, imgs, seen, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 8 || imgs.length >= 8) return;
  for (const [, v] of Object.entries(obj)) {
    if (typeof v === 'string' && v.startsWith('http') && /\.(jpg|jpeg|png|webp)/i.test(v) && !seen.has(v)) {
      const lo = v.toLowerCase();
      if (!['logo','avatar','icon','spinner','placeholder'].some(k => lo.includes(k))) {
        seen.add(v); imgs.push(v);
      }
    } else if (typeof v === 'object') deepImages_add(v, imgs, seen, depth + 1);
  }
}

/* ══════════════════════════════════════════════
   JSON-LD
   ══════════════════════════════════════════════ */
function findLD(doc, types) {
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const d = JSON.parse(s.textContent);
      const items = [d, ...(Array.isArray(d) ? d : []), ...(d['@graph'] || [])];
      for (const i of items) if (types.some(t => String(i['@type']).includes(t))) return i;
    } catch {}
  }
  return null;
}

/* ══════════════════════════════════════════════
   FETCH HELPERS
   ══════════════════════════════════════════════ */
async function get(url, ms = 9000) {
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
        'Cache-Control': 'no-cache',
      },
      signal: AbortSignal.timeout(ms),
      redirect: 'follow',
    });
    return r.ok ? await r.text() : null;
  } catch { return null; }
}

async function getJSON(url, ms = 7000) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json, */*' },
      signal: AbortSignal.timeout(ms),
      redirect: 'follow',
    });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('json') && !ct.includes('javascript')) return null;
    return await r.json();
  } catch { return null; }
}

const stripTags = s => s.replace(/<[^>]+>/g, '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').trim();
const resp = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: H });
