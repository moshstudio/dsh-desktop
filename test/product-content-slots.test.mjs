import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const jsx = (type, props) => ({ type, props })
const React = { useState: value => [value, () => {}], useRef: current => ({ current }), useEffect() {}, useLayoutEffect() {}, useMemo: fn => fn(), useCallback: fn => fn }
const expand = node => Array.isArray(node) ? node.map(expand) : !node || typeof node !== 'object' ? node : typeof node.type === 'function' ? expand(node.type(node.props)) : { ...node, props: { ...node.props, children: expand(node.props?.children) } }
const flatten = node => Array.isArray(node) ? node.flatMap(flatten) : !node || typeof node !== 'object' ? [node] : [node, ...flatten(node.props?.children)]
async function components(packageName, names, documentElement = { hasAttribute: () => false, dataset: {} }) {
  const text = await readFile(new URL('../node_modules/@deepseek-ai/' + packageName + '/lib/client.js', import.meta.url), 'utf8')
  const source = ts.createSourceFile('client.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const declarations = []
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) declarations.push(node.getText(source))
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && ['SIDEBAR_AUTO_COLLAPSE', 'RIGHTBAR_MAX_RATIO'].includes(node.name.text)) declarations.push('const ' + node.getText(source) + ';')
    ts.forEachChild(node, visit)
  }
  visit(source)
  const context = { react: React, react_jsx_runtime: { jsx, jsxs: jsx, Fragment: 'fragment' }, document: { title: 'Fixture', documentElement }, AppFrame_module_css_default: new Proxy({}, { get: (_, name) => name }), HeroShell_module_css_default: new Proxy({}, { get: (_, name) => name }), HeroFish: () => jsx('fish', {}) }
  return vm.runInNewContext(declarations.join(String.fromCharCode(10)) + ';({' + names.join(',') + '})', context)
}

function activityFrame(AppFrame, { activity, sidebar = 280, viewportWidth = 1400 } = {}) {
  const calls = []
  const frame = AppFrame({
    useStore: selector => selector({ layoutInfo: { viewportWidth, sidebar, rightbar: 400, rightbarTrack: true, rightbarShown: true } }),
    useFoldedLandscape: selector => selector(false),
    useSessions: selector => selector({ byId: {} }),
    usePanelInfo: selector => selector({ activePanelId: null }),
    useActivityRail: activity === undefined ? undefined : selector => selector(activity),
    actions: {},
    t: key => key,
    renderSlot(name, _props, options) {
      calls.push(name)
      if (name === 'shell.activity') return jsx('activity-sentinel', {})
      if (name === 'sidebar') return jsx('sidebar-sentinel', {})
      if (name === 'shell.leading') return jsx('leading-sentinel', {})
      if (name === 'desktop.mode.content') return options.fallback
      return null
    },
  })
  return { calls, nodes: flatten(expand(frame)) }
}

