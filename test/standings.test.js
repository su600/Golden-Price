'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseStandingsFromHtml, parseAllStandingsFromHtml } = require('../lib/standings');

// ── helpers ───────────────────────────────────────────────────
function makeHtml(stateObj) {
  return `<html><script>window.__INITIAL_STATE__=${JSON.stringify(stateObj)};</script></html>`;
}

function plEntry(rank, teamName, pts) {
  return {
    rank: String(rank),
    team_name: teamName,
    team_id: '1',
    points: String(pts),
    matches_total: '10',
    matches_won: '5',
    matches_draw: '2',
    matches_lost: '3',
    goals_pro: '15',
    goals_against: '10',
  };
}

// ── tests ─────────────────────────────────────────────────────
test('returns empty array for null/empty input', () => {
  assert.deepEqual(parseStandingsFromHtml(null), []);
  assert.deepEqual(parseStandingsFromHtml(''), []);
  assert.deepEqual(parseStandingsFromHtml('<html></html>'), []);
});

test('returns empty array when __INITIAL_STATE__ is missing', () => {
  assert.deepEqual(parseStandingsFromHtml('<html><body>no state here</body></html>'), []);
});

test('returns empty array when statListStore is absent', () => {
  const html = makeHtml({ nodata: false });
  assert.deepEqual(parseStandingsFromHtml(html), []);
});

test('returns empty array when statListFull has no team_point_ranking_regular template', () => {
  const html = makeHtml({
    statListStore: {
      statListFull: [
        { template: 'team_point_ranking_knockout', content: { data: [{ rank: '1' }] } },
      ],
    },
  });
  assert.deepEqual(parseStandingsFromHtml(html), []);
});

test('Premier League / La Liga: extracts standings from team_point_ranking_regular template', () => {
  const data = [plEntry(1, '阿森纳', 64), plEntry(2, '曼城', 59)];
  const html = makeHtml({
    statListStore: {
      statListFull: [
        { template: 'team_point_ranking_regular', content: { data } },
      ],
    },
  });
  const result = parseStandingsFromHtml(html);
  assert.equal(result.length, 2);
  assert.equal(result[0].team_name, '阿森纳');
  assert.equal(result[1].team_name, '曼城');
});

test('UCL: skips knockout templates and returns team_point_ranking_regular', () => {
  const data = [plEntry(1, '利物浦', 24), plEntry(2, '拜仁慕尼黑', 21)];
  const html = makeHtml({
    statListStore: {
      statListFull: [
        { template: 'team_point_ranking_knockout', content: { data: [{ TeamA: {}, TeamB: {} }] } },
        { template: 'team_point_ranking_aggregate', content: { data: [] } },
        { template: 'team_point_ranking_regular', content: { data } },
      ],
    },
  });
  const result = parseStandingsFromHtml(html);
  assert.equal(result.length, 2);
  assert.equal(result[0].team_name, '利物浦');
});

test('returns empty array when template is present but content.data is empty', () => {
  const html = makeHtml({
    statListStore: {
      statListFull: [
        { template: 'team_point_ranking_regular', content: { data: [] } },
      ],
    },
  });
  assert.deepEqual(parseStandingsFromHtml(html), []);
});

test('handles trailing JavaScript after __INITIAL_STATE__ JSON', () => {
  const data = [plEntry(1, '阿森纳', 64), plEntry(2, '曼城', 59)];
  const state = {
    statListStore: {
      statListFull: [
        { template: 'team_point_ranking_regular', content: { data } },
      ],
    },
  };
  const html =
    `<html><script>window.__INITIAL_STATE__=${JSON.stringify(state)};` +
    `(function(){console.log('after json');})();</script></html>`;
  const result = parseStandingsFromHtml(html);
  assert.equal(result.length, 2);
  assert.equal(result[0].team_name, '阿森纳');
  assert.equal(result[1].team_name, '曼城');
});

test('returns empty array when __INITIAL_STATE__ JSON is malformed', () => {
  const html = '<html><script>window.__INITIAL_STATE__={broken json;</script></html>';
  assert.deepEqual(parseStandingsFromHtml(html), []);
});

// ── parseAllStandingsFromHtml tests ───────────────────────────

test('parseAllStandingsFromHtml: returns empty array for null/empty input', () => {
  assert.deepEqual(parseAllStandingsFromHtml(null), []);
  assert.deepEqual(parseAllStandingsFromHtml(''), []);
});

test('parseAllStandingsFromHtml: returns single group for non-grouped league (PL/LaLiga)', () => {
  const data = [plEntry(1, '阿森纳', 64), plEntry(2, '曼城', 59)];
  const html = makeHtml({
    statListStore: {
      statListFull: [
        { template: 'team_point_ranking_regular', content: { data } },
      ],
    },
  });
  const result = parseAllStandingsFromHtml(html);
  assert.equal(result.length, 1);
  assert.equal(result[0].group, '');
  assert.equal(result[0].data.length, 2);
  assert.equal(result[0].data[0].team_name, '阿森纳');
});

test('parseAllStandingsFromHtml: returns multiple groups for UCL group stage', () => {
  const groupA = [plEntry(1, '利物浦', 12), plEntry(2, '阿贾克斯', 9)];
  const groupB = [plEntry(1, '拜仁慕尼黑', 15), plEntry(2, '巴塞罗那', 9)];
  const html = makeHtml({
    statListStore: {
      statListFull: [
        { template: 'team_point_ranking_regular', content: { data: groupA, title: 'A组' } },
        { template: 'team_point_ranking_regular', content: { data: groupB, title: 'B组' } },
      ],
    },
  });
  const result = parseAllStandingsFromHtml(html);
  assert.equal(result.length, 2);
  assert.equal(result[0].group, 'A组');
  assert.equal(result[0].data[0].team_name, '利物浦');
  assert.equal(result[1].group, 'B组');
  assert.equal(result[1].data[0].team_name, '拜仁慕尼黑');
});

test('parseAllStandingsFromHtml: skips templates with empty data arrays', () => {
  const data = [plEntry(1, '皇马', 20)];
  const html = makeHtml({
    statListStore: {
      statListFull: [
        { template: 'team_point_ranking_regular', content: { data: [], title: '空组' } },
        { template: 'team_point_ranking_regular', content: { data, title: 'A组' } },
      ],
    },
  });
  const result = parseAllStandingsFromHtml(html);
  assert.equal(result.length, 1);
  assert.equal(result[0].group, 'A组');
});
