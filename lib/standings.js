'use strict';

// Parse league standings from the HTML page returned by m.dongqiudi.com/statTC/{id}/rankingTeam.
// The page embeds window.__INITIAL_STATE__ JSON which contains statListStore.statListFull[].
// Each element of statListFull has a "template" field; we pick the one with
// template === "team_point_ranking_regular" whose content.data[] holds standings rows.
// Each row has string fields: rank, team_name, points, matches_total, matches_won,
// matches_draw, matches_lost, goals_pro, goals_against.

// Walk through a JSON string starting at `start` and return the index just after
// the first balanced top-level value (object or array), or -1 if no balanced
// end is found (e.g. the input is truncated or malformed).
function _jsonEnd(str, start) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < str.length; i++) {
    const c = str[i];
    if (esc) { esc = false; continue; }
    if (c === '\\' && inStr) { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{' || c === '[') {
      depth++;
    } else if (c === '}' || c === ']') {
      if (depth > 0 && --depth === 0) return i + 1;
    }
  }
  return -1;
}

function _extractInitialState(html) {
  if (!html || typeof html !== 'string') return null;
  const marker = 'window.__INITIAL_STATE__=';
  const start = html.indexOf(marker);
  if (start === -1) return null;
  const jsonStart = start + marker.length;
  const jsonEnd = _jsonEnd(html, jsonStart);
  if (jsonEnd === -1) return null;
  try {
    return JSON.parse(html.slice(jsonStart, jsonEnd));
  } catch (_) {
    return null;
  }
}

function parseStandingsFromHtml(html) {
  const state = _extractInitialState(html);
  if (!state) return [];

  const statListFull = state?.statListStore?.statListFull;
  if (!Array.isArray(statListFull)) return [];

  const regularTemplate = statListFull.find(
    (t) => t?.template === 'team_point_ranking_regular' && Array.isArray(t?.content?.data),
  );
  if (!regularTemplate) return [];

  return regularTemplate.content.data;
}

// Returns all group standings as an array of { group: string, data: [] }.
// For non-group leagues (PL, LaLiga) there will be one element with group=''.
// For UCL group stage there will be one element per group.
function parseAllStandingsFromHtml(html) {
  const state = _extractInitialState(html);
  if (!state) return [];

  const statListFull = state?.statListStore?.statListFull;
  if (!Array.isArray(statListFull)) return [];

  const templates = statListFull.filter(
    (t) => t?.template === 'team_point_ranking_regular' &&
           Array.isArray(t?.content?.data) &&
           t.content.data.length > 0,
  );
  if (!templates.length) return [];

  return templates.map((t) => ({
    group: t?.content?.title || t?.content?.group_name || t?.name || '',
    data:  t.content.data,
  }));
}

module.exports = { parseStandingsFromHtml, parseAllStandingsFromHtml };
