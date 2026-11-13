// dsh-balance — 宿主端（Host half）
//
// 职责：把「当前模型所属账户的余额」以只读 HTTP 接口暴露给浏览器端。
// 目前支持两条 DSH 内置的 DeepSeek 路由：
//   - deepseek-account   平台登录账号（通过 ctx.deepseekAccount）
//   - deepseek-official  API Key 路由（通过 ctx.credentials 解析 DEEPSEEK_API_KEY）
// 第三方 / 自定义 pi-ai 路由没有通用余额接口，返回 unsupported-provider。
//
// 设计要点：
//   1. 只读接口，不做任何写操作，也绝不返回任何凭证 / token。
//   2. 按 provider 分别缓存：浏览器端轮询不会放大到上游接口。
//   3. 单飞（single-flight）：同一 provider 的并发请求共用一次查询。
//   4. 一切失败都归一化成 { ok: false, reason } 的常规值，不向客户端抛错。

export const name = 'dsh-balance'

// webServer 是硬依赖（没有它就没有接口可注册）；
// deepseekAccount / credentials 走可选获取，缺失时接口降级返回 not-available。
export const inject = ['webServer']

/** 浏览器端轮询的固定只读路由。 */
const ROUTE = '/api/dsh-balance'

/** 缓存有效期：15 秒内重复轮询直接命中缓存。 */
const CACHE_TTL_MS = 15_000

/** 平台账号查询超时。 */
const UPSTREAM_TIMEOUT_MS = 10_000

/** API Key 余额查询超时。 */
const API_BALANCE_TIMEOUT_MS = 10_000

/** DSH 里两个内置的 DeepSeek 模型路由 id。 */
const PROVIDER_ACCOUNT = 'deepseek-account'
const PROVIDER_API_KEY = 'deepseek-official'
const DEFAULT_PROVIDER = PROVIDER_ACCOUNT

/** API Key 路由默认使用的凭据引用。 */
const API_KEY_REF = 'DEEPSEEK_API_KEY'

/** DeepSeek 官方 API Key 余额接口。 */
const API_BALANCE_URL = 'https://api.deepseek.com/user/balance'

/** 返回给客户端的账户显示名；绝不包含密钥。 */
const PROVIDERS = {
  [PROVIDER_ACCOUNT]: { id: PROVIDER_ACCOUNT, name: 'DeepSeek 账号' },
  [PROVIDER_API_KEY]: { id: PROVIDER_API_KEY, name: 'DeepSeek API Key' },
}

/** 与 package.json 对齐，供平台客户端请求头使用。 */
const CLIENT_VERSION = '0.3.0'

/** API Key 账户与平台账户共用同一组平台入口。 */
const PLATFORM_LINKS = {
  usageUrl: 'https://platform.deepseek.com/usage',
  topUpUrl: 'https://platform.deepseek.com/top_up',
}

function providerInfo(provider) {
  return PROVIDERS[provider] ?? { id: provider, name: provider }
}

// 统一的 JSON 响应写出。
function writeJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    // 余额属于私密信息，禁止被当作 referrer 外泄，也禁止任何缓存层留存。
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

// 只允许本机回环地址访问：余额接口不需要对外可达。
function isLoopbackRequest(req) {
  const address = req.socket?.remoteAddress ?? ''
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1' ||
    address.startsWith('127.')
  )
}

// 从查询串里取一个字符串参数；缺失或类型不对时回退到默认值。
function queryParam(url, key, fallback) {
  try {
    const value = url.searchParams.get(key)
    return typeof value === 'string' && value !== '' ? value : fallback
  } catch {
    return fallback
  }
}

