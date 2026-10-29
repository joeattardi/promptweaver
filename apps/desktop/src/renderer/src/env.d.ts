import type { RendererApi } from '../../shared/ipc'

declare global {
  interface Window {
    api: RendererApi
  }
}

declare module '*.png' {
  const url: string
  export default url
}
