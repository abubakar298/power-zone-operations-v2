import {Button} from '../ui/Button.js';

export type OperationsArea = 'procurement' | 'operations';

export function OperationsAreaSwitcher({value,onSelect,busy=false}:{value:OperationsArea;onSelect:(area:OperationsArea)=>void;busy?:boolean}) {
  return <nav className="coordinator-shortcuts operations-area-shortcuts" aria-label="Operations workspace areas">
    <Button disabled={busy} variant={value==='procurement'?'secondary':'neutral'} aria-pressed={value==='procurement'} onClick={()=>onSelect('procurement')}>Procurement</Button>
    <Button disabled={busy} variant={value==='operations'?'secondary':'neutral'} aria-pressed={value==='operations'} onClick={()=>onSelect('operations')}>Operations</Button>
  </nav>;
}

export function ProcurementWorkspace() {
  return <section className="card pz-stack" aria-label="Procurement workspace">
    <h2>Procurement</h2>
    <p>Procurement work will appear here.</p>
  </section>;
}
