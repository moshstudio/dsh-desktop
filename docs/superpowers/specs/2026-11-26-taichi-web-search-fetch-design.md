# 太极网关网页搜索与获取设计

日期：2026-11-26  
状态：已批准（对话确认方案 1、登录后默认、尊重用户手动选择）

## 背景

「网页搜索与获取」来自上游 Harness，不是 Desktop 自研插件。当前并存：

| 能力 | 提供方 | 默认 |
| --- | --- | --- |
| 搜索 | `deepseek-official`、`deepseek-search-api` | 未配置时按模型路由偏好选择 |
| 获取 | `http`、`deepseek-fetch-api` | 部署层钉死 `fetchProvider: http` |

taichi-gateway 已提供与 DeepSeek 相同形状的 `/v1/tools/search` 与 `/v1/tools/fetch`。Desktop 已有企业登录与 `TAICHI_GATEWAY_*` 注入，但未把网页搜索/获取接到网关。用户要求：登录后可直接使用网关搜索与获取，同时保留现有提供方。

## 目标

1. 登录太极账号后，搜索与获取默认走 taichi-gateway。
2. 保留 DeepSeek Messages 搜索、DeepSeek Search/Fetch API、本机 HTTP 获取，设置页可继续选用。
3. 用户一旦手动改过选择，之后登录不再覆盖；登出时仅撤回仍由桌面托管的太极默认。

## 非目标

- 不改上游 `dsh-web` 选择算法，不给上游设置页加专用卡片。
- 不把现有 `deepseek-*-api` 的 `*BaseURL` 改到太极（会占用官方 id）。
- 不在请求失败后自动切换到其它提供方。
- 不在本轮做真实网关联调验收以外的运维改造。

## 方案选择

采用**独立太极提供方 + 主进程托管默认值**：

- 新增宿主插件注册新 id，官方 DeepSeek 与本机 HTTP 保持原样。
- 默认值写入当前 Profile 的 `cordis.patch.yml` 中 `web` 条目的 `searchProvider` / `fetchProvider`，不写进 `desktop-product.patch.yml`（产品补丁优先级高于设置页，写在那里用户无法改回）。

否决：

- 改写 `web-deepseek-api` 端点：会挤掉 DeepSeek 直连。
- 给 `dsh-web` 打选择补丁：升级易碎，且违反「产品能力放插件」约定。

## 架构

### 组件

| 组件 | 职责 |
| --- | --- |
| `packages/dsh-taichi-web` | Host 插件，向 `ctx.web` 注册 `taichi-search` / `taichi-fetch` |
| `src/main/shell/product-patch.ts` | 普通 Profile 与 Safe Mode 均挂载该插件 |
| `src/main/enterprise` 纯函数（扩展 `provider-config` 或同级模块） | 读写 Profile 默认值与托管标记 |
| `DesktopAccountService` | `publish()` 后 ensure 默认；`logout()` 后 clear 默认 |

### 提供方契约

| 提供方 id | 方法 | 端点 |
| --- | --- | --- |
| `taichi-search` | `POST` | `${TAICHI_GATEWAY_URL}/v1/tools/search` |
| `taichi-fetch` | `POST` | `${TAICHI_GATEWAY_URL}/v1/tools/fetch` |

- 鉴权：`Authorization: Bearer ${TAICHI_GATEWAY_ACCESS_TOKEN}`。
- 搜索 body 与 DeepSeek 一致：`{ query, count, need_content: false, ori_question? }`；`count` 取插件配置与 `request.maxResults` 的较小值。
- 获取 body：`{ url }`。
- 搜索响应：`results[]` 映射为 `WebSearchResult.sources`（字段校验同 DeepSeek：`url`/`title`/`snippet`/`summary?`/`date`）。
- 获取响应：`content` 字符串映射为 `{ url: request.url, statusCode: 200, body: { kind: 'text', content }, truncated: false }`。
- `available()` / `ready()`：网关 URL 与 access token 均非空才为真；不发起网络请求。错 token 仍算 ready，失败在执行时报错。
- 传输：`redirect: 'error'`；取消映射为 `WEB_ABORTED`。
- `title`：中文「太极」、英文「Taichi」。
- `description`：说明走登录账号积分、需已登录、不能访问内网和本机（中英至少齐全）。

插件 `inject: ['web']`，无客户端半侧。可选 volatile 配置：`count`（默认 10）、`searchRequestsPerSecond`（默认 5），行为对齐 DeepSeek Search API 的限速语义。

### 挂载

在 `DESKTOP_PRODUCT_PATCH_BASE`（因而也在 Safe Mode）挂载：

```yaml
- id: dsh-taichi-web
  name: dsh-taichi-web
```

Safe Mode 保留账号插件；网页能力跟随同一登录态。

### 默认值托管

设置页把「选回部署默认」实现成删除 Profile 覆盖，而不是写入另一个 id。获取的部署默认是 `http`，搜索的部署默认是未指定。因此仅看 Profile 是否缺少字段，无法区分「从未改过」与「用户改回了本机 HTTP / 搜索自动」。

