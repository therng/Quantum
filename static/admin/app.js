const storageKeys = {
  baseUrl: 'admin.baseUrl',
  apiKey: 'admin.apiKey'
};

const baseUrlInput = document.getElementById('baseUrlInput');
const apiKeyInput = document.getElementById('apiKeyInput');
const refreshButton = document.getElementById('refreshButton');

const algoStatusGrid = document.getElementById('algoStatusGrid');
const profileList = document.getElementById('profileList');
const monthlyPnlBars = document.getElementById('monthlyPnlBars');
const drawdownBars = document.getElementById('drawdownBars');
const reportsList = document.getElementById('reportsList');
const growthChart = document.getElementById('growthChart');

baseUrlInput.value = localStorage.getItem(storageKeys.baseUrl) || window.location.origin;
apiKeyInput.value = localStorage.getItem(storageKeys.apiKey) || '';

function headers() {
  return {
    Accept: 'application/json',
    'X-API-Key': apiKeyInput.value.trim()
  };
}

async function apiGet(path) {
  const response = await fetch(`${baseUrlInput.value.replace(/\/$/, '')}${path}`, { headers: headers() });
  if (!response.ok) {
    throw new Error(`${path} -> ${response.status}`);
  }
  return response.json();
}

function pct(v) {
  return v == null ? 'n/a' : `${Number(v).toFixed(2)}%`;
}

function money(v) {
  return v == null ? 'n/a' : `${v >= 0 ? '+' : ''}${Number(v).toFixed(2)}`;
}

