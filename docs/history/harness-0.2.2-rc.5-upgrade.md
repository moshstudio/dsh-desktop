# Harness 0.2.2-rc.5 升级记录

依赖、锁文件和 32 个 `@deepseek-ai/dsh*` 补丁已经对上 `0.2.2-rc.5`。干净安装后 `patch-package` 应用全部 40 个补丁成功。`npm run typecheck` 和这次受影响的 6 个测试文件（71 个用例）已通过。还没有跑完整 `npm test`，也没有打安装包或在 Windows 上复验启动，不能发版。

## 范围

- 在 `main` 上直接升级，没有另开分支。
- 根依赖里 222 个 `@deepseek-ai/dsh*` 从精确 `0.2.2-rc.1` 改为精确 `0.2.2-rc.5`。另外补上 rc.5 新拆出的 `@deepseek-ai/dsh-error@0.2.2-rc.5`：它只作为 10 个包的 peer 出现，仓库 `.npmrc` 开了 `legacy-peer-deps`，npm 不会自动安装。启动时 `dsh-llm` 和 `dsh-subprocess` 直接 import 它，缺包会让必需插件整批导入失败。
- 配套依赖不需要再升。`dsh-app-boot@0.2.2-rc.5` 的 peer 仍是 `@deepseek-ai/cordis ~4.1.0`、`cordis-plugin-* ~1.1.0`，所以 `cordis 4.1.0`、`cosmokit 1.9.0`、`schemastery 3.19.0`、`libreoffice-kit 0.1.5`、`node-addon-system 0.1.2` 保持不动。
- 宿主插件 peer：10 个写死的精确版本改成 `0.2.2-rc.5`（`dsh-desktop-office` 8 个，`dsh-desktop-workbenches` 的 `dsh-tools` 和 `dsh-sandbox`）。33 条范围在末尾追加 ` || ^0.2.2-rc.5`，旧范围保留。`^0.2.2-rc.1` 不包含 `0.2.2-rc.5`。
- `upstream-baseline.json` 的 `dshVersion` 改为 `0.2.2-rc.5`。`commit` 仍是 `66491b05`，这次没有新的官方对照提交。
- 锁文件由 `npm install --ignore-scripts` 更新，随后再应用补丁。

## 补丁

36 个 `0.2.2-rc.1` 补丁里，34 个按 rc.5 源码重放并改名为 `+0.2.2-rc.5.patch`。2 个被上游覆盖，删除且不生成新补丁。非 DSH 补丁没有改动。补丁总数从 41 变为 40，因为 `dsh-client-ui-chat` 在 rc.1 时没有补丁，这次新增了一份。

上游已覆盖、删除的补丁：

| 补丁 | 删除理由 |
| --- | --- |
| `dsh-web-frontend` | rc.5 的 `ZJ` 只把必需插件白名单里的失败当致命，白名单由 manifest 的 `inject` 闭包算出。`dsh-desktop-workbenches` 不在里面，失败只走 `console.warn`。入口文件已从 `index-BgUyXZcc.js` 换成 `index-Ciz7DZxv.js` |
| `dsh-mcp-client` | rc.5 源码已包含原补丁的行为 |

重放时保住的行为：

