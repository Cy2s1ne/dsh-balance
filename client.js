// dsh-balance — 浏览器端（Client half）
//
// 契约外壳：dsh web 的客户端插件加载器按 window.__ModuleLoader__.load({ id, factory })
// 的约定装载本模块。factory 内注入的 require 只能解析宿主放行的外部依赖（React 等），
// 产物因此是自包含单文件、零运行时依赖。
//
// 界面职责：在「输入框工具行」右侧（conversation.input.right 插槽）渲染一个余额胶囊，
// 数据经本插件的宿主端只读接口 /api/dsh-balance 获取，按固定周期轮询刷新。
window.__ModuleLoader__.load({
  id: '@cy2s1ne/dsh-balance',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    'use strict'

    // React 互操作：不同构建下可能是命名空间对象或 default 导出。
    var React = require('react')
    if (React && typeof React.createElement !== 'function' && React.default) React = React.default

    var API = '/api/dsh-balance'
    var POLL_MS = 20000
    // apply() 时捕获客户端根 ctx，用来按当前会话读取模型选择。
    var clientCtx = null
    var DEFAULT_PROVIDER = 'deepseek-account'

    // 客户端样式：前缀 db- 避免与 shell / 其他插件冲突；
    // 颜色一律走 --dsw-alias-* 主题变量并带浅色回退，明暗自适应。
    var CSS = [
      '.db-wrap{position:relative;display:inline-flex;align-items:center}',
      '.db-pill{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 9px;',
      'border:1px solid var(--dsw-alias-border-l1,#d7dae0);border-radius:99px;',
      'background:var(--dsw-alias-bg-base,transparent);',
      'color:var(--dsw-alias-label-secondary,#6b7280);font-size:12px;line-height:1;',
      'font-family:system-ui,-apple-system,"Segoe UI",sans-serif;cursor:pointer;white-space:nowrap}',
      '.db-pill:hover{background:var(--dsw-alias-interactive-bg-hover,#f2f4f8);',
      'color:var(--dsw-alias-label-primary,#1c1e26)}',
      '.db-dot{width:6px;height:6px;border-radius:50%;flex:none;',
      'background:var(--dsw-alias-label-tertiary,#9aa1ad)}',
      // 状态灯语义：绿色 = 低谷价，琥珀 = 高峰价。
      '.db-dot[data-price="offpeak"]{background:var(--dsw-alias-state-success-primary,#0f9d6e)}',
      '.db-dot[data-price="peak"]{background:var(--dsw-alias-state-warn-primary,#e08b1e)}',
      // 余额查询失败时在时段灯外圈加红描边，避免峰谷色盖掉错误信号。
      '.db-dot[data-alert="error"]{box-shadow:0 0 0 1.5px var(--dsw-alias-state-error-primary,#e0483e)}',
      '.db-num{font-variant-numeric:tabular-nums}',
      '.db-tag{font-size:10px;line-height:1;padding:2px 4px;border-radius:4px;font-weight:600}',
      '.db-tag[data-price="offpeak"]{color:var(--dsw-alias-state-success-primary,#0f9d6e);',
      'background:rgba(15,157,110,.10)}',
      '.db-tag[data-price="peak"]{color:var(--dsw-alias-state-warn-primary,#b26a00);',
      'background:rgba(224,139,30,.12)}',
      // 面板用 fixed 定位并在打开时按胶囊实测坐标摆放：
      // 输入框工具行的祖先链上可能有 overflow:hidden，absolute 面板会被裁掉。
      '.db-panel{position:fixed;z-index:90;',
      'width:260px;box-sizing:border-box;max-width:calc(100vw - 32px);padding:10px 12px;',
      'border:1px solid var(--dsw-alias-border-l1,#e2e4ea);border-radius:10px;',
      'background:var(--dsw-alias-bg-base,#fdfdfd);color:var(--dsw-alias-label-primary,#1c1e26);',
      'box-shadow:0 10px 32px rgba(0,0,0,.18);font-size:12px;text-align:left;',
      'font-family:system-ui,-apple-system,"Segoe UI",sans-serif}',
      '.db-row{display:flex;align-items:baseline;justify-content:space-between;gap:14px;padding:3px 0}',
      '.db-row .db-k{flex:none;white-space:nowrap;color:var(--dsw-alias-label-secondary,#8a8f9c);font-size:11px}',
      '.db-row .db-v{font-variant-numeric:tabular-nums;font-weight:600}',
      '.db-sec{margin-top:8px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1,#eceef2)}',
      '.db-sec-t{color:var(--dsw-alias-label-tertiary,#9aa1ad);font-size:10px;margin-bottom:4px}',
      '.db-price-sec{margin-top:0;padding-top:0;border-top:0;margin-bottom:2px}',
      '.db-price-val{font-weight:600}',
      '.db-price-val[data-price="offpeak"]{color:var(--dsw-alias-state-success-primary,#0f9d6e)}',
      '.db-price-val[data-price="peak"]{color:var(--dsw-alias-state-warn-primary,#b26a00)}',
      '.db-account{max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.db-switch{display:flex;flex-direction:column;align-items:flex-end;gap:1px}',
      '.db-switch-when{font-weight:600}',
      '.db-switch-in{font-size:10px;font-weight:400;',
      'color:var(--dsw-alias-label-tertiary,#9aa1ad)}',
      '.db-note{color:var(--dsw-alias-label-secondary,#8a8f9c);font-size:11px;line-height:1.5}',
      '.db-links{display:flex;gap:8px;margin-top:9px;flex-wrap:wrap}',
      '.db-links a{flex:1;text-align:center;text-decoration:none;padding:5px 8px;border-radius:6px;',
      'border:1px solid var(--dsw-alias-border-l1,#d7dae0);',
      'color:var(--dsw-alias-label-primary,#1c1e26);font-size:11px}',
      '.db-links a:hover{background:var(--dsw-alias-interactive-bg-hover,#eef1f5)}',
      '.db-foot{margin-top:7px;color:var(--dsw-alias-label-tertiary,#9aa1ad);font-size:10px}',
    ].join('')

    // 货币符号：仅覆盖平台实际会返回的两种。
    function symbolOf(currency) {
      return currency === 'USD' ? '$' : '¥'
    }

    // 金额展示：保留 2 位小数，避免把平台下发的高精度小数整串铺出来。
    function formatAmount(value) {
      var num = Number(value)
      if (!isFinite(num)) return String(value)
      return num.toFixed(2)
    }

    // 主钱包：优先人民币，否则取第一个。
    function primaryWallet(wallets) {
      if (!Array.isArray(wallets) || wallets.length === 0) return null
      for (var i = 0; i < wallets.length; i++) {
        if (wallets[i] && wallets[i].currency === 'CNY') return wallets[i]
      }
      return wallets[0]
    }

    // 宿主返回的 provider.id 对应的显示名；宿主通常已带回 name。
    function providerNameOf(id) {
      if (id === 'deepseek-official') return 'DeepSeek API Key'
      if (id === 'deepseek-account') return 'DeepSeek 账号'
      return id || '未知账户'
    }

    // 订阅 modelDirectories 的会话 store；没有 store 时返回 null。
    function useSnapshotStore(store) {
      var pair = React.useState(store ? store.getSnapshot() : null)
      var value = pair[0]
      var setValue = pair[1]
      React.useEffect(function () {
        if (!store) {
          setValue(null)
          return
        }
        setValue(store.getSnapshot())
        var unsubscribe = store.subscribe(function () { setValue(store.getSnapshot()) })
        return function () {
          if (typeof unsubscribe === 'function') unsubscribe()
        }
      }, [store])
      return value
    }

    // ── DeepSeek 峰谷定价 ──────────────────────────────────────────────────
    // 官方规则（2026-08-17 起，api-docs.deepseek.com/zh-cn/quick_start/pricing）：
    //   高峰：北京时间周一至周五（不含中国法定节假日）9:00–12:00、14:00–18:00；
    //   低谷：其余全部时段——含周末、调休上班的周末、法定节假日全天；
    //   低谷价为高峰价的一半。
    // 判定固定按 UTC+8 计算，不依赖浏览器所在时区（中国不实行夏令时）。
    // #region pricing
    var BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000
    var PEAK_WINDOWS = [[9 * 60, 12 * 60], [14 * 60, 18 * 60]]

    // 中国法定节假日（国务院办公厅放假通知，日期均为北京时间）。
    // 周末本身已算低谷，这里只需列出放假区间；调休上班的周末仍按周末算低谷。
    // 每年新通知发布后在此追加即可；未覆盖的年份只按「工作日 + 时段」判断。
    var HOLIDAY_RANGES = [
      // 2026
      ['2026-01-01', '2026-01-03'],
      ['2026-02-15', '2026-02-23'],
      ['2026-04-04', '2026-04-06'],
      ['2026-05-01', '2026-05-05'],
      ['2026-06-19', '2026-06-21'],
      ['2026-09-25', '2026-09-27'],
      ['2026-10-01', '2026-10-07'],
      // 2027
      ['2027-01-01', '2027-01-03'],
      ['2027-02-05', '2027-02-13'],
      ['2027-04-03', '2027-04-05'],
      ['2027-05-01', '2027-05-05'],
      ['2027-06-09', '2027-06-09'],
      ['2027-09-15', '2027-09-15'],
      ['2027-10-01', '2027-10-07'],
    ]

    var HOLIDAYS = (function () {
      var set = Object.create(null)
      for (var i = 0; i < HOLIDAY_RANGES.length; i++) {
        var from = Date.parse(HOLIDAY_RANGES[i][0] + 'T00:00:00Z')
        var to = Date.parse(HOLIDAY_RANGES[i][1] + 'T00:00:00Z')
        for (var t = from; t <= to; t += 86400000) {
          set[new Date(t).toISOString().slice(0, 10)] = true
        }
      }
      return set
    })()

    function pad2(n) { return n < 10 ? '0' + n : String(n) }

    // 把任意时间换算成北京时间字段。
    function beijingParts(ms) {
      var d = new Date(ms + BEIJING_OFFSET_MS)
      var month = d.getUTCMonth() + 1
      var day = d.getUTCDate()
      return {
        y: d.getUTCFullYear(),
        mo: month,
        day: day,
        dow: d.getUTCDay(),
        minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
        key: d.getUTCFullYear() + '-' + pad2(month) + '-' + pad2(day),
      }
    }

    // 某一时刻适用的计费时段。
    function pricePeriodAt(ms) {
      var p = beijingParts(ms)
      if (p.dow === 0 || p.dow === 6) return { peak: false, reason: 'weekend' }
      if (HOLIDAYS[p.key]) return { peak: false, reason: 'holiday' }
      for (var i = 0; i < PEAK_WINDOWS.length; i++) {
        if (p.minutes >= PEAK_WINDOWS[i][0] && p.minutes < PEAK_WINDOWS[i][1]) {
          return { peak: true, reason: 'peak' }
        }
      }
      return { peak: false, reason: 'off-hours' }
    }

    // 下一次峰谷切换时刻；最多向后找 16 天，足够跨过最长假期。
    function nextPriceSwitch(nowMs) {
      var now = beijingParts(nowMs)
      var dayStart = Date.UTC(now.y, now.mo - 1, now.day) - BEIJING_OFFSET_MS
      var currentPeak = pricePeriodAt(nowMs).peak
      for (var d = 0; d < 16; d++) {
        for (var w = 0; w < PEAK_WINDOWS.length; w++) {
          for (var k = 0; k < 2; k++) {
            var at = dayStart + d * 86400000 + PEAK_WINDOWS[w][k] * 60000
            if (at <= nowMs) continue
            if (pricePeriodAt(at).peak !== currentPeak) return at
          }
        }
      }
      return null
    }

    function formatClock(ms) {
      var p = beijingParts(ms)
      return pad2(Math.floor(p.minutes / 60)) + ':' + pad2(p.minutes % 60)
    }

    // 切换点的友好时间：今天 / 明天 / M月D日。
    function formatSwitchTime(at, nowMs) {
      var a = beijingParts(at)
      var n = beijingParts(nowMs)
      var dayDiff = Math.round((Date.UTC(a.y, a.mo - 1, a.day) - Date.UTC(n.y, n.mo - 1, n.day)) / 86400000)
      if (dayDiff === 0) return '今天 ' + formatClock(at)
      if (dayDiff === 1) return '明天 ' + formatClock(at)
      return a.mo + '月' + a.day + '日 ' + formatClock(at)
    }

    function formatDuration(ms) {
      var mins = Math.max(1, Math.ceil(ms / 60000))
      var h = Math.floor(mins / 60)
      var m = mins % 60
      if (h > 0 && m > 0) return h + ' 小时 ' + m + ' 分'
      if (h > 0) return h + ' 小时'
      return m + ' 分钟'
    }
    // #endregion pricing

    // 读取一次余额；任何失败都折成 { ok:false, reason } 形态，不抛错。
    function fetchBalance(force, provider) {
      var tz = new Date().getTimezoneOffset() * -60 // 换算成「东八区为 +28800」的秒偏移
      var locale = (navigator && navigator.language) || 'zh-CN'
      var pid = provider || DEFAULT_PROVIDER
      var url = API + '?locale=' + encodeURIComponent(locale) + '&tz=' + tz +
        '&provider=' + encodeURIComponent(pid) + (force ? '&force=1' : '')
      return fetch(url, { headers: { accept: 'application/json' } })
        .then(function (res) {
          return res.json().then(function (body) {
            if (!res.ok) return { ok: false, reason: 'http-' + res.status }
            return body && typeof body === 'object' ? body : { ok: false, reason: 'bad-body' }
          })
        })
        .catch(function () {
          return { ok: false, reason: 'network' }
        })
    }

    // 余额胶囊本体。
    function BalanceBadge(props) {
      props = props || {}
      var sessionId = props.sessionId
      // 兜底：少数 slot 场景拿不到 sessionId 时，取当前主会话。
      if (!sessionId && clientCtx && typeof clientCtx.get === 'function') {
        var uiSession = clientCtx.get('uiSession')
        if (uiSession && uiSession.current && typeof uiSession.current.getSnapshot === 'function') {
          var currentBinding = uiSession.current.getSnapshot()
          if (currentBinding && currentBinding.props && typeof currentBinding.props.sessionId === 'string') {
            sessionId = currentBinding.props.sessionId
          }
        }
      }
      // 会话级 slot 会注入 sessionId；据此读取当前会话的模型选择。
      var directory = null
      if (sessionId && clientCtx && typeof clientCtx.get === 'function') {
        var modelDirectories = clientCtx.get('modelDirectories')
        if (modelDirectories && typeof modelDirectories.directoryFor === 'function') {
          try {
            directory = modelDirectories.directoryFor(sessionId)
          } catch (error) {
            directory = null
          }
        }
      }
      var directoryState = useSnapshotStore(directory ? directory.store : null)
      var selection = directoryState && directoryState.current ? directoryState.current : null
      var providerId = selection && typeof selection.provider === 'string' ? selection.provider : DEFAULT_PROVIDER

      // 未登录 / 未配置 / 不支持余额查询属于可解释的降级，不算错误。
      function phaseOf(data) {
        if (data.ok) return 'ready'
        if (data.reason === 'signed-out' || data.reason === 'not-available' ||
            data.reason === 'no-credential' || data.reason === 'unsupported-provider') {
          return 'empty'
        }
        return 'error'
      }

      var statePair = React.useState({ phase: 'loading', data: null })
      var state = statePair[0]
      var setState = statePair[1]
      var openPair = React.useState(false)
      var open = openPair[0]
      var setOpen = openPair[1]
      // 面板的 fixed 定位坐标（打开时按胶囊实测），以及胶囊自身的 DOM 引用。
      var coordPair = React.useState(null)
      var coords = coordPair[0]
      var setCoords = coordPair[1]
      var pillRef = React.useRef(null)
      // 峰谷时段指示灯要随时间自行走字：每 30 秒重算一次，跨过切换点无需等余额轮询。
      var nowPair = React.useState(Date.now())
      var nowMs = nowPair[0]
      var setNow = nowPair[1]

      React.useEffect(function () {
        var alive = true

        function load(force) {
          return fetchBalance(force, providerId).then(function (data) {
            if (!alive) return
            setState({ phase: phaseOf(data), data: data })
          })
        }

        // provider 变化时先清掉上一个账户的余额，避免短暂显示错账户的数字。
        setState({ phase: 'loading', data: null })
        load(true)
        var timer = setInterval(function () { load(false) }, POLL_MS)
        // 隐藏的标签页不必继续轮询；重新可见时立刻补一次。
        function onVisible() { if (!document.hidden) load(false) }
        document.addEventListener('visibilitychange', onVisible)

        return function () {
          alive = false
          clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [providerId])

      React.useEffect(function () {
        var timer = setInterval(function () { setNow(Date.now()) }, 30000)
        function onVisible() { if (!document.hidden) setNow(Date.now()) }
        document.addEventListener('visibilitychange', onVisible)
        return function () {
          clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [])

      var data = state.data || {}
      var totalWallets = data.ok && Array.isArray(data.totalWallets) && data.totalWallets.length > 0
        ? data.totalWallets
        : null
      var wallet = data.ok ? primaryWallet(totalWallets || data.wallets) : null
      var provider = data.provider && typeof data.provider === 'object'
        ? data.provider
        : { id: providerId, name: providerNameOf(providerId) }
      var providerLabel = provider.name || providerNameOf(provider.id || providerId)

      // 当前峰谷时段：纯本地时钟计算，不依赖余额查询结果。
      var price = pricePeriodAt(nowMs)
      var isPeak = price.peak
      var priceName = isPeak ? '高峰价' : '低谷价'
      var nextSwitchAt = nextPriceSwitch(nowMs)

      // 胶囊上的短文案。
      var label
      if (state.phase === 'loading') label = '余额 …'
      else if (state.phase === 'ready' && wallet) label = symbolOf(wallet.currency) + formatAmount(wallet.balance)
      else if (data.reason === 'signed-out') label = '余额未登录'
      else if (data.reason === 'no-credential') label = '余额未配置'
      else if (data.reason === 'not-available') label = '余额不可用'
      else if (data.reason === 'unsupported-provider') label = '余额不可用'
      else label = '余额 --'

      // 明细面板内容。
      var rows = []

      // 面板顶部：当前账户、峰谷时段与下次切换，始终展示。
      var priceRows = [
        React.createElement('div', { className: 'db-row', key: 'paccount' },
          React.createElement('span', { className: 'db-k' }, '账户'),
          React.createElement('span', { className: 'db-v db-account' }, providerLabel)
        ),
        React.createElement('div', { className: 'db-row', key: 'pnow' },
          React.createElement('span', { className: 'db-k' }, '当前计费'),
          React.createElement('span', { className: 'db-v db-price-val', 'data-price': isPeak ? 'peak' : 'offpeak' },
            priceName + (isPeak ? '（标准价）' : '（高峰价 5 折）'))
        ),
        React.createElement('div', { className: 'db-row', key: 'pnext' },
          React.createElement('span', { className: 'db-k' }, '下次切换'),
          nextSwitchAt
            ? React.createElement('span', { className: 'db-v db-switch' },
                React.createElement('span', { className: 'db-switch-when' },
                  formatSwitchTime(nextSwitchAt, nowMs) + ' 转' + (isPeak ? '低谷价' : '高峰价')),
                React.createElement('span', { className: 'db-switch-in' },
                  '还有 ' + formatDuration(nextSwitchAt - nowMs))
              )
            : React.createElement('span', { className: 'db-v' }, '—')
        ),
        React.createElement('div', { className: 'db-note', key: 'prule' },
          '高峰：北京时间工作日 9:00–12:00、14:00–18:00；周末及法定节假日全天低谷。'),
        data.available === false
          ? React.createElement('div', { className: 'db-note', key: 'pavail' }, '账户余额不足，API 调用可能失败。')
          : null,
      ]
      rows.push(React.createElement('div', { className: 'db-sec db-price-sec', key: 'price' }, priceRows))

      if (state.phase === 'ready') {
        if (totalWallets) {
          for (var t = 0; t < totalWallets.length; t++) {
            rows.push(React.createElement('div', { className: 'db-row', key: 't' + t },
              React.createElement('span', { className: 'db-k' }, totalWallets[t].currency === 'USD' ? '总余额 (USD)' : '总余额 (CNY)'),
              React.createElement('span', { className: 'db-v' }, symbolOf(totalWallets[t].currency) + formatAmount(totalWallets[t].balance))
            ))
          }
        }
        var wallets = Array.isArray(data.wallets) ? data.wallets : []
        for (var i = 0; i < wallets.length; i++) {
          rows.push(React.createElement('div', { className: 'db-row', key: 'w' + i },
            React.createElement('span', { className: 'db-k' }, wallets[i].currency === 'USD' ? '充值余额 (USD)' : '充值余额 (CNY)'),
            React.createElement('span', { className: 'db-v' }, symbolOf(wallets[i].currency) + formatAmount(wallets[i].balance))
          ))
        }
        var bonuses = Array.isArray(data.bonusWallets) ? data.bonusWallets : []
        if (bonuses.length > 0) {
          var bonusRows = []
          for (var j = 0; j < bonuses.length; j++) {
            bonusRows.push(React.createElement('div', { className: 'db-row', key: 'b' + j },
              React.createElement('span', { className: 'db-k' }, '赠送额度'),
              React.createElement('span', { className: 'db-v' }, symbolOf(bonuses[j].currency) + formatAmount(bonuses[j].balance))
            ))
          }
          rows.push(React.createElement('div', { className: 'db-sec', key: 'bonus' },
            React.createElement('div', { className: 'db-sec-t' }, '赠送额度'),
            bonusRows
          ))
        }
      } else if (state.phase === 'loading') {
        rows.push(React.createElement('div', { className: 'db-note', key: 'n' }, '正在读取余额…'))
      } else if (data.reason === 'no-credential') {
        rows.push(React.createElement('div', { className: 'db-note', key: 'n' },
          '当前模型使用 DeepSeek API Key，但没有配置 DEEPSEEK_API_KEY。请在「设置 → 模型 → DeepSeek」中填入 API 密钥。'))
      } else if (data.reason === 'unsupported-provider') {
        rows.push(React.createElement('div', { className: 'db-note', key: 'n' },
          '当前模型提供商「' + providerLabel + '」没有可查询的余额接口。余额胶囊目前支持 DeepSeek 账号和 DeepSeek API Key，第三方提供商暂不支持。'))
      } else if (data.reason === 'signed-out') {
        rows.push(React.createElement('div', { className: 'db-note', key: 'n' },
          '当前未登录 DeepSeek 账号。请在「设置 → 模型」中登录后即可看到实时余额。'))
      } else if (data.reason === 'not-available') {
        rows.push(React.createElement('div', { className: 'db-note', key: 'n' },
          '宿主未提供账户服务（deepseekAccount），余额暂时无法读取。'))
      } else {
        rows.push(React.createElement('div', { className: 'db-note', key: 'n' },
          '余额查询失败：' + String(data.reason || 'unknown') + (data.detail ? '（' + data.detail + '）' : '')))
      }

      // 平台下发的入口链接（用量明细 / 去充值）。
      var links = data.links || {}
      var linkNodes = []
      if (links.usageUrl) {
        linkNodes.push(React.createElement('a', { key: 'u', href: links.usageUrl, target: '_blank', rel: 'noreferrer noopener' }, '用量明细'))
      }
      if (links.topUpUrl) {
        linkNodes.push(React.createElement('a', { key: 't', href: links.topUpUrl, target: '_blank', rel: 'noreferrer noopener' }, '去充值'))
      }
      if (linkNodes.length > 0) {
        rows.push(React.createElement('div', { className: 'db-links', key: 'links' }, linkNodes))
      }

      var fetchedAt = data.fetchedAt ? new Date(data.fetchedAt) : null
      if (fetchedAt) {
        rows.push(React.createElement('div', { className: 'db-foot', key: 'foot' },
          '更新于 ' + fetchedAt.toLocaleTimeString() + ' · 每 ' + (POLL_MS / 1000) + ' 秒自动刷新'))
      }

      // 打开面板时顺手强制刷新一次，避免看到过期数字。
      function toggle() {
        var next = !open
        setOpen(next)
        if (!next) return
        // 按胶囊当前实测位置摆放 fixed 面板：优先贴在其正上方，空间不足则改到下方。
        var rect = pillRef.current ? pillRef.current.getBoundingClientRect() : null
        if (rect) {
          var panelWidth = 260
          var left = rect.right - panelWidth
          if (left < 8) left = 8
          var above = rect.top > 260
          setCoords({
            left: left + 'px',
            top: above ? 'auto' : (rect.bottom + 8) + 'px',
            bottom: above ? (window.innerHeight - rect.top + 8) + 'px' : 'auto',
          })
        }
        fetchBalance(true, providerId).then(function (d) {
          setState({ phase: phaseOf(d), data: d })
        })
      }

      // 悬停提示：把账户、颜色语义与下次切换一起说清楚。
      var title = providerLabel + ' · 当前' + priceName +
        (nextSwitchAt ? '，' + formatSwitchTime(nextSwitchAt, nowMs) + ' 转' + (isPeak ? '低谷价' : '高峰价') : '') +
        ' · 点击查看明细'

      return React.createElement('div', { className: 'db-wrap' },
        React.createElement('button', {
          type: 'button',
          className: 'db-pill',
          ref: pillRef,
          title: title,
          onClick: toggle,
        },
          React.createElement('span', {
            className: 'db-dot',
            'data-price': isPeak ? 'peak' : 'offpeak',
            'data-alert': state.phase === 'error' ? 'error' : undefined,
          }),
          React.createElement('span', { className: 'db-num' }, label),
          React.createElement('span', {
            className: 'db-tag',
            'data-price': isPeak ? 'peak' : 'offpeak',
          }, isPeak ? '高峰' : '低谷')
        ),
        open ? React.createElement('div', { className: 'db-panel', style: coords || undefined }, rows) : null
      )
    }

    // 插件入口：宿主在客户端运行时装配好 ctx 后调用。
    function apply(ctx) {
      clientCtx = ctx
      var disposers = []
      try {
        // 样式每次 apply 都刷新：热更新（HMR）只会重新执行 apply，若沿用旧 <style>
        // 节点，新 DOM 上新增的 data-price 选择器就不会生效（灯会退回灰色底色）。
        var styleEl = document.querySelector('style[data-dsh-balance-style]')
        if (!styleEl) {
          styleEl = document.createElement('style')
          styleEl.setAttribute('data-dsh-balance-style', '')
          document.head.appendChild(styleEl)
        }
        if (styleEl.textContent !== CSS) styleEl.textContent = CSS

        // slots 是硬依赖（见文件末尾的 inject）；优先走 ctx.slots 直取，
        // 取不到时退回 ctx.get 做一次带 undefined 检查的兜底。
        var slots = ctx.slots || ctx.get('slots')
        if (slots && typeof slots.inject === 'function' && typeof slots.register === 'function') {
          var dispose = slots.inject('conversation.input.right', function () {
            return slots.register(
              { name: 'conversation.input.right', id: 'dsh-balance', order: 50, label: function () { return '账户余额' } },
              BalanceBadge
            )
          })
          if (typeof dispose === 'function') disposers.push(dispose)
        } else {
          console.warn('[dsh-balance] slots 服务不可用，余额胶囊未挂载')
        }
      } catch (error) {
        console.warn('[dsh-balance] 挂载失败：', error)
      }

      ctx.effect(function () {
        return function () {
          for (var i = 0; i < disposers.length; i++) {
            try { disposers[i]() } catch (e) { /* 卸载期忽略 */ }
          }
          disposers.length = 0
        }
      }, 'dsh-balance: ui')
    }

    // 硬依赖：没有 slots 就没有可挂载的位置。
    var inject = ['slots']

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
