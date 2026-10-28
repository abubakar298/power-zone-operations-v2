import {WorkflowToast} from './components/WorkflowToast.js';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './ui/design-tokens.css';
import './ui/product.css';

const root = document.getElementById('root')!;
void import('./App.js').then(({ App }) => {
  createRoot(root).render(<StrictMode><App /><WorkflowToast/></StrictMode>);
}).catch((error: unknown) => {
  root.setAttribute('role', 'alert');
  root.style.padding = '32px';
  root.textContent = `Unable to open the workspace: ${error instanceof Error ? error.message : String(error)}. Please reload or contact the administrator.`;
});

import './ui/accounts.css';
