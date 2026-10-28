/** Submission is a completed handoff, not a parcel still in transit. Unknown
 * historical locations stay unknown rather than acquiring an invented route. */
export function documentLocationGroup(location:string){
 if(location==='At site')return 'site';
 if(location==='Received at Lahore head office')return 'lahore';
 if(location==='Received at Karachi office')return 'karachi';
 if(location==='Submitted to Accounts')return 'accounts';
 if(['With delivery driver','TCS to Karachi office','TCS to Lahore head office'].includes(location))return 'transit';
 return 'unknown';
}
