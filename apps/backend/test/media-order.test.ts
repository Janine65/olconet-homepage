import assert from 'node:assert/strict';
import { test } from 'node:test';
import { moveInput, orderToken } from '../src/media/media.order';

test('Kategorie-Sortierung verlangt gueltige ID, Position und aktuellen Token', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const token = orderToken([{ id, revision: 1 }]);
  const input = { category: 'SAMMY', assetId: id, position: 1, token };
  assert.equal(moveInput(input).position, 1);
  for (const patch of [
    { category: 'TRAVEL' }, { category: undefined }, { assetId: '../../x' },
    { position: 0 }, { position: 1.5 }, { position: '1' }, { position: 1000002 },
    { token: 'invalid' }, { unexpected: true },
  ]) assert.throws(() => moveInput({ ...input, ...patch }));
  assert.notEqual(token, orderToken([{ id, revision: 2 }]));
  assert.notEqual(orderToken([{ id: 'a', revision: 1 }, { id: 'b', revision: 1 }]),
    orderToken([{ id: 'b', revision: 1 }, { id: 'a', revision: 1 }]));
});
