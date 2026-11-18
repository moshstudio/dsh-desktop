/** Rebuild account credentials for each Host attempt without retaining a previous token. */
export async function prepareAccountHostEnvironment(
  environment: Readonly<NodeJS.ProcessEnv>,
  prepareAccount: () => Promise<Record<string, string>>,
  reportFailure: (error: unknown) => void
): Promise<NodeJS.ProcessEnv> {
  const next = { ...environment }
  // This credential belongs to the saved desktop account, never the inherited shell.
  delete next.TAICHI_GATEWAY_ACCESS_TOKEN
  try {
    return { ...next, ...await prepareAccount() }
  } catch (error: unknown) {
    // Keep recovery available without retaining old credentials.
    reportFailure(error)
    return next
  }
}
