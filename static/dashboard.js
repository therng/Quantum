const apiBaseInput = document.getElementById('apiBase');
const apiKeyInput = document.getElementById('apiKey');

const state = {
  base: localStorage.getItem('api_base') || window.location.origin,
  key: localStorage.getItem('api_key') || '',
};

apiBaseInput.value = state.base;
apiKeyInput.value = state.key;

apiBaseInput.addEventListener('change', () => {
  state.base = apiBaseInput.value.trim().replace(/\/$/, '');
  localStorage.setItem('api_base', state.base);
  boot();
});

apiKeyInput.addEventListener('change', () => {
  state.key = apiKeyInput.value.trim();
  localStorage.setItem('api_key', state.key);
  boot();
});

function metric(label, value, cls = '') {
  return `<div class="metric"><div class="label">${label}</div><div class="value ${cls}">${value}</div></div>`;
}

function usd(v) {
  if (v === null || v === undefined) return '-';
  return `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function pct(v) {
  if (v === null || v === undefined) return '-';
  return `${Number(v).toFixed(2)}%`;
}

async function api(path) {
  const res = await fetch(`${state.base}${path}`, {
    headers: state.key ? { 'X-API-Key': state.key } : {},
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return res.json();
}

function drawChart(points) {
  const canvas = document.getElementById('growthChart');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!points.length) return;

  const vals = points.map((p) => p.growth_pct ?? 0);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = Math.max(1, max - min);

  ctx.strokeStyle = '#00d1ff';
  ctx.lineWidth = 2;
  ctx.beginPath();

  points.forEach((point, i) => {
    const x = (i / Math.max(1, points.length - 1)) * (canvas.width - 24) + 12;
    const y = canvas.height - ((point.growth_pct ?? 0) - min) / span * (canvas.height - 24) - 12;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.stroke();
}

function renderProfiles(overview, dashboard) {
  const root = document.getElementById('profiles');
  const pnl = dashboard?.day?.profit_total ?? overview.day_profit_total;
  const drawdown = dashboard?.day?.maximum_drawdown_pct;
  const depositLoad = dashboard?.day?.max_deposit_load ?? overview.deposit_load;
  const activity = dashboard?.day?.trading_activity;

  root.innerHTML = `
    <div class="profile">
      <div class="profile-head"><strong>${overview.terminal_id}</strong><span class="label">${overview.server}</span></div>
      <div class="grid-2">
        ${metric('PnL', usd(pnl), pnl >= 0 ? 'profit' : 'loss')}
        ${metric('Drawdown', pct(drawdown), 'loss')}
        ${metric('Deposit Load', pct(depositLoad), 'loss')}
        ${metric('Activity', pct(activity), 'profit')}
      </div>
      <div class="label" style="margin:8px 0 5px">Spiderweb scores (proxy)</div>
      <div class="bars">
        <div class="bar"><span style="width:${Math.min(100, Math.max(0, (activity ?? 0)))}%"></span></div>
        <div class="bar red"><span style="width:${Math.min(100, Math.max(0, (depositLoad ?? 0)))}%"></span></div>
      </div>
    </div>`;
}

function renderCharts(dashboard) {
  const month = dashboard?.month || {};
  const week = dashboard?.week || {};
  const day = dashboard?.day || {};
  const bars = document.getElementById('chartBars');
  const items = [
    ['Monthly PnL', month.profit_total, 1000],
    ['Weekly PnL', week.profit_total, 500],
    ['Daily PnL', day.profit_total, 200],
    ['Drawdown', day.maximum_drawdown_pct, 100],
  ];

  bars.innerHTML = items.map(([label, val, scale]) => {
    const width = Math.min(100, Math.abs((val || 0) / scale * 100));
    const red = label === 'Drawdown' || (val || 0) < 0;
    return `<div><div class="label">${label}: ${val ? Number(val).toFixed(2) : 0}</div><div class="bar ${red ? 'red' : ''}"><span style="width:${width}%"></span></div></div>`;
  }).join('');
}

function renderReports(history) {
  const root = document.getElementById('reports');
  root.innerHTML = history.slice(-18).reverse().map((item, idx) => {
    const p = item.payload;
    const pl = p.floating_pl ?? p.day_profit_total ?? 0;
    return `<div class="trade"><div>#${idx + 1} ${new Date((p.ts || item.received_at) * 1000).toLocaleDateString()}</div><div>${p.positions_total ?? 0} pos</div><div class="pl ${pl >= 0 ? 'profit' : 'loss'}">${usd(pl)}</div></div>`;
  }).join('');
}

async function boot() {
  try {
    const list = await api('/mt5/heartbeat/overview');
    const overview = list[0];
    if (!overview) return;

    const dashboard = await api(`/mt5/heartbeat/dashboard/${overview.terminal_id}`);
    const growth = await api(`/mt5/heartbeat/growth/${overview.terminal_id}?period=month&value_source=equity&trade_window=day&limit=120`);
    const history = await api(`/mt5/heartbeat/history/${overview.terminal_id}?period=month&limit=80`);

    document.getElementById('algoStatus').className = overview.algo_active ? 'pill active' : 'pill';
    document.getElementById('algoStatus').textContent = overview.algo_active ? 'Algo active' : 'Algo inactive';

    document.getElementById('overviewMetrics').innerHTML = [
      metric('Balance', usd(overview.balance)),
      metric('Equity', usd(overview.equity)),
      metric('Month Trades', overview.month_trades ?? 0),
      metric('Month PnL', usd(overview.month_profit_total), (overview.month_profit_total ?? 0) >= 0 ? 'profit' : 'loss'),
    ].join('');

    drawChart(growth.points || []);
    renderProfiles(overview, dashboard);
    renderCharts(dashboard);
    renderReports(history.items || []);
  } catch (err) {
    document.getElementById('reports').innerHTML = `<div class="label">Failed to load data: ${err.message}</div>`;
  }
}

boot();
