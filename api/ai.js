// ORBITUM AI proxy
// Modes: general | coach | brutal | weekly | trade_analyze | screener_insight

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.APP_URL || 'https://orbitum.trade');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      prompt,
      messages,
      mode = 'general',
      trades = [],
      stats = {},
      tradeData,
      max_tokens,
      temperature,
    } = req.body || {};

    let chatMessages = [];
    let forceJson = false;

    if (mode === 'coach' && Array.isArray(trades) && trades.length > 0) {
      chatMessages = [
        { role: 'system', content: buildCoachPrompt(trades, stats) },
        { role: 'user', content: 'Analyze these trades and return only valid JSON.' },
      ];
      forceJson = true;
    } else if (mode === 'brutal' && Array.isArray(trades) && trades.length > 0) {
      chatMessages = [
        { role: 'system', content: buildBrutalPrompt(trades, stats) },
        { role: 'user', content: 'Give the hardest truthful breakdown. No padding.' },
      ];
    } else if (mode === 'weekly' && Array.isArray(trades)) {
      chatMessages = [
        { role: 'system', content: buildWeeklyPrompt(trades, stats) },
        { role: 'user', content: 'Return only valid JSON.' },
      ];
      forceJson = true;
    } else if (mode === 'trade_analyze' && tradeData) {
      chatMessages = [
        { role: 'system', content: buildTradeAnalyzePrompt() },
        { role: 'user', content: JSON.stringify(tradeData) },
      ];
      forceJson = true;
    } else if (mode === 'screener_insight' && tradeData) {
      chatMessages = [
        { role: 'system', content: buildScreenerInsightPrompt() },
        { role: 'user', content: JSON.stringify(tradeData) },
      ];
      forceJson = true;
    } else {
      const baseMessages = Array.isArray(messages) && messages.length
        ? messages
        : [{ role: 'user', content: prompt || 'Hello' }];
      chatMessages = [
        { role: 'system', content: buildGeneralPrompt(trades, stats) },
        ...baseMessages,
      ];
    }

    const payload = {
      model: DEFAULT_MODEL,
      max_tokens: Math.min(max_tokens || 1800, 4096),
      temperature: temperature ?? (mode === 'general' ? 0.2 : 0.15),
      messages: chatMessages,
    };

    if (forceJson) {
      payload.response_format = { type: 'json_object' };
    }

    const response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error('GROQ error:', response.status, detail.slice(0, 300));
      return res.status(502).json({ error: 'AI service error', detail: detail.slice(0, 120) });
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    return res.status(200).json({ text });
  } catch (error) {
    console.error('AI handler error:', error);
    return res.status(500).json({ error: error.message || 'Unknown error' });
  }
}

function buildGeneralPrompt(trades, stats = {}) {
  const context = summarizeTrades(trades, 10);
  const statsBlock = buildStatsLine(stats);

  return [
    'You are ORBITUM AI Advisor: a precise trading assistant, trading psychologist, and journal analyst.',
    'You can answer trading questions, market structure questions, journaling questions, and general user questions.',
    'If the question is outside trading, still answer helpfully instead of refusing unless it is unsafe.',
    'Be concrete, specific, and structured.',
    'Do not give vague filler such as "be disciplined" unless you connect it to a mechanism, example, or rule.',
    'When discussing trades, explain cause -> mistake -> consequence -> correction.',
    'Prefer concise blocks, bullets, and practical next steps.',
    'If market data is not provided, do not pretend you have live quotes.',
    statsBlock ? `Journal stats: ${statsBlock}` : '',
    context ? `Recent journal context:\n${context}` : '',
  ].filter(Boolean).join('\n');
}

