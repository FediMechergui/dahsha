const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const responseStatus=result=>Number([...String(result?.stdout||'').matchAll(/^HTTP\/\S+\s+(\d{3})\b/gm)].at(-1)?.[1])||0;
const diagnosticOf=error=>[error?.message,error?.code,String(error?.stderr||'')].join(' ');
const uploadStatus=error=>responseStatus(error)||Number(/\bHTTP\s+(\d{3})\b/.exec(diagnosticOf(error))?.[1])||0;
const transportFailure=error=>/unexpected end of JSON input|timed?\s*out|ETIMEDOUT|ECONNRESET|socket hang up/i.test(diagnosticOf(error))||error?.killed===true&&error.signal==='SIGTERM';

// Hash-named files are immutable. Never treat a reserved/incomplete upload or
// a same-sized different file as reusable, and never use --clobber to recover.
export function verifyRuntimeAsset(asset,file) {
  if(!asset||asset.name!==file.name||asset.state!=='uploaded'||asset.size!==file.bytes||asset.digest!==`sha256:${file.sha256}`)throw Error(`Runtime asset ${file.name} is incomplete or does not match its content hash`);
  return asset;
}

export function verifyRuntimeRelease(release,{id,tag}) {
  if(release?.id!==id||release.tag_name!==tag||!Array.isArray(release.assets))throw Error('Runtime release changed during publication; keeping the published catalogue');
  return release;
}

export async function uploadRuntimeAsset({repo,tag,releaseId,file,mutate,inspect,removeIncomplete,sleep=pause,log=console.warn}) {
  if(!/^[\w.-]+\/[\w.-]+$/.test(repo)||tag!=='catalogue-runtime'||!Number.isSafeInteger(releaseId)||releaseId<=0||!Number.isSafeInteger(file?.bytes)||file.bytes<1||!/^[a-f0-9]{64}$/.test(file?.sha256)||!(file.name===`data-${file.sha256}.json.gz`||/^manifest\.pending-\d+\.json$/.test(file.name))||typeof file.path!=='string'||!file.path)throw Error('Invalid runtime upload');
  for(let attempt=0;attempt<3;attempt++){
    try {await mutate(['release','upload',tag,file.path,'--repo',repo]);return {reused:false};}
    catch(error){
      const status=uploadStatus(error);
      // An access/rate denial is never converted into success by a later GET.
      if([401,403,429].includes(status))throw new Error(`Runtime upload denied (HTTP ${status}); keeping the published catalogue`,{cause:error});
      const transient=[404,408,500,502,503,504].includes(status)||!status&&transportFailure(error);
      if(!transient&&status!==422)throw new Error(`Runtime upload ${file.name} failed${status?` (HTTP ${status})`:''}; keeping the published catalogue`,{cause:error});
      const release=verifyRuntimeRelease(await inspect(),{id:releaseId,tag});
      const existing=release.assets.filter(asset=>asset.name===file.name);
      if(existing.length>1)throw Error(`Duplicate runtime asset name: ${file.name}`);
      if(existing.length){
        const asset=existing[0];
        // An interrupted GitHub upload can reserve its name with a zero-byte
        // starter asset. Only an explicit, guarded caller may remove that stub.
        if(asset.state==='starter'&&asset.size===0&&Number.isSafeInteger(asset.id)&&asset.id>0&&removeIncomplete&&attempt<2){
          await removeIncomplete(asset);
          log(`[runtime] retrying incomplete upload ${file.name} (${attempt+2}/3)`);
          await sleep(1000*4**attempt);
          continue;
        }
        verifyRuntimeAsset(asset,file);return {reused:true};
      }
      // A 404 is retryable only after the expected release is confirmed to
      // still exist and the exact upload is absent. 422 without a matching
      // completed asset is a real validation failure, not an upload retry.
      if(!transient||attempt===2)throw new Error(`Runtime upload ${file.name} failed${status?` (HTTP ${status})`:''}; keeping the published catalogue`,{cause:error});
      log(`[runtime] retrying upload ${file.name} after ${status?`HTTP ${status}`:'a transport failure'} (${attempt+2}/3)`);
      await sleep(1000*4**attempt);
    }
  }
}

// GitHub can return an empty error body. gh then reports a JSON parse error
// instead of the HTTP status, so include headers even when no body is needed.
// Deletion is idempotent: a timed-out successful request can return 404 on retry.
export async function deleteRuntimeAsset({repo,id,mutate,sleep=pause}) {
  if(!/^[\w.-]+\/[\w.-]+$/.test(repo)||!Number.isSafeInteger(id)||id<=0)throw Error('Invalid release asset');
  const args=['api',`repos/${repo}/releases/assets/${id}`,'--method','DELETE','--include','--silent'];
  for(let attempt=0;attempt<3;attempt++){
    try {const result=await mutate(args);const status=responseStatus(result);if(status!==204&&status!==404)throw Object.assign(Error('Unexpected deletion response'),result);return;}
    catch(error){
      const status=responseStatus(error);
      if(status===404)return;
      const transient=[408,500,502,503,504].includes(status)||!status&&transportFailure(error);
      if(!transient||attempt===2)throw new Error(`Runtime asset ${id} cleanup failed${status?` (HTTP ${status})`:''}; keeping the published catalogue`,{cause:error});
      await sleep(1000*4**attempt);
    }
  }
}
