import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';
import './ui/design-tokens.css';
import './ui/product.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
