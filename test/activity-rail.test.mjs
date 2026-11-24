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
  document.querySelector("[data-sidebar-collapsed]")?.remove();
  root = null;
  document.getElementById("dsh-desktop-activity-style")?.remove();
  document.body.replaceChildren();
  delete window.__ModuleLoader__;
});

async function mount({
  collapsed = false,
  activePanelId = null,
  main,
} = {}) {
  let plugin;
  let toggles = 0;
  let collapsedNow = collapsed;
  let dictionary;
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
        collapsedNow = !collapsedNow;
        document.querySelector("[data-sidebar-collapsed]")?.remove();
        if (collapsedNow) {
          const marker = document.createElement("div");
          marker.setAttribute("data-sidebar-collapsed", "");
          document.body.append(marker);
        }
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
            ctx.bindTip = props.bindTip;
            if (name === "shell.activity.main" && main) {
              return React.createElement(props.component, {
                region: props.region,
                bindTip: props.bindTip,
                children: main(props),
              });
            }
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
    home: () => container.querySelector("[data-dsh-activity-home]"),
    image: () => container.querySelector('[aria-label="图片"]'),
    settings: () => container.querySelector('[aria-label="设置"]'),
    footer: () => container.querySelector("[data-dsh-activity-footer]"),
    panels: () => panels,
    slotCalls: ctx.slotCalls,
    bindTip: () => ctx.bindTip,
    children: ctx.children,
    async setPanel(id) {
      panelId = id;
      await act(async () => {
        for (const listener of panelListeners) listener();
      });
    },
    showSettings: render,
  };
}

function imageSeat(open) {
  return React.createElement(
    "span",
    {
      "data-dsh-activity-item": "",
      "data-label": "图片",
      "data-selected": open ? "true" : "false",
      onClick: () => {
        imageSeat.calls.push("open");
      },
    },
    React.createElement("svg", null, React.createElement("rect", null)),
  );
}
imageSeat.calls = [];

it("opens the sidebar from Home only while it is collapsed, and paints the image seat from the main slot", async () => {
  imageSeat.calls = [];
  const collapsed = await mount({
    collapsed: true,
    main: () => imageSeat(false),
  });
  expect(collapsed.home().getAttribute("aria-label")).toBe("主页");
  expect(collapsed.image().getAttribute("aria-label")).toBe("图片");
  expect(collapsed.image().getAttribute("aria-current")).toBeNull();
  await act(async () => {
    collapsed.image().click();
  });
  expect(imageSeat.calls).toEqual(["open"]);
  expect(collapsed.slotCalls.map(([name]) => name)).toContain("shell.activity.main");
});

it("releases Home while the image page is the current place", async () => {
  const rail = await mount({ main: () => imageSeat(true) });
  const home = container.querySelector("[data-dsh-activity-home]");
  expect(rail.image().getAttribute("aria-current")).toBe("page");
  expect(home.getAttribute("aria-current")).toBeNull();
  expect(home.innerHTML).toContain("M2.2 7.35");
});

it("keeps Home current while the account dialog is not the main page", async () => {
  const rail = await mount({ activePanelId: "desktop-account" });
  expect(rail.home()).not.toBeNull();
  expect(rail.home().innerHTML).toContain('fill-rule="evenodd"');
  await act(async () => {
    rail.home().click();
  });
  expect(rail.panels()).toEqual([]);
});

it("returns to Home from a plugin page and restores a collapsed sidebar", async () => {
  const rail = await mount({ collapsed: true, main: () => imageSeat(true) });
  const seen = [];
  const onHome = () => { seen.push("home"); };
  document.addEventListener("dsh-activity-home", onHome);
  try {
    await act(async () => {
      rail.home().click();
    });
  } finally {
    document.removeEventListener("dsh-activity-home", onHome);
  }
  expect(seen).toEqual(["home"]);
  expect(rail.toggles()).toBe(0);
});

