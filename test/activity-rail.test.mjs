// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const source = await readFile(
  resolve("packages/dsh-desktop-activity/client.js"),
  "utf8",
);
let root;
let container;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  root = null;
  document.getElementById("dsh-desktop-activity-style")?.remove();
  document.body.replaceChildren();
  delete window.__ModuleLoader__;
});

async function mount({
  studio,
  collapsed = false,
  deferStudio = false,
  activePanelId = null,
} = {}) {
  let plugin;
  let toggles = 0;
  let dictionary;
  let deliverStudio;
  let panelId = activePanelId;
  const panelListeners = new Set();
  const panels = [];
  window.__ModuleLoader__ = {
    load({ factory }) {
      plugin = factory((name) => {
        if (name === "react") return React;
        if (name === "@deepseek-ai/dsh-client-ui-primitives")
          return {
            IconSettingsOutlineMedium: (props) =>
              React.createElement("svg", { "data-icon": "settings", ...props }),
          };
        throw new Error(name);
      });
    },
  };
  new Function(source)();
  const layout = new Proxy(
    {
      toggleSidebar() {
        toggles += 1;
      },
      selectPanel(id) {
        panels.push(id);
      },
      panelInfo: {
        subscribe(listener) {
          panelListeners.add(listener);
          return () => panelListeners.delete(listener);
        },
        getSnapshot: () => ({ activePanelId: panelId }),
      },
    },
    {
      get(target, key) {
        if (key in target) return target[key];
        throw new Error(`unexpected layout.${String(key)}`);
      },
    },
  );
  const ctx = {
    slotCalls: [],
    effect(run) {
      return run();
    },
    locale: {
      register(_ns, value) {
        dictionary = value;
        return () => {};
      },
      bind: () => (key) => dictionary.zh[key],
    },
    inject(names, callback) {
      expect(names).toEqual(["taichiImageStudio"]);
      deliverStudio = () =>
        callback(studio ? { taichiImageStudio: studio } : {});
      if (!deferStudio && studio)
        return callback({ taichiImageStudio: studio });
    },
    slots: {
      inject(_name, run) {
        run();
      },
      register(meta, component) {
        if (meta.name === "shell.activity") {
          ctx.component = component;
          ctx.props = meta.inject();
          ctx.children = meta.children;
          ctx.props.renderSlot = (name, props) => {
            ctx.slotCalls.push([name, props]);
            return React.createElement("span", {
              "data-test-activity-action": name,
            });
          };
        } else if (meta.name === "settings.launcher") ctx.launcher = component;
        else throw new Error(meta.name);
      },
    },
    layout,
  };
  plugin.apply(ctx);
  if (collapsed) {
    const marker = document.createElement("div");
    marker.setAttribute("data-sidebar-collapsed", "");
    document.body.append(marker);
  }
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const render = async (settings) => {
    await act(async () => {
      root.render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(ctx.component, ctx.props),
          settings ? React.createElement(ctx.launcher, settings) : null,
        ),
      );
    });
  };
  await render(null);
  return {
    dictionary,
    toggles: () => toggles,
    home: () => container.querySelector('[data-dsh-activity="home"]'),
    image: () => container.querySelector('[data-dsh-activity="image"]'),
    settings: () => container.querySelector('[data-dsh-activity="settings"]'),
    footer: () => container.querySelector("[data-dsh-activity-footer]"),
    panels: () => panels,
    slotCalls: ctx.slotCalls,
    children: ctx.children,
    async setPanel(id) {
      panelId = id;
      await act(async () => {
        for (const listener of panelListeners) listener();
      });
    },
    async deliverStudio() {
      await act(async () => {
        deliverStudio();
      });
    },
    showSettings: render,
  };
}

