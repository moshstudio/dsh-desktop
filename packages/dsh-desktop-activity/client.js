window.__ModuleLoader__.load({
  id: "dsh-desktop-activity",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const {
      IconSettingsOutlineMedium,
    } = require("@deepseek-ai/dsh-client-ui-primitives");
    const CLOSED = false;
    const STYLE_ID = "dsh-desktop-activity-style";
    const STYLE_VERSION = "tip-4";
    // Shared skin and entrance fade for desktop icon tooltips. The account
    // button passes the same class to Tooltip. Placement stays with each
    // caller, so the fade does not set transform.
    const DESKTOP_TOOLTIP = "dsh-desktop-tooltip";
    const TIP_SHOW_MS = 280;
    const TIP_HIDE_MS = 80;
    const NS = "desktop-activity";

    const copy = {
      zh: { home: "主页", image: "图片", settings: "设置" },
      en: { home: "Home", image: "Image", settings: "Settings" },
      ja: { home: "ホーム", image: "画像", settings: "設定" },
      es: { home: "Inicio", image: "Imagen", settings: "Ajustes" },
      fr: { home: "Accueil", image: "Image", settings: "Réglages" },
      de: { home: "Start", image: "Bild", settings: "Einstellungen" },
      ru: { home: "Главная", image: "Изображение", settings: "Настройки" },
      pt: { home: "Início", image: "Imagem", settings: "Configurações" },
    };

    const studioGate = {
      current: null,
      listeners: new Set(),
      getSnapshot() {
        return this.current;
      },
      subscribe(listener) {
        this.listeners.add(listener);
        return () => {
          this.listeners.delete(listener);
        };
      },
      set(studio) {
        this.current = studio ?? null;
        for (const listener of this.listeners) listener();
      },
    };

    function installStyles() {
      // Hover, press, and selection share Button's interactive washes. The rail
      // uses the conversation sidebar fill so the icon column and the session
      // column share one surface. The divider is a gradient hairline, not a
      // border: a border cannot fade, and border-secondary is not a defined
      // token. The leading mark is one rail element so switching slides it;
      // per-button ::before cannot move. It scales in when a selection appears
      // and out when the rail has none. Glyphs cross-fade when their shape
      // changes. prefers-reduced-motion drops the motion.
      let style = document.getElementById(STYLE_ID);
      if (style?.dataset.version === STYLE_VERSION) return;
      if (!style) {
        style = document.createElement("style");
        style.id = STYLE_ID;
        document.head.appendChild(style);
      }
      style.dataset.pluginCss = "dsh-desktop-activity";
      style.dataset.version = STYLE_VERSION;
      style.textContent = `
        [data-dsh-activity-rail]{box-sizing:border-box;position:relative;display:flex;flex-direction:column;align-items:center;gap:4px;width:48px;height:100%;padding:8px 0;background:var(--dsw-specific-sidebar-fill)}
        [data-dsh-activity-rail]::after{content:"";position:absolute;inset-block:0;inset-inline-end:0;width:1px;pointer-events:none;background:linear-gradient(to bottom,transparent,var(--dsw-alias-border-l2) 20px,var(--dsw-alias-border-l2) calc(100% - 20px),transparent)}
        [data-dsh-activity-rail] button{position:relative;display:flex;align-items:center;justify-content:center;width:36px;height:36px;padding:0;border:0;border-radius:10px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background-color .2s ease,color .2s ease}
        [data-dsh-activity-rail] button svg{display:block;width:18px;height:18px}
        [data-dsh-activity-rail] button > span{display:flex;align-items:center;justify-content:center;width:18px;height:18px}
        [data-dsh-activity-rail] button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
        [data-dsh-activity-rail] button:active{background:var(--dsw-alias-interactive-bg-active)}
        [data-dsh-activity-rail] :is(button[aria-current="page"],button[aria-expanded="true"],button[data-selected="true"]){background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}
        [data-dsh-activity-mark]{position:absolute;z-index:1;inset-inline-start:1px;top:0;width:3px;height:16px;border-radius:2px;background:var(--dsw-alias-label-primary);pointer-events:none;opacity:0;scale:1 .4;transform-origin:center;transition:transform .34s cubic-bezier(.22,1,.36,1),opacity .18s ease,scale .22s cubic-bezier(.22,1,.36,1)}
        [data-dsh-activity-mark][data-state="on"]{opacity:1;scale:1 1}
        @keyframes dsh-activity-glyph{from{opacity:.25}to{opacity:1}}
        [data-dsh-activity-rail] [data-dsh-activity-glyph]{animation:dsh-activity-glyph .22s cubic-bezier(.22,1,.36,1)}
        .${DESKTOP_TOOLTIP}[role="tooltip"]{position:fixed;z-index:1100;padding:6px 16px;border-radius:var(--dsw-radius-lg,16px);background:var(--dsw-alias-tooltip-bg);color:var(--dsw-static-neutral-bluish-00);font-size:13px;line-height:20px;pointer-events:none;animation:dsh-desktop-tooltip-in .16s cubic-bezier(.22,1,.36,1)}
        @keyframes dsh-desktop-tooltip-in{from{opacity:0}to{opacity:1}}
        [data-dsh-activity-tip]{position:fixed;z-index:1100;white-space:nowrap;pointer-events:none;transform:translateY(-50%)}
        [data-dsh-activity-footer]{margin-top:auto;display:flex;flex-direction:column;align-items:center;gap:8px}
        [data-dsh-activity-footer] [data-dsh-taichi-account-entry]{padding:0}
        [data-dsh-activity-rail] button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
        html[data-platform=darwin]:not([data-fullscreen=true]) [data-dsh-activity-rail]{padding-top:var(--dsh-frame-top-clearance,48px)}
        @media (prefers-reduced-motion:reduce){[data-dsh-activity-rail] button,[data-dsh-activity-mark],[data-dsh-activity-glyph],.${DESKTOP_TOOLTIP}[role="tooltip"]{transition:none;animation:none}}
      `;
    }

    const GLYPH = {
      viewBox: "0 0 16 16",
      width: 18,
      height: 18,
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.3,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true",
    };

    function icon(kind, selected) {
      let glyph;
      if (kind === "settings")
        glyph = React.createElement(IconSettingsOutlineMedium, { size: 18 });
      else if (kind === "home") {
        // Filled house only while Home is the current place. The door is a hole,
        // so the glyph stays a house instead of a solid pin.
        glyph = selected
          ? React.createElement(
              "svg",
              { ...GLYPH, fill: "currentColor", stroke: "none" },
              React.createElement("path", {
                fillRule: "evenodd",
                d: "M8 2.35 13.45 6.7V12.6c0 .5-.4.9-.9.9H3.45c-.5 0-.9-.4-.9-.9V6.7L8 2.35Zm-1.05 7.05h2.1V13.5h-2.1V9.4Z",
              }),
            )
          : React.createElement(
              "svg",
              GLYPH,
              React.createElement("path", {
                d: "M2.2 7.35 8 2.75l5.8 4.6",
                fill: "none",
              }),
              React.createElement("path", {
                d: "M4.05 6.85V12.9h7.9V6.85",
                fill: "none",
              }),
              React.createElement("path", {
                d: "M6.9 12.9V9.35h2.2v3.55",
                fill: "none",
              }),
            );
      } else {
        // Filled frame with the sun and skyline cut out, same idea as the house.
        glyph = selected
          ? React.createElement(
              "svg",
              { ...GLYPH, fill: "currentColor", stroke: "none" },
              React.createElement("path", {
                fillRule: "evenodd",
                d: "M3.85 3.15h8.3a1.7 1.7 0 0 1 1.7 1.7v6.3a1.7 1.7 0 0 1-1.7 1.7h-8.3a1.7 1.7 0 0 1-1.7-1.7v-6.3a1.7 1.7 0 0 1 1.7-1.7ZM5.45 5.15a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8ZM3.05 12.2V11.55L5.85 8.8l1.8 1.6 2.25-2.15 3.05 2.95V12.2H3.05Z",
              }),
            )
          : React.createElement(
              "svg",
              GLYPH,
              React.createElement("rect", {
                x: 2.15,
                y: 3.15,
                width: 11.7,
                height: 9.7,
                rx: 1.7,
                fill: "none",
              }),
              React.createElement("circle", {
                cx: 5.45,
                cy: 6.05,
                r: 0.9,
                fill: "currentColor",
                stroke: "none",
              }),
              React.createElement("path", {
                d: "M3.05 11.55 5.85 8.8l1.8 1.6 2.25-2.15 3.05 2.95",
                fill: "none",
              }),
            );
      }
      // Remount when the shape changes so the cross-fade runs again. Settings
      // keeps one glyph; its select state is the wash and the sliding mark.
      return React.createElement(
        "span",
        {
          "data-dsh-activity-glyph": "",
          key: kind === "settings" ? "settings" : selected ? "on" : "off",
        },
        glyph,
      );
    }

    // Several buttons can be current at once (the page and an open dialog).
    // The mark follows a newly selected button, then stays there across
    // layout-only updates so a resize does not bounce it back.
    function pickActivityMark(selected, previousSelected, previousTarget) {
      if (selected.length === 0) return null;
      if (selected.length === 1) return selected[0];
      const appeared = selected.filter(
        (button) => !previousSelected.includes(button),
      );
      if (appeared.length > 0) return appeared[appeared.length - 1];
      if (previousTarget && selected.includes(previousTarget))
        return previousTarget;
      return selected[selected.length - 1];
    }

    function placeActivityMark(rail, memory) {
      const mark = rail.querySelector("[data-dsh-activity-mark]");
      if (!mark) return;
      const selected = [
        ...rail.querySelectorAll(
          '[data-dsh-activity][aria-current="page"],[data-dsh-activity][aria-expanded="true"],[data-dsh-activity][data-selected="true"]',
        ),
      ];
      const target = pickActivityMark(
        selected,
        memory.selected,
        memory.target,
      );
      memory.selected = selected;
      memory.target = target;
      if (!target) {
        mark.dataset.state = "off";
        return;
      }
      const markHeight = mark.offsetHeight || 16;
      const y = Math.round(
        target.offsetTop + (target.offsetHeight - markHeight) / 2,
      );
      const next = `translateY(${y}px)`;
      // The first placement is the current icon. Snapping avoids a slide
      // from the top of the rail on load; later updates use the stylesheet
      // transition.
      if (mark.dataset.ready !== "true") {
        mark.style.transition = "none";
        mark.style.transform = next;
        mark.dataset.state = "on";
        mark.dataset.ready = "true";
        mark.getBoundingClientRect();
        mark.style.transition = "";
        return;
      }
      mark.style.transform = next;
      mark.dataset.state = "on";
    }

    // settings.launcher is the single seat that replaces the sidebar gear.
    // The account button is a separate shell.activity.action. The settings
    // shell (panel, connection, update) stays in sidebar.settings.
    const settingsGate = {
      current: null,
      listeners: new Set(),
      getSnapshot() {
        return this.current;
      },
      subscribe(listener) {
        this.listeners.add(listener);
        return () => {
          this.listeners.delete(listener);
        };
      },
      set(next) {
        const prev = this.current;
        if (prev === next) return;
        if (
          prev &&
          next &&
          prev.settingsOpen === next.settingsOpen &&
          prev.aria === next.aria &&
          prev.open === next.open
        )
          return;
        this.current = next;
        for (const listener of this.listeners) listener();
      },
    };

    function SettingsRelay({ openSettings, settingsOpen, settingsShortcut }) {
      const openRef = React.useRef(openSettings);
      openRef.current = openSettings;
      const open = React.useRef(null);
      if (!open.current)
        open.current = () => {
          openRef.current?.();
        };
      React.useLayoutEffect(() => {
        settingsGate.set({
          open: open.current,
          settingsOpen: settingsOpen === true,
          aria: settingsShortcut?.aria,
        });
      }, [settingsOpen, settingsShortcut]);
      React.useLayoutEffect(
        () => () => {
          settingsGate.set(null);
        },
        [],
      );
      return null;
    }

    function useActivityTip() {
      const timer = React.useRef(null);
      const visible = React.useRef(false);
      const fromPointer = React.useRef(false);
      const [tip, setTip] = React.useState(null);
      const clear = React.useCallback(() => {
        if (timer.current === null) return;
        clearTimeout(timer.current);
        timer.current = null;
      }, []);
      React.useEffect(() => clear, [clear]);
      const place = React.useCallback((button) => {
        const label = button.getAttribute("aria-label");
        if (!label || !button.isConnected) return;
        const box = button.getBoundingClientRect();
        visible.current = true;
        setTip({
          label,
          top: Math.round(box.top + box.height / 2),
          left: Math.round(box.right + 8),
        });
      }, []);
      const open = React.useCallback(
        (button) => {
          clear();
          if (visible.current) {
            place(button);
            return;
          }
          timer.current = setTimeout(() => {
            timer.current = null;
            place(button);
          }, TIP_SHOW_MS);
        },
        [clear, place],
      );
      const close = React.useCallback(() => {
        clear();
        timer.current = setTimeout(() => {
          timer.current = null;
          visible.current = false;
          setTip(null);
        }, TIP_HIDE_MS);
      }, [clear]);
      const dismiss = React.useCallback(() => {
        clear();
        visible.current = false;
        setTip(null);
      }, [clear]);
      const bind = React.useCallback(
        (props) => ({
          ...props,
          onPointerDown: (event) => {
            fromPointer.current = true;
            props.onPointerDown?.(event);
          },
          onPointerEnter: (event) => {
            props.onPointerEnter?.(event);
            open(event.currentTarget);
          },
          onPointerLeave: (event) => {
            props.onPointerLeave?.(event);
            close();
          },
          onFocus: (event) => {
            props.onFocus?.(event);
            if (fromPointer.current) {
              fromPointer.current = false;
              return;
            }
            open(event.currentTarget);
          },
          onBlur: (event) => {
            props.onBlur?.(event);
            close();
          },
          onClick: (event) => {
            dismiss();
            props.onClick?.(event);
          },
        }),
        [close, dismiss, open],
      );
      return [tip, bind];
    }

    function ActivityRail({ t, layout, renderSlot }) {
      const railRef = React.useRef(null);
      const markMemory = React.useRef({ target: null, selected: [] });
      const [tip, bindTip] = useActivityTip();
      React.useLayoutEffect(installStyles);
      const studio = React.useSyncExternalStore(
        studioGate.subscribe.bind(studioGate),
        studioGate.getSnapshot.bind(studioGate),
      );
      const settings = React.useSyncExternalStore(
        settingsGate.subscribe.bind(settingsGate),
        settingsGate.getSnapshot.bind(settingsGate),
      );
      const panelOpen = React.useSyncExternalStore(
        (listener) => (studio ? studio.subscribe(listener) : () => {}),
        () => (studio ? studio.getSnapshot().panelOpen === true : CLOSED),
      );
      const homeCurrent = !panelOpen;
      React.useLayoutEffect(() => {
        const rail = railRef.current;
        if (!rail) return undefined;
        const sync = () => placeActivityMark(rail, markMemory.current);
        sync();
        let observer;
        if (typeof ResizeObserver === "function") {
          observer = new ResizeObserver(sync);
          observer.observe(rail);
          for (const button of rail.querySelectorAll("[data-dsh-activity]"))
            observer.observe(button);
        }
        return () => observer?.disconnect();
      }, [homeCurrent, panelOpen, settings, studio]);
      const showSidebar = () => {
        studio?.close();
        if (document.querySelector("[data-sidebar-collapsed]"))
          layout.toggleSidebar();
      };
      return React.createElement(
        "nav",
        {
          "data-dsh-activity-rail": "true",
          "aria-label": t("home"),
          ref: railRef,
        },
        React.createElement("span", {
          "data-dsh-activity-mark": "",
          "aria-hidden": "true",
        }),
        tip &&
          React.createElement(
            "span",
            {
              className: DESKTOP_TOOLTIP,
              "data-dsh-activity-tip": "",
              role: "tooltip",
              style: { top: `${tip.top}px`, left: `${tip.left}px` },
            },
            tip.label,
          ),
        React.createElement(
          "button",
          bindTip({
            type: "button",
            "data-dsh-activity": "home",
            "aria-label": t("home"),
            "aria-current": homeCurrent ? "page" : undefined,
            onClick: showSidebar,
          }),
          icon("home", homeCurrent),
        ),
        studio &&
          React.createElement(
            "button",
            bindTip({
              type: "button",
              "data-dsh-activity": "image",
              "aria-label": t("image"),
              "aria-current": panelOpen ? "page" : undefined,
              onClick: () => {
                studio.open();
              },
            }),
            icon("image", panelOpen),
          ),
        React.createElement(
          "div",
          { "data-dsh-activity-footer": "" },
          typeof renderSlot === "function"
            ? renderSlot("shell.activity.action", { wide: false })
            : null,
          settings &&
            React.createElement(
              "button",
              bindTip({
                type: "button",
                "data-dsh-activity": "settings",
                "aria-label": t("settings"),
                "aria-haspopup": "dialog",
                "aria-expanded": settings.settingsOpen,
                "aria-keyshortcuts": settings.aria,
                onClick: () => {
                  settings.open();
                },
              }),
              icon("settings"),
            ),
        ),
      );
    }

    const inject = ["locale", "slots", "layout"];
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, copy));
      const t = ctx.locale.bind(NS);
      if (typeof ctx.inject === "function") {
        ctx.inject(["taichiImageStudio"], (scoped) => {
          studioGate.set(scoped.taichiImageStudio);
          return () => {
            studioGate.set(null);
          };
        });
      }
      ctx.slots.inject("shell.activity", () =>
        ctx.slots.register(
          {
            name: "shell.activity",
            locale: NS,
            children: {
              // Icon actions pinned to the bottom of the rail. List, root scope, only receives wide.
              // No occupants by default; settings stays a rail-owned button beside this seat.
              "shell.activity.action": { kind: "list", scope: "root" },
            },
            inject: () => ({ t, layout: ctx.layout }),
          },
          ActivityRail,
        ),
      );
      ctx.slots.inject("settings.launcher", () =>
        ctx.slots.register(
          {
            name: "settings.launcher",
          },
          SettingsRelay,
        ),
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.studioGate = studioGate;
    return module.exports;
  },
});