function linePath(points, width, height, pad) {
  if (!points.length) return '';
  const vals = points.map((p) => p.growth_pct ?? 0);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = Math.max(1, max - min);
  return points.map((point, i) => {
    const x = pad + (i * (width - pad * 2)) / Math.max(1, points.length - 1);
    const y = height - pad - (((point.growth_pct ?? 0) - min) / span) * (height - pad * 2);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function drawGrowthChart(points) {
  const w = 320;
  const h = 140;
  const path = linePath(points, w, h, 14);
  growthChart.innerHTML = `
    <line x1="12" y1="125" x2="308" y2="125" stroke="#274062" stroke-width="1" />
    <line x1="14" y1="12" x2="14" y2="126" stroke="#274062" stroke-width="1" />
    <path d="${path}" fill="none" stroke="#2cff7a" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" />
  `;
}

function renderRadar(spiderScores) {
  const labels = ['PnL', 'Win', 'Activity', 'Risk', 'Load'];
  const center = 46;
  const radius = 36;

  const polygonPoints = spiderScores.map((score, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / labels.length;
    const r = (radius * Math.max(0, Math.min(100, score))) / 100;
    const x = center + r * Math.cos(angle);
    const y = center + r * Math.sin(angle);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const spokes = labels.map((_, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / labels.length;
    const x = center + radius * Math.cos(angle);
    const y = center + radius * Math.sin(angle);
    return `<line x1="${center}" y1="${center}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#2a3a52"/>`;
  }).join('');

  return `<svg class="radar" viewBox="0 0 92 92">${spokes}<polygon points="${polygonPoints}" fill="rgba(44,255,122,0.25)" stroke="#2cff7a" stroke-width="1.2"/></svg>`;
}

function renderMiniSeries(series) {
  const safe = series.slice(-18);
  const data = safe.map((v, i) => ({ growth_pct: v, i }));
  const path = linePath(data, 300, 52, 4);
  return `<svg class="mini-series" viewBox="0 0 300 52"><path d="${path}" fill="none" stroke="#2aa5ff" stroke-width="2"/></svg>`;
}

function randomTradeRows(overviewItem, monthProfit) {
  return Array.from({ length: 6 }).map((_, index) => {
    const pnl = (monthProfit || 0) / 10 + (Math.random() - 0.5) * 60;
    return {
      terminalId: overviewItem.terminal_id,
      side: index % 2 === 0 ? 'BUY' : 'SELL',
      lots: (Math.random() * 1.8 + 0.1).toFixed(2),
      pnl
    };
  });
}

async function render() {
  localStorage.setItem(storageKeys.baseUrl, baseUrlInput.value.trim());
  localStorage.setItem(storageKeys.apiKey, apiKeyInput.value.trim());

  algoStatusGrid.innerHTML = 'Loading...';
  profileList.innerHTML = '';
  monthlyPnlBars.innerHTML = '';
  drawdownBars.innerHTML = '';
  reportsList.innerHTML = '';

  try {
    const overview = await apiGet('/mt5/heartbeat/overview');
    if (!overview.length) {
      algoStatusGrid.innerHTML = 'No clients found yet.';
      return;
    }

    const growthBundle = await Promise.all(
      overview.map((item) => apiGet(`/mt5/heartbeat/growth/${encodeURIComponent(item.terminal_id)}?period=month&value_source=equity&trade_window=month&limit=120`))
    );

    const summaryBundle = await Promise.all(
      overview.map((item) => apiGet(`/mt5/heartbeat/summary/${encodeURIComponent(item.terminal_id)}/month`))
    );

    algoStatusGrid.innerHTML = overview.map((item) => `
      <article class="card">
        <h4>${item.terminal_id}</h4>
        <div class="metric-row"><span>Algo</span><span class="algo-pill ${item.algo_active ? 'algo-on' : 'algo-off'}">${item.algo_active ? 'ACTIVE' : 'PAUSED'}</span></div>
        <div class="metric-row"><span>Growth MTD</span><b>${pct(growthBundle.find((g) => g.terminal_id === item.terminal_id)?.latest_growth_pct)}</b></div>
      </article>`).join('');

    const allGrowthPoints = growthBundle.flatMap((g) => g.points.slice(-24));
    drawGrowthChart(allGrowthPoints.length ? allGrowthPoints : [{ growth_pct: 0 }]);

    profileList.innerHTML = overview.map((item) => {
      const monthly = summaryBundle[overview.findIndex((entry) => entry.terminal_id === item.terminal_id)] || null;
      const pnlSeries = growthBundle.find((g) => g.terminal_id === item.terminal_id)?.points.map((p) => p.growth_pct ?? 0) || [0];
      const spiderScores = [
        Math.min(100, Math.max(0, (item.month_profit_total || 0) / 20 + 50)),
        monthly?.profit_trade_rate || 50,
        monthly?.trading_activity || 45,
        100 - Math.min(100, monthly?.maximum_drawdown_pct || 0),
        100 - Math.min(100, monthly?.max_deposit_load || 0)
      ];

      return `<article class="card">
        <h4>${item.terminal_id} Profile</h4>
        ${renderRadar(spiderScores)}
        <div class="metric-row"><span>PnL</span><b class="${(item.month_profit_total || 0) >= 0 ? 'pnl-pos' : 'pnl-neg'}">${money(item.month_profit_total)}</b></div>
        <div class="metric-row"><span>Drawdown</span><b>${pct(monthly?.maximum_drawdown_pct)}</b></div>
        <div class="metric-row"><span>Deposit Load</span><b>${pct(monthly?.max_deposit_load)}</b></div>
        <div class="metric-row"><span>Algo Activity</span><b>${pct(monthly?.algo_trading_pct)}</b></div>
        ${renderMiniSeries(pnlSeries)}
      </article>`;
    }).join('');

    monthlyPnlBars.innerHTML = overview.map((item) => {
      const value = Number(item.month_profit_total || 0);
      const height = Math.min(120, Math.abs(value) / 5 + 8);
      const positive = value >= 0;
      return `<div class="bar ${positive ? 'pnl-pos' : 'pnl-neg'}" style="height:${height}px;background:${positive ? 'rgba(44,255,122,0.28)' : 'rgba(255,65,104,0.28)'}">${value.toFixed(0)}</div>`;
    }).join('');

    drawdownBars.innerHTML = summaryBundle.map((summary, idx) => {
      const item = overview[idx];
      const dd = Math.max(0, Math.min(100, summary.maximum_drawdown_pct || 0));
      return `<div class="progress-item">${item.terminal_id} ${dd.toFixed(2)}%
        <div class="progress-track"><div class="progress-fill" style="width:${dd}%"></div></div>
      </div>`;
    }).join('');

    const reports = overview.flatMap((item) => randomTradeRows(item, item.month_profit_total));
    reportsList.innerHTML = reports.map((row) => `
      <article class="report-item">
        <div><b>${row.terminalId}</b> ${row.side} ${row.lots} lots</div>
        <div class="${row.pnl >= 0 ? 'pnl-pos' : 'pnl-neg'}">${money(row.pnl)}</div>
      </article>
    `).join('');
  } catch (error) {
    algoStatusGrid.innerHTML = `<span class="pnl-neg">Failed to load: ${error.message}</span>`;
  }
}

refreshButton.addEventListener('click', render);
baseUrlInput.addEventListener('change', render);
apiKeyInput.addEventListener('change', render);

render();
