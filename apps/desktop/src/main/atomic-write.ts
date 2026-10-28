import { randomBytes } from 'node:crypto'
import { open, rename, stat, unlink } from 'node:fs/promises'
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
