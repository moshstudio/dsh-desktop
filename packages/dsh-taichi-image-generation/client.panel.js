window.__ModuleLoader__.load({
  id: 'dsh-taichi-image-generation',
  chunk: 'client.panel.js',
  factory: (require) => {
    const React = require('react')
    const {
      Button,
      IconChevronDownOutlineRegular,
      IconCloseOutlineRegular,
      IconDownloadOutlineRegular,
      IconFullscreenOutlineRegular,
      IconRefreshOutlineRegular,
      IconSparkleRegular,
      IconUserOutlineRegular,
      ImageLightbox,
      Menu,
      SegmentedControl,
      Tag,
      TextShimmer
    } = require('@deepseek-ai/dsh-client-ui-primitives')
    const { useEffect, useRef, useState } = React
    const h = React.createElement
    const PANEL = 'desktop-image'
    const ACCOUNT_PANEL = 'desktop-account'
    const HISTORY_LIMIT = 8

    function aspectsOf(model) {
      const seen = []
      for (const item of model?.sizes ?? []) {
        if (typeof item?.aspect_ratio === 'string' && !seen.includes(item.aspect_ratio)) seen.push(item.aspect_ratio)
      }
      return seen.length > 0 ? seen : ['1:1']
    }

    function qualitiesOf(model, aspect) {
      const seen = []
      for (const item of model?.sizes ?? []) {
        if (item?.aspect_ratio === aspect && typeof item.quality === 'string' && !seen.includes(item.quality)) seen.push(item.quality)
      }
      return seen.length > 0 ? seen : ['1k']
    }

    function billedSelection(model, aspect, quality) {
      const row = (model?.sizes ?? []).find(item => item.aspect_ratio === aspect && item.quality === quality)
        ?? (model?.sizes ?? []).find(item => item.aspect_ratio === aspect)
      const size = row?.size || '1024x1024'
      const tier = row?.quality || quality
      const mapped = model?.quality_map?.[tier]
      return { model: typeof mapped === 'string' && mapped !== '' ? mapped : model.id, size }
    }

    async function callApi(path, payload, signal) {
      const response = await fetch(path, {
        method: payload ? 'POST' : 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        signal,
        ...(payload ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) } : {})
      })
      const text = await response.text()
      let data = {}
      try { data = text ? JSON.parse(text) : {} } catch { throw { code: 'UNAVAILABLE' } }
      if (!response.ok) throw data.code ? data : { code: 'UNAVAILABLE' }
      return data
    }

    function downloadImage(src) {
      const anchor = document.createElement('a')
      anchor.href = src
      anchor.download = 'taichi-image.png'
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
    }

    function DrawIcon({ size }) {
      return h(IconSparkleRegular, { size })
    }

    function Choice({ label, named, children }) {
      return h('div', { className: 'dshTaichiImageChoice' },
        h('span', { className: 'dshTaichiImageChoiceLabel', 'aria-hidden': named ? 'true' : undefined }, label),
        children)
    }

    function statusText(text, live) {
      return h('p', { className: 'dshTaichiImageStatus', role: 'status', 'aria-live': live ? 'polite' : undefined }, text)
    }

    function DrawPanel({ t, onClose, onSignIn }) {
      const [catalog, setCatalog] = useState(null)
      const [prompt, setPrompt] = useState('')
      const [modelId, setModelId] = useState('')
      const [aspect, setAspect] = useState('1:1')
      const [quality, setQuality] = useState('1k')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [results, setResults] = useState([])
      const [activeId, setActiveId] = useState('')
      const [lightbox, setLightbox] = useState(false)
      const [modelOpen, setModelOpen] = useState(false)
      const busyRef = useRef(false)
      const generateAbort = useRef(null)
      const sequence = useRef(0)
      useEffect(() => {
        const controller = new AbortController()
        void callApi('/api/taichi-image.models', null, controller.signal).then(data => {
          if (controller.signal.aborted) return
          const models = (data.models ?? []).filter(model => model.show_in_picker !== false)
          setCatalog({ signedIn: data.signedIn === true, models })
          const first = models[0]
          if (first) {
            setModelId(first.id)
            const nextAspect = aspectsOf(first)[0]
            setAspect(nextAspect)
            setQuality(qualitiesOf(first, nextAspect)[0])
          }
        }, () => { if (!controller.signal.aborted) setError('LOAD_FAILED') })
        return () => controller.abort()
      }, [])
      useEffect(() => () => { generateAbort.current?.abort() }, [])
      const model = catalog?.models?.find(item => item.id === modelId) ?? catalog?.models?.[0]
      const aspects = aspectsOf(model)
      const qualities = qualitiesOf(model, aspect)
      const current = results.find(item => item.id === activeId) ?? null
      const applyModel = next => {
        setModelId(next.id)
        const nextAspect = aspectsOf(next)[0]
        setAspect(nextAspect)
        setQuality(qualitiesOf(next, nextAspect)[0])
      }
      const generate = async event => {
        event?.preventDefault?.()
        if (busyRef.current || !model || prompt.trim() === '') return
        const controller = new AbortController()
        generateAbort.current = controller
        busyRef.current = true
        setBusy(true)
        setError('')
        setLightbox(false)
        try {
          const choice = billedSelection(model, aspect, quality)
          const result = await callApi('/api/taichi-image.generate', { prompt, model: choice.model, size: choice.size }, controller.signal)
          if (controller.signal.aborted) return
          const src = `data:${result.media_type || 'image/png'};base64,${result.b64_json}`
          const id = `result-${sequence.current += 1}`
          setResults(previous => [{ id, src }, ...previous].slice(0, HISTORY_LIMIT))
          setActiveId(id)
        } catch (failure) {
          if (controller.signal.aborted || failure?.name === 'AbortError') return
          setError(failure?.code || 'UNAVAILABLE')
        } finally {
          if (generateAbort.current === controller) generateAbort.current = null
          busyRef.current = false
          setBusy(false)
        }
      }
      const optionControl = (id, label, value, options, onChange) => {
        if (options.length < 2) return h(Choice, { label }, h(Tag, { tone: 'neutral' }, value))
        return h(Choice, { label, named: true }, h(SegmentedControl, {
          id,
          label,
          value,
          disabled: busy,
          options: options.map(item => ({ value: item, label: item })),
          onChange
        }))
      }
      const modelControl = !model ? null : catalog.models.length < 2
        ? h(Choice, { label: t('model') }, h(Tag, { tone: 'neutral' }, model.name || model.id))
        : h(Choice, { label: t('model') }, h(Menu, {
          open: modelOpen,
          portal: true,
          align: 'start',
          selectedId: model.id,
          minWidthFromAnchor: true,
          onClose: () => setModelOpen(false),
          onSelect: id => {
            setModelOpen(false)
            const next = catalog.models.find(item => item.id === id)
            if (next && next.id !== model.id) applyModel(next)
          },
          items: catalog.models.map(item => ({ id: item.id, label: item.name || item.id })),
          anchor: h(Button, {
            type: 'button',
            variant: 'outline',
            size: 'sm',
            disabled: busy,
            'aria-haspopup': 'menu',
            'aria-expanded': modelOpen,
            onClick: () => setModelOpen(open => !open)
          }, model.name || model.id, h(IconChevronDownOutlineRegular, { size: 16 }))
        }))
      let stage
      if (!catalog) {
        stage = error
          ? h('p', { className: 'dshTaichiImageStatus dshTaichiImageError', role: 'alert' }, t(error))
          : statusText(t('loading'))
      } else if (!catalog.signedIn) {
        stage = h('div', { className: 'dshTaichiImageEmpty' },
          statusText(t('signIn')),
          h(Button, { type: 'button', variant: 'primary', icon: h(IconUserOutlineRegular, { size: 16 }), onClick: onSignIn }, t('signInAction')))
      } else if (!model) {
        stage = statusText(t('empty'))
      } else if (!current) {
        stage = busy
          ? statusText(h(TextShimmer, { active: true }, t('generating')), true)
          : statusText(t('hint'))
      } else {
        stage = h('div', { className: 'dshTaichiImageCanvas', 'data-generating': busy ? 'true' : 'false' },
          h('button', { type: 'button', className: 'dshTaichiImagePreview', onClick: () => setLightbox(true) },
            h('img', { className: 'dshTaichiImageResult', alt: t('result'), src: current.src })),
          busy && statusText(h(TextShimmer, { active: true }, t('generating')), true),
          h('div', { className: 'dshTaichiImageResultActions' },
            h(Button, { type: 'button', variant: 'outline', size: 'sm', icon: h(IconDownloadOutlineRegular, { size: 16 }), onClick: () => downloadImage(current.src) }, t('download')),
            h(Button, { type: 'button', variant: 'ghost', size: 'sm', disabled: busy || prompt.trim() === '', icon: h(IconRefreshOutlineRegular, { size: 16 }), onClick: () => { void generate() } }, t('regenerate')),
            h(Button, { type: 'button', variant: 'ghost', size: 'sm', icon: h(IconFullscreenOutlineRegular, { size: 16 }), onClick: () => setLightbox(true) }, t('expand'))))
      }
      return h('section', { className: 'dshTaichiImagePanel', 'aria-label': t('title') },
        h('header', { className: 'dshTaichiImageToolbar' },
          h('h2', { className: 'dshTaichiImageTitle' }, t('title')),
          h(Button, {
            type: 'button',
            variant: 'ghost',
            size: 'sm',
            icon: h(IconCloseOutlineRegular, { size: 16 }),
            onClick: onClose
          }, t('close'))),
        h('div', { className: 'dshTaichiImageBody' },
          h('div', { className: 'dshTaichiImageStage', 'aria-busy': busy || undefined }, stage),
          results.length > 0 && h('div', { className: 'dshTaichiImageStrip', role: 'list', 'aria-label': t('history') },
            results.map(item => h('div', { key: item.id, role: 'listitem' },
              h('button', {
                type: 'button',
                className: 'dshTaichiImageThumb',
                'aria-current': item.id === activeId ? 'true' : undefined,
                'aria-label': t('result'),
                disabled: busy,
                onClick: () => setActiveId(item.id)
              }, h('img', { alt: '', src: item.src }))))),
          catalog && error && h('p', { className: 'dshTaichiImageStatus dshTaichiImageError', role: 'alert' }, t(error)),
          model && h('form', { className: 'dshTaichiImageComposer', onSubmit: generate },
            h('textarea', {
              className: 'dshTaichiImagePrompt',
              value: prompt,
              required: true,
              placeholder: t('promptPlaceholder'),
              disabled: busy,
              'aria-label': t('prompt'),
              onChange: event => setPrompt(event.target.value),
              onKeyDown: event => {
                if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey)) return
                event.preventDefault()
                if (typeof event.currentTarget.form?.requestSubmit === 'function') event.currentTarget.form.requestSubmit()
              }
            }),
            h('div', { className: 'dshTaichiImageControls' },
              modelControl,
              optionControl('dsh-taichi-image-aspect', t('aspect'), aspect, aspects, next => {
                setAspect(next)
                setQuality(qualitiesOf(model, next)[0])
              }),
              optionControl('dsh-taichi-image-quality', t('quality'), quality, qualities, setQuality),
              busy
                ? h(Button, { type: 'button', variant: 'outline', className: 'dshTaichiImageSubmit', onClick: () => generateAbort.current?.abort() }, t('cancel'))
                : h(Button, { type: 'submit', variant: 'primary', className: 'dshTaichiImageSubmit', disabled: prompt.trim() === '', icon: h(IconSparkleRegular, { size: 16 }) }, t('generate'))))),
        lightbox && current && h(ImageLightbox, {
          src: current.src,
          alt: t('result'),
          labels: { dialog: t('lightbox'), close: t('close') },
          onClose: () => setLightbox(false)
        }))
    }

    function generatedResult(event) {
      const native = event.type === 'tool/result' && event.surfaceOp === 'append'
      const dispatched = event.type === 'tool/code-dispatch' && event.data.name === 'image_generate'
      if (!native && !dispatched) return
      const result = native ? event.data.message?.content?.[0] : event.data
      const id = native ? event.data.message?.source?.callId : event.data.subCallId
      if (!id || result?.isError || !Array.isArray(result?.content)) return
      for (const block of result.content) {
        if (block?.type !== 'text' || typeof block.text !== 'string' || block.text.length > 16384) continue
        let image
        try { image = JSON.parse(block.text) } catch { continue }
        if (image && /^[a-f0-9]{64}$/.test(image.sha256) && image.asset_id === `sha256:${image.sha256}`
          && image.workspace_path === `.workbuddy/generated-images/${image.sha256}.png` && image.media_type === 'image/png'
          && Number.isInteger(image.width) && image.width > 0 && Number.isInteger(image.height) && image.height > 0
          && Number.isInteger(image.bytes) && image.bytes > 0) return { id: `${native ? 'call' : 'dispatch'}:${id}`, image }
      }
    }

    const imageDefinition = {
      kind: 'generated-image',
      target: 'chat',
      match(event) { const value = generatedResult(event); return value ? { id: value.id, role: 'start' } : null },
      start(_context, match) { return generatedResult(match.event).image },
      update(context) { return context.state },
      buildViewNode(context) {
        if (!context.start || !context.state) return null
        const location = context.start.location
        const turn = location.kind === 'turn' || location.kind === 'step' ? location.turn : undefined
        const closing = turn?.data.get('turn-tail')?.closing
        const anchorSeq = closing ? closing.finalNode.seq + 0.025 : turn?.end ? turn.end.seq - 0.25 : context.start.event.seq
        return { key: context.key, id: context.id, kind: 'generated-image', target: 'chat', anchorSeq, location, visibility: 'visible', data: context.state }
      }
    }

    function GeneratedImage({ node, loadImage, renderMessageImages, t }) {
      const image = node.data
      const [url, setUrl] = useState(null)
      const [failed, setFailed] = useState(false)
      const [attempt, setAttempt] = useState(0)
      useEffect(() => {
        const controller = new AbortController()
        let objectUrl
        setUrl(null)
        setFailed(false)
        void loadImage(image.sha256, controller.signal).then(blob => {
          if (controller.signal.aborted) return
          objectUrl = URL.createObjectURL(blob)
          setUrl(objectUrl)
        }, () => { if (!controller.signal.aborted) setFailed(true) })
        return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
      }, [loadImage, image.sha256, attempt])
      if (failed) return h(Button, { type: 'button', variant: 'outline', onClick: () => setAttempt(value => value + 1) }, t('previewRetry'))
      if (!url) return h('p', { className: 'dshTaichiImageStatus', role: 'status' }, t('previewLoading'))
      return renderMessageImages({ images: [{ preview: { url, width: image.width, height: image.height, name: t('generatedImage') } }], align: 'start' })
    }

    function previewLoader(sessionId) {
      return async (sha, signal) => {
        if (!/^[a-f0-9]{64}$/.test(sha)) throw new Error('Invalid image reference')
        const response = await fetch(`/api/taichi-image.preview?session=${encodeURIComponent(sessionId)}&asset=${sha}`, {
          cache: 'no-store',
          signal: AbortSignal.any([signal, AbortSignal.timeout(30000)])
        })
        if (!response.ok || response.headers.get('content-type') !== 'image/png') throw new Error('Image preview unavailable')
        return response.blob()
      }
    }

    function register(scope, copy) {
      const t = scope.locale.bind(copy.NS)
      let returnPanel = null
      let seen = scope.layout.panelInfo?.getSnapshot?.()?.activePanelId ?? null
      const rememberPanel = () => {
        const id = scope.layout.panelInfo?.getSnapshot?.()?.activePanelId ?? null
        if (id === PANEL && seen !== PANEL) returnPanel = typeof seen === 'string' ? seen : null
        seen = id
      }
      scope.layout.panelInfo?.subscribe?.(rememberPanel)
      const hideDraw = () => {
        const restore = returnPanel
        returnPanel = null
        try { scope.layout.selectPanel(restore) } catch { if (restore !== null) scope.layout.selectPanel(null) }
      }
      const openAccount = () => {
        try { scope.layout.selectPanel(ACCOUNT_PANEL) } catch { /* The account page is absent in this profile. */ }
      }
      // Schedules (自动化任务) is order 10. Keep drawing in that same upper list, directly after it.
      scope.slots.inject('sidebar.panellist', () => scope.slots.register({
        name: 'sidebar.panellist',
        id: PANEL,
        order: 11,
        locale: copy.NS,
        label: () => t('open')
      }, DrawIcon))
      scope.slots.inject('main', () => scope.slots.register({
        name: 'main',
        key: PANEL,
        locale: copy.NS,
        inject: () => ({ t, onClose: hideDraw, onSignIn: openAccount })
      }, DrawPanel))
      if (scope.uiConversation?.events?.register) scope.uiConversation.events.register(imageDefinition)
      scope.slots.inject('conversation.chat.node', () => scope.slots.register({
        name: 'conversation.chat.node',
        key: 'generated-image',
        locale: copy.NS,
        inject: sessionId => ({ loadImage: previewLoader(sessionId) })
      }, GeneratedImage))
    }

    return { register, PANEL, billedSelection }
  }
})
