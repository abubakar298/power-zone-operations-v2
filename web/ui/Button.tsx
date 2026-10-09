import type {ButtonHTMLAttributes} from "react";
export type ButtonVariant="primary"|"secondary"|"neutral"|"success"|"warning"|"danger";
export function Button({variant="neutral",loading=false,loadingLabel="Working…",children,className="",disabled,type="button",...props}:ButtonHTMLAttributes<HTMLButtonElement>&{variant?:ButtonVariant;loading?:boolean;loadingLabel?:string}) {
 return <button {...props} type={type} disabled={disabled||loading} aria-busy={loading||undefined} className={`pz-button pz-button--${variant} ${className}`}>{loading?loadingLabel:children}</button>;
}
