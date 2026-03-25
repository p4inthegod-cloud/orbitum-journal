import alertsHandler from '../lib/alerts.js';
import finnhubHandler from '../lib/finnhub.js';

const MAP = {
  alerts: alertsHandler,
  finnhub: finnhubHandler,
};

export default async function handler(req, res) {
  const flow = req.query?.__flow || req.query?.flow || req.headers['x-orbitum-flow'];
  const delegate = MAP[flow];

  if (!delegate) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(400).json({
      error: 'Unknown market flow',
      available: Object.keys(MAP),
    });
  }

  return delegate(req, res);
}
