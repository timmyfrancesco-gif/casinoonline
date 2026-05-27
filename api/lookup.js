/**
 * OrderVault — /api/lookup  (v5)
 * GET /api/lookup?url=PRODUCT_URL
 *
 * Strategy: search ALL sources in parallel, merge everything.
 * Images pooled from UUFinds + NiceFinds + product page (deduped, up to 12).
 * Best title/weight/price wins. Variants (sizes, colors) extracted when available.
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

  /* All sources in parallel */
  const [pageRes, uufRes, nfRes] = await Promise.allSettled([
    getProductPage(raw),
    getUUFinds(raw),
    getNiceFinds(raw)
  ]);

  const page = pageRes.status === 'fulfilled' ? pageRes.value : null;
  const uuf  = uufRes.status  === 'fulfilled' ? uufRes.value  : null;
  const nf   = nfRes.status   === 'fulfilled' ? nfRes.value   : null;

  /* Merge images from ALL sources (deduped) */
  const allImages = [...new Set([
    ...(uuf?.images  || []),
    ...(nf?.images   || []),
    ...(page?.images || []),
  ])].slice(0, 12);

  /* Best title: prefer QC sites (they include product name in post title) */
  const title = uuf?.title || nf?.title || page?.title || '';
  const weight = page?.weight || uuf?.weight || nf?.weight || 0;
  const price  = page?.price  || uuf?.price  || nf?.price  || 0;
  const variants = page?.variants || [];

  /* Record which sources contributed */
  const sources = [
    uuf  && (uuf.images.length  || uuf.title)  ? 'uufinds'   : null,
    nf   && (nf.images.length   || nf.title)   ? 'nicefinds' : null,
    page && (page.images.length || page.title) ? 'page'      : null,
  ].filter(Boolean);

  if (!title && !allImages.length) {
    return resp({ source: null, sources: [], title: '', images: [], weight: 0, price: 0, variants: [] });
  }

  return resp({ source: sources[0] || null, sources, title, images: allImages, weight, price, variants });
}

/* ══════════════════════════════════════════════
   PRODUCT PAGE (CNFans / OopBuy / Pandabuy / Sugargoo …)
   ══════════════════════════════════════════════ */
async function getProductPage(url) {
  const apiData = await tryPlatformAPI(url);
  if (apiData?.title || apiData?.images?.length) return apiData;

  const html = await get(url);
  if (!html) return null;

  const doc = parse(html);
  const ssr  = extractSSR(html);

  const title    = pickTitle(doc, html);
  const images   = pickImages(doc, html);
  const weight   = pickWeight(doc.body?.textContent || '');
  const price    = pickPrice(doc.body?.textContent || '');
  const variants = pickVariants(ssr, doc);
  return { title, images, weight, price, variants };
}

