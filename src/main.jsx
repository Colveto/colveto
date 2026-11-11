import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import './index.css';
import { api, setApiBase, getApiBase } from './lib/api.js';

// Expose window.api so existing pages keep working unchanged
window.api = api;

async function init() {
  // First launch: pick up the default API URL.
  if (!getApiBase()) {
    if (window.electronApi) {
      // Electron desktop app: use the embedded server on this PC (unless overridden in Settings).
      try {
        const config = await window.electronApi.getConfig();
        setApiBase(config.defaultApiUrl);
      } catch (e) {
        console.warn('Impossible de récupérer la config Electron, fallback localhost', e);
        setApiBase('http://localhost:3737');
      }
    } else {
      // Served from a browser (e.g. the VPS at /app): talk to the same origin.
      setApiBase(window.location.origin);
    }
  }

  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
    </React.StrictMode>
  );
}

init();
