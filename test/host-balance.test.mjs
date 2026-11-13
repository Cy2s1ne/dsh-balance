import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeApiBalance } from '../index.js'

test('把总余额 / 充值余额 / 赠送额度拆成三组钱包', () => {
  const result = normalizeApiBalance({
    is_available: true,
    balance_infos: [
      { currency: 'CNY', total_balance: '92.11', granted_balance: '0.00', topped_up_balance: '92.11' },
      { currency: 'USD', total_balance: '12.5', granted_balance: '2.5', topped_up_balance: '10' },
    ],
  })
  assert.deepEqual(result.totalWallets, [
    { currency: 'CNY', balance: '92.11' },
    { currency: 'USD', balance: '12.5' },
  ])
  assert.deepEqual(result.wallets, [
    { currency: 'CNY', balance: '92.11' },
    { currency: 'USD', balance: '10' },
  ])
  assert.deepEqual(result.bonusWallets, [
    { currency: 'CNY', balance: '0.00' },
    { currency: 'USD', balance: '2.5' },
  ])
  assert.equal(result.available, true)
})

test('余额不足时保留金额并标记 available=false', () => {
  const result = normalizeApiBalance({
    is_available: false,
    balance_infos: [{ currency: 'CNY', total_balance: '0.00', granted_balance: '0.00', topped_up_balance: '0.00' }],
  })
  assert.equal(result.available, false)
  assert.equal(result.totalWallets.length, 1)
})

test('缺失字段与未知币种不会抛错', () => {
  const result = normalizeApiBalance({
    balance_infos: [
      { currency: 'EUR', total_balance: 3.5 },
      { currency: 'CNY' },
      null,
      'bad',
    ],
  })
  assert.deepEqual(result.totalWallets, [{ currency: 'CNY', balance: '3.5' }])
  assert.deepEqual(result.wallets, [])
  assert.deepEqual(result.bonusWallets, [])
  assert.equal(result.available, true)
})

test('空响应 / 非法 body 返回空数组', () => {
  for (const body of [null, {}, { balance_infos: null }]) {
    const result = normalizeApiBalance(body)
    assert.deepEqual(result.totalWallets, [])
    assert.deepEqual(result.wallets, [])
    assert.deepEqual(result.bonusWallets, [])
  }
})
