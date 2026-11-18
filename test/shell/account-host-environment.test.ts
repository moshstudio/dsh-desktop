import { describe, expect, it, vi } from 'vitest'
import { prepareAccountHostEnvironment } from '../../src/main/shell/account-host-environment'
import { DesktopBackendController } from '../../src/main/shell/backend/backend-controller'

function setup() {
  const inherited = { PATH: 'runtime-path', DSH_HOME: 'test-home', TAICHI_GATEWAY_ACCESS_TOKEN: 'inherited-token' }
  let environment: NodeJS.ProcessEnv = inherited
  const launched: NodeJS.ProcessEnv[] = []
  const prepareAccount = vi.fn<() => Promise<Record<string, string>>>().mockResolvedValue({})
  const reportFailure = vi.fn()
  const prepare = async () => {
    environment = await prepareAccountHostEnvironment(environment, prepareAccount, reportFailure)
  }
  const backend = new DesktopBackendController(() => {
    launched.push({ ...environment })
    return { start: async () => {}, stop: async () => {} }
  }, () => {})
  const restart = async () => {
    await backend.stop()
    await backend.start(prepare)
  }
  return { inherited, launched, prepareAccount, reportFailure, backend, prepare, restart }
}

describe('account environment at Host startup', () => {
  it('prepares again after login and replaces the token on subsequent restarts', async () => {
    const context = setup()
    await context.backend.start(context.prepare)
    expect(context.launched[0]).toEqual({ PATH: 'runtime-path', DSH_HOME: 'test-home' })
    context.prepareAccount.mockResolvedValue({ TAICHI_GATEWAY_ACCESS_TOKEN: 'login-token' })
    await context.restart()
    context.prepareAccount.mockResolvedValue({ TAICHI_GATEWAY_ACCESS_TOKEN: 'refreshed-token' })
    await context.restart()
    expect(context.launched.map(env => env.TAICHI_GATEWAY_ACCESS_TOKEN)).toEqual([undefined, 'login-token', 'refreshed-token'])
    expect(context.prepareAccount).toHaveBeenCalledTimes(3)
    expect(context.inherited.TAICHI_GATEWAY_ACCESS_TOKEN).toBe('inherited-token')
  })

  it('does not pass the previous account token after logout and restart', async () => {
    const context = setup()
    context.prepareAccount.mockResolvedValue({ TAICHI_GATEWAY_ACCESS_TOKEN: 'signed-in-token' })
    await context.backend.start(context.prepare)
    context.prepareAccount.mockResolvedValue({})
    await context.restart()
    expect(context.launched[1]).toEqual({ PATH: 'runtime-path', DSH_HOME: 'test-home' })
    expect(context.reportFailure).not.toHaveBeenCalled()
  })

  it.each(['empty', 'throw'] as const)('clears the old token on a %s refresh failure and allows recovery', async mode => {
    const context = setup()
    context.prepareAccount.mockResolvedValue({ TAICHI_GATEWAY_ACCESS_TOKEN: 'stale-token' })
    await context.backend.start(context.prepare)
    const failure = new Error('refresh unavailable')
    if (mode === 'throw') context.prepareAccount.mockRejectedValue(failure)
    else context.prepareAccount.mockResolvedValue({})
    await context.restart()
    expect(context.launched[1]).toEqual({ PATH: 'runtime-path', DSH_HOME: 'test-home' })
    expect(context.backend.state.phase).toBe('ready')
    if (mode === 'throw') expect(context.reportFailure).toHaveBeenCalledWith(failure)
    else expect(context.reportFailure).not.toHaveBeenCalled()
    context.prepareAccount.mockResolvedValue({ TAICHI_GATEWAY_ACCESS_TOKEN: 'recovered-token' })
    await context.restart()
    expect(context.launched[2]?.TAICHI_GATEWAY_ACCESS_TOKEN).toBe('recovered-token')
  })

  it('awaits preparation and shares one attempt across concurrent starts', async () => {
    const context = setup()
    let release: (environment: Record<string, string>) => void = () => {}
    context.prepareAccount.mockReturnValue(new Promise(resolve => { release = resolve }))
    const first = context.backend.start(context.prepare)
    const second = context.backend.start(context.prepare)
    await new Promise(resolve => { setImmediate(resolve) })
    expect(context.launched).toEqual([])
    release({ TAICHI_GATEWAY_ACCESS_TOKEN: 'new-token' })
    await Promise.all([first, second])
    expect(context.prepareAccount).toHaveBeenCalledTimes(1)
    expect(context.launched).toHaveLength(1)
    expect(context.launched[0]?.TAICHI_GATEWAY_ACCESS_TOKEN).toBe('new-token')
  })
})
