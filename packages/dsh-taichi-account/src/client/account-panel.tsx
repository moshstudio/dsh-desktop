import { useEffect, useId, useRef, useState } from 'react'
import * as React from 'react'
import { Button, Modal, RiskConfirmation, IconCloseOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AccountApi, AccountSnapshot, DesktopBridge, LayoutScope, RechargeCatalog, RechargePackage } from './bridge'
import type { Translate } from './locale'
import { isErrorCode } from './locale'
import {
  canSubmit,
  codeIssue,
  confirmIssue,
  needsConfirm,
  needsEmail,
  needsPassword,
  needsToken,
  passwordIssue,
  validEmail,
  type AuthMode,
  type FieldName
} from './form'
import { requestAccountRestart } from './status'
import { statusBus } from './status'
import { authBody } from './auth-screen'
import { homeScreen } from './home-screen'
import { paymentQr, rechargeDialog } from './recharge-dialog'
import styles from './account.module.css'

const useIsoLayoutEffect = React.useLayoutEffect ?? React.useEffect
const EMAIL_MEMORY_KEY = 'dsh-taichi-account-email'
const MOTION_MS = 280

interface MotionFrame {
  top: number
  left: number
  relTop: number
  relLeft: number
  slotTop: number
}

type Screen = 'loading' | 'gateway' | 'home' | 'auth'
type Section = 'models' | 'usage' | 'recharge'
type CatalogKind = 'chat' | 'image' | 'video'
type ModelSort = 'vendor' | 'price'
type RangeKind = 'today' | 'yesterday' | '7' | '30' | 'all'

function fieldsFor(nextMode: AuthMode): FieldName[] {
  const names: FieldName[] = []
  if (needsEmail(nextMode)) names.push('email')
  if (needsToken(nextMode)) names.push('token')
  if (needsPassword(nextMode)) names.push('password')
  if (needsConfirm(nextMode)) names.push('confirm')
  return names
}

// Login and registration share the secret the user is still typing.
// Every other step leaves that flow, so the secret is cleared there.
function keepsPassword(from: AuthMode, to: AuthMode): boolean {
  return (from === 'login' || from === 'register') && (to === 'login' || to === 'register')
}

function motionEnabled(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches === false
  } catch {
    return false
  }
}

function motionFrame(node: Element, columnBox: DOMRect, slotsBox: DOMRect | null): MotionFrame {
  const box = node.getBoundingClientRect()
  return {
    top: box.top,
    left: box.left,
    relTop: box.top - columnBox.top,
    relLeft: box.left - columnBox.left,
    // Slot-relative position lets a leaving field fade inside the moving
    // column instead of fighting the column's own position animation.
    slotTop: slotsBox ? box.top - slotsBox.top : box.top - columnBox.top
  }
}

function rememberedEmail(): string {
  try {
    const stored = window.localStorage?.getItem(EMAIL_MEMORY_KEY)
    if (typeof stored !== 'string') return ''
    const address = stored.trim().toLowerCase()
    return validEmail(address) ? address : ''
  } catch {
    return ''
  }
}

function rememberEmail(address: string): void {
  try {
    window.localStorage?.setItem(EMAIL_MEMORY_KEY, address)
  } catch {
    // A blocked store must not stop sign-in or registration.
  }
}

function titleKey(mode: AuthMode): string {
  if (mode === 'register') return 'titleRegister'
  if (mode === 'verify') return 'titleVerify'
  if (mode === 'reset' || mode === 'resetConfirm') return 'titleReset'
  return 'titleLogin'
}

function descriptionKey(mode: AuthMode, email: string): string {
  if (mode === 'register') return 'descRegister'
  if (mode === 'verify') return email.trim() ? 'descVerify' : 'descVerifyUnknown'
  if (mode === 'reset') return 'descReset'
  if (mode === 'resetConfirm') return 'descResetConfirm'
  return 'descLogin'
}

function actionKey(mode: AuthMode): string {
  if (mode === 'register') return 'register'
  if (mode === 'verify') return 'verify'
  if (mode === 'reset') return 'sendReset'
  if (mode === 'resetConfirm') return 'reset'
  return 'login'
}

function pendingKey(mode: AuthMode): string {
  if (mode === 'register') return 'creating'
  if (mode === 'verify') return 'verifying'
  if (mode === 'reset') return 'sending'
  if (mode === 'resetConfirm') return 'resetting'
  return 'signingIn'
}

function readRechargePackage(value: unknown): RechargePackage[] {
  if (value === null || typeof value !== 'object') return []
  const pack = value as { yuan?: unknown; credits?: unknown }
  if (!Number.isSafeInteger(pack.yuan) || !Number.isSafeInteger(pack.credits)) return []
  if ((pack.yuan as number) <= 0 || (pack.credits as number) <= 0) return []
  return [{ yuan: pack.yuan as number, credits: pack.credits as number }]
}

const PURCHASE_CODES = new Set(['payment_unconfigured', 'payment_provider_unavailable', 'invalid_amount', 'order_response_invalid', 'unauthorized', 'rate_limited'])

function purchaseNotice(message: unknown): string {
  return typeof message === 'string' && PURCHASE_CODES.has(message) ? message : 'order_response_invalid'
}

function unavailableStatus(): AccountSnapshot {
  return {
    configured: true,
    signedIn: false,
    email: '',
    balance: null,
    needsRestart: false,
    message: '',
    models: [],
    imageModels: [],
    videoModels: [],
    profile: { models: 'ready', balance: 'ready', images: 'ready', videos: 'ready' },
    checkedIn: false
  }
}

