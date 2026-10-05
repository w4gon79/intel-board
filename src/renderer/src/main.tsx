import './assets/main.css'
import './lib/apiTransport' // side-effect: patches window.api for browser mode
// side-effect: serve maplibre's worker from a blob under file:// (packaged app);
// must run before any maplibre Map is constructed
import './lib/maplibreWorkerPatch'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
