window.__ModuleLoader__.load({
  id: 'dsh-desktop-account',
  chunk: 'client.dialog.js',
  factory: (require) => {
    const React = require('react')
    const { useEffect, useId, useRef, useState } = React
    const {
      Button,
      Modal,
      RiskConfirmation,
      Tooltip,
      IconCloseOutlineRegular,
      IconUserOutlineRegular
    } = require('@deepseek-ai/dsh-client-ui-primitives')

    const OPEN_EVENT = 'dsh-desktop-account-open'

    // The workbench overlay already owns the shared Harness restart notice.
    function requestAccountRestart() {
      try {
        window.dispatchEvent(new window.CustomEvent('dsh-desktop-restart-required', {
          detail: { source: 'account', restartRequired: true }
        }))
      } catch {
        // Sign-in is already stored. A missing notice must not undo it.
      }
    }

    function initialOf(email) {
      const char = email.trim().charAt(0)
      return char ? char.toLocaleUpperCase() : ''
    }

    /**
     * Compose the account button from form fields and copy helpers.
     * Chunks cannot synchronously require each other, so the entry passes both in.
     * @param {object} form
     * @param {object} copy
     */
    function createUi(form, copy) {
      const {
        TextField,
        PasswordField,
        validEmail,
        passwordIssue,
        confirmIssue,
        needsEmail,
        needsPassword,
        needsConfirm,
        needsToken,
        verificationToken,
        canSubmit
      } = form
      const { messageText, isErrorCode } = copy
      const EMAIL_MEMORY_KEY = 'dsh-desktop-account-email'

      function rememberedEmail() {
        try {
          const stored = window.localStorage?.getItem(EMAIL_MEMORY_KEY)
          if (typeof stored !== 'string') return ''
          const address = stored.trim().toLowerCase()
          return validEmail(address) ? address : ''
        } catch {
          return ''
        }
      }

      function rememberEmail(address) {
        try {
          window.localStorage?.setItem(EMAIL_MEMORY_KEY, address)
        } catch {
          // A blocked store must not stop sign-in or registration.
        }
      }

      function profileFlags(status) {
        const profile = status?.profile
        if (profile && (profile.models === 'ready' || profile.models === 'failed') && (profile.balance === 'ready' || profile.balance === 'failed')) {
          return { models: profile.models === 'failed', balance: profile.balance === 'failed' }
        }
        const failed = status?.message === 'profile_unavailable'
        return {
          models: failed && (!Array.isArray(status?.models) || status.models.length === 0),
          balance: failed && status?.balance == null
        }
      }

      function HomeScreen({ t, status, busy, task, errorCode, modelsId, onCheckIn, onLogout, onRetry }) {
        const flags = profileFlags(status)
        const checkedIn = status.checkedIn === true || status.message === 'checked_in'
        const balance = status.balance == null ? '—' : status.balance
        const balanceCaption = status.balance == null ? t('balanceUnread') : checkedIn ? t('checked_in') : t('balance')
        const announced = checkedIn && status.balance != null
        const models = Array.isArray(status.models) ? status.models : []
        return React.createElement(
          React.Fragment,
          null,
          errorCode ? React.createElement('p', { className: 'dshDeskAccountAlert', role: 'alert' }, messageText(t, errorCode)) : null,
          React.createElement(
            'div',
            { className: 'dshDeskAccountIdentity' },
            React.createElement(
              'span',
              { className: 'dshDeskAccountAvatar', 'aria-hidden': 'true' },
              initialOf(status.email) || React.createElement(IconUserOutlineRegular, { size: 16 })
            ),
            React.createElement(
              'div',
              { className: 'dshDeskAccountIdentityText' },
              React.createElement('p', { className: 'dshDeskAccountEmail' }, status.email)
            ),
            React.createElement(Button, {
              variant: 'ghost',
              size: 'sm',
              className: 'dshDeskAccountLogout',
              disabled: busy,
              onClick: onLogout
            }, t(task === 'logout' ? 'signingOut' : 'logout'))
          ),
          React.createElement(
            'div',
            { className: 'dshDeskAccountCredits' },
            React.createElement(
              'div',
              null,
              React.createElement('p', { className: 'dshDeskAccountBalance' }, String(balance)),
              React.createElement('p', {
                className: 'dshDeskAccountCaption',
                role: announced ? 'status' : undefined,
                'aria-live': announced ? 'polite' : undefined,
                'data-success': announced ? 'true' : 'false'
              }, balanceCaption)
            ),
            React.createElement(Button, {
              variant: 'primary',
              size: 'sm',
              disabled: busy,
              onClick: onCheckIn
            }, t(task === 'checkIn' ? 'checkingIn' : 'checkIn'))
          ),
          React.createElement(
            'h3',
            { id: modelsId, className: 'dshDeskAccountSection' },
            t('models'),
            !flags.models && models.length > 0 ? React.createElement('span', { className: 'dshDeskAccountCount' }, String(models.length)) : null
          ),
          flags.models
            ? React.createElement('p', { className: 'dshDeskAccountEmpty' }, t('modelsUnread'))
            : models.length > 0
              ? React.createElement(
                'ul',
                { className: 'dshDeskAccountChips', 'aria-labelledby': modelsId },
                models.map((model, index) => React.createElement('li', { key: `${model}-${index}`, className: 'dshDeskAccountChip' }, model))
              )
              : React.createElement('p', { className: 'dshDeskAccountEmpty' }, t('modelsEmpty')),
          flags.models || flags.balance
            ? React.createElement(
              'div',
              { className: 'dshDeskAccountRetry' },
              React.createElement(Button, {
                variant: 'ghost',
                size: 'sm',
                disabled: busy,
                onClick: onRetry
              }, t(task === 'refresh' ? 'retrying' : 'retry'))
            )
            : null
        )
      }

      function RestartNotice({ t, kind, busy, onRestart }) {
        return React.createElement(
          'div',
          { className: 'dshDeskAccountNotice', role: 'status' },
          React.createElement('p', null, t(kind === 'signOut' ? 'restartToSignOut' : 'restartToApply')),
          React.createElement(Button, {
            variant: 'primary',
            size: 'sm',
            type: 'button',
            disabled: busy,
            onClick: onRestart
          }, t('restart'))
        )
      }

      function AccountDialog({ t, bridge, initialStatus, onClose, onStatus }) {
        const titleId = useId()
        const modelsId = useId()
        const [mode, setMode] = useState('login')
        const [email, setEmail] = useState(rememberedEmail)
        const [password, setPassword] = useState('')
        const [confirm, setConfirm] = useState('')
        const [token, setToken] = useState('')
        const [shown, setShown] = useState(false)
        const [emailTouched, setEmailTouched] = useState(false)
        const [passwordTouched, setPasswordTouched] = useState(false)
        const [confirmTouched, setConfirmTouched] = useState(false)
        const operationId = useRef(0)
        const inFlight = useRef(false)
        const [status, setStatus] = useState(initialStatus ?? null)
        const [busy, setBusy] = useState(false)
        const [task, setTask] = useState('')
        const [notice, setNotice] = useState('')
        const [confirmLogout, setConfirmLogout] = useState(false)
        const [acknowledged, setAcknowledged] = useState(false)
        const account = bridge?.account

        useEffect(() => {
          let alive = true
          const revision = ++operationId.current
          void account?.status().then(next => {
            if (!alive || revision !== operationId.current) return
            publish(next)
          }).catch(() => {
            if (!alive || revision !== operationId.current) return
            setNotice('unavailable')
            setStatus({
              configured: true,
              signedIn: false,
              email: '',
              balance: null,
              needsRestart: false,
              message: '',
              models: [],
              profile: { models: 'ready', balance: 'ready' },
              checkedIn: false
            })
          })
          return () => { alive = false; operationId.current += 1; inFlight.current = false }
        }, [account, onStatus])

        useEffect(() => {
          const appRoot = document.getElementById('root')
          if (appRoot === null) return undefined
          const previous = appRoot.inert
          appRoot.inert = true
          return () => { appRoot.inert = previous }
        }, [])

        const mustRestart = status?.needsRestart === true && status?.signedIn !== true
        const requestClose = () => { if (!busy && !confirmLogout && !mustRestart) onClose() }
        const publish = (next) => {
          setStatus(next)
          onStatus(next)
          if (next?.signedIn === true && next?.needsRestart === true) requestAccountRestart()
        }
        const run = async (operation, taskName) => {
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
            if (taskName === 'submit' && mode === 'login' && next?.signedIn === true && next?.needsRestart === true) {
              onClose()
            } else if (next?.message === 'accepted' && mode === 'register') {
              setMode('verify')
              setPassword('')
              setConfirm('')
              setPasswordTouched(false)
              setConfirmTouched(false)
              setShown(false)
            } else if (next?.message === 'accepted' && mode === 'reset') setMode('resetConfirm')
            else if (next?.message === 'accepted' && (mode === 'verify' || mode === 'resetConfirm')) {
              setNotice(mode === 'verify' ? 'verified' : 'passwordReset')
              setMode('login')
              setPassword('')
              setConfirm('')
              setToken('')
              setPasswordTouched(false)
              setConfirmTouched(false)
              setShown(false)
            } else if (taskName === 'logout' && next?.signedIn === false && !isErrorCode(next.message)) {
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
        const performRestart = async () => {
          if (typeof bridge?.restartHarness !== 'function') throw new Error('Restart unavailable')
          const result = await bridge.restartHarness()
          if (result?.ok !== true) throw new Error('Restart failed')
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
        const go = (next) => {
          if (busy) return
          setMode(next)
          setNotice('')
          setStatus(value => value ? { ...value, message: '' } : value)
          setEmailTouched(false)
          setPasswordTouched(false)
          setConfirmTouched(false)
          setPassword('')
          setConfirm('')
          setToken('')
          setShown(false)
        }

        const signedIn = status?.signedIn === true
        const screen = status === null ? 'loading' : status.configured === false ? 'gateway' : signedIn ? 'home' : 'auth'
        const code = notice || status?.message || ''
        const errorCode = isErrorCode(code) ? code : ''
        const successCode = !errorCode && (code === 'accepted' || code === 'verified' || code === 'passwordReset') ? code : ''
        const emailError = needsEmail(mode) && emailTouched && !validEmail(email) ? t('emailInvalid') : ''
        const passwordCode = passwordIssue(mode, password, passwordTouched)
        const passwordError = passwordCode ? t(passwordCode) : ''
        const confirmCode = confirmIssue(mode, password, confirm, confirmTouched)
        const confirmError = confirmCode ? t(confirmCode) : ''
        const ready = canSubmit(mode, email, password, token, confirm)
        const titles = {
          login: 'titleLogin',
          register: 'titleRegister',
          verify: 'titleVerify',
          reset: 'titleReset',
          resetConfirm: 'titleReset'
        }
        const descriptions = {
          login: 'descLogin',
          register: 'descRegister',
          verify: email.trim() ? 'descVerify' : 'descVerifyUnknown',
          reset: 'descReset',
          resetConfirm: 'descResetConfirm'
        }
        const actions = {
          login: 'login',
          register: 'register',
          verify: 'verify',
          reset: 'sendReset',
          resetConfirm: 'reset'
        }
        const pending = {
          login: 'signingIn',
          register: 'creating',
          verify: 'verifying',
          reset: 'sending',
          resetConfirm: 'resetting'
        }
        const title = t(screen === 'home' ? 'titleAccount' : screen === 'loading' || screen === 'gateway' ? 'titleAccount' : titles[mode])
        const description = screen === 'loading' || screen === 'home'
          ? ''
          : screen === 'gateway'
            ? t('descGateway')
            : t(descriptions[mode], { email: email.trim() })
        // Remounting replays the short enter animation when the screen or step changes.
        const stageKey = `${screen}:${mode}`

        const submit = (event) => {
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
            if (mode === 'verify') return api.verify(verificationToken(token))
            if (mode === 'reset') return api.requestReset(address)
            if (mode === 'resetConfirm') return api.confirmReset(token.trim(), password)
            return api.login(address, password)
          }, 'submit')
        }

        const body = screen === 'loading'
          ? React.createElement('p', { className: 'dshDeskAccountLoading' }, t('descLoading'))
          : screen === 'gateway'
            ? null
            : screen === 'home'
              ? HomeScreen({
                t,
                status,
                busy,
                task,
                errorCode,
                modelsId,
                onCheckIn: () => { void run(api => api.checkIn(), 'checkIn') },
                onLogout: () => { setAcknowledged(false); setConfirmLogout(true) },
                onRetry: () => {
                  void run(api => {
                    if (typeof api.refresh !== 'function') throw new Error('Refresh unavailable')
                    return api.refresh()
                  }, 'refresh')
                }
              })
              : React.createElement(React.Fragment, null,
                errorCode ? React.createElement('p', { className: 'dshDeskAccountAlert', role: 'alert' }, messageText(t, errorCode)) : null,
                successCode ? React.createElement('p', { className: 'dshDeskAccountStatus', role: 'status' }, messageText(t, successCode)) : null,
                status?.needsRestart ? React.createElement(RestartNotice, { t, kind: 'signOut', busy, onRestart: restart }) : null,
                needsEmail(mode) ? React.createElement(TextField, {
                  field: 'email',
                  label: t('email'),
                  type: 'email',
                  value: email,
                  busy,
                  invalid: emailError !== '',
                  error: emailError,
                  autoComplete: 'username',
                  autoFocus: true,
                  onBlur: () => { setEmailTouched(true) },
                  onChange: setEmail
                }) : null,
                needsToken(mode) ? React.createElement(TextField, {
                  field: 'token',
                  label: t(mode === 'verify' ? 'verifyLink' : 'token'),
                  type: 'text',
                  value: token,
                  busy,
                  invalid: false,
                  error: '',
                  autoComplete: mode === 'verify' ? 'off' : 'one-time-code',
                  autoFocus: !needsEmail(mode),
                  onChange: setToken
                }) : null,
                needsPassword(mode) ? React.createElement(PasswordField, {
                  t,
                  field: 'password',
                  label: t('password'),
                  value: password,
                  shown,
                  busy,
                  invalid: passwordError !== '',
                  error: passwordError,
                  autoComplete: mode === 'login' ? 'current-password' : 'new-password',
                  autoFocus: false,
                  onBlur: () => { setPasswordTouched(true) },
                  onChange: setPassword,
                  onToggle: () => { setShown(value => !value) }
                }) : null,
                needsConfirm(mode) ? React.createElement(PasswordField, {
                  t,
                  field: 'confirm',
                  label: t('confirmPassword'),
                  value: confirm,
                  shown,
                  busy,
                  invalid: confirmError !== '',
                  error: confirmError,
                  autoComplete: 'new-password',
                  autoFocus: false,
                  onBlur: () => { setConfirmTouched(true) },
                  onChange: setConfirm,
                  onToggle: () => { setShown(value => !value) }
                }) : null,
                React.createElement(
                  'div',
                  { className: 'dshDeskAccountLinks' },
                  mode === 'login'
                    ? React.createElement(React.Fragment, null,
                      React.createElement('button', { type: 'button', disabled: busy, onClick: () => { go('register') } }, t('needAccount')),
                      React.createElement('button', { type: 'button', disabled: busy, onClick: () => { go('verify') } }, t('needVerify')),
                      React.createElement('button', { type: 'button', disabled: busy, onClick: () => { go('reset') } }, t('needReset'))
                    )
                    : React.createElement('button', { type: 'button', disabled: busy, onClick: () => { go('login') } }, t('haveAccount'))
                )
              )

        return React.createElement(React.Fragment, null,
          React.createElement(
            Modal,
            {
              open: true,
              headless: true,
              title,
              className: 'dshDeskAccountDialog',
              onClose: requestClose
            },
            React.createElement(
              screen === 'auth' ? 'form' : 'div',
              screen === 'auth'
                ? { className: 'dshDeskAccountContent', onSubmit: submit }
                : { className: 'dshDeskAccountContent' },
              React.createElement(
                'div',
                { className: 'dshDeskAccountHeader' },
                React.createElement('h2', { id: titleId, key: stageKey, className: 'dshDeskAccountTitle' }, title),
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'dshDeskAccountClose',
                    'aria-label': t('close'),
                    disabled: busy || mustRestart,
                    onClick: requestClose
                  },
                  React.createElement(IconCloseOutlineRegular, { size: 14 })
                )
              ),
              description ? React.createElement('p', { key: stageKey, className: 'dshDeskAccountDescription' }, description) : null,
              React.createElement(
                'div',
                {
                  className: 'dshDeskAccountBody',
                  'data-loading': screen === 'loading' ? 'true' : 'false',
                  'data-dsh-account-screen': screen,
                  'data-mode': screen === 'auth' ? mode : screen
                },
                React.createElement('div', { key: stageKey, className: 'dshDeskAccountStage' }, body)
              ),
              screen === 'auth'
                  ? React.createElement(
                    'div',
                    { className: 'dshDeskAccountFooter', 'data-align': 'end' },
                    React.createElement(Button, {
                      variant: 'primary',
                      type: 'submit',
                      'data-dsh-account-primary': 'true',
                      disabled: busy || !ready
                    }, t(task === 'submit' ? pending[mode] : actions[mode]))
                  )
                  : null
            )
          ),
          React.createElement(RiskConfirmation, {
            open: confirmLogout,
            title: t('logoutTitle'),
            description: t('logoutDescription'),
            acknowledgeLabel: t('logoutAcknowledge'),
            cancelLabel: t('cancel'),
            closeLabel: t('close'),
            confirmLabel: t('logoutConfirm'),
            acknowledged,
            disabled: busy,
            onAcknowledgedChange: setAcknowledged,
            onCancel: () => { if (!busy) { setConfirmLogout(false); setAcknowledged(false) } },
            onConfirm: () => { void run(api => api.logout(), 'logout') }
          })
        )
      }

      function AccountButton({ t, wide }) {
        const [open, setOpen] = useState(false)
        const [status, setStatus] = useState(null)
        const statusRevision = useRef(0)
        const updateStatus = React.useCallback(next => {
          statusRevision.current += 1
          setStatus(next)
        }, [])
        useEffect(() => {
          let alive = true
          const revision = statusRevision.current
          const show = () => { setOpen(true) }
          window.addEventListener(OPEN_EVENT, show)
          void window.dshDesktop?.account?.status().then(next => { if (alive && revision === statusRevision.current) setStatus(next) }).catch(() => undefined)
          return () => {
            alive = false
            window.removeEventListener(OPEN_EVENT, show)
          }
        }, [])
        if (!window.dshDesktop?.account) return null
        const signedIn = status?.signedIn === true && status.email !== ''
        const label = signedIn ? t('signedInName', { email: status.email }) : t('open')
        return React.createElement(
          React.Fragment,
          null,
          React.createElement(
            'div',
            { 'data-dsh-desktop-account-entry': 'true', 'data-wide': wide === false ? 'false' : 'true' },
            React.createElement(
              Tooltip,
              { label, side: 'top', align: 'end', portal: true, maxWidth: 280, delayMs: 0, focusDelayMs: 0 },
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'dshDeskAccountButton',
                  'data-dsh-desktop-account': 'true',
                  'data-signed-in': signedIn ? 'true' : 'false',
                  'aria-label': label,
                  onClick: () => { setOpen(true) }
                },
                React.createElement(IconUserOutlineRegular, { size: 18 }),
                signedIn ? React.createElement('span', { className: 'dshDeskAccountPresence', 'aria-hidden': 'true' }) : null
              )
            )
          ),
          open ? React.createElement(AccountDialog, {
            t,
            bridge: window.dshDesktop,
            initialStatus: status,
            onClose: () => { setOpen(false) },
            onStatus: updateStatus
          }) : null
        )
      }

      function QuotaRechargeNotice({ matched, t }) {
        const dismiss = typeof matched?.dismiss === 'function' ? matched.dismiss : () => {}
        return React.createElement(Modal, {
          open: true,
          title: t('quotaTitle'),
          closeLabel: t('close'),
          description: t('quotaDescription'),
          onClose: dismiss,
          footer: React.createElement(Button, {
            variant: 'primary',
            onClick: dismiss
          }, t('quotaConfirm'))
        })
      }

      return { AccountButton, QuotaRechargeNotice }
    }

    return { createUi }
  }
})