export function AccountPanel({ t, bridge, initialStatus, onClose, onStatus, layout, panelId }: {
  t: Translate
  bridge?: DesktopBridge
  initialStatus?: AccountSnapshot | null
  onClose?: () => void
  onStatus: (next: AccountSnapshot) => void
  layout?: LayoutScope
  panelId?: string
}) {
  const titleId = useId()
  const modelsId = useId()
  const usageId = useId()
  const rechargeId = useId()
  const [mode, setMode] = useState<AuthMode>('login')
  const [ghosts, setGhosts] = useState<FieldName[]>([])
  const [entered, setEntered] = useState<FieldName[]>([])
  const [section, setSection] = useState<Section>('models')
  const [range, setRange] = useState<RangeKind>('7')
  const [modelSort, setModelSort] = useState<ModelSort>('vendor')
  const [catalog, setCatalog] = useState<CatalogKind>('chat')
  const [email, setEmail] = useState<string>(rememberedEmail)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [token, setToken] = useState('')
  const [shown, setShown] = useState(false)
  const [emailTouched, setEmailTouched] = useState(false)
  const [passwordTouched, setPasswordTouched] = useState(false)
  const [confirmTouched, setConfirmTouched] = useState(false)
  const operationId = useRef(0)
  const profileEpoch = useRef(0)
  const inFlight = useRef(false)
  const columnRef = useRef<HTMLDivElement | null>(null)
  const snapshotRef = useRef<{ map: Map<string, MotionFrame> | null }>({ map: null })
  const framesRef = useRef<{ map: Map<string, MotionFrame> | null }>({ map: null })
  const focusRequest = useRef(false)
  const [status, setStatus] = useState<AccountSnapshot | null>(() => initialStatus !== undefined ? initialStatus : statusBus.current)
  const [busy, setBusy] = useState(false)
  const [task, setTask] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [rechargeOpen, setRechargeOpen] = useState(false)
  const [rechargeBusy, setRechargeBusy] = useState(false)
  const [rechargePhase, setRechargePhase] = useState('')
  const [rechargeNotice, setRechargeNotice] = useState('')
  const [rechargeOrder, setRechargeOrder] = useState('')
  const [rechargeQr, setRechargeQr] = useState('')
  const [rechargePackages, setRechargePackages] = useState<RechargePackage[] | null>(null)
  const [paymentAvailable, setPaymentAvailable] = useState(false)
  const rechargeGeneration = useRef(0)
  const purchaseLock = useRef(false)
  const desktop = bridge ?? window.dshDesktop
  const account = desktop?.account
  const [panelActive, setPanelActive] = useState(() => {
    const snapshot = layout?.panelInfo?.getSnapshot?.()
    return snapshot?.activePanelId === panelId
  })

  const publish = (next: AccountSnapshot) => {
    setStatus(next)
    onStatus(next)
    if (next.signedIn === true && next.needsRestart === true) requestAccountRestart()
  }
  const mustRestart = status?.needsRestart === true && status.signedIn !== true
  const requestClose = () => {
    if (!busy && !confirmLogout && !mustRestart && typeof onClose === 'function') onClose()
  }

  useEffect(() => {
    const info = layout?.panelInfo
    if (typeof info?.subscribe !== 'function' || typeof info.getSnapshot !== 'function') return undefined
    const sync = () => { setPanelActive(info.getSnapshot?.()?.activePanelId === panelId) }
    sync()
    return info.subscribe(sync)
  }, [layout, panelId])

  useEffect(() => {
    let alive = true
    const revision = ++operationId.current
    const epoch = profileEpoch.current
    void account?.status()?.then(next => {
      if (!alive || revision !== operationId.current || epoch !== profileEpoch.current) return
      publish(next)
    }).catch(() => {
      if (!alive || revision !== operationId.current || epoch !== profileEpoch.current) return
      setNotice('unavailable')
      setStatus(unavailableStatus())
    })
    return () => { alive = false; operationId.current += 1; inFlight.current = false }
  }, [account, onStatus])

  // Prices and the savings ratio change on the gateway without a local signal.
  // Each time this page becomes visible, read the model list again.
  useEffect(() => {
    if (!panelActive || status?.signedIn !== true || typeof account?.refresh !== 'function') return undefined
    let alive = true
    const epoch = ++profileEpoch.current
    const refresh = account.refresh
    void refresh().then(next => {
      if (!alive || epoch !== profileEpoch.current || !next) return
      publish(next)
    }).catch(() => undefined)
    return () => { alive = false; profileEpoch.current += 1 }
  }, [panelActive, status?.signedIn, account])

  useEffect(() => {
    if (!rechargeOpen || rechargeOrder === '' || rechargePhase === 'paid' || typeof account?.order !== 'function') return undefined
    let alive = true
    let polling = false
    let paid = false
    const readOrder = account.order
    const tick = () => {
      if (polling || paid) return
      polling = true
      void readOrder(rechargeOrder).then(result => {
        if (!alive || result?.ok !== true || result.order?.status !== 'paid') return
        paid = true
        const revision = operationId.current
        const epoch = ++profileEpoch.current
        setRechargePhase('paid')
        setRechargeNotice('')
        // Entering the paid state stops polling, but the profile read belongs to the account panel.
        void account.refresh?.().then(next => {
          if (revision === operationId.current && epoch === profileEpoch.current && next) publish(next)
        }).catch(() => undefined)
      }).catch(() => undefined).finally(() => { polling = false })
    }
    tick()
    const timer = setInterval(tick, 2000)
    return () => { alive = false; clearInterval(timer) }
  }, [account, rechargeOpen, rechargeOrder, rechargePhase])

  // Record the on-screen positions before React commits the next step.
  // getBoundingClientRect includes an in-progress transform, so a fast
  // second switch continues from the current visual position.
  const captureMotion = () => {
    const root = columnRef.current
    if (!root || typeof root.getBoundingClientRect !== 'function' || typeof root.querySelectorAll !== 'function') {
      snapshotRef.current.map = null
      return
    }
    const columnBox = root.getBoundingClientRect()
    const slots = typeof root.querySelector === 'function' ? root.querySelector('[data-dsh-account-slots]') : null
    const slotsBox = slots && typeof slots.getBoundingClientRect === 'function' ? slots.getBoundingClientRect() : null
    const frames = new Map<string, MotionFrame>()
    frames.set('column', { top: columnBox.top, left: columnBox.left, relTop: 0, relLeft: 0, slotTop: 0 })
    for (const node of root.querySelectorAll('[data-dsh-flip]')) {
      const key = node.getAttribute('data-dsh-flip')
      if (!key || typeof node.getBoundingClientRect !== 'function') continue
      frames.set(key, motionFrame(node, columnBox, slotsBox))
    }
    snapshotRef.current.map = frames
  }
  const beginTransition = (next: AuthMode) => {
    if (next === mode) return
    captureMotion()
    const previous = fieldsFor(mode)
    const upcoming = fieldsFor(next)
    const upcomingSet = new Set(upcoming)
    const previousSet = new Set(previous)
    if (motionEnabled()) {
      setGhosts(previous.filter(name => !upcomingSet.has(name)))
      setEntered(upcoming.filter(name => !previousSet.has(name)))
    } else {
      setGhosts([])
      setEntered([])
    }
    setMode(next)
  }
  const performRestart = async () => {
    if (typeof desktop?.restartHarness !== 'function') throw new Error('Restart unavailable')
    const result = await desktop.restartHarness()
    if (result?.ok !== true) throw new Error('Restart failed')
  }
  const run = async (operation: (api: AccountApi) => Promise<AccountSnapshot>, taskName: string) => {
    if (!account || inFlight.current) return
    inFlight.current = true
    const revision = ++operationId.current
    setBusy(true)
    setTask(taskName)
    setNotice('')
    try {
      const next = await operation(account)
      if (revision !== operationId.current) return
      publish(next)
      if (taskName === 'submit' && mode === 'login' && next.signedIn === true && next.needsRestart === true) {
        onClose?.()
      } else if (next.message === 'accepted' && mode === 'register') {
        beginTransition('verify')
        setPassword('')
        setConfirm('')
        setPasswordTouched(false)
        setConfirmTouched(false)
        setShown(false)
      } else if (next.message === 'accepted' && mode === 'reset') beginTransition('resetConfirm')
      else if (taskName === 'resend' && next.message === 'accepted') setToken('')
      else if (next.message === 'accepted' && (mode === 'verify' || mode === 'resetConfirm')) {
        setNotice(mode === 'verify' ? 'verified' : 'passwordReset')
        beginTransition('login')
        setPassword('')
        setConfirm('')
        setToken('')
        setPasswordTouched(false)
        setConfirmTouched(false)
        setShown(false)
      } else if (taskName === 'logout' && next.signedIn === false && !isErrorCode(next.message)) {
        setMode('login')
        setConfirmLogout(false)
        setAcknowledged(false)
        if (next.needsRestart === true) await performRestart()
      }
    } catch {
      if (revision === operationId.current) setNotice('unavailable')
    } finally {
      if (revision === operationId.current) {
        inFlight.current = false
        setBusy(false)
        setTask('')
      }
    }
  }
  const restart = async () => {
    if (inFlight.current) return
    inFlight.current = true
    const revision = ++operationId.current
    setBusy(true)
    setNotice('')
    try {
      await performRestart()
    } catch {
      if (revision === operationId.current) setNotice('unavailable')
    } finally {
      if (revision === operationId.current) {
        inFlight.current = false
        setBusy(false)
      }
    }
  }
  const go = (next: AuthMode) => {
    if (busy || next === mode) return
    beginTransition(next)
    setNotice('')
    setStatus(value => value ? { ...value, message: '' } : value)
    setEmailTouched(false)
    setPasswordTouched(false)
    setConfirmTouched(false)
    if (!keepsPassword(mode, next)) {
      setPassword('')
      setShown(false)
    }
    setConfirm('')
    if (!needsToken(next)) setToken('')
    focusRequest.current = true
  }

  const signedIn = status?.signedIn === true
  const screen: Screen = status === null ? 'loading' : status.configured === false ? 'gateway' : signedIn ? 'home' : 'auth'
  const code = notice || status?.message || ''
  const errorCode = isErrorCode(code) ? code : ''
  const successCode = !errorCode && (code === 'accepted' || code === 'verified' || code === 'passwordReset') ? code : ''
  const emailError = needsEmail(mode) && emailTouched && !validEmail(email) ? t('emailInvalid') : ''
  const passwordCode = passwordIssue(mode, password, passwordTouched)
  const passwordError = passwordCode ? t(passwordCode) : ''
  const confirmCode = confirmIssue(mode, password, confirm, confirmTouched)
  const confirmError = confirmCode ? t(confirmCode) : ''
  const codeErrorKey = codeIssue(mode, token)
  const codeError = codeErrorKey ? t(codeErrorKey) : ''
  const ready = canSubmit(mode, email, password, token, confirm)
  const title = t(screen === 'home' || screen === 'loading' || screen === 'gateway' ? 'titleAccount' : titleKey(mode))
  const description = screen === 'loading' || screen === 'home'
    ? ''
    : screen === 'gateway'
      ? t('descGateway')
      : t(descriptionKey(mode, email), { email: email.trim() })
  // The auth stage stays mounted. Only its text and fields change, so a
  // step can move existing inputs instead of replacing the whole form.
  const stageKey = screen === 'auth' ? 'auth' : screen
  const openFields = screen === 'auth' ? fieldsFor(mode) : []
  // Ghosts and entered fields are presentation for the mode change already
  // measured above. Clearing them after the transition must not measure again,
  // or the inputs snap once the move has finished.
  const motionSignature = [
    screen,
    mode,
    errorCode,
    successCode,
    emailError,
    passwordError,
    confirmError,
    codeError,
    description,
    title,
    busy ? task : '',
    status?.needsRestart === true ? 'restart' : ''
  ].join('|')

  useEffect(() => {
    if (ghosts.length === 0 && entered.length === 0) return undefined
    const timer = setTimeout(() => {
      setGhosts([])
      setEntered([])
    }, MOTION_MS)
    return () => { clearTimeout(timer) }
  }, [mode, ghosts, entered])

  useEffect(() => {
    snapshotRef.current.map = null
  }, [motionSignature])

  useIsoLayoutEffect(() => {
    const root = columnRef.current
    if (screen !== 'auth' || !root || typeof root.getBoundingClientRect !== 'function' || typeof root.querySelectorAll !== 'function') {
      framesRef.current.map = null
      return undefined
    }
    const nodes = [...root.querySelectorAll<HTMLElement>('[data-dsh-flip]')]
    const first = snapshotRef.current.map || framesRef.current.map
    const animate = Boolean(first && motionEnabled())
    const slots = typeof root.querySelector === 'function' ? root.querySelector('[data-dsh-account-slots]') : null
    const clearMotionStyle = (node: HTMLElement) => {
      node.style.transition = 'none'
      node.style.transform = 'none'
    }
    if (animate && first) {
      for (const node of nodes) {
        if (node.getAttribute('data-motion') !== 'exit') continue
        const key = node.getAttribute('data-dsh-flip')
        const origin = key ? first.get(key) : undefined
        if (!origin) continue
        node.style.position = 'absolute'
        node.style.left = '0'
        node.style.right = '0'
        node.style.margin = '0'
        node.style.top = `${typeof origin.slotTop === 'number' ? origin.slotTop : origin.relTop}px`
        node.style.pointerEvents = 'none'
      }
      clearMotionStyle(root)
      for (const node of nodes) {
        if (node.getAttribute('data-motion') === 'exit') continue
        clearMotionStyle(node)
      }
      root.getBoundingClientRect()
    }
    const columnBox = root.getBoundingClientRect()
    const slotsBox = slots && typeof slots.getBoundingClientRect === 'function' ? slots.getBoundingClientRect() : null
    const current = new Map<string, MotionFrame>()
    current.set('column', { top: columnBox.top, left: columnBox.left, relTop: 0, relLeft: 0, slotTop: 0 })
    for (const node of nodes) {
      if (node.getAttribute('data-motion') === 'exit') continue
      const key = node.getAttribute('data-dsh-flip')
      if (!key || typeof node.getBoundingClientRect !== 'function') continue
      current.set(key, motionFrame(node, columnBox, slotsBox))
    }
    if (animate && first) {
      const moves: Array<{ node: HTMLElement, dx: number, dy: number }> = []
      const columnFrom = first.get('column')
      if (columnFrom) {
        const dx = columnFrom.left - columnBox.left
        const dy = columnFrom.top - columnBox.top
        if (Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5) moves.push({ node: root, dx, dy })
      }
      for (const node of nodes) {
        const motion = node.getAttribute('data-motion')
        if (motion === 'exit' || motion === 'enter') continue
        const key = node.getAttribute('data-dsh-flip')
        const origin = key ? first.get(key) : undefined
        const next = key ? current.get(key) : undefined
        if (!origin || !next) continue
        const dx = origin.relLeft - next.relLeft
        const dy = origin.relTop - next.relTop
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue
        moves.push({ node, dx, dy })
      }
      for (const move of moves) move.node.style.transform = `translate(${move.dx}px, ${move.dy}px)`
      root.getBoundingClientRect()
      for (const move of moves) {
        move.node.style.transition = 'transform 260ms cubic-bezier(.22, .8, .24, 1)'
        move.node.style.transform = 'translate(0px, 0px)'
      }
    }
    framesRef.current.map = current
    return () => {
      root.style.transition = ''
      root.style.transform = ''
      for (const node of nodes) {
        if (!node.style) continue
        node.style.transition = ''
        node.style.transform = ''
        if (node.getAttribute('data-motion') === 'exit') {
          node.style.position = ''
          node.style.top = ''
          node.style.left = ''
          node.style.right = ''
          node.style.margin = ''
          node.style.pointerEvents = ''
        }
      }
    }
  }, [motionSignature, screen])

  useEffect(() => {
    if (screen !== 'auth') return undefined
    const root = columnRef.current
    if (!root || typeof root.querySelector !== 'function' || typeof root.contains !== 'function') return undefined
    const requested = focusRequest.current
    focusRequest.current = false
    const active = document.activeElement
    const slot = active instanceof Element ? active.closest('[data-dsh-account-slot]') : null
    const disabled = active instanceof HTMLInputElement || active instanceof HTMLButtonElement ? active.disabled === true : false
    const valid = Boolean(active && root.contains(active) && slot?.getAttribute('data-open') === 'true' && !disabled)
    if (valid) return undefined
    const inside = Boolean(active && root.contains(active))
    if (!requested && !inside) return undefined
    const nextField = root.querySelector('[data-dsh-account-slot][data-open="true"] [data-dsh-account-field]')
    if (!(nextField instanceof HTMLElement) || nextField === active) return undefined
    nextField.focus({ preventScroll: true })
    return undefined
  }, [mode, screen])

  const submit = (event: { preventDefault: () => void }) => {
    event.preventDefault()
    if (needsEmail(mode)) setEmailTouched(true)
    if (needsPassword(mode)) setPasswordTouched(true)
    if (needsConfirm(mode)) setConfirmTouched(true)
    if (screen !== 'auth' || busy || !ready) return
    if (passwordIssue(mode, password, true) !== '' || confirmIssue(mode, password, confirm, true) !== '') return
    const address = email.trim().toLowerCase()
    if (needsEmail(mode) && address !== email) setEmail(address)
    if (mode === 'login' || mode === 'register') rememberEmail(address)
    void run(api => {
      if (mode === 'register') return api.register(address, password)
      if (mode === 'verify') return api.verify(token.trim())
      if (mode === 'reset') return api.requestReset(address)
      if (mode === 'resetConfirm') return api.confirmReset(token.trim(), password)
      return api.login(address, password)
    }, 'submit')
  }
  const resendReset = () => {
    if (screen !== 'auth' || busy || mode !== 'resetConfirm') return
    const address = email.trim().toLowerCase()
    if (!validEmail(address)) return
    if (address !== email) setEmail(address)
    void run(api => api.requestReset(address), 'resend')
  }
  const loadRechargePackages = async (generation: number) => {
    if (typeof account?.packages !== 'function') {
      if (generation !== rechargeGeneration.current) return
      setRechargePhase('')
      setRechargeNotice('unavailable')
      setRechargePackages(null)
      setPaymentAvailable(false)
      return
    }
    const readPackages = account.packages
    try {
      const catalog = await readPackages()
      if (generation !== rechargeGeneration.current) return
      const packages = Array.isArray(catalog?.packages) ? catalog.packages.flatMap(readRechargePackage) : null
      setRechargePackages(packages)
      setPaymentAvailable(catalog?.paymentAvailable === true)
      setRechargeNotice(catalog?.message || (catalog?.paymentAvailable === true ? '' : 'payment_unconfigured'))
      setRechargePhase('')
    } catch {
      if (generation !== rechargeGeneration.current) return
      setRechargePackages(null)
      setPaymentAvailable(false)
      setRechargeNotice('unavailable')
      setRechargePhase('')
    }
  }

  const body = screen === 'loading'
    ? <p className={styles.loading}>{t('descLoading')}</p>
    : screen === 'gateway'
      ? null
      : screen === 'home' && status
        ? homeScreen({
          t,
          status,
          busy,
          task,
          errorCode,
          section,
          onSection: setSection,
          range,
          onRange: setRange,
          modelSort,
          onModelSort: setModelSort,
          catalog,
          onCatalog: setCatalog,
          modelsId,
          usageId,
          rechargeId,
          onCheckIn: () => { void run(api => api.checkIn(), 'checkIn') },
          onRecharge: () => {
            const generation = ++rechargeGeneration.current
            setRechargeNotice('')
            setRechargePhase('loading')
            setRechargeOrder('')
            setRechargeQr('')
            setRechargePackages(null)
            setPaymentAvailable(false)
            purchaseLock.current = false
            setRechargeOpen(true)
            void loadRechargePackages(generation)
          },
          onLogout: () => { setAcknowledged(false); setConfirmLogout(true) },
          onRetry: () => {
            void run(api => {
              if (typeof api.refresh !== 'function') throw new Error('Refresh unavailable')
              return api.refresh()
            }, 'refresh')
          }
        })
        : authBody({
          t,
          mode,
          busy,
          task,
          errorCode,
          successCode,
          needsRestart: status?.needsRestart === true,
          email,
          password,
          confirm,
          token,
          shown,
          emailError,
          passwordError,
          confirmError,
          codeError,
          ghosts,
          entered,
          openFields,
          onRestart: restart,
          onEmail: setEmail,
          onPassword: setPassword,
          onConfirm: setConfirm,
          onToken: setToken,
          onEmailBlur: () => { setEmailTouched(true) },
          onPasswordBlur: () => { setPasswordTouched(true) },
          onConfirmBlur: () => { setConfirmTouched(true) },
          onToggleShown: () => { setShown(value => !value) },
          onGo: go,
          onResend: resendReset
        })
  const titleNode = (
    <h2 id={titleId} className={styles.title} data-dsh-flip={screen === 'auth' ? 'title' : undefined}>
      {screen === 'auth' ? <span key={title} className={styles.cross} data-dsh-account-cross="true">{title}</span> : title}
    </h2>
  )
  const descriptionNode = description
    ? (
      <p className={styles.description} data-dsh-flip={screen === 'auth' ? 'description' : undefined}>
        {screen === 'auth' ? <span key={mode} className={styles.cross} data-dsh-account-cross="true">{description}</span> : description}
      </p>
    )
    : null
  const reading = (
    <div className={styles.body} data-loading={screen === 'loading' ? 'true' : 'false'} data-dsh-account-screen={screen} data-mode={screen === 'auth' ? mode : screen}>
      <div key={stageKey} className={styles.stage} data-dsh-account-stage="true">{body}</div>
    </div>
  )
  const Surface = screen === 'auth' ? 'form' : 'div'
  const content = screen === 'auth'
    ? (
      <div className={styles.content} data-dsh-account-panel="true" data-auth="true">
        <div className={styles.authColumn} ref={columnRef}>
          <div className={styles.live} aria-live="polite" aria-atomic="true">{`${title}. ${description}`}</div>
          {descriptionNode}
          {reading}
          <div className={styles.footer} data-dsh-account-footer="true" data-align="stretch" data-dsh-flip="action">
            <Button variant="primary" type="submit" className={styles.primary} data-dsh-account-primary="true" disabled={busy || !ready}>
              <span key={`${mode}:${task}`} className={styles.cross} data-dsh-account-cross="true">{t(task === 'submit' ? pendingKey(mode) : actionKey(mode))}</span>
            </Button>
          </div>
        </div>
      </div>
    )
    : (
      <div className={styles.content} data-dsh-account-panel="true" data-auth="false">
        {descriptionNode}
        {reading}
      </div>
    )
  return (
    <>
      <Modal open headless title={t('open')} className="dsh-account-dialog" onClose={requestClose}>
        <Surface className={styles.panel} data-screen={screen} aria-labelledby={titleId} onSubmit={screen === 'auth' ? submit : undefined}>
          <div className={styles.header} data-dsh-account-header="true">
            {titleNode}
            <button
              type="button"
              className={styles.close}
              data-dsh-account-close="true"
              data-modal-autofocus="true"
              aria-label={t('close')}
              disabled={busy || mustRestart}
              onClick={requestClose}
            >
              <IconCloseOutlineRegular size={14} />
            </button>
          </div>
          {content}
        </Surface>
      </Modal>
      {rechargeDialog({
        t,
        open: rechargeOpen,
        busy: rechargeBusy,
        phase: rechargePhase,
        notice: rechargeNotice,
        qr: rechargeQr,
        packages: rechargePackages,
        paymentAvailable,
        onClose: () => {
          if (rechargeBusy) return
          rechargeGeneration.current += 1
          purchaseLock.current = false
          setRechargeOpen(false)
        },
        onRetry: () => {
          if (rechargeBusy) return
          const generation = ++rechargeGeneration.current
          setRechargePhase('loading')
          setRechargeNotice('')
          setRechargePackages(null)
          setPaymentAvailable(false)
          void loadRechargePackages(generation)
        },
        onBuy: yuan => {
          if (purchaseLock.current || rechargeBusy || rechargePhase === 'waiting' || rechargePhase === 'paid' || !paymentAvailable || typeof account?.purchase !== 'function') {
            setRechargeNotice(paymentAvailable ? 'unavailable' : 'payment_unconfigured')
            return
          }
          if (!rechargePackages?.some(pack => pack.yuan === yuan)) {
            setRechargeNotice('invalid_amount')
            return
          }
          const generation = ++rechargeGeneration.current
          purchaseLock.current = true
          setRechargeBusy(true)
          setRechargePhase('opening')
          setRechargeNotice('')
          setRechargeQr('')
          const purchase = account.purchase
          void purchase(yuan).then(result => {
            if (generation !== rechargeGeneration.current) return
            const image = paymentQr(result?.order?.qrImage)
            if (result?.ok === true && result.order?.orderId && image) {
              setRechargeOrder(result.order.orderId)
              setRechargeQr(image)
              setRechargePhase('waiting')
              return
            }
            setRechargePhase('')
            setRechargeNotice(purchaseNotice(result?.message))
          }).catch(() => {
            if (generation !== rechargeGeneration.current) return
            setRechargePhase('')
            setRechargeNotice('unavailable')
          }).finally(() => {
            if (generation === rechargeGeneration.current) {
              purchaseLock.current = false
              setRechargeBusy(false)
            }
          })
        }
      })}
      <RiskConfirmation
        open={confirmLogout}
        title={t('logoutTitle')}
        description={t('logoutDescription')}
        acknowledgeLabel={t('logoutAcknowledge')}
        cancelLabel={t('cancel')}
        closeLabel={t('close')}
        confirmLabel={t('logoutConfirm')}
        acknowledged={acknowledged}
        disabled={busy}
        onAcknowledgedChange={setAcknowledged}
        onCancel={() => { if (!busy) { setConfirmLogout(false); setAcknowledged(false) } }}
        onConfirm={() => { void run(api => api.logout(), 'logout') }}
      />
    </>
  )
}
