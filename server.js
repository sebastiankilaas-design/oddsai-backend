const express = require("express");
const cors = require("cors");
const app = express();
app.use(cors());
app.use(express.json());

const FOOTBALL_API_KEY = process.env.FOOTBALL_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const LEAGUE_IDS = {
  "Premier League": 39, "La Liga": 140, "Bundesliga": 78,
  "Serie A": 135, "Eliteserien": 103, "Champions League": 2,
};
const LEAGUE_SEASON = {
  "Premier League": 2025, "La Liga": 2025, "Bundesliga": 2025,
  "Serie A": 2025, "Eliteserien": 2026, "Champions League": 2025,
};

// Real Eliteserien 2026 fixtures from NFF/Fotmob (week of Apr 13-20)
const ELITESERIEN_FIXTURES = [
  { id: 9001, homeId: 1380, awayId: 7944, home: "Rosenborg", away: "Sarpsborg 08", time: "Søn 19.04 · 19:15", venue: "Lerkendal Stadion", season: 2026, leagueId: 103,
    homeLogo: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/Rosenborg_BK_logo.svg/200px-Rosenborg_BK_logo.svg.png",
    awayLogo: "https://upload.wikimedia.org/wikipedia/en/thumb/5/53/Sarpsborg_08_FF_logo.svg/200px-Sarpsborg_08_FF_logo.svg.png" },
  { id: 9002, homeId: 297, awayId: 10739, home: "Brann", away: "Sandefjord", time: "Søn 12.04 · 19:15", venue: "Brann Stadion", season: 2026, leagueId: 103,
    homeLogo: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c6/SK_Brann_logo.svg/200px-SK_Brann_logo.svg.png",
    awayLogo: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Sandefjord_Fotball_logo.svg/200px-Sandefjord_Fotball_logo.svg.png" },
  { id: 9003, homeId: 7944, awayId: 314, home: "Sarpsborg 08", away: "Bodø/Glimt", time: "Ons 15.04 · 19:00", venue: "Sarpsborg Stadion", season: 2026, leagueId: 103,
    homeLogo: "https://upload.wikimedia.org/wikipedia/en/thumb/5/53/Sarpsborg_08_FF_logo.svg/200px-Sarpsborg_08_FF_logo.svg.png",
    awayLogo: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7f/FK_Bod%C3%B8_Glimt_logo.svg/200px-FK_Bod%C3%B8_Glimt_logo.svg.png" },
  { id: 9004, homeId: 314, awayId: 3483, home: "Bodø/Glimt", away: "Aalesund", time: "Lør 18.04 · 18:00", venue: "Aspmyra Stadion", season: 2026, leagueId: 103,
    homeLogo: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7f/FK_Bod%C3%B8_Glimt_logo.svg/200px-FK_Bod%C3%B8_Glimt_logo.svg.png",
    awayLogo: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a6/Aalesunds_FK_logo.svg/200px-Aalesunds_FK_logo.svg.png" },
  { id: 9005, homeId: 273, awayId: 306, home: "Viking", away: "Brann", time: "Lør 18.04 · 18:00", venue: "Lyse Arena", season: 2026, leagueId: 103,
    homeLogo: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c6/Viking_FK_logo.svg/200px-Viking_FK_logo.svg.png",
    awayLogo: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c6/SK_Brann_logo.svg/200px-SK_Brann_logo.svg.png" },
];

app.get("/", (req, res) => res.json({ status: "OddsAI kjører!" }));

async function footballAPI(path) {
  const res = await fetch(`https://v3.football.api-sports.io${path}`, {
    headers: { "x-apisports-key": FOOTBALL_API_KEY }
  });
  return res.json();
}

app.get("/fixtures", async (req, res) => {
  const { league } = req.query;
  const leagueId = LEAGUE_IDS[league];
  const season = LEAGUE_SEASON[league];
  if (!leagueId) return res.status(400).json({ error: "Ukjent liga" });

  // Always use hardcoded for Eliteserien (API-Football lacks 2026 season data)
  if (league === "Eliteserien") return res.json(ELITESERIEN_FIXTURES);

  try {
    let data = await footballAPI(`/fixtures?league=${leagueId}&season=${season}&next=5`);
    let fixtures = data.response || [];
    if (!fixtures.length) {
      data = await footballAPI(`/fixtures?league=${leagueId}&next=5`);
      fixtures = data.response || [];
    }
    if (!fixtures.length) return res.json([]);

    const mapped = fixtures.slice(0, 5).map((f) => {
      const date = new Date(f.fixture.date);
      const day = date.toLocaleDateString("no-NO", { weekday: "short" });
      const dd = String(date.getDate()).padStart(2, "0");
      const mm = String(date.getMonth() + 1).padStart(2, "0");
      const hh = String(date.getHours()).padStart(2, "0");
      const min = String(date.getMinutes()).padStart(2, "0");
      return {
        id: f.fixture.id, homeId: f.teams.home.id, awayId: f.teams.away.id,
        home: f.teams.home.name, away: f.teams.away.name,
        homeLogo: f.teams.home.logo, awayLogo: f.teams.away.logo,
        time: `${day} ${dd}.${mm} · ${hh}:${min}`,
        venue: f.fixture.venue?.name || "",
        leagueId: f.league.id, season: f.league.season,
      };
    });
    res.json(mapped);
  } catch (err) {
    res.status(500).json({ error: "Kunne ikke hente kamper: " + err.message });
  }
});

async function getTeamForm(teamId, leagueId, season) {
  try {
    const data = await footballAPI(`/teams/statistics?team=${teamId}&league=${leagueId}&season=${season}`);
    const s = data.response;
    if (!s) return null;
    const form = (s.form || "").slice(-5);
    const played = Math.max(s.fixtures?.played?.total || 1, 1);
    const goalsFor = s.goals?.for?.total?.total || 0;
    const goalsAgainst = s.goals?.against?.total?.total || 0;
    return { form: form || "N/A", goalsPerGame: (goalsFor / played).toFixed(1), goalsAgainstPerGame: (goalsAgainst / played).toFixed(1) };
  } catch { return null; }
}

async function getH2H(homeId, awayId) {
  try {
    const data = await footballAPI(`/fixtures/headtohead?h2h=${homeId}-${awayId}&last=5`);
    const matches = data.response || [];
    if (!matches.length) return "Ingen H2H-data tilgjengelig";
    let hw = 0, aw = 0, d = 0;
    matches.forEach((m) => {
      const hg = m.score.fulltime.home, ag = m.score.fulltime.away;
      if (m.teams.home.id === homeId) { if (hg > ag) hw++; else if (hg < ag) aw++; else d++; }
      else { if (ag > hg) hw++; else if (ag < hg) aw++; else d++; }
    });
    return `Siste ${matches.length} møter: Hjemme ${hw}W / ${d}D / ${aw}W borte`;
  } catch { return "H2H ikke tilgjengelig"; }
}

async function getInjuries(fixtureId, teamId) {
  if (fixtureId > 9000) return "Ikke tilgjengelig via API"; // hardcoded fixtures
  try {
    const data = await footballAPI(`/injuries?fixture=${fixtureId}`);
    const list = (data.response || []).filter((p) => p.team.id === teamId);
    if (!list.length) return "Ingen kjente skader";
    return list.slice(0, 3).map((p) => `${p.player.name} (${p.player.reason})`).join(", ");
  } catch { return "Ikke tilgjengelig"; }
}

app.post("/analyze", async (req, res) => {
  const { home, away, league, odds, time, market, fixtureId, homeId, awayId, leagueId, season } = req.body;
  if (!home || !away || !league || !odds || !market) return res.status(400).json({ error: "Mangler felter" });

  const lid = leagueId || LEAGUE_IDS[league];
  const seas = season || LEAGUE_SEASON[league];
  let homeForm = null, awayForm = null, h2h = "Ikke hentet", homeInj = "Ikke tilgjengelig", awayInj = "Ikke tilgjengelig";

  if (homeId && awayId && lid && seas) {
    [homeForm, awayForm, h2h, homeInj, awayInj] = await Promise.all([
      getTeamForm(homeId, lid, seas),
      getTeamForm(awayId, lid, seas),
      getH2H(homeId, awayId),
      getInjuries(fixtureId, homeId),
      getInjuries(fixtureId, awayId),
    ]);
  }

  const homeFormStr = homeForm ? `Form siste 5: ${homeForm.form} | Snitt mål: ${homeForm.goalsPerGame} | Snitt sluppet inn: ${homeForm.goalsAgainstPerGame}` : "Ikke tilgjengelig";
  const awayFormStr = awayForm ? `Form siste 5: ${awayForm.form} | Snitt mål: ${awayForm.goalsPerGame} | Snitt sluppet inn: ${awayForm.goalsAgainstPerGame}` : "Ikke tilgjengelig";

  const prompt = `Du er verdens beste fotballanalytiker og betting-ekspert. Analyser kampen grundig for markedet "${market}".

KAMP: ${home} vs ${away} | LIGA: ${league} | TIDSPUNKT: ${time}
ODDS: Hjemme ${odds[0]} | Uavgjort ${odds[1]} | Borte ${odds[2]}

STATISTIKK:
${home} form: ${homeFormStr}
${away} form: ${awayFormStr}
H2H: ${h2h}
Skader ${home}: ${homeInj}
Skader ${away}: ${awayInj}

Vurder: form/momentum, rotasjonsrisiko (B-lag?), skader, hjemmebane-fordel, tabellsituasjon/motivasjon, taktikk, H2H-psykologi, oddsverdi.

Svar KUN med JSON (ingen markdown):
{
  "tip": "Konkret tips",
  "verdict": "STERK eller FORSIKTIG eller UNNGÅ",
  "confidence": 74,
  "analysis": "3-4 setninger helhetlig analyse på norsk",
  "form_home": "Vurdering av ${home}",
  "form_away": "Vurdering av ${away}",
  "injuries": "Skadeoppsummering begge lag",
  "rotation_risk": "Lav/Middels/Høy — begrunnelse",
  "h2h": "Historikk-oppsummering",
  "value": "Ja/Nei — begrunnelse"
}`;

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: prompt }], max_tokens: 1000, temperature: 0.5 }),
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    const text = data.choices[0].message.content.replace(/```json|```/g, "").trim();
    res.json(JSON.parse(text));
  } catch (err) {
    res.status(500).json({ error: "AI-analyse feilet: " + err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`OddsAI kjører på port ${PORT}`));
