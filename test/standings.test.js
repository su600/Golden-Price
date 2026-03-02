'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractDongqiudiRankings } = require('../lib/standings');

test('returns empty array for null input', () => {
  assert.deepEqual(extractDongqiudiRankings(null), []);
});

test('returns empty array for empty object', () => {
  assert.deepEqual(extractDongqiudiRankings({}), []);
});

test('flat rankingTeam array (Premier League / La Liga format)', () => {
  const data = {
    code: 0,
    data: { rankingTeam: [{ rank: 1, team: { name_zh: '曼城' } }, { rank: 2, team: { name_zh: '阿森纳' } }] },
  };
  const result = extractDongqiudiRankings(data);
  assert.equal(result.length, 2);
  assert.equal(result[0].team.name_zh, '曼城');
});

test('flat rankingTeam at root level (no data wrapper)', () => {
  const data = { rankingTeam: [{ rank: 1 }] };
  const result = extractDongqiudiRankings(data);
  assert.equal(result.length, 1);
});

test('grouped UCL response: skips knockout group and returns standings group', () => {
  const data = {
    code: 0,
    data: {
      groups: [
        { name: '淘汰赛', rankingTeam: [{ rank: 1 }] },
        { name: '联赛阶段', rankingTeam: [{ rank: 1 }, { rank: 2 }, { rank: 3 }] },
      ],
    },
  };
  const result = extractDongqiudiRankings(data);
  assert.equal(result.length, 3);
});

test('grouped UCL response: skips "knockout" and "bracket" labels', () => {
  const data = {
    data: {
      groups: [
        { name: 'knockout round', rankingTeam: [{ rank: 1 }] },
        { name: 'bracket', rankingTeam: [{ rank: 1 }] },
        { name: 'league phase', rankingTeam: [{ rank: 1 }, { rank: 2 }] },
      ],
    },
  };
  const result = extractDongqiudiRankings(data);
  assert.equal(result.length, 2);
});

test('all groups are knockout sections: falls back to first group with rankingTeam', () => {
  const data = {
    data: {
      groups: [{ name: 'knockout', rankingTeam: [{ rank: 1 }, { rank: 2 }] }],
    },
  };
  const result = extractDongqiudiRankings(data);
  assert.equal(result.length, 2);
});

test('groups array present but empty rankingTeam in each group: returns empty', () => {
  const data = { data: { groups: [{ name: '联赛阶段', rankingTeam: [] }] } };
  assert.deepEqual(extractDongqiudiRankings(data), []);
});
