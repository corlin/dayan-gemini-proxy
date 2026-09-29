export function getOpenApiSpec(serverUrl = 'https://llm.hidear.app') {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Dayan Gemini Proxy API',
      version: '1.0.0',
      description: `
Ultra-lightweight Google Gemini API reverse proxy with native **OpenAI-compatible Text-to-Image (文生图)** support.

- **Production URL**: \`${serverUrl}\`
- **Region**: Pinned to US East (\`iad1\`) to bypass Google AI Studio region restrictions.
- **Image Models**: Powered by Gemini 3.1 Flash Image (Nano Banana 2) & Gemini 3 Pro Image (Nano Banana Pro).
- **Authentication**: Supports \`Authorization: Bearer <KEY>\`, \`x-goog-api-key: <KEY>\`, or \`?key=<KEY>\`.

> **Note on Free Tier Quota**: Google AI Studio Free Tier has a quota of **0** for image generation models. A Pay-as-you-go billing account must be linked to your Google Cloud project to generate images.
      `.trim(),
    },
    servers: [
      {
        url: serverUrl,
        description: 'Dayan Gemini Proxy Server',
      },
    ],
    tags: [
      {
        name: 'OpenAI Compatible',
        description: 'Endpoints adhering to standard OpenAI specifications for third-party client compatibility.',
      },
      {
        name: 'Gemini Native',
        description: 'Direct transparent pass-through to Google Generative Language API.',
      },
      {
        name: 'System',
        description: 'Service health check and diagnostic endpoints.',
      },
    ],
    paths: {
      '/v1/images/generations': {
        post: {
          tags: ['OpenAI Compatible'],
          summary: 'Text-to-Image Generation (OpenAI format)',
          description: `
Generates images from a text prompt in OpenAI standard format. 

Internally maps requests to Google Gemini native image models (such as \`gemini-3.1-flash-image\`) and returns both Base64 and Data URL. Compatible with OpenAI Python SDK, Node.js SDK, NextChat, LobeChat, Chatbox, and Dify.
          `.trim(),
          operationId: 'generateImage',
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['prompt', 'model'],
                  properties: {
                    model: {
                      type: 'string',
                      description: 'Gemini image model name. Strict mode requires a valid Gemini image model.',
                      enum: [
                        'gemini-3.1-flash-image',
                        'gemini-3-pro-image',
                        'gemini-3.1-flash-lite-image',
                        'gemini-2.5-flash-image',
                      ],
                      default: 'gemini-3.1-flash-image',
                      example: 'gemini-3.1-flash-image',
                    },
                    prompt: {
                      type: 'string',
                      description: 'Text description of the desired image.',
                      example: 'A cute red panda wearing an astronaut helmet floating in deep starry space, digital art, high detail',
                    },
                    size: {
                      type: 'string',
                      description: 'Image resolution / aspect ratio. Automatically mapped to Gemini imageConfig.aspectRatio.',
                      enum: ['1024x1024', '1024x1792', '1792x1024', '1024x1365', '1365x1024', '512x512'],
                      default: '1024x1024',
                      example: '1024x1024',
                    },
                    n: {
                      type: 'integer',
                      description: 'Number of images to generate (currently 1).',
                      default: 1,
                      example: 1,
                    },
                    response_format: {
                      type: 'string',
                      description: 'Format of the generated image. Both b64_json and data URL are always provided in the response.',
                      enum: ['url', 'b64_json'],
                      default: 'url',
                      example: 'url',
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Image generated successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      created: { type: 'integer', example: 1740000000 },
                      data: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            b64_json: { type: 'string', description: 'Raw Base64 encoded image string' },
                            url: { type: 'string', description: 'Data URL formatted image string (data:image/png;base64,...)', example: 'data:image/png;base64,iVBORw0KGgo...' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            '400': {
              description: 'Bad Request - Missing prompt or unsupported model',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      error: {
                        type: 'object',
                        properties: {
                          message: { type: 'string' },
                          type: { type: 'string', example: 'invalid_request_error' },
                          code: { type: 'string', example: 'invalid_request' },
                        },
                      },
                    },
                  },
                },
              },
            },
            '401': {
              description: 'Unauthorized - Missing or invalid API key',
            },
            '429': {
              description: 'Quota Exceeded - Upstream Google rate limit or Free Tier limit: 0',
            },
          },
        },
      },
      '/v1beta/models/{model}:generateContent': {
        post: {
          tags: ['Gemini Native'],
          summary: 'Gemini Native Generate Content (Text / Vision / Native Image)',
          description: 'Transparently forwarded directly to Google Generative Language API.',
          parameters: [
            {
              name: 'model',
              in: 'path',
              required: true,
              schema: { type: 'string', example: 'gemini-3.1-flash-image' },
            },
          ],
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['contents'],
                  properties: {
                    contents: { type: 'array', items: { type: 'object' } },
                    generationConfig: {
                      type: 'object',
                      properties: {
                        responseModalities: {
                          type: 'array',
                          items: { type: 'string' },
                          example: ['IMAGE'],
                        },
                        imageConfig: {
                          type: 'object',
                          properties: {
                            aspectRatio: { type: 'string', example: '16:9' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Upstream Gemini response' },
          },
        },
      },
      '/v1beta/models/{model}:streamGenerateContent': {
        post: {
          tags: ['Gemini Native'],
          summary: 'Gemini Native SSE Streaming Generation',
          description: 'Pass `?alt=sse` to stream tokens via Server-Sent Events.',
          parameters: [
            {
              name: 'model',
              in: 'path',
              required: true,
              schema: { type: 'string', example: 'gemini-2.5-flash' },
            },
            {
              name: 'alt',
              in: 'query',
              required: false,
              schema: { type: 'string', default: 'sse' },
            },
          ],
          security: [{ ApiKeyAuth: [] }],
          responses: {
            '200': {
              description: 'SSE stream (text/event-stream)',
              content: { 'text/event-stream': {} },
            },
          },
        },
      },
      '/': {
        get: {
          tags: ['System'],
          summary: 'Health Check & Service Info',
          description: 'Returns proxy status, pinned region, and supported features. (Browsers will be redirected to /docs).',
          responses: {
            '200': {
              description: 'Health status response',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', example: 'ok' },
                      service: { type: 'string', example: 'dayan-gemini-proxy' },
                      target: { type: 'string', example: 'https://generativelanguage.googleapis.com' },
                      region: { type: 'string', example: 'iad1' },
                      features: { type: 'array', items: { type: 'string' } },
                      timestamp: { type: 'string', example: '2026-09-29T02:00:00.000Z' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'OpenAI standard API key header: `Authorization: Bearer <API_KEY>`',
        },
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-goog-api-key',
          description: 'Google standard API key header: `x-goog-api-key: <API_KEY>`',
        },
      },
    },
  };
}

export function renderScalarHtml(serverUrl = 'https://llm.hidear.app') {
  const spec = getOpenApiSpec(serverUrl);
  const specJsonString = JSON.stringify(spec).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Dayan Gemini Proxy - API Docs</title>
    <meta name="description" content="Dayan Gemini Proxy API Reference & Interactive Sandbox (Image Generation & Native Gemini APIs)" />
    <link rel="icon" href="https://ai.google.dev/static/site-assets/images/favicon-new.png" />
    <style>
      body {
        margin: 0;
        padding: 0;
        background-color: #0b0f19;
      }
    </style>
  </head>
  <body>
    <script id="api-reference" type="application/json">
      ${specJsonString}
    </script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`;
}
