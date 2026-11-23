import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, resolveTarget, norm } from '../js/commands.js';
import { classCandidates } from '../js/lang-el.js';

const ctx = {
  candidates: [
    ...classCandidates(),
    { id: 'c1', kind: 'custom', label: 'κλειδιά', names: ['κλειδιά'] },
    { id: 'c2', kind: 'custom', label: 'πορτοφόλι', names: ['πορτοφόλι'] },
    { id: 'p1', kind: 'person', label: 'Μαρία', names: ['Μαρία'] },
    { id: 'pl1', kind: 'place', label: 'σπίτι', names: ['σπίτι'] }
  ]
};
const P = s => parseCommand(s, ctx);

test('norm', () => assert.equal(norm('Κλειδιά, ΠΟΥ;'), 'κλειδια που'));
test('βρες κλειδιά', () => { const r = P('Βρες τα κλειδιά'); assert.equal(r.intent, 'FIND'); assert.equal(r.target.id, 'c1'); });
test('ψάξε κινητό', () => { const r = P('ψάξε το κινητό μου'); assert.equal(r.intent, 'FIND'); assert.equal(r.target.id, 'cell phone'); });
test('ψάχνω τηλεκοντρόλ', () => { const r = P('ψάχνω το τηλεκοντρόλ'); assert.equal(r.intent, 'FIND'); assert.equal(r.target.id, 'remote'); });
test('πού άφησα το πορτοφόλι', () => { const r = P('Πού άφησα το πορτοφόλι'); assert.equal(r.intent, 'WHERE'); assert.equal(r.target.id, 'c2'); });
test('πού είναι το σπίτι', () => assert.equal(P('πού είναι το σπίτι').intent, 'PLACE_INFO'));
test('οδήγησέ με στο σπίτι', () => { const r = P('οδήγησέ με στο σπίτι'); assert.equal(r.intent, 'NAVIGATE'); assert.equal(r.target.id, 'pl1'); });
test('τι βλέπεις', () => assert.equal(P('τι βλέπεις;').intent, 'DESCRIBE'));
test('σάρωση', () => assert.equal(P('κάνε σάρωση').intent, 'SCAN'));
test('στοπ', () => { assert.equal(P('σταμάτα').intent, 'STOP'); assert.equal(P('στοπ').intent, 'STOP'); });
test('μην λες καρέκλες', () => { const r = P('μην λες καρέκλες'); assert.equal(r.intent, 'MUTE_OBJECT'); assert.equal(r.target.id, 'chair'); });
test('μην μιλάς', () => assert.equal(P('μην μιλάς').intent, 'MUTE_ALL'));
test('πιο δυνατά', () => assert.equal(P('πιο δυνατά').intent, 'VOLUME_UP'));
test('πιο σιγά', () => assert.equal(P('πιο σιγά').intent, 'VOLUME_DOWN'));
test('ένταση 7', () => { const r = P('ένταση 7'); assert.equal(r.intent, 'VOLUME_SET'); assert.equal(r.value, 7); });
test('ένταση πέντε', () => { const r = P('ένταση πέντε'); assert.equal(r.intent, 'VOLUME_SET'); assert.equal(r.value, 5); });
test('πες τα αυτοκίνητα πιο δυνατά', () => { const r = P('πες τα αυτοκίνητα πιο δυνατά'); assert.equal(r.intent, 'VOLUME_OBJECT'); assert.equal(r.target.id, 'car'); assert.equal(r.dir, 'up'); });
test('λέγε ξανά τις καρέκλες', () => { const r = P('λέγε ξανά τις καρέκλες'); assert.equal(r.intent, 'UNMUTE_OBJECT'); assert.equal(r.target.id, 'chair'); });
test('μάθε αυτό ως κλειδιά', () => { const r = P('μάθε αυτό ως κλειδιά'); assert.equal(r.intent, 'LEARN_OBJECT'); assert.equal(r.name, 'κλειδιά'); });
test('αυτό είναι το πορτοφόλι μου', () => { const r = P('αυτό είναι το πορτοφόλι μου'); assert.equal(r.intent, 'LEARN_OBJECT'); assert.match(r.name, /πορτοφόλι/); });
test('αυτός είναι ο Γιάννης', () => { const r = P('Αυτός είναι ο Γιάννης'); assert.equal(r.intent, 'LEARN_PERSON'); assert.equal(r.name, 'Γιάννης'); });
test('αυτή είναι η Μαρία', () => { const r = P('αυτή είναι η Μαρία'); assert.equal(r.intent, 'LEARN_PERSON'); assert.equal(r.existing.id, 'p1'); });
test('θυμήσου αυτό το μέρος ως γραφείο', () => { const r = P('θυμήσου αυτό το μέρος ως γραφείο'); assert.equal(r.intent, 'SAVE_PLACE'); assert.equal(r.name, 'γραφείο'); });
test('ξέχασε τα κλειδιά', () => { const r = P('ξέχασε τα κλειδιά'); assert.equal(r.intent, 'FORGET'); assert.equal(r.target.id, 'c1'); });
test('ξέχασε όλα', () => assert.equal(P('ξέχασε όλα').intent, 'FORGET_ALL'));
test('φακός', () => {
  assert.deepEqual(P('άναψε το φακό'), { intent: 'TORCH', value: true });
  assert.deepEqual(P('σβήσε το φακό'), { intent: 'TORCH', value: false });
  assert.deepEqual(P('αυτόματο φως'), { intent: 'TORCH_AUTO', value: true });
});
test('διάβασε', () => assert.equal(P('διάβασε').intent, 'READ_TEXT'));
test('βοήθεια', () => assert.equal(P('βοήθεια').intent, 'HELP'));
test('άγνωστο', () => assert.equal(P('μπλα μπλα μπλα').intent, 'UNKNOWN'));
test('resolve με λάθος ASR', () => assert.equal(resolveTarget('κλιδια', ctx.candidates).id, 'c1'));
