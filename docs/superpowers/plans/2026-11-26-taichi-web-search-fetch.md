# 太极网页搜索与获取 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 登录太极账号后，网页搜索与获取默认走 taichi-gateway 的 DeepSeek 兼容 `/v1/tools` 接口，同时保留现有 DeepSeek 与本机 HTTP 提供方。

**Architecture:** 新增 Host 插件 `dsh-taichi-web` 注册 `taichi-search` / `taichi-fetch`；主进程在登录/登出时按托管标记改写 Profile `cordis.patch.yml` 的 `web.searchProvider` / `web.fetchProvider`；不改上游选择算法，不占用 `deepseek-*-api` id。

**Tech Stack:** TypeScript、Cordis Host 插件、`@deepseek-ai/dsh-web`、`yaml`、Vitest、tsdown（Host 半侧 ESM）

## Global Constraints

- 提交说明用中文；沿用两空格、单引号、无分号。
- 不改 `desktop-product.patch.yml` 里的 `web.searchProvider` / `web.fetchProvider`（会压过设置页）。
- 标记文件名为 `taichi-web-defaults.json`，与 Profile 的 `cordis.patch.yml` 同级；不含 token。
- 提供方 id 固定为 `taichi-search`、`taichi-fetch`。
- 鉴权只用 `TAICHI_GATEWAY_URL` + `TAICHI_GATEWAY_ACCESS_TOKEN`（Bearer）。
- Safe Mode 与普通 Profile 均挂载插件。
- 相关测试：`npm test -- test/<file>.test.ts`；改完后按影响范围跑；不要声称未跑过的检查已通过。

## File Structure

| 路径 | 职责 |
| --- | --- |
| `src/shared/taichi-web.ts` | 提供方 id、标记文件名、托管状态类型等跨进程常量 |
| `src/main/enterprise/taichi-web-defaults.ts` | ensure/clear 纯逻辑：读改 Profile patch + 标记文件 |
| `packages/dsh-taichi-web/` | Host 插件：注册搜索/获取提供方，打网关 |
| `src/main/shell/product-patch.ts` | 挂载 `dsh-taichi-web` |
| `src/main/enterprise/account-service.ts` | publish 后 ensure；logout 后 clear |
| `package.json` | `file:packages/dsh-taichi-web` 依赖与可选 build 脚本 |
| `test/taichi-web-defaults.test.ts` | 默认值托管行为 |
| `test/taichi-web-providers.test.ts` | 提供方 available/请求/错误 |
| `test/account-builtin.test.ts` | 产品补丁含插件（扩展现有断言） |

---

### Task 1: 共享常量与默认值托管逻辑

**Files:**
- Create: `src/shared/taichi-web.ts`
- Create: `src/main/enterprise/taichi-web-defaults.ts`
- Create: `test/taichi-web-defaults.test.ts`

**Interfaces:**
- Produces: `TAICHI_SEARCH_PROVIDER_ID`, `TAICHI_FETCH_PROVIDER_ID`, `TAICHI_WEB_DEFAULTS_FILE`, `TaichiWebCapabilityMark`, `ensureTaichiWebDefaults(profileDir, env?)`, `clearTaichiWebDefaults(profileDir, env?)`

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearTaichiWebDefaults,
  ensureTaichiWebDefaults,
} from '../src/main/enterprise/taichi-web-defaults'
import {
  TAICHI_FETCH_PROVIDER_ID,
  TAICHI_SEARCH_PROVIDER_ID,
  TAICHI_WEB_DEFAULTS_FILE,
} from '../src/shared/taichi-web'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function tempProfile(patch = '[]\n'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'taichi-web-'))
  directories.push(dir)
  await writeFile(join(dir, 'cordis.patch.yml'), patch, 'utf8')
  return dir
}

