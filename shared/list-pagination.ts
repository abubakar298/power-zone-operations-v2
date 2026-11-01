export function paginateRows<T>(rows:readonly T[],requestedPage:number,enabled=true){
 const size=10,total=rows.length,pages=enabled?Math.max(1,Math.ceil(total/size)):1;
 const page=enabled?Math.min(Math.max(0,Math.floor(Number.isFinite(requestedPage)?requestedPage:0)),pages-1):0;
 const start=enabled?page*size:0,end=enabled?Math.min(start+size,total):total;
 return {rows:rows.slice(start,end),page,pages,start,end,total};
}
