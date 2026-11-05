import test from 'node:test';
import assert from 'node:assert/strict';
import {deleteRuntimeAsset,uploadRuntimeAsset,verifyRuntimeAsset,verifyRuntimeRelease} from '../src/runtime-release.js';
const failure=status=>Object.assign(Error('gh failed'),{stdout:`HTTP/2.0 ${status}\r\nContent-Type: application/json\r\n\r\n`,stderr:'unexpected end of JSON input'});
const settings={repo:'owner/repo',id:123,sleep:async()=>{}};
test('runtime cleanup accepts empty 204 deletion responses',async()=>{
  await deleteRuntimeAsset({...settings,mutate:async()=>({stdout:'HTTP/2.0 204 No Content\r\n\r\n'})});
});
test('an empty upstream error body retries by HTTP status before succeeding',async()=>{
  let calls=0;const waits=[];
  await deleteRuntimeAsset({...settings,sleep:async ms=>waits.push(ms),mutate:async()=>{if(++calls<3)throw failure(503);return {stdout:'HTTP/2.0 204\r\n'};}});
  assert.equal(calls,3);assert.deepEqual(waits,[1000,4000]);
});
test('a completed deletion with a lost response can resolve as absent on retry',async()=>{
  let calls=0;
  await deleteRuntimeAsset({...settings,mutate:async()=>{if(++calls===1)throw Error('ETIMEDOUT');throw failure(404);}});
  assert.equal(calls,2);
});
test('access and rate-limit denials are not retried or hidden by an empty body',async()=>{
  for(const status of [401,403,429]){let calls=0;await assert.rejects(deleteRuntimeAsset({...settings,mutate:async()=>{calls++;throw failure(status);}}),new RegExp(`HTTP ${status}`));assert.equal(calls,1);}
});
test('persistent cleanup failure remains a failure after bounded retries',async()=>{
  let calls=0;await assert.rejects(deleteRuntimeAsset({...settings,mutate:async()=>{calls++;throw failure(502);}}),/keeping the published catalogue/);assert.equal(calls,3);
});
test('the actual execFile timeout shape retries before verifying absence',async()=>{
  let calls=0;
  await deleteRuntimeAsset({...settings,mutate:async()=>{if(++calls===1)throw Object.assign(Error('Command failed: gh api'),{killed:true,signal:'SIGTERM',code:null,stdout:Buffer.alloc(0),stderr:Buffer.alloc(0)});throw failure(404);}});
  assert.equal(calls,2);
});
test('a command without a confirmed deletion status cannot promote the new catalogue',async()=>{
  await assert.rejects(deleteRuntimeAsset({...settings,mutate:async()=>({stdout:''})}),/cleanup failed/);
});

const sha256='1234567890abcdef'.repeat(4);
const uploadFile={name:`data-${sha256}.json.gz`,sha256,bytes:1234,path:`/tmp/runtime/data-${sha256}.json.gz`};
const uploadedAsset=(overrides={})=>({id:456,name:uploadFile.name,state:'uploaded',size:uploadFile.bytes,digest:`sha256:${sha256}`,...overrides});
const release=(assets=[],overrides={})=>({id:123,tag_name:'catalogue-runtime',assets,...overrides});
const uploadFailure=status=>Object.assign(Error('Command failed: gh release upload'),{stderr:Buffer.from(`HTTP ${status}: upload failed (https://uploads.github.com/repos/owner/repo/releases/123/assets)`)});
const uploadSettings={repo:'owner/repo',tag:'catalogue-runtime',releaseId:123,file:uploadFile,sleep:async()=>{},log:()=>{}};

test('the reported upload 404 verifies the release and retries only the missing immutable file',async()=>{
  const events=[],args=[],waits=[];
  const result=await uploadRuntimeAsset({...uploadSettings,
    mutate:async command=>{args.push(command);events.push('upload');if(args.length===1)throw uploadFailure(404);},
    inspect:async()=>{events.push('inspect');return release();},
    sleep:async ms=>{events.push('wait');waits.push(ms);}
  });
  assert.deepEqual(events,['upload','inspect','wait','upload']);
  assert.deepEqual(waits,[1000]);
  assert.deepEqual(args,[['release','upload','catalogue-runtime',uploadFile.path,'--repo','owner/repo'],['release','upload','catalogue-runtime',uploadFile.path,'--repo','owner/repo']]);
  assert.deepEqual(result,{reused:false});
});

test('an upload that completed before a transport timeout is reused after checking its full identity',async()=>{
  for(const error of [Error('ETIMEDOUT'),Object.assign(Error('Command failed: gh release upload'),{killed:true,signal:'SIGTERM',code:null,stdout:Buffer.alloc(0),stderr:Buffer.alloc(0)})]){
    let uploads=0,inspections=0;
    const result=await uploadRuntimeAsset({...uploadSettings,
      mutate:async()=>{uploads++;throw error;},
      inspect:async()=>{inspections++;return release([uploadedAsset()]);},
      sleep:async()=>assert.fail('A verified upload must not be repeated')
    });
    assert.deepEqual(result,{reused:true});assert.equal(uploads,1);assert.equal(inspections,1);
  }
});

