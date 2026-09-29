# Gemini 文生图 (Image Generation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `dayan-gemini-proxy` 增加对 OpenAI 兼容文生图端点 (`POST /v1/images/generations`) 的转译支持，映射到 Gemini 最新原生多模态图像生成模型（如 `gemini-3.1-flash-image`），同时保持原有原生端点透明转发。

**Architecture:** 在 `api/index.js` 中新增路由检测，将 `/v1/images/generations` 转发至独立的转译处理器 `api/images.js`；`api/images.js` 负责 API Key 提取、严格模型与入参校验、调用 Google Gemini 上游端点、将 Base64 `inlineData` 转换为 OpenAI 兼容响应格式或标准错误结构。

**Tech Stack:** Node.js (ES Module), Native Fetch, Native Test Runner (`node:test`, `node:assert`), zero external production dependencies.

## Global Constraints
- Zero external runtime/production dependencies.
- Strict model validation: client must provide a valid Gemini image model name (`gemini-3.1-flash-image`, `gemini-3-pro-image`, `gemini-3.1-flash-lite-image`, `gemini-2.5-flash-image`, or starting with `gemini-` and containing `image`).
- Multi-source auth extraction: `Authorization: Bearer <KEY>`, `x-goog-api-key`, `?key=<KEY>`.
- Adaptive response format: return both `b64_json` and `url` (`data:<mimeType>;base64,<data>`).
- Preserve transparent proxying for all other routes.

---

### Task 1: 核心文生图转译模块与单测实现 (api/images.js)

**Files:**
- Create: `api/images.js`
- Create: `test/images.test.js`
- Modify: `package.json:7-9`

**Interfaces:**
- Produces:
  - `extractApiKey(req): string | null`
  - `mapSizeToAspectRatio(size): string`
  - `validateAndParseRequest(body): { model, prompt, aspectRatio, n, responseFormat }`
  - `mapOpenAIToGeminiPayload({ prompt, aspectRatio }): object`
  - `mapGeminiToOpenAIResponse(geminiData): object`
  - `mapGeminiErrorToOpenAIError(geminiError, status): { status: number, body: object }`
  - `handleImageGeneration(req, res): Promise<void>`

- [ ] **Step 1: 在 package.json 中配置测试脚本**

Modify `package.json` to add `"test": "node --test test/images.test.js"`:
```json
  "scripts": {
    "start": "node api/index.js",
    "test": "node --test test/images.test.js"
  }
```

- [ ] **Step 2: 编写失败的单元测试 (test/images.test.js)**

