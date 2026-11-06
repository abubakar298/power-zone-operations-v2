export type StockSortRow={itemId?:string;id?:string;description?:string;variant?:string;section?:string};
export const stockSections:string[];
export function stockSection(variant:string,itemId:string,description:string):string;
export function compareStockItems(a:StockSortRow,b:StockSortRow):number;
