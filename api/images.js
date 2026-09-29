export const SUPPORTED_MODELS = [
  'gemini-3.1-flash-image',
  'gemini-3.1-flash-image-preview',
  'gemini-3-pro-image',
  'gemini-3-pro-image-preview',
  'gemini-3.1-flash-lite-image',
  'gemini-2.5-flash-image',
];

export const MAX_BODY_BYTES = 15 * 1024 * 1024; // 15 MB
export const DEFAULT_TIMEOUT_MS = parseInt(process.env.UPSTREAM_TIMEOUT_MS || '50000', 10);

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

  if (status === 429 || code === 'RESOURCE_EXHAUSTED' || message.includes('quota') || message.includes('Quota')) {
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
      let totalBytes = 0;
      const chunks = [];
      for await (const chunk of req) {
        totalBytes += chunk.length;
        if (totalBytes > MAX_BODY_BYTES) {
          return res.status(413).json({
            error: {
              message: 'Payload Too Large: maximum allowed body size is 15MB',
              type: 'invalid_request_error',
              param: null,
              code: 'payload_too_large',
            },
          });
        }
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
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
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
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return res.status(504).json({
        error: {
          message: `Gateway Timeout: upstream Google Gemini did not respond within ${DEFAULT_TIMEOUT_MS / 1000}s`,
          type: 'api_error',
          param: null,
          code: 'gateway_timeout',
        },
      });
    }

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
