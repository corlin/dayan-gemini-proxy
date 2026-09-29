import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/index.js';
import { getStatsSummary, resetStats } from '../api/logger.js';

test('handler enforces STATS_SECRET on /stats when configured', async () => {
  process.env.STATS_SECRET = 'secret-token-xyz';
  try {
    let statusCode = null;
    let responseData = null;

    const mockReq = {
      method: 'GET',
      url: '/stats',
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
    assert.equal(statusCode, 403);
    assert.equal(responseData.error.code, 'unauthorized');

    // With valid token
    let authStatusCode = null;
    let authResponseData = null;
    const authReq = {
      method: 'GET',
      url: '/stats?token=secret-token-xyz',
      headers: { host: 'llm.hidear.app', accept: 'application/json' },
    };
    const authRes = {
      setHeader() {},
      status(code) {
        authStatusCode = code;
        return this;
      },
      json(data) {
        authResponseData = data;
        return this;
      },
      end() {}
    };

    await handler(authReq, authRes);
    assert.equal(authStatusCode, 200);
    assert.ok(authResponseData.stats);
  } finally {
    delete process.env.STATS_SECRET;
  }
});

test('handler serves /stats as HTML for browser and JSON for API', async () => {
  let htmlStatus = null;
  let htmlBody = '';
  let htmlHeaders = {};

  const browserReq = {
    method: 'GET',
    url: '/stats',
    headers: { host: 'llm.hidear.app', accept: 'text/html,application/xhtml+xml' },
  };

  const browserRes = {
    setHeader(k, v) { htmlHeaders[k] = v; },
    status(code) { htmlStatus = code; return this; },
    end(data) { htmlBody = data; }
  };

  await handler(browserReq, browserRes);
  assert.equal(htmlStatus, 200);
  assert.match(htmlHeaders['Content-Type'], /text\/html/);
  assert.match(htmlBody, /Dayan Gemini Proxy Monitor/);

  // JSON request
  let jsonStatus = null;
  let jsonData = null;
  const apiReq = {
    method: 'GET',
    url: '/stats?format=json',
    headers: { host: 'llm.hidear.app' },
  };

  const apiRes = {
    setHeader() {},
    status(code) { jsonStatus = code; return this; },
    json(data) { jsonData = data; return this; },
    end() {}
  };

  await handler(apiReq, apiRes);
  assert.equal(jsonStatus, 200);
  assert.ok(jsonData.stats);
  assert.equal(typeof jsonData.stats.totalRequests, 'number');
});

test('handler rejects oversized request bodies with 413 Payload Too Large', async () => {
  let statusCode = null;
  let responseData = null;

  const mockReq = {
    method: 'POST',
    url: '/v1/images/generations',
    headers: {
      'content-length': String(20 * 1024 * 1024), // 20 MB (limit is 15MB)
      authorization: 'Bearer dummy-key',
    },
    async *[Symbol.asyncIterator]() {
      yield Buffer.alloc(100);
    }
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
  assert.equal(statusCode, 413);
  assert.equal(responseData.error.code, 'payload_too_large');
});

test('handler tracks request in logger after completion', async () => {
  resetStats();
  const mockReq = {
    method: 'OPTIONS',
    url: '/v1/images/generations',
    headers: {},
  };
  const mockRes = {
    setHeader() {},
    status() { return this; },
    end() {}
  };

  await handler(mockReq, mockRes);
  const summary = getStatsSummary();
  assert.equal(summary.totalRequests, 1);
  assert.equal(summary.statusCodes['200'], 1);
});
