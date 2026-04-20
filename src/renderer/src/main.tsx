import './assets/main.css'
import './lib/apiTransport' // side-effect: patches window.api for browser mode

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
