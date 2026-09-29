# dayan-gemini-proxy

Ultra-lightweight, zero-dependency transparent Google Gemini API reverse proxy hosted on Vercel, with built-in **OpenAI-compatible Text-to-Image (文生图)** support and **Interactive API Documentation**.

- **Production Endpoint**: [https://llm.hidear.app](https://llm.hidear.app)
- **Interactive API Docs (Scalar)**: [https://llm.hidear.app/docs](https://llm.hidear.app/docs)
- **OpenAPI 3.1 Spec**: [https://llm.hidear.app/openapi.json](https://llm.hidear.app/openapi.json)

## Features
- **Zero Configuration**: Transparent pass-through of all headers, query parameters, and request bodies. No API keys stored in the proxy.
- **US East Locked (`iad1`)**: Pinned to Washington D.C. (`iad1`) in `vercel.json` to completely bypass Google AI Studio region restrictions (`User location is not supported for the API use`).
- **Interactive API Documentation (`/docs`)**: Built-in Scalar interactive sandbox for browsing schemas, testing API requests in real-time, and copying code snippets in Python, Node.js, cURL, and Go.
- **OpenAI-Compatible Image Generation (`/v1/images/generations`)**: Native support for OpenAI image generation request/response format, mapped directly to Google Gemini's native image models (`gemini-3.1-flash-image` / Nano Banana 2).
- **Adaptive Image Output**: Returns both Base64 (`b64_json`) and Data URLs (`data:image/png;base64,...`) for universal compatibility with OpenAI SDKs and third-party WebUIs (NextChat, LobeChat, Chatbox, Dify, etc.).
- **Streaming Support**: Full Server-Sent Events (SSE) streaming support via `stream.pipe()`.
- **CORS Enabled**: Out-of-the-box preflight and cross-origin headers for universal client compatibility.

---

## Deployment to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fcorlin%2Fdayan-gemini-proxy)

1. Click the button above or import `corlin/dayan-gemini-proxy` in your Vercel Dashboard.
2. Deploy without needing any environment variables.
3. Configure your custom domain (e.g. `llm.hidear.app`).

---

## Usage Guide

### 1. OpenAI-Compatible Image Generation (`POST /v1/images/generations`)

This endpoint allows any OpenAI-compatible client or SDK to generate images using Google Gemini's latest image generation models.

#### Supported Models (Strict Mode)
- `gemini-3.1-flash-image` (Nano Banana 2, Recommended)
- `gemini-3-pro-image` (Nano Banana Pro)
- `gemini-3.1-flash-lite-image` (Nano Banana 2 Lite)
- `gemini-2.5-flash-image` (Nano Banana)

#### Size & Aspect Ratio Mapping
- `1024x1024` / `512x512` -> `1:1`
- `1024x1792` / `768x1344` -> `9:16`
- `1792x1024` / `1344x768` -> `16:9`
- `1024x1365` -> `3:4`
- `1365x1024` -> `4:3`

#### cURL Example
```bash
curl -X POST "https://llm.hidear.app/v1/images/generations" \
  -H "Authorization: Bearer YOUR_GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-3.1-flash-image",
    "prompt": "A cute red panda wearing astronaut suit in space, digital art",
    "size": "1024x1024"
  }'
```

#### Python OpenAI SDK Example
```python
from openai import OpenAI

client = OpenAI(
    api_key="YOUR_GEMINI_API_KEY",
    base_url="https://llm.hidear.app/v1"
)

response = client.images.generate(
    model="gemini-3.1-flash-image",
    prompt="A cozy coffee shop on a rainy evening, watercolor style",
    size="1024x1024",
    n=1
)

# Access the generated image
image_url = response.data[0].url       # data:image/png;base64,...
b64_data = response.data[0].b64_json   # Raw Base64 string
```

#### Node.js OpenAI SDK Example
```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'YOUR_GEMINI_API_KEY',
  baseURL: 'https://llm.hidear.app/v1',
});

const response = await client.images.generate({
  model: 'gemini-3.1-flash-image',
  prompt: 'Futuristic electric supercar on a mountain highway at sunset',
  size: '1792x1024',
});

console.log(response.data[0].url);
```

---

### 2. Gemini Native API Transparent Proxy

All Gemini native REST endpoints remain 100% transparently passed through to `generativelanguage.googleapis.com`.

#### Native Text Generation
```bash
curl -X POST "https://llm.hidear.app/v1beta/models/gemini-2.5-flash:generateContent" \
  -H "x-goog-api-key: YOUR_GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{"parts": [{"text": "Hello, explain quantum physics in one sentence"}]}]
  }'
```

#### Native Image Generation
```bash
curl -X POST "https://llm.hidear.app/v1beta/models/gemini-3.1-flash-image:generateContent" \
  -H "x-goog-api-key: YOUR_GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{
      "role": "user",
      "parts": [{"text": "Create an illustration of a cybernetic tiger"}]
    }],
    "generationConfig": {
      "responseModalities": ["IMAGE"],
      "imageConfig": {
        "aspectRatio": "16:9"
      }
    }
  }'
```

---

## Quota & Billing Notice

> [!NOTE]
> Google AI Studio **Free Tier projects have a quota limit of 0 for image generation models** (`limit: 0, model: gemini-3.1-flash-image`). To generate images, your Google Cloud / AI Studio project must have a Pay-as-you-go billing account attached. When quota is 0, the proxy returns an informative `429 insufficient_quota` error.

---

## Testing

```bash
# Run unit & mock test suite (19 tests)
npm test

# Run E2E test suite against local proxy server (accepts optional API key)
npm run test:e2e
# or with custom key:
node scripts/test-images.js YOUR_API_KEY
```

## License
MIT
