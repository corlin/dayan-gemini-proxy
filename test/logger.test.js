import test from 'node:test';
import assert from 'node:assert/strict';
import {
  maskKey,
  maskIp,
  recordRequest,
  getStatsSummary,
  resetStats,
  verifyStatsAuth,
} from '../api/logger.js';

test('maskKey masks long API keys safely', () => {
  assert.equal(maskKey('AIzaSyTestMockKeyForVerification789xyz'), 'AIzaSy...9xyz');
  assert.equal(maskKey('1234567890'), '123456...7890');
  assert.equal(maskKey('short'), '***');
  assert.equal(maskKey(null), 'anonymous');
});

test('maskIp masks IPv4 and IPv6 addresses', () => {
  assert.equal(maskIp('192.168.1.100'), '192.168.1.***');
  assert.equal(maskIp('10.0.0.1'), '10.0.0.***');
  assert.equal(maskIp('2001:0db8:85a3:0000:0000:8a2e:0370:7334'), '2001:0db8:***');
  assert.equal(maskIp(null), 'unknown');
});

test('recordRequest updates counters and keeps ring buffer limited', () => {
  resetStats();
  const summaryBefore = getStatsSummary();
  assert.equal(summaryBefore.totalRequests, 0);

  recordRequest({
    method: 'POST',
    path: '/v1/images/generations',
    model: 'gemini-3.1-flash-image',
    status: 200,
    durationMs: 350,
    clientIp: '1.2.3.4',
    apiKey: 'AIzaSyTestMockKeyForVerification789xyz',
  });

  recordRequest({
    method: 'POST',
    path: '/v1/images/generations',
    model: 'gemini-3.1-flash-image',
    status: 429,
    durationMs: 120,
    clientIp: '1.2.3.4',
    apiKey: 'AIzaSyTestMockKeyForVerification789xyz',
    error: 'quota_exceeded',
  });

  const summary = getStatsSummary();
  assert.equal(summary.totalRequests, 2);
  assert.equal(summary.successRequests, 1);
  assert.equal(summary.failedRequests, 1);
  assert.equal(summary.successRate, '50.0%');
  assert.equal(summary.averageLatencyMs, 235);
  assert.equal(summary.statusCodes['200'], 1);
  assert.equal(summary.statusCodes['429'], 1);
  assert.equal(summary.models['gemini-3.1-flash-image'], 2);
  assert.equal(summary.recentLogs.length, 2);
  assert.equal(summary.recentLogs[0].apiKey, 'AIzaSy...9xyz');
  assert.equal(summary.recentLogs[0].clientIp, '1.2.3.***');
});

test('verifyStatsAuth allows access when STATS_SECRET is unset', () => {
  delete process.env.STATS_SECRET;
  delete process.env.ADMIN_TOKEN;
  const req = { url: '/stats', headers: {} };
  assert.equal(verifyStatsAuth(req), true);
});

test('verifyStatsAuth enforces secret when STATS_SECRET is set', () => {
  process.env.STATS_SECRET = 'my-secret-123';
  try {
    assert.equal(verifyStatsAuth({ url: '/stats', headers: {} }), false);
    assert.equal(verifyStatsAuth({ url: '/stats?token=wrong', headers: {} }), false);
    assert.equal(verifyStatsAuth({ url: '/stats?token=my-secret-123', headers: {} }), true);
    assert.equal(verifyStatsAuth({ url: '/stats', headers: { 'x-admin-token': 'my-secret-123' } }), true);
    assert.equal(verifyStatsAuth({ url: '/stats', headers: { authorization: 'Bearer my-secret-123' } }), true);
  } finally {
    delete process.env.STATS_SECRET;
  }
});
