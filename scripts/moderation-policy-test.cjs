const {test, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {execFileSync} = require('node:child_process');
const {pathToFileURL} = require('node:url');

const root = path.resolve(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'streamguard-policy-'));
const entry = path.join(work, 'moderation-policy.mjs');
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'),
  path.join(root, 'frontend/src/moderation-policy.ts'), '--target', 'ES2022', '--module', 'ESNext',
  '--skipLibCheck', '--typeRoots', work, '--outDir', work], {cwd: root, stdio: 'pipe'});
fs.renameSync(path.join(work, 'moderation-policy.js'), entry);
const modulePromise = import(pathToFileURL(entry).href);
after(() => {fs.unlinkSync(entry); fs.rmdirSync(work);});
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/moderation-contracts.json'), 'utf8'));
const baseline = {level: 'BALANCED', autoHide: true, autoMute: false, muteSeconds: 300,
  reviewThreshold: .55, blockThreshold: .85, blockedWords: ['restricted'], blockedTopics: ['private'], allowLinks: false};

for (const fixture of cases) test(fixture.id, async () => {
  const {ModerationPolicyDraft} = await modulePromise;
  const input = structuredClone(fixture.policy);
  if (!fixture.valid) {assert.throws(() => ModerationPolicyDraft.fromServer(input)); return;}
  const draft = ModerationPolicyDraft.fromServer(input), copy = draft.copy();
  assert.notEqual(copy, draft);
  assert.deepEqual(copy.snapshot(), fixture.policy);
  input.blockedWords.push('source change'); input.blockedTopics.push('source change');
  const exposed = copy.snapshot(); exposed.blockedWords.push('snapshot change'); exposed.blockedTopics.push('snapshot change');
  assert.deepEqual(draft.snapshot(), fixture.policy);
  assert.deepEqual(copy.snapshot(), fixture.policy);
});

test('remote metadata cannot enter the policy snapshot', async () => {
  const {ModerationPolicyDraft} = await modulePromise;
  const snapshot = ModerationPolicyDraft.fromServer({...baseline, internalSecret: 'fixture-only'}).snapshot();
  assert.deepEqual(Object.keys(snapshot).sort(), Object.keys(baseline).sort());
});

for (const [id, value] of [
  ['empty response', null], ['array response', []], ['string response', 'policy'],
  ['fractional duration', {...baseline, muteSeconds: 30.5}],
  ['string duration', {...baseline, muteSeconds: '300'}],
  ['nonfinite review', {...baseline, reviewThreshold: Number.NaN}],
  ['nonfinite block', {...baseline, blockThreshold: Infinity}],
  ['string review', {...baseline, reviewThreshold: '.55'}],
  ['string hide flag', {...baseline, autoHide: 'true'}],
  ['numeric mute flag', {...baseline, autoMute: 1}],
  ['missing links flag', {...baseline, allowLinks: undefined}],
  ['numeric word', {...baseline, blockedWords: [3]}],
  ['object topic', {...baseline, blockedTopics: [{}]}],
]) test(`reject malformed ${id}`, async () => {
  const {ModerationPolicyDraft} = await modulePromise;
  assert.throws(() => ModerationPolicyDraft.fromServer(value));
});
