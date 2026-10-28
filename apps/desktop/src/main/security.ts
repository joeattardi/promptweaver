import { app, session, type WebContents } from 'electron'
import { isAllowedRequest, isTrustedUrl, type TrustedOrigins } from './trusted-urls'

export type { TrustedOrigins }

/** App-wide hardening: no navigation, no new windows, no permissions, no network. */
export function applySecurityPolicy(origins: TrustedOrigins): void {
  app.on('web-contents-created', (_event, contents: WebContents) => {
    contents.on('will-navigate', (event, url) => {
      if (!isTrustedUrl(url, origins)) event.preventDefault()
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  })

  const ses = session.defaultSession
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  ses.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isAllowedRequest(details.url, origins) })
  })
}
