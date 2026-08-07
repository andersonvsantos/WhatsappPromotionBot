const assert = require('assert');
const { normalizeTargetGroupIds, mergeTargetGroupIds } = require('../index');

assert.deepStrictEqual(
    normalizeTargetGroupIds(['5511999999999@newsletter', ' 5511888888888@g.us ']),
    ['5511999999999@newsletter', '5511888888888@g.us']
);

assert.deepStrictEqual(
    normalizeTargetGroupIds('[5511999999999@newsletter, 5511888888888@g.us]'),
    ['5511999999999@newsletter', '5511888888888@g.us']
);

assert.deepStrictEqual(
    normalizeTargetGroupIds('5511999999999@newsletter;5511888888888@g.us'),
    ['5511999999999@newsletter', '5511888888888@g.us']
);

assert.deepStrictEqual(
    mergeTargetGroupIds(['5511999999999@g.us'], ['5511999999999@g.us', '5511888888888@newsletter']),
    ['5511999999999@g.us', '5511888888888@newsletter']
);

console.log('Testes de grupos OK');
