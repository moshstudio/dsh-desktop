import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { ACCOUNT_IPC } from '../../shared/account-gateway'
import type { DesktopAccountService } from './account-service'

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
}
