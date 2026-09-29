import test from 'node:test';
import assert from 'node:assert/strict';
import { getOpenApiSpec, renderScalarHtml } from '../api/docs.js';
import handler from '../api/index.js';

test('getOpenApiSpec returns valid OpenAPI 3.1.0 document', () => {
  const spec = getOpenApiSpec('https://llm.hidear.app');
  assert.equal(spec.openapi, '3.1.0');
  assert.equal(spec.info.title, 'Dayan Gemini Proxy API');
  assert.equal(spec.servers[0].url, 'https://llm.hidear.app');
  assert.ok(spec.paths['/v1/images/generations']);
  assert.ok(spec.paths['/v1beta/models/{model}:generateContent']);
  assert.ok(spec.paths['/v1beta/models/{model}:streamGenerateContent']);
  assert.ok(spec.paths['/']);
  assert.ok(spec.components.securitySchemes.BearerAuth);
  assert.ok(spec.components.securitySchemes.ApiKeyAuth);
});

test('renderScalarHtml contains Scalar script and embedded spec', () => {
  const html = renderScalarHtml('https://llm.hidear.app');
  assert.ok(html.includes('@scalar/api-reference'));
  assert.ok(html.includes('Dayan Gemini Proxy - API Docs'));
  assert.ok(html.includes('gemini-3.1-flash-image'));
});

test('handler serves /docs as HTML', async () => {
  let statusCode = null;
  let headers = {};
  let body = '';

  const mockReq = {
    method: 'GET',
    url: '/docs',
    headers: { host: 'llm.hidear.app' },
  };

  const mockRes = {
    setHeader(k, v) {
      headers[k] = v;
    },
    status(code) {
      statusCode = code;
      return this;
    },
    end(data) {
      body = data;
    }
  };

  await handler(mockReq, mockRes);
  assert.equal(statusCode, 200);
  assert.match(headers['Content-Type'], /text\/html/);
  assert.match(body, /@scalar\/api-reference/);
});

test('handler serves /openapi.json as JSON', async () => {
  let statusCode = null;
  let responseData = null;

  const mockReq = {
    method: 'GET',
    url: '/openapi.json',
    headers: { host: 'llm.hidear.app' },
  };

  const mockRes = {
    setHeader() {},
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    },
    end() {}
  };

  await handler(mockReq, mockRes);
  assert.equal(statusCode, 200);
  assert.equal(responseData.openapi, '3.1.0');
  assert.equal(responseData.servers[0].url, 'https://llm.hidear.app');
});

test('handler redirects browser requests from / to /docs', async () => {
  let redirectStatus = null;
  let redirectHeaders = null;
  let ended = false;

  const mockReq = {
    method: 'GET',
    url: '/',
    headers: {
      host: 'llm.hidear.app',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  };

  const mockRes = {
    setHeader() {},
    writeHead(status, hdrs) {
      redirectStatus = status;
      redirectHeaders = hdrs;
    },
    end() {
      ended = true;
    }
  };

  await handler(mockReq, mockRes);
  assert.equal(redirectStatus, 302);
  assert.equal(redirectHeaders.Location, '/docs');
  assert.equal(ended, true);
});

test('handler returns health JSON from / for API/curl clients', async () => {
  let statusCode = null;
  let responseData = null;

  const mockReq = {
    method: 'GET',
    url: '/',
    headers: {
      host: 'llm.hidear.app',
      accept: '*/*',
    },
  };

  const mockRes = {
    setHeader() {},
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    },
    end() {}
  };

  await handler(mockReq, mockRes);
  assert.equal(statusCode, 200);
  assert.equal(responseData.status, 'ok');
  assert.ok(responseData.features.includes('interactive-docs'));
  assert.equal(responseData.docs, 'https://llm.hidear.app/docs');
});
