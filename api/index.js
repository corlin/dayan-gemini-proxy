import { Readable } from 'node:stream';
import { handleImageGeneration } from './images.js';
import { getOpenApiSpec, renderScalarHtml } from './docs.js';

/**
 * Transparent Gemini API Reverse Proxy on Vercel (pinned to iad1 US East).
 * 
 * Forwards incoming requests directly to https://generativelanguage.googleapis.com
 * Supports OpenAI-compatible image generation at /v1/images/generations
 * Serves modern interactive API documentation at /docs and OpenAPI spec at /openapi.json
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

  // Derive dynamic base URL for docs & links
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || (host?.includes('localhost') ? 'http' : 'https');
  const baseUrl = host ? `${proto}://${host}` : 'https://llm.hidear.app';

  const parsedUrl = new URL(req.url || '/', 'http://localhost');
  const pathname = parsedUrl.pathname.replace(/\/+$/, '') || '/';

  // Interactive API Documentation (Scalar UI)
  if (req.method === 'GET' && pathname === '/docs') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const html = renderScalarHtml(baseUrl);
    if (typeof res.status === 'function') {
      res.status(200);
    } else {
      res.statusCode = 200;
    }
    if (typeof res.send === 'function') {
      return res.send(html);
    }
    return res.end(html);
  }

  // OpenAPI 3.1 Specification JSON
  if (req.method === 'GET' && pathname === '/openapi.json') {
    return res.status(200).json(getOpenApiSpec(baseUrl));
  }

  // Health check on root
  if (pathname === '/') {
    // If request comes from a web browser, redirect to /docs
    const acceptHeader = req.headers.accept || '';
    if (acceptHeader.includes('text/html') && !acceptHeader.includes('application/json')) {
      res.writeHead(302, { Location: '/docs' });
      return res.end();
    }

    return res.status(200).json({
      status: 'ok',
      service: 'dayan-gemini-proxy',
      target: 'https://generativelanguage.googleapis.com',
      region: process.env.VERCEL_REGION || 'iad1',
      features: ['transparent-proxy', 'openai-image-generation', 'interactive-docs'],
      docs: `${baseUrl}/docs`,
      openapi: `${baseUrl}/openapi.json`,
      timestamp: new Date().toISOString()
    });
  }

  // OpenAI Compatible Images Generation Route
  if (req.method === 'POST' && (pathname === '/v1/images/generations' || pathname.endsWith('/images/generations'))) {
    return handleImageGeneration(req, res);
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
