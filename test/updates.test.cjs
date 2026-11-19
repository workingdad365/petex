const {test}=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto'),fs=require('node:fs/promises'),path=require('node:path');
const {selectUpdate,download,repository}=require('../app/updates.cjs');
const bytes=Buffer.from('test package'),digest='sha256:'+createHash('sha256').update(bytes).digest('hex');
const release={tag_name:'v1.2.10',assets:['win-x64.exe','mac-arm64.pkg'].map(suffix=>{
  const name='Petex-1.2.10-'+suffix;
  return {name,size:bytes.length,digest,browser_download_url:`${repository}/releases/download/v1.2.10/${name}`};
})};
test('offers only newer stable releases with a matching installer and digest',()=>{
  assert.ok(selectUpdate(release,'1.2.9','win32','x64'));
  assert.ok(selectUpdate(release,'1.2.9','darwin','arm64'));
  for(const version of ['1.2.10','1.3.0'])assert.equal(selectUpdate(release,version,'win32','x64'),undefined);
  assert.equal(selectUpdate({...release,prerelease:true},'1.2.9','win32','x64'),undefined);
  for(const override of [{digest:null},{browser_download_url:'https://example.org/file'}]){
    assert.equal(selectUpdate({...release,assets:[{...release.assets[0],...override}]},'1.2.9','win32','x64'),undefined);
  }
});
test('installer is returned only after its exact size and SHA-256 match',async()=>{
  const update=selectUpdate(release,'1.2.9','win32','x64');
  const file=await download(update,async()=>new Response(bytes));
  try{assert.deepEqual(await fs.readFile(file),bytes);}finally{await fs.rm(path.dirname(file),{recursive:true});}
  for(const body of [Buffer.alloc(bytes.length),Buffer.alloc(bytes.length+1),Buffer.alloc(1)]){
    await assert.rejects(download(update,async()=>new Response(body)));
  }
});
