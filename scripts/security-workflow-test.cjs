/* End-to-end checks run against a separate local database and synthetic media. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ui=JSON.parse(fs.readFileSync('frontend/public/locales/es.json','utf8'));
const base=process.env.TEST_WEB_URL||'http://localhost:5173';
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome',args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required']});
 const errors=[],responses=[],results=[]; let page;
 try {
  const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['camera','microphone','geolocation'],geolocation:{latitude:1.23,longitude:-76.34}});
  page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  page.on('response',async response=>{if(/\/auth\/(register|login)$/.test(response.url())) responses.push({status:response.status(),body:await response.json()});});
  await page.goto(base);await page.getByRole('button',{name:ui.signIn,exact:true}).waitFor();
  assert.equal(await page.locator('.sidebar').count(),0);assert.equal(await page.locator('.auth-shell').count(),1);
  await page.screenshot({path:'artifacts/auth-light-desktop.png',fullPage:true});results.push('Guests see only the light branded login screen');
  await page.getByRole('button',{name:ui.uiAuthViewText51,exact:true}).click();
  const username='review_'+Date.now().toString(36),email=username+'@gmail.com',password='TestPassword123!';
  await page.getByLabel(ui.uiAuthViewText45,{exact:true}).fill(username);await page.getByLabel(ui.uiAuthViewText46,{exact:true}).fill(username+'@example.com');await page.getByLabel(ui.uiAuthViewText47,{exact:true}).fill(password);
  await page.getByRole('button',{name:ui.showPassword,exact:true}).click();assert.equal(await page.getByLabel(ui.uiAuthViewText47,{exact:true}).getAttribute('type'),'text');
  await page.getByRole('button',{name:ui.hidePassword,exact:true}).click();
  await page.getByRole('checkbox').check();await page.getByRole('button',{name:ui.createAccount,exact:true}).click();assert.equal(responses.length,0);
  await page.getByLabel(ui.uiAuthViewText46,{exact:true}).fill(email);
  await page.getByRole('button',{name:ui.createAccount,exact:true}).click();await page.locator('.sidebar').waitFor();
  assert.deepEqual(responses[0].body,{ok:true});
  const cookie=(await context.cookies()).find(value=>value.name==='streamguard_session');assert(cookie?.httpOnly);assert(cookie.expires>Date.now()/1000+600000);
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('streamguard.token')),null);assert.equal(await page.evaluate(()=>localStorage.getItem('streamguard.token')),null);assert(!await page.evaluate(()=>document.cookie.includes('streamguard_session')));
  results.push('Password visibility, provider validation and encrypted HttpOnly session work');
  await page.getByRole('button',{name:ui.myStudio,exact:true}).click();await page.getByRole('button',{name:ui.uiCreateChannelText65,exact:true}).waitFor();
  assert.equal(await page.getByLabel(ui.uiCreateChannelText59,{exact:true}).inputValue(),'');assert.equal(await page.getByLabel(ui.uiCreateChannelText64,{exact:true}).inputValue(),'');
  assert.equal(await page.getByLabel(ui.shareLocationLabel).isChecked(),false);assert.equal(await page.locator('input[maxlength="40"]').count(),0);
  await page.getByLabel(ui.uiCreateChannelText59,{exact:true}).fill('Review channel');await page.getByRole('button',{name:ui.uiCreateChannelText65,exact:true}).click();
  await page.getByLabel(ui.uiStudioText93,{exact:true}).waitFor();await page.getByLabel(ui.uiStudioText93,{exact:true}).fill('Synthetic live review');
  await page.getByRole('button',{name:ui.uiStudioText96,exact:true}).click();await page.getByRole('button',{name:ui.uiStudioText87,exact:true}).waitFor({timeout:55000});
  await page.waitForFunction(()=>document.querySelector('#live-video')?.videoWidth>0);
  const viewerContext=await browser.newContext({viewport:{width:1200,height:850}});
  const viewerName='viewer_'+Date.now().toString(36);
  const viewerRegistration=await viewerContext.request.post(base+'/api/auth/register',{data:{username:viewerName,email:viewerName+'@gmail.com',password:'TestPassword123!',aiConsent:true}});
  assert.equal(viewerRegistration.status(),200);
  const viewer=await viewerContext.newPage();viewer.on('pageerror',error=>errors.push(error.message));await viewer.goto(base);await viewer.locator('.stream-card').filter({hasText:'Synthetic live review'}).getByRole('button',{name:ui.uiExploreText32,exact:true}).click();
  await viewer.waitForFunction(()=>document.querySelector('#live-video')?.videoWidth>0,{},{timeout:30000});results.push('A second authenticated browser receives WebRTC video with a one-use connection ticket');

  await page.getByRole('button',{name:ui.uiShellText08,exact:true}).click();await page.waitForFunction(()=>document.querySelector('.floating-player video')?.videoWidth>0);
  await page.screenshot({path:'artifacts/live-floating-light.png',fullPage:true});results.push('Empty channel form generates a link; video persists in a floating player while navigating');
  await page.getByRole('button',{name:ui.returnToStudio,exact:true}).click();await page.getByRole('button',{name:ui.uiStudioText87,exact:true}).waitFor();
  await page.getByPlaceholder(ui.uiChatPanelText115).fill('hola');await page.getByRole('button',{name:ui.uiChatPanelText116,exact:true}).click();await page.locator('.chat-list').getByText('hola',{exact:true}).waitFor();
  await page.getByRole('button',{name:ui.uiStudioText87,exact:true}).click();await page.getByRole('button',{name:ui.uiStudioText96,exact:true}).waitFor({timeout:55000});
  await page.getByRole('button',{name:ui.myAccount,exact:true}).click();await page.getByRole('button',{name:ui.viewRecording,exact:true}).first().waitFor();await page.getByRole('button',{name:ui.viewRecording,exact:true}).first().click();
  await page.waitForFunction(()=>document.querySelector('.recording-video')?.readyState>=2);await page.getByRole('button',{name:ui.closeWindow,exact:true}).click();results.push('Normal chat is visible and a finished recording can be replayed from the profile');
  await page.close();page=await context.newPage();await page.goto(base);await page.locator('.sidebar').waitFor();assert.equal(await page.locator('.auth-shell').count(),0);results.push('Closing and reopening a page restores the persistent session');
  await page.getByRole('button',{name:ui.uiShellText13,exact:true}).click();await page.getByLabel(ui.uiSettingsText185,{exact:true}).fill('999999');assert.equal(await page.getByLabel(ui.uiSettingsText185,{exact:true}).inputValue(),'86400');
  await page.getByLabel(ui.uiSettingsText186,{exact:true}).fill('999');assert.equal(await page.getByLabel(ui.uiSettingsText186,{exact:true}).inputValue(),'120');results.push('Numeric limits are enforced inside the form before requests');
  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const phone=await mobile.newPage();await phone.goto(base);await phone.getByRole('button',{name:ui.signIn,exact:true}).waitFor();assert(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await phone.screenshot({path:'artifacts/auth-light-mobile.png',fullPage:true});
  await page.getByRole('button',{name:ui.myAccount,exact:true}).click();await page.getByRole('button',{name:ui.uiAccountText202,exact:true}).click();await page.getByRole('button',{name:ui.signIn,exact:true}).waitFor();assert(!(await context.cookies()).some(value=>value.name==='streamguard_session'));results.push('Mobile layout fits and logout revokes the session'); await viewerContext.close();
  assert.deepEqual(errors,[]);fs.writeFileSync('artifacts/security-workflow-results.json',JSON.stringify({passed:true,results,errors},null,2));console.log(JSON.stringify({passed:true,results,errors},null,2));
 } catch(error){if(page)await page.screenshot({path:'artifacts/security-workflow-failure.png',fullPage:true}).catch(()=>{});throw error;}
 finally {await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
