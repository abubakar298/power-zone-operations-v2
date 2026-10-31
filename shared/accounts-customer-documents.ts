export type CustomerDocumentKind='Signed DO'|'VSO'|'Acknowledgment';
export type AccountsCustomerDocument={id:string;siteId:string;siteName:string;customer:string;ipo:string;kind:CustomerDocumentKind;filename:string;receivedAt:string;documentDate:string|null;source:'QC'|'Site sign-off';sourceVersion:number;downloadUrl:string};
