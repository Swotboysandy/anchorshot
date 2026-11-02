import {Children, useEffect, useState, type ReactNode} from 'react';
import {ResizablePanelGroup,ResizablePanel,ResizableHandle} from './ui/resizable';
export function DashboardLayout({active,children}:{active:boolean;children:ReactNode}){
 const [wide,setWide]=useState(()=>window.matchMedia('(min-width:1200px)').matches);
 useEffect(()=>{const query=window.matchMedia('(min-width:1200px)');const update=()=>setWide(query.matches);query.addEventListener('change',update);return()=>query.removeEventListener('change',update)},[]);
 const panes=Children.toArray(children);
 if(!active)return <div className="creation-grid creation-empty">{children}</div>;
 // One tree at every width: crossing the breakpoint must not remount panes and lose unsaved edits.
 return <div className={wide?'dashboard-resizable':'creation-grid studio-dashboard dashboard-flat'}><ResizablePanelGroup orientation="horizontal">
 <ResizablePanel defaultSize="28%" minSize="350px"><div className="dashboard-pane">{panes[0]}</div></ResizablePanel>
 <ResizableHandle withHandle aria-label="Resize direction panel"/>
 <ResizablePanel defaultSize="50%" minSize="400px"><div className="dashboard-pane dashboard-preview-pane">{panes[1]}</div></ResizablePanel>
 <ResizableHandle withHandle aria-label="Resize scene details"/>
 <ResizablePanel defaultSize="22%" minSize="250px"><div className="dashboard-pane">{panes[2]}</div></ResizablePanel>
 </ResizablePanelGroup></div>;
}