export function apply(ctx) {
  // 缓存与单飞状态都属于本插件实例，随插件卸载一起消失。
  const cached = new Map() // provider -> { at, value }
  const inflight = new Map() // provider -> Promise<object>

  // 平台登录账号：沿用原来的 deepseekAccount 路径。
  async function queryAccountBalance(client) {
    const account = ctx.get('deepseekAccount')
    if (!account || typeof account.getBalance !== 'function') {
      return { ok: false, reason: 'not-available' }
    }

    // 先看账户状态：未登录时不必发起平台查询，也顺带拿到用量/充值入口链接。
    let state
    try {
      state = await account.getState()
    } catch {
      state = undefined
    }
    const links = state && state.links ? state.links : undefined

    if (state && state.status === 'signed-out') {
      return { ok: false, reason: 'signed-out', links }
    }

    // 平台查询本身可能抛错（网络、凭证过期等），超时保护一并加在这里。
    let balance
    try {
      balance = await withTimeout(account.getBalance(client), UPSTREAM_TIMEOUT_MS)
    } catch (error) {
      return { ok: false, reason: 'query-failed', detail: String(error?.message ?? error), links }
    }

    // 凭证在查询途中失效时会得到 null。
    if (!balance) return { ok: false, reason: 'signed-out', links }
    if (balance.status !== 'ready') {
      return { ok: false, reason: 'query-failed', links }
    }

    return {
      ok: true,
      wallets: Array.isArray(balance.value) ? balance.value : [],
      bonusWallets: Array.isArray(balance.bonusWallets) ? balance.bonusWallets : [],
      links,
    }
  }

  // API Key 路由：用 credentials 里的 DEEPSEEK_API_KEY 调官方 /user/balance。
  // 密钥只在宿主侧读取，既不写日志也不进响应。
  async function queryApiKeyBalance() {
    if (typeof fetch !== 'function') {
      return { ok: false, reason: 'not-available', detail: 'fetch-unavailable' }
    }

    const credentials = ctx.get('credentials')
    if (!credentials || typeof credentials.resolve !== 'function') {
      return { ok: false, reason: 'not-available', detail: 'credentials-service-missing' }
    }

    let hit
    try {
      hit = await credentials.resolve(API_KEY_REF)
    } catch {
      return { ok: false, reason: 'no-credential', detail: 'credential-read-failed' }
    }
    const apiKey = hit && typeof hit.value === 'string' ? hit.value.trim() : ''
    if (apiKey === '') return { ok: false, reason: 'no-credential' }

    let response
    try {
      response = await fetchWithTimeout(
        API_BALANCE_URL,
        {
          method: 'GET',
          headers: {
            authorization: `Bearer ${apiKey}`,
            accept: 'application/json',
          },
        },
        API_BALANCE_TIMEOUT_MS,
      )
    } catch (error) {
      return {
        ok: false,
        reason: 'query-failed',
        detail: error?.name === 'AbortError' ? 'timeout' : 'network',
      }
    }

    if (!response.ok) {
      return {
        ok: false,
        // 401/403 表示密钥无效或没有余额权限，和“未配置”区分开，
        // 但客户端统一提示去检查 API Key 即可。
        reason: response.status === 401 || response.status === 403 ? 'no-credential' : 'query-failed',
        detail: `http-${response.status}`,
      }
    }

    let body
    try {
      body = await response.json()
    } catch {
      body = null
    }
    if (!body || !Array.isArray(body.balance_infos)) {
      return { ok: false, reason: 'query-failed', detail: 'bad-body' }
    }

    return {
      ok: true,
      ...normalizeApiBalance(body),
      links: PLATFORM_LINKS,
    }
  }

  // 只按白名单分派：客户端只能传 provider id，不能传 URL / 凭据引用。
  async function queryBalance(provider, client) {
    if (provider === PROVIDER_API_KEY) return queryApiKeyBalance()
    if (provider === PROVIDER_ACCOUNT) return queryAccountBalance(client)
    return { ok: false, reason: 'unsupported-provider' }
  }

  // 带缓存 + 单飞的对外读数入口；缓存按 provider 隔离。
  async function readBalance(provider, client, force) {
    const now = Date.now()
    const hit = cached.get(provider)
    if (!force && hit && now - hit.at < CACHE_TTL_MS) {
      return { ...hit.value, cached: true }
    }
    const pending = inflight.get(provider)
    if (pending) return pending

    const task = (async () => {
      try {
        const value = await queryBalance(provider, client)
        const enriched = { ...value, provider: providerInfo(provider) }
        cached.set(provider, { at: Date.now(), value: enriched })
        return { ...enriched, cached: false }
      } finally {
        inflight.delete(provider)
      }
    })()
    inflight.set(provider, task)
    return task
  }

  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'exact',
      path: ROUTE,
      handler: async (req, res) => {
        if (req.method !== 'GET') {
          writeJson(res, 405, { error: `method not allowed: ${req.method}` })
          return
        }
        if (!isLoopbackRequest(req)) {
          writeJson(res, 403, { error: 'forbidden: loopback-only' })
          return
        }

        // 客户端把当前模型所属 provider、语言和时区带上来。
        const url = new URL(req.url ?? ROUTE, 'http://localhost')
        const client = {
          version: CLIENT_VERSION,
          locale: queryParam(url, 'locale', 'zh-CN'),
          timezoneOffsetSeconds: Number(queryParam(url, 'tz', '480')) || 0,
        }
        // 限制长度并只回显 id；未知 provider 会得到 unsupported-provider。
        const provider = queryParam(url, 'provider', DEFAULT_PROVIDER).slice(0, 64)
        const force = queryParam(url, 'force', '') === '1'

        try {
          const value = await readBalance(provider, client, force)
          writeJson(res, 200, { ...value, fetchedAt: Date.now() })
        } catch (error) {
          // 兜底：readBalance 理论上不抛，这里保证接口永远给出结构化结果。
          writeJson(res, 200, {
            ok: false,
            reason: 'internal',
            detail: String(error?.message ?? error),
            provider: providerInfo(provider),
            fetchedAt: Date.now(),
          })
        }
      },
    })
    return dispose
  })
}

// 把 DeepSeek /user/balance 的响应归一化成客户端使用的钱包数组。
// 金额保持十进制字符串，交给客户端格式化；未知币种按 CNY 处理。
export function normalizeApiBalance(body) {
  const wallets = []
  const bonusWallets = []
  const totalWallets = []
  const infos = body && Array.isArray(body.balance_infos) ? body.balance_infos : []
  for (const info of infos) {
    if (!info || typeof info !== 'object') continue
    const currency = info.currency === 'USD' ? 'USD' : 'CNY'
    // 总余额给胶囊展示；充值/赠送金额给面板拆分。
    if (info.topped_up_balance != null) {
      wallets.push({ currency, balance: String(info.topped_up_balance) })
    }
    if (info.granted_balance != null) {
      bonusWallets.push({ currency, balance: String(info.granted_balance) })
    }
    if (info.total_balance != null) {
      totalWallets.push({ currency, balance: String(info.total_balance) })
    }
  }
  return {
    wallets,
    bonusWallets,
    totalWallets,
    available: body?.is_available !== false,
  }
}

// 给上游查询加一个超时；超时后放弃等待（不中断上游，只是不再阻塞本次响应）。
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)
      // Node 定时器不应阻止进程退出。
      if (typeof timer.unref === 'function') timer.unref()
    }),
  ])
}

// 带 abort 的 fetch：API Key 查询卡住时会真正取消连接。
async function fetchWithTimeout(url, options, ms) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  if (typeof timer.unref === 'function') timer.unref()
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}
