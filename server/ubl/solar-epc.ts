/** Framework labels retained on issued BOQs, including earlier spelling variants. */
export function solarEpcComponent(label: unknown) {
  if (typeof label !== 'string') return undefined;
  switch (label.trim().toLowerCase().replace(/\s+/g, ' ')) {
    case 'electrical labour':
    case 'electrical labor':
    case 'installation labour':
    case 'installation labor':
    case 'labour':
    case 'labor':
      return 'Electrical Labour';
    case 'delivery/logistics':
    case 'delivery':
    case 'deliveries':
      return 'Deliveries';
  }
}

export function solarEpcLineCategory(line: { key?: string; description?: string; epc?: string }) {
  return solarEpcComponent(line.key) ?? solarEpcComponent(line.description)
    ?? (line.key === 'Earthing Bore' ? 'Earthing Cost' : line.epc || 'Installation Cost');
}
