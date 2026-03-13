// api/ai.js — GROQ AI proxy
// FIXED BUG 6: messages из req.body теперь используются (история чата)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { prompt, messages } = req.body;

    // FIX BUG 6: если передан массив messages — используем его (история чата)
    // иначе — оборачиваем одиночный prompt
    const chatMessages = Array.isArray(messages) && messages.length > 0
      ? messages
      : [{ role: 'user', content: prompt }];

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: Math.min(req.body.max_tokens || 1500, 4096),
        temperature: req.body.temperature ?? 0.3,
        messages: chatMessages,
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('GROQ error:', response.status, err.slice(0, 200));
      // Pass Groq error details to client for debugging
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