function studioDouble() {
  const calls = [];
  let panelOpen = false;
  const listeners = new Set();
  return {
    calls,
    open() {
      calls.push("open");
      panelOpen = true;
      for (const listener of listeners) listener();
    },
    close() {
      calls.push("close");
      panelOpen = false;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => ({ panelOpen }),
  };
}

it("opens the sidebar from Home only while it is collapsed, and opens the studio from the image button", async () => {
  const studio = studioDouble();
  const collapsed = await mount({ studio, collapsed: true });
  expect(collapsed.home().getAttribute("aria-label")).toBe("主页");
  expect(collapsed.image().getAttribute("aria-label")).toBe("图片");
  await act(async () => {
    collapsed.home().click();
  });
  expect(studio.calls).toEqual(["close"]);
  expect(collapsed.toggles()).toBe(1);
  expect(collapsed.image().innerHTML).toContain("<rect");
  await act(async () => {
    collapsed.image().click();
  });
  expect(studio.calls).toEqual(["close", "open"]);
  expect(collapsed.image().getAttribute("aria-current")).toBe("page");
  expect(collapsed.home().hasAttribute("aria-current")).toBe(false);
  expect(collapsed.home().innerHTML).not.toContain("M3 7.5 8 3.5l5 4V13");
  expect(collapsed.image().innerHTML).toContain('fill-rule="evenodd"');
  expect(collapsed.image().innerHTML).not.toContain("<rect");
});

it("keeps Home current while the account dialog is not the main page", async () => {
  const rail = await mount({ activePanelId: "desktop-account" });
  expect(rail.home().getAttribute("aria-current")).toBe("page");
  expect(rail.home().innerHTML).toContain('fill-rule="evenodd"');
  await act(async () => {
    rail.home().click();
  });
  expect(rail.panels()).toEqual([]);
});

it("leaves an expanded sidebar where it is", async () => {
  const studio = studioDouble();
  const rail = await mount({ studio });
  await act(async () => {
    rail.home().click();
  });
  expect(studio.calls).toEqual(["close"]);
  expect(rail.toggles()).toBe(0);
});

it("moves settings onto the bottom of the rail and drops the sidebar gear", async () => {
  const opens = [];
  const rail = await mount({});
  expect(rail.settings()).toBeNull();
  await rail.showSettings({
    openSettings: () => {
      opens.push("open");
    },
    settingsOpen: false,
    settingsShortcut: { keys: ["Ctrl", ","], aria: "Control+Comma" },
  });
  const button = rail.settings();
  expect(button.getAttribute("aria-label")).toBe("设置");
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(button.getAttribute("aria-haspopup")).toBe("dialog");
  expect(button.getAttribute("aria-keyshortcuts")).toBe("Control+Comma");
  expect(button.querySelector('[data-icon="settings"]')).not.toBeNull();
  expect(container.querySelectorAll("button")).toHaveLength(2);
  expect(rail.children["shell.activity.action"]).toEqual({
    kind: "list",
    scope: "root",
  });
  expect(rail.slotCalls).toContainEqual([
    "shell.activity.action",
    { wide: false },
  ]);
  const footer = rail.footer();
  expect(
    footer.firstElementChild.getAttribute("data-test-activity-action"),
  ).toBe("shell.activity.action");
  expect(footer.lastElementChild).toBe(button);
  await act(async () => {
    button.click();
  });
  expect(opens).toEqual(["open"]);
  await rail.showSettings({ openSettings: () => {}, settingsOpen: true });
  expect(rail.settings().getAttribute("aria-expanded")).toBe("true");
  await rail.showSettings(null);
  expect(rail.settings()).toBeNull();
});

function stubBox(element, top, height = 36) {
  Object.defineProperty(element, "offsetTop", {
    configurable: true,
    value: top,
  });
  Object.defineProperty(element, "offsetHeight", {
    configurable: true,
    value: height,
  });
}

it("slides the leading mark to the newly selected activity", async () => {
  const studio = studioDouble();
  const rail = await mount({ studio });
  const mark = () => container.querySelector("[data-dsh-activity-mark]");
  expect(container.querySelectorAll("[data-dsh-activity-mark]")).toHaveLength(1);
  expect(mark().dataset.state).toBe("on");
  expect(mark().getAttribute("aria-hidden")).toBe("true");
  stubBox(rail.home(), 8);
  stubBox(rail.image(), 48);
  stubBox(mark(), 0, 16);
  await act(async () => {
    rail.image().click();
  });
  expect(rail.image().getAttribute("aria-current")).toBe("page");
  expect(mark().dataset.state).toBe("on");
  expect(mark().style.transform).toBe("translateY(58px)");
  await rail.showSettings({
    openSettings: () => {},
    settingsOpen: false,
  });
  stubBox(rail.settings(), 400);
  stubBox(mark(), 0, 16);
  await rail.showSettings({
    openSettings: () => {},
    settingsOpen: true,
  });
  expect(mark().style.transform).toBe("translateY(410px)");
  expect(mark().dataset.state).toBe("on");
  await rail.showSettings({
    openSettings: () => {},
    settingsOpen: false,
  });
  expect(rail.image().getAttribute("aria-current")).toBe("page");
  expect(mark().style.transform).toBe("translateY(58px)");
});

it("shows a rounded tooltip beside the icon and drops the native title", async () => {
  const rail = await mount({});
  expect(rail.home().hasAttribute("title")).toBe(false);
  expect(rail.home().getAttribute("aria-label")).toBe("主页");
  vi.useFakeTimers();
  try {
    await act(async () => {
      rail.home().dispatchEvent(
        new PointerEvent("pointerover", { bubbles: true }),
      );
    });
    expect(document.querySelector("[data-dsh-activity-tip]")).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(280);
    });
    const tip = document.querySelector("[data-dsh-activity-tip]");
    expect(tip?.textContent).toBe("主页");
    expect(tip?.getAttribute("role")).toBe("tooltip");
    expect(tip?.classList.contains("dsh-desktop-tooltip")).toBe(true);
    await act(async () => {
      rail.home().dispatchEvent(
        new PointerEvent("pointerout", { bubbles: true }),
      );
      vi.advanceTimersByTime(80);
    });
    expect(document.querySelector("[data-dsh-activity-tip]")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it("hides the image button until the studio service exists", async () => {
  const studio = studioDouble();
  const rail = await mount({ studio, deferStudio: true });
  expect(rail.image()).toBeNull();
  expect(rail.home()).not.toBeNull();
  await rail.deliverStudio();
  expect(rail.image()).not.toBeNull();
  await act(async () => {
    rail.image().click();
  });
  expect(studio.calls).toEqual(["open"]);
});

it("registers the desktop languages and only alias colors", async () => {
  const rail = await mount({});
  for (const language of ["zh", "en", "ja", "es", "fr", "de", "ru", "pt"]) {
    expect(rail.dictionary[language].home).toEqual(expect.any(String));
    expect(rail.dictionary[language].image).toEqual(expect.any(String));
    expect(rail.dictionary[language].settings).toEqual(expect.any(String));
  }
  const style = document.getElementById(
    "dsh-desktop-activity-style",
  ).textContent;
  expect(style).toContain(
    "[data-dsh-activity-footer]{margin-top:auto;display:flex;flex-direction:column;align-items:center;gap:8px}",
  );
  expect(style).toContain("var(--dsh-frame-top-clearance,48px)");
  expect(style).toContain("background:var(--dsw-specific-sidebar-fill)");
  expect(style).toContain(
    "background:linear-gradient(to bottom,transparent,var(--dsw-alias-border-l2) 20px,var(--dsw-alias-border-l2) calc(100% - 20px),transparent)",
  );
  expect(style).not.toContain("border-inline-end");
  expect(style).not.toContain("var(--dsw-alias-border-secondary)");
  expect(style).not.toContain("var(--dsw-alias-bg-base)");
  expect(style).toContain("var(--dsw-alias-interactive-bg-hover)");
  expect(style).toContain("var(--dsw-alias-interactive-bg-active)");
  expect(style).toContain('button[aria-current="page"]');
  expect(style).toContain('button[data-selected="true"]');
  expect(style).toContain("[data-dsh-activity-mark]");
  expect(style).toContain(
    "transition:transform .34s cubic-bezier(.22,1,.36,1),opacity .18s ease,scale .22s cubic-bezier(.22,1,.36,1)",
  );
  expect(style).toContain("@keyframes dsh-activity-glyph{from{opacity:.25}to{opacity:1}}");
  expect(style).not.toContain("scale:1.08");
  expect(style).not.toContain("scale:.92");
  expect(style).toContain(
    "@media (prefers-reduced-motion:reduce){[data-dsh-activity-rail] button,[data-dsh-activity-mark],[data-dsh-activity-glyph],.dsh-desktop-tooltip[role=\"tooltip\"]{transition:none;animation:none}}",
  );
  expect(style).toContain(
    ".dsh-desktop-tooltip[role=\"tooltip\"]{position:fixed;z-index:1100;padding:6px 16px;border-radius:var(--dsw-radius-lg,16px);background:var(--dsw-alias-tooltip-bg);color:var(--dsw-static-neutral-bluish-00);font-size:13px;line-height:20px;pointer-events:none;animation:dsh-desktop-tooltip-in .16s cubic-bezier(.22,1,.36,1)}",
  );
  expect(style).toContain("@keyframes dsh-desktop-tooltip-in{from{opacity:0}to{opacity:1}}");
  expect(style).not.toContain("::before");
  expect(style).not.toContain("var(--dsw-alias-bg-layer-2)");
  expect(style).not.toMatch(/#[0-9a-f]{3,8}/i);
  const packageJson = JSON.parse(
    await readFile(resolve("package.json"), "utf8"),
  );
  expect(packageJson.dependencies["dsh-desktop-activity"]).toBe(
    "file:packages/dsh-desktop-activity",
  );
  const activityPackage = JSON.parse(
    await readFile(
      resolve("packages/dsh-desktop-activity/package.json"),
      "utf8",
    ),
  );
  expect(activityPackage.dsh.client.inject).toContain(
    "@deepseek-ai/dsh-client-ui-primitives",
  );
  expect(
    activityPackage.peerDependencies["@deepseek-ai/dsh-client-ui-primitives"],
  ).toContain("0.2.2-rc.1");
  const dshPatch = await readFile(
    resolve("patches/@deepseek-ai+dsh+0.2.2-rc.1.patch"),
    "utf8",
  );
  expect(dshPatch).toContain('+    "dsh-desktop-activity": "0.1.0",');
  for (const file of [
    "build/dsh-desktop.patch.yml",
    "build/dsh-desktop-safe.patch.yml",
  ]) {
    const overlay = await readFile(resolve(file), "utf8");
    expect(overlay).toMatch(
      /- id: dsh-desktop-activity\r?\n {6}name: dsh-desktop-activity/,
    );
  }
});
