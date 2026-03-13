// api/report.js — Generate PDF Weekly Report
// Called by: journal.html "Export PDF" button OR weekly.js cron
// Returns: PDF file or sends to TG as document

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { userId, period, sendTg } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    // 1. Fetch trades
    const now = new Date();
    const periodDays = period === 'month' ? 30 : 7;
    const since = new Date(now);
    since.setDate(since.getDate() - periodDays);

    const trResp = await fetch(
      `${SB_URL}/rest/v1/trades?user_id=eq.${userId}&created_at=gte.${since.toISOString()}&order=created_at.desc&select=*`,
      { headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Accept': 'application/json' } }
    );
    const trades = await trResp.json();
    if (!Array.isArray(trades)) return res.status(500).json({ error: 'Failed to fetch trades' });

    // 2. Fetch profile
    const prResp = await fetch(
      `${SB_URL}/rest/v1/profiles?id=eq.${userId}&select=full_name,username,tg_chat_id`,
      { headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Accept': 'application/json' } }
    );
    const profiles = await prResp.json();
    const profile = Array.isArray(profiles) ? profiles[0] : {};
    const traderName = profile.full_name || profile.username || 'Trader';

    // 3. Compute stats
    const wins = trades.filter(t => t.result === 'win').length;
    const losses = trades.filter(t => t.result === 'loss').length;
    const wr = trades.length ? Math.round(wins / trades.length * 100) : 0;
    const totalPnl = trades.reduce((s, t) => s + (t.pnl_pct || 0), 0);
    const totalUsd = trades.reduce((s, t) => s + (t.pnl_usd || 0), 0);
    const avgConf = trades.length ? (trades.reduce((s, t) => s + (t.emotion_conf || 5), 0) / trades.length).toFixed(1) : '—';
    const avgFear = trades.length ? (trades.reduce((s, t) => s + (t.emotion_fear || 3), 0) / trades.length).toFixed(1) : '—';

    // Best/worst setup
    const setupMap = {};
    trades.forEach(t => {
      if (!t.setup_type) return;
      if (!setupMap[t.setup_type]) setupMap[t.setup_type] = { w: 0, n: 0, pnl: 0 };
      setupMap[t.setup_type].n++;
      if (t.result === 'win') setupMap[t.setup_type].w++;
      setupMap[t.setup_type].pnl += (t.pnl_pct || 0);
    });
    const setups = Object.entries(setupMap).sort((a, b) => b[1].pnl - a[1].pnl);
    const bestSetup = setups[0] ? `${setups[0][0]} (${Math.round(setups[0][1].w/setups[0][1].n*100)}% WR)` : '—';

    // Best pair
    const pairMap = {};
    trades.forEach(t => { if (t.pair) { pairMap[t.pair] = (pairMap[t.pair] || 0) + (t.pnl_pct || 0); } });
    const bestPair = Object.entries(pairMap).sort((a, b) => b[1] - a[1])[0];

    // Equity curve data points
    let cum = 0;
    const eqPoints = trades.slice().reverse().map(t => { cum += (t.pnl_pct || 0); return cum; });

    // 4. AI Insight (optional — if GROQ available)
    let aiInsight = '';
    if (process.env.GROQ_API_KEY && trades.length >= 3) {
      try {
        const compact = trades.slice(0, 30).map(t => [
          t.pair, t.result === 'win' ? 'W' : 'X', (t.pnl_pct || 0).toFixed(1) + '%',
          t.setup_type || '-', `C${t.emotion_conf || '?'}G${t.emotion_greed || '?'}`
        ].join('|'));
        const aiResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile', max_tokens: 250, temperature: 0.25,
            messages: [{
              role: 'system',
              content: `Дай 2-3 предложения AI-разбора недели трейдера. ${trades.length} сделок, WR ${wr}%, P&L ${totalPnl.toFixed(1)}%. Данные: ${compact.join(' · ')}. Конкретные числа. Без markdown. На русском.`
            }, { role: 'user', content: 'Краткий AI-разбор.' }]
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (aiResp.ok) {
          const aiData = await aiResp.json();
          aiInsight = aiData.choices?.[0]?.message?.content || '';
        }
      } catch (e) { console.warn('[report] AI failed:', e.message); }
    }

    // 5. Generate HTML → PDF-like HTML (will be rendered by client as printable)
    const periodLabel = period === 'month' ? 'MONTHLY REPORT' : 'WEEKLY REPORT';
    const dateRange = since.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }) + ' — ' + now.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });

    // SVG equity mini-chart
    const svgW = 500, svgH = 80;
    const maxEq = Math.max(...eqPoints.map(Math.abs), 1);
    const eqPathPoints = eqPoints.map((v, i) => {
      const x = (i / Math.max(eqPoints.length - 1, 1)) * svgW;
      const y = svgH / 2 - (v / maxEq) * (svgH / 2 - 4);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const eqColor = totalPnl >= 0 ? '#34d058' : '#ff4d4d';
    const eqSvg = `<svg viewBox="0 0 ${svgW} ${svgH}" style="width:100%;height:80px;">
      <line x1="0" y1="${svgH/2}" x2="${svgW}" y2="${svgH/2}" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
      <path d="${eqPathPoints}" fill="none" stroke="${eqColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

    // Trades table rows
    const tableRows = trades.slice(0, 20).map(t => {
      const d = new Date(t.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
      const pnlStr = t.pnl_pct != null ? (t.pnl_pct >= 0 ? '+' : '') + t.pnl_pct.toFixed(1) + '%' : '—';
      const resEmoji = t.result === 'win' ? '✅' : t.result === 'loss' ? '❌' : '🔶';
      return `<tr>
        <td>${d}</td><td>${t.pair || '—'}</td><td>${(t.direction || 'long').toUpperCase()}</td>
        <td>${resEmoji}</td><td style="color:${t.pnl_pct >= 0 ? '#34d058' : '#ff4d4d'}">${pnlStr}</td>
        <td>${t.setup_type || '—'}</td>
      </tr>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>ORBITUM Report</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Syne:wght@400;700&display=swap');
*{margin:0;padding:0;box-sizing:border-box;}
body{background:#0a0c10;color:#e8eaf0;font-family:'Syne',sans-serif;padding:32px;max-width:800px;margin:0 auto;}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;padding-bottom:20px;border-bottom:1px solid rgba(255,255,255,0.08);}
.logo{font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:4px;color:#e8722a;}
.period{font-family:'JetBrains Mono',monospace;font-size:20px;letter-spacing:3px;margin-top:4px;}
.date{font-family:'JetBrains Mono',monospace;font-size:10px;color:rgba(255,255,255,0.35);margin-top:4px;}
.trader{text-align:right;font-family:'JetBrains Mono',monospace;font-size:11px;color:rgba(255,255,255,0.4);}
.trader b{color:#e8eaf0;display:block;font-size:13px;margin-bottom:2px;}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px;}
.stat{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:16px;}
.stat-label{font-family:'JetBrains Mono',monospace;font-size:8px;color:rgba(255,255,255,0.3);letter-spacing:2px;text-transform:uppercase;margin-bottom:6px;}
.stat-val{font-family:'JetBrains Mono',monospace;font-size:22px;font-weight:600;}
.green{color:#34d058;}.red{color:#ff4d4d;}.orange{color:#e8722a;}
.section{margin-bottom:24px;}
.sec-title{font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:3px;color:#e8722a;text-transform:uppercase;margin-bottom:12px;display:flex;align-items:center;gap:8px;}
.sec-title::before{content:'';width:16px;height:1px;background:#e8722a;}
.chart-box{background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:16px;}
table{width:100%;border-collapse:collapse;font-family:'JetBrains Mono',monospace;font-size:11px;}
th{text-align:left;padding:8px 10px;color:rgba(255,255,255,0.3);font-size:8px;letter-spacing:2px;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,0.08);}
td{padding:7px 10px;border-bottom:1px solid rgba(255,255,255,0.04);color:rgba(255,255,255,0.7);}
tr:hover td{background:rgba(232,114,42,0.03);}
.ai-box{background:rgba(232,114,42,0.04);border:1px solid rgba(232,114,42,0.15);border-radius:12px;padding:16px;margin-top:12px;}
.ai-label{font-family:'JetBrains Mono',monospace;font-size:8px;color:#e8722a;letter-spacing:2px;margin-bottom:8px;}
.ai-text{font-size:13px;color:rgba(255,255,255,0.75);line-height:1.8;}
.footer{margin-top:32px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;font-family:'JetBrains Mono',monospace;font-size:8px;color:rgba(255,255,255,0.2);letter-spacing:2px;}
@media print{body{background:#000;padding:20px;}}
</style></head><body>
<div class="header">
  <div>
    <div class="logo">ORBITUM</div>
    <div class="period">${periodLabel}</div>
    <div class="date">${dateRange}</div>
  </div>
  <div class="trader"><b>${esc(traderName)}</b>${trades.length} trades · WR ${wr}%</div>
</div>
<div class="stats">
  <div class="stat"><div class="stat-label">TRADES</div><div class="stat-val">${trades.length}</div></div>
  <div class="stat"><div class="stat-label">WINRATE</div><div class="stat-val ${wr >= 50 ? 'green' : 'red'}">${wr}%</div></div>
  <div class="stat"><div class="stat-label">P&L %</div><div class="stat-val ${totalPnl >= 0 ? 'green' : 'red'}">${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(1)}%</div></div>
  <div class="stat"><div class="stat-label">P&L $</div><div class="stat-val ${totalUsd >= 0 ? 'green' : 'red'}">${totalUsd >= 0 ? '+' : ''}$${Math.abs(totalUsd).toFixed(0)}</div></div>
</div>
<div class="stats" style="grid-template-columns:repeat(3,1fr)">
  <div class="stat"><div class="stat-label">AVG CONFIDENCE</div><div class="stat-val orange">${avgConf}/10</div></div>
  <div class="stat"><div class="stat-label">BEST SETUP</div><div class="stat-val" style="font-size:14px">${esc(bestSetup)}</div></div>
  <div class="stat"><div class="stat-label">BEST PAIR</div><div class="stat-val" style="font-size:14px">${bestPair ? esc(bestPair[0]) : '—'}</div></div>
</div>
<div class="section">
  <div class="sec-title">Equity Curve</div>
  <div class="chart-box">${eqPoints.length > 1 ? eqSvg : '<div style="text-align:center;padding:20px;color:rgba(255,255,255,0.2)">Not enough data</div>'}</div>
</div>
${aiInsight ? `<div class="section"><div class="sec-title">AI Coach Insight</div><div class="ai-box"><div class="ai-label">🤖 AI ANALYSIS</div><div class="ai-text">${esc(aiInsight)}</div></div></div>` : ''}
<div class="section">
  <div class="sec-title">Trade History</div>
  <table><thead><tr><th>Date</th><th>Pair</th><th>Dir</th><th>Result</th><th>P&L</th><th>Setup</th></tr></thead>
  <tbody>${tableRows || '<tr><td colspan="6" style="text-align:center;padding:20px;color:rgba(255,255,255,0.2)">No trades</td></tr>'}</tbody></table>
</div>
<div class="footer">ORBITUM TRADING JOURNAL · AI-POWERED ANALYTICS · ${new Date().getFullYear()}</div>
</body></html>`;

    // Return HTML that client can print/save as PDF
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);

  } catch (e) {
    console.error('[report]', e);
    return res.status(500).json({ error: e.message });
  }
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
