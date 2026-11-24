// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { SearchInput } from '../packages/taichi-dshmarket/src/client/SearchInput.tsx'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Input: ({ className, value, onChange }) => React.createElement('span', { className },
    React.createElement('input', { value, onChange })),
  Tooltip: ({ children }) => children,
  Switch: ({ label }) => React.createElement('button', { role: 'switch', 'aria-label': label }),
}))

afterEach(() => vi.unstubAllGlobals())

it('keeps clear in the input box when AI search is next to it', () => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.body.appendChild(document.createElement('div'))
  const root = createRoot(container)
  const onCommit = vi.fn()
  const toggle = vi.fn()
  try {
    act(() => root.render(React.createElement(SearchInput, {
      value: 'plugin', onCommit, t: key => key, aiPlacement: 'beside',
      ai: { on: false, toggle, submit: vi.fn(), placeholder: 'Ask AI' },
    })))
    const input = container.querySelector('input')
    const clear = container.querySelector('button[aria-label="clearSearch"]')
    const aiSwitch = container.querySelector('[role="switch"]')
    const inputBox = input.parentElement.parentElement

    // A beside switch shares the row, not the clear button's positioning box.
    expect(inputBox.contains(clear)).toBe(true)
    expect(inputBox.contains(aiSwitch)).toBe(false)
    expect(container.contains(aiSwitch)).toBe(true)

    act(() => clear.click())
    expect(input.value).toBe('')
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('')
    expect(toggle).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(input)
    expect(container.querySelector('button[aria-label="clearSearch"]')).toBeNull()
  } finally {
    act(() => root.unmount())
    container.remove()
  }
})