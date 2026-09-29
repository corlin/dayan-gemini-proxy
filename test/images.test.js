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
    /prompt.*required/i
  );
});

test('validateAndParseRequest rejects invalid model', () => {
  assert.throws(
    () => validateAndParseRequest({ prompt: 'cat', model: 'dall-e-3' }),
    /Invalid model 'dall-e-3'/
  );
  assert.throws(
    () => validateAndParseRequest({ prompt: 'cat' }),
    /model.*required/i
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
  assert.equal(err.body.error.code, 'quota_exceeded');
  assert.equal(err.body.error.type, 'insufficient_quota');
  assert.match(err.body.error.message, /Pay-as-you-go/);
});

test('handler dispatches /v1/images/generations and returns 401 when unauthenticated', async () => {
  const { default: handler } = await import('../api/index.js');
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
  const { default: handler } = await import('../api/index.js');
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
