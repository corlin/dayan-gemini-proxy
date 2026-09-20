import { Readable } from 'node:stream';

/**
 * Transparent Gemini API Reverse Proxy on Vercel (pinned to iad1 US East).
 * 
 * Forwards all incoming requests directly to https://generativelanguage.googleapis.com
 * Supports both standard JSON generation and SSE streamGenerateContent streaming.
 */
export default async function handler(req, res) {
  // CORS Preflight & Global Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Health check on root
  if (!req.url || req.url === '/' || req.url === '') {
    return res.status(200).json({
      status: 'ok',
      service: 'dayan-gemini-proxy',
      target: 'https://generativelanguage.googleapis.com',
      region: process.env.VERCEL_REGION || 'iad1',
      timestamp: new Date().toISOString()
    });
  }

  try {
    const targetUrl = `https://generativelanguage.googleapis.com${req.url}`;

    // Filter hop-by-hop headers
    const forwardHeaders = {};
    for (const [key, value] of Object.entries(req.headers)) {
      const lower = key.toLowerCase();
      if (['host', 'connection', 'content-length', 'transfer-encoding'].includes(lower)) {
        continue;
      }
      forwardHeaders[key] = value;
    }

    const fetchOptions = {
      method: req.method,
      headers: forwardHeaders,
      redirect: 'follow',
    };

    if (['POST', 'PUT', 'PATCH'].includes(req.method.toUpperCase())) {
      fetchOptions.body = req;
      fetchOptions.duplex = 'half';
    }

    const upstreamResponse = await fetch(targetUrl, fetchOptions);

    res.status(upstreamResponse.status);

    // Forward upstream response headers (preserve content-type for SSE)
    for (const [key, value] of upstreamResponse.headers.entries()) {
      const lower = key.toLowerCase();
      if (['transfer-encoding', 'content-encoding', 'connection'].includes(lower)) {
        continue;
      }
      res.setHeader(key, value);
    }

    if (!upstreamResponse.body) {
      return res.end();
    }

    // Pipe response stream directly back to client (supports SSE streaming)
    const stream = Readable.fromWeb(upstreamResponse.body);
    stream.pipe(res);
  } catch (error) {
    console.error('Proxy Error:', error);
    res.status(502).json({
      error: 'BAD_GATEWAY',
      message: error?.message || 'Failed to proxy request to Google Gemini',
    });
  }
}
