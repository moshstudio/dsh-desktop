/**
 * 服饰穿戴保留商品试穿的模特库，并让同一生成链路接收图库人物／服装／姿势。
 * 配方先预览、再提交相同的 prepared 图像与提示词；任何编辑都会使预览失效。
 */
import React, { useEffect, useRef, useState } from 'react'
import { Button, Input, SegmentedControl } from '@deepseek-ai/dsh-client-ui-primitives'
import { ImageGenApi } from './api.ts'
import type { GenerateRequest, GenerationTaskSummary } from '../protocol.ts'
import { describeModel } from '../model-catalog.ts'
import type { OutfitReference, OutfitReferenceKind, OutfitRecipe, OutfitPreparedGeneration } from '../outfit-reference.ts'
import type { ImageGenConfig, ImageGenScope } from './settings-scope.ts'
import { imageModelOptions } from './settings-scope.ts'
import { editReferenceLimit } from './reference-images.ts'
import { ModelPicker, resolveModelChoice, type ModelPickerValue } from './ModelPicker.tsx'
import { Select } from './Select.tsx'
import { OutfitReferencePicker } from './OutfitReferencePicker.tsx'
import { outfitReferenceApi } from './outfit-reference-api.ts'
import { defaultOutfitRecipe, prepareOutfitGeneration } from './outfit-generation.ts'
import { ErrorDetail } from './ErrorDetail.tsx'
import { tt } from './helpers.ts'
import type { ImageGenKey } from './locales.ts'
import { useImageGenLanguageTick } from './use-language.ts'
import css from './outfit-workspace.module.css'
import segmented from './segmented.module.css'

export interface OutfitWorkspaceProps {
  api?: ImageGenApi
  config?: ImageGenConfig
  scope?: ImageGenScope
  /** False while another studio page is showing. The instance stays mounted. */
  active?: boolean
}
/** Stored values stay the Chinese prompt fragments `buildOutfitPrompt` sends.
 *  Labels are locale keys so the control can follow the interface language. */
const SCENE_PRESETS: ReadonlyArray<{ value: string; label: ImageGenKey }> = [
  { value: '纯色棚拍', label: 'outfit.scene.studio' },
  { value: '都市街头', label: 'outfit.scene.street' },
  { value: '街角咖啡', label: 'outfit.scene.cafe' },
  { value: '自然草坪', label: 'outfit.scene.lawn' },
  { value: '度假海滩', label: 'outfit.scene.beach' },
  { value: '温馨居家', label: 'outfit.scene.home' },
  { value: '艺术展馆', label: 'outfit.scene.gallery' },
  { value: 'AI推荐', label: 'outfit.scene.ai' },
]
const CUSTOM_SCENE = 'custom'
const RATIOS = ['3:4', '1:1', '9:16']
const RESOLUTIONS = ['1K', '2K']
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024
const MAX_CLOTHES = 4
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const defaultApi = new ImageGenApi()
/** 上传图像转成后端接收的 Data URL；本地文件是受信任边界的输入，先查 MIME 与大小。
 *  10 MiB 是调用方（生成渠道与图库 store）共用的单张上限，超出就会在请求处被拒。 */
function readImage(file: File, maxBytes = MAX_REFERENCE_BYTES): Promise<string> {
  if (!IMAGE_TYPES.has(file.type)) return Promise.reject(new Error(tt('outfit.invalidImageType')))
  if (file.size === 0 || file.size > maxBytes) return Promise.reject(new Error(tt('outfit.fileTooLarge')))
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error(tt('outfit.readFailed')))
    reader.onerror = reader.onabort = () => reject(new Error(tt('outfit.readFailed')))
    reader.readAsDataURL(file)
  })
}

