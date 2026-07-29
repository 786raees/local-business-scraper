import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '../sidepanel/tokens.css'
import './options.css'
import { KeySetup } from './KeySetup'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <KeySetup />
  </React.StrictMode>,
)
