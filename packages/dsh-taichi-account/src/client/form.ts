export type AuthMode = 'login' | 'register' | 'verify' | 'reset' | 'resetConfirm'
export type FieldName = 'email' | 'token' | 'password' | 'confirm'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

export function validEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim())
}

const PASSWORD_MIN = 8
const PASSWORD_MAX = 200

// New passwords follow the gateway limit and Better Auth's length checks:
// 8 to 200 characters, with spaces and any other characters allowed.
// Sign-in only rejects an empty or oversized value. The gateway compares
// the stored hash, so an existing password is not remeasured here.
export function passwordIssue(mode: AuthMode, password: string, touched: boolean): '' | 'passwordRequired' | 'passwordTooLong' | 'passwordLength' {
  if (!needsPassword(mode) || (password === '' && !touched)) return ''
  if (mode === 'login') {
    if (password === '') return 'passwordRequired'
    return password.length > PASSWORD_MAX ? 'passwordTooLong' : ''
  }
  return password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX ? '' : 'passwordLength'
}

export function confirmIssue(mode: AuthMode, password: string, confirm: string, touched: boolean): '' | 'passwordMismatch' {
  if (!needsConfirm(mode) || (confirm === '' && !touched)) return ''
  return confirm === password ? '' : 'passwordMismatch'
}

export function needsEmail(mode: AuthMode): boolean {
  return mode === 'login' || mode === 'register' || mode === 'reset'
}

export function needsPassword(mode: AuthMode): boolean {
  return mode === 'login' || mode === 'register' || mode === 'resetConfirm'
}

export function needsConfirm(mode: AuthMode): boolean {
  return mode === 'register' || mode === 'resetConfirm'
}

export function needsToken(mode: AuthMode): boolean {
  return mode === 'verify' || mode === 'resetConfirm'
}

// Mail carries a code the user types here. A pasted http(s) link is rejected
// so an old verification URL is not sent to the gateway as the code.
export function codeIssue(mode: AuthMode, token: string): '' | 'codeExpected' {
  if (!needsToken(mode)) return ''
  const code = token.trim()
  if (code === '') return ''
  try {
    const url = new URL(code)
    if (url.protocol === 'http:' || url.protocol === 'https:') return 'codeExpected'
  } catch {
    // A verification code is not a URL.
  }
  return ''
}

export function canSubmit(mode: AuthMode, email: string, password: string, token: string, confirm: string): boolean {
  if (needsEmail(mode) && !validEmail(email)) return false
  if (passwordIssue(mode, password, true) !== '') return false
  if (needsConfirm(mode) && confirm !== password) return false
  if (needsToken(mode) && (token.trim() === '' || codeIssue(mode, token) !== '')) return false
  return true
}
