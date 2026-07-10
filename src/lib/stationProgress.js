const STORAGE_PREFIX = 'cpr-expo:station-progress:v1'

export function getStationProgressKey({ stationType, teamId, judgeId }) {
  return [STORAGE_PREFIX, stationType || 'unknown', teamId || 'unknown', judgeId || 'unknown'].join(':')
}

export function loadStationProgress(key) {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null

    const parsed = JSON.parse(raw)
    if (!parsed || parsed.version !== 1) return null
    return parsed
  } catch {
    return null
  }
}

export function saveStationProgress(key, payload) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(key, JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      ...payload,
    }))
  } catch {
    // localStorage อาจเต็มหรือถูกปิดไว้
  }
}

export function clearStationProgress(key) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.removeItem(key)
  } catch {
    // ignore
  }
}
