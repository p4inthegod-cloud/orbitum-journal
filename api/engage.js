import dailyHandler from '../lib/daily.js';
import weeklyHandler from '../lib/weekly.js';
import notifyHandler from '../lib/notify.js';
import onboardingHandler from '../lib/onboarding.js';

const MAP = {
  daily: dailyHandler,
  weekly: weeklyHandler,
  notify: notifyHandler,
  onboarding: onboardingHandler,
};

export default async function handler(req, res) {
  const flow = req.query?.__flow || req.query?.flow || req.headers['x-orbitum-flow'];
  const delegate = MAP[flow];

  if (!delegate) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(400).json({
      error: 'Unknown engage flow',
      available: Object.keys(MAP),
    });
  }

  return delegate(req, res);
}