/* Platform-specific API attempts */
async function tryPlatformAPI(url) {
  /* ── CNFans ── */
  if (url.includes('cnfans.com')) {
    const id = new URL(url).searchParams.get('id');
    if (id) {
      for (const api of [
        `https://cnfans.com/api/ware/waresinfo?ware_id=${id}`,
        `https://cnfans.com/api/goods/detail?id=${id}`,
        `https://cnfans.com/index.php?route=product/product/getInfo&goods_id=${id}`,
      ]) {
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
          const variants = extractVariantsFromAPI(p);
          if (title || imgs.length) return { title, images: imgs.slice(0, 6), weight: p.weight || 0, price: p.price || p.sell_price || 0, variants };
        }
      }
    }
  }

  /* ── OopBuy ── */
  if (url.includes('oopbuy.com')) {
    const m = url.match(/\/detail\/([^/?#]+)/);
    if (m) {
      const data = await getJSON(`https://www.oopbuy.com/api/product/detail?id=${m[1]}`);
      if (data) {
        const p = data.data || data;
        const title = p.name || p.product_name || '';
        const imgs = (p.images || p.gallery || []).map(i => typeof i === 'string' ? i : i.url || '').filter(Boolean);
        const variants = extractVariantsFromAPI(p);
        if (title || imgs.length) return { title, images: imgs.slice(0, 6), weight: p.weight || 0, price: p.price || 0, variants };
      }
    }
  }

  /* ── Pandabuy ── */
  if (url.includes('pandabuy.com')) {
    const u = new URL(url);
    const id = u.searchParams.get('id') || u.searchParams.get('itemId');

    if (id) {
      /* Next.js _next/data */
      try {
        const home = await get('https://www.pandabuy.com/', 5000);
        const bid = home?.match(/"buildId"\s*:\s*"([^"]+)"/)?.[1];
        if (bid) {
          const data = await getJSON(`https://www.pandabuy.com/_next/data/${bid}/product.json?id=${id}`, 7000);
          if (data) {
            const props = data.pageProps || data;
            const title = deepFind(props, ['name','title','productName','goodsName','headline']) || '';
            const imgs  = deepImages(props);
            const variants = extractVariantsFromAPI(props);
            const priceStr = deepFind(props, ['price','salePrice','sellPrice','cnyPrice']) || '0';
            if (title || imgs.length) return { title, images: imgs.slice(0, 6), weight: 0, price: parseFloat(priceStr) || 0, variants };
          }
        }
      } catch {}

      /* Direct API candidates */
      for (const api of [
        `https://www.pandabuy.com/api/pandabuy-goods/detail?id=${id}`,
        `https://www.pandabuy.com/api/goods/detail?id=${id}`,
        `https://www.pandabuy.com/api/detail?id=${id}`,
      ]) {
        const data = await getJSON(api, 6000);
        if (data) {
          const p = data.data || data.result || data;
          const title = p.name || p.title || p.productName || p.goodsName || '';
          const imgData = p.images || p.imageList || p.picList || p.pics || [];
          const imgs = (Array.isArray(imgData) ? imgData : [imgData])
            .map(i => typeof i === 'string' ? i : i?.url || i?.src || i?.img || '')
            .filter(Boolean);
          if (p.mainImg) imgs.unshift(p.mainImg);
          const variants = extractVariantsFromAPI(p);
          if (title || imgs.length) return { title, images: imgs.slice(0, 6), weight: p.weight || 0, price: p.price || p.salePrice || 0, variants };
        }
      }
    }

    /* SSR fallback */
    const html = await get(url, 8000);
    if (html) {
      const ssr = extractSSR(html);
      if (ssr) {
        const title = deepFind(ssr, ['name','title','productName','goodsName']) || '';
        const imgs  = deepImages(ssr);
        if (title || imgs.length) {
          const doc = parse(html);
          return { title: title || pickTitle(doc, html), images: imgs.slice(0, 6), weight: pickWeight(doc.body?.textContent || ''), price: pickPrice(doc.body?.textContent || ''), variants: pickVariants(ssr, doc) };
        }
      }
    }
  }

  /* ── Sugargoo ── */
  if (url.includes('sugargoo.com')) {
    const hash = url.split('#')[1] || '';
    const plMatch = hash.match(/[?&]productLink=([^&]+)/);
    const productLink = plMatch ? decodeURIComponent(plMatch[1]) : '';
    const apiTarget = productLink || url;

    for (const api of [
      `https://www.sugargoo.com/index/item/index.html?language=en&productLink=${encodeURIComponent(apiTarget)}`,
      `https://www.sugargoo.com/index/product/detail?url=${encodeURIComponent(apiTarget)}`,
    ]) {
      const html = await get(api, 8000);
      if (html && html.length > 2000) {
        const doc = parse(html);
        const ssr = extractSSR(html);
        const title  = (ssr ? deepFind(ssr, ['name','title','productName','goodsName']) : '') || pickTitle(doc, html);
        const imgs   = [...new Set([...(ssr ? deepImages(ssr) : []), ...pickImages(doc, html)])].slice(0, 6);
        const variants = pickVariants(ssr, doc);
        if (title || imgs.length) return { title, images: imgs, weight: pickWeight(doc.body?.textContent || ''), price: pickPrice(doc.body?.textContent || ''), variants };
      }
    }

    const jsonData = await getJSON(`https://www.sugargoo.com/api/item/getDetail?productLink=${encodeURIComponent(apiTarget)}`, 7000);
    if (jsonData) {
      const p = jsonData.data || jsonData;
      const title = p.title || p.name || p.productName || '';
      const imgData = p.images || p.imageList || p.gallery || [];
      const imgs = (Array.isArray(imgData) ? imgData : [imgData]).map(i => typeof i === 'string' ? i : i?.url || '').filter(Boolean);
      const variants = extractVariantsFromAPI(p);
      if (title || imgs.length) return { title, images: imgs.slice(0, 6), weight: p.weight || 0, price: p.price || 0, variants };
    }
  }

  /* ── Hagobuy ── */
  if (url.includes('hagobuy.com')) {
    const id = new URL(url).searchParams.get('id') || new URL(url).searchParams.get('productId');
    if (id) {
      const data = await getJSON(`https://www.hagobuy.com/api/product/detail?id=${id}`, 6000);
      if (data) {
        const p = data.data || data;
        const title = p.name || p.title || '';
        const imgs = (p.images || p.gallery || []).map(i => typeof i === 'string' ? i : i?.url || '').filter(Boolean);
        const variants = extractVariantsFromAPI(p);
        if (title || imgs.length) return { title, images: imgs.slice(0, 6), weight: p.weight || 0, price: p.price || 0, variants };
      }
    }
  }

  return null;
}

/* ══════════════════════════════════════════════
   VARIANT EXTRACTION
   Looks for size/color/option data in API responses and SSR JSON
   ══════════════════════════════════════════════ */
function extractVariantsFromAPI(obj) {
  if (!obj || typeof obj !== 'object') return [];
  const variants = [];

  /* Common variant keys in Chinese platform APIs */
  const skuKeys = ['skuList','skus','sku_list','variants','options','specifications','propList','props','sizeList','colorList','attrList','attrs'];
  for (const k of skuKeys) {
    const raw = obj[k] || (obj.data && obj.data[k]) || (obj.result && obj.result[k]);
    if (Array.isArray(raw) && raw.length > 0) {
      raw.forEach(item => {
        if (typeof item === 'string') {
          variants.push({ type: k.replace(/List|list/, ''), value: item });
        } else if (item && typeof item === 'object') {
          const val = item.value || item.name || item.skuName || item.propValue || item.attr_value || '';
          const type = item.type || item.propName || item.attr_name || k.replace(/List|list/, '');
          if (val) variants.push({ type: String(type), value: String(val), image: item.image || item.img || '' });
        }
      });
      if (variants.length) return variants.slice(0, 30);
    }
  }

  /* Recurse one level deeper */
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sub = extractVariantsFromAPI(v);
      if (sub.length) return sub;
    }
  }

  return [];
}