Create `test/images.test.js`:
```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractApiKey,
  mapSizeToAspectRatio,
  validateAndParseRequest,
  mapOpenAIToGeminiPayload,
  mapGeminiToOpenAIResponse,
  mapGeminiErrorToOpenAIError,
} from '../api/images.js';

test('extractApiKey extracts from Bearer token', () => {
  const req = { headers: { authorization: 'Bearer test-key-123' }, url: '/v1/images/generations' };
  assert.equal(extractApiKey(req), 'test-key-123');
});

test('extractApiKey extracts from x-goog-api-key', () => {
  const req = { headers: { 'x-goog-api-key': 'test-key-456' }, url: '/v1/images/generations' };
  assert.equal(extractApiKey(req), 'test-key-456');
});

test('extractApiKey extracts from query param key', () => {
  const req = { headers: {}, url: '/v1/images/generations?key=test-key-789' };
  assert.equal(extractApiKey(req), 'test-key-789');
});

test('extractApiKey returns null if none found', () => {
  const req = { headers: {}, url: '/v1/images/generations' };
  assert.equal(extractApiKey(req), null);
});

test('mapSizeToAspectRatio correctly maps standard resolutions', () => {
  assert.equal(mapSizeToAspectRatio('1024x1024'), '1:1');
  assert.equal(mapSizeToAspectRatio('1024x1792'), '9:16');
  assert.equal(mapSizeToAspectRatio('1792x1024'), '16:9');
  assert.equal(mapSizeToAspectRatio('unknown'), '1:1');
  assert.equal(mapSizeToAspectRatio(undefined), '1:1');
});

test('validateAndParseRequest rejects missing prompt', () => {
  assert.throws(
    () => validateAndParseRequest({ model: 'gemini-3.1-flash-image' }),
    /prompt is required/
  );
});

test('validateAndParseRequest rejects invalid model', () => {
  assert.throws(
    () => validateAndParseRequest({ prompt: 'cat', model: 'dall-e-3' }),
    /Invalid model 'dall-e-3'/
  );
  assert.throws(
    () => validateAndParseRequest({ prompt: 'cat' }),
    /model is required/
  );
});

test('validateAndParseRequest accepts valid gemini image model', () => {
  const parsed = validateAndParseRequest({
    prompt: 'a cute cat',
    model: 'gemini-3.1-flash-image',
    size: '1024x1792'
  });
  assert.equal(parsed.model, 'gemini-3.1-flash-image');
  assert.equal(parsed.prompt, 'a cute cat');
  assert.equal(parsed.aspectRatio, '9:16');
});

test('mapOpenAIToGeminiPayload generates correct Gemini structure', () => {
  const payload = mapOpenAIToGeminiPayload({
    prompt: 'a blue flower',
    aspectRatio: '16:9'
  });
  assert.deepEqual(payload, {
    contents: [
      {
        role: 'user',
        parts: [{ text: 'a blue flower' }]
      }
    ],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: {
        aspectRatio: '16:9'
      }
    }
  });
});

test('mapGeminiToOpenAIResponse converts inlineData to OpenAI format', () => {
  const geminiData = {
    candidates: [
      {
        content: {
          parts: [
            {
              inlineData: {
                mimeType: 'image/png',
                data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
              }
            }
          ]
        }
      }
    ]
  };

  const openAIRes = mapGeminiToOpenAIResponse(geminiData);
  assert.equal(typeof openAIRes.created, 'number');
  assert.equal(openAIRes.data.length, 1);
  assert.equal(openAIRes.data[0].b64_json, geminiData.candidates[0].content.parts[0].inlineData.data);
  assert.equal(openAIRes.data[0].url, `data:image/png;base64,${geminiData.candidates[0].content.parts[0].inlineData.data}`);
});

test('mapGeminiErrorToOpenAIError translates quota limit: 0 with helpful hint', () => {
  const geminiError = {
    error: {
      code: 429,
      message: 'Quota exceeded for metric: limit: 0, model: gemini-3.1-flash-image',
      status: 'RESOURCE_EXHAUSTED'
    }
  };

  const err = mapGeminiErrorToOpenAIError(geminiError, 429);
  assert.equal(err.status, 429);
  assert.equal(err.body.error.code, 'insufficient_quota');
  assert.match(err.body.error.message, /Pay-as-you-go/);
});
```

- [ ] **Step 3: 运行测试以确认其失败**

Run: `npm test`
Expected: FAIL (Cannot find module `../api/images.js`)

- [ ] **Step 4: 实现 api/images.js 最小代码**

