import { render } from 'preact'

import '@fontsource-variable/inter'
import '@fontsource-variable/manrope'

import { App } from './App'
import { applyInitialTheme, subscribeHostTheme } from './lib/theme'
import './styles/tokens.css'
import './styles/app.css'

applyInitialTheme()
subscribeHostTheme()

render(<App />, document.getElementById('app')!)
