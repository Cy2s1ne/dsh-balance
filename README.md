# @cy2s1ne/dsh-balance

DSH 插件：在**输入框工具行（模型选择器旁）**实时显示 DeepSeek 账户余额与当前峰谷计费时段。

## 功能

- 胶囊上显示主钱包余额（人民币优先），左侧状态灯显示当前 **DeepSeek 峰谷计费时段**：
  绿色 = 低谷价，琥珀 = 高峰价；胶囊内另有「低谷 / 高峰」文字标签。
- 点击展开明细面板：
  - 当前计费时段、下次切换时间与倒计时
  - 充值余额（各币种）
  - 赠送额度（若平台有下发）
  - 用量明细 / 去充值 入口
  - 最近更新时间
- 每 20 秒自动刷新；标签页重新可见时立即补一次；打开面板时强制刷新。
- 未登录、服务缺失、查询失败都会降级成可读提示，不会让输入框报错。

## 峰谷时段指示灯

状态灯显示的是 **DeepSeek 当前计费时段**，不是余额查询状态：

| 颜色 | 含义 |
| --- | --- |
| 绿色 | 低谷价（高峰价的 5 折） |
| 琥珀 | 高峰价（标准价） |

判定规则（2026-08-17 起生效，见
[DeepSeek 官方价目表](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)）：

- **高峰**：北京时间周一至周五（不含中国法定节假日）9:00–12:00、14:00–18:00；
- **低谷**：其余全部时段——含周末、调休上班的周末、法定节假日全天；
- 低谷价 = 高峰价的一半。

时区固定按 UTC+8 计算，不随浏览器时区变化。节假日表内置在 `client.js` 的
`HOLIDAY_RANGES` 中（已覆盖 2026–2027，来源为国务院办公厅
[2026 年](https://www.gov.cn/zhengce/content/202511/content_7047090.htm) /
[2027 年](https://www.gov.cn/zhengce/content/202611/content_7085101.htm) 放假通知），每年新通知
发布后追加即可；未覆盖的年份只按「工作日 + 时段」判断，周末仍然正确。

悬停胶囊或展开面板可看到当前时段、下次切换时间和倒计时。余额查询失败时，状态灯外圈会出现
红色描边，峰谷底色仍保留，因此两个信号不会互相盖掉。

## 数据来源

浏览器端不直接访问平台接口 —— 账户凭证只在宿主侧可见。链路是：

```
浏览器余额胶囊
  └─ GET /api/dsh-balance        （本插件宿主端注册的只读路由，仅回环可访问）
       └─ ctx.deepseekAccount.getState() / getBalance()
            └─ DeepSeek 平台账户接口
```

宿主端带 15 秒缓存与单飞合并，避免浏览器轮询被放大到平台接口上；上游查询另有 10 秒超时保护。

## 前置条件（重要）

本插件读取的是 **DSH 内置 `deepseekAccount` 服务**的账户数据，因此要求：

> 已在 DSH 中**登录 DeepSeek 账号**（平台会话）。

只配置了 `DEEPSEEK_API_KEY`、但没有在 DSH 里登录账号的用户，胶囊会显示「余额未登录」——
这是预期行为，不是故障。

## 安装

### 从 GitHub 安装（推荐）

```sh
dsh plugin --profile <你的profile名> add github:Cy2s1ne/dsh-balance
```

### 从 npm 安装

```sh
dsh plugin --profile <你的profile名> add @cy2s1ne/dsh-balance
```

### 本地源码安装（开发用）

`link:` 会把目录软链进 profile，源码改动立即生效：

```sh
dsh plugin --profile <你的profile名> add link:/绝对路径/dsh-balance
```

安装后刷新一次浏览器页面即可看到胶囊。

## 卸载

```sh
dsh plugin --profile <你的profile名> remove @cy2s1ne/dsh-balance
```

## 开发与测试

```sh
npm test
```

峰谷判定是纯时钟逻辑，测试直接从 `client.js` 的 pricing region 提取后验证工作日、周末、
节假日边界与下次切换点，不依赖浏览器或余额接口。

## 说明

- 接口为只读，不写任何配置；响应中不含任何 token / 凭证。
- 仅接受来自回环地址（127.0.0.1 / ::1）的请求。
- 该路由未走 DSH 的令牌鉴权，仅靠回环限制——与既有同类插件（如 dsh-mcp-manager）姿态一致。
  若要收紧，可改为经 `ctx.connection.authenticatedUrl` 访问。
- 余额查询属于外部网络请求，首次加载可能有短暂延迟，胶囊会先显示「余额 …」。

## 许可

MIT。原始版权声明与修改声明见 [LICENSE](LICENSE)。
