// 峰谷判定是纯时钟逻辑，直接从 client.js 的 pricing region 里取出来跑，
// 这样测试的是真实源码，而不是一份复制品。
import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const start = source.indexOf('// #region pricing')
const end = source.indexOf('// #endregion pricing')
assert.ok(start >= 0 && end > start, 'client.js 中找不到 pricing region')

const pricing = new Function(
  source.slice(start, end) +
  '\nreturn { pricePeriodAt, nextPriceSwitch, formatSwitchTime, formatDuration, beijingParts, HOLIDAYS }'
)()

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000

// 用「北京时间」构造绝对时刻，避免测试机本地时区影响。
function bj(year, month, day, hour = 0, minute = 0) {
  return Date.UTC(year, month - 1, day, hour, minute) - BEIJING_OFFSET_MS
}

test('工作日 9:00–12:00 / 14:00–18:00 为高峰，边界左闭右开', () => {
  // 2026-11-09 是周一。
  assert.equal(pricing.pricePeriodAt(bj(2026, 11, 9, 8, 59)).peak, false)
  assert.equal(pricing.pricePeriodAt(bj(2026, 11, 9, 9, 0)).peak, true)
  assert.equal(pricing.pricePeriodAt(bj(2026, 11, 9, 11, 59)).peak, true)
  assert.equal(pricing.pricePeriodAt(bj(2026, 11, 9, 12, 0)).peak, false)
  assert.equal(pricing.pricePeriodAt(bj(2026, 11, 9, 13, 59)).peak, false)
  assert.equal(pricing.pricePeriodAt(bj(2026, 11, 9, 14, 0)).peak, true)
  assert.equal(pricing.pricePeriodAt(bj(2026, 11, 9, 17, 59)).peak, true)
  assert.equal(pricing.pricePeriodAt(bj(2026, 11, 9, 18, 0)).peak, false)
  assert.equal(pricing.pricePeriodAt(bj(2026, 11, 9, 23, 59)).peak, false)
})

test('周末全天低谷，调休上班的周末也算低谷', () => {
  assert.equal(pricing.pricePeriodAt(bj(2026, 11, 7, 10, 0)).peak, false)
  assert.equal(pricing.pricePeriodAt(bj(2026, 11, 7, 10, 0)).reason, 'weekend')
  assert.equal(pricing.pricePeriodAt(bj(2026, 11, 8, 10, 0)).peak, false)
  // 2026-01-04 周日是调休上班日，但计费仍按周末（低谷）算。
  assert.equal(pricing.pricePeriodAt(bj(2026, 1, 4, 10, 0)).peak, false)
  assert.equal(pricing.pricePeriodAt(bj(2026, 1, 4, 10, 0)).reason, 'weekend')
})

test('法定节假日全天低谷，节后工作日恢复高峰', () => {
  // 2026 国庆 10-01 ~ 10-07。
  assert.equal(pricing.pricePeriodAt(bj(2026, 10, 1, 10, 0)).peak, false)
  assert.equal(pricing.pricePeriodAt(bj(2026, 10, 1, 10, 0)).reason, 'holiday')
  assert.equal(pricing.pricePeriodAt(bj(2026, 10, 8, 10, 0)).peak, true)
  // 2027 春节 02-05 ~ 02-13。
  assert.equal(pricing.pricePeriodAt(bj(2027, 2, 8, 10, 0)).reason, 'holiday')
  assert.equal(pricing.pricePeriodAt(bj(2027, 2, 15, 10, 0)).peak, true)
})

test('下次切换点', () => {
  // 高峰中：等 18:00 转低谷。
  assert.equal(pricing.nextPriceSwitch(bj(2026, 11, 9, 16, 36)), bj(2026, 11, 9, 18, 0))
  // 低谷中：等 14:00 转高峰。
  assert.equal(pricing.nextPriceSwitch(bj(2026, 11, 9, 12, 30)), bj(2026, 11, 9, 14, 0))
  // 早上开盘前：等 09:00。
  assert.equal(pricing.nextPriceSwitch(bj(2026, 11, 9, 8, 30)), bj(2026, 11, 9, 9, 0))
  // 周一晚上：等周二 09:00。
  assert.equal(pricing.nextPriceSwitch(bj(2026, 11, 9, 18, 30)), bj(2026, 11, 10, 9, 0))
  // 周五晚上：跨周末，等周一 09:00。
  assert.equal(pricing.nextPriceSwitch(bj(2026, 11, 13, 18, 30)), bj(2026, 11, 16, 9, 0))
  // 国庆前一天晚上：跨 7 天假期，等 10-08 09:00。
  assert.equal(pricing.nextPriceSwitch(bj(2026, 9, 30, 18, 30)), bj(2026, 10, 8, 9, 0))
})

test('切换时间与倒计时文案', () => {
  const now = bj(2026, 11, 9, 16, 36)
  assert.equal(pricing.formatSwitchTime(bj(2026, 11, 9, 18, 0), now), '今天 18:00')
  assert.equal(pricing.formatSwitchTime(bj(2026, 11, 10, 9, 0), now), '明天 09:00')
  assert.equal(pricing.formatSwitchTime(bj(2026, 10, 8, 9, 0), bj(2026, 9, 30, 18, 30)), '10月8日 09:00')
  assert.equal(pricing.formatDuration(84 * 60 * 1000), '1 小时 24 分')
  assert.equal(pricing.formatDuration(60 * 60 * 1000), '1 小时')
  assert.equal(pricing.formatDuration(30 * 1000), '1 分钟')
})

test('2026 / 2027 节假日表已覆盖首尾日', () => {
  assert.equal(pricing.HOLIDAYS['2026-01-01'], true)
  assert.equal(pricing.HOLIDAYS['2026-02-15'], true)
  assert.equal(pricing.HOLIDAYS['2026-02-23'], true)
  assert.equal(pricing.HOLIDAYS['2026-10-07'], true)
  assert.equal(pricing.HOLIDAYS['2027-01-03'], true)
  assert.equal(pricing.HOLIDAYS['2027-02-13'], true)
  assert.equal(pricing.HOLIDAYS['2027-10-07'], true)
  assert.equal(pricing.HOLIDAYS['2026-10-08'], undefined)
})
