window.__ModuleLoader__.load({
  id: 'dsh-desktop-account',
  chunk: 'client.form.js',
  factory: (require) => {
    const React = require('react')
    const { Input } = require('@deepseek-ai/dsh-client-ui-primitives')
    const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

    function validEmail(value) {
      return EMAIL_PATTERN.test(value.trim())
    }

    const PASSWORD_MIN = 8
    const PASSWORD_MAX = 200

    // New passwords follow the gateway limit and Better Auth's length checks:
    // 8 to 200 characters, with spaces and any other characters allowed.
    // Sign-in only rejects an empty or oversized value. The gateway compares
    // the stored hash, so an existing password is not remeasured here.
    function passwordIssue(mode, password, touched) {
      if (!needsPassword(mode) || (password === '' && !touched)) return ''
      if (mode === 'login') {
        if (password === '') return 'passwordRequired'
        return password.length > PASSWORD_MAX ? 'passwordTooLong' : ''
      }
      return password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX ? '' : 'passwordLength'
    }

    function confirmIssue(mode, password, confirm, touched) {
      if (!needsConfirm(mode) || (confirm === '' && !touched)) return ''
      return confirm === password ? '' : 'passwordMismatch'
    }

    function needsEmail(mode) {
      return mode === 'login' || mode === 'register' || mode === 'reset'
    }

    function needsPassword(mode) {
      return mode === 'login' || mode === 'register' || mode === 'resetConfirm'
    }

    function needsConfirm(mode) {
      return mode === 'register' || mode === 'resetConfirm'
    }

    function needsToken(mode) {
      return mode === 'verify' || mode === 'resetConfirm'
    }

    // Registration mail contains a link such as /v1/auth/verify?token=...
    // The gateway still verifies the token itself, so a pasted link is reduced
    // to that query value. A bare token is left unchanged.
    function verificationToken(value) {
      const text = value.trim()
      if (text === '') return ''
      try {
        const token = new URL(text).searchParams.get('token')
        if (token !== null && token.trim() !== '') return token.trim()
      } catch {
        // A bare token is not a URL.
      }
      return text
    }

    function canSubmit(mode, email, password, token, confirm) {
      if (needsEmail(mode) && !validEmail(email)) return false
      if (passwordIssue(mode, password, true) !== '') return false
      if (needsConfirm(mode) && confirm !== password) return false
      if (mode === 'verify' && verificationToken(token) === '') return false
      if (mode === 'resetConfirm' && token.trim() === '') return false
      return true
    }

    function EyeIcon({ off }) {
      return React.createElement(
        'svg',
        {
          width: 16,
          height: 16,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true'
        },
        off
          ? React.createElement(React.Fragment, null,
            React.createElement('path', { d: 'M3 3l18 18' }),
            React.createElement('path', { d: 'M10.6 10.6A2 2 0 0 0 12 14a2 2 0 0 0 1.4-.6' }),
            React.createElement('path', { d: 'M9.9 5.2A9.8 9.8 0 0 1 12 5c5 0 8.5 4.2 9.5 7-.4 1.1-1.2 2.5-2.3 3.7' }),
            React.createElement('path', { d: 'M6.1 6.1C4.3 7.4 3 9.2 2.5 12 3.5 14.8 7 19 12 19c1.2 0 2.3-.2 3.3-.6' })
          )
          : React.createElement(React.Fragment, null,
            React.createElement('path', { d: 'M2.5 12C3.5 8.2 7 4 12 4s8.5 4.2 9.5 8c-1 3.8-4.5 8-9.5 8s-8.5-4.2-9.5-8z' }),
            React.createElement('circle', { cx: 12, cy: 12, r: 2.5 })
          )
      )
    }

    function TextField({ field, label, type, value, busy, invalid, error, autoComplete, autoFocus, onChange, onBlur }) {
      return React.createElement(
        'label',
        { className: 'dshDeskAccountField' },
        React.createElement('span', { className: 'dshDeskAccountLabel' }, label),
        React.createElement(Input, {
          className: 'dshDeskAccountInput',
          type,
          value,
          autoComplete,
          disabled: busy,
          'aria-invalid': invalid || undefined,
          'data-modal-autofocus': autoFocus ? 'true' : undefined,
          'data-dsh-account-field': field,
          onBlur,
          onChange: event => { onChange(event.target.value) }
        }),
        error ? React.createElement('span', { className: 'dshDeskAccountFieldError', role: 'alert' }, error) : null
      )
    }

    function PasswordField({ t, field, label, value, shown, busy, invalid, error, autoComplete, autoFocus, onChange, onBlur, onToggle }) {
      return React.createElement(
        'label',
        { className: 'dshDeskAccountField' },
        React.createElement('span', { className: 'dshDeskAccountLabel' }, label),
        React.createElement(
          'div',
          { className: 'dshDeskAccountControl' },
          React.createElement(Input, {
            className: 'dshDeskAccountInput',
            type: shown ? 'text' : 'password',
            value,
            autoComplete,
            disabled: busy,
            'aria-invalid': invalid || undefined,
            'data-modal-autofocus': autoFocus ? 'true' : undefined,
            'data-dsh-account-field': field,
            onBlur,
            onChange: event => { onChange(event.target.value) }
          }),
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'dshDeskAccountReveal',
              'aria-label': t(shown ? 'hidePassword' : 'showPassword'),
              disabled: busy,
              onClick: onToggle
            },
            React.createElement(EyeIcon, { off: shown })
          )
        ),
        error ? React.createElement('span', { className: 'dshDeskAccountFieldError', role: 'alert' }, error) : null
      )
    }

    return {
      validEmail,
      passwordIssue,
      confirmIssue,
      needsEmail,
      needsPassword,
      needsConfirm,
      needsToken,
      verificationToken,
      canSubmit,
      TextField,
      PasswordField
    }
  }
})
