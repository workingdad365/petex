const {createHash}=require('node:crypto');
const {createWriteStream}=require('node:fs');
const fs=require('node:fs/promises');
const os=require('node:os'),path=require('node:path');
const {Readable,Transform}=require('node:stream');
const {pipeline}=require('node:stream/promises');

const repository='https://github.com/workingdad365/petex';
const latest='https://api.github.com/repos/workingdad365/petex/releases/latest';
const limit=512*1024*1024;
function selectUpdate(release,current,platform,arch){
  const version=/^v(\d+\.\d+\.\d+)$/.exec(release.tag_name)?.[1];
  if(!version||release.draft||release.prerelease)return;
  const installed=current.split('.').map(Number);
  const difference=version.split('.').map((n,i)=>Number(n)-installed[i]).find(n=>n!==0);
  if(!(difference>0))return;
  const suffix=platform==='win32'&&arch==='x64'?'win-x64.exe':platform==='darwin'&&arch==='arm64'?'mac-arm64.pkg':null;
  if(!suffix)return;
  const name=`Petex-${version}-${suffix}`,url=`${repository}/releases/download/v${version}/${name}`;
  const asset=release.assets?.find(a=>a.name===name&&a.browser_download_url===url);
  if(!asset||!/^sha256:[\da-f]{64}$/.test(asset.digest)||!Number.isSafeInteger(asset.size)||asset.size<=0||asset.size>limit)return;
  return {version,name,url,size:asset.size,digest:asset.digest};
}
async function download(update,fetcher){
  const response=await fetcher(update.url,{signal:AbortSignal.timeout(10*60*1000)});
  if(!response.ok||!response.body)throw new Error('Download failed');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'petex-update-')),file=path.join(dir,update.name);
  try{
    const hash=createHash('sha256');let size=0;
    await pipeline(Readable.fromWeb(response.body),new Transform({transform(chunk,_encoding,done){
      size+=chunk.length;if(size>update.size)return done(new Error('Unexpected installer size'));
      hash.update(chunk);done(null,chunk);
    }}),createWriteStream(file,{flags:'wx'}));
    if(size!==update.size||`sha256:${hash.digest('hex')}`!==update.digest)throw new Error('Invalid installer');
    return file;
  }catch(error){await fs.rm(dir,{recursive:true,force:true});throw error;}
}
function startUpdates({app,dialog,shell,net,t}){
  if(!app.isPackaged||process.mas||process.env.PEDEX_DATA_DIR)return;
  let busy=false,announced;
  async function check(){
    if(busy)return;
    busy=true;
    try{
      const res=await net.fetch(latest,{signal:AbortSignal.timeout(15000)});
      if(!res.ok)return;
      const update=selectUpdate(await res.json(),app.getVersion(),process.platform,process.arch);
      if(!update||announced===update.version)return;
      announced=update.version;
      const {response}=await dialog.showMessageBox({type:'info',title:'Petex',message:t('updateAvailable',{version:update.version}),buttons:[t('updateInstall'),t('updateLater')],defaultId:0,cancelId:1});
      if(response!==0)return;
      try{
        const file=await download(update,(url,options)=>net.fetch(url,options));
        const error=await shell.openPath(file);if(error)throw new Error(error);
        app.quit();
      }catch{announced=null;await dialog.showMessageBox({type:'error',title:'Petex',message:t('updateFailed')});}
    }catch{/* An offline check can be retried on the next interval. */}
    finally{busy=false;}
  }
  void check();
  const timer=setInterval(check,6*60*60*1000);app.once('before-quit',()=>clearInterval(timer));
}
module.exports={repository,selectUpdate,download,startUpdates};
