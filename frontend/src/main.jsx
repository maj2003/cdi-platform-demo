// ---------------------------------------------------------------------------
// src/main.jsx — app bootstrap.
//
// StrictMode is left ON deliberately. It double-invokes effects in development,
// which is exactly the behaviour useApi is built to survive — keeping it on
// means cancellation bugs surface here rather than during a demo.
// ---------------------------------------------------------------------------

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from '@/App';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);