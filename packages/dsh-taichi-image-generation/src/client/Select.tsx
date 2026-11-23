/** Theme-aware select shared by filters, forms and canvas controls.
 *  The trigger, filter field and rows are host primitives. The list is a Menu
 *  so placement, outside-click and Escape stay with the host.
 *
 *  `variant` is the only visual switch: `field` fills a form row, `compact`
 *  sits beside a search box, `composer` is a parameter pill, `toolbar` is the
 *  dense canvas chrome. Call sites pass `className` for layout (width in a
 *  grid), not for a second coat of paint. */
import { Children, Fragment, isValidElement, useId, useLayoutEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Button, IconChevronDownOutlineRegular, Input, Menu, MenuItemButton, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './select.module.css'

export interface SelectOption {
  value: string
  label: string
  group?: string
  disabled?: boolean
}

type OptionProps = { value?: string | number; label?: string; children?: ReactNode; disabled?: boolean }

function optionText(node: ReactNode): string {
  return Children.toArray(node).map(child => isValidElement<OptionProps>(child)
    ? optionText(child.props.children)
    : String(child)).join('')
}

/** Keep option/optgroup declarations readable at the call site. */
function optionsFromChildren(children: ReactNode, group?: string, disabled = false): SelectOption[] {
  const result: SelectOption[] = []
  Children.forEach(children, child => {
    if (!isValidElement<OptionProps>(child)) return
    if (child.type === 'optgroup' || child.type === Fragment) {
      result.push(...optionsFromChildren(child.props.children, child.props.label ?? group, disabled || child.props.disabled === true))
    } else if (child.type === 'option') {
      const label = child.props.label ?? optionText(child.props.children)
      result.push({ value: String(child.props.value ?? label), label, group, disabled: disabled || child.props.disabled === true })
    }
  })
  return result
}

export interface SelectProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'value' | 'onChange' | 'children'> {
  value: string
  options?: SelectOption[]
  children?: ReactNode
  variant?: 'field' | 'compact' | 'composer' | 'toolbar'
  /**
   * Add a filter box inside the menu.
   *
   * Only visibility changes: every option keeps its original index, so
   * keyboard order still matches the unfiltered list.
   */
  searchable?: boolean
  /** Per-value second line, e.g. the node count and timestamp of a canvas. */
  optionHint?: (option: SelectOption) => string | undefined
  /** Shown in place of the list when the filter matches nothing. */
  emptyText?: string
  /** Placeholder of the filter box; falls back to the trigger's accessible name. */
  searchPlaceholder?: string
  /**
   * Text for the closed trigger when the selected option's own label is the
   * wrong thing to show there.
   */
  label?: string
  onChange: (value: string) => void
}

function optionLabel(option: SelectOption, hint: string | undefined): ReactNode {
  if (hint === undefined) return option.label
  return <span className={css.optionLabel}>{option.label}<span className={css.optionHint}>{hint}</span></span>
}

export function Select({ value, options: suppliedOptions, children, variant = 'field', searchable = false, optionHint, emptyText, searchPlaceholder, label, onChange, className, disabled, id, onKeyDown, onClick, ...buttonProps }: SelectProps): React.JSX.Element {
  const options = suppliedOptions ?? optionsFromChildren(children)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const generatedId = useId()
  const triggerId = id ?? `dsh-select-${generatedId}`
  const visible = query.trim() === ''
    ? options
    : options.filter(option => `${option.label} ${option.group ?? ''} ${optionHint?.(option) ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const selected = options.find(option => option.value === value) ?? options[0]
  const unavailable = disabled === true || options.every(option => option.disabled === true)

  const close = (): void => { setOpen(false); setQuery('') }
  const choose = (next: string): void => {
    onChange(next)
    close()
  }

  const entries: MenuEntry[] = []
  visible.forEach((option, index) => {
    if (option.group !== undefined && option.group !== visible[index - 1]?.group) {
      entries.push({ type: 'label', id: `group-${option.group}-${index}`, text: option.group })
    }
    entries.push({
      id: option.value,
      label: optionLabel(option, optionHint?.(option)),
      disabled: option.disabled,
    })
  })

  useLayoutEffect(() => {
    if (!open) return
    const list = document.querySelector(`.${css.menuMark}`)
    if (list instanceof HTMLElement) {
      list.setAttribute('data-dsh-select-menu', '')
      list.style.borderRadius = 'var(--dsw-radius-md)'
    }
  }, [open, query, value, visible.length])

  const searchLabel = searchPlaceholder ?? buttonProps['aria-label'] ?? ''

  return <Menu
    open={open}
    portal
    compact
    autoFocus={!searchable}
    minWidthFromAnchor
    className={`${css.host}${variant === 'field' ? ` ${css.field}` : ''}`}
    listClassName={css.menuMark}
    selectedId={value}
    items={searchable ? [] : entries}
    onSelect={choose}
    onClose={close}
    anchor={<Button
      {...buttonProps}
      id={triggerId}
      type="button"
      size={variant === 'field' ? 'md' : 'sm'}
      variant="outline"
      className={`${css.trigger}${className ? ` ${className}` : ''}`}
      data-dsh-select=""
      data-variant={variant}
      data-open={open ? '' : undefined}
      disabled={unavailable}
      aria-haspopup="menu"
      aria-expanded={open}
      title={buttonProps.title ?? (label === undefined ? selected?.label : `${label} · ${selected?.label ?? ''}`.trim())}
      onClick={event => {
        onClick?.(event)
        if (!event.defaultPrevented) setOpen(current => !current)
      }}
      onKeyDown={event => {
        onKeyDown?.(event)
        if (!event.defaultPrevented && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
          event.preventDefault()
          if (!unavailable) setOpen(true)
        }
      }}
    >
      <span className={css.value}>{label ?? selected?.label ?? value}</span>
      <IconChevronDownOutlineRegular size={12} />
    </Button>}
  >
    {searchable ? <>
      <Input
        data-dsh-select-search=""
        value={query}
        placeholder={searchLabel}
        aria-label={searchLabel}
        onChange={event => { setQuery(event.target.value) }}
        onMouseDown={event => { event.stopPropagation() }}
      />
      {visible.length === 0 && emptyText !== undefined ? <span className={css.empty} role="status">{emptyText}</span> : null}
      {visible.map(option => <MenuItemButton
        key={option.value}
        current={option.value === value}
        disabled={option.disabled}
        onSelect={() => { choose(option.value) }}
      >
        {optionLabel(option, optionHint?.(option))}
      </MenuItemButton>)}
    </> : null}
  </Menu>
}