Create `api/images.js`:
```javascript
export const SUPPORTED_MODELS = [
  'gemini-3.1-flash-image',
  'gemini-3.1-flash-image-preview',
  'gemini-3-pro-image',
  'gemini-3-pro-image-preview',
  'gemini-3.1-flash-lite-image',
  'gemini-2.5-flash-image',
];

export function extractApiKey(req) {
  const authHeader = req.headers?.authorization || req.headers?.Authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const xGoogKey = req.headers?.['x-goog-api-key'] || req.headers?.['X-Goog-Api-Key'];
  if (xGoogKey) {
    return xGoogKey.trim();
  }
  if (req.url) {
    try {
      const parsedUrl = new URL(req.url, 'http://localhost');
      const keyParam = parsedUrl.searchParams.get('key');
      if (keyParam) return keyParam.trim();
    } catch {
      // ignore url parse error
    }
  }
  return null;
}

export function mapSizeToAspectRatio(size) {
  if (!size) return '1:1';
  const sizeMap = {
    '1024x1024': '1:1',
    '512x512': '1:1',
    '1024x1792': '9:16',
    '768x1344': '9:16',
    '1792x1024': '16:9',
    '1344x768': '16:9',
    '1024x1365': '3:4',
    '1365x1024': '4:3',
  };
  return sizeMap[size.toLowerCase()] || '1:1';
}

export function validateAndParseRequest(body) {
  if (!body || typeof body !== 'object') {
    throw new Error('Invalid request body, JSON object expected');
  }

  const { prompt, model, size, n = 1, response_format = 'url' } = body;

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    throw new Error("Missing required field: 'prompt' is required");
  }

  if (!model || typeof model !== 'string') {
    throw new Error(
      `Field 'model' is required. Supported Gemini image models: ${SUPPORTED_MODELS.join(', ')}`
    );
  }

  const trimmedModel = model.trim();
  const isValidModel =
    SUPPORTED_MODELS.includes(trimmedModel) ||
    (trimmedModel.startsWith('gemini-') && trimmedModel.includes('image'));

  if (!isValidModel) {
    throw new Error(
      `Invalid model '${trimmedModel}'. This proxy requires a valid Gemini image model (e.g., 'gemini-3.1-flash-image', 'gemini-3-pro-image').`
    );
  }

  const aspectRatio = mapSizeToAspectRatio(size);

  return {
    model: trimmedModel,
    prompt: prompt.trim(),
    aspectRatio,
    n,
    responseFormat: response_format,
  };
}

export function mapOpenAIToGeminiPayload({ prompt, aspectRatio }) {
  return {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: {
        aspectRatio,
      },
    },
  };
}

export function mapGeminiToOpenAIResponse(geminiData) {
  const parts = geminiData?.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p) => p.inlineData && p.inlineData.data);

  if (!imagePart) {
    throw new Error('Gemini API did not return any image data in candidates[0].content.parts');
  }

  const { mimeType = 'image/png', data } = imagePart.inlineData;
  const dataUrl = `data:${mimeType};base64,${data}`;

  return {
    created: Math.floor(Date.now() / 1000),
    data: [
      {
        b64_json: data,
        url: dataUrl,
      },
    ],
  };
}

export function mapGeminiErrorToOpenAIError(geminiError, status = 500) {
  const errObj = geminiError?.error || geminiError || {};
  let message = errObj.message || 'Unknown upstream error from Google Gemini API';
  let code = errObj.status || 'upstream_error';
  let type = 'api_error';

  if (status === 429 || code === 'RESOURCE_EXHAUSTED' || message.includes('quota')) {
    type = 'insufficient_quota';
    code = 'quota_exceeded';
    if (message.includes('limit: 0')) {
      message += ' (Note: Google AI Studio Free Tier has 0 quota for image generation. A Pay-as-you-go billing account is required).';
    }
  } else if (status === 400 || code === 'INVALID_ARGUMENT') {
    type = 'invalid_request_error';
    code = 'invalid_argument';
  } else if (status === 403 || code === 'PERMISSION_DENIED') {
    type = 'invalid_request_error';
    code = 'permission_denied';
  }

  return {
    status,
    body: {
      error: {
        message,
        type,
        param: null,
        code,
      },
    },
  };
}

export async function handleImageGeneration(req, res, rawBody = null) {
  const apiKey = extractApiKey(req);
  if (!apiKey) {
    return res.status(401).json({
      error: {
        message: 'Missing API key. Provide via Authorization: Bearer <KEY>, x-goog-api-key, or ?key=<KEY>',
        type: 'invalid_request_error',
        param: null,
        code: 'invalid_api_key',
      },
    });
  }

  let body;
  try {
    if (rawBody && typeof rawBody === 'object') {
      body = rawBody;
    } else if (typeof rawBody === 'string') {
      body = JSON.parse(rawBody);
    } else {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const rawText = Buffer.concat(chunks).toString('utf8');
      body = rawText ? JSON.parse(rawText) : {};
    }
  } catch {
    return res.status(400).json({
      error: {
        message: 'Invalid JSON request body',
        type: 'invalid_request_error',
        param: null,
        code: 'bad_request',
      },
    });
  }

  let parsedParams;
  try {
    parsedParams = validateAndParseRequest(body);
  } catch (err) {
    return res.status(400).json({
      error: {
        message: err.message,
        type: 'invalid_request_error',
        param: null,
        code: 'invalid_request',
      },
    });
  }

  const { model, prompt, aspectRatio } = parsedParams;
  const geminiPayload = mapOpenAIToGeminiPayload({ prompt, aspectRatio });
  const upstreamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  try {
    const upstreamRes = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(geminiPayload),
    });

    const responseJson = await upstreamRes.json().catch(() => ({}));

    if (!upstreamRes.ok) {
      const translated = mapGeminiErrorToOpenAIError(responseJson, upstreamRes.status);
      return res.status(translated.status).json(translated.body);
    }

    const openAIResponse = mapGeminiToOpenAIResponse(responseJson);
    return res.status(200).json(openAIResponse);
  } catch (err) {
    console.error('Image generation upstream error:', err);
    return res.status(502).json({
      error: {
        message: err?.message || 'Failed to communicate with Google Gemini API',
        type: 'api_error',
        param: null,
        code: 'bad_gateway',
      },
    });
  }
}
```

- [ ] **Step 5: 运行测试以确认全部通过**

Run: `npm test`
Expected: PASS all tests.

- [ ] **Step 6: 提交代码**

Run: `git add package.json api/images.js test/images.test.js && git commit -m "feat: add api/images.js with unit test suite"`

---

### Task 2: 路由分发集成 (api/index.js)

**Files:**
- Modify: `api/index.js`
- Modify: `test/images.test.js`