it("returns an expanded sidebar after a page that hid it", async () => {
  const rail = await mount({});
  await act(async () => {
    document.dispatchEvent(new CustomEvent("dsh-activity-sidebar", { detail: { mode: "hidden" } }));
  });
  expect(rail.toggles()).toBe(1);
  await act(async () => {
    rail.home().click();
  });
  expect(rail.toggles()).toBe(2);
});

it("opens the sidebar once for a page that needs it and restores the user's collapse afterwards", async () => {
  const rail = await mount({ collapsed: true });
  await act(async () => {
    document.dispatchEvent(new CustomEvent("dsh-activity-sidebar", { detail: { mode: "expanded" } }));
  });
  expect(rail.toggles()).toBe(1);
  await act(async () => {
    rail.home().click();
  });
  expect(rail.toggles()).toBe(2);
});

it("keeps a manual collapse while the same page stays open", async () => {
  const rail = await mount({});
  await act(async () => {
    document.dispatchEvent(new CustomEvent("dsh-activity-sidebar", { detail: { mode: "expanded" } }));
  });
  document.querySelector("[data-sidebar-collapsed]")?.remove();
  const marker = document.createElement("div");
  marker.setAttribute("data-sidebar-collapsed", "");
  document.body.append(marker);
  await act(async () => {});
  await act(async () => {
    document.dispatchEvent(new CustomEvent("dsh-activity-sidebar", { detail: { mode: "keep" } }));
  });
  expect(rail.toggles()).toBe(0);
});

it("leaves an expanded sidebar where it is", async () => {
  const rail = await mount({});
  await act(async () => {
    rail.home().click();
  });
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
  expect(button.hasAttribute("aria-expanded")).toBe(false);
  expect(button.getAttribute("aria-keyshortcuts")).toBe("Control+Comma");
  expect(button.querySelector('[data-icon="settings"]')).not.toBeNull();
  expect(container.querySelectorAll("button")).toHaveLength(2);
  expect(rail.children["shell.activity.action"]).toEqual({
    kind: "list",
    scope: "root",
  });
  expect(rail.slotCalls).toEqual(expect.arrayContaining([
    expect.arrayContaining(["shell.activity.action", expect.objectContaining({ wide: false, region: "footer" })]),
  ]));
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
  const rail = await mount({ main: () => imageSeat(true) });
  const mark = () => container.querySelector("[data-dsh-activity-mark]");
  expect(container.querySelectorAll("[data-dsh-activity-mark]")).toHaveLength(1);
  expect(mark().dataset.state).toBe("on");
  expect(mark().getAttribute("aria-hidden")).toBe("true");
  stubBox(rail.image(), 48);
  expect(rail.image().getAttribute("aria-current")).toBe("page");
  expect(mark().dataset.state).toBe("on");
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
      rail.bindTip()(rail.home()).onPointerEnter({ currentTarget: rail.home() });
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
      rail.bindTip()(rail.home()).onPointerLeave({ currentTarget: rail.home() });
      vi.advanceTimersByTime(80);
    });
    expect(document.querySelector("[data-dsh-activity-tip]")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it("keeps the image seat empty until a main contribution arrives", async () => {
  const rail = await mount({});
  expect(rail.image()).toBeNull();
  expect(rail.home()).not.toBeNull();
  expect(rail.slotCalls.map(([name]) => name)).toContain("shell.activity.main");
});

it("registers the desktop languages and only alias colors", async () => {
  const rail = await mount({});
  for (const language of ["zh", "en", "ja", "es", "fr", "de", "ru", "pt"]) {
    expect(rail.dictionary[language].home).toEqual(expect.any(String));
    expect(rail.dictionary[language].settings).toEqual(expect.any(String));
    expect(rail.dictionary[language].image).toBeUndefined();
  }
  const style = document.getElementById(
    "dsh-desktop-activity-style",
  ).textContent;
  expect(style).toContain(
    "[data-dsh-activity-footer]{margin-top:auto;gap:8px}",
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
  expect(style).toContain('[data-dsh-activity-rail] [data-slot="shell.activity.main"]');
  expect(style).toContain("display:contents");
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
