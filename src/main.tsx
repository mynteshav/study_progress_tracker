import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initPlatformDb } from './db/index';
import { defineCustomElements as jeepSqliteDefineCustomElements } from 'jeep-sqlite/loader';

jeepSqliteDefineCustomElements(window);

initPlatformDb().catch((err) => {
  console.error('Failed to initialize platform database:', err);
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
