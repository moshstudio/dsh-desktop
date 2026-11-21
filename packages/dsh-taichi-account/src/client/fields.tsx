import { useId } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from './locale'
import styles from './account.module.css'

interface EyeIconProps {
  off: boolean
}

// The primitives icon set has no visibility glyph. This mark only fills Button.
function EyeIcon({ off }: EyeIconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {off
        ? <>
          <path d="M3 3l18 18" />
          <path d="M10.6 10.6A2 2 0 0 0 12 14a2 2 0 0 0 1.4-.6" />
          <path d="M9.9 5.2A9.8 9.8 0 0 1 12 5c5 0 8.5 4.2 9.5 7-.4 1.1-1.2 2.5-2.3 3.7" />
          <path d="M6.1 6.1C4.3 7.4 3 9.2 2.5 12 3.5 14.8 7 19 12 19c1.2 0 2.3-.2 3.3-.6" />
        </>
        : <>
          <path d="M2.5 12C3.5 8.2 7 4 12 4s8.5 4.2 9.5 8c-1 3.8-4.5 8-9.5 8s-8.5-4.2-9.5-8z" />
          <circle cx="12" cy="12" r="2.5" />
        </>}
    </svg>
  )
}

export interface TextFieldProps {
  field: string
  present?: boolean
  label: string
  type: string
  value: string
  busy: boolean
  invalid: boolean
  error: string
  autoComplete: string
  autoFocus?: boolean
  onChange: (value: string) => void
  onBlur?: () => void
}

export function TextField({ field, label, type, value, busy, invalid, error, autoComplete, autoFocus, onChange, onBlur }: TextFieldProps) {
  const errorId = useId()
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      <Input
        className={styles.input}
        type={type}
        value={value}
        autoComplete={autoComplete}
        disabled={busy}
        aria-invalid={invalid || undefined}
        aria-describedby={error ? errorId : undefined}
        data-modal-autofocus={autoFocus ? 'true' : undefined}
        data-dsh-account-field={field}
        onBlur={onBlur}
        onChange={event => { onChange(event.target.value) }}
      />
      {error ? <span id={errorId} className={styles.fieldError} role="alert">{error}</span> : null}
    </label>
  )
}

export interface PasswordFieldProps {
  t: Translate
  field: string
  present?: boolean
  label: string
  value: string
  shown: boolean
  busy: boolean
  invalid: boolean
  error: string
  autoComplete: string
  autoFocus?: boolean
  onChange: (value: string) => void
  onBlur?: () => void
  onToggle: () => void
}

export function PasswordField({ t, field, label, value, shown, busy, invalid, error, autoComplete, autoFocus, onChange, onBlur, onToggle }: PasswordFieldProps) {
  const errorId = useId()
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      <div className={styles.control}>
        <Input
          className={styles.input}
          type={shown ? 'text' : 'password'}
          value={value}
          autoComplete={autoComplete}
          disabled={busy}
          aria-invalid={invalid || undefined}
          aria-describedby={error ? errorId : undefined}
          data-modal-autofocus={autoFocus ? 'true' : undefined}
          data-dsh-account-field={field}
          onBlur={onBlur}
          onChange={event => { onChange(event.target.value) }}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={styles.reveal}
          aria-label={t(shown ? 'hidePassword' : 'showPassword')}
          disabled={busy}
          icon={<EyeIcon off={shown} />}
          onClick={onToggle}
        />
      </div>
      {error ? <span id={errorId} className={styles.fieldError} role="alert">{error}</span> : null}
    </label>
  )
}
