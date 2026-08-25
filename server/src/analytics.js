import crypto from "node:crypto";

const COUNTRY_NAMES = {
  US: "United States",
  GB: "United Kingdom",
  DE: "Germany",
  FR: "France",
  JP: "Japan",
  SG: "Singapore",
  CA: "Canada",
  BR: "Brazil",
  IN: "India",
  AU: "Australia",
  NL: "Netherlands",
  LOCAL: "Localhost / Internal",
  UNKNOWN: "Unknown",
};

export function getCountryName(code) {
  return COUNTRY_NAMES[code] || code;
}

export function detectCountry(req) {
  const headerCountry =
    req.headers["cf-ipcountry"] ||
    req.headers["x-country"] ||
    req.headers["x-geo-country"];
  if (headerCountry && headerCountry !== "XX") {
    return headerCountry.toUpperCase();
  }
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "";
  if (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    ip.startsWith("172.16.")
  ) {
    return "LOCAL";
  }
  return "US";
}

export class AnalyticsService {
  constructor(options = {}) {
    this.maxLogs = options.maxLogs ?? 1000;
    this.logs = [];
    this.endpoints = new Map();
    this.consumers = new Map();
    this.geography = new Map();
    this.timeSeries = [];
    this.startTime = Date.now();
  }

  recordRequest({
    method,
    path,
    statusCode,
    durationMs,
    consumer,
    country,
    timestamp = new Date(),
  }) {
    const isError = statusCode >= 400;
    const endpointKey = `${method} ${this.normalizePath(path)}`;
    const consumerKey = this.maskConsumer(consumer);
    const countryKey = (country || "UNKNOWN").toUpperCase();

    // 1. Update endpoint stats
    if (!this.endpoints.has(endpointKey)) {
      this.endpoints.set(endpointKey, {
        endpoint: endpointKey,
        count: 0,
        totalDurationMs: 0,
        minDurationMs: Infinity,
        maxDurationMs: 0,
        errorCount: 0,
        statusCodes: {},
      });
    }
    const ep = this.endpoints.get(endpointKey);
    ep.count += 1;
    ep.totalDurationMs += durationMs;
    ep.minDurationMs = Math.min(ep.minDurationMs, durationMs);
    ep.maxDurationMs = Math.max(ep.maxDurationMs, durationMs);
    if (isError) ep.errorCount += 1;
    ep.statusCodes[statusCode] = (ep.statusCodes[statusCode] || 0) + 1;

    // 2. Update consumer stats
    if (!this.consumers.has(consumerKey)) {
      this.consumers.set(consumerKey, {
        consumer: consumerKey,
        count: 0,
        errorCount: 0,
        endpoints: {},
      });
    }
    const c = this.consumers.get(consumerKey);
    c.count += 1;
    if (isError) c.errorCount += 1;
    c.endpoints[endpointKey] = (c.endpoints[endpointKey] || 0) + 1;

    // 3. Update geography
    this.geography.set(countryKey, (this.geography.get(countryKey) || 0) + 1);

    // 4. Update time series (1-minute buckets)
    const minuteBucket = new Date(timestamp);
    minuteBucket.setSeconds(0, 0);
    const minuteIso = minuteBucket.toISOString();
    let bucket = this.timeSeries.find((b) => b.minuteBucket === minuteIso);
    if (!bucket) {
      bucket = {
        minuteBucket: minuteIso,
        timestamp: minuteIso,
        requests: 0,
        errors: 0,
        totalDurationMs: 0,
        avgDurationMs: 0,
      };
      this.timeSeries.push(bucket);
      if (this.timeSeries.length > 120) this.timeSeries.shift();
    }
    bucket.requests += 1;
    if (isError) bucket.errors += 1;
    bucket.totalDurationMs += durationMs;
    bucket.avgDurationMs =
      Math.round((bucket.totalDurationMs / bucket.requests) * 100) / 100;

    // 5. Append recent log
    this.logs.push({
      id: crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).substring(2),
      timestamp: timestamp.toISOString(),
      method,
      path,
      endpoint: endpointKey,
      statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      consumer: consumerKey,
      country: countryKey,
    });
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
  }

  normalizePath(pathname) {
    if (pathname.startsWith("/credentials/") && pathname.endsWith("/verify")) {
      return "/credentials/:id/verify";
    }
    if (
      pathname.startsWith("/credentials/") &&
      pathname.split("/").length === 3
    ) {
      return "/credentials/:id";
    }
    if (pathname.startsWith("/1.0/identifiers/")) {
      return "/1.0/identifiers/:did";
    }
    return pathname;
  }

  maskConsumer(raw) {
    if (!raw) return "anonymous";
    const key = String(raw).trim();
    if (key.length <= 8) return `***${key.slice(-4)}`;
    return `${key.slice(0, 4)}...${key.slice(-4)}`;
  }

  getSummary() {
    let totalRequests = 0;
    let totalErrors = 0;
    let totalDurationMs = 0;

    const endpointsList = Array.from(this.endpoints.values())
      .map((ep) => {
        totalRequests += ep.count;
        totalErrors += ep.errorCount;
        totalDurationMs += ep.totalDurationMs;
        return {
          endpoint: ep.endpoint,
          count: ep.count,
          errorCount: ep.errorCount,
          errorRate:
            ep.count > 0
              ? Math.round((ep.errorCount / ep.count) * 10000) / 10000
              : 0,
          avgDurationMs:
            ep.count > 0
              ? Math.round((ep.totalDurationMs / ep.count) * 100) / 100
              : 0,
          minDurationMs:
            ep.minDurationMs === Infinity
              ? 0
              : Math.round(ep.minDurationMs * 100) / 100,
          maxDurationMs: Math.round(ep.maxDurationMs * 100) / 100,
          statusCodes: ep.statusCodes,
        };
      })
      .sort((a, b) => b.count - a.count);

    const topConsumers = Array.from(this.consumers.values())
      .map((c) => ({
        consumer: c.consumer,
        count: c.count,
        errorCount: c.errorCount,
        errorRate:
          c.count > 0
            ? Math.round((c.errorCount / c.count) * 10000) / 10000
            : 0,
        endpoints: c.endpoints,
      }))
      .sort((a, b) => b.count - a.count);

    const geographicDistribution = Array.from(this.geography.entries())
      .map(([country, count]) => ({
        country,
        countryName: getCountryName(country),
        count,
        percentage:
          totalRequests > 0
            ? Math.round((count / totalRequests) * 10000) / 100
            : 0,
      }))
      .sort((a, b) => b.count - a.count);

    return {
      overview: {
        totalRequests,
        totalErrors,
        errorRate:
          totalRequests > 0
            ? Math.round((totalErrors / totalRequests) * 10000) / 10000
            : 0,
        avgResponseTimeMs:
          totalRequests > 0
            ? Math.round((totalDurationMs / totalRequests) * 100) / 100
            : 0,
        uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      },
      endpoints: endpointsList,
      topConsumers,
      geographicDistribution,
      timeSeries: this.timeSeries,
    };
  }

  exportCsv() {
    const header =
      "timestamp,method,endpoint,path,statusCode,durationMs,consumer,country\n";
    const rows = this.logs
      .map(
        (log) =>
          `"${log.timestamp}","${log.method}","${log.endpoint}","${log.path}",${log.statusCode},${log.durationMs},"${log.consumer}","${log.country}"`,
      )
      .join("\n");
    return header + rows;
  }

  exportJson() {
    return {
      summary: this.getSummary(),
      recentLogs: this.logs,
    };
  }

  renderDashboardHtml() {
    const summary = this.getSummary();
    const summaryJson = JSON.stringify(summary);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Soroban Identity - API Analytics & Usage Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #38bdf8;
      --primary-hover: #0284c7;
      --success: #4ade80;
      --warning: #fbbf24;
      --danger: #f87171;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: var(--bg); color: var(--text); padding: 24px; min-height: 100vh; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
    .header h1 { font-size: 24px; font-weight: 700; color: var(--primary); }
    .header .actions { display: flex; gap: 12px; }
    .btn { background: var(--card-bg); color: var(--text); border: 1px solid var(--border); padding: 8px 16px; border-radius: 6px; cursor: pointer; text-decoration: none; font-size: 14px; font-weight: 500; display: inline-flex; align-items: center; gap: 6px; }
    .btn:hover { background: var(--border); }
    .btn-primary { background: var(--primary); color: #0f172a; border-color: var(--primary); font-weight: 600; }
    .btn-primary:hover { background: var(--primary-hover); }
    .grid-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; padding: 20px; }
    .card-title { font-size: 13px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; margin-bottom: 8px; }
    .card-value { font-size: 28px; font-weight: 700; color: var(--text); }
    .grid-charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(450px, 1fr)); gap: 20px; margin-bottom: 24px; }
    .chart-card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; padding: 20px; min-height: 320px; }
    .chart-card h3 { font-size: 16px; margin-bottom: 16px; color: var(--text); display: flex; justify-content: space-between; }
    .table-container { overflow-x: auto; margin-top: 12px; }
    table { width: 100%; border-collapse: collapse; text-align: left; font-size: 14px; }
    th { padding: 10px 12px; color: var(--text-muted); font-weight: 600; border-bottom: 1px solid var(--border); }
    td { padding: 12px; border-bottom: 1px solid var(--border); }
    tr:hover { background: rgba(255, 255, 255, 0.02); }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
    .badge-success { background: rgba(74, 222, 128, 0.15); color: var(--success); }
    .badge-danger { background: rgba(248, 113, 113, 0.15); color: var(--danger); }
    .progress-bar { background: var(--border); border-radius: 4px; height: 8px; width: 100%; overflow: hidden; margin-top: 6px; }
    .progress-fill { background: var(--primary); height: 100%; }
    .refresh-indicator { font-size: 12px; color: var(--text-muted); display: flex; align-items: center; gap: 6px; }
    .pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--success); box-shadow: 0 0 8px var(--success); }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>API Analytics & Usage Dashboard</h1>
      <p style="color: var(--text-muted); font-size: 14px; margin-top: 4px;">Soroban Identity API Server Monitoring</p>
    </div>
    <div class="actions">
      <span class="refresh-indicator"><span class="pulse"></span> Live Monitoring</span>
      <a href="/admin/analytics/export?format=csv" class="btn" download="analytics.csv">Export CSV</a>
      <a href="/admin/analytics/export?format=json" class="btn" download="analytics.json">Export JSON</a>
      <button class="btn btn-primary" onclick="location.reload()">Refresh</button>
    </div>
  </div>

  <div class="grid-cards">
    <div class="card">
      <div class="card-title">Total Requests</div>
      <div class="card-value" id="val-requests">${summary.overview.totalRequests.toLocaleString()}</div>
    </div>
    <div class="card">
      <div class="card-title">Avg Response Time</div>
      <div class="card-value" id="val-latency">${summary.overview.avgResponseTimeMs} ms</div>
    </div>
    <div class="card">
      <div class="card-title">Error Rate</div>
      <div class="card-value" id="val-errors" style="color: ${summary.overview.errorRate > 0.05 ? "var(--danger)" : "var(--success)"}">
        ${(summary.overview.errorRate * 100).toFixed(2)}%
      </div>
    </div>
    <div class="card">
      <div class="card-title">Uptime</div>
      <div class="card-value" id="val-uptime">${Math.floor(summary.overview.uptimeSeconds / 60)} min</div>
    </div>
  </div>

  <div class="grid-charts">
    <div class="chart-card">
      <h3>Real-Time Requests & Errors</h3>
      <canvas id="timeSeriesChart"></canvas>
    </div>
    <div class="chart-card">
      <h3>Geographic Distribution</h3>
      <canvas id="geoChart"></canvas>
    </div>
  </div>

  <div class="grid-charts">
    <div class="chart-card">
      <h3>Popular Endpoints</h3>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Endpoint</th>
              <th>Requests</th>
              <th>Avg Latency</th>
              <th>Max Latency</th>
              <th>Error Rate</th>
            </tr>
          </thead>
          <tbody>
            ${
              summary.endpoints.length === 0
                ? '<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No requests recorded yet</td></tr>'
                : summary.endpoints
                    .map(
                      (ep) => `
              <tr>
                <td><code>${ep.endpoint}</code></td>
                <td>${ep.count.toLocaleString()}</td>
                <td>${ep.avgDurationMs} ms</td>
                <td>${ep.maxDurationMs} ms</td>
                <td><span class="badge ${ep.errorCount > 0 ? "badge-danger" : "badge-success"}">${(ep.errorRate * 100).toFixed(1)}%</span></td>
              </tr>
            `,
                    )
                    .join("")
            }
          </tbody>
        </table>
      </div>
    </div>

    <div class="chart-card">
      <h3>Top Consumers by API Key</h3>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Consumer</th>
              <th>Requests</th>
              <th>Errors</th>
              <th>Error Rate</th>
            </tr>
          </thead>
          <tbody>
            ${
              summary.topConsumers.length === 0
                ? '<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No consumer data yet</td></tr>'
                : summary.topConsumers
                    .map(
                      (c) => `
              <tr>
                <td><code>${c.consumer}</code></td>
                <td>${c.count.toLocaleString()}</td>
                <td>${c.errorCount}</td>
                <td><span class="badge ${c.errorCount > 0 ? "badge-danger" : "badge-success"}">${(c.errorRate * 100).toFixed(1)}%</span></td>
              </tr>
            `,
                    )
                    .join("")
            }
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <script>
    const data = ${summaryJson};

    // Time Series Chart
    const tsLabels = data.timeSeries.map(t => new Date(t.timestamp).toLocaleTimeString());
    const tsRequests = data.timeSeries.map(t => t.requests);
    const tsErrors = data.timeSeries.map(t => t.errors);

    new Chart(document.getElementById('timeSeriesChart'), {
      type: 'line',
      data: {
        labels: tsLabels.length > 0 ? tsLabels : ['Now'],
        datasets: [
          {
            label: 'Requests',
            data: tsRequests.length > 0 ? tsRequests : [data.overview.totalRequests],
            borderColor: '#38bdf8',
            backgroundColor: 'rgba(56, 189, 248, 0.1)',
            fill: true,
            tension: 0.3
          },
          {
            label: 'Errors',
            data: tsErrors.length > 0 ? tsErrors : [data.overview.totalErrors],
            borderColor: '#f87171',
            backgroundColor: 'rgba(248, 113, 113, 0.1)',
            fill: true,
            tension: 0.3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#94a3b8' } } },
        scales: {
          x: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' } },
          y: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' }, beginAtZero: true }
        }
      }
    });

    // Geo Chart
    const geoLabels = data.geographicDistribution.map(g => g.countryName || g.country);
    const geoCounts = data.geographicDistribution.map(g => g.count);

    new Chart(document.getElementById('geoChart'), {
      type: 'doughnut',
      data: {
        labels: geoLabels.length > 0 ? geoLabels : ['No Data'],
        datasets: [{
          data: geoCounts.length > 0 ? geoCounts : [1],
          backgroundColor: ['#38bdf8', '#818cf8', '#c084fc', '#f472b6', '#34d399', '#fbbf24', '#94a3b8']
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'right', labels: { color: '#94a3b8' } } }
      }
    });
  </script>
</body>
</html>`;
  }
}
