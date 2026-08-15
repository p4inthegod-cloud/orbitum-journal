import { createHash, timingSafeEqual } from 'node:crypto';
import { runMarketMonitor } from '../lib/market-notifications.js';

const MONITOR_KEY_HASH = 'ca32c8a1463bada10f7a5361d42c776effc536bece5f374aeb2ccf52bb7a0c0b';

function isAuthorized(req) {
  const supplied = String(req.headers?.['x-monitor-key'] || '');
  if (!supplied) return false;
  const actual = Buffer.from(createHash('sha256').update(supplied).digest('hex'));
  const expected = Buffer.from(MONITOR_KEY_HASH);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Метод не поддерживается' });
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Нет доступа' });

  try {
    const result = await runMarketMonitor();
    console.log('[market-monitor]', JSON.stringify(result));
    return res.status(result.ok ? 200 : 502).json(result);
  } catch (error) {
    console.error('[market-monitor]', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
