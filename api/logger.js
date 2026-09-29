const BUFFER_CAPACITY = 100;

let startTime = Date.now();
let totalRequests = 0;
let successRequests = 0;
let failedRequests = 0;
let totalLatencyMs = 0;
const statusCodes = {};
const models = {};
const recentLogs = [];

export function maskKey(key) {
  if (!key || typeof key !== 'string') return 'anonymous';
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '***';
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

export function maskIp(ip) {
  if (!ip || typeof ip !== 'string') return 'unknown';
  const cleanIp = ip.replace(/^.*:/, ''); // strip IPv6 prefix if any
  if (cleanIp.includes('.')) {
    const parts = cleanIp.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.***`;
    }
  }
  // IPv6 fallback
  if (ip.includes(':')) {
    const parts = ip.split(':');
    return `${parts.slice(0, 2).join(':')}:***`;
  }
  return '***';
}

export function recordRequest({
  method = 'GET',
  path = '/',
  model = 'none',
  status = 200,
  durationMs = 0,
  clientIp = 'unknown',
  apiKey = null,
  error = null,
  region = process.env.VERCEL_REGION || 'iad1',
}) {
  totalRequests++;
  totalLatencyMs += durationMs;

  const isSuccess = status >= 200 && status < 400;
  if (isSuccess) {
    successRequests++;
  } else {
    failedRequests++;
  }

  // Status code distribution
  const statusStr = String(status);
  statusCodes[statusStr] = (statusCodes[statusStr] || 0) + 1;

  // Model distribution
  if (model && model !== 'none') {
    models[model] = (models[model] || 0) + 1;
  }

  const logEntry = {
    id: `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    time: new Date().toISOString(),
    method: method.toUpperCase(),
    path,
    model: model || 'none',
    status,
    durationMs: Math.round(durationMs),
    clientIp: maskIp(clientIp),
    apiKey: maskKey(apiKey),
    region,
    ...(error ? { error: typeof error === 'string' ? error : error?.message || 'Error' } : {}),
  };

  // Prepend to ring buffer
  recentLogs.unshift(logEntry);
  if (recentLogs.length > BUFFER_CAPACITY) {
    recentLogs.pop();
  }

  // Emit structured JSON log to stdout for log aggregator drains
  try {
    console.log(JSON.stringify({
      level: isSuccess ? 'INFO' : 'WARN',
      type: 'http_request',
      ...logEntry,
    }));
  } catch {
    // ignore stdout errors
  }

  return logEntry;
}

export function getStatsSummary() {
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
  const successRate = totalRequests > 0
    ? `${((successRequests / totalRequests) * 100).toFixed(1)}%`
    : '100.0%';
  const averageLatencyMs = totalRequests > 0
    ? Math.round(totalLatencyMs / totalRequests)
    : 0;

  return {
    uptimeSeconds,
    totalRequests,
    successRequests,
    failedRequests,
    successRate,
    averageLatencyMs,
    statusCodes: { ...statusCodes },
    models: { ...models },
    recentLogs: [...recentLogs],
  };
}

export function resetStats() {
  startTime = Date.now();
  totalRequests = 0;
  successRequests = 0;
  failedRequests = 0;
  totalLatencyMs = 0;
  for (const k in statusCodes) delete statusCodes[k];
  for (const k in models) delete models[k];
  recentLogs.length = 0;
}

export function verifyStatsAuth(req) {
  const secret = process.env.STATS_SECRET || process.env.ADMIN_TOKEN;
  if (!secret) {
    return true; // No secret configured -> open access
  }

  // 1. Check Query Param ?token=
  try {
    const parsed = new URL(req.url, 'http://localhost');
    const tokenParam = parsed.searchParams.get('token');
    if (tokenParam && tokenParam.trim() === secret) {
      return true;
    }
  } catch {
    // ignore
  }

  // 2. Check Header x-admin-token
  const headerToken = req.headers?.['x-admin-token'] || req.headers?.['X-Admin-Token'];
  if (headerToken && headerToken.trim() === secret) {
    return true;
  }

  // 3. Check Authorization: Bearer <token>
  const authHeader = req.headers?.authorization || req.headers?.Authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    if (authHeader.slice(7).trim() === secret) {
      return true;
    }
  }

  return false;
}
