import { describe, expect, it } from 'vitest'
import { isAllowedRequest, isTrustedUrl, type TrustedOrigins } from './trusted-urls'

const prod: TrustedOrigins = {
  devServerUrl: undefined,
  rendererDirUrl: 'file:///Applications/App.app/Contents/Resources/app.asar/out/renderer'
}
const dev: TrustedOrigins = { ...prod, devServerUrl: 'http://localhost:5173' }

describe('isTrustedUrl', () => {
  it('accepts pages inside the renderer directory', () => {
    expect(isTrustedUrl(`${prod.rendererDirUrl}/index.html`, prod)).toBe(true)
    expect(isTrustedUrl(`${prod.rendererDirUrl}/launcher.html`, prod)).toBe(true)
  })

  it('rejects other file URLs, including sibling directories with a shared prefix', () => {
    expect(isTrustedUrl('file:///etc/passwd', prod)).toBe(false)
    expect(isTrustedUrl(`${prod.rendererDirUrl}-evil/index.html`, prod)).toBe(false)
  })

  it('rejects remote and malformed URLs', () => {
    expect(isTrustedUrl('https://example.com/', prod)).toBe(false)
    expect(isTrustedUrl('not a url', prod)).toBe(false)
    expect(isTrustedUrl('', prod)).toBe(false)
  })

  it('accepts the dev server only in dev', () => {
    expect(isTrustedUrl('http://localhost:5173/index.html', dev)).toBe(true)
    expect(isTrustedUrl('http://localhost:5173/index.html', prod)).toBe(false)
    expect(isTrustedUrl('http://localhost:5174/index.html', dev)).toBe(false)
  })
})

describe('isAllowedRequest', () => {
  it('blocks network requests', () => {
    expect(isAllowedRequest('https://example.com/x.js', dev)).toBe(false)
    expect(isAllowedRequest('ws://example.com/', dev)).toBe(false)
  })

  it('allows the HMR websocket in dev only', () => {
    expect(isAllowedRequest('ws://localhost:5173/', dev)).toBe(true)
    expect(isAllowedRequest('ws://localhost:5173/', prod)).toBe(false)
  })

  it('allows devtools, data and blob URLs', () => {
    expect(isAllowedRequest('devtools://devtools/bundled/inspector.html', prod)).toBe(true)
    expect(isAllowedRequest('data:image/png;base64,AAAA', prod)).toBe(true)
  })
})
