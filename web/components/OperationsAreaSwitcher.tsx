import {Button} from '../ui/Button.js';

export type OperationsArea = 'procurement' | 'operations';

export function OperationsAreaSwitcher({value,onSelect}:{value:OperationsArea;onSelect:(area:OperationsArea)=>void}) {
  return <nav className="coordinator-shortcuts operations-area-shortcuts" aria-label="Operations workspace areas">
    <Button variant={value==='procurement'?'secondary':'neutral'} aria-pressed={value==='procurement'} onClick={()=>onSelect('procurement')}>Procurement</Button>
    <Button variant={value==='operations'?'secondary':'neutral'} aria-pressed={value==='operations'} onClick={()=>onSelect('operations')}>Operations</Button>
  </nav>;
}

export function ProcurementWorkspace() {
  return <section className="card pz-stack" aria-label="Procurement workspace">
    <h2>Procurement</h2>
    <p>Procurement work will appear here.</p>
  </section>;
}
