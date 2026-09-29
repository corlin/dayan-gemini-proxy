import { Readable } from 'node:stream';
import { handleImageGeneration, extractApiKey, MAX_BODY_BYTES, DEFAULT_TIMEOUT_MS } from './images.js';
import { getOpenApiSpec, renderScalarHtml } from './docs.js';
import { recordRequest, getStatsSummary, verifyStatsAuth } from './logger.js';
import { renderStatsHtml } from './stats-ui.js';

/**
 * Transparent Gemini API Reverse Proxy on Vercel (pinned to iad1 US East).
 * 
 * Forwards incoming requests directly to https://generativelanguage.googleapis.com
 * Supports OpenAI-compatible image generation at /v1/images/generations
 * Serves modern interactive API documentation at /docs and OpenAPI spec at /openapi.json
 * Live performance & request metrics at /stats
 */
export default async function handler(req, res) {
  const reqStart = Date.now();
  let capturedStatus = 200;
  let capturedModel = 'none';
  let capturedError = null;
  const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  const apiKey = extractApiKey(req);

  // Hook response status & json to capture metadata for logging
  const origStatus = res.status?.bind(res);
  res.status = function (code) {
    capturedStatus = code;
    return origStatus ? origStatus(code) : (res.statusCode = code, this);
  };

  const origJson = res.json?.bind(res);
  res.json = function (data) {
    if (data?.error) {
      capturedError = data.error.message || data.error.code;
    }
    return origJson ? origJson(data) : this;
  };

  const finalizeLogging = () => {
    const durationMs = Date.now() - reqStart;
    const path = req.url ? new URL(req.url, 'http://localhost').pathname : '/';
    if (capturedModel === 'none' && path.includes('/models/')) {
      const match = path.match(/\/models\/([^:/]+)/);
      if (match) capturedModel = match[1];
    }
    recordRequest({
      method: req.method,
      path,
      model: capturedModel,
      status: res.statusCode || capturedStatus,
      durationMs,
      clientIp,
      apiKey,
      error: capturedError,
    });
  };

  const origEnd = res.end?.bind(res);
  let logged = false;
  res.end = function (...args) {
    if (!logged) {
      logged = true;
      try { finalizeLogging(); } catch {}
    }
    return origEnd ? origEnd(...args) : undefined;
  };

  // CORS Preflight & Global Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Payload Size Guard upfront
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  if (contentLength > MAX_BODY_BYTES) {
    return res.status(413).json({
      error: {
        message: 'Payload Too Large: maximum allowed body size is 15MB',
        type: 'invalid_request_error',
        param: null,
        code: 'payload_too_large',
      },
    });
  }

  // Derive dynamic base URL for docs & links
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || (host?.includes('localhost') ? 'http' : 'https');
  const baseUrl = host ? `${proto}://${host}` : 'https://llm.hidear.app';

  const parsedUrl = new URL(req.url || '/', 'http://localhost');
  const pathname = parsedUrl.pathname.replace(/\/+$/, '') || '/';

  // Live Monitor & Stats Route
  if (pathname === '/stats') {
    if (!verifyStatsAuth(req)) {
      return res.status(403).json({
        error: {
          message: 'Forbidden: Invalid or missing administration token',
          type: 'invalid_request_error',
          param: null,
          code: 'unauthorized',
        },
      });
    }

    const acceptHeader = req.headers.accept || '';
    const wantsJson = acceptHeader.includes('application/json') || parsedUrl.searchParams.get('format') === 'json';

    if (wantsJson || !acceptHeader.includes('text/html')) {
      return res.status(200).json({
        status: 'ok',
        service: 'dayan-gemini-proxy',
        region: process.env.VERCEL_REGION || 'iad1',
        stats: getStatsSummary(),
      });
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const html = renderStatsHtml(getStatsSummary(), baseUrl);
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
      features: ['transparent-proxy', 'openai-image-generation', 'interactive-docs', 'live-metrics'],
      docs: `${baseUrl}/docs`,
      stats: `${baseUrl}/stats`,
      openapi: `${baseUrl}/openapi.json`,
      timestamp: new Date().toISOString()
    });
  }

  // OpenAI Compatible Images Generation Route
  if (req.method === 'POST' && (pathname === '/v1/images/generations' || pathname.endsWith('/images/generations'))) {
    capturedModel = 'gemini-3.1-flash-image';
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
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    };

    if (['POST', 'PUT', 'PATCH'].includes(req.method.toUpperCase())) {
      fetchOptions.body = req;
      fetchOptions.duplex = 'half';
    }

    let upstreamResponse;
    try {
      upstreamResponse = await fetch(targetUrl, fetchOptions);
    } catch (err) {
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        return res.status(504).json({
          error: {
            message: `Gateway Timeout: upstream Google Gemini did not respond within ${DEFAULT_TIMEOUT_MS / 1000}s`,
            type: 'api_error',
            code: 'gateway_timeout',
          },
        });
      }
      // Safe retry once on transient network errors for idempotent requests
      if (['GET', 'HEAD'].includes(req.method.toUpperCase()) && ['ECONNRESET', 'ETIMEDOUT'].includes(err.cause?.code)) {
        upstreamResponse = await fetch(targetUrl, fetchOptions);
      } else {
        throw err;
      }
    }

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
    stream.on('error', (err) => {
      console.error('Upstream stream error:', err);
      if (!res.headersSent) {
        res.status(502).json({ error: 'BAD_GATEWAY', message: err.message });
      } else {
        res.destroy(err);
      }
    });

    req.on('close', () => {
      if (!res.writableEnded) {
        stream.destroy();
      }
    });

    stream.pipe(res);
  } catch (error) {
    console.error('Proxy Error:', error);
    res.status(502).json({
      error: 'BAD_GATEWAY',
      message: error?.message || 'Failed to proxy request to Google Gemini',
    });
  }
}