function pickVariants(ssr, doc) {
  if (!ssr && !doc) return [];

  /* Try from SSR data */
  if (ssr) {
    const v = extractVariantsFromAPI(ssr);
    if (v.length) return v;
  }

  /* Try from page JSON blobs */
  const scripts = doc?.querySelectorAll('script:not([src])') || [];
  for (const s of scripts) {
    const text = s.textContent || '';
    if (!text.includes('sku') && !text.includes('variant') && !text.includes('option')) continue;
    const skuMatch = text.match(/["'](?:skuList|skus|variants|sizeList|colorList|propList)["']\s*:\s*(\[[\s\S]{1,4000}?\])/);
    if (skuMatch) {
      try {
        const parsed = JSON.parse(skuMatch[1]);
        if (Array.isArray(parsed) && parsed.length) {
          return extractVariantsFromAPI({ skuList: parsed });
        }
      } catch {}
    }
  }

  return [];
}

/* ══════════════════════════════════════════════
   UUFINDS — 4 METHODS
   ══════════════════════════════════════════════ */
async function getUUFinds(productUrl) {
  const q = encodeURIComponent(productUrl);

  try {
    const xml = await get(`https://www.uufinds.com/feed/?s=${q}&post_type=post`, 8000);
    if (xml && xml.includes('<item>')) {
      const result = parseRSS(xml);
      if (result?.title || result?.images?.length) return result;
    }
  } catch {}

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

  try {
    const home = await get('https://www.uufinds.com/', 6000);
    if (home) {
      const bid = home.match(/"buildId"\s*:\s*"([^"]+)"/)?.[1];
      if (bid) {
        for (const path of ['s', 'search']) {
          const data = await getJSON(`https://www.uufinds.com/_next/data/${bid}/${path}.json?q=${q}`, 6000);
          if (data) {
            const r = parseNextData(data);
            if (r?.title || r?.images?.length) return r;
          }
        }
      }
    }
  } catch {}

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
      if (title || images.length) return { title, images, weight: 0, price: 0, variants: [] };
    } catch {}
  }

  return null;
}