| 补丁 | 在 rc.5 上的落点 |
| --- | --- |
| `dsh` | CLI 失败改为 `exitCode = 1` 后抛出。真实逻辑在 `lib/bin-CwxESKe-.js`，`lib/bin.js` 只是薄入口。桌面插件清单仍挂在独立的 `optionalDependencies`，因为 rc.5 把实验包放回了 `dependencies` |
| `dsh-app-boot`、`dsh-api-remotes`、`dsh-settings`、`dsh-skill`、`dsh-credentials-local`、`dsh-host-open-in-app`、`dsh-session-persistence`、`dsh-session-persistence-jsonl`、`dsh-client-file-upload`、`dsh-client-ui-settings` | 上下文没变，原补丁直接改名后应用成功 |
| `dsh-llm` | 模型发现结果保留 `reasoningEfforts` 和 `reasoningCompat` |
| `dsh-llm-pi-ai` | `403` 归为 `FORBIDDEN` 而不再是 `AUTH`；provider 省略 terminal content 时用已完成块补全 |
| `dsh-workspace` | 保留 `forgetSession`，供会话删除使用 |
| `dsh-client-modules` | 可选工作台插件失败不让整树启动失败 |
| `dsh-api-session-controller` | `retainHandle`、`disposeOwned`、缺省 preset 回退 `fallbackFrom`，以及 `session.delete` 的命令、远程协议和类型 |
| `dsh-plugin-manager` | 不兼容版本只 `reportPluginCompatibility`；Windows 上 `pnpm config get registry` 带 `--location=project`；`switchedOff` 的包 `enabled=false` |
| `dsh-client-ui-sidebar` | 侧栏根节点保留 `data-dsh-sidebar-root` / `data-dsh-sidebar-wide` |
| `dsh-client-ui-chat` | 这次新增。`ChatNodeSeat` 接收 `leadingUserKey` 和 `messageFooter`，页脚只挂在第一条用户消息及其发送回显上 |
| `dsh-client-ui-conversation` | 空白会话的 mode/dock 槽和输入附件样式按 rc.5 的反引号、无空格产物接上 |
| `dsh-client-ui-primitives` | `parseFileLink` 继续识别冒号和 GitHub 行列后缀，并排除 `localhost:8080` |
| `dsh-client-ui-settings-models` | 模型行保留图片输入开关和 `ModelReasoningEffortsField` |
| `dsh-client-ui-workspace` | 未读标记、会话可见性过滤和右键菜单的 `unread` / `onUnreadChange` 保留 |
| `dsh-client-ui-layout`、`model-selection`、`deliverables`、`trajectory`、`settings-general`、`attachment`、`agent-preset`、`client-shortcuts`、`dsh-llm-deepseek` | 原行为按 rc.5 源码重放 |

`dsh` 的 `optionalDependencies` 是手工补进补丁的。`patch-package` 生成时默认忽略 `package.json`，应用时不会忽略。

## 检查

在 Windows 11、Node v26.13.0 上实际跑过：

- 重新安装 rc.5 后，`patch-package` 应用 40 个补丁，全部成功。
- `npm run typecheck` 对 `src/` 没有新增错误。rc.5 把 `mergePlatformCookies` 和 `platformClientHeaders` 从 `@deepseek-ai/dsh-deepseek-account` 包根移到了 `./client-metadata`，[src/main/shell/window/platform-view.ts](src/main/shell/window/platform-view.ts) 已改导入。类型和 `PlatformSession` 仍从包根导入。其余报错都在 `packages/` 的插件源码和对应测试里，`tsconfig.node.json` 只包含 `src/` 和 `test/`，这些 `.ts` 扩展名报错不是这次升级引入的。
- 相关测试通过：`test/ppt-integration.test.ts`、`test/client-shell-failure-isolation.test.ts`、`test/verify/patch-lock.test.ts`、`test/release.test.ts`、`test/activity-rail.test.mjs`、`test/upstream/baseline.test.ts`，共 6 个文件、71 个用例。
- 前端隔离测试的压缩符号从 rc.1 的 `ut` / `KZ` / `qZ` / `GZ` 改为 rc.5 的 `yt` / `HJ` / `ZJ` / `KJ`。这些名字属于 `index-Ciz7DZxv.js`，下次升级还会变。
- rc.5 的审计只把必需插件白名单里的失败当致命。清单外的未知插件失败不再抛错，测试改为断言不抛。必需插件失败仍然是致命的。

## 还要做

1. 完整 `npm test` 还没跑。这次只跑了受升级直接影响的 6 个文件。
2. 没有打安装包，也没有用临时 `DSH_HOME` 复验普通 profile 和 Safe Mode 的真实启动。
3. 官方壳移植和签名后的已安装应用冒烟不在这次范围内。