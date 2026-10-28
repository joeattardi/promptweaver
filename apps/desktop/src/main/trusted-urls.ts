export interface TrustedOrigins {
  /** Dev server URL from electron-vite, if running in dev. */
  devServerUrl: string | undefined
  /** `file://` URL of the built renderer directory. */
  rendererDirUrl: string
}

/** True when `url` points at our own renderer pages and nothing else. */
export function isTrustedUrl(url: string, origins: TrustedOrigins): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (origins.devServerUrl !== undefined) {
    const dev = new URL(origins.devServerUrl)
    if (parsed.origin === dev.origin) return true
  }
  if (parsed.protocol === 'file:') {
    const dir = origins.rendererDirUrl.endsWith('/')
      ? origins.rendererDirUrl
      : `${origins.rendererDirUrl}/`
    return parsed.href.startsWith(dir)
  }
  return false
}

/** True for requests the app may make: its own pages/assets, devtools, and the dev server. */
export function isAllowedRequest(url: string, origins: TrustedOrigins): boolean {
  if (isTrustedUrl(url, origins)) return true
  const protocol = url.slice(0, url.indexOf(':') + 1)
  if (protocol === 'devtools:' || protocol === 'data:' || protocol === 'blob:') return true
  // Vite's HMR websocket.
  if (origins.devServerUrl !== undefined && protocol === 'ws:') {
    return new URL(url).host === new URL(origins.devServerUrl).host
  }
  return false
}
