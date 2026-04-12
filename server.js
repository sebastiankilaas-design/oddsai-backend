const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const FOOTBALL_API_KEY = process.env.FOOTBALL_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const LEAGUE_IDS = {
  "Premier League": 39,
  "La Liga": 140,
  "Bundesliga": 78,
  "Serie A": 135,
  "Eliteserien": 103,
  "Champions League": 2,
};

// Current seasons as of April 2026
const LEAGUE_SEASON = {
  "Premier League": 2025,
  "La Liga": 2025,
  "Bundesliga": 2025,
  "Serie A": 2025,
  "Eliteserien": 2026,
  "Champions League": 2025,
};

// Real Eliteserien 2026 upcoming fixtures as fallback (from soccerway/fotmob)
const ELITESERIEN_FALLBACK = [
  { id: 1001, homeId: 1380, awayId: 7944, home: "Rosenborg", away: "Sarpsborg 08", homeLogo: "https://media.api-sports.io/football/teams/1380.png", awayLogo: "https://media.api-sports.io/football/teams/7944.png", time: "Lør 18:00", venue: "Lerkendal Stadion", leagueId: 103, season: 2026 },
  { id: 1002, homeId: 273, awayId: 306, home: "Fredrikstad", away: "Vålerenga", homeLogo: "https://media.api-sports.io/football/teams/273.png", awayLogo: "https://media.api-sports.io/football/teams/306.png", time: "Søn 18:00", venue: "Fredrikstad Stadion", leagueId: 103, season: 2026 },
  { id: 1003, homeId: 1382, awayId: 10788, home: "Molde", away: "Ham-Kam", homeLogo: "https://media.api-sports.io/football/teams/1382.png", awayLogo: "https://media.api-sports.io/football/teams/10788.png", time: "Søn 20:00", venue: "Aker Stadion", leagueId: 103, season: 2026 },
  { id: 1004, homeId: 3483, awayId: 7946, home: "Aalesund", away: "KFUM Oslo", homeLogo: "https://media.api-sports.io/football/teams/3483.png", awayLogo: "https://media.api-sports.io/football/teams/7946.png", time: "Søn 18:00", venue: "Color Line Stadion", leagueId: 103, season: 2026 },
  { id: 1005, homeId: 297, awayId: 10739, home: "Brann", away: "Sandefjord", homeLogo: "https://media.api-sports.io/football/teams/297.png", awayLogo: "https://media.api-sports.io/football/teams/10739.png", time: "Søn 18:00", venue: "Brann Stadion", leagueId: 103, season: 2026 },
];

app.get("/", (req, res) => res.json({ status: "OddsAI backend kjører!" }));

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

  try {
    // Try multiple approaches
    let fixtures = [];

    // Attempt 1: next=5 with correct season
    let data = await footballAPI(`/fixtures?league=${leagueId}&season=${season}&next=5`);
    fixtures = data.response || [];

    // Attempt 2: just next=5 (API auto-detects season)
    if (!fixtures.length) {
      data = await footballAPI(`/fixtures?league=${leagueId}&next=5`);
      fixtures = data.response || [];
    }

    // Attempt 3: from/to date range
    if (!fixtures.length) {
      const today = new Date().toISOString().split("T")[0];
      const nextMonth = new Date(Date.now() + 30 * 864e5).toISOString().split("T")[0];
      data = await footballAPI(`/fixtures?league=${leagueId}&season=${season}&from=${today}&to=${nextMonth}`);
      fixtures = data.response || [];
    }

    // Fallback for Eliteserien: use hardcoded real fixtures
    if (!fixtures.length && league === "Eliteserien") {
      return res.json(ELITESERIEN_FALLBACK);
    }

    if (!fixtures.length) return res.json([]);

    const mapped = fixtures.slice(0, 5).map((f) => {
      const date = new Date(f.fixture.date);
      const dayName = date.toLocaleDateString("no-NO", { weekday: "short" });
      const time = date.toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit" });
      return {
        id: f.fixture.id,
        homeId: f.teams.home.id,
        awayId: f.teams.away.id,
        home: f.teams.home.name,
        away: f.teams.away.name,
        homeLogo: f.teams.home.logo,
        awayLogo: f.teams.away.logo,
        time: `${dayName} ${time}`,
        venue: f.fixture.venue?.name || "",
        leagueId: f.league.id,
        season: f.league.season,
      };
    });

    res.json(mapped);
  } catch (err) {
    // On any error, return fallback for Eliteserien
    if (league === "Eliteserien") return res.json(ELITESERIEN_FALLBACK);
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
    return {
      form: form || "N/A",
      goalsPerGame: (goalsFor / played).toFixed(1),
      goalsAgainstPerGame: (goalsAgainst / played).toFixed(1),
    };
  } catch { return null; }
}

