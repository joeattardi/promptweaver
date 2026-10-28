import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'

export function mount(app: ReactNode): void {
  const root = document.getElementById('root')
  if (root === null) throw new Error('Missing #root element')
  createRoot(root).render(<StrictMode>{app}</StrictMode>)
}
