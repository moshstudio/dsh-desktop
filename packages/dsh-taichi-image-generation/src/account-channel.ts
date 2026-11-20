import type { ChannelConfig } from './protocol.ts'

/** The desktop account channel authenticates with the host session, not a stored key. */
export function usesDesktopAccount(channel: { id: string; preset?: string }): boolean {
  return channel.id === 'taichi' || channel.preset === 'taichi'
}

/**
 * Whether one channel can submit a generation now.
 *
 * A desktop-account channel is ready when the host published `accountSignedIn`.
 * Checking `channelSecrets` there is always false: the token never leaves the host.
 */
export function channelIsConnected(channel: Pick<ChannelConfig, 'id' | 'preset' | 'apiUrl' | 'auth' | 'subscription'>, input: {
  accountSignedIn: boolean
  secretSet: boolean
  subscriptionLoggedOut: boolean
}): boolean {
  if (usesDesktopAccount(channel)) return input.accountSignedIn
  if (channel.auth === 'subscription' && channel.subscription !== undefined) return !input.subscriptionLoggedOut
  return channel.apiUrl.trim() !== '' && input.secretSet
}
