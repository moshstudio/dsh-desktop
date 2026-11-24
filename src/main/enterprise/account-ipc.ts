import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { ACCOUNT_IPC } from '../../shared/account-gateway'
import type { DesktopAccountService } from './account-service'
import { alipayQrPayload } from './payment-link'

export function registerAccountIpc(
  ipcMain: IpcMain,
  assertMain: (event: IpcMainInvokeEvent) => void,
  account: DesktopAccountService
): void {
  const handle = (channel: string, run: (args: readonly unknown[]) => Promise<unknown>): void => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      assertMain(event)
      return run(args)
    })
  }
  handle(ACCOUNT_IPC.status, () => Promise.resolve(account.status()))
  handle(ACCOUNT_IPC.register, args => account.register(args[0], args[1]))
  handle(ACCOUNT_IPC.verify, args => account.verify(args[0]))
  handle(ACCOUNT_IPC.login, args => account.login(args[0], args[1]))
  handle(ACCOUNT_IPC.logout, () => account.logout())
  handle(ACCOUNT_IPC.resetRequest, args => account.requestPasswordReset(args[0]))
  handle(ACCOUNT_IPC.resetConfirm, args => account.confirmPasswordReset(args[0], args[1]))
  handle(ACCOUNT_IPC.checkIn, () => account.checkIn())
  handle(ACCOUNT_IPC.refresh, () => account.refresh())
  handle(ACCOUNT_IPC.packages, () => account.packages())
  handle(ACCOUNT_IPC.purchase, async args => {
    const result = await account.purchase(args[0])
    const source = result.order
    if (!result.ok || !source) return { ok: false, message: result.ok ? 'unavailable' : result.message, order: null }
    const payload = alipayQrPayload(source.qrCode ?? '')
    if (!payload) return { ok: false, message: 'unavailable', order: null }
    return {
      ok: true,
      message: '',
      order: { orderId: source.orderId, yuan: source.yuan, credits: source.credits, status: source.status, qrImage: payload }
    }
  })
  handle(ACCOUNT_IPC.order, args => account.purchaseStatus(args[0]))
}
