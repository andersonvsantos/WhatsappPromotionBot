const assert = require('assert');
const { buildErrorPayload, formatErrorForLog } = require('../index');

const error = new Error('Falha de teste');
const payload = buildErrorPayload('Falha ao processar', error, { requestId: 'req-123' });

assert.strictEqual(payload.success, false);
assert.strictEqual(payload.message, 'Falha ao processar');
assert.strictEqual(payload.requestId, 'req-123');
assert.strictEqual(payload.error.message, 'Falha de teste');
assert.ok(payload.error.stack.includes('Error: Falha de teste'));

const logEntry = formatErrorForLog('teste', error, { requestId: 'req-123' });
assert.strictEqual(logEntry.context, 'teste');
assert.strictEqual(logEntry.requestId, 'req-123');
assert.strictEqual(logEntry.error.message, 'Falha de teste');

console.log('Testes OK');
