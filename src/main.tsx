import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './index.css';
import { createServices } from './lib/services';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

const services = createServices();

createRoot(root).render(
  <StrictMode>
    <App services={services} />
  </StrictMode>,
);

registerSW({ immediate: true });
