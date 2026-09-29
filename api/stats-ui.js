export function renderStatsHtml(stats, baseUrl = 'https://llm.hidear.app') {
  const {
    uptimeSeconds = 0,
    totalRequests = 0,
    successRequests = 0,
    failedRequests = 0,
    successRate = '100.0%',
    averageLatencyMs = 0,
    statusCodes = {},
    models = {},
    recentLogs = [],
  } = stats;

  const hours = Math.floor(uptimeSeconds / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const seconds = uptimeSeconds % 60;
  const uptimeFormatted = `${hours}h ${minutes}m ${seconds}s`;

  const statusBadges = Object.entries(statusCodes).map(([code, count]) => {
    const isOk = code.startsWith('2');
    const isWarn = code.startsWith('4');
    const color = isOk ? '#10b981' : isWarn ? '#f59e0b' : '#ef4444';
    return `<span style="background: ${color}20; color: ${color}; padding: 4px 8px; border-radius: 6px; font-weight: 600; font-size: 13px; margin-right: 6px; margin-bottom: 6px; display: inline-block;">
      ${code}: ${count}
    </span>`;
  }).join('') || '<span style="color: #6b7280; font-size: 13px;">No requests recorded</span>';

  const modelBadges = Object.entries(models).map(([model, count]) => {
    return `<div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #1f2937; font-size: 13px;">
      <span style="color: #e5e7eb; font-family: monospace;">${model}</span>
      <span style="color: #60a5fa; font-weight: 600;">${count}</span>
    </div>`;
  }).join('') || '<div style="color: #6b7280; font-size: 13px;">No model calls yet</div>';

  const logRows = recentLogs.map((log) => {
    const isOk = log.status >= 200 && log.status < 400;
    const statusColor = isOk ? '#10b981' : log.status === 429 ? '#f59e0b' : '#ef4444';
    const timeStr = log.time ? log.time.split('T')[1].replace('Z', '') : '';
    return `<tr>
      <td style="padding: 10px; border-bottom: 1px solid #1f2937; color: #9ca3af; font-family: monospace; font-size: 12px;">${timeStr}</td>
      <td style="padding: 10px; border-bottom: 1px solid #1f2937; font-weight: 600; font-size: 12px; color: ${log.method === 'POST' ? '#3b82f6' : '#10b981'};">${log.method}</td>
      <td style="padding: 10px; border-bottom: 1px solid #1f2937; font-family: monospace; font-size: 12px; color: #d1d5db; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${log.path}</td>
      <td style="padding: 10px; border-bottom: 1px solid #1f2937; font-family: monospace; font-size: 12px; color: #93c5fd;">${log.model}</td>
      <td style="padding: 10px; border-bottom: 1px solid #1f2937;"><span style="background: ${statusColor}20; color: ${statusColor}; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 12px;">${log.status}</span></td>
      <td style="padding: 10px; border-bottom: 1px solid #1f2937; color: #9ca3af; font-size: 12px;">${log.durationMs}ms</td>
      <td style="padding: 10px; border-bottom: 1px solid #1f2937; color: #6b7280; font-family: monospace; font-size: 11px;">${log.clientIp}</td>
      <td style="padding: 10px; border-bottom: 1px solid #1f2937; color: #6b7280; font-family: monospace; font-size: 11px;">${log.apiKey}</td>
    </tr>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Dayan Gemini Proxy - Live Monitor</title>
    <link rel="icon" href="https://ai.google.dev/static/site-assets/images/favicon-new.png" />
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 24px;
        background-color: #0b0f19;
        color: #f3f4f6;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }
      .container { max-width: 1200px; margin: 0 auto; }
      .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; flex-wrap: wrap; gap: 12px; }
      .title { font-size: 24px; font-weight: 700; margin: 0; color: #ffffff; display: flex; align-items: center; gap: 10px; }
      .pulse { width: 10px; height: 10px; border-radius: 50%; background: #10b981; box-shadow: 0 0 10px #10b981; display: inline-block; }
      .nav-links a { color: #60a5fa; text-decoration: none; font-size: 14px; margin-left: 16px; font-weight: 500; }
      .nav-links a:hover { text-decoration: underline; }
      .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px; }
      .card { background: #111827; border: 1px solid #1f2937; border-radius: 12px; padding: 20px; }
      .card-title { color: #9ca3af; font-size: 13px; text-transform: uppercase; font-weight: 600; margin-bottom: 8px; letter-spacing: 0.5px; }
      .card-value { font-size: 28px; font-weight: 700; color: #ffffff; }
      .section-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
      @media (max-width: 768px) { .section-grid { grid-template-columns: 1fr; } }
      .table-card { background: #111827; border: 1px solid #1f2937; border-radius: 12px; padding: 20px; overflow-x: auto; }
      table { width: 100%; border-collapse: collapse; text-align: left; }
      th { padding: 10px; border-bottom: 2px solid #374151; color: #9ca3af; font-size: 12px; font-weight: 600; text-transform: uppercase; }
      .refresh-btn { background: #2563eb; color: #fff; border: none; padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; transition: 0.2s; }
      .refresh-btn:hover { background: #1d4ed8; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1 class="title">
          <span class="pulse"></span>
          Dayan Gemini Proxy Monitor
        </h1>
        <div class="nav-links">
          <button class="refresh-btn" onclick="location.reload()">Refresh Now</button>
          <a href="/docs">API Docs</a>
          <a href="/openapi.json">OpenAPI Spec</a>
          <a href="/stats?format=json">JSON View</a>
        </div>
      </div>

      <div class="cards">
        <div class="card">
          <div class="card-title">Instance Uptime</div>
          <div class="card-value">${uptimeFormatted}</div>
        </div>
        <div class="card">
          <div class="card-title">Total Requests</div>
          <div class="card-value">${totalRequests.toLocaleString()}</div>
        </div>
        <div class="card">
          <div class="card-title">Success Rate</div>
          <div class="card-value" style="color: #10b981;">${successRate}</div>
        </div>
        <div class="card">
          <div class="card-title">Average Latency</div>
          <div class="card-value">${averageLatencyMs} <span style="font-size: 16px; color: #9ca3af;">ms</span></div>
        </div>
      </div>

      <div class="section-grid">
        <div class="card">
          <div class="card-title">Status Code Distribution</div>
          <div style="margin-top: 12px;">${statusBadges}</div>
        </div>
        <div class="card">
          <div class="card-title">Model Usage Distribution</div>
          <div style="margin-top: 8px;">${modelBadges}</div>
        </div>
      </div>

      <div class="table-card">
        <div class="card-title" style="margin-bottom: 16px;">Recent Request Logs (Last ${recentLogs.length})</div>
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Method</th>
              <th>Path</th>
              <th>Model</th>
              <th>Status</th>
              <th>Latency</th>
              <th>Client IP</th>
              <th>API Key</th>
            </tr>
          </thead>
          <tbody>
            ${logRows || '<tr><td colspan="8" style="padding: 24px; text-align: center; color: #6b7280;">No requests recorded yet.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
    <script>
      // Auto-refresh every 10 seconds if page is visible
      setInterval(() => {
        if (!document.hidden) {
          location.reload();
        }
      }, 10000);
    </script>
  </body>
</html>`;
}