在 Profile 目录旁维护桌面标记文件 `taichi-web-defaults.json`（与 `cordis.patch.yml` 同级），每个能力三种状态：

| 状态 | 含义 |
| --- | --- |
| `unset` | 尚未由桌面托管；登录时可写入太极 |
| `desktop` | 当前 Profile 值由桌面写入的太极默认 |
| `user` | 用户已明确选择（含改回部署默认后删除覆盖） |

规则：

1. **登录 / `publish()` 成功后 ensure**  
   - 若对应能力的环境变量 `DSH_WEB_SEARCH_PROVIDER` / `DSH_WEB_FETCH_PROVIDER` 已设置：不托管该能力。  
   - 若标记为 `user`：不改 Profile。  
   - 若标记为 `unset`，且 Profile 用户层没有该字段，或字段值已是对应太极 id：写入太极 id，标记改为 `desktop`。  
   - 若标记为 `unset`，但 Profile 用户层已有其它提供方 id：标记改为 `user`，不覆盖该选择（覆盖功能上线前的手动配置）。  
   - 若标记为 `desktop`，且 Profile 仍是太极 id：保持。  
   - 若标记为 `desktop`，但字段已删除或改成其它 id：改为 `user`，不再覆盖。  
   - 标记文件不存在时按各能力 `unset` 处理。

2. **登出 clear**  
   - 若 Profile 仍是太极 id：删除该字段，标记收回 `unset`。  
   - 若已是其它 id，或覆盖已被删除：标记为 `user`（或保持 `user`），不改 Profile 其它内容。

3. 只改 `web` 条目的 `searchProvider` / `fetchProvider`；原子写盘。YAML 解析失败则跳过本次托管并打日志，不阻断登录/登出。

4. Token 仍在下次启动 Host 时注入；已在跑的会话需重启后，搜索/获取才会改走太极。用户在设置页改选提供方：沿用现有配置保存，立即生效，不额外要求重启。

标记文件不含 token 或其它密钥。

## 错误处理

| 情况 | 行为 |
| --- | --- |
| 缺 URL 或 token | 提供方不可用；若当前选中太极，工具侧按现有 `searchReady` / `fetchReady` 不暴露工具 |
| HTTP 401 | `WEB_PROVIDER_ERROR`，引导重新登录太极；不要求改端点 |
| HTTP 402 | `WEB_PROVIDER_ERROR`，提示积分不足 |
| 其它 4xx/5xx、网络失败、响应形状不对 | `WEB_PROVIDER_ERROR`，带状态与简短原因；不把完整响应正文塞进模型可见文案 |
| 调用方取消 | `WEB_ABORTED` |

## 设置页

不新增专用 UI。现有「网页搜索与获取」通过 `web/listProviders` 自动列出 `taichi-search` / `taichi-fetch`。选中时上游页面 `kind` 为 `plugin`，不显示 DeepSeek 计费菜单。

## 数据流

```text
登录成功
  → AccountService.remember / publish（模型配置等）
  → ensureTaichiWebDefaults(profileDir)
  → 需要时 needsRestart（既有语义）

Host 启动
  → prepareHost 注入 TAICHI_GATEWAY_URL / ACCESS_TOKEN
  → dsh-taichi-web 注册提供方
  → 若 Profile 选中太极且凭据就绪 → tool-web 暴露 web_search / web_fetch

用户在设置中改选
  → 写入 Profile patch（用户层）
  → 下次 ensure 检测到偏离太极 → 标记 user

登出
  → clear 会话
  → clearTaichiWebDefaults
  → 若 Host 仍在跑 → needsRestart（既有语义）
```

## 测试计划

| 用例 | 覆盖 |
| --- | --- |
| available / ready | 有/无 URL、有/无 token |
| 搜索 / 获取成功 | 请求 URL、Bearer、body；响应映射 |
| 401 / 402 / 取消 / 坏 JSON | 错误码与文案要点 |
| 默认值：unset + 登录 | Profile 写成太极，标记 desktop |
| unset 但 Profile 已有其它 id | 标记变 user；不覆盖 |
| 用户改为 `http` 或删除覆盖 | 标记变 user；再登录不覆盖 |
| 登出且仍是太极 | 字段清除，标记回 unset |
| 已设 `DSH_WEB_*_PROVIDER` | 对应能力不托管 |
| 产品补丁 | 普通与 Safe Mode 均挂载插件 |
| 现有账号回归 | 登录仍写出模型配置；不破坏原断言 |

交付前按影响范围跑相关单元测试；真实网关联调与重启后工具可见性作为人工验收项列出，不假装已在 CI 覆盖。

## 风险与限制

- 网关必须实际实现与 DeepSeek 相同的 `/v1/tools/search|fetch` 契约；形状偏差由坏 JSON / 无效响应路径暴露。
- 登录后若用户不重启已运行的 Host，工具仍看不到新 token；沿用现有账号 `needsRestart` 提示。
- 官方设置页不会把太极排到菜单最前（官方 id 固定优先）；不影响功能，仅排序。
