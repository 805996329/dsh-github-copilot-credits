# DSH GitHub Copilot Credits

给 DeepSeek Harness 0.2.0-rc.2 的会话编辑器添加 GitHub Copilot 月度用量条目，位于底部“上下文使用情况”的右边。**不会替代现有 stats 项。**

## 安装

三步，无需构建（包内已含 Host 与预构建的 `lib/client.js`）：

1. **先登录 GitHub Copilot**：在同一个 DSH profile 里，通过内建 `llm-pi-ai` 的 `github-copilot` 提供商完成登录，凭据记录键为 `llm-pi-ai/github-copilot`。
   没有登录的话，本插件会显示“尚未在 DSH 登录 GitHub Copilot”，而不是报错。
   （本项目另有配套插件 `dsh-github-copilot-signin`，可在会话里直接完成该登录。）

2. **安装 bundle**，二选一：

   - **界面**：侧边栏 → **Plugins** → **Add plugin** → 粘贴下面的地址 → **Install** → **Enable now**；
   - **命令行**：

   ```powershell
   # 从 GitHub 仓库安装
   dsh plugin --profile desktop add 'github:805996329/dsh-github-copilot-credits'
   ```

   也可用 git 完整地址 `git+https://github.com/805996329/dsh-github-copilot-credits.git`，
   或本地目录 / `.tgz` 的**绝对路径**。

   > **安装源（registry）不需要切换。** 对话框里的「npm 官方源 / 中国大陆镜像源 / 自定义地址」决定的是 **npm 依赖**从哪下载，而本插件运行时依赖为零、peer 依赖由 DSH 运行时提供，所以三个选项选哪个结果都一样。
   >
   > 反过来也要清楚：**国内镜像不代理 GitHub 仓库。** 如果提示无法访问 GitHub，切到「npm 官方源」也不会变好——两者都是 npm 源，都不是插件来源。

3. **刷新当前 DSH 页面**。装好后用量条目出现在编辑器底部右侧。

### 安装时提示「GitHub 连接超时」

安装前 DSH 会对 GitHub 地址做一次连通性预检（`git ls-remote`），**默认只给 5 秒**；超时就整体中止，pnpm 不会开始下载。提示是「超时」而不是「网络失败」，通常说明是慢，而不是完全不通。

- **放宽这个超时**（可配置，最小 1000 ms），写进 profile 的 `cordis.patch.yml`：

  ```yaml
  - id: plugin-manager
    name: "@deepseek-ai/dsh-plugin-manager"
    config:
      githubConnectionTimeoutMs: 30000
  ```

- **或完全绕开 GitHub**：把仓库打包成 `.tgz` 发给对方，用**绝对路径**安装。`.tgz` 走的是另一条分支，不做那次预检：

  ```powershell
  dsh plugin --profile desktop add 'D:\Downloads\dsh-github-copilot-credits-0.1.0.tgz'
  ```

  本地路径必须是绝对路径（`D:\…`、`C:\…`），不能用 `~` 或相对路径；这种装法会把**该文件的绝对路径**记进 profile，装完不要删除或移动那个 `.tgz`。

> **本地开发时**才用目录路径安装，例如
> `dsh plugin --profile desktop add 'D:\path\to\dsh-github-copilot-credits'`。
> 源文件改动不会自动反映到页面：本机没有运行 `pnpm run dev:web` 监听器时，必须重新装载客户端模块并刷新页面。

卸载：插件管理界面移除该 bundle，或 `dsh plugin --profile desktop remove dsh-github-copilot-credits`。

## 显示什么

- 在“上下文使用情况”**右侧**显示闪电图标、`剩余 / 总额度` 和小型已消耗进度条。点击用量条打开上方详情：套餐、本月已用、剩余、总额度、UTC 重置日和更新时间；弹层底部有**独立的“刷新”按钮**。展开弹层本身不触发刷新。
- GitHub 的 `token_based_billing` 为 `false` 时标记为「旧版请求」，未提供该标志时标记为「配额」，不会误称 Credits。
- 仅有组织共享额度时，如 GitHub 返回 `unlimited: true`、`entitlement: 0`，个人剩余和个人总额显示**不可用**；如果 GitHub提供 `credits_used`，仍显示已用估计值。
- 首次读取后每 120 秒自动查询；Host 正常结果缓存 90 秒。弹层“刷新”会主动跳过该缓存并查询最新快照；GitHub 返回限流时遵守它的冷却时间。读取失败不返回任何原始 GitHub 响应。

**精度声明：** 这是 GitHub 尚未公开支持的只读 `copilot_internal/user` 配额快照；整数配额可能舍入。若 GitHub 返回 `credits_used`，详情优先显示这个**已用**数字；否则由「总额−剩余」估算。两者可能因额度调整等原因不同（示例图的 `789 + 28,811 ≠ 30,000`），因此用量条按额度余额变化计算，不应强行把三项改成加总一致。它们均不等于官方精确账单或费用。GitHub 随时可能修改接口；没有可用数据时插件会明确显示不可用，绝不会把缺失配额当成 0。

## 兼容性

- 运行环境要求：DSH `0.2.0-rc.2`。`peerDependencies` 已精确钉住该版本；DSH 在安装前会做一次 semver 校验，版本不符会被拒绝并给出 `dsh plugin allow-version` 的显式豁免命令。
- 已在 `0.2.0-rc.2` 上做过端到端验证：在真实运行中的 DSH 里，通过受鉴权的 `/api/copilot-credits` 路由取回真实配额，且响应体不含任何凭据或账号标识。

## 数据来源及安全性

Host 端使用现有 pi-ai 记录中的 `payload.refresh`（GitHub OAuth 授权，不是 `payload.access` 的短期模型代理令牌），只对固定的 `https://api.github.com/copilot_internal/user` 发起只读 GET。浏览器通过 DSH `connection.fetch` 注册的、已受 Host/Origin 和会话 cookie 校验的 `/api/copilot-credits` 路由读取**经过白名单归一化**的数字。不会把 OAuth 令牌、GitHub 原始 JSON、错误正文或账户标识送入浏览器，不记录密钥。此功能不使用官方的按月结算 REST API：该 API 需要单独的 classic PAT、不能提供余额，且不包括由组织付费的席位。

相关说明：[DSH Client module 约定](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/client/modules/README.md#L32-L50)、[DSH 连接认证](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/client/connection/README.md#L32-L47)、[GitHub Copilot 个人账单](https://docs.github.com/en/copilot/concepts/billing-and-usage/individuals/billing)、[GitHub 官方账单 REST API](https://docs.github.com/en/rest/billing/usage)、[GitHub 配额响应的实例](https://cirriustech.co.uk/blog/github-ai-credits-first-morning/)。

## 自测

在本目录运行 `node --test`。测试全部使用模拟的本地记录和 GitHub 响应，不读取真实登录信息，也不对外请求。
