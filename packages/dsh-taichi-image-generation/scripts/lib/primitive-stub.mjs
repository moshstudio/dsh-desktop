/**
 * Enough of the host primitives for jsdom smokes.
 *
 * The real package pulls CSS and optional peers the smoke realm does not load.
 * Select, settings dialogs and icon buttons only need the DOM these checks
 * query: a portaled menu, menuitem rows, and icons that render as nothing.
 */

export function primitiveControls (react, reactDom) {
  const Menu = ({ open, anchor, items = [], children, onSelect, onClose, listClassName, className }) => {
    react.useEffect(() => {
      if (!open) return undefined
      const onKey = (event) => {
        if (event.key === 'Escape') {
          document.querySelector('[data-dsh-select][data-open]')?.focus()
          onClose?.()
          return
        }
        if (event.key !== 'End' && event.key !== 'Home') return
        const list = document.querySelector('[data-dsh-select-menu]')
        if (list === null || !list.contains(document.activeElement)) return
        const buttons = [...list.querySelectorAll('[role="menuitem"]')]
        const target = event.key === 'End' ? buttons[buttons.length - 1] : buttons[0]
        target?.focus()
      }
      document.addEventListener('keydown', onKey)
      return () => { document.removeEventListener('keydown', onKey) }
    }, [open, onClose])
    const rows = items
      .filter(item => item?.type !== 'label')
      .map(item => react.createElement('button', {
        key: item.id,
        type: 'button',
        role: 'menuitem',
        disabled: item.disabled === true,
        onClick: () => { onSelect?.(item.id) },
      }, item.label))
    const list = open
      ? reactDom.createPortal(react.createElement('div', {
        className: listClassName,
        role: 'menu',
      }, ...rows, children), document.body)
      : null
    return react.createElement('span', { className }, anchor, list)
  }

  return {
    Menu,
    MenuItemButton: ({ children, onSelect, disabled, current, ...rest }) => react.createElement('button', {
      type: 'button',
      role: 'menuitem',
      disabled,
      'aria-current': current === true ? 'true' : undefined,
      onClick: () => { onSelect?.() },
      ...rest,
    }, children),
    Input: ({ className, ...rest }) => react.createElement('span', { className }, react.createElement('input', rest)),
    Modal: ({ open, title, description, children, footer, closeLabel, onClose }) => open === false ? null : react.createElement('div', {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': title,
    },
    react.createElement('h2', null, title),
    description === undefined ? null : react.createElement('p', null, description),
    children,
    footer ?? null,
    react.createElement('button', { type: 'button', 'aria-label': closeLabel, onClick: onClose }, closeLabel),
    ),
    Checkbox: ({ checked, onChange, label, disabled, className }) => react.createElement('label', { className },
      react.createElement('input', {
        type: 'checkbox',
        checked,
        disabled,
        onChange: (event) => { onChange?.(event.target.checked) },
      }),
      label,
    ),
  }
}

/** Unknown `Icon*` exports render nothing. Named controls stay as given. */
export function withPrimitiveIcons (controls) {
  const icon = () => null
  return new Proxy(controls, {
    get (target, prop, receiver) {
      if (Reflect.has(target, prop)) return Reflect.get(target, prop, receiver)
      if (typeof prop === 'string' && prop.startsWith('Icon')) return icon
      return undefined
    },
  })
}
