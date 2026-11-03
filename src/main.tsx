import '@fontsource-variable/inter';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/plus-jakarta-sans';
import {createRoot} from 'react-dom/client';
import './index.css';

// /dream opens the standalone dream journey workbench; everything else is the studio.
const root=createRoot(document.getElementById('root')!);
root.render(<main role="status" className="min-h-dvh bg-black p-8 text-white">Loading AnchorShot…</main>);
const route=window.location.pathname.replace(/\/+$/, '')==='/dream'?import('./dream/DreamStudio'):import('./App');
void route.then(({default:Workspace})=>root.render(<Workspace/>)).catch(()=>{
 root.render(<main className="min-h-dvh bg-black p-8 text-white"><p role="alert">AnchorShot could not load. Reload to try again.</p><button type="button" className="mt-4 rounded border border-white px-4 py-2" onClick={()=>window.location.reload()}>Reload AnchorShot</button></main>);
});
