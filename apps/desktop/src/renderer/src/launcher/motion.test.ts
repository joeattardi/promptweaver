import { describe, expect, it, vi } from 'vitest'
import { CLOSE_MS, LauncherMotion, OPEN_MS, type AnimationLike, type MotionTarget } from './motion'

function fakeTarget() {
  const animations: {
    keyframes: Keyframe[]
    options: KeyframeAnimationOptions
    cancel: ReturnType<typeof vi.fn>
    onfinish: ((event: never) => void) | null
  }[] = []
  const target: MotionTarget = {
    style: { opacity: '' },
    animate(keyframes, options): AnimationLike {
      const animation = { keyframes, options, cancel: vi.fn(), onfinish: null }
      animations.push(animation)
      return animation
    }
  }
  return { target, animations }
}

function setup(reduced = false) {
  const panel = fakeTarget()
  const rows = Array.from({ length: 12 }, () => fakeTarget())
  const motion = new LauncherMotion(panel.target, () => reduced)
  return { motion, panel, rows, rowTargets: rows.map((r) => r.target) }
}

describe('LauncherMotion.open', () => {
  it('pops the panel in: up from a smaller, blurred, faded state to its natural one', () => {
    const { motion, panel } = setup()
    motion.open([])
    const [animation] = panel.animations
    expect(animation?.keyframes[0]).toMatchObject({ opacity: 0, filter: 'blur(10px)' })
    expect(animation?.keyframes[0]?.['transform']).toContain('scale(0.94)')
    expect(animation?.keyframes[1]).toMatchObject({ opacity: 1, transform: 'none' })
    expect(animation?.options.duration).toBe(OPEN_MS)
    // Held in its first state until it starts, so there is no flash.
    expect(animation?.options.fill).toBe('both')
  })

  it('hands the opacity to the animation by clearing what park() set', () => {
    const { motion, panel } = setup()
    motion.park()
    expect(panel.target.style.opacity).toBe('0')
    motion.open([])
    expect(panel.target.style.opacity).toBe('')
  })

  it('brings the rows in one after another', () => {
    const { motion, rows, rowTargets } = setup()
    motion.open(rowTargets.slice(0, 3))
    const delays = rows.slice(0, 3).map((r) => r.animations[0]?.options.delay)
    expect(delays[0]).toBeLessThan(delays[1] as number)
    expect(delays[1]).toBeLessThan(delays[2] as number)
    expect(rows[0]?.animations[0]?.options.fill).toBe('backwards')
  })

  it('does not stagger a long list for ever', () => {
    const { motion, rows, rowTargets } = setup()
    motion.open(rowTargets)
    expect(rows.filter((r) => r.animations.length > 0)).toHaveLength(9)
  })

  it('drops the finished animation so nothing stays pinned', () => {
    const { motion, panel } = setup()
    motion.open([])
    const animation = panel.animations[0]
    animation?.onfinish?.({} as never)
    expect(animation?.cancel).toHaveBeenCalled()
  })

  it('is just a quick fade with reduced motion: no movement, blur or staggering', () => {
    const { motion, panel, rows, rowTargets } = setup(true)
    motion.open(rowTargets)
    const [animation] = panel.animations
    expect(animation?.keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }])
    expect(animation?.options.duration).toBeLessThan(150)
    expect(rows.every((r) => r.animations.length === 0)).toBe(true)
  })

  it('replaces an animation that is still running', () => {
    const { motion, panel } = setup()
    motion.open([])
    motion.open([])
    expect(panel.animations[0]?.cancel).toHaveBeenCalled()
  })
})

describe('LauncherMotion.close', () => {
  it('shrinks and fades the panel, and keeps it gone', () => {
    const { motion, panel } = setup()
    motion.close()
    const [animation] = panel.animations
    expect(animation?.keyframes[1]).toMatchObject({ opacity: 0 })
    expect(animation?.keyframes[1]?.['transform']).toContain('scale(0.97)')
    expect(animation?.options.fill).toBe('forwards')
    expect(animation?.options.duration).toBe(CLOSE_MS)
  })

  it('does not cancel itself when it finishes, or the panel would flash back', () => {
    const { motion, panel } = setup()
    motion.close()
    expect(panel.animations[0]?.onfinish).toBeNull()
  })

  it('is quicker than the opening', () => {
    expect(CLOSE_MS).toBeLessThan(OPEN_MS)
  })

  it('stops an opening that is still playing', () => {
    const { motion, panel } = setup()
    motion.open([])
    motion.close()
    expect(panel.animations[0]?.cancel).toHaveBeenCalled()
  })
})

describe('LauncherMotion.park', () => {
  it('makes the panel invisible and ends any animation', () => {
    const { motion, panel } = setup()
    motion.close()
    motion.park()
    expect(panel.animations[0]?.cancel).toHaveBeenCalled()
    expect(panel.target.style.opacity).toBe('0')
  })
})
