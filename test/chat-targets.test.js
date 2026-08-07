const assert = require('assert');
const { isChatTargetCompatible } = require('../index');

assert.strictEqual(isChatTargetCompatible('5511999999999@g.us'), true);
assert.strictEqual(isChatTargetCompatible('5511999999999@broadcast'), true);
assert.strictEqual(isChatTargetCompatible('5511999999999@newsletter'), true);
assert.strictEqual(isChatTargetCompatible('5511999999999@c.us'), false);
assert.strictEqual(isChatTargetCompatible({ isGroup: true, isBroadcast: false }), true);
assert.strictEqual(isChatTargetCompatible({ isGroup: false, isBroadcast: true }), true);
assert.strictEqual(isChatTargetCompatible({ isGroup: false, isChannel: true }), true);
assert.strictEqual(isChatTargetCompatible({ isGroup: false, isBroadcast: false }), false);

console.log('Teste de chats compatíveis OK');
