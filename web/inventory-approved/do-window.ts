/** One preview window per DO (user request, 24 Nov 2026): the DO copies, the Variable Material Gate
 * Pass, the VSO and the Acknowledgement are shown, printed and downloaded together. */
export function withVso(url:string){return url+(url.includes('?')?'&':'?')+'with=vso';}
