import '../styles.css'
import { mount } from '../mount'
import { App } from './App'

document.documentElement.dataset['launcher'] = ''
// On macOS the window's frosted-glass material shows through the page.
void window.api.getAppInfo().then((info) => {
  if (info.platform === 'darwin') document.documentElement.dataset['vibrancy'] = ''
})

mount(<App />)
