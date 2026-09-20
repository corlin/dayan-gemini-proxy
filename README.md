# dayan-gemini-proxy

Ultra-lightweight, zero-dependency transparent Google Gemini API reverse proxy hosted on Vercel.

## Features
- **Zero Configuration**: Transparent pass-through of all headers, query parameters, and request bodies. No API keys stored in the proxy.
- **US East Locked (`iad1`)**: Pinned to Washington D.C. (`iad1`) in `vercel.json` to completely bypass Google AI Studio region restrictions (`User location is not supported for the API use`).
- **Streaming Support**: Full Server-Sent Events (SSE) streaming support via `stream.pipe()`.
- **CORS Enabled**: Out-of-the-box preflight and cross-origin headers for universal client compatibility.

## Deployment to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fcorlin%2Fdayan-gemini-proxy)

1. Click the button above or import `corlin/dayan-gemini-proxy` in your Vercel Dashboard.
2. Deploy without needing any environment variables.
3. Use your Vercel URL (e.g. `https://dayan-gemini-proxy.vercel.app`) as your Gemini base URL:
   - Request: `https://dayan-gemini-proxy.vercel.app/v1beta/models/gemini-3-flash-preview:generateContent`
   - Header: `x-goog-api-key: YOUR_GEMINI_API_KEY`