**Interfaces:**
- Consumes: `handleImageGeneration(req, res)` from `api/images.js`
- Updates: `api/index.js` to inspect `req.url` pathname and route to `handleImageGeneration` if matching `/v1/images/generations` or `*/images/generations`.

- [ ] **Step 1: 在 test/images.test.js 增加 handler 端到端模拟测试**

Add to `test/images.test.js`:
```javascript
import handler from '../api/index.js';

test('handler dispatches /v1/images/generations and returns 401 when unauthenticated', async () => {
  let statusCode = null;
  let responseData = null;

  const mockReq = {
    method: 'POST',
    url: '/v1/images/generations',
    headers: {},
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify({ prompt: 'test', model: 'gemini-3.1-flash-image' }));
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
  assert.equal(statusCode, 401);
  assert.equal(responseData.error.code, 'invalid_api_key');
});

test('handler preserves CORS headers and handles OPTIONS for images endpoint', async () => {
  const headers = {};
  let ended = false;
  let statusCode = null;

  const mockReq = {
    method: 'OPTIONS',
    url: '/v1/images/generations',
    headers: {}
  };

  const mockRes = {
    setHeader(k, v) {
      headers[k] = v;
    },
    status(code) {
      statusCode = code;
      return this;
    },
    end() {
      ended = true;
    }
  };

  await handler(mockReq, mockRes);
  assert.equal(statusCode, 200);
  assert.equal(headers['Access-Control-Allow-Origin'], '*');
  assert.equal(ended, true);
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npm test`
Expected: FAIL (handler does not route to images.js yet, tries to proxy to upstream)

- [ ] **Step 3: 修改 api/index.js 集成文生图路由**

Modify `api/index.js`:
```javascript
import { Readable } from 'node:stream';
import { handleImageGeneration } from './images.js';

/**
 * Transparent Gemini API Reverse Proxy on Vercel (pinned to iad1 US East).
 * 
 * Forwards all incoming requests directly to https://generativelanguage.googleapis.com
 * Supports OpenAI-compatible image generation at /v1/images/generations
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
      features: ['transparent-proxy', 'openai-image-generation'],
      timestamp: new Date().toISOString()
    });
  }

  // OpenAI Compatible Images Generation Route
  const parsedUrl = new URL(req.url, 'http://localhost');
  const pathname = parsedUrl.pathname.replace(/\/+$/, '');
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
```

- [ ] **Step 4: 运行测试以确认全部通过**

Run: `npm test`
Expected: PASS all tests.

- [ ] **Step 5: 提交代码**

Run: `git add api/index.js test/images.test.js && git commit -m "feat: route /v1/images/generations to image handler in api/index.js"`

---

### Task 3: 编写端到端真实 API 测试与验证脚本 (scripts/test-images.js)

**Files:**
- Create: `scripts/test-images.js`

- [ ] **Step 1: 编写测试脚本**

Create `scripts/test-images.js`:
包含两项测试：
1. **原生 Gemini 图像接口测试** (`/v1beta/models/gemini-3.1-flash-image:generateContent`)：验证透明透传及上游配额/状态。
2. **OpenAI 兼容文生图接口测试** (`/v1/images/generations`)：本地启动轻量 HTTP 服务器包装 handler，发送标准 OpenAI 格式请求，校验状态码、响应结构及配额信息友好转译。

- [ ] **Step 2: 运行真实测试脚本验证**

Run: `node scripts/test-images.js <YOUR_GEMINI_API_KEY>`
Expected:
- 原生接口收到上游准确响应（429 limit: 0 说明链路 100% 打通至 Google 并被正确透传）
- OpenAI 接口收到转换后的标准 `{ error: { code: 'insufficient_quota', message: '...' } }` 格式，说明转译逻辑正确生效。

- [ ] **Step 3: 提交代码**

Run: `git add scripts/test-images.js && git commit -m "test: add E2E test script for native and OpenAI image generation"`

---

### Task 4: 更新 README.md 文档

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 补充文生图完整使用说明与调用示例**

Update `README.md`:
- 增加 Features: OpenAI-Compatible Image Generation (`/v1/images/generations`).
- 增加调用示例：
  1. OpenAI Python SDK 调用示例
  2. OpenAI Node.js SDK 调用示例
  3. cURL OpenAI 兼容调用示例
  4. cURL Gemini 原生多模态图像调用示例
- 说明配额与限制（Free tier 配额为 0，需 Pay-as-you-go）。

- [ ] **Step 2: 提交代码**

Run: `git add README.md && git commit -m "docs: add image generation guide and code samples in README"`