function buildCoachPrompt(trades, stats = {}) {
  const rows = trades.slice(0, 60).map((trade, index) => {
    const d = new Date(trade.created_at || Date.now());
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
    return [
      `#${index + 1}`,
      trade.pair || '?',
      trade.direction || '?',
      trade.result || '?',
      trade.pnl_pct != null ? `${Number(trade.pnl_pct).toFixed(2)}%` : '?',
      trade.pnl_usd != null ? `$${Number(trade.pnl_usd).toFixed(2)}` : '$?',
      trade.setup_type || '-',
      `conf:${trade.emotion_conf ?? '?'}`,
      `fear:${trade.emotion_fear ?? '?'}`,
      `greed:${trade.emotion_greed ?? '?'}`,
      `focus:${trade.emotion_calm ?? '?'}`,
      `${day} ${String(d.getHours()).padStart(2, '0')}:00`,
      truncate(trade.note_why, 90),
      truncate(trade.note_feel, 90),
      truncate(trade.note_lesson, 90),
    ].join(' | ');
  });

  return [
    'You are a strict trading performance coach.',
    'Your job is not to comfort the trader. Your job is to diagnose exactly what they did wrong, why it happened, and how it cost money.',
    'Every negative finding must include all four parts: wrong_action, why_it_happened, proof, fix_now.',
    'Never output generic advice like "avoid revenge trading" unless you prove it from the dataset.',
    'Use the journal notes and emotions to infer the trigger behind the mistake.',
    'If evidence is weak, say so and lower the confidence.',
    'Sort findings by estimated money impact.',
    buildStatsLine(stats) ? `Stats: ${buildStatsLine(stats)}` : '',
    'Return only valid JSON in this exact shape:',
    '{"summary":"string","patterns":[{"severity":"critical|warning|positive","title":"string","wrong_action":"string","why_it_happened":"string","proof":"string","fix_now":"string","impact_usd":123,"confidence":0.84}],"best_pattern":{"title":"string","proof":"string","keep_doing":"string"},"next_session_rules":["rule 1","rule 2","rule 3"]}',
    'Data:',
    rows.join('\n'),
  ].filter(Boolean).join('\n');
}

function buildBrutalPrompt(trades, stats = {}) {
  return [
    'You are a brutally honest trading analyst.',
    'Tell the truth with numbers. No motivational filler.',
    'Explain what the trader is doing that is statistically weak and what is actually working.',
    buildStatsLine(stats) ? `Stats: ${buildStatsLine(stats)}` : '',
    summarizeTrades(trades, 50),
  ].filter(Boolean).join('\n\n');
}

function buildWeeklyPrompt(trades, stats = {}) {
  return [
    'Create a short weekly trading review.',
    'Return only valid JSON.',
    'Shape:',
    '{"summary":"string","best_pattern":"string","worst_pattern":"string","tip":"string","potential_saved":"string"}',
    buildStatsLine(stats) ? `Stats: ${buildStatsLine(stats)}` : '',
    summarizeTrades(trades, 30),
  ].filter(Boolean).join('\n');
}

function buildTradeAnalyzePrompt() {
  return [
    'You are a trading setup analyst.',
    'Return only a JSON array of cards.',
    'Format: [{"type":"ok"|"warn"|"danger"|"info","text":"short Russian text"}]',
    'Judge risk, RR, entry quality, and give one concrete fix.',
  ].join('\n');
}

function buildScreenerInsightPrompt() {
  return [
    'You are a crypto technical analyst using market-structure logic.',
    'Return only a JSON array.',
    'Format: [{"type":"ok"|"warn"|"danger"|"info","text":"short Russian text"}]',
    'Judge RR, risk, directional alignment, entry location, and confluence.',
  ].join('\n');
}

function buildStatsLine(stats = {}) {
  const bits = [];
  if (stats.wr != null) bits.push(`WR ${stats.wr}%`);
  if (stats.totalPnl != null) bits.push(`P&L ${stats.totalPnl}%`);
  if (stats.totalUsd != null) bits.push(`Net $${stats.totalUsd}`);
  if (stats.avgLossStreak != null) bits.push(`Avg loss streak ${stats.avgLossStreak}`);
  return bits.join(' | ');
}

function summarizeTrades(trades, limit) {
  if (!Array.isArray(trades) || !trades.length) return '';
  return trades.slice(0, limit).map((trade, index) => {
    const d = new Date(trade.created_at || Date.now());
    return [
      `#${index + 1}`,
      trade.pair || '?',
      trade.direction || '?',
      trade.result || '?',
      trade.pnl_pct != null ? `${Number(trade.pnl_pct).toFixed(2)}%` : '?',
      trade.pnl_usd != null ? `$${Number(trade.pnl_usd).toFixed(2)}` : '$?',
      trade.setup_type || '-',
      `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00`,
      truncate(trade.note_why, 80),
      truncate(trade.note_feel, 80),
    ].join(' | ');
  }).join('\n');
}

function truncate(value, max) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '-';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