test('422 duplicate-name responses reuse only a matching completed upload',async()=>{
  let uploads=0;
  const result=await uploadRuntimeAsset({...uploadSettings,
    mutate:async()=>{uploads++;throw uploadFailure(422);},inspect:async()=>release([uploadedAsset()])
  });
  assert.deepEqual(result,{reused:true});assert.equal(uploads,1);
  uploads=0;
  await assert.rejects(uploadRuntimeAsset({...uploadSettings,
    mutate:async()=>{uploads++;throw uploadFailure(422);},inspect:async()=>release()
  }),/HTTP 422/);
  assert.equal(uploads,1);
});

test('a missing, replaced or renamed runtime release never triggers another upload',async()=>{
  for(const inspected of [release([],{id:999}),release([],{tag_name:'another-release'}),null]){
    let uploads=0;
    await assert.rejects(uploadRuntimeAsset({...uploadSettings,
      mutate:async()=>{uploads++;throw uploadFailure(404);},inspect:async()=>inspected
    }),/release changed/);
    assert.equal(uploads,1);
  }
  let uploads=0;
  await assert.rejects(uploadRuntimeAsset({...uploadSettings,
    mutate:async()=>{uploads++;throw uploadFailure(404);},inspect:async()=>{throw uploadFailure(404);}
  }),/Command failed/);
  assert.equal(uploads,1);
});

test('same-name incomplete or different-content assets cannot turn an upload failure into success',async()=>{
  for(const overrides of [{state:'starter',size:0,digest:null},{size:uploadFile.bytes+1},{digest:`sha256:${'f'.repeat(64)}`},{digest:null}]){
    let uploads=0;
    await assert.rejects(uploadRuntimeAsset({...uploadSettings,
      mutate:async()=>{uploads++;throw uploadFailure(502);},inspect:async()=>release([uploadedAsset(overrides)])
    }),/incomplete or does not match/);
    assert.equal(uploads,1);
  }
});

test('duplicate immutable asset names are rejected before retry or manifest promotion',async()=>{
  let uploads=0;
  await assert.rejects(uploadRuntimeAsset({...uploadSettings,
    mutate:async()=>{uploads++;throw uploadFailure(422);},inspect:async()=>release([uploadedAsset(),uploadedAsset({id:789})])
  }),/Duplicate runtime asset name/);
  assert.equal(uploads,1);
});

test('upload access and rate-limit failures do not inspect, retry or reuse assets',async()=>{
  for(const status of [401,403,429]){
    let uploads=0;
    await assert.rejects(uploadRuntimeAsset({...uploadSettings,
      mutate:async()=>{uploads++;throw uploadFailure(status);},inspect:async()=>assert.fail('Do not conceal access or rate-limit denials'),
      sleep:async()=>assert.fail('Do not retry a denial')
    }),new RegExp(`denied \\(HTTP ${status}\\)`));
    assert.equal(uploads,1);
  }
});

test('persistent transient upload failures stop after three verified attempts',async()=>{
  for(const status of [404,408,500,502,503,504]){
    let uploads=0,inspections=0;const waits=[];
    await assert.rejects(uploadRuntimeAsset({...uploadSettings,
      mutate:async()=>{uploads++;throw uploadFailure(status);},inspect:async()=>{inspections++;return release();},
      sleep:async ms=>waits.push(ms)
    }),/keeping the published catalogue/);
    assert.equal(uploads,3);assert.equal(inspections,3);assert.deepEqual(waits,[1000,4000]);
  }
});

test('ordinary upload validation failures and unknown process errors fail without retry',async()=>{
  for(const error of [uploadFailure(400),uploadFailure(413),Error('spawn gh ENOENT')]){
    let uploads=0;
    await assert.rejects(uploadRuntimeAsset({...uploadSettings,
      mutate:async()=>{uploads++;throw error;},inspect:async()=>assert.fail('Not a recoverable upload failure')
    }),/keeping the published catalogue/);
    assert.equal(uploads,1);
  }
});

test('final publication checks reject absent or corrupt files even when an upload command succeeded',()=>{
  const complete=uploadedAsset();assert.equal(verifyRuntimeAsset(complete,uploadFile),complete);
  for(const asset of [undefined,uploadedAsset({name:'wrong.json.gz'}),uploadedAsset({state:'starter'}),uploadedAsset({size:0}),uploadedAsset({digest:null}),uploadedAsset({digest:`sha256:${'0'.repeat(64)}`})]){
    assert.throws(()=>verifyRuntimeAsset(asset,uploadFile),/incomplete or does not match/);
  }
  const current=release([complete]);assert.equal(verifyRuntimeRelease(current,{id:123,tag:'catalogue-runtime'}),current);
  assert.throws(()=>verifyRuntimeRelease({...current,assets:null},{id:123,tag:'catalogue-runtime'}),/release changed/);
});

