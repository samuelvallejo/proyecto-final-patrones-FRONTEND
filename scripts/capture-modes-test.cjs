/* Local UI/protocol checks. Synthetic devices and relay MP4; no real account or phone capture. */
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ui = require('../frontend/public/locales/es.json');
const base = process.env.TEST_WEB_URL || 'http://localhost:15173';
if (!['localhost','127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Local frontend required');
async function setup(page, {native=false, watching=false}={}) {
  page.setDefaultTimeout(10000);
  let live=watching;
  await page.addInitScript(({native})=>{
    window.captureRequests=[]; window.nativeCommands=[];
    const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=async constraints=>{window.captureRequests.push(constraints); return original({video:true,audio:true});};
    navigator.mediaDevices.enumerateDevices=async()=>[
      {deviceId:'obs-video',label:'OBS Virtual Camera',kind:'videoinput'},
      {deviceId:'virtual-audio',label:'Synthetic audio input',kind:'audioinput'}];
    if(native) window.StreamGuardAndroid={onmessage:null,postMessage(raw){const command=JSON.parse(raw);window.nativeCommands.push(command);queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({id:command.id,ok:true})}));}};
  },{native});
  await page.route('**/api/**',route=>{
    const pathname=new URL(route.request().url()).pathname;
    const respond=value=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
    if(pathname==='/api/users/me')return respond({id:'synthetic-user',username:'Synthetic'});
    if(pathname==='/api/config')return respond({aiMode:'LOCAL_RULES',iceServers:[],mediaRelayConfigured:watching});
    if(pathname==='/api/channels/mine')return respond([{id:'synthetic-channel'}]);
    if(pathname==='/api/categories')return respond([{id:'synthetic-category',name:'Synthetic'}]);
    if(pathname.endsWith('/dashboard'))return respond({channel:{id:'synthetic-channel',owner_id:'synthetic-user'},policy:{level:'BALANCED'},stream:live?{id:'synthetic-stream',status:'LIVE',viewers:0}:null});
    if(pathname==='/api/streams'&&route.request().method()==='POST'){live=true;return respond({id:'synthetic-stream'});}
    if(pathname==='/api/auth/connection-ticket')return respond({ticket:'synthetic-ticket'});
    if(pathname==='/api/explore')return respond(watching?[{id:'synthetic-stream',title:'Synthetic native stream',status:'LIVE'}]:[]);
    if(pathname==='/api/streams/synthetic-stream')return respond({id:'synthetic-stream',title:'Synthetic native stream',status:'LIVE'});
    if(pathname.endsWith('/collaboration'))return respond({active:false,participants:[]});
    return respond([]);
  });
  await page.routeWebSocket('**/ws',socket=>socket.onMessage(()=>socket.send(JSON.stringify({type:'joined',hostOnline:true,mediaTransport:watching?'relay':'webrtc'}))));
  await page.goto(base);
  if(!watching) {
    const menu=page.locator('.menu-button'); if(await menu.isVisible()) await menu.click();
    await page.getByRole('button',{name:ui.myStudio,exact:true}).click();
  }
}
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome',args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 try {
  const desktop=await browser.newPage({permissions:['camera','microphone']}); await setup(desktop);
  console.log('Checking OBS input selection');
  assert.equal(await desktop.getByLabel(ui.captureSource,{exact:true}).inputValue(),'obs');
  await desktop.getByRole('button',{name:ui.captureFindDevices,exact:true}).click();
  await desktop.getByText(ui.captureObsReady,{exact:true}).waitFor();
  assert.equal(await desktop.getByLabel(ui.captureVideoInput,{exact:true}).inputValue(),'obs-video');
  await desktop.getByLabel(ui.captureAudioInput,{exact:true}).selectOption('virtual-audio');
  await desktop.getByLabel(ui.uiStudioText93,{exact:true}).fill('Synthetic OBS');
  await desktop.getByRole('button',{name:ui.uiStudioText96,exact:true}).click();
  await desktop.getByRole('button',{name:ui.uiStudioText87,exact:true}).waitFor();
  const requests=await desktop.evaluate(()=>window.captureRequests);
  assert.equal(requests.at(-1).video.deviceId.exact,'obs-video'); assert.equal(requests.at(-1).audio.deviceId.exact,'virtual-audio');
  await desktop.close();
  console.log('Checking mobile browser routing');
  const phoneContext=await browser.newContext({userAgent:'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile',viewport:{width:390,height:844},isMobile:true});
  const phone=await phoneContext.newPage();await setup(phone);
  assert(await phone.getByRole('checkbox',{name:ui.uiStudioText92,exact:true}).isDisabled());
  assert(await phone.getByRole('link',{name:ui.captureDownloadAndroid,exact:true}).isVisible());await phone.close();
  const native=await phoneContext.newPage();await setup(native,{native:true});
  console.log('Checking native Android bridge');
  await native.getByLabel(ui.captureSource,{exact:true}).selectOption('android');
  await native.getByLabel(ui.uiStudioText93,{exact:true}).fill('Synthetic native');
  await native.getByRole('button',{name:ui.uiStudioText96,exact:true}).click();
  await native.getByText(ui.nativeScreenPreview,{exact:true}).waitFor();
  assert.equal((await native.evaluate(()=>window.captureRequests)).length,0);
  assert.deepEqual(await native.evaluate(()=>window.nativeCommands.map(item=>item.action)),['prepare','start']);
  await native.getByRole('button',{name:ui.uiStudioText104,exact:true}).click();
  assert((await native.evaluate(()=>window.nativeCommands)).some(item=>item.action==='microphone'&&item.enabled===false));
  assert(await native.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await native.close();await phoneContext.close();
  if(process.env.NATIVE_MP4_FIXTURE) {
    console.log('Checking MP4 relay playback');
    const viewer=await browser.newPage(); const fragment=fs.readFileSync(process.env.NATIVE_MP4_FIXTURE);let timer;
    await viewer.routeWebSocket('**/ws/media',socket=>socket.onMessage(raw=>{
      if(JSON.parse(raw).type==='join'){
        socket.send(JSON.stringify({type:'relay-format',format:'video/mp4',fragmentMode:'file'}));socket.send(fragment);
        timer=setInterval(()=>socket.send(fragment),2500);
      }
    }));
    await setup(viewer,{watching:true});
    await viewer.locator('.stream-card').getByRole('button').first().click();
    await viewer.waitForFunction(()=>document.querySelector('#live-video')?.videoWidth>0);
    await viewer.waitForFunction(()=>{const video=document.querySelector('#live-video');window.seenFiles??=new Set();if(video?.src)window.seenFiles.add(video.src);return window.seenFiles.size>=2;},{},{timeout:12000});
    assert.equal(await viewer.locator('#live-video').getAttribute('data-transport'),'relay');clearInterval(timer);await viewer.close();
  }
  console.log('Desktop OBS selection, Android capability routing, native bridge controls and independent MP4 relay passed');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
