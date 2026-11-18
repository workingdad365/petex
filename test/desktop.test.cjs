const {test}=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {normalizeSettings}=require('../app/library.cjs');
const filename=require.resolve('../app/desktop.cjs'),source=fs.readFileSync(filename,'utf8'),desktopRequire=createRequire(filename);
const primary={id:1,scaleFactor:1.25,bounds:{x:0,y:0,width:1920,height:1080},workArea:{x:0,y:0,width:1920,height:1040}};
const left={id:2,scaleFactor:1,bounds:{x:-1600,y:0,width:1600,height:900},workArea:{x:-1600,y:24,width:1600,height:836}};
const right={id:3,scaleFactor:2,bounds:{x:1920,y:160,width:1280,height:1024},workArea:{x:1920,y:160,width:1280,height:984}};
const above={id:4,scaleFactor:1.5,bounds:{x:200,y:-1200,width:2560,height:1200},workArea:{x:200,y:-1176,width:2560,height:1176}};

async function fixture(t,patch={}) {
  const displays=structuredClone([primary,left,right,above]),cursor={x:0,y:0},saves=[];
  const nearest=point=>displays.reduce((best,d)=>{
    const distance=({bounds:b})=>Math.hypot(Math.max(b.x-point.x,0,point.x-b.x-b.width),Math.max(b.y-point.y,0,point.y-b.y-b.height));
    return distance(d)<distance(best)?d:best;
  });
  const screen={
    getAllDisplays:()=>displays,getPrimaryDisplay:()=>displays[0],getCursorScreenPoint:()=>({...cursor}),getDisplayNearestPoint:nearest,
    getDisplayMatching:bounds=>{
      assert.ok(['x','y','width','height'].every(key=>Number.isInteger(bounds[key])),'Electron display rectangles require integer coordinates');
      const overlap=({bounds:b})=>Math.max(0,Math.min(bounds.x+bounds.width,b.x+b.width)-Math.max(bounds.x,b.x))*Math.max(0,Math.min(bounds.y+bounds.height,b.y+b.height)-Math.max(bounds.y,b.y));
      const best=displays.reduce((best,d)=>overlap(d)>overlap(best)?d:best);
      return overlap(best)?best:nearest({x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2});
    },
  };
  class Window extends EventEmitter {
    constructor(options){super();this.bounds={x:200,y:200,width:options.width,height:options.height};this.visible=false;this.destroyed=false;this.webContents={send(){}};}
    getBounds(){return {...this.bounds};}
    setBounds(bounds){this.bounds={...bounds};}
    setPosition(x,y){Object.assign(this.bounds,{x,y});}
    setAlwaysOnTop(){}
    setVisibleOnAllWorkspaces(){}
    setIgnoreMouseEvents(){}
    loadFile(){return Promise.resolve();}
    isDestroyed(){return this.destroyed;}
    isVisible(){return this.visible;}
    showInactive(){this.visible=true;}
    hide(){this.visible=false;}
    destroy(){this.destroyed=true;}
  }
  const module={exports:{}},electron={BrowserWindow:Window,screen,powerMonitor:{getSystemIdleTime:()=>0}};
  vm.compileFunction(source,['require','module','__dirname'],{filename})(name=>name==='electron'?electron:desktopRequire(name),module,path.dirname(filename));
  const settings=normalizeSettings({behaviour:'quiet',shortcut:false,...patch});
  const desktop=new module.exports.DesktopPets({getState:()=>({settings,pets:[{id:'miso',builtin:true}],screenAwake:true}),secure(){},windowOptions:()=>({}),onChange(){},onSave:()=>saves.push(structuredClone(settings))});
  t.after(()=>desktop.dispose());
  await desktop.primary.ready;desktop.apply();
  await Promise.all([...desktop.instances.values()].map(p=>p.ready));
  return {desktop,settings,displays,cursor,saves,screen};
}

test('startup restores saved primary and companion positions on secondary displays',async t=>{
  const {desktop}=await fixture(t,{position:{x:-900,y:200},features:{multiPet:true},companions:[{id:'friend',petId:'miso',position:{x:2200,y:400}}]});
  assert.deepEqual(desktop.primary.win.getBounds(),{x:-900,y:200,width:192,height:206});
  assert.deepEqual(desktop.instances.get('friend').win.getBounds(),{x:2200,y:400,width:192,height:206});
});

test('saved anchors round fractional coordinates before matching a resized display',async t=>{
  const anchor={displayId:'2',x:1/3,y:.25};
  const {desktop,displays,settings}=await fixture(t,{placements:{primary:anchor}});
  assert.deepEqual(desktop.primary.win.getBounds(),{x:-1131,y:182,width:192,height:206});
  displays[1].bounds={x:-1280,y:0,width:1280,height:864};
  displays[1].workArea={x:-1280,y:24,width:1280,height:800};
  desktop.apply(true);
  assert.deepEqual(desktop.primary.win.getBounds(),{x:-917,y:173,width:192,height:206});
  assert.deepEqual(settings.placements.primary,anchor);
});

