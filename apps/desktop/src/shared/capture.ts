import type { CaptureResult } from './ipc'

/** A short message for a capture that didn't create a prompt, or null if it did. */
export function captureProblem(result: CaptureResult): string | null {
  switch (result.status) {
    case 'created':
      return null
    case 'empty':
      return 'The clipboard has no text, so there is nothing to save. Copy some text first.'
    case 'no-library':
      return 'Choose a library folder first, then try again.'
    case 'error':
      return result.message
  }
}