/* ══════════════════════════════════════════════
   NICEFINDS — RSS → WP REST → scrape
   ══════════════════════════════════════════════ */
async function getNiceFinds(productUrl) {
  const q = encodeURIComponent(productUrl);
  const domains = [
    'https://www.nicefinds.net',
    'https://nicefinds.net',
    'https://www.nicefinds.io',
    'https://nicefinds.io',
    'https://www.thenicefinds.com',
  ];

  for (const domain of domains) {
    try {
      const xml = await get(`${domain}/feed/?s=${q}&post_type=post`, 6000);
      if (xml && xml.includes('<item>')) {
        const result = parseRSS(xml);
        if (result?.title || result?.images?.length) return result;
      }
    } catch {}

    try {
      const posts = await getJSON(
        `${domain}/wp-json/wp/v2/posts?search=${q}&per_page=3&_embed=true&_fields=id,title,content,_embedded`,
        6000
      );
      if (Array.isArray(posts) && posts.length > 0) {
        const result = parseWPPosts(posts);
        if (result?.title || result?.images?.length) return result;
      }
    } catch {}

    try {
      const html = await get(`${domain}/?s=${q}`, 6000);
      if (html && html.length > 1000) {
        const doc = parse(html);
        const title  = pickTitle(doc, html);
        const images = pickImages(doc, html);
        if (title || images.length) return { title, images, weight: 0, price: 0, variants: [] };
      }
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

  return { title, images, weight: 0, price: 0, variants: [] };
}

/* ══════════════════════════════════════════════
   WP REST API PARSER
   ══════════════════════════════════════════════ */
function parseWPPosts(posts) {
  const p = posts[0];
  const title = stripTags(p.title?.rendered || '');
  const images = [];

  const feat = p._embedded?.['wp:featuredmedia']?.[0];
  if (feat?.source_url) images.push(feat.source_url);
  (p._embedded?.['wp:attachment'] || []).flat()
    .forEach(a => { if (a?.source_url) images.push(a.source_url); });
  if (p.content?.rendered) {
    const re = /src=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)/gi;
    let m;
    while ((m = re.exec(p.content.rendered)) !== null && images.length < 6) images.push(m[1]);
  }

  return { title, images: [...new Set(images)].slice(0, 6), weight: 0, price: 0, variants: [] };
}

/* ══════════════════════════════════════════════
   NEXT.JS DATA PARSER
   ══════════════════════════════════════════════ */
function parseNextData(data) {
  const props = data?.pageProps || data?.props?.pageProps || data;
  return {
    title:    deepFind(props, ['name','title','productName','goodsName','headline']) || '',
    images:   deepImages(props),
    weight:   0, price: 0,
    variants: extractVariantsFromAPI(props),
  };
}

/* ══════════════════════════════════════════════
   HTML PARSING HELPERS
   ══════════════════════════════════════════════ */
function parse(html) {
  return new DOMParser().parseFromString(html, 'text/html');
}

function pickTitle(doc, html) {
  let t = doc.querySelector('meta[property="og:title"]')?.content?.trim() || '';
  if (!t) {
    const ld = findLD(doc, ['Product','ItemPage','Thing']);
    t = ld?.name || ld?.headline || '';
  }
  if (!t) t = deepFind(extractSSR(html), ['name','title','productName','goodsName']) || '';
  if (!t) t = doc.querySelector('h1,.product-name,.goods-name,.item-name')?.textContent?.trim() || '';
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

  add(doc.querySelector('meta[property="og:image"]')?.content || '');

  const ld = findLD(doc, ['Product','ImageGallery']);
  if (ld) {
    const raw = Array.isArray(ld.image) ? ld.image : [ld.image];
    raw.forEach(i => add(typeof i === 'string' ? i : i?.url || i?.contentUrl || ''));
  }

  deepImages_add(extractSSR(html), imgs, seen);

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
