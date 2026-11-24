/** Keep the previous installed map when a poll returned the same specs. */

export function sameStringMap(left: Record<string, string>, right: Record<string, string>): boolean {
  const names = Object.keys(left)
  return names.length === Object.keys(right).length && names.every(name => left[name] === right[name])
}

export function nextInstalledMap<T extends Record<string, string>>(previous: T, incoming: T): T {
  return sameStringMap(previous, incoming) ? previous : incoming
}
