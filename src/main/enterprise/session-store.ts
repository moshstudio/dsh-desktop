import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface SecretBox {
  seal(plain: string): Promise<string>
  open(sealed: string): Promise<string>
}

export interface StoredSession {
  refreshToken: string
  email: string
}

interface SessionFile {
  version: 1
  sealed: string
}

export class AccountSessionStore {
  constructor(
    private readonly path: string,
    private readonly box: SecretBox
  ) {}

  async read(): Promise<StoredSession | undefined> {
    let text: string
    try {
      text = await readFile(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
    const parsed: unknown = JSON.parse(text)
    if (!isSessionFile(parsed)) throw new Error('account session file is invalid')
    const opened: unknown = JSON.parse(await this.box.open(parsed.sealed))
    if (!isStoredSession(opened)) throw new Error('account session payload is invalid')
    return opened
  }

  async write(session: StoredSession): Promise<void> {
    const sealed = await this.box.seal(JSON.stringify(session))
    const payload: SessionFile = { version: 1, sealed }
    await mkdir(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, JSON.stringify(payload), { mode: 0o600, flag: 'wx' })
      await rename(temporary, this.path)
    } finally {
      await rm(temporary, { force: true })
    }
  }

  async clear(): Promise<void> {
    await rm(this.path, { force: true })
  }
}

export function electronSecretBox(): SecretBox {
  return {
    async seal(plain) {
      const { safeStorage } = await import('electron')
      if (!safeStorage.isEncryptionAvailable()) throw new Error('safe storage is unavailable')
      return safeStorage.encryptString(plain).toString('base64')
    },
    async open(sealed) {
      const { safeStorage } = await import('electron')
      return safeStorage.decryptString(Buffer.from(sealed, 'base64'))
    }
  }
}

function isSessionFile(value: unknown): value is SessionFile {
  return value !== null && typeof value === 'object' && (value as { version?: unknown }).version === 1 &&
    typeof (value as { sealed?: unknown }).sealed === 'string'
}

function isStoredSession(value: unknown): value is StoredSession {
  return value !== null && typeof value === 'object' &&
    typeof (value as { refreshToken?: unknown }).refreshToken === 'string' &&
    typeof (value as { email?: unknown }).email === 'string'
}
