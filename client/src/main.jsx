import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { CatalogProvider } from './hooks/useCatalog.jsx';
import { LangProvider } from './lib/i18n.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <LangProvider>
        <CatalogProvider>
          <App />
        </CatalogProvider>
      </LangProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
