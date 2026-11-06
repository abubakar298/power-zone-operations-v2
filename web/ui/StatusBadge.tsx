import type {ReactNode} from "react";
export function StatusBadge({tone="pending",children}:{tone?:"pending"|"success"|"warning"|"danger";children:ReactNode}) {
 return <span className={`pz-status pz-status--${tone}`}>{children}</span>;
}
