window.__ModuleLoader__.load({
  id: 'dsh-taichi-account',
  chunk: 'client.dialog.js',
  factory: (require) => {
    const React = require('react')
    const { useEffect, useId, useRef, useState } = React
    const {
      Button,
      Modal,
      RiskConfirmation,
      Tooltip,
      IconChevronLeftOutlineRegular,
      IconInfoOutlineRegular,
      IconUserOutlineRegular
    } = require('@deepseek-ai/dsh-client-ui-primitives')

    const OPEN_EVENT = 'dsh-taichi-account-open'
    const statusBus = {
      current: null,
      revision: 0,
      listeners: new Set(),
      subscribe(listener) {
        this.listeners.add(listener)
        return () => { this.listeners.delete(listener) }
      },
      reset() {
        this.current = null
        this.revision += 1
      }
    }

    function publishStatus(next) {
      statusBus.current = next
      statusBus.revision += 1
      for (const listener of statusBus.listeners) listener(next)
    }

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
      const EMAIL_MEMORY_KEY = 'dsh-taichi-account-email'

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

      function accountModels(value) {
        if (!Array.isArray(value)) return []
        const models = []
        for (const item of value) {
          if (typeof item === 'string' && item.length > 0) {
            models.push({ id: item, name: item })
            continue
          }
          if (item === null || typeof item !== 'object' || typeof item.id !== 'string' || item.id.length === 0) continue
          const name = typeof item.name === 'string' && item.name.length > 0 ? item.name : item.id
          const vendor = typeof item.vendor === 'string' && item.vendor.trim().length > 0 ? item.vendor.trim() : undefined
          const price = modelPrice(item.price)
          const model = { id: item.id, name }
          if (vendor) model.vendor = vendor
          if (price) model.price = price
          models.push(model)
        }
        return models
      }

      const VENDOR_LABELS = {
        openai: 'OpenAI',
        anthropic: 'Anthropic',
        google: 'Google',
        gemini: 'Google',
        deepseek: 'DeepSeek',
        qwen: 'Qwen',
        alibaba: 'Qwen',
        moonshot: 'Moonshot',
        kimi: 'Moonshot',
        zhipu: 'Zhipu',
        glm: 'Zhipu',
        minimax: 'MiniMax',
        mistral: 'Mistral',
        meta: 'Meta',
        llama: 'Meta',
        xai: 'xAI',
        grok: 'xAI',
        cohere: 'Cohere',
        doubao: 'Doubao',
        bytedance: 'Doubao',
        hunyuan: 'Hunyuan',
        tencent: 'Hunyuan',
        baidu: 'Baidu',
        wenxin: 'Baidu',
        yi: '01.AI',
        spark: 'iFlytek',
        iflytek: 'iFlytek',
        baichuan: 'Baichuan',
        stepfun: 'StepFun',
        perplexity: 'Perplexity',
        amazon: 'Amazon'
      }

      const VENDOR_FAMILIES = [
        [/^(gpt|chatgpt|o1|o3|o4)([-.]|$)/iu, 'openai'],
        [/^claude/iu, 'anthropic'],
        [/^(gemini|gemma)/iu, 'google'],
        [/^deepseek/iu, 'deepseek'],
        [/^(qwen|qwq)/iu, 'qwen'],
        [/^(glm|zhipu)/iu, 'zhipu'],
        [/^(kimi|moonshot)/iu, 'moonshot'],
        [/^(mistral|mixtral|codestral)/iu, 'mistral'],
        [/^llama/iu, 'meta'],
        [/^grok/iu, 'xai'],
        [/^doubao/iu, 'doubao'],
        [/^hunyuan/iu, 'hunyuan'],
        [/^(ernie|wenxin)/iu, 'baidu'],
        [/^yi[-.]/iu, 'yi'],
        [/^spark/iu, 'spark'],
        [/^baichuan/iu, 'baichuan'],
        [/^step-/iu, 'stepfun'],
        [/^(minimax|abab)/iu, 'minimax'],
        [/^sonar/iu, 'perplexity']
      ]

      function modelVendorKey(model) {
        if (typeof model.vendor === 'string' && model.vendor.trim().length > 0) return model.vendor.trim().toLowerCase()
        const slash = model.id.indexOf('/')
        if (slash > 0) return model.id.slice(0, slash).toLowerCase()
        for (const [pattern, vendor] of VENDOR_FAMILIES) {
          if (pattern.test(model.id) || pattern.test(model.name)) return vendor
        }
        return ''
      }

      function vendorLabel(t, key) {
        if (!key) return t('vendorOther')
        return Object.hasOwn(VENDOR_LABELS, key) ? VENDOR_LABELS[key] : `${key.charAt(0).toUpperCase()}${key.slice(1)}`
      }

      function compareText(left, right) {
        return left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true })
      }

      function compareByPrice(left, right) {
        const leftIn = left.model.price?.inputPerMillion
        const rightIn = right.model.price?.inputPerMillion
        const leftMissing = leftIn === undefined
        const rightMissing = rightIn === undefined
        if (leftMissing !== rightMissing) return leftMissing ? 1 : -1
        if (!leftMissing && leftIn !== rightIn) return leftIn - rightIn
        const leftOut = left.model.price?.outputPerMillion ?? Number.POSITIVE_INFINITY
        const rightOut = right.model.price?.outputPerMillion ?? Number.POSITIVE_INFINITY
        if (leftOut !== rightOut) return leftOut - rightOut
        const byName = compareText(left.model.name, right.model.name)
        return byName !== 0 ? byName : left.index - right.index
      }

      function compareVendor(left, right, t) {
        if (left === right) return 0
        if (left === 'openai') return -1
        if (right === 'openai') return 1
        if (!left) return 1
        if (!right) return -1
        return compareText(vendorLabel(t, left), vendorLabel(t, right))
      }

      function modelsByVendor(models, t) {
        const decorated = models.map((model, index) => ({ model, index, key: modelVendorKey(model) }))
        decorated.sort((left, right) => {
          const byVendor = compareVendor(left.key, right.key, t)
          if (byVendor !== 0) return byVendor
          return compareByPrice(left, right)
        })
        const groups = []
        for (const item of decorated) {
          const last = groups[groups.length - 1]
          if (!last || last.key !== item.key) {
            groups.push({ key: item.key, label: vendorLabel(t, item.key), models: [item.model] })
          } else {
            last.models.push(item.model)
          }
        }
        return groups
      }

      function modelsByPrice(models) {
        return models.map((model, index) => ({ model, index })).sort(compareByPrice).map(item => item.model)
      }

      const WEEKDAY_KEYS = ['weekdayMon', 'weekdayTue', 'weekdayWed', 'weekdayThu', 'weekdayFri', 'weekdaySat', 'weekdaySun']

      function modelPrice(value) {
        if (value === null || typeof value !== 'object') return undefined
        const inputPerMillion = creditCount(value.inputPerMillion)
        const outputPerMillion = creditCount(value.outputPerMillion)
        if (inputPerMillion === undefined || outputPerMillion === undefined) return undefined
        const price = { inputPerMillion, outputPerMillion }
        assignCredit(price, 'cachePerMillion', value.cachePerMillion)
        assignCredit(price, 'cacheWrite5mPerMillion', value.cacheWrite5mPerMillion)
        assignCredit(price, 'cacheWrite1hPerMillion', value.cacheWrite1hPerMillion)
        assignHigherCredit(price, 'listInputPerMillion', value.listInputPerMillion, inputPerMillion)
        assignHigherCredit(price, 'listOutputPerMillion', value.listOutputPerMillion, outputPerMillion)
        const savingsRatio = readSavingsRatio(value.savingsRatio)
        if (savingsRatio !== undefined) price.savingsRatio = savingsRatio
        const longContext = readLongContext(value.longContext)
        const peak = readPeak(value.peak)
        if (longContext) price.longContext = longContext
        if (peak) price.peak = peak
        return price
      }

      function assignCredit(price, key, value) {
        const amount = creditCount(value)
        if (amount !== undefined) price[key] = amount
      }

      function assignHigherCredit(price, key, value, sell) {
        const amount = creditCount(value)
        if (amount !== undefined && amount > sell) price[key] = amount
      }

      function readSavingsRatio(value) {
        return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1 ? value : undefined
      }

      function readLongContext(value) {
        if (value === null || typeof value !== 'object') return undefined
        const minInputTokens = positiveInt(value.minInputTokens)
        const input = positiveFactor(value.input)
        const output = positiveFactor(value.output)
        const cache = positiveFactor(value.cache)
        const cacheWrite = positiveFactor(value.cacheWrite)
        if (minInputTokens === undefined || input === undefined || output === undefined || cache === undefined || cacheWrite === undefined) return undefined
        return { minInputTokens, input, output, cache, cacheWrite }
      }

      function readPeak(value) {
        if (value === null || typeof value !== 'object' || !Array.isArray(value.weekdays) || !Array.isArray(value.windows) || value.windows.length === 0) return undefined
        const multiplier = positiveFactor(value.multiplier)
        if (multiplier === undefined || value.weekdays.length === 0) return undefined
        const weekdays = []
        for (const day of value.weekdays) {
          if (!Number.isInteger(day) || day < 0 || day > 6 || weekdays.includes(day)) return undefined
          weekdays.push(day)
        }
        const windows = []
        for (const window of value.windows) {
          if (!Array.isArray(window)) return undefined
          const start = clockText(window[0])
          const end = clockText(window[1])
          if (!start || !end) return undefined
          windows.push([start, end])
        }
        return { multiplier, weekdays, windows }
      }

      function creditCount(value) {
        return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
      }

      function positiveFactor(value) {
        return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
      }

      function positiveInt(value) {
        return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
      }

      function clockText(value) {
        return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/u.test(value) ? value : undefined
      }

      function formatCredits(value) {
        if (!Number.isInteger(value)) return String(value)
        return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
      }

      function phrase(t, key, vars) {
        const translated = t(key, vars)
        const value = typeof translated === 'string' ? translated : key
        if (!vars) return value
        return value.replace(/\{(\w+)\}/gu, (match, name) => {
          const replacement = vars[name]
          return replacement === undefined ? match : String(replacement)
        })
      }

      function savingsPercent(price) {
        if (typeof price.savingsRatio !== 'number') return undefined
        const percent = Math.round(price.savingsRatio * 100)
        return percent >= 1 && percent <= 100 ? percent : undefined
      }

      function saveLabel(t, percent) {
        const label = phrase(t, 'priceSave', { percent: String(percent) })
        return label.includes(String(percent)) ? label : `${label} ${percent}%`
      }

      function rateRow(t, label, credits, listCredits) {
        return React.createElement(
          'div',
          { className: 'dshDeskAccountRate' },
          React.createElement('span', { className: 'dshDeskAccountRateLabel' }, t(label)),
          React.createElement(
            'span',
            { className: 'dshDeskAccountRateValues' },
            listCredits !== undefined ? React.createElement('del', { className: 'dshDeskAccountRateList' }, formatCredits(listCredits)) : null,
            React.createElement('span', { className: 'dshDeskAccountRateNow' }, formatCredits(credits)),
            React.createElement('span', { className: 'dshDeskAccountRateUnit' }, t('pricePerMillionUnit'))
          )
        )
      }

      function cacheLine(t, price) {
        const items = []
        if (price.cachePerMillion !== undefined) items.push(['cacheReadBrief', price.cachePerMillion])
        const write = price.cacheWrite5mPerMillion ?? price.cacheWrite1hPerMillion
        if (write !== undefined) items.push(['cacheWriteBrief', write])
        if (items.length === 0) return null
        const children = []
        items.forEach(([label, credits], index) => {
          if (index > 0) children.push(' · ')
          const unit = index === items.length - 1 ? 'perMillionTokens' : 'perMillion'
          children.push(t(label), ' ', formatCredits(credits), t(unit))
        })
        return React.createElement('p', { className: 'dshDeskAccountCache' }, ...children)
      }

      function joined(t, items) {
        const nodes = []
        items.forEach((item, index) => {
          if (index > 0) nodes.push(t('listSeparator'))
          nodes.push(item)
        })
        return nodes
      }

      function longContextLabel(t, tier) {
        return [
          t('longContext'),
          t('longContextFrom'),
          formatCredits(tier.minInputTokens),
          t('tokens'),
          `${t('inputPrice')} ×${formatCredits(tier.input)}`,
          `${t('outputPrice')} ×${formatCredits(tier.output)}`,
          `${t('cachePrice')} ×${formatCredits(tier.cache)}`,
          `${t('cacheWritePrice')} ×${formatCredits(tier.cacheWrite)}`
        ].join(' ')
      }

      function longContextInfo(t, tier) {
        return React.createElement(
          Tooltip,
          { label: longContextLabel(t, tier), side: 'top', portal: true, maxWidth: 360, delayMs: 200, openOnClick: true },
          React.createElement(
            'button',
            { type: 'button', className: 'dshDeskAccountInfo', 'aria-label': t('longContext') },
            React.createElement(IconInfoOutlineRegular, { size: 14 })
          )
        )
      }

      function peakNote(t, peak) {
        const days = peak.weekdays.map(day => t(WEEKDAY_KEYS[day]))
        const windows = peak.windows.map(window => `${window[0]}–${window[1]}`)
        return React.createElement(
          'p',
          { className: 'dshDeskAccountPriceNote' },
          t('peakPrice'),
          ' ×',
          formatCredits(peak.multiplier),
          ' ',
          t('peakUtc'),
          ' ',
          ...joined(t, days),
          ' ',
          ...joined(t, windows)
        )
      }

      function modelPriceView(t, price) {
        if (!price) return React.createElement('p', { className: 'dshDeskAccountPrice' }, t('priceUnavailable'))
        return React.createElement(
          React.Fragment,
          null,
          React.createElement(
            'div',
            { className: 'dshDeskAccountModelMeta' },
            React.createElement('span', { className: 'dshDeskAccountBill' }, t('billedByToken')),
            price.longContext ? longContextInfo(t, price.longContext) : null
          ),
          React.createElement(
            'div',
            { className: 'dshDeskAccountRates' },
            rateRow(t, 'inputPrice', price.inputPerMillion, price.listInputPerMillion),
            rateRow(t, 'outputPrice', price.outputPerMillion, price.listOutputPerMillion)
          ),
          cacheLine(t, price),
          price.peak ? peakNote(t, price.peak) : null
        )
      }

      const GRANT_KEYS = { checkin: 'kindCheckin', signup: 'kindSignup', purchase: 'kindPurchase', adjustment: 'kindAdjustment' }

      function wholeCredit(value) {
        return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
      }

      function accountCredits(value) {
        if (value === null || typeof value !== 'object') return undefined
        const consumed = wholeCredit(value.consumed)
        const recharged = wholeCredit(value.recharged)
        const usageCount = wholeCredit(value.usageCount)
        if (consumed === undefined || recharged === undefined || usageCount === undefined) return undefined
        if (!Array.isArray(value.consumption) || !Array.isArray(value.recharge)) return undefined
        const daily = readCreditDays(value.daily)
        if (!daily) return undefined
        return {
          consumed,
          recharged,
          usageCount,
          consumption: value.consumption.flatMap(readCreditUse),
          recharge: value.recharge.flatMap(readCreditGrant),
          daily
        }
      }

      function readCreditDays(value) {
        if (value === undefined) return []
        if (!Array.isArray(value)) return undefined
        const days = []
        for (const item of value.slice(-4000)) {
          const day = readCreditDay(item)
          if (!day) return undefined
          days.push(day)
        }
        return days
      }

      function readCreditDay(value) {
        if (value === null || typeof value !== 'object' || typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value.date)) return undefined
        const consumed = wholeCredit(value.consumed)
        const recharged = wholeCredit(value.recharged)
        const count = wholeCredit(value.count)
        if (consumed === undefined || recharged === undefined || count === undefined) return undefined
        return { date: value.date, consumed, recharged, count }
      }

      function shanghaiToday() {
        return new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).format(new Date())
      }

      function shiftDate(iso, days) {
        const [year, month, day] = iso.split('-').map(Number)
        const date = new Date(Date.UTC(year, month - 1, day))
        date.setUTCDate(date.getUTCDate() + days)
        return date.toISOString().slice(0, 10)
      }

      function rangeBounds(range, today, daily) {
        if (range === 'today') return [today, today]
        if (range === 'yesterday') {
          const day = shiftDate(today, -1)
          return [day, day]
        }
        if (range === '30') return [shiftDate(today, -29), today]
        if (range === 'all') {
          const first = daily[0]?.date
          return [first && first < today ? first : today, today]
        }
        return [shiftDate(today, -6), today]
      }

      function rangeStats(credits, range) {
        const daily = [...credits.daily].sort((left, right) => left.date < right.date ? -1 : left.date > right.date ? 1 : 0)
        const [start, end] = rangeBounds(range, shanghaiToday(), daily)
        const byDate = new Map(daily.map(day => [day.date, day]))
        const points = []
        let consumed = 0
        let recharged = 0
        let count = 0
        let cursor = start
        while (cursor <= end && points.length < 4000) {
          const day = byDate.get(cursor) ?? { date: cursor, consumed: 0, recharged: 0, count: 0 }
          consumed += day.consumed
          recharged += day.recharged
          count += day.count
          points.push(day)
          cursor = shiftDate(cursor, 1)
        }
        return { consumed, recharged, count, points: points.length > 400 ? points.slice(-400) : points }
      }

      function readCreditUse(value) {
        if (value === null || typeof value !== 'object') return []
        const amount = wholeCredit(value.amount)
        if (!amount || typeof value.id !== 'string' || typeof value.createdAt !== 'string') return []
        const model = typeof value.model === 'string' && value.model.length > 0 ? value.model : undefined
        return [{ id: value.id, amount, createdAt: value.createdAt, ...(model ? { model } : {}) }]
      }

      function readCreditGrant(value) {
        if (value === null || typeof value !== 'object' || !Object.hasOwn(GRANT_KEYS, value.kind)) return []
        const amount = wholeCredit(value.amount)
        if (!amount || typeof value.id !== 'string' || typeof value.createdAt !== 'string') return []
        return [{ id: value.id, amount, createdAt: value.createdAt, kind: value.kind }]
      }

      function formatWhen(value) {
        const time = Date.parse(value)
        if (!Number.isFinite(time)) return ''
        const date = new Date(time)
        const part = (number) => String(number).padStart(2, '0')
        return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())} ${part(date.getHours())}:${part(date.getMinutes())}`
      }

      // Tick spacing follows d3-array (Copyright 2010-2023 Mike Bostock, ISC):
      // https://github.com/d3/d3-array/blob/main/src/ticks.js
      const TICK_E10 = Math.sqrt(50)
      const TICK_E5 = Math.sqrt(10)
      const TICK_E2 = Math.sqrt(2)

      function tickSpec(start, stop, count) {
        const step = (stop - start) / Math.max(0, count)
        const power = Math.floor(Math.log10(step))
        const error = step / Math.pow(10, power)
        const factor = error >= TICK_E10 ? 10 : error >= TICK_E5 ? 5 : error >= TICK_E2 ? 2 : 1
        let i1
        let i2
        let inc
        if (power < 0) {
          inc = Math.pow(10, -power) / factor
          i1 = Math.round(start * inc)
          i2 = Math.round(stop * inc)
          if (i1 / inc < start) ++i1
          if (i2 / inc > stop) --i2
          inc = -inc
        } else {
          inc = Math.pow(10, power) * factor
          i1 = Math.round(start / inc)
          i2 = Math.round(stop / inc)
          if (i1 * inc < start) ++i1
          if (i2 * inc > stop) --i2
        }
        if (i2 < i1 && count >= 0.5 && count < 2) return tickSpec(start, stop, count * 2)
        return [i1, i2, inc]
      }

      function axisTicks(start, stop, count) {
        const reverse = stop < start
        const spec = reverse ? tickSpec(stop, start, count) : tickSpec(start, stop, count)
        const i1 = spec[0]
        const i2 = spec[1]
        const inc = spec[2]
        if (!(i2 >= i1)) return []
        const n = i2 - i1 + 1
        const values = []
        for (let index = 0; index < n; index += 1) {
          values.push(inc < 0 ? (i1 + index) / -inc : (i1 + index) * inc)
        }
        return reverse ? values.reverse() : values
      }

      function niceCeiling(max, count) {
        let start = 0
        let stop = max
        let previous
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const step = tickSpec(start, stop, count)[2]
          if (step === previous || step === 0 || !Number.isFinite(step)) break
          if (step > 0) {
            const i = Math.ceil(start / step)
            const j = Math.floor(stop / step)
            start = (i - (i * step > start)) * step
            stop = (j + (j * step < stop)) * step
          } else {
            const scale = -step
            const i = Math.ceil(start * scale)
            const j = Math.floor(stop * scale)
            start = (i - (i / scale > start)) / scale
            stop = (j + (j / scale < stop)) / scale
          }
          previous = step
        }
        return Math.max(stop, max)
      }

      function formatTick(value) {
        const nearest = Math.round(value)
        const shown = Math.abs(value - nearest) < 1e-6 ? nearest : Math.round(value * 10) / 10
        return Number.isInteger(shown) ? formatCredits(shown) : String(shown)
      }

      function consumptionChart(t, points) {
        if (!points.some(point => point.consumed > 0)) return React.createElement('p', { className: 'dshDeskAccountChartEmpty' }, t('chartEmpty'))
        const width = 640
        const height = 168
        const pad = { left: 46, right: 16, top: 18, bottom: 26 }
        const max = Math.max(...points.map(point => point.consumed))
        const ceiling = niceCeiling(max, 4)
        const ticks = axisTicks(0, ceiling, 4)
        const marks = ticks.length > 0 ? ticks : [0, ceiling]
        const plot = height - pad.top - pad.bottom
        const slot = (width - pad.left - pad.right) / points.length
        const barWidth = Math.max(4, Math.min(18, slot * 0.56))
        const baseline = pad.top + plot
        const labelStride = Math.max(1, Math.ceil(48 / slot))
        const bars = points.map((point, index) => {
          const bar = point.consumed <= 0 ? 0 : Math.max((point.consumed / ceiling) * plot, 2)
          const x = pad.left + slot * index + (slot - barWidth) / 2
          return {
            x,
            y: baseline - bar,
            height: bar,
            width: barWidth,
            hitX: pad.left + slot * index,
            hitWidth: slot,
            date: point.date,
            amount: point.consumed,
            visible: point.consumed > 0,
            labeled: index % labelStride === 0 || index === points.length - 1
          }
        })
        return React.createElement(
          'div',
          { className: 'dshDeskAccountChartPlot' },
          React.createElement(
            'svg',
            { className: 'dshDeskAccountChartSvg', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': t('creditStats') },
            marks.map(mark => {
              const y = baseline - (mark / ceiling) * plot
              return React.createElement('line', {
                key: `grid-${mark}`,
                className: 'dshDeskAccountChartGrid',
                x1: pad.left,
                x2: width - pad.right,
                y1: y,
                y2: y
              })
            }),
            marks.map(mark => React.createElement('text', {
              key: `tick-${mark}`,
              className: 'dshDeskAccountChartLabel',
              x: pad.left - 6,
              y: baseline - (mark / ceiling) * plot,
              textAnchor: 'end',
              dominantBaseline: 'middle'
            }, formatTick(mark))),
            bars.filter(bar => bar.visible).map(bar => React.createElement('rect', {
              key: bar.date,
              className: 'dshDeskAccountChartBar',
              x: bar.x.toFixed(1),
              y: bar.y.toFixed(1),
              width: bar.width.toFixed(1),
              height: bar.height.toFixed(1),
              rx: Math.min(3, bar.width / 2)
            })),
            bars.filter(bar => bar.labeled).map(bar => React.createElement('text', {
              key: `label-${bar.date}`,
              className: 'dshDeskAccountChartLabel',
              x: (bar.x + bar.width / 2).toFixed(1),
              y: height - 6,
              textAnchor: 'middle'
            }, bar.date.slice(5)))
          ),
          bars.map(bar => {
            const hitHeight = Math.max(bar.height, 12)
            const hitTop = Math.max(pad.top, bar.y + bar.height - hitHeight)
            return React.createElement(
              'div',
              {
                key: bar.date,
                className: 'dshDeskAccountChartHit',
                tabIndex: 0,
                'aria-label': `${bar.date} ${formatCredits(bar.amount)}`,
                style: {
                  left: `${(bar.hitX / width) * 100}%`,
                  width: `${(bar.hitWidth / width) * 100}%`,
                  top: `${(hitTop / height) * 100}%`,
                  height: `${(hitHeight / height) * 100}%`
                }
              },
              React.createElement('span', { className: 'dshDeskAccountChartTip', role: 'tooltip' }, bar.date, ' · ', formatCredits(bar.amount))
            )
          })
        )
      }

      function rangeButton(value, label, selected, onSelect) {
        return React.createElement('button', {
          type: 'button',
          className: 'dshDeskAccountRange',
          'aria-pressed': selected ? 'true' : 'false',
          onClick: () => { if (!selected) onSelect(value) }
        }, label)
      }

      function statCard(label, value, tone) {
        return React.createElement(
          'div',
          { className: 'dshDeskAccountStat', 'data-tone': tone },
          React.createElement('p', { className: 'dshDeskAccountStatLabel' }, label),
          React.createElement('p', { className: 'dshDeskAccountStatValue' }, value)
        )
      }

      function activityEntry(key, title, when, amount, sign) {
        return React.createElement(
          'li',
          { key },
          React.createElement(
            'div',
            { className: 'dshDeskAccountEntry' },
            React.createElement(
              'div',
              { className: 'dshDeskAccountEntryMain' },
              React.createElement('p', { className: 'dshDeskAccountEntryTitle' }, title),
              when ? React.createElement('p', { className: 'dshDeskAccountEntryTime' }, when) : null
            ),
            React.createElement('span', { className: 'dshDeskAccountEntryAmount', 'data-sign': sign }, `${sign === 'plus' ? '+' : '−'}${formatCredits(amount)}`)
          )
        )
      }

      function sectionTab(id, panelId, value, label, count, selected, onSelect) {
        return React.createElement(
          'button',
          {
            type: 'button',
            id,
            className: 'dshDeskAccountTab',
            role: 'tab',
            'aria-selected': selected ? 'true' : 'false',
            'aria-controls': panelId,
            tabIndex: selected ? 0 : -1,
            onClick: () => { if (!selected) onSelect(value) }
          },
          label,
          count > 0 ? React.createElement('span', { className: 'dshDeskAccountTabCount' }, String(count)) : null
        )
      }

      const RECHARGE_YUAN = [39, 99, 199, 299]
      const CREDIT_PER_YUAN = 1000

      function paymentQr(value) {
        return typeof value === 'string' && value.startsWith('data:image/png;base64,') && value.length <= 200000 ? value : ''
      }

      function modelCards(t, models) {
        return models.map((model, index) => {
          const percent = model.price ? savingsPercent(model.price) : undefined
          return React.createElement(
            'li',
            { key: `${model.id}-${index}` },
            React.createElement(
              'article',
              { className: 'dshDeskAccountModel' },
              React.createElement(
                'div',
                { className: 'dshDeskAccountModelHead' },
                React.createElement('h4', { className: 'dshDeskAccountModelName' }, model.name),
                percent !== undefined
                  ? React.createElement('span', { className: 'dshDeskAccountSave' }, saveLabel(t, percent))
                  : null
              ),
              modelPriceView(t, model.price)
            )
          )
        })
      }

      function HomeScreen({ t, status, busy, task, errorCode, section, onSection, range, onRange, modelSort, onModelSort, modelsId, usageId, rechargeId, onCheckIn, onRecharge, onLogout, onRetry }) {
        const flags = profileFlags(status)
        const checkedIn = status.checkedIn === true || status.message === 'checked_in'
        const balance = status.balance == null ? '—' : status.balance
        const balanceCaption = status.balance == null ? t('balanceUnread') : checkedIn ? t('checked_in') : t('balance')
        const announced = checkedIn && status.balance != null
        const models = accountModels(status?.models)
        const credits = accountCredits(status?.credits)
        const activeRange = range === 'today' || range === 'yesterday' || range === '30' || range === 'all' ? range : '7'
        const stats = credits ? rangeStats(credits, activeRange) : undefined
        const active = section === 'usage' || section === 'recharge' ? section : 'models'
        const modelsPanel = `${modelsId}-panel`
        const usagePanel = `${usageId}-panel`
        const rechargePanel = `${rechargeId}-panel`
        const panelId = active === 'usage' ? usagePanel : active === 'recharge' ? rechargePanel : modelsPanel
        const panelLabel = active === 'usage' ? usageId : active === 'recharge' ? rechargeId : modelsId
        const activity = active === 'usage'
          ? credits?.consumption.map(entry => activityEntry(entry.id, entry.model || t('usageUntitled'), formatWhen(entry.createdAt), entry.amount, 'minus')) ?? []
          : active === 'recharge'
            ? credits?.recharge.map(entry => activityEntry(entry.id, t(GRANT_KEYS[entry.kind]), formatWhen(entry.createdAt), entry.amount, 'plus')) ?? []
            : []
        const sort = modelSort === 'price' ? 'price' : 'vendor'
        const vendorGroups = sort === 'vendor' ? modelsByVendor(models, t) : []
        const catalog = flags.models
          ? React.createElement('p', { className: 'dshDeskAccountEmpty' }, t('modelsUnread'))
          : models.length > 0
            ? React.createElement(
              React.Fragment,
              null,
              React.createElement(
                'div',
                { className: 'dshDeskAccountRanges dshDeskAccountModelSort', role: 'group', 'aria-label': t('sortModels') },
                rangeButton('vendor', t('sortByVendor'), sort === 'vendor', onModelSort),
                rangeButton('price', t('sortByPrice'), sort === 'price', onModelSort)
              ),
              sort === 'price' || vendorGroups.length < 2
                ? React.createElement('ul', { className: 'dshDeskAccountModels' }, modelCards(t, sort === 'price' ? modelsByPrice(models) : vendorGroups[0].models))
                : React.createElement(
                  'div',
                  { className: 'dshDeskAccountVendors' },
                  vendorGroups.map(group => React.createElement(
                    'section',
                    { key: group.key || 'other', className: 'dshDeskAccountVendor' },
                    React.createElement('h3', { className: 'dshDeskAccountVendorName' }, group.label),
                    React.createElement('ul', { className: 'dshDeskAccountModels' }, modelCards(t, group.models))
                  ))
                )
            )
            : React.createElement('p', { className: 'dshDeskAccountEmpty' }, t('modelsEmpty'))
        const ledger = !credits
          ? React.createElement('p', { className: 'dshDeskAccountEmpty' }, t('creditsUnread'))
          : activity.length > 0
            ? React.createElement('ul', { className: 'dshDeskAccountEntries' }, activity)
            : React.createElement('p', { className: 'dshDeskAccountEmpty' }, t(active === 'usage' ? 'consumptionEmpty' : 'rechargeEmpty'))
        return React.createElement(
          React.Fragment,
          null,
          errorCode ? React.createElement('p', { className: 'dshDeskAccountAlert', role: 'alert' }, messageText(t, errorCode)) : null,
          React.createElement(
            'section',
            { className: 'dshDeskAccountOverview' },
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
              { className: 'dshDeskAccountHero' },
              React.createElement(
                'div',
                { className: 'dshDeskAccountCredits' },
                React.createElement(
                  'div',
                  { className: 'dshDeskAccountCreditMain' },
                  React.createElement('p', {
                    className: 'dshDeskAccountCaption',
                    role: announced ? 'status' : undefined,
                    'aria-live': announced ? 'polite' : undefined,
                    'data-success': announced ? 'true' : 'false'
                  }, balanceCaption),
                  React.createElement('p', { className: 'dshDeskAccountBalance' }, String(balance))
                ),
                React.createElement(
                  'div',
                  { className: 'dshDeskAccountCreditActions' },
                  React.createElement(Button, {
                    variant: checkedIn ? 'ghost' : 'primary',
                    size: 'sm',
                    disabled: busy || checkedIn,
                    onClick: onCheckIn
                  }, t(task === 'checkIn' ? 'checkingIn' : checkedIn ? 'checkedInDone' : 'checkIn')),
                  React.createElement(Button, {
                    variant: checkedIn ? 'primary' : 'ghost',
                    size: 'sm',
                    disabled: busy,
                    onClick: onRecharge
                  }, t('rechargeAction'))
                )
              ),
              credits
                ? React.createElement(
                  'div',
                  { className: 'dshDeskAccountHeroStat' },
                  React.createElement('p', { className: 'dshDeskAccountStatLabel' }, t('consumed')),
                  React.createElement('p', { className: 'dshDeskAccountBalance' }, formatCredits(credits.consumed))
                )
                : null
            ),
            stats
              ? React.createElement(
                'div',
                { className: 'dshDeskAccountRanges' },
                rangeButton('today', t('rangeToday'), activeRange === 'today', onRange),
                rangeButton('yesterday', t('rangeYesterday'), activeRange === 'yesterday', onRange),
                rangeButton('7', t('range7'), activeRange === '7', onRange),
                rangeButton('30', t('range30'), activeRange === '30', onRange),
                rangeButton('all', t('rangeAll'), activeRange === 'all', onRange)
              )
              : null,
            stats
              ? React.createElement(
                'div',
                { className: 'dshDeskAccountMetrics' },
                statCard(t('consumed'), formatCredits(stats.consumed), 'minus'),
                statCard(t('recharged'), formatCredits(stats.recharged), 'plus'),
                statCard(t('usageCount'), formatCredits(stats.count), 'count')
              )
              : React.createElement('p', { className: 'dshDeskAccountUnread' }, t('creditsUnread')),
            stats
              ? React.createElement(
                'section',
                { className: 'dshDeskAccountChart' },
                React.createElement(
                  'div',
                  { className: 'dshDeskAccountChartHead' },
                  React.createElement('span', { className: 'dshDeskAccountStatLabel' }, t('consumed')),
                  React.createElement('span', { className: 'dshDeskAccountChartTotal' }, formatCredits(stats.consumed))
                ),
                consumptionChart(t, stats.points)
              )
              : null
          ),
          React.createElement(
            'section',
            { className: 'dshDeskAccountBoard' },
            React.createElement(
              'div',
              { className: 'dshDeskAccountTabs', role: 'tablist', 'aria-label': t('titleAccount') },
              sectionTab(modelsId, modelsPanel, 'models', t('models'), flags.models ? 0 : models.length, active === 'models', onSection),
              sectionTab(usageId, usagePanel, 'usage', t('consumption'), credits?.consumption.length ?? 0, active === 'usage', onSection),
              sectionTab(rechargeId, rechargePanel, 'recharge', t('recharge'), credits?.recharge.length ?? 0, active === 'recharge', onSection)
            ),
            React.createElement(
              'div',
              { className: 'dshDeskAccountPanel', role: 'tabpanel', id: panelId, 'aria-labelledby': panelLabel },
              active === 'models' ? catalog : ledger
            )
          ),
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

      function RechargeDialog({ t, open, busy, phase, notice, qr, onClose, onBuy }) {
        if (!open) return null
        const code = paymentQr(qr)
        return React.createElement(Modal, {
          open: true,
          title: t('rechargeTitle'),
          closeLabel: t('close'),
          description: t('rechargeRate'),
          onClose: () => { if (!busy) onClose() }
        }, React.createElement(
          'div',
          { className: 'dshDeskAccountRecharge' },
          React.createElement(
            'div',
            { className: 'dshDeskAccountPacks', role: 'list' },
            RECHARGE_YUAN.map(yuan => React.createElement(
              'button',
              {
                key: String(yuan),
                type: 'button',
                className: 'dshDeskAccountPack',
                'data-yuan': String(yuan),
                'data-credits': String(yuan * CREDIT_PER_YUAN),
                disabled: busy,
                onClick: () => { onBuy(yuan) }
              },
              t('rechargeYuan', { yuan: String(yuan) }),
              t('rechargeCredits', { credits: formatCredits(yuan * CREDIT_PER_YUAN) })
            ))
          ),
          code && phase === 'waiting'
            ? React.createElement('img', {
              className: 'dshDeskAccountQr',
              src: code,
              alt: t('rechargeScan'),
              width: 220,
              height: 220
            })
            : null,
          phase === 'paid'
            ? React.createElement('p', { className: 'dshDeskAccountStatus', role: 'status' }, t('rechargePaid'))
            : phase === 'waiting'
              ? React.createElement('p', { className: 'dshDeskAccountStatus', role: 'status' }, t('rechargeWaiting'))
              : null,
          notice ? React.createElement('p', { className: 'dshDeskAccountAlert', role: 'alert' }, messageText(t, notice)) : null
        ))
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

      function AccountPanel({ t, bridge, initialStatus, onClose, onStatus, layout, panelId }) {
        const titleId = useId()
        const modelsId = useId()
        const usageId = useId()
        const rechargeId = useId()
        const [mode, setMode] = useState('login')
        const [section, setSection] = useState('models')
        const [range, setRange] = useState('7')
        const [modelSort, setModelSort] = useState('vendor')
        const [email, setEmail] = useState(rememberedEmail)
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
        const [status, setStatus] = useState(() => initialStatus !== undefined ? initialStatus : statusBus.current)
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
        const rechargeGeneration = useRef(0)
        const desktop = bridge ?? window.dshDesktop
        const account = desktop?.account
        const [panelActive, setPanelActive] = useState(() => {
          const snapshot = layout?.panelInfo?.getSnapshot?.()
          return snapshot?.activePanelId === panelId
        })

        useEffect(() => {
          const info = layout?.panelInfo
          if (typeof info?.subscribe !== 'function' || typeof info.getSnapshot !== 'function') return undefined
          const sync = () => { setPanelActive(info.getSnapshot().activePanelId === panelId) }
          sync()
          return info.subscribe(sync)
        }, [layout, panelId])

        useEffect(() => {
          let alive = true
          const revision = ++operationId.current
          const epoch = profileEpoch.current
          void account?.status().then(next => {
            if (!alive || revision !== operationId.current || epoch !== profileEpoch.current) return
            publish(next)
          }).catch(() => {
            if (!alive || revision !== operationId.current || epoch !== profileEpoch.current) return
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

        // Prices and the savings ratio change on the gateway without a local signal.
        // Each time this page becomes visible, read the model list again.
        useEffect(() => {
          if (!panelActive || status?.signedIn !== true || typeof account?.refresh !== 'function') return undefined
          let alive = true
          const epoch = ++profileEpoch.current
          void account.refresh().then(next => {
            if (!alive || epoch !== profileEpoch.current || !next) return
            publish(next)
          }).catch(() => undefined)
          return () => { alive = false; profileEpoch.current += 1 }
        }, [panelActive, status?.signedIn, account])

        useEffect(() => {
          if (!rechargeOpen || rechargeOrder === '' || rechargePhase === 'paid' || typeof account?.order !== 'function') return undefined
          let alive = true
          const tick = () => {
            void account.order(rechargeOrder).then(result => {
              if (!alive || result?.ok !== true || result.order?.status !== 'paid') return
              setRechargePhase('paid')
              setRechargeNotice('')
              void account.refresh?.().then(next => { if (alive && next) publish(next) }).catch(() => undefined)
            }).catch(() => undefined)
          }
          tick()
          const timer = setInterval(tick, 2000)
          return () => { alive = false; clearInterval(timer) }
        }, [account, rechargeOpen, rechargeOrder, rechargePhase])

        const mustRestart = status?.needsRestart === true && status?.signedIn !== true
        const requestClose = () => { if (!busy && !confirmLogout && !mustRestart && typeof onClose === 'function') onClose() }
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
          if (typeof desktop?.restartHarness !== 'function') throw new Error('Restart unavailable')
          const result = await desktop.restartHarness()
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
                section,
                onSection: setSection,
                range,
                onRange: setRange,
                modelSort,
                onModelSort: setModelSort,
                modelsId,
                usageId,
                rechargeId,
                onCheckIn: () => { void run(api => api.checkIn(), 'checkIn') },
                onRecharge: () => {
                  rechargeGeneration.current += 1
                  setRechargeNotice('')
                  setRechargePhase('')
                  setRechargeOrder('')
                  setRechargeQr('')
                  setRechargeOpen(true)
                },
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

        const surface = screen === 'auth'
          ? { className: 'dshDeskAccountPanel', 'aria-labelledby': titleId, onSubmit: submit }
          : { className: 'dshDeskAccountPanel', 'aria-labelledby': titleId }
        return React.createElement(React.Fragment, null,
          React.createElement(
            screen === 'auth' ? 'form' : 'div',
            surface,
            React.createElement(
              'div',
              { className: 'dshDeskAccountToolbar' },
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'dshDeskAccountBack',
                  'aria-label': t('back'),
                  disabled: busy || mustRestart,
                  onClick: requestClose
                },
                React.createElement(IconChevronLeftOutlineRegular, { size: 16 }),
                React.createElement('span', null, t('back'))
              )
            ),
            React.createElement(
              'div',
              { className: 'dshDeskAccountContent', 'data-dsh-account-panel': 'true' },
              React.createElement(
                'div',
                { className: 'dshDeskAccountHeader' },
                React.createElement('h2', { id: titleId, key: stageKey, className: 'dshDeskAccountTitle' }, title)
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
          RechargeDialog({
            t,
            open: rechargeOpen,
            busy: rechargeBusy,
            phase: rechargePhase,
            notice: rechargeNotice,
            qr: rechargeQr,
            onClose: () => {
              if (rechargeBusy) return
              rechargeGeneration.current += 1
              setRechargeOpen(false)
            },
            onBuy: yuan => {
              if (rechargeBusy || typeof account?.purchase !== 'function') {
                setRechargeNotice('unavailable')
                return
              }
              const generation = ++rechargeGeneration.current
              setRechargeBusy(true)
              setRechargePhase('opening')
              setRechargeNotice('')
              setRechargeQr('')
              void account.purchase(yuan).then(result => {
                if (generation !== rechargeGeneration.current) return
                const image = paymentQr(result?.order?.qrImage)
                if (result?.ok === true && result.order?.orderId && image) {
                  setRechargeOrder(result.order.orderId)
                  setRechargeQr(image)
                  setRechargePhase('waiting')
                  return
                }
                setRechargePhase('')
                setRechargeNotice(typeof result?.message === 'string' && result.message !== '' ? result.message : 'unavailable')
              }).catch(() => {
                if (generation !== rechargeGeneration.current) return
                setRechargePhase('')
                setRechargeNotice('unavailable')
              }).finally(() => {
                if (generation === rechargeGeneration.current) setRechargeBusy(false)
              })
            }
          }),
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

      function AccountButton({ t, wide, layout, panelId, showAccount, toggleAccount }) {
        const [status, setStatus] = useState(() => statusBus.current)
        const [selected, setSelected] = useState(() => layout?.panelInfo?.getSnapshot?.()?.activePanelId === panelId)
        useEffect(() => {
          let alive = true
          const seen = statusBus.revision
          const unsubscribe = statusBus.subscribe(next => { if (alive) setStatus(next) })
          const show = () => { if (typeof showAccount === 'function') showAccount() }
          window.addEventListener(OPEN_EVENT, show)
          void window.dshDesktop?.account?.status().then(next => {
            if (!alive || seen !== statusBus.revision) return
            publishStatus(next)
          }).catch(() => undefined)
          return () => {
            alive = false
            unsubscribe()
            statusBus.reset()
            window.removeEventListener(OPEN_EVENT, show)
          }
        }, [showAccount])
        useEffect(() => {
          const info = layout?.panelInfo
          if (typeof info?.subscribe !== 'function' || typeof info.getSnapshot !== 'function') return undefined
          const sync = () => { setSelected(info.getSnapshot().activePanelId === panelId) }
          sync()
          return info.subscribe(sync)
        }, [layout, panelId])
        if (!window.dshDesktop?.account) return null
        const signedIn = status?.signedIn === true && status.email !== ''
        const label = signedIn ? t('signedInName', { email: status.email }) : t('open')
        return React.createElement(
          'div',
          { 'data-dsh-taichi-account-entry': 'true', 'data-wide': wide === false ? 'false' : 'true' },
          React.createElement(
            Tooltip,
            { label, side: 'top', align: 'end', portal: true, maxWidth: 280, delayMs: 0, focusDelayMs: 0 },
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'dshDeskAccountButton',
                'data-dsh-taichi-account': 'true',
                'data-signed-in': signedIn ? 'true' : 'false',
                'data-selected': selected ? 'true' : 'false',
                'aria-pressed': selected ? 'true' : 'false',
                'aria-label': label,
                onClick: () => { if (typeof toggleAccount === 'function') toggleAccount() }
              },
              React.createElement(IconUserOutlineRegular, { size: 18 }),
              signedIn ? React.createElement('span', { className: 'dshDeskAccountPresence', 'aria-hidden': 'true' }) : null
            )
          )
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

      return {
        AccountButton,
        AccountPanel,
        QuotaRechargeNotice,
        publishStatus,
        resetStatus: () => { statusBus.reset() }
      }
    }

    return { createUi }
  }
})
