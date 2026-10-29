import '../styles.css'
import { mount } from '../mount'
import { App } from './App'

document.documentElement.dataset['launcher'] = ''

mount(<App />)
