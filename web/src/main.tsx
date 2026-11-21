import { createRoot } from 'react-dom/client'
import { App } from './app/App.js'
import { setupTheme } from './app/theme.js'
import { setupAccent } from './app/accent.js'
import { installNativeBridge } from './app/nativeBridge.js'
import { initWallpaper } from './services/wallpaper.js'
import { ensureKatex } from './services/markdown/katex.js'
import './app/theme.css'
import './app/global.css'

ensureKatex()
setupTheme()
setupAccent()
void initWallpaper()
installNativeBridge()

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
