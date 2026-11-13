# Changelog

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## 0.3.0

- 余额胶囊跟随当前会话选中的模型 provider：支持 `deepseek-account`（平台登录账号）和
  `deepseek-official`（`DEEPSEEK_API_KEY` 对应的 API Key 账户）。
- 新增 DeepSeek 官方 `/user/balance` 查询；密钥只在宿主侧读取，按 provider 隔离缓存与单飞。
- 面板新增「账户」行，API Key 账户展示总余额 / 充值余额 / 赠送额度拆分。
- 未配置 API Key、provider 不支持余额接口时给出明确提示；第三方 provider 暂不支持。
- 新增 `test/host-balance.test.mjs`，覆盖 `/user/balance` 字段映射与异常响应。

## 0.2.0

- 在输入框工具行显示 DeepSeek 账户余额与峰谷计费状态灯：绿色 = 低谷价，琥珀 = 高峰价。
- 按北京时间工作日 9:00–12:00、14:00–18:00 判定高峰；周末、调休上班的周末、法定节假日全天为低谷。
- 明细面板展示当前计费、下次切换时间与倒计时；余额查询失败时状态灯保留峰谷底色并加红色描边。
- 判定固定按 UTC+8，不依赖浏览器时区；内置 2026、2027 年法定节假日表。
- 新增 `test/pricing.test.mjs`（`npm test`），覆盖窗口边界、周末、节假日与跨假期切换点。
- 样式每次 `apply` 刷新，修复热更新后状态灯退回灰色的问题。
