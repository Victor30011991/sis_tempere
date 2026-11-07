import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import '@fontsource-variable/fraunces';
import '@fontsource-variable/dm-sans';
import './styles.css';
import App from './App';
import { AppProvider } from './state/store';
import { FeedbackProvider } from './ui/feedback';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <AppProvider>
        <FeedbackProvider>
          <App />
        </FeedbackProvider>
      </AppProvider>
    </HashRouter>
  </StrictMode>,
);
