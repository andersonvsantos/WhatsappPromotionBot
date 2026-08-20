const assert = require('assert');
const { isChatTargetCompatible, isNewsletterTarget, isMessageSendConfirmed } = require('../index');

assert.strictEqual(isChatTargetCompatible('5511999999999@g.us'), true);
assert.strictEqual(isChatTargetCompatible('5511999999999@broadcast'), true);
assert.strictEqual(isChatTargetCompatible('5511999999999@newsletter'), true);
assert.strictEqual(isChatTargetCompatible('5511999999999@c.us'), false);
assert.strictEqual(isChatTargetCompatible({ isGroup: true, isBroadcast: false }), true);
assert.strictEqual(isChatTargetCompatible({ isGroup: false, isBroadcast: true }), true);
assert.strictEqual(isChatTargetCompatible({ isGroup: false, isChannel: true }), true);
assert.strictEqual(isChatTargetCompatible({ isGroup: false, isBroadcast: false }), false);
assert.strictEqual(isNewsletterTarget('120363411968964190@newsletter'), true);
assert.strictEqual(isNewsletterTarget('120363411968964190@g.us'), false);
assert.strictEqual(isMessageSendConfirmed('120363411968964190@newsletter', { _data: { serverId: '123' } }), true);
assert.strictEqual(isMessageSendConfirmed('120363411968964190@newsletter', { _data: {} }), false);
assert.strictEqual(isMessageSendConfirmed('120363411968964190@g.us', {}), true);

console.log('Teste de chats compatíveis OK');
