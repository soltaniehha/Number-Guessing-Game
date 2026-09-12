/** Tiny dotted-path get/set for the two nested config fields (shuffleTime.1 etc). */
export function getPath(obj, path) {
  return String(path)
    .split('.')
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), obj)
}

export function setPath(obj, path, value) {
  const keys = String(path).split('.')
  if (keys.length === 1) return { ...obj, [keys[0]]: value }
  const [head, ...rest] = keys
  return { ...obj, [head]: setPath(obj?.[head] ?? {}, rest.join('.'), value) }
}
