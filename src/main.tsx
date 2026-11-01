import '@fontsource-variable/inter';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/plus-jakarta-sans';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import DreamStudio from './dream/DreamStudio';
import './index.css';

// /dream opens the standalone dream journey workbench; everything else is the studio.
createRoot(document.getElementById('root')!).render(window.location.pathname === '/dream' ? <DreamStudio /> : <App />);
