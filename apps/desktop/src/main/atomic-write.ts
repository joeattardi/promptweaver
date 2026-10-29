import { randomBytes } from 'node:crypto'
import { link, open, rename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

/**
 * Replaces `path` with `data` atomically: write a temp file in the same folder,
 * flush it to disk, then rename it over the target. A crash leaves either the
 * old file or the new one, never half of each. Keeps the target's permissions.
 *
 * The temp file is a dotfile ending in `.tmp`, which the library scanner and
 * watcher both ignore.
 */
export async function writeFileAtomic(path: string, data: string): Promise<void> {
  const mode = await stat(path).then(
    (s) => s.mode & 0o777,
    () => undefined
  )
  const temp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`)
  const handle = await open(temp, 'wx', mode)
  try {
    await handle.writeFile(data, 'utf8')
    await handle.sync()
    await handle.close()
    await rename(temp, path)
  } catch (error) {
    await handle.close().catch(() => undefined)
    await unlink(temp).catch(() => undefined)
    throw error
  }
}

/**
 * Creates `path` with `data` atomically, but only if nothing is there yet.
 * Returns false (and writes nothing) if the name is taken. The content is
 * flushed to a temp file first and hard-linked into place, so the new name
 * never exists half-written and an existing file is never replaced. Where the
 * filesystem has no hard links, it falls back to a check followed by a rename.
 */
export async function writeFileAtomicNew(path: string, data: string): Promise<boolean> {
  const temp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`)
  const handle = await open(temp, 'wx')
  try {
    await handle.writeFile(data, 'utf8')
    await handle.sync()
    await handle.close()
    try {
      await link(temp, path)
      return true
    } catch (error) {
      const code = errorCode(error)
      if (code === 'EEXIST') return false
      if (code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'ENOSYS' && code !== 'EXDEV') {
        throw error
      }
      // No hard links here: the best that is left is to look first.
      if (await exists(path)) return false
      await rename(temp, path)
      return true
    }
  } catch (error) {
    await handle.close().catch(() => undefined)
    throw error
  } finally {
    await unlink(temp).catch(() => undefined)
  }
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false
  )
}
