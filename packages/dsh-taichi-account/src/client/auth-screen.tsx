import type { ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from './locale'
import { messageText } from './locale'
import { needsEmail, validEmail, type AuthMode, type FieldName } from './form'
import { PasswordField, TextField } from './fields'
import styles from './account.module.css'

const FIELD_ORDER: FieldName[] = ['email', 'token', 'password', 'confirm']

export function RestartNotice({ t, kind, busy, onRestart }: {
  t: Translate
  kind: 'signOut' | 'apply'
  busy: boolean
  onRestart: () => void
}) {
  return (
    <div className={styles.notice} role="status">
      <p>{t(kind === 'signOut' ? 'restartToSignOut' : 'restartToApply')}</p>
      <Button variant="primary" size="sm" type="button" disabled={busy} onClick={onRestart}>{t('restart')}</Button>
    </div>
  )
}

function textButton(label: string, disabled: boolean, onClick: () => void): ReactNode {
  return <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onClick}>{label}</Button>
}

export interface AuthBodyProps {
  t: Translate
  mode: AuthMode
  busy: boolean
  task: string
  errorCode: string
  successCode: string
  needsRestart: boolean
  email: string
  password: string
  confirm: string
  token: string
  shown: boolean
  emailError: string
  passwordError: string
  confirmError: string
  codeError: string
  ghosts: FieldName[]
  entered: FieldName[]
  openFields: FieldName[]
  onRestart: () => void
  onEmail: (value: string) => void
  onPassword: (value: string) => void
  onConfirm: (value: string) => void
  onToken: (value: string) => void
  onEmailBlur: () => void
  onPasswordBlur: () => void
  onConfirmBlur: () => void
  onToggleShown: () => void
  onGo: (mode: AuthMode) => void
  onResend: () => void
}

/** Called during the panel render so fields stay addressable in the page tree. */
export function authBody(props: AuthBodyProps): ReactNode {
  const { t, mode, busy, task, errorCode, successCode, needsRestart, email, password, confirm, token, shown, emailError, passwordError, confirmError, codeError, ghosts, entered, openFields, onRestart, onEmail, onPassword, onConfirm, onToken, onEmailBlur, onPasswordBlur, onConfirmBlur, onToggleShown, onGo, onResend } = props
  const linkAlign = mode === 'reset' ? 'end' : 'between'
  const linkActions = mode === 'login'
    ? [textButton(t('needReset'), busy, () => { onGo('reset') }), textButton(t('needAccount'), busy, () => { onGo('register') })]
    : mode === 'register'
      ? [textButton(t('needVerify'), busy, () => { onGo('verify') }), textButton(t('haveAccount'), busy, () => { onGo('login') })]
      : mode === 'verify' || mode === 'resetConfirm'
        ? [
          textButton(
            t(task === 'resend' ? 'sending' : 'resendCode'),
            busy || (mode === 'resetConfirm' && !validEmail(email)),
            mode === 'resetConfirm' ? onResend : () => { onGo('register') }
          ),
          textButton(t('haveAccount'), busy, () => { onGo('login') })
        ]
        : [textButton(t('haveAccount'), busy, () => { onGo('login') })]
  return (
    <>
      <div data-dsh-flip="feedback">
        {errorCode ? <p className={styles.alert} role="alert">{messageText(t, errorCode)}</p> : null}
        {successCode ? <p className={styles.status} role="status">{messageText(t, successCode)}</p> : null}
        {needsRestart ? <RestartNotice t={t} kind="signOut" busy={busy} onRestart={onRestart} /> : null}
      </div>
      <div className={styles.slots} data-dsh-account-slots="true">
        {FIELD_ORDER.filter(name => openFields.includes(name) || ghosts.includes(name)).map(name => {
          const open = openFields.includes(name)
          const locked = busy || !open
          const control = name === 'email'
            ? (
              <TextField
                field="email"
                present={open}
                label={t('email')}
                type="email"
                value={email}
                busy={locked}
                invalid={open && emailError !== ''}
                error={open ? emailError : ''}
                autoComplete="username"
                autoFocus={open}
                onBlur={onEmailBlur}
                onChange={onEmail}
              />
            )
            : name === 'token'
              ? (
                <TextField
                  field="token"
                  present={open}
                  label={t('token')}
                  type="text"
                  value={token}
                  busy={locked}
                  invalid={open && codeError !== ''}
                  error={open ? codeError : ''}
                  autoComplete="one-time-code"
                  autoFocus={open && !needsEmail(mode)}
                  onChange={onToken}
                />
              )
              : name === 'password'
                ? (
                  <PasswordField
                    t={t}
                    field="password"
                    present={open}
                    label={t('password')}
                    value={password}
                    shown={shown}
                    busy={locked}
                    invalid={open && passwordError !== ''}
                    error={open ? passwordError : ''}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    autoFocus={false}
                    onBlur={onPasswordBlur}
                    onChange={onPassword}
                    onToggle={onToggleShown}
                  />
                )
                : (
                  <PasswordField
                    t={t}
                    field="confirm"
                    present={open}
                    label={t('confirmPassword')}
                    value={confirm}
                    shown={shown}
                    busy={locked}
                    invalid={open && confirmError !== ''}
                    error={open ? confirmError : ''}
                    autoComplete="new-password"
                    autoFocus={false}
                    onBlur={onConfirmBlur}
                    onChange={onConfirm}
                    onToggle={onToggleShown}
                  />
                )
          return (
            <div
              key={name}
              className={styles.slot}
              data-dsh-account-slot={name}
              data-dsh-flip={name}
              data-open={open ? 'true' : 'false'}
              data-motion={open ? (entered.includes(name) ? 'enter' : undefined) : 'exit'}
              aria-hidden={open ? undefined : 'true'}
              {...(open ? {} : { inert: '' as unknown as boolean })}
            >
              <div className={styles.slotBody}>{control}</div>
            </div>
          )
        })}
      </div>
      <div className={styles.links} data-dsh-flip="links">
        <div key={mode} className={`${styles.linkRow} ${styles.cross}`} data-dsh-account-link-row="true" data-dsh-account-cross="true" data-align={linkAlign}>
          {linkActions}
        </div>
      </div>
    </>
  )
}