function causeText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export default function OutfitWorkspace({ api = defaultApi, config, active: pageActive = true }: OutfitWorkspaceProps): JSX.Element {
  useImageGenLanguageTick()
  const [recipe, setRecipe] = useState<OutfitRecipe>(defaultOutfitRecipe)
  const [picker, setPicker] = useState<OutfitReferenceKind | null>(null)
  const [draftLoaded, setDraftLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [prepared, setPrepared] = useState<OutfitPreparedGeneration | null>(null)
  const [tasks, setTasks] = useState<GenerationTaskSummary[]>([])
  const [hydrated, setHydrated] = useState<Record<string, Array<{ b64?: string; mime?: string; url?: string }>>>({})
  const [error, setError] = useState('')
  const [draftError, setDraftError] = useState('')
  const clothesInput = useRef<HTMLInputElement>(null)
  const poseInput = useRef<HTMLInputElement>(null)
  const generationEpoch = useRef(0)
  const previewRecipeKey = useRef('')
  const active = useRef(true)
  const savingQueue = useRef(Promise.resolve())
  const latestDraft = useRef<OutfitRecipe | null>(null)
  const working = useRef(false)
  const latestTasks = useRef<GenerationTaskSummary[]>([])
  const hydratedIds = useRef(new Set<string>())
  /** 跟拍计时器。提交发生在挂载那一轮之后，计时器必须放在 ref 里，
   *  卸载时才能清掉「后来才排上」的那一拍。 */
  const pollTimer = useRef<number | undefined>(undefined)
  /** 挂载代际。卸载或 api 更换后，进行中的那次拉取不能再改状态，也不能再排下一拍。 */
  const pollEpoch = useRef(0)
  const refreshTasksRef = useRef<() => Promise<void>>(async () => {})
  /** 草稿读失败期间用户仍可编辑（否则读不到旧草稿就等于整个面板点不动）。
   *  这时重试成功必须保留用户眼前的编辑，而不是拿旧草稿覆盖掉它。 */
  const editedWhileUnloaded = useRef(false)

  const options = imageModelOptions(config)
  const initialChoice = { model: options.defaultModel ?? options.models[0] ?? '', channelId: options.defaultChannelId ?? options.groups[0]?.id ?? '' }
  const selectedChoice = resolveModelChoice(options.groups, { model: recipe.model, channelId: recipe.channelId }, options.defaultChannelId)
  const choice: ModelPickerValue = recipe.model ? selectedChoice : resolveModelChoice(options.groups, initialChoice, options.defaultChannelId)
  const selectedChannel = config?.channels?.find(channel => channel.id === choice.channelId)
  const upstream = selectedChannel?.models.find(entry => entry.alias === choice.model)?.id ?? choice.model
  const supportsEdit = describeModel(upstream).supportsEdit
  const referenceLimit = editReferenceLimit(choice.model, selectedChannel)
  const modelMissing = choice.model.trim() === ''
  const fullRecipe: OutfitRecipe = { ...recipe, channelId: choice.channelId, model: choice.model }
  latestDraft.current = draftLoaded ? fullRecipe : null
  const scenePreset = SCENE_PRESETS.some(item => item.value === recipe.scene) ? recipe.scene : CUSTOM_SCENE
  const hasReference = recipe.portrait !== null || recipe.costumes.length > 0 || recipe.pose !== null
  const hasRequired = recipe.mode === 'try-on' ? recipe.portrait !== null && recipe.costumes.length > 0 : hasReference
  /** 只有「正在读草稿」这一小段窗口需要锁表单：那时到达的草稿会覆盖编辑。
   *  读失败不再算窗口——一只失败的请求把整张表单永久禁用，用户看到的就是
   *  「按钮点不动」，而错误提示里并没有说这一点。保存另有 `draftLoaded` 闸，
   *  所以放开编辑不会盲覆盖磁盘上的旧草稿。 */
  const formLocked = !draftLoaded && draftError === ''

  useEffect(() => {
    active.current = true
    let cancelled = false
    void outfitReferenceApi.loadDraft().then(draft => {
      if (cancelled) return
      if (!editedWhileUnloaded.current && draft?.version === 1) setRecipe({ ...draft, costumes: draft.costumes.slice(0, MAX_CLOTHES) })
      editedWhileUnloaded.current = false
      setDraftLoaded(true)
    }).catch(cause => {
      if (cancelled) return
      // Save remains blocked until the old draft is successfully read: no blind overwrite.
      setDraftError(tt('outfit.draftReadFailed', { error: causeText(cause) }))
    })
    return () => { cancelled = true; active.current = false; generationEpoch.current++ }
  }, [api])

  /** 切出工作台时冲刷最后一次尚未到防抖时间的编辑。 */
  useEffect(() => () => {
    const snapshot = latestDraft.current
    if (!snapshot) return
    savingQueue.current = savingQueue.current.catch(() => undefined).then(() => outfitReferenceApi.saveDraft(snapshot))
    void savingQueue.current.catch(() => undefined)
  }, [])

  /** 串行写草稿，防止快速编辑时旧请求晚到覆盖新状态。 */
  useEffect(() => {
    if (!draftLoaded) return
    const timer = window.setTimeout(() => {
      const snapshot = fullRecipe
      setSaving(true)
      savingQueue.current = savingQueue.current.catch(() => undefined).then(() => outfitReferenceApi.saveDraft(snapshot))
      void savingQueue.current.then(() => { if (active.current) { setSaving(false); setDraftError('') } }).catch(cause => {
        if (active.current) { setSaving(false); setDraftError(tt('outfit.draftSaveFailed', { error: causeText(cause) })) }
      })
    }, 350)
    return () => window.clearTimeout(timer)
  }, [draftLoaded, recipe, choice.channelId, choice.model])

  /** 配方、渠道或模型有变化必须重新预览；过期的准备结果也不能覆盖新画面。 */
  useEffect(() => { generationEpoch.current++; setPrepared(null) }, [recipe, choice.channelId, choice.model])

  const clearPollTimer = (): void => {
    if (pollTimer.current === undefined) return
    window.clearTimeout(pollTimer.current)
    pollTimer.current = undefined
  }

  /** 一次拉取服饰穿戴的任务；进行中/完成的任务都展示在任务卡里。
   *  生成过什么由宿主的左侧历史列表负责，面板里不再重复一份。
   *
   *  下一拍必须在这次拉取里排上，不能只靠挂载时的那一轮：挂载时列表往往是空的，
   *  那一轮看到没有进行中任务就会停。提交发生在这之后，若只再拉一次，任务卡会
   *  停在「正在生成」，而左侧历史已经由宿主自己的轮询写上了结果。 */
  const refreshTasks = async (): Promise<void> => {
    const epoch = pollEpoch.current
    const arm = (rows: GenerationTaskSummary[]): void => {
      if (pollEpoch.current !== epoch) return
      clearPollTimer()
      const stillActive = rows.some(task => task.status === 'queued' || task.status === 'running')
      if (!stillActive) return
      pollTimer.current = window.setTimeout(() => { void refreshTasksRef.current() }, 2000)
    }
    try {
      const allTasks = await api.taskList()
      if (pollEpoch.current !== epoch) return
      const outfitTasks = allTasks.filter(task => task.request.refName?.startsWith('outfit-'))
      latestTasks.current = outfitTasks
      setTasks(outfitTasks)
      // 先排下一拍再取图：完成任务的整包结果很大，取图卡住不能把状态轮询冻住。
      arm(outfitTasks)
      const pendingHydrate = outfitTasks.filter(task => task.status === 'completed' && task.resultAvailable && !hydratedIds.current.has(task.id))
      if (pendingHydrate.length === 0) return
      for (const task of pendingHydrate) hydratedIds.current.add(task.id)
      try {
        const filled = await Promise.all(pendingHydrate.map(async task => {
          const full = await api.taskGet(task.id)
          return [task.id, full.result?.images ?? []] as const
        }))
        if (pollEpoch.current === epoch) setHydrated(previous => Object.assign({}, previous, Object.fromEntries(filled)))
      } catch {
        for (const task of pendingHydrate) hydratedIds.current.delete(task.id)
      }
    } catch {
      // 宿主暂时不可达时保留已有列表；上一份里若还有进行中任务，下一拍再试。
      arm(latestTasks.current)
    }
  }
  refreshTasksRef.current = refreshTasks

  /** 面板挂载时立刻拉一次。之后只要还有排队或进行中的任务，refreshTasks 自己会续上。 */
  useEffect(() => {
    pollEpoch.current += 1
    void refreshTasksRef.current()
    return () => {
      pollEpoch.current += 1
      clearPollTimer()
    }
  }, [api])

  const update = (patch: Partial<OutfitRecipe>): void => {
    if (!draftLoaded) editedWhileUnloaded.current = true
    generationEpoch.current++
    previewRecipeKey.current = ''
    setPrepared(null)
    setRecipe(current => ({ ...current, ...patch }))
    setError('')
  }
  const chooseReference = (item: OutfitReference): void => {
    if (!draftLoaded) editedWhileUnloaded.current = true
    generationEpoch.current++
    previewRecipeKey.current = ''
    setPrepared(null)
    setRecipe(current => item.kind === 'portrait' ? { ...current, portrait: item }
      : item.kind === 'pose' ? { ...current, pose: item }
        : { ...current, costumes: [...current.costumes, item].slice(0, MAX_CLOTHES) })
    setPicker(null)
  }

  /** 将上传素材经宿主落盘并保存配方；排除 base64 草稿及重启后失效的 blob URL。 */
  const uploadReference = async (kind: 'costume' | 'pose', files: FileList | null): Promise<void> => {
    if (!files || working.current) return
    working.current = true; setBusy(true); setError('')
    try {
      const chosen = kind === 'costume' ? Array.from(files).slice(0, MAX_CLOTHES - recipe.costumes.length) : Array.from(files).slice(0, 1)
      for (const file of chosen) {
        const data = await readImage(file)
        const saved = await outfitReferenceApi.upload({ kind, name: file.name, data })
        if (active.current) chooseReference(saved)
      }
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { working.current = false; if (active.current) setBusy(false) }
  }

  /** 刷新草稿：模特库现在归人物图库管，草稿刷新不再连带拉模特列表。 */
  const reloadDraft = async (): Promise<void> => {
    setDraftError('')
    try {
      const draft = await outfitReferenceApi.loadDraft()
      if (!active.current) return
      // 用户在读失败期间已经改过配方：保留眼前的编辑，只解除保存闸。
      if (!editedWhileUnloaded.current && draft?.version === 1) setRecipe({ ...draft, costumes: draft.costumes.slice(0, MAX_CLOTHES) })
      editedWhileUnloaded.current = false
      setDraftLoaded(true)
    } catch (cause) { if (active.current) setDraftError(tt('outfit.draftReadFailed', { error: causeText(cause) })) }
  }
  /** 人物图库的“AI 生成模特”走这里：图库负责界面，渠道与模型只有工作台知道。
   *  生成走阻塞式请求而不是任务队列，因为模特必须先落盘才能在图库里被选中。 */
  const generateModel = async (prompt: string): Promise<{ id: string; name: string; file: string }> => {
    const result = await api.generate({ mode: 'text', prompt, model: choice.model, channelId: choice.channelId, size: recipe.size, quality: recipe.quality.toLowerCase(), detail: '', n: 1 })
    const image = result.images?.[0]
    if (!image?.b64) throw new Error(tt('outfit.noImage'))
    return api.modelSave({ name: prompt.slice(0, 24), data: `data:${image.mime};base64,${image.b64}`, mime: image.mime })
  }
  const preview = async (): Promise<void> => {
    // 草稿没读回来不挡预览：这一步只在本机下载并排版参考图，既不写草稿也不
    // 调模型。以前它要求 `draftLoaded`，于是草稿读失败时提交按钮看着能点、
    // 点下去却什么都不发生——和锁死整张表单是同一类缺陷。
    if (!hasRequired || !supportsEdit || modelMissing || working.current) return
    const epoch = generationEpoch.current
    working.current = true; setBusy(true); setError(''); setPrepared(null)
    try {
      const result = await prepareOutfitGeneration(fullRecipe, referenceLimit)
      if (active.current && generationEpoch.current === epoch) {
        previewRecipeKey.current = JSON.stringify(fullRecipe)
        setPrepared(result)
      }
    } catch (cause) { if (active.current && generationEpoch.current === epoch) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { working.current = false; if (active.current) setBusy(false) }
  }
  /** 取消排队/进行中的生成任务。 */
  const cancelTask = async (id: string): Promise<void> => {
    try { await api.taskCancel(id); await refreshTasks() } catch { /* 列表下次轮询仍会反映实际状态 */ }
  }
  /** 失败/取消的任务重新入队，复用原请求。 */
  const retryTask = async (id: string): Promise<void> => {
    try { await api.taskRetry(id); await refreshTasks() } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  /** 提交改走宿主异步任务队列：立即返回任务卡，面板切走再回来也能恢复进行中状态。 */
  const submitOutfit = async (): Promise<void> => {
    if (!prepared || modelMissing || !supportsEdit || working.current || previewRecipeKey.current !== JSON.stringify(fullRecipe)) return
    working.current = true; setBusy(true); setError('')
    try {
      // 不在提交时再次拼图或重写提示词：付费请求与预览必须逐字逐图相同。
      const request: GenerateRequest = { mode: 'edit', prompt: prepared.prompt, model: choice.model, channelId: choice.channelId,
        size: recipe.size, quality: recipe.quality.toLowerCase(), detail: '', n: 1, image: prepared.image, images: prepared.images,
        refName: recipe.mode === 'try-on' ? 'outfit-try-on' : 'outfit-character' }
      await api.taskSubmit(request)
      if (active.current) {
        await refreshTasks()
        setPrepared(null)
      }
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { working.current = false; if (active.current) setBusy(false) }
  }
  const timeOf = (ms: number): string => {
    const date = new Date(ms)
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`
  }
  const renderTask = (task: GenerationTaskSummary): JSX.Element => {
    const label = tt(task.request.refName === 'outfit-try-on' ? 'outfit.taskTryOn' : 'outfit.taskCharacter')
    if (task.status === 'queued' || task.status === 'running') {
      return <div className={css.taskCard} role="status">
        <span className={css.spinner} aria-hidden="true" />
        <div className={css.taskMain}>
          <strong>{tt(task.status === 'queued' ? 'outfit.taskQueued' : 'outfit.taskRunning')}</strong>
          <p className={css.muted}>{tt('outfit.taskSubmitted', { label, model: task.request.model, time: timeOf(task.createdAt) })}</p>
        </div>
        {task.status === 'running' ? <Button type="button" variant="outline" size="sm" onClick={() => void cancelTask(task.id)}>{tt('outfit.taskCancel')}</Button> : null}
      </div>
    }
    if (task.status === 'completed') {
      const images = hydrated[task.id] ?? []
      return <div className={css.taskCard}>
        {images.length > 0
          ? <div className={css.outputs}>{images.map((image, index) => { const src = image.url ?? (image.b64 ? `data:${image.mime ?? 'image/png'};base64,${image.b64}` : ''); return src ? <img key={`${src.slice(-30)}-${index}`} className={css.output} src={src} alt="" /> : null })}</div>
          : <p className={css.muted}>{tt('outfit.taskDone')}</p>}
        <p className={css.muted}>{tt('outfit.taskDoneMeta', { label, time: timeOf(task.finishedAt ?? task.createdAt) })}</p>
      </div>
    }
    if (task.status === 'failed') {
      return <div className={css.taskCard}>
        <ErrorDetail message={task.error ?? tt('canvas.generateFailed')} />
        <p className={css.muted}>{tt('outfit.taskFailedMeta', { label, time: timeOf(task.createdAt) })}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void retryTask(task.id)}>{tt('outfit.taskRetry')}</Button>
      </div>
    }
    return <div className={css.taskCard}><p className={css.muted}>{tt('outfit.taskCancelled', { label })}</p><Button type="button" variant="outline" size="sm" onClick={() => void retryTask(task.id)}>{tt('outfit.taskRegenerate')}</Button></div>
  }
  return <section className={css.root} data-outfit="true" hidden={!pageActive}>
    <header className={css.intro}><div><h2>{tt('outfit.title')}</h2><p>{tt('outfit.hint')}</p></div><span className={css.badge}>{tt('outfit.uploadClothes', { count: recipe.costumes.length })}</span></header>
    <div className={css.body}>
      <form className={css.form} onSubmit={event => { event.preventDefault(); void (prepared ? submitOutfit() : preview()) }}>
        <fieldset className={css.formFields} disabled={formLocked}>
        <SegmentedControl
          id="outfit-mode"
          className={segmented.wrap}
          value={recipe.mode}
          label={tt('outfit.mode')}
          options={[
            { value: 'try-on', label: tt('outfit.mode.tryOn') },
            { value: 'character', label: tt('outfit.mode.character') },
          ]}
          onChange={value => { if (value === 'try-on' || value === 'character') update({ mode: value }) }}
        />
        <p className={css.muted}>{tt(recipe.mode === 'try-on' ? 'outfit.mode.tryOnNote' : 'outfit.mode.characterNote')}</p>
        <div className={css.field}>
          <div className={css.fieldHead}><span className={css.fieldLabel}>{tt('outfit.portrait')}</span><span className={css.fieldNote}>{tt('outfit.section.modelNote')}</span></div>
          {recipe.portrait ? <div className={css.selection}><img src={recipe.portrait.thumbnailUrl} alt={recipe.portrait.title} /><span>{recipe.portrait.title}</span><Button type="button" variant="ghost" size="sm" onClick={() => update({ portrait: null })}>{tt('outfit.dismiss')}</Button></div> : <p className={css.muted}>{tt('outfit.section.modelNote')}</p>}
          <Button type="button" variant="outline" disabled={busy} onClick={() => setPicker('portrait')}>{tt('outfit.portraitBrowse')}</Button>
        </div>
        <div className={css.field}>
          <div className={css.fieldHead}><span className={css.fieldLabel}>{tt('outfit.section.clothes')}</span><span className={css.fieldNote}>{tt('outfit.uploadClothes', { count: recipe.costumes.length })}</span></div>
          {recipe.costumes.length > 0 ? <ul className={css.thumbs}>{recipe.costumes.map((item, index) => <li className={css.thumb} key={`${item.key}-${index}`}><img src={item.thumbnailUrl} alt={item.title} /><span className={css.thumbIndex}>{index + 1}</span><button type="button" className={css.thumbRemove} aria-label={`${tt('outfit.remove')} ${item.title}`} onClick={() => update({ costumes: recipe.costumes.filter((_, n) => n !== index) })}>×</button></li>)}</ul> : <p className={css.muted}>{tt('outfit.clothesEmpty')}</p>}
          <div className={css.inline}>
            <Button type="button" variant="outline" disabled={busy || recipe.costumes.length >= MAX_CLOTHES} onClick={() => clothesInput.current?.click()}>{recipe.costumes.length >= MAX_CLOTHES ? tt('outfit.clothesFull') : tt('outfit.uploadGarment')}</Button>
            <Button type="button" variant="outline" disabled={busy || recipe.costumes.length >= MAX_CLOTHES} onClick={() => setPicker('costume')}>{tt('outfit.costumeBrowse')}</Button>
          </div>
          <input ref={clothesInput} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={event => { void uploadReference('costume', event.target.files); event.target.value = '' }} />
        </div>
        <div className={css.field}>
          <span className={css.fieldLabel}>{tt('outfit.pose')}</span>
          {recipe.pose ? <div className={css.selection}><img src={recipe.pose.thumbnailUrl} alt={recipe.pose.title} /><span>{recipe.pose.title}{recipe.pose.angle ? ` · ${recipe.pose.angle}` : ''}{recipe.pose.useDepth ? ' · Depth' : ''}</span><Button type="button" variant="ghost" size="sm" onClick={() => update({ pose: null })}>{tt('outfit.dismiss')}</Button></div> : <p className={css.muted}>{tt('outfit.poseEmpty')}</p>}
          <div className={css.inline}>
            <Button type="button" variant="outline" disabled={busy} onClick={() => poseInput.current?.click()}>{tt('outfit.poseUpload')}</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setPicker('pose')}>{tt('outfit.poseBrowse')}</Button>
          </div>
          <input ref={poseInput} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => { void uploadReference('pose', event.target.files); event.target.value = '' }} />
        </div>
        <div className={css.field}>
          <span className={css.fieldLabel} id="outfit-scene-label">{tt('outfit.scene')}</span>
          <Select
            id="outfit-scene"
            aria-labelledby="outfit-scene-label"
            value={scenePreset}
            options={[
              ...SCENE_PRESETS.map(item => ({ value: item.value, label: tt(item.label) })),
              { value: CUSTOM_SCENE, label: tt('outfit.scene.custom') },
            ]}
            onChange={value => {
              if (value === CUSTOM_SCENE) {
                if (scenePreset !== CUSTOM_SCENE) update({ scene: '' })
                return
              }
              update({ scene: value })
            }}
          />
          {scenePreset === CUSTOM_SCENE ? <Input className={css.stretch} aria-label={tt('outfit.scene.customLabel')} placeholder={tt('outfit.scene.customPlaceholder')} value={recipe.scene} onChange={event => update({ scene: event.target.value })} /> : null}
        </div>
        <div className={css.field}><label className={css.fieldLabel} htmlFor="outfit-extra">{tt('outfit.extra')}</label><textarea id="outfit-extra" className={css.textarea} value={recipe.extraPrompt} placeholder={tt('outfit.extraPlaceholder')} onChange={event => update({ extraPrompt: event.target.value })} /></div>
        <div className={css.field}>
          <span className={css.fieldLabel}>{tt('outfit.channel')}</span>
          <ModelPicker groups={options.groups} value={choice} onChange={value => update({ channelId: value.channelId, model: value.model })} channelLabel={tt('outfit.channelName')} modelLabel={tt('outfit.modelName')} emptyLabel={tt('outfit.channelEmpty')} channelPlaceholder={tt('outfit.channelDefault')} ariaLabel={tt('outfit.modelAria')} />
          <div className={css.paramStrip}>
            <Select variant="composer" aria-label={tt('outfit.ratio')} value={recipe.size} options={RATIOS.map(value => ({ value, label: value }))} onChange={value => update({ size: value })} />
            <Select variant="composer" aria-label={tt('outfit.resolution')} value={recipe.quality} options={RESOLUTIONS.map(value => ({ value, label: value }))} onChange={value => update({ quality: value })} />
          </div>
        </div>
        </fieldset>
        {/* 读失败时表单是解锁的，所以提示里必须说清「现在能改、但还存不下来」，
            否则用户改完以为保存了，切回来发现全没了。 */}
        {!draftLoaded ? <div className={css.field}><p role={draftError ? 'alert' : 'status'} className={draftError ? css.error : css.muted}>{draftError ? tt('outfit.draftUnsaved', { error: draftError }) : tt('outfit.draftLoading')}</p>{draftError ? <Button type="button" variant="outline" size="sm" onClick={() => void reloadDraft()}>{tt('outfit.draftRetry')}</Button> : null}</div> : null}
        {draftLoaded && (saving || draftError) ? <p role={draftError ? 'alert' : 'status'} className={draftError ? css.error : css.muted}>{draftError || tt('outfit.draftSaving')}</p> : null}
        {modelMissing ? <p role="status" className={css.error}>{tt('outfit.modelMissing')}</p> : null}
        {!modelMissing && !supportsEdit ? <p role="status" className={css.error}>{tt('outfit.editUnsupported')}</p> : null}
        {recipe.mode === 'try-on' && !hasRequired ? <p className={css.muted}>{tt('outfit.tryOnRequired')}</p> : null}
        <div className={css.submitBar}><div className={css.submitRow}><Button type="submit" variant="primary" disabled={formLocked || !hasRequired || !supportsEdit || modelMissing || busy}>{busy ? tt('outfit.generating') : prepared ? tt('outfit.confirmGenerate') : tt('outfit.preparePreview')}</Button>{prepared ? <Button type="button" variant="outline" disabled={busy} onClick={() => setPrepared(null)}>{tt('outfit.repreview')}</Button> : null}</div><small className={css.muted}>{tt('outfit.consistency')}</small>{error ? <p role="alert" className={css.error}>{error}</p> : null}</div>
      </form>
      <section className={css.results} aria-label={tt('outfit.results')}>
        {prepared ? <div className={css.preview}><h3>{tt('outfit.previewTitle')}</h3><p className={css.muted}>{tt('outfit.previewSummary', { count: prepared.referenceCount, sent: prepared.sheet ? tt('outfit.previewSentSheet') : tt('outfit.previewSentImages', { count: 1 + prepared.images.length }) })}</p><div className={css.previewImages}>{[prepared.image, ...prepared.images].map((url, index) => <figure key={index}><img src={url} alt={prepared.sheet ? tt('outfit.previewSheetAlt') : tt('outfit.previewImageAlt', { index: index + 1 })} /><figcaption>{prepared.sheet ? tt('outfit.previewSheetCaption') : tt('outfit.previewImageCaption', { index: index + 1 })}</figcaption></figure>)}</div><details><summary>{tt('outfit.previewPrompt')}</summary><pre className={css.promptPreview}>{prepared.prompt}</pre></details></div> : null}
        {tasks.length > 0 ? <div className={css.taskList}>
          <h3>{tt('outfit.tasks')}</h3>
          {tasks.slice(0, 20).map(task => <div key={task.id}>{renderTask(task)}</div>)}
        </div> : null}
        {tasks.length === 0 && !prepared ? <div className={css.empty}><span>{tt('outfit.emptyResults')}</span></div> : null}
      </section>
    </div>
    {picker ? <OutfitReferencePicker kind={picker} onSelect={chooseReference} onClose={() => setPicker(null)}
      {...(modelMissing ? {} : { generateModel })} /> : null}
  </section>
}
