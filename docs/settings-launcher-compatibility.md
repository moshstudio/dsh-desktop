# v0.9.2 设置入口兼容

Desktop 暂不使用 Harness 0.1.7-rc.1 的 `@deepseek-ai/dsh-client-ui-settings-account` 插件。普通模式和 Safe Mode 的宿主组合层均设置 `ui-settings-account` 为 disabled。

这会同时停用该插件的侧栏账号菜单、模型 onboarding 登录入口及账号设置页。`settings.launcher` 因此空出来，由 `dsh-desktop-activity` 占用：它不画侧栏齿轮，把设置图标放在最左活动栏底部，并调用壳提供的 `openSettings`。设置面板、连接状态和更新指示仍留在 `sidebar.settings`。官方账号插件重新启用后会和这个单一席位冲突，需要先改活动栏的占用方式。太极账号按钮是另一项，注册在活动栏底部的 `shell.activity.action`，不再占用侧栏设置操作。它只提交图标和状态，按钮、选中标记和提示由活动栏绘制。插件图标也可以注册到主列的 `shell.activity.main`，两项都按注册 `order` 排序。写入这些座位时须遵守 `packages/AGENTS.md` 中活动栏与 `useSyncExternalStore` 约束（不稳定 `getSnapshot` 会触发 React #185 并把座位 abdicate）。模型提供方和 API 配置仍由模型设置插件承载。配置不删除账号凭据或修改用户 Profile。

`settings.launcher` 的声明、出口和其他插件贡献保持原样。无需第三方 JS 补丁；上一轮仅移除 AccountMenu 注册的临时补丁已删除。将来启用账号功能时可以撤销这两个组合层覆盖。

`test/settings-account-launcher.test.js` 使用实际上游组合层与两个 Desktop 组合层验证禁用结果，以及普通设置和模型设置保持启用。实际应用的展开/折叠侧栏、模型设置及深浅主题仍需 UI 验收。