async function getH2H(homeId, awayId) {
  try {
    const data = await footballAPI(`/fixtures/headtohead?h2h=${homeId}-${awayId}&last=5`);
    const matches = data.response || [];
    if (!matches.length) return "Ingen H2H-data tilgjengelig";
    let hw = 0, aw = 0, d = 0;
    matches.forEach((m) => {
      const hg = m.score.fulltime.home;
      const ag = m.score.fulltime.away;
      if (m.teams.home.id === homeId) {
        if (hg > ag) hw++; else if (hg < ag) aw++; else d++;
      } else {
        if (ag > hg) hw++; else if (ag < hg) aw++; else d++;
      }
    });
    return `Siste ${matches.length} møter: Hjemme ${hw}W / ${d}D / ${aw}W borte`;
  } catch { return "H2H ikke tilgjengelig"; }
}

async function getInjuries(fixtureId, teamId) {
  try {
    const data = await footballAPI(`/injuries?fixture=${fixtureId}`);
    const list = (data.response || []).filter((p) => p.team.id === teamId);
    if (!list.length) return "Ingen kjente skader";
    return list.slice(0, 3).map((p) => `${p.player.name} (${p.player.reason})`).join(", ");
  } catch { return "Ikke tilgjengelig"; }
}

app.post("/analyze", async (req, res) => {
  const { home, away, league, odds, time, market, fixtureId, homeId, awayId, leagueId, season } = req.body;
  if (!home || !away || !league || !odds || !market) {
    return res.status(400).json({ error: "Mangler felter" });
  }

  let homeForm = null, awayForm = null, h2h = "Ikke hentet";
  let homeInj = "Ikke tilgjengelig", awayInj = "Ikke tilgjengelig";

  const lid = leagueId || LEAGUE_IDS[league];
  const seas = season || LEAGUE_SEASON[league];

  if (homeId && awayId && lid && seas) {
    [homeForm, awayForm, h2h, homeInj, awayInj] = await Promise.all([
      getTeamForm(homeId, lid, seas),
      getTeamForm(awayId, lid, seas),
      getH2H(homeId, awayId),
      fixtureId > 9999 ? Promise.resolve("Ingen kjente skader") : getInjuries(fixtureId, homeId),
      fixtureId > 9999 ? Promise.resolve("Ingen kjente skader") : getInjuries(fixtureId, awayId),
    ]);
  }

  const homeFormStr = homeForm
    ? `Form siste 5: ${homeForm.form} | Snitt mål: ${homeForm.goalsPerGame} | Snitt sluppet inn: ${homeForm.goalsAgainstPerGame}`
    : "Ingen formdata — vurder basert på kjennskap til laget";
  const awayFormStr = awayForm
    ? `Form siste 5: ${awayForm.form} | Snitt mål: ${awayForm.goalsPerGame} | Snitt sluppet inn: ${awayForm.goalsAgainstPerGame}`
    : "Ingen formdata — vurder basert på kjennskap til laget";

  const prompt = `Du er verdens beste fotballanalytiker og betting-ekspert. Analyser kampen grundig for markedet "${market}".

KAMP: ${home} vs ${away}
LIGA: ${league} (sesong ${seas})
TIDSPUNKT: ${time}
ODDS: Hjemme ${odds[0]} | Uavgjort ${odds[1]} | Borte ${odds[2]}

REAL STATISTIKK:
${home} form: ${homeFormStr}
${away} form: ${awayFormStr}
H2H historikk: ${h2h}
Skader ${home}: ${homeInj}
Skader ${away}: ${awayInj}

ANALYSER DISSE FAKTORENE:
1. Nåværende form og momentum
2. Rotasjonsrisiko — er det kamp snart etterpå som kan føre til B-lag?
3. Skader og suspensjoner på nøkkelspillere
4. Hjemmebane-fordel og statistikk
5. Tabellsituasjon og motivasjon (tittelkamp, nedrykkskamp, ingenting å spille for?)
6. Taktisk matchup og trener-strategi
7. H2H-historikk og psykologiske faktorer
8. Er oddsen feil priset — er det verdi?

Svar KUN med JSON (ingen markdown, ingen tekst utenfor JSON):
{
  "tip": "Konkret tips f.eks. Hjemmeseier eller Over 2.5 mål",
  "verdict": "STERK eller FORSIKTIG eller UNNGÅ",
  "confidence": 74,
  "analysis": "3-4 setninger helhetlig analyse på norsk",
  "form_home": "Konkret vurdering av ${home} sin form",
  "form_away": "Konkret vurdering av ${away} sin form",
  "injuries": "Skadeoppsummering begge lag",
  "rotation_risk": "Lav/Middels/Høy — konkret begrunnelse",
  "h2h": "Oppsummering av historikk",
  "value": "Ja/Nei — konkret begrunnelse på norsk"
}`;

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1000,
        temperature: 0.5,
      }),
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    const text = data.choices[0].message.content.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(text);
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: "AI-analyse feilet: " + err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`OddsAI kjører på port ${PORT}`));