test('staged manifests use the same verified retry path without overwriting the published pointer',async()=>{
  const file={...uploadFile,name:'manifest.pending-1234567890.json',path:'/tmp/runtime/manifest.pending-1234567890.json'};
  let uploads=0;
  const result=await uploadRuntimeAsset({...uploadSettings,file,
    mutate:async command=>{uploads++;assert.ok(!command.includes('--clobber'));assert.equal(command[3],file.path);throw uploadFailure(404);},
    inspect:async()=>release([uploadedAsset({name:file.name})])
  });
  assert.deepEqual(result,{reused:true});assert.equal(uploads,1);
});

test('invalid upload identities fail before any command can mutate a release',async()=>{
  for(const overrides of [{repo:'owner/repo/other'},{tag:'latest'},{releaseId:0},{file:{...uploadFile,name:'manifest.json'}},{file:{...uploadFile,sha256:'invalid'}},{file:{...uploadFile,bytes:0}},{file:{...uploadFile,path:''}}]){
    await assert.rejects(uploadRuntimeAsset({...uploadSettings,...overrides,
      mutate:async()=>assert.fail('Invalid uploads must not run a command'),inspect:async()=>assert.fail('Invalid uploads must not inspect releases')
    }),/Invalid runtime upload/);
  }
});

test('a verified empty starter asset can be retired before retrying its immutable upload',async()=>{
  for(const status of [502,422]){
    const events=[],starter=uploadedAsset({state:'starter',size:0,digest:null});let uploads=0;
    const result=await uploadRuntimeAsset({...uploadSettings,
      mutate:async()=>{events.push('upload');if(++uploads===1)throw uploadFailure(status);},
      inspect:async()=>{events.push('inspect');return release([starter]);},
      removeIncomplete:async asset=>{assert.equal(asset,starter);events.push('remove');},
      sleep:async ms=>{assert.equal(ms,1000);events.push('wait');}
    });
    assert.deepEqual(events,['upload','inspect','remove','wait','upload']);
    assert.deepEqual(result,{reused:false});
  }
});

test('incomplete upload cleanup stops if the caller refuses to remove a protected asset',async()=>{
  let uploads=0,removals=0;
  await assert.rejects(uploadRuntimeAsset({...uploadSettings,
    mutate:async()=>{uploads++;throw uploadFailure(502);},
    inspect:async()=>release([uploadedAsset({state:'starter',size:0,digest:null})]),
    removeIncomplete:async()=>{removals++;throw Error('Asset is referenced by the published catalogue');},
    sleep:async()=>assert.fail('Cannot retry before cleanup succeeds')
  }),/referenced by the published catalogue/);
  assert.equal(uploads,1);assert.equal(removals,1);
});

test('starter recovery never deletes uploaded data, a nonempty starter or an invalid asset identity',async()=>{
  for(const overrides of [
    {state:'uploaded',size:0,digest:null},
    {state:'starter',size:100,digest:null},
    {state:'starter',size:0,digest:null,id:0},
    {state:'starter',size:0,digest:null,id:undefined},
    {state:'uploaded',digest:`sha256:${'f'.repeat(64)}`}
  ]){
    let uploads=0;
    await assert.rejects(uploadRuntimeAsset({...uploadSettings,
      mutate:async()=>{uploads++;throw uploadFailure(502);},inspect:async()=>release([uploadedAsset(overrides)]),
      removeIncomplete:async()=>assert.fail('Only an identified zero-byte starter may be removed')
    }));
    assert.equal(uploads,1);
  }
});

test('persistent zero-byte starter failures leave the last failed upload untouched after bounded recovery',async()=>{
  let uploads=0,removals=0;const waits=[];
  await assert.rejects(uploadRuntimeAsset({...uploadSettings,
    mutate:async()=>{uploads++;throw uploadFailure(502);},
    inspect:async()=>release([uploadedAsset({state:'starter',size:0,digest:null})]),
    removeIncomplete:async()=>{removals++;},sleep:async ms=>waits.push(ms)
  }),/incomplete or does not match|keeping the published catalogue/);
  assert.equal(uploads,3);assert.equal(removals,2);assert.deepEqual(waits,[1000,4000]);
});

test('denied uploads never remove even a recoverable starter asset',async()=>{
  for(const status of [401,403,429]){
    await assert.rejects(uploadRuntimeAsset({...uploadSettings,
      mutate:async()=>{throw uploadFailure(status);},inspect:async()=>release([uploadedAsset({state:'starter',size:0,digest:null})]),
      removeIncomplete:async()=>assert.fail('A denial must never authorize asset removal')
    }),new RegExp(`HTTP ${status}`));
  }
});