describe('optional product content slots', () => {
  it.each([false, true])('renders the native main/rightbar exactly once with wrapper=%s', async contribution => {
    const { AppFrame } = await components('dsh-client-ui-layout', ['AppFrame', 'MainPanel', 'CenterColumn', 'RightbarColumn', 'DragHandle', 'DocumentTitle', 'computeColumns', 'clampWidth'])
    const calls = []
    let wrapperProps
    const frame = AppFrame({ useStore: selector => selector({ layoutInfo: { viewportWidth: 1400, sidebar: 280, rightbar: 400, rightbarTrack: true, rightbarShown: true } }), useFoldedLandscape: selector => selector(false), useSessions: selector => selector({ byId: {} }), usePanelInfo: selector => selector({ activePanelId: null }), actions: {}, t: key => key,
      renderSlot(name, props, options) {
        calls.push(name)
        if (name === 'main') return jsx('main-sentinel', {})
        if (name === 'rightbar') return jsx('rightbar-sentinel', {})
        if (name === 'desktop.mode.content') {
          wrapperProps = props
          return contribution ? jsx('product-wrapper', { columns: props.columns, children: [props.work, props.resizeHandle] }) : options.fallback
        }
        return null
      }
    })
    const nodes = flatten(expand(frame))
    expect(nodes.filter(node => node?.type === 'main-sentinel')).toHaveLength(1)
    expect(nodes.filter(node => node?.type === 'rightbar-sentinel')).toHaveLength(1)
    expect(nodes.filter(node => node?.type === 'product-wrapper')).toHaveLength(contribution ? 1 : 0)
    expect(calls.filter(name => name === 'rightbar')).toHaveLength(1)
    expect(calls.filter(name => name === 'main')).toHaveLength(1)
    expect(wrapperProps.columns).toContain('minmax(0px, 400px)')
    const center = nodes.find(node => node?.props?.className === 'centerCol')
    const rightbar = nodes.find(node => node?.props?.className === 'rightbarCol')
    expect(center.props.style).toEqual(contribution ? { gridColumn: 1 } : undefined)
    expect(rightbar.props.style).toEqual(contribution ? { gridColumn: 2 } : undefined)
    expect(wrapperProps.resizeHandle).toBeTruthy()
  })
  it.each([false, true])('keeps the localized hero headline fallback with contribution=%s', async contribution => {
    const { HeroShell } = await components('dsh-client-ui-conversation', ['HeroShell'])
    const calls = []
    const view = HeroShell({ t: key => ({ 'hero.headline': 'Welcome', 'hero.preview': 'Preview' }[key]), renderSlot: (name, props, options) => { calls.push(name); return name === 'conversation.hero.brand.title' && contribution ? 'Product headline' : options?.fallback }, children: 'Composer' })
    const nodes = flatten(expand(view))
    expect(nodes).toContain(contribution ? 'Product headline' : 'Welcome')
    expect(nodes).toContain('Preview')
    expect(nodes).toContain('Composer')
    expect(calls.filter(name => name === 'conversation.hero.brand.title')).toHaveLength(1)
  })

  it('shifts only the activity column, drag handle and leading seat', async () => {
    const documentElement = { hasAttribute: () => false, dataset: {} }
    const { AppFrame } = await components('dsh-client-ui-layout', ['AppFrame', 'MainPanel', 'CenterColumn', 'RightbarColumn', 'DragHandle', 'DocumentTitle', 'computeColumns', 'clampWidth'], documentElement)
    const absent = activityFrame(AppFrame)
    const empty = activityFrame(AppFrame, { activity: false })
    const present = activityFrame(AppFrame, { activity: true })
    const gridOf = nodes => nodes.find(node => typeof node?.props?.style?.gridTemplateColumns === 'string')
    const dragOf = nodes => nodes.find(node => node?.props?.['data-side'] === 'sidebar')
    expect(gridOf(empty.nodes).props.style.gridTemplateColumns).toBe(gridOf(absent.nodes).props.style.gridTemplateColumns)
    expect(dragOf(empty.nodes).props.style.left).toBe(dragOf(absent.nodes).props.style.left)
    expect(absent.nodes.filter(node => node?.props?.['data-shell-activity'])).toHaveLength(0)
    expect(absent.calls.filter(name => name === 'sidebar')).toHaveLength(1)
    expect(present.calls.filter(name => name === 'sidebar')).toHaveLength(1)
    expect(present.calls.filter(name => name === 'shell.activity')).toHaveLength(1)
    expect(present.nodes.filter(node => node?.type === 'activity-sentinel')).toHaveLength(1)
    expect(gridOf(present.nodes).props.style.gridTemplateColumns).toBe(`48px ${gridOf(absent.nodes).props.style.gridTemplateColumns}`)
    expect(dragOf(present.nodes).props.style.left).toBe(dragOf(absent.nodes).props.style.left + 48)
    const seat = (nodes, className) => nodes.find(node => node?.props?.className === className)
    expect(seat(absent.nodes, 'sidebarCol').props.style).toBeUndefined()
    expect(seat(absent.nodes, 'centerCol').props.style).toBeUndefined()
    expect(seat(absent.nodes, 'rightbarCol').props.style).toBeUndefined()
    expect(present.nodes.find(node => node?.props?.['data-shell-activity']).props.style.gridArea).toBe('1 / 1')
    expect(seat(present.nodes, 'sidebarCol').props.style.gridArea).toBe('1 / 2')
    expect(seat(present.nodes, 'centerCol').props.style.gridArea).toBe('1 / 3')
    expect(seat(present.nodes, 'rightbarCol').props.style.gridArea).toBe('1 / 4')
    documentElement.dataset.platform = 'darwin'
    const leadingOf = nodes => nodes.find(node => node?.props?.['data-shell-leading'])
    expect(leadingOf(activityFrame(AppFrame, { sidebar: 0 }).nodes).props.style).toBeUndefined()
    expect(leadingOf(activityFrame(AppFrame, { activity: true, sidebar: 0 }).nodes).props.style).toEqual({ marginInlineStart: 48 })
  })
})
