// src/index.js
import React from 'react';
import ReactDOM from 'react-dom/client'; // Note the '/client' import for React 18
import App from './App';
import './index.css';

const container = document.getElementById('root');
const root = ReactDOM.createRoot(container);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
