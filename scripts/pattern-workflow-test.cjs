/* Run only against a dedicated local backend and PostgreSQL test database. */
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ui = JSON.parse(fs.readFileSync(path.join(__dirname, '../frontend/public/locales/es.json'), 'utf8'));
const base = process.env.TEST_WEB_URL || 'http://localhost:15173';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Pattern workflow tests require a local test server');

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  const context = await browser.newContext({viewport: {width: 1280, height: 900}, extraHTTPHeaders: {Origin: base}});
  const page = await context.newPage();
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  const name = 'patterns' + crypto.randomUUID().replaceAll('-', '').slice(0, 12);
  const api = async (method, route, data) => {
    const response = await context.request.fetch(base + '/api' + route, {method, data});
    assert.equal(response.status(), 200, `Unexpected ${method} ${route} status`);
    return response.json();
  };
  try {
    await api('POST', '/auth/register', {username: name, email: name + '@gmail.com', password: 'Synthetic-Test-Only-42!', aiConsent: true});
    const channel = await api('POST', '/channels', {name: 'Pattern workflow', slug: name, description: ''});
    const route = `/channels/${channel.id}`;
    const original = {level: 'BALANCED', autoHide: false, autoMute: true, muteSeconds: 90,
      reviewThreshold: .55, blockThreshold: .85, blockedWords: ['reserved'], blockedTopics: ['private'],
      allowLinks: false, slowMode: 7, autoClips: false};
    await api('PUT', route + '/policy', original);
    await page.goto(base);
    await page.getByRole('button', {name: ui.uiShellText13, exact: true}).click();
    const level = page.getByLabel(ui.uiSettingsText180, {exact: true});
    const words = page.getByLabel(ui.restrictedWords, {exact: true});
    await level.waitFor();
    await words.fill('editedword');
    await level.selectOption('STRICT');
    await page.getByRole('button', {name: ui.applyModerationPreset, exact: true}).click();
    await page.getByRole('status').filter({hasText: ui.moderationPresetReady}).waitFor();
    assert.equal(await page.getByLabel(ui.uiSettingsText185, {exact: true}).inputValue(), '300');
    assert.equal(await page.getByLabel(ui.uiSettingsText181, {exact: true}).isChecked(), true);
    assert.equal(await page.getByLabel(ui.uiSettingsText182, {exact: true}).isChecked(), false);
    assert.equal(await words.inputValue(), 'editedword');
    assert.equal(await page.getByLabel(ui.uiSettingsText186, {exact: true}).inputValue(), '7');
    assert.equal(await page.getByLabel(ui.uiSettingsText183, {exact: true}).isChecked(), false);
    assert.equal((await api('GET', route + '/dashboard')).policy.level, 'BALANCED');
    await page.getByRole('button', {name: ui.uiSettingsText190, exact: true}).click();
    await page.getByRole('status').filter({hasText: ui.uiSettingsText191}).waitFor();
    const stored = (await api('GET', route + '/dashboard')).policy;
    assert.equal(stored.level, 'STRICT'); assert.deepEqual(stored.blockedWords, ['editedword']);
    assert.deepEqual(stored.blockedTopics, ['private']); assert.equal(stored.allowLinks, false);

    await page.route('**/policy-presets/STRICT', route => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({internalSecret: 'private-model-token-fixture'})}));
    await page.getByRole('button', {name: ui.applyModerationPreset, exact: true}).click();
    await page.getByRole('alert').filter({hasText: ui.presetLoadFailed}).waitFor();
    assert(!(await page.locator('body').innerText()).includes('private-model-token-fixture'));
    assert.equal(await page.getByRole('button', {name: ui.uiSettingsText190, exact: true}).isEnabled(), true);
    await page.unroute('**/policy-presets/STRICT');

    await page.setViewportSize({width: 390, height: 844});
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(failures, []);
    console.log(JSON.stringify({passed: true, previewDoesNotSave: true, preservesUnsavedRestrictions: true,
      explicitSavePersists: true, malformedResponseIsPrivate: true, mobileFits: true}));
  } finally {await context.close(); await browser.close();}
})().catch(error => {console.error(error.message); process.exitCode = 1;});