for(const [name,point,position,displayId] of [
  ['left',{x:-1,y:400},{x:-192,y:310},'2'],
  ['right',{x:1921,y:400},{x:1920,y:310},'3'],
  ['above',{x:700,y:-1},{x:604,y:-206},'4'],
])test(`dragging crosses to the ${name} display as soon as the cursor crosses its boundary`,async t=>{
  const {desktop,settings,cursor,saves}=await fixture(t),pet=desktop.primary,start=pet.win.getBounds();
  Object.assign(cursor,{x:start.x+96,y:start.y+90});desktop.pressStart(pet);
  Object.assign(cursor,point);desktop.tick();
  assert.deepEqual(pet.win.getBounds(),{...position,width:192,height:206});
  desktop.pressEnd(pet);
  assert.deepEqual(settings.position,position);assert.equal(settings.placements.primary.displayId,displayId);
  assert.deepEqual(saves.at(-1).position,position);
  desktop.apply();assert.deepEqual(settings.position,position);
  Object.assign(cursor,{x:position.x+96,y:position.y+90});desktop.pressStart(pet);
  Object.assign(cursor,{x:start.x+96,y:start.y+90});desktop.tick();desktop.pressEnd(pet);
  assert.deepEqual(pet.win.getBounds(),start);assert.equal(settings.placements.primary.displayId,'1');
});

test('drag release snaps within the destination work area and clamps off-screen movement',async t=>{
  const {desktop,cursor,settings}=await fixture(t),pet=desktop.primary,start=pet.win.getBounds();
  Object.assign(cursor,{x:start.x+96,y:start.y+90});desktop.pressStart(pet);
  Object.assign(cursor,{x:-1404,y:122});desktop.tick();
  assert.equal(pet.win.getBounds().y,32);desktop.pressEnd(pet);
  assert.deepEqual(settings.position,{x:-1500,y:24});
  Object.assign(cursor,{x:-1404,y:114});desktop.pressStart(pet);
  Object.assign(cursor,{x:-3000,y:400});desktop.tick();desktop.pressEnd(pet);
  assert.deepEqual(settings.position,{x:-1600,y:310});
});

test('display moves preserve relative placement, cancel motion and move only the selected companion',async t=>{
  const {desktop,settings,saves}=await fixture(t,{features:{multiPet:true},companions:[{id:'friend',petId:'miso'}]});
  const pet=desktop.instances.get('friend'),original=desktop.primary.win.getBounds();
  pet.win.setPosition(864,417);pet.walking={};pet.drag={};
  assert.equal(desktop.moveToDisplay(pet,'2'),true);
  assert.deepEqual(pet.win.getBounds(),{x:-896,y:339,width:192,height:206});
  assert.deepEqual(desktop.primary.win.getBounds(),original);
  assert.equal(pet.walking,null);assert.equal(pet.drag,null);
  assert.deepEqual(settings.placements.friend,{displayId:'2',x:.5,y:.5});
  assert.deepEqual(saves.at(-1).companions[0].position,{x:-896,y:339});
  desktop.apply();assert.deepEqual(pet.win.getBounds(),{x:-896,y:339,width:192,height:206});
});

test('disconnected displays fall back to primary and reconnecting restores the saved anchor',async t=>{
  const {desktop,settings,displays}=await fixture(t),pet=desktop.primary;
  pet.win.setPosition(864,417);desktop.moveToDisplay(pet,'2');
  displays.splice(1,1);desktop.apply(true);
  assert.deepEqual(pet.win.getBounds(),{x:864,y:417,width:192,height:206});
  assert.deepEqual(settings.placements.primary,{displayId:'2',x:.5,y:.5});
  displays.push(structuredClone(left));desktop.apply(true);
  assert.deepEqual(pet.win.getBounds(),{x:-896,y:339,width:192,height:206});
  desktop.reset();assert.deepEqual(pet.win.getBounds(),{x:1664,y:810,width:192,height:206});
  assert.deepEqual(settings.placements,{});
});

test('explicit roaming limits constrain both dragging and menu moves until turned off',async t=>{
  const {desktop,settings,cursor}=await fixture(t,{features:{roaming:true},roamArea:{displayId:'1',rect:{x:.1,y:.1,width:.5,height:.5}}}),pet=desktop.primary;
  const start=pet.win.getBounds();Object.assign(cursor,{x:start.x+96,y:start.y+90});desktop.pressStart(pet);
  Object.assign(cursor,{x:-800,y:300});desktop.tick();desktop.pressEnd(pet);
  assert.deepEqual(settings.position,{x:192,y:210});
  assert.equal(desktop.moveToDisplay(pet,'2'),false);assert.deepEqual(settings.position,{x:192,y:210});
  settings.features.roaming=false;
  assert.equal(desktop.moveToDisplay(pet,'2'),true);assert.equal(settings.placements.primary.displayId,'2');
});

test('menu moves ignore displays and pet windows removed after opening the menu',async t=>{
  const {desktop,displays,saves}=await fixture(t),pet=desktop.primary,before=pet.win.getBounds();
  displays.splice(1,1);assert.equal(desktop.moveToDisplay(pet,'2'),false);
  assert.deepEqual(pet.win.getBounds(),before);assert.equal(saves.length,0);
  pet.win.destroy();assert.equal(desktop.moveToDisplay(pet,'3'),false);
  assert.equal(saves.length,0);
});
