import assert from 'node:assert/strict';
import test from 'node:test';

import {
  analyzeP2PAds,
  formatP2PMessage,
  getP2PConfig,
  scanWalletP2P,
} from '../lib/p2p-scanner.js';

const config = getP2PConfig({}, {
  fiatAmount: 2000,
  minDiscountPct: 0.5,
  minExecutionRate: 95,
  minOrders: 20,
});

test('filters unusable ads and ranks the cheapest eligible offer', () => {
  const result = analyzeP2PAds([
    { id: 'cheap', nickname: 'A', price: '85.5', minAmount: '1000', maxAmount: '5000', lastQuantity: '100', executeRate: '0.99', orderNum: 120, isOnline: true, payments: ['sberbank'] },
    { id: 'market-1', nickname: 'B', price: '86.6', minAmount: '1000', maxAmount: '10000', lastQuantity: '100', executeRate: '0.98', orderNum: 100, isOnline: true, payments: ['tinkoff'] },
    { id: 'market-2', nickname: 'C', price: '86.7', minAmount: '1000', maxAmount: '10000', lastQuantity: '100', executeRate: '0.97', orderNum: 90, isOnline: true, payments: ['sberbank'] },
    { id: 'bad-rate', nickname: 'D', price: '80', minAmount: '1000', maxAmount: '10000', lastQuantity: '100', executeRate: '0.80', orderNum: 100, isOnline: true },
    { id: 'bad-limit', nickname: 'E', price: '81', minAmount: '5000', maxAmount: '10000', lastQuantity: '100', executeRate: '1', orderNum: 100, isOnline: true },
  ], config);

  assert.equal(result.offers.length, 3);
  assert.equal(result.best.id, 'cheap');
  assert.equal(result.referencePrice, 86.6);
  assert.ok(result.best.discountPct > 1.2);
  assert.equal(result.qualifying.length, 1);
});

test('respects requested payment methods and available quantity', () => {
  const filteredConfig = getP2PConfig({}, {
    fiatAmount: 5000,
    paymentMethods: 'sberbank',
    minExecutionRate: 0,
    minOrders: 0,
  });
  const result = analyzeP2PAds([
    { id: 'wrong-bank', price: '85', minAmount: '1000', maxAmount: '10000', lastQuantity: '100', executeRate: '1', orderNum: 1, isOnline: true, payments: ['tinkoff'] },
    { id: 'not-enough', price: '84', minAmount: '1000', maxAmount: '10000', lastQuantity: '10', executeRate: '1', orderNum: 1, isOnline: true, payments: ['sberbank'] },
    { id: 'valid', price: '86', minAmount: '1000', maxAmount: '10000', lastQuantity: '100', executeRate: '1', orderNum: 1, isOnline: true, payments: ['sberbank'] },
  ], filteredConfig);

  assert.deepEqual(result.offers.map((offer) => offer.id), ['valid']);
});

test('uses the official API shape and escapes Telegram HTML', async () => {
  let request;
  const scan = await scanWalletP2P({ fiatAmount: 2000 }, {
    env: { P2P_WALLET_API_KEY: 'test-key' },
    fetch: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'SUCCESS',
          data: [
            { id: '1', nickname: '<Trader>', price: '86', minAmount: '1000', maxAmount: '10000', lastQuantity: '100', executeRate: '0.99', orderNum: 100, isOnline: true, payments: ['sberbank'] },
          ],
        }),
      };
    },
  });

  assert.match(request.url, /p2p\/integration-api\/v1\/item\/online$/);
  assert.equal(request.options.headers['X-API-Key'], 'test-key');
  assert.deepEqual(JSON.parse(request.options.body), {
    cryptoCurrency: 'USDT', fiatCurrency: 'RUB', side: 'SELL', page: 1, pageSize: 50,
  });
  assert.match(formatP2PMessage(scan), /&lt;Trader&gt;/);
});
