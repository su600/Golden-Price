'use strict';

// Extract the rankingTeam array from a dongqiudi statTC response.
// Handles flat lists (Premier League / La Liga) and grouped structures (UCL).
// For UCL, returns only the league-phase standings (积分榜), ignoring the
// knockout bracket section (淘汰赛).
function extractDongqiudiRankings(data) {
  const d = data?.data ?? data;
  if (!d) return [];

  if (Array.isArray(d.rankingTeam) && d.rankingTeam.length) {
    return d.rankingTeam;
  }

  if (Array.isArray(d.groups)) {
    // Prefer the first group that contains a rankingTeam array and is NOT a
    // knockout / bracket section (淘汰赛, bracket, knockout).
    const isKnockout = (g) => {
      const label = (g.name || g.title || g.type || '').toLowerCase();
      return label.includes('淘汰') || label.includes('knockout') || label.includes('bracket');
    };

    const standingsGroup =
      d.groups.find((g) => Array.isArray(g.rankingTeam) && g.rankingTeam.length && !isKnockout(g)) ||
      d.groups.find((g) => Array.isArray(g.rankingTeam) && g.rankingTeam.length);

    if (standingsGroup) return standingsGroup.rankingTeam;
  }

  return [];
}

module.exports = { extractDongqiudiRankings };