describe('taichi web defaults', () => {
  it('writes taichi providers when unset and profile has no selection', async () => {
    const dir = await tempProfile()
    await ensureTaichiWebDefaults(dir, {})
    const patch = await readFile(join(dir, 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain(`searchProvider: ${TAICHI_SEARCH_PROVIDER_ID}`)
    expect(patch).toContain(`fetchProvider: ${TAICHI_FETCH_PROVIDER_ID}`)
    const mark = JSON.parse(await readFile(join(dir, TAICHI_WEB_DEFAULTS_FILE), 'utf8'))
    expect(mark).toEqual({ search: 'desktop', fetch: 'desktop' })
  })

  it('marks user and keeps other provider when unset but profile already chose one', async () => {
    const dir = await tempProfile(`- id: web
  config:
    fetchProvider: http
`)
    await ensureTaichiWebDefaults(dir, {})
    const patch = await readFile(join(dir, 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain('fetchProvider: http')
    expect(patch).not.toContain(TAICHI_FETCH_PROVIDER_ID)
    const mark = JSON.parse(await readFile(join(dir, TAICHI_WEB_DEFAULTS_FILE), 'utf8'))
    expect(mark.fetch).toBe('user')
  })

  it('does not overwrite after user mark', async () => {
    const dir = await tempProfile()
    await ensureTaichiWebDefaults(dir, {})
    await writeFile(join(dir, 'cordis.patch.yml'), `- id: web
  config:
    fetchProvider: http
`, 'utf8')
    await ensureTaichiWebDefaults(dir, {})
    await ensureTaichiWebDefaults(dir, {})
    const mark = JSON.parse(await readFile(join(dir, TAICHI_WEB_DEFAULTS_FILE), 'utf8'))
    expect(mark.fetch).toBe('user')
    const patch = await readFile(join(dir, 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain('fetchProvider: http')
  })

  it('clears desktop-managed taichi fields on logout', async () => {
    const dir = await tempProfile()
    await ensureTaichiWebDefaults(dir, {})
    await clearTaichiWebDefaults(dir, {})
    const patch = await readFile(join(dir, 'cordis.patch.yml'), 'utf8')
    expect(patch).not.toContain(TAICHI_SEARCH_PROVIDER_ID)
    expect(patch).not.toContain(TAICHI_FETCH_PROVIDER_ID)
    const mark = JSON.parse(await readFile(join(dir, TAICHI_WEB_DEFAULTS_FILE), 'utf8'))
    expect(mark).toEqual({ search: 'unset', fetch: 'unset' })
  })

  it('skips a capability when DSH_WEB_*_PROVIDER is set', async () => {
    const dir = await tempProfile()
    await ensureTaichiWebDefaults(dir, {
      DSH_WEB_SEARCH_PROVIDER: 'deepseek-search-api',
    })
    const patch = await readFile(join(dir, 'cordis.patch.yml'), 'utf8')
    expect(patch).not.toContain(TAICHI_SEARCH_PROVIDER_ID)
    expect(patch).toContain(TAICHI_FETCH_PROVIDER_ID)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/taichi-web-defaults.test.ts`  
Expected: FAIL（模块不存在）

- [ ] **Step 3: Write shared constants**

`src/shared/taichi-web.ts`:

```ts
export const TAICHI_SEARCH_PROVIDER_ID = 'taichi-search'
export const TAICHI_FETCH_PROVIDER_ID = 'taichi-fetch'
export const TAICHI_WEB_DEFAULTS_FILE = 'taichi-web-defaults.json'
export const TAICHI_WEB_PLUGIN_NAME = 'dsh-taichi-web'

export type TaichiWebCapabilityMark = 'unset' | 'desktop' | 'user'

export interface TaichiWebDefaultsMark {
  search: TaichiWebCapabilityMark
  fetch: TaichiWebCapabilityMark
}
```

- [ ] **Step 4: Implement ensure/clear**

在 `src/main/enterprise/taichi-web-defaults.ts`：

- 用 `yaml` 的 `parseDocument` / `isSeq` / `isMap`，风格对齐 `provider-config.ts`。
- 找到或创建 `id: web`（或 `name: '@deepseek-ai/dsh-web'`）行，只改 `config.searchProvider` / `config.fetchProvider`。
- 读标记：文件缺失 → `{ search: 'unset', fetch: 'unset' }`；非法 JSON → 打日志并按 unset，不抛到登录路径。
- `ensure` / `clear` 按规格状态机逐能力处理；`env` 参数默认 `process.env`，便于测试注入。
- 原子写：`*.tmp` + `rename`（同 `provider-config.ts` 的 `writeAtomic`）。

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- test/taichi-web-defaults.test.ts`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/shared/taichi-web.ts src/main/enterprise/taichi-web-defaults.ts test/taichi-web-defaults.test.ts
git commit -m "添加太极网页提供方的默认值托管逻辑。"
```

---

### Task 2: Host 插件提供方（搜索/获取）

**Files:**
- Create: `packages/dsh-taichi-web/package.json`
- Create: `packages/dsh-taichi-web/tsconfig.json`
- Create: `packages/dsh-taichi-web/tsdown.config.ts`
- Create: `packages/dsh-taichi-web/index.js`
- Create: `packages/dsh-taichi-web/src/env.ts`
- Create: `packages/dsh-taichi-web/src/transport.ts`
- Create: `packages/dsh-taichi-web/src/search.ts`
- Create: `packages/dsh-taichi-web/src/fetch.ts`
- Create: `packages/dsh-taichi-web/src/index.ts`
- Create: `test/taichi-web-providers.test.ts`

**Interfaces:**
- Consumes: `TAICHI_GATEWAY_URL`, `TAICHI_GATEWAY_ACCESS_TOKEN`；`ctx.web.registerSearchProvider` / `registerFetchProvider`
- Produces: Cordis `apply`；provider ids `taichi-search` / `taichi-fetch`

- [ ] **Step 1: Write the failing provider tests**

`test/taichi-web-providers.test.ts` 从包源码导入（构建前可测）：

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaichiFetchProvider } from '../packages/dsh-taichi-web/src/fetch.ts'
import { TaichiSearchProvider } from '../packages/dsh-taichi-web/src/search.ts'
import { resolveTaichiWebGateway } from '../packages/dsh-taichi-web/src/env.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('taichi web providers', () => {
  it('is unavailable without url or token', () => {
    expect(resolveTaichiWebGateway({}).ok).toBe(false)
    expect(new TaichiSearchProvider(() => ({})).available()).toBe(false)
    expect(new TaichiFetchProvider(() => ({})).available()).toBe(false)
  })

  it('searches with bearer auth and maps results', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      results: [{ url: 'https://example.com', title: 'Ex', snippet: 'snip', summary: 'sum', date: null }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new TaichiSearchProvider(() => ({
      TAICHI_GATEWAY_URL: 'https://gw.example',
      TAICHI_GATEWAY_ACCESS_TOKEN: 'tok',
    }), { count: 10, searchRequestsPerSecond: 5 })
    const result = await provider.search({ query: 'q', maxResults: 3 })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://gw.example/v1/tools/search')
    expect(init?.headers).toMatchObject({ authorization: 'Bearer tok' })
    expect(JSON.parse(String(init?.body))).toMatchObject({ query: 'q', count: 3, need_content: false })
    expect(result.sources[0]?.url).toBe('https://example.com')
  })

  it('fetches markdown content', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ content: '# Hi' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new TaichiFetchProvider(() => ({
      TAICHI_GATEWAY_URL: 'https://gw.example/',
      TAICHI_GATEWAY_ACCESS_TOKEN: 'tok',
    }))
    const result = await provider.fetch({ url: 'https://page.example' })
    expect(fetchMock.mock.calls[0]![0]).toBe('https://gw.example/v1/tools/fetch')
    expect(result).toEqual({
      url: 'https://page.example',
      statusCode: 200,
      body: { kind: 'text', content: '# Hi' },
      truncated: false,
    })
  })

  it('maps 401 and 402 to WEB_PROVIDER_ERROR with recovery hints', async () => {
    for (const [status, needle] of [[401, 'sign in'], [402, 'credit']] as const) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'x' }), { status })))
      const provider = new TaichiFetchProvider(() => ({
        TAICHI_GATEWAY_URL: 'https://gw.example',
        TAICHI_GATEWAY_ACCESS_TOKEN: 'tok',
      }))
      await expect(provider.fetch({ url: 'https://page.example' })).rejects.toMatchObject({
        code: 'WEB_PROVIDER_ERROR',
      })
      try {
        await provider.fetch({ url: 'https://page.example' })
      } catch (error) {
        expect(String(error)).toMatch(new RegExp(needle, 'i'))
      }
    }
  })
})
```

（实现时按实际导出名微调；401/402 文案需包含引导登录 / 积分不足的英文关键句，与实现一致。）

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/taichi-web-providers.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement package sources**

`package.json` 要点：

```json
{
  "name": "dsh-taichi-web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./index.js",
  "exports": { ".": "./index.js", "./package.json": "./package.json" },
  "scripts": { "build": "tsdown", "typecheck": "tsc --noEmit" },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1 || ^4.1.0",
    "@deepseek-ai/dsh-web": "^0.2.2-rc.5",
    "@deepseek-ai/schemastery": "^3.18.4"
  }
}
```

`index.js`：`export * from './lib/index.js'; export { apply } from './lib/index.js'`

实现要点：

- `resolveTaichiWebGateway(env)` → `{ ok: true, baseURL, token } | { ok: false }`；去尾斜杠。
- `dispatchTaichiWeb`：`POST`、`redirect: 'error'`、Bearer、JSON；401/402/其它错误 → `WebError`；abort → `WEB_ABORTED`；坏 JSON → `WEB_PROVIDER_ERROR`。
- Search：限速窗口同 DeepSeek（可选简化但保留 `searchRequestsPerSecond`）；`mapSearchResponse` 字段校验同 DeepSeek。
- Fetch：成功映射 `content` 字符串。
- `title` / `description`：zh+en（太极 / Taichi；登录积分、不能内网本机）。
- `apply(ctx, config)`：`inject = ['web']`；注册两个 provider；config 含 `count`/`searchRequestsPerSecond` volatile 默认 10/5。

- [ ] **Step 4: Build the package**

Run: `npm --prefix packages/dsh-taichi-web run build`  
Expected: 生成 `packages/dsh-taichi-web/lib/index.js`

- [ ] **Step 5: Run provider tests**

Run: `npm test -- test/taichi-web-providers.test.ts`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/dsh-taichi-web test/taichi-web-providers.test.ts
git commit -m "新增太极网关网页搜索与获取 Host 插件。"
```

---

### Task 3: 挂载插件并接入登录/登出

**Files:**
- Modify: `package.json`（dependencies 增加 `"dsh-taichi-web": "file:packages/dsh-taichi-web"`；可选 `"web:build"` 脚本）
- Modify: `src/main/shell/product-patch.ts`（`DESKTOP_PRODUCT_PATCH_BASE` 插入行）
- Modify: `src/main/enterprise/account-service.ts`（publish / logout）
- Modify: `test/account-builtin.test.ts`（断言补丁含 `dsh-taichi-web`）

**Interfaces:**
- Consumes: `ensureTaichiWebDefaults`, `clearTaichiWebDefaults`, `TAICHI_WEB_PLUGIN_NAME`
- Produces: 登录后 Profile 默认；产品补丁挂载

- [ ] **Step 1: Extend product-patch assertions (fail first)**

在 `test/account-builtin.test.ts` 现有「挂载账号插件」用例旁增加：

```ts
expect(buildDesktopProductPatch()).toContain('name: dsh-taichi-web')
expect(DESKTOP_SAFE_PRODUCT_PATCH).toContain('name: dsh-taichi-web')
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- test/account-builtin.test.ts`  
Expected: 新断言 FAIL

- [ ] **Step 3: Mount in product-patch and add dependency**

在 `DESKTOP_PRODUCT_PATCH_BASE` 的 insert 列表中，紧跟 `dsh-taichi-account` 后增加：

```yaml
    - id: dsh-taichi-web
      name: dsh-taichi-web
```

根 `package.json` dependencies 增加 `"dsh-taichi-web": "file:packages/dsh-taichi-web"`。然后 `npm install`（保留 lockfile 更新）。

- [ ] **Step 4: Wire account-service**

- `publish()`：在模型/余额同步之后（或无论其成败，只要本方法在已登录路径被调用），`await ensureTaichiWebDefaults(this.options.profileDir)`；失败只 `console.error`，不改变登录态。
- `logout()`：在 `store.clear()` / `clearMemory()` 之后，`await clearTaichiWebDefaults(this.options.profileDir)`；同样不因失败阻断登出。

- [ ] **Step 5: Run regressions**

Run:

```bash
npm test -- test/account-builtin.test.ts test/taichi-web-defaults.test.ts test/taichi-web-providers.test.ts
npm run typecheck
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/main/shell/product-patch.ts src/main/enterprise/account-service.ts test/account-builtin.test.ts
git commit -m "登录后默认启用太极网页搜索与获取。"
```

---

### Task 4: 收尾核对

- [ ] **Step 1: Spec coverage check**

对照 `docs/superpowers/specs/2026-11-26-taichi-web-search-fetch-design.md`：提供方契约、托管状态机、产品补丁、错误码、保留其它提供方均已有代码或测试。

- [ ] **Step 2: Manual acceptance notes（写入交付说明，不假装已测）**

未自动覆盖、需人工：真实网关 `/v1/tools/search|fetch`、登录后重启 Host 后工具可见、设置页能看到并改选太极/DeepSeek/HTTP。

- [ ] **Step 3: Final verification**

Run: `npm test -- test/taichi-web-defaults.test.ts test/taichi-web-providers.test.ts test/account-builtin.test.ts`  
Expected: PASS

---

## Self-Review

1. **Spec coverage:** 独立提供方、默认托管、登出撤回、环境变量跳过、产品补丁含 Safe Mode、错误处理、保留其它提供方 → Tasks 1–3。设置页自动列出依赖 Host 注册，无需改 UI。
2. **Placeholders:** 无 TBD；测试含具体断言。
3. **Type consistency:** ids / 标记文件名与 shared 常量一致。
