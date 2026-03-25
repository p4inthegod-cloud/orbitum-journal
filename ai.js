
// api/ai.js — ORBITUM AI proxy v4
// Modes: general | coach | brutal | weekly | trade_analyze | screener_insight

function resolveCorsOrigin(req) {
  const requestOrigin = req.headers.origin;
  const appUrl = process.env.APP_URL || 'https://orbitum.trade';
  if (!requestOrigin) return appUrl;
  const allowed = new Set([
    appUrl,
    'https://orbitum.trade',
    'https://www.orbitum.trade',
  ]);
  if (/^https:\/\/.*\.vercel\.app$/i.test(requestOrigin) || allowed.has(requestOrigin)) {
    return requestOrigin;
  }
  return appUrl;
}

function setCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', resolveCorsOrigin(req));
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function stripCodeFences(text = '') {
  return String(text).replace(/```json\s*|```/gi, '').trim();
}

function tryParseJson(text) {
  try { return JSON.parse(stripCodeFences(text)); } catch { return null; }
}

function normalizeStructured(mode, rawText) {
  const parsed = tryParseJson(rawText);

  if (mode === 'coach') {
    if (parsed && Array.isArray(parsed.patterns)) return { patterns: parsed.patterns };
    if (Array.isArray(parsed)) return { patterns: parsed };
    return { patterns: [] };
  }

  if (mode === 'weekly') {
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return {
        summary: String(parsed.summary || ''),
        best_pattern: String(parsed.best_pattern || ''),
        worst_pattern: String(parsed.worst_pattern || ''),
        tip: String(parsed.tip || ''),
        potential_saved: parsed.potential_saved ?? '',
      };
    }
    return {
      summary: 'AI не вернул структурированный недельный отчёт.',
      best_pattern: '',
      worst_pattern: '',
      tip: 'Проверь данные недели и повтори запрос.',
      potential_saved: '',
    };
  }

  if (mode === 'trade_analyze' || mode === 'screener_insight') {
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => ({
          type: ['ok', 'warn', 'danger', 'info'].includes(item?.type) ? item.type : 'info',
          text: String(item?.text || '').slice(0, 140),
        }))
        .filter((item) => item.text);
    }
    return [{ type: 'info', text: 'AI ответил нестабильно. Показан безопасный резервный формат.' }];
  }

  return parsed;
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.GROQ_API_KEY) return res.status(500).json({ error: 'Missing GROQ_API_KEY' });

  try {
    const { prompt, messages, mode, trades, stats, tradeData } = req.body || {};

    let chatMessages;
    let structuredMode = null;

    if (mode === 'coach' && Array.isArray(trades) && trades.length > 0) {
      chatMessages = [
        { role: 'system', content: buildCoachPrompt(trades, stats) },
        { role: 'user', content: 'Проанализируй мои сделки. Ответь только валидным JSON объектом.' }
      ];
      structuredMode = 'coach';
    }
    else if (mode === 'brutal' && Array.isArray(trades) && trades.length > 0) {
      chatMessages = [
        { role: 'system', content: buildBrutalPrompt(trades, stats) },
        { role: 'user', content: 'Дай максимально честный и жёсткий разбор. Без вежливости. Только факты и числа.' }
      ];
    }
    else if (mode === 'weekly' && Array.isArray(trades)) {
      chatMessages = [
        { role: 'system', content: buildWeeklyPrompt(trades, stats) },
        { role: 'user', content: 'Сделай недельный AI-разбор. Ответь JSON объектом.' }
      ];
      structuredMode = 'weekly';
    }
    else if (mode === 'trade_analyze' && tradeData) {
      chatMessages = [
        { role: 'system', content: buildTradeAnalyzePrompt() },
        { role: 'user', content: JSON.stringify(tradeData) }
      ];
      structuredMode = 'trade_analyze';
    }
    else if (mode === 'screener_insight' && tradeData) {
      chatMessages = [
        { role: 'system', content: buildScreenerInsightPrompt() },
        { role: 'user', content: JSON.stringify(tradeData) }
      ];
      structuredMode = 'screener_insight';
    }
    else {
      chatMessages = Array.isArray(messages) && messages.length > 0
        ? messages
        : [{ role: 'user', content: String(prompt || 'Привет').slice(0, 6000) }];
    }

    const bodyPayload = {
      model: structuredMode ? 'llama-3.1-8b-instant' : 'llama-3.3-70b-versatile',
      max_tokens: Math.min(req.body?.max_tokens || 1600, 4096),
      temperature: req.body?.temperature ?? (structuredMode ? 0.2 : 0.35),
      messages: chatMessages,
    };

    if (structuredMode && !['trade_analyze', 'screener_insight'].includes(structuredMode)) {
      bodyPayload.response_format = { type: 'json_object' };
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify(bodyPayload)
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('GROQ error:', response.status, err.slice(0, 300));
      return res.status(502).json({ error: 'AI service error', detail: err.slice(0, 140) });
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';

    if (structuredMode) {
      const normalized = normalizeStructured(structuredMode, text);
      return res.status(200).json({ text: JSON.stringify(normalized), data: normalized });
    }

    return res.status(200).json({ text: stripCodeFences(text) });
  } catch (err) {
    console.error('AI handler error:', err);
    return res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

function buildCoachPrompt(trades, stats = {}) {
  const rows = trades.slice(0, 50).map((t, i) => {
    const d = new Date(t.created_at || Date.now());
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

  return `Ты — персональный AI-коуч трейдера. Тебе даны реальные сделки.

Правила:
- Каждый вывод обязан содержать числа из данных.
- Ищи временные, эмоциональные и revenge-паттерны.
- Считай конкретные $ потерь от каждого паттерна.
- action: одно предложение, максимум 12 слов.

Эмоции: C=уверенность F=страх G=жадность K=фокус (1-10)

Данные (${trades.length} сделок):
${stats?.wr ? `WR: ${stats.wr}% | P&L: ${stats.totalPnl}%` : ''}

# | Пара | Напр | Рез | P&L% | P&L$ | Сетап | Эмоции | Время | Заметка
${rows.join('\n')}

Формат: только валидный JSON объект с полем patterns.
{"patterns":[{"severity":"critical|warning|positive","pattern":"до 6 слов","evidence":"числа из данных","action":"одно предложение до 12 слов","impact_usd":число}]}

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
В конце — одна главная рекомендация.`;
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

Ответь JSON объектом:
{"summary":"итог недели до 2 предложений","best_pattern":"что работало + числа","worst_pattern":"проблема + числа","tip":"совет на неделю до 15 слов","potential_saved":"$ экономии от исправления худшего паттерна"}`;
}

function buildTradeAnalyzePrompt() {
  return `Ты — торговый аналитик. Получаешь JSON с параметрами сделки: pair, direction, entry, sl, tp, rr, riskPct, rangePos, setup_type и структурные данные.

Верни только JSON массив карточек. Без markdown. На русском.
Формат: [{"type":"ok"|"warn"|"danger"|"info","text":"текст до 90 символов"}]

Правила оценки:
- RR < 1.0: danger
- RR 1.0–1.5: warn
- RR >= 2.0: ok
- rangePos > 0.85 на лонг: danger
- rangePos > 0.7 на лонг: warn
- rangePos < 0.15 на шорт: danger
- riskPct > 3%: danger
- riskPct 1.5–3%: warn
- riskPct < 0.5%: warn
- Добавь 1 карточку info с конкретным советом.

Верни 4–6 карточек, отсортированных от danger к ok.`;
}

function buildScreenerInsightPrompt() {
  return `Ты — технический аналитик крипторынка (ICT/SMC). Анализируй параметры сделки и рыночную структуру.

Входные данные JSON содержат: pair, tf, direction, entry, sl, tp, rr, riskPct, rangePos, structure, rsi, obs, fvgs, liquidity.

Правила:
- RR < 1.0 → danger; 1.0–1.5 → warn; >= 2.0 → ok
- riskPct > 3% → danger; > 1.5% → warn; < 0.5% → warn
- rangePos > 0.85 на лонг → danger; > 0.7 → warn
- rangePos < 0.15 на шорт → danger; < 0.3 → warn
- Бычья структура + long → ok; медвежья + long → warn
- Нетронутый OB/FVG рядом с entry → ok
- RSI >= 70 на лонг → warn; RSI <= 30 на шорт → warn
- Добавь 1–2 info карточки с конкретными уровнями.

Верни только JSON массив. Без markdown. 5–7 карточек.
Формат: [{"type":"ok"|"warn"|"danger"|"info","text":"текст до 100 символов"}]`;
}
