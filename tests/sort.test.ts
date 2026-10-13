import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sortWith, type SortMethod } from '../src/lib/sort.ts';
import data from '../public/data/municipios-2026.json';

const methods: SortMethod[] = ['merge', 'quick', 'heap'];

test('os algoritmos produzem a mesma ordem em casos comuns e extremos', () => {
  const cases = [
    [] as number[],
    [1],
    [8, 3, 3, 9, 1, 0, 2, -1],
    Array.from({ length: 1000 }, (_, index) => index),
    Array.from({ length: 1000 }, (_, index) => 999 - index),
    Array.from({ length: 1000 }, (_, index) => (index * 101) % 37),
  ];
  for (const input of cases) {
    const original = [...input];
    const expected = [...input].sort((a, b) => a - b);
    for (const method of methods) {
      const result = sortWith(input, (a, b) => a - b, method);
      assert.deepEqual(result.items, expected, method);
      assert.deepEqual(input, original, 'a entrada não deve ser alterada');
    }
  }
});

test('Merge Sort mantém a ordem original quando há empate', () => {
  const input = [
    { key: 2, index: 0 }, { key: 1, index: 1 },
    { key: 2, index: 2 }, { key: 1, index: 3 },
  ];
  const result = sortWith(input, (a, b) => a.key - b.key, 'merge');
  assert.deepEqual(result.items.map((item) => item.index), [1, 3, 0, 2]);
});

test('o snapshot cobre municípios brasileiros e fecha os totais', () => {
  assert.equal(data.turno, 1);
  assert.equal(data.cargo, 'Presidente');
  assert.equal(data.municipios.length, 5571);
  assert.equal(data.municipios.some((city) => city.uf === 'ZZ'), false);
  assert.equal(data.municipios.reduce((sum, city) => sum + city.votosNominais, 0), data.votosNominais);
  assert.equal(data.candidatos.reduce((sum, candidate) => sum + candidate.votosNoRecorte, 0), data.votosNominais);
});
