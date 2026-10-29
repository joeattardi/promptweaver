import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import type { HotkeyResult } from '../../../shared/ipc'
import { installApi, settingsView } from '../test/helpers'
import { SettingsDialog } from './SettingsDialog'
import { useSettings } from './store'

beforeEach(() => {
  useSettings.setState(useSettings.getInitialState(), true)
})

function open(view = settingsView(), overrides: Parameters<typeof installApi>[0] = {}) {
  const api = installApi({ getSettings: async () => view, ...overrides })
  useSettings.setState({ view, open: true })
  render(<SettingsDialog />)
  return { api, user: userEvent.setup() }
}

const recorder = (): HTMLElement => {
  const element = document.getElementById('launcher-hotkey')
  if (element === null) throw new Error('The shortcut recorder is not showing')
  return element
}

describe('settings dialog', () => {
  it('shows the launcher shortcut in the platform’s own notation', () => {
    open()
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
    expect(recorder()).toHaveTextContent('⌃⌥Space')
  })

  it('shows nothing until it is opened', () => {
    useSettings.setState({ view: settingsView(), open: false })
    render(<SettingsDialog />)
    expect(screen.queryByText('Quick launcher shortcut')).not.toBeInTheDocument()
  })

  it('records a new shortcut from the keys pressed', async () => {
    const { api, user } = open()
    await user.click(recorder())
    expect(recorder()).toHaveTextContent('Press the new shortcut…')
    await user.keyboard('{Control>}{Alt>}k{/Alt}{/Control}')
    await waitFor(() => expect(api.setLauncherHotkey).toHaveBeenCalledWith('Control+Alt+K'))
    expect(await screen.findByRole('status')).toHaveTextContent('Shortcut changed.')
  })

  it('shows the modifiers being held while waiting for the key', async () => {
    const { user } = open()
    await user.click(recorder())
    await user.keyboard('{Control>}{Alt>}')
    expect(recorder()).toHaveTextContent('⌃⌥…')
  })

  it('refuses a key with no modifier and says why', async () => {
    const { api, user } = open()
    await user.click(recorder())
    await user.keyboard('k')
    expect(await screen.findByRole('alert')).toHaveTextContent(/Ctrl, Alt, Option or Command/)
    expect(api.setLauncherHotkey).not.toHaveBeenCalled()
  })

  it('Escape stops recording without changing anything', async () => {
    const { api, user } = open()
    await user.click(recorder())
    await user.keyboard('{Escape}')
    expect(recorder()).toHaveTextContent('⌃⌥Space')
    expect(api.setLauncherHotkey).not.toHaveBeenCalled()
  })

  it('tells the user when the system refuses the shortcut, and keeps the old one', async () => {
    const view = settingsView()
    const refused: HotkeyResult = {
      ok: false,
      error: '⌃⌥K is already used by another app or by the system. Choose a different shortcut.',
      settings: view
    }
    const { user } = open(view, { setLauncherHotkey: async () => refused })
    await user.click(recorder())
    await user.keyboard('{Control>}{Alt>}k{/Alt}{/Control}')
    expect(await screen.findByRole('alert')).toHaveTextContent('already used by another app')
    expect(recorder()).toHaveTextContent('⌃⌥Space')
  })

  it('warns about a shortcut that other software uses, but accepts it', async () => {
    const view = settingsView({ launcherHotkey: 'Command+Space' })
    const { user } = open(settingsView(), {
      setLauncherHotkey: async () => ({
        ok: true,
        warning: 'Command+Space opens Spotlight.',
        settings: view
      })
    })
    await user.click(recorder())
    await user.keyboard('{Control>}{Alt>}k{/Alt}{/Control}')
    expect(await screen.findByRole('status')).toHaveTextContent('Spotlight')
    expect(screen.getByRole('button', { name: /⌘Space/ })).toBeInTheDocument()
  })

  it('offers to go back to the default once another shortcut is set', async () => {
    const { api, user } = open(settingsView({ launcherHotkey: 'Control+Alt+K' }))
    await user.click(screen.getByRole('button', { name: 'Reset to ⌃⌥Space' }))
    expect(api.setLauncherHotkey).toHaveBeenCalledWith('Control+Alt+Space')
  })

  it('does not offer a reset while the default is in use', () => {
    open()
    expect(screen.queryByRole('button', { name: /Reset to/ })).not.toBeInTheDocument()
  })

  it('explains a shortcut that could not be registered at startup', () => {
    open(
      settingsView({
        hotkey: { registered: false, error: '⌃⌥Space is already used by another app.' }
      })
    )
    expect(screen.getByRole('button', { name: /not active/ })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('already used by another app')
  })

  it('turns starting at login on and off', async () => {
    const { api, user } = open()
    await user.click(screen.getByRole('checkbox', { name: /when you log in/ }))
    expect(api.setLaunchAtLogin).toHaveBeenCalledWith(true)
  })

  it('says start at login is for the installed app when running from source', () => {
    open(settingsView({ launchAtLoginAvailable: false }))
    expect(screen.getByRole('checkbox', { name: /when you log in/ })).toBeDisabled()
    expect(screen.getByText(/Available in the installed app/)).toBeInTheDocument()
  })

  it('closes with Done', async () => {
    const { user } = open()
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(useSettings.getState().open).toBe(false)
  })

  it('follows changes made elsewhere', async () => {
    let push: (view: ReturnType<typeof settingsView>) => void = () => undefined
    const { api } = open(settingsView(), {
      onSettingsChanged: (listener) => {
        push = listener
        return () => undefined
      }
    })
    const stop = useSettings.getState().start()
    await waitFor(() => expect(api.getSettings).toHaveBeenCalled())
    act(() => push(settingsView({ launcherHotkey: 'Control+Alt+J' })))
    expect(await screen.findByRole('button', { name: /⌃⌥J/ })).toBeInTheDocument()
    stop()
  })
})
