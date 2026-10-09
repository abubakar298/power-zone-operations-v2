import type {ReactNode} from "react";
/** Controls must carry the same id; the helper is linked with aria-describedby. */
export function Field({id,label,hint,children}:{id:string;label:string;hint?:ReactNode;children:ReactNode}) {
 return <div className="pz-field"><label htmlFor={id}>{label}</label>{children}<small id={`${id}-hint`} data-empty={hint == null ? "true" : undefined}>{hint??"\u00a0"}</small></div>;
}
