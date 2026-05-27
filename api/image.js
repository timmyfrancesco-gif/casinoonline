/**
 * OrderVault — /api/image
 * Vercel Edge Function: proxy immagini server-side (no CORS su browser)
 * GET /api/image?url=IMAGE_URL
 */

export const config = { runtime: 'edge' };

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' }
    });
  }

  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get('url');

  if (!imageUrl || !imageUrl.startsWith('http')) {
    return new Response('Invalid URL', { status: 400 });
  }

  // Security: only proxy image URLs (no internal network)
  let parsed;
  try { parsed = new URL(imageUrl); } catch { return new Response('Bad URL', { status: 400 }); }
  if (['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(parsed.hostname)) {
    return new Response('Forbidden', { status: 403 });
  }

  try {
    const res = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': parsed.origin,
        'Accept': 'image/webp,image/avif,image/*,*/*;q=0.8'
      },
      signal: AbortSignal.timeout(12000),
      redirect: 'follow'
    });

    if (!res.ok) return new Response(`Upstream error ${res.status}`, { status: 502 });

    const ct = res.headers.get('content-type') || 'image/jpeg';
    if (!ct.startsWith('image/')) return new Response('Not an image', { status: 415 });

    return new Response(res.body, {
      status: 200,
      headers: {
        'Content-Type': ct,
        'Content-Length': res.headers.get('content-length') || '',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
        'CDN-Cache-Control': 'public, max-age=86400'
      }
    });
  } catch (err) {
    return new Response(`Proxy error: ${err.message}`, { status: 500 });
  }
}
