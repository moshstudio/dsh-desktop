/**
 * Card-level capability signal. Urgent red lines are install-time facts.
 * `dynamic-code` and `credentials` are called out beside them because a
 * reader cannot inspect either after the fact. A missing scan is not a
 * clean scan.
 */

export type CapabilityScan = 'unchecked' | 'none' | 'found'

export function isUrgentRedLine(line: string): boolean {
  return line.startsWith('runs code at install time') || line.startsWith('tampers with a core bundle')
}

export function urgentRedLines(plugin: { capabilityRedLines?: readonly string[] }): string[] {
  return (plugin.capabilityRedLines ?? []).filter(isUrgentRedLine)
}

export function capabilityScan(plugin: { capabilities?: readonly string[] }): CapabilityScan {
  if (plugin.capabilities === undefined) return 'unchecked'
  if (plugin.capabilities.length === 0) return 'none'
  return 'found'
}

export function hasCardUrgent(plugin: { capabilityRedLines?: readonly string[]; capabilities?: readonly string[] }): boolean {
  if (urgentRedLines(plugin).length > 0) return true
  const names = plugin.capabilities ?? []
  return names.includes('dynamic-code') || names.includes('credentials')
}
