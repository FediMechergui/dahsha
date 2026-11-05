// A stalled provider must not hold up independently resolved alternatives.
// Aborting also closes supported upstream requests/body streams, not just this wait.
export async function withinPlaybackBudget(resolve,milliseconds){
  const controller=new AbortController();
  let timer;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{const error=new Error('Playback source timed out');controller.abort(error);reject(error);},milliseconds);});
  try{return await Promise.race([Promise.resolve().then(()=>resolve(controller.signal)),deadline]);}
  finally{clearTimeout(timer);}
}
