import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './shared/styles/global.css'
import './shared/styles/layout.css'
import { Router } from './app/router'

createRoot(document.getElementById('root')!).render(<StrictMode><Router /></StrictMode>)
