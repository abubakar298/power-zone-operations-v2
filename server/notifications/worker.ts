/** One sweep at a time; a recovering database gets a bounded retry pause.
 * Business commands are never retried by this worker. */
export function notificationWorker(run:()=>Promise<unknown>,onError:(error:unknown,retryMs:number)=>void,clock=Date.now){
 let running=false,failures=0,nextAttempt=0;
 return async()=>{
  if(running||clock()<nextAttempt)return;
  running=true;
  try{await run();failures=0;nextAttempt=clock()+30_000;}
  catch(error){const retryMs=Math.min(300_000,30_000*2**Math.min(++failures,4));nextAttempt=clock()+retryMs;onError(error,retryMs);}
  finally{running=false;}
 };
}
