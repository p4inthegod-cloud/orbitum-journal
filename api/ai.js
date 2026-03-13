// api/ai.js — GROQ AI proxy v2 (AI Coach with trade-level intelligence)
// Supports: general chat, coach analysis with full trade data, brutal analysis, weekly AI report

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { prompt, messages, mode, trades, stats } = req.body;

    let chatMessages;

    // ── MODE: COACH v2 — full trade-level analysis ──────────────
    if (mode === 'coach' && Array.isArray(trades) && trades.length > 0) {
      chatMessages = [
        { role: 'system', content: buildCoachPrompt(trades, stats) },
        { role: 'user', content: 'Проанализируй мои сделки. Найди конкретные паттерны с числами. Ответь ТОЛЬКО валидным JSON массивом.' }
      ];
    }
    // ── MODE: BRUTAL — no-filter honest analysis ────────────────
    else if (mode === 'brutal' && Array.isArray(trades) && trades.length > 0) {
      chatMessages = [
        { role: 'system', content: buildBrutalPrompt(trades, stats) },
        { role: 'user', content: 'Дай максимально честный и жёсткий разбор. Без вежливости. Только факты и числа.' }
      ];
    }
    // ── MODE: WEEKLY — AI-powered weekly report ─────────────────
    else if (mode === 'weekly' && Array.isArray(trades)) {
      chatMessages = [
        { role: 'system', content: buildWeeklyPrompt(trades, stats) },
        { role: 'user', content: 'Сделай недельный AI-разбор. Ответь JSON.' }
      ];
    }
    // ── DEFAULT: chat or single prompt ──────────────────────────
    else {
      chatMessages = Array.isArray(messages) && messages.length > 0
        ? messages
        : [{ role: 'user', content: prompt || 'Привет' }];
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: Math.min(req.body.max_tokens || 2000, 4096),
        temperature: req.body.temperature ?? 0.25,
        messages: chatMessages,
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('GROQ error:', response.status, err.slice(0, 200));
      return res.status(502).json({ error: 'AI service error', detail: err.slice(0, 100) });
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    res.status(200).json({ text });

  } catch (err) {
    console.error('AI handler error:', err);
    res.status(500).json({ error: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════
// PROMPT BUILDERS
// ═══════════════════════════════════════════════════════════════

function buildCoachPrompt(trades, stats = {}) {
  const rows = trades.slice(0, 50).map((t, i) => {
    const d = new Date(t.created_at);
    const day = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'][d.getDay()];
    return [
      i+1, t.pair||'?', t.direction==='short'?'S':'L',
      t.result==='win'?'W':t.result==='loss'?'X':'BE',
      t.pnl_pct!=null ? Number(t.pnl_pct).toFixed(1)+'%' : '?',
      t.pnl_usd!=null ? '$'+Number(t.pnl_usd).toFixed(0) : '',
      t.setup_type||'-',
      `C${t.emotion_conf||'?'} F${t.emotion_fear||'?'} G${t.emotion_greed||'?'} K${t.emotion_calm||'?'}`,
      `${day} ${d.getHours()}:xx`,
      (t.note_why||'').slice(0,60), (t.note_feel||'').slice(0,60),
    ].join(' | ');
  });

  return `Ты — персональный AI-коуч трейдера. Тебе даны РЕАЛЬНЫЕ сделки.

ПРАВИЛА:
- Анализируй КОНКРЕТНЫЕ ДАННЫЕ, не давай общих советов
- Каждый вывод ОБЯЗАН содержать числа из данных
- Ищи временные паттерны (часы, дни недели)
- Ищи эмоциональные паттерны (жадность/страх → результат)
- Ищи паттерны по парам и сетапам
- Ищи revenge trading (быстрые входы после убытков)
- Считай конкретные $ потерь от каждого паттерна

ЭМОЦИИ: C=уверенность F=страх G=жадность K=фокус (1-10)

ДАННЫЕ (${trades.length} сделок):
${stats.wr ? `WR: ${stats.wr}% | P&L: ${stats.totalPnl}%` : ''}

# | Пара | Напр | Рез | P&L% | P&L$ | Сетап | Эмоции | Время | Сетап-заметка | Эмоции-заметка
${rows.join('\n')}

ФОРМАТ ОТВЕТА — ТОЛЬКО валидный JSON (без markdown, без backticks):
[{"severity":"critical|warning|positive","pattern":"до 6 слов","evidence":"числа из данных","action":"одно действие","impact_usd":число}]

Дай 4-6 паттернов. Сортируй по impact_usd.`;
}

function buildBrutalPrompt(trades, stats = {}) {
  const rows = trades.slice(0, 50).map(t => [
    t.pair||'?', t.direction==='short'?'S':'L',
    t.result==='win'?'W':'X', t.pnl_pct!=null?Number(t.pnl_pct).toFixed(1)+'%':'?',
    t.setup_type||'-', `C${t.emotion_conf||'?'}F${t.emotion_fear||'?'}G${t.emotion_greed||'?'}`,
    (t.note_feel||'').slice(0,40),
  ].join(' | '));

  return `Ты — жёсткий торговый аналитик. Никакой вежливости. Только правда и числа.

Данные (${trades.length} сд, WR ${stats.wr||'?'}%, P&L ${stats.totalPnl||'?'}%):
${rows.join('\n')}

5-7 пунктов. Каждый с числами. **Жирный** для выводов.
Если сливает — скажи прямо. Если сильные стороны — отметь.
В конце — ОДНА главная рекомендация.`;
}

function buildWeeklyPrompt(trades, stats = {}) {
  const rows = trades.slice(0, 30).map(t => [
    t.pair||'?', t.result==='win'?'W':'X',
    t.pnl_pct!=null?Number(t.pnl_pct).toFixed(1)+'%':'?',
    t.setup_type||'-', `C${t.emotion_conf||5}F${t.emotion_fear||3}G${t.emotion_greed||3}`,
  ].join('|'));

  return `AI-разбор недели трейдера. Кратко и конкретно.

Сделки (${trades.length}):
${rows.join('\n')}

Ответь JSON (без markdown):
{"summary":"итог недели","best_pattern":"что работало + числа","worst_pattern":"проблема + числа","tip":"совет на неделю","potential_saved":"$ экономии от исправления худшего паттерна"}`;
}
