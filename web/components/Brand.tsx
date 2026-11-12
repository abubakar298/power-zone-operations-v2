export function Brand({ compact = false, department = "Operations" }: { compact?: boolean; department?: string }) {
  return <div className={`brand ${compact ? 'brand-compact' : ''}`}>
    <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M13.5 2 5 13h6l-.5 9L19 11h-6l.5-9Z" fill="currentColor" /></svg></span>
    <div><strong>Power Zone</strong><span>{department}</span></div>
  </div>;
}
