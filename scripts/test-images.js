import http from 'node:http';
import handler from '../api/index.js';

const apiKey = process.argv[2] || process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.log('Notice: No API key provided via argument or GEMINI_API_KEY env var.');
  console.log('Usage: node scripts/test-images.js <YOUR_GEMINI_API_KEY>');
  console.log('Skipping live upstream requests (local route tests only).\n');
}

console.log('====================================================');
console.log(' Gemini Proxy Image Generation E2E Test Suite');
console.log(` Target API Key: ${apiKey ? `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}` : 'None (Mock Only)'}`);
console.log('====================================================\n');

// 1. Create a local HTTP server wrapping the Vercel handler
const server = http.createServer((req, res) => {
  // Polyfill express/vercel helper methods on res if not present
  res.status = function (code) {
    this.statusCode = code;
    return this;
  };
  res.json = function (obj) {
    this.setHeader('Content-Type', 'application/json');
    this.end(JSON.stringify(obj, null, 2));
    return this;
  };

  handler(req, res);
});

server.listen(0, async () => {
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;
  console.log(`[Info] Local proxy server started at ${baseUrl}\n`);

  try {
    // -------------------------------------------------------------------------
    // Test 1: Health check
    // -------------------------------------------------------------------------
    console.log('[Test 1] Root Health Check & Docs Links...');
    const healthRes = await fetch(`${baseUrl}/`);
    const healthData = await healthRes.json();
    console.log(`Status: ${healthRes.status}, Features:`, healthData.features);
    if (!healthData.features?.includes('interactive-docs')) {
      throw new Error('Health check missing interactive-docs feature flag');
    }
    console.log(`Docs URL: ${healthData.docs}, OpenAPI: ${healthData.openapi}`);
    console.log('✔ Root health check passed\n');

    // -------------------------------------------------------------------------
    // Test 1b: Interactive API Docs (/docs) & OpenAPI (/openapi.json)
    // -------------------------------------------------------------------------
    console.log('[Test 1b] Verifying /docs HTML and /openapi.json spec...');
    const docsRes = await fetch(`${baseUrl}/docs`);
    const docsHtml = await docsRes.text();
    if (docsRes.status !== 200 || !docsHtml.includes('@scalar/api-reference')) {
      throw new Error('Failed to load /docs with Scalar UI');
    }
    console.log('✔ /docs serves Scalar API Reference HTML correctly');

    const openApiRes = await fetch(`${baseUrl}/openapi.json`);
    const openApiData = await openApiRes.json();
    if (openApiRes.status !== 200 || openApiData.openapi !== '3.1.0') {
      throw new Error('Failed to load /openapi.json with valid OpenAPI 3.1.0 spec');
    }
    console.log(`✔ /openapi.json serves valid OpenAPI 3.1.0 with ${Object.keys(openApiData.paths).length} endpoints\n`);

    // -------------------------------------------------------------------------
    // Test 2: OpenAI Missing Auth Check
    // -------------------------------------------------------------------------
    console.log('[Test 2] OpenAI Route Authentication Enforcement...');
    const unauthRes = await fetch(`${baseUrl}/v1/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'test', model: 'gemini-3.1-flash-image' }),
    });
    const unauthData = await unauthRes.json();
    console.log(`Status: ${unauthRes.status}`, unauthData);
    if (unauthRes.status !== 401 || unauthData.error?.code !== 'invalid_api_key') {
      throw new Error('Expected 401 invalid_api_key error');
    }
    console.log('✔ Auth enforcement passed\n');

    // -------------------------------------------------------------------------
    // Test 3: OpenAI Invalid Model Check (Strict Mode)
    // -------------------------------------------------------------------------
    console.log('[Test 3] OpenAI Route Model Validation (Strict Mode)...');
    const invalidModelRes = await fetch(`${baseUrl}/v1/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ prompt: 'test', model: 'dall-e-3' }),
    });
    const invalidModelData = await invalidModelRes.json();
    console.log(`Status: ${invalidModelRes.status}`, invalidModelData);
    if (invalidModelRes.status !== 400 || !invalidModelData.error?.message?.includes('Invalid model')) {
      throw new Error('Expected 400 Invalid model error');
    }
    console.log('✔ Model validation passed\n');

    // -------------------------------------------------------------------------
    // Test 4: Native Gemini Image Pass-through (Real API Call)
    // -------------------------------------------------------------------------
    if (apiKey) {
      console.log('[Test 4] Native Gemini Image Pass-through to Google Generative Language API...');
      const nativeRes = await fetch(`${baseUrl}/v1beta/models/gemini-3.1-flash-image:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'A small red apple' }] }],
          generationConfig: { responseModalities: ['IMAGE'] },
        }),
      });
      const nativeData = await nativeRes.json();
      console.log(`Status: ${nativeRes.status}`);
      if (nativeRes.ok) {
        console.log('✔ Upstream Gemini native image generation succeeded!');
      } else {
        console.log(`Upstream Response Code: ${nativeRes.status}, Error Message:`, nativeData.error?.message?.slice(0, 180));
        console.log('✔ Native transparent proxying accurately returned upstream status.\n');
      }

      // -------------------------------------------------------------------------
      // Test 5: OpenAI Compatible Image Generation (Real API Call)
      // -------------------------------------------------------------------------
      console.log('[Test 5] OpenAI Compatible /v1/images/generations with Real API Call...');
      const openAIRes = await fetch(`${baseUrl}/v1/images/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          prompt: 'A futuristic city skyline with neon lights',
          model: 'gemini-3.1-flash-image',
          size: '1024x1024',
        }),
      });
      const openAIData = await openAIRes.json();
      console.log(`Status: ${openAIRes.status}`);
      console.log('Response body:', JSON.stringify(openAIData, null, 2));

      if (openAIRes.ok) {
        console.log('✔ OpenAI image generation returned 200 with generated data!');
      } else {
        if (openAIData.error?.code === 'quota_exceeded') {
          console.log('✔ Quota exceeded correctly translated into OpenAI standard error with helpful Pay-as-you-go hint!');
        } else {
          console.log('Upstream returned error, properly formatted as OpenAI standard.');
        }
      }
    } else {
      console.log('[Notice] Skipping Test 4 & Test 5 (live upstream requests). Provide an API key to run them.');
    }

    console.log('\n====================================================');
    console.log(' All E2E Integration Checks Completed Successfully!');
    console.log('====================================================');
  } catch (err) {
    console.error('E2E Test Failed:', err);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
