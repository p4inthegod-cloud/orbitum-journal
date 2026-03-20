// api/ai.js — ORBITUM AI proxy v3
// Modes: general | coach | brutal | weekly | trade_analyze | screener_insight

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.APP_URL || 'https://orbitum.trade');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { prompt, messages, mode, trades, stats, tradeData, coinData } = req.body;

    let chatMessages;
    let forceJson = false;

    if (mode === 'coach' && Array.isArray(trades) && trades.length > 0) {
      chatMessages = [
        { role: 'system', content: buildCoachPrompt(trades, stats) },
        { role: 'user', content: 'Проанализируй мои сделки. Найди конкретные паттерны с числами. Ответь ТОЛЬКО валидным JSON массивом.' }
      ];
      forceJson = true;
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
        { role: 'user', content: 'Сделай недельный AI-разбор. Ответь JSON.' }
      ];
      forceJson = true;
    }
    // ── NEW: trade_analyze — replaces direct Anthropic call in trade-analyzer.html & screener ──
    else if (mode === 'trade_analyze' && tradeData) {
      chatMessages = [
        { role: 'system', content: buildTradeAnalyzePrompt() },
        { role: 'user', content: JSON.stringify(tradeData) }
      ];
      forceJson = true;
    }
    // ── NEW: screener_insight — replaces direct Anthropic call in screener.html (AT panel) ──
    else if (mode === 'screener_insight' && tradeData) {
      chatMessages = [
        { role: 'system', content: buildScreenerInsightPrompt() },
        { role: 'user', content: JSON.stringify(tradeData) }
      ];
      forceJson = true;
    }
    // ── DEFAULT: chat or single prompt ──────────────────────────
    else {
      chatMessages = Array.isArray(messages) && messages.length > 0
        ? messages
        : [{ role: 'user', content: prompt || 'Привет' }];
    }

    const bodyPayload = {
      model: 'llama-3.3-70b-versatile',
      max_tokens: Math.min(req.body.max_tokens || 2000, 4096),
      temperature: req.body.temperature ?? 0.25,
      messages: chatMessages,
    };

    // Force JSON output for structured modes — prevents markdown wrapping
    if (forceJson) {
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
- Каждый вывод ОБЯЗАН содержать числа из данных
- Ищи временные паттерны (часы, дни недели)
- Ищи эмоциональные паттерны (жадность/страх → результат)
- Ищи revenge trading (убыток → быстрый следующий вход)
- Считай конкретные $ потерь от каждого паттерна
- action: ОДНО предложение, максимум 12 слов

ЭМОЦИИ: C=уверенность F=страх G=жадность K=фокус (1-10)

ДАННЫЕ (${trades.length} сделок):
${stats.wr ? `WR: ${stats.wr}% | P&L: ${stats.totalPnl}%` : ''}

# | Пара | Напр | Рез | P&L% | P&L$ | Сетап | Эмоции | Время | Заметка
${rows.join('\n')}

ФОРМАТ — ТОЛЬКО валидный JSON объект с полем "patterns":
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

Ответь JSON объектом:
{"summary":"итог недели до 2 предложений","best_pattern":"что работало + числа","worst_pattern":"проблема + числа","tip":"совет на неделю до 15 слов","potential_saved":"$ экономии от исправления худшего паттерна"}`;
}

function buildTradeAnalyzePrompt() {
  return `Ты — торговый аналитик. Получаешь JSON с параметрами сделки: pair, direction, entry, sl, tp, rr (R:R ratio), riskPct (% риска), rangePos (позиция входа в диапазоне 0–1), setup_type, структурные данные.

Верни ТОЛЬКО JSON массив карточек обратной связи. Без markdown, без пояснений. На русском.
Формат каждой карточки: {"type":"ok"|"warn"|"danger"|"info","text":"текст с эмодзи до 90 символов"}

ПРАВИЛА ОЦЕНКИ:
- RR < 1.0: danger — риск превышает потенциальную прибыль
- RR 1.0–1.5: warn — допустимо, но желательно выше 1.5
- RR >= 2.0: ok — хорошее соотношение
- rangePos > 0.85 на лонг: danger — покупаешь на максимуме диапазона
- rangePos > 0.7 на лонг: warn — поздний вход
- rangePos < 0.15 на шорт: danger — шортишь на минимуме
- riskPct > 3%: danger — критически высокий риск на сделку
- riskPct 1.5–3%: warn — выше стандарта 1–2%
- riskPct < 0.5%: warn — слишком мал, не окупит комиссии
- Добавь 1 карточку info с конкретным советом по улучшению входа

Верни 4–6 карточек, отсортированных от danger к ok.`;
}

function buildScreenerInsightPrompt() {
  return `Ты — технический аналитик крипторынка (ICT/SMC). Анализируй параметры сделки и рыночную структуру.

Входные данные JSON содержат: pair, tf, direction, entry, sl, tp, rr, riskPct, rangePos, structure (тренд HH/HL/LH/LL), rsi, obs (order blocks), fvgs (fair value gaps), liquidity.

ПРАВИЛА ОЦЕНКИ:
- RR < 1.0 → danger; 1.0–1.5 → warn; >= 2.0 → ok
- riskPct > 3% → danger; > 1.5% → warn; < 0.5% → warn (слишком мал)
- rangePos > 0.85 на лонг → danger (гонишься за ценой); > 0.7 → warn
- rangePos < 0.15 на шорт → danger; < 0.3 → warn
- structure содержит БЫЧИЙ и direction=long → ok; structure МЕДВЕЖИЙ и direction=long → warn
- Наличие нетронутого OB/FVG рядом с entry → ok (confluences)
- RSI >= 70 на лонг → warn; RSI <= 30 на шорт → warn
- Добавь 1–2 карточки info с конкретными уровнями из данных

Возврати ТОЛЬКО JSON массив. Без markdown. На русском. 5–7 карточек.
Формат: [{"type":"ok"|"warn"|"danger"|"info","text":"текст с эмодзи до 100 символов"}]`;
