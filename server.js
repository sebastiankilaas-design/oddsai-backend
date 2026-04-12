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

app.get("/", (req, res) => res.json({ status: "OddsAI backend kjører!" }));

app.get("/fixtures", async (req, res) => {
  const { league } = req.query;
  const leagueId = LEAGUE_IDS[league];
  if (!leagueId) return res.status(400).json({ error: "Ukjent liga" });

  const today = new Date();
  const nextWeek = new Date();
  nextWeek.setDate(today.getDate() + 7);
  const from = today.toISOString().split("T")[0];
  const to = nextWeek.toISOString().split("T")[0];

  try {
    let response = await fetch(
      `https://v3.football.api-sports.io/fixtures?league=${leagueId}&season=2024&from=${from}&to=${to}&status=NS`,
      { headers: { "x-apisports-key": FOOTBALL_API_KEY } }
    );
    let data = await response.json();

    if (!data.response || data.response.length === 0) {
      response = await fetch(
        `https://v3.football.api-sports.io/fixtures?league=${leagueId}&season=2024&status=NS&next=5`,
        { headers: { "x-apisports-key": FOOTBALL_API_KEY } }
      );
      data = await response.json();
    }

    const fixtures = (data.response || []).slice(0, 5).map((f) => {
      const date = new Date(f.fixture.date);
      const dayName = date.toLocaleDateString("no-NO", { weekday: "short" });
      const time = date.toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit" });
      return {
        id: f.fixture.id,
        home: f.teams.home.name,
        away: f.teams.away.name,
        homeLogo: f.teams.home.logo,
        awayLogo: f.teams.away.logo,
        time: `${dayName} ${time}`,
        venue: f.fixture.venue?.name || "",
      };
    });

    res.json(fixtures);
  } catch (err) {
    res.status(500).json({ error: "Kunne ikke hente kamper: " + err.message });
  }
});

async function getTeamForm(teamId, leagueId) {
  try {
    const res = await fetch(
      `https://v3.football.api-sports.io/teams/statistics?team=${teamId}&league=${leagueId}&season=2024`,
      { headers: { "x-apisports-key": FOOTBALL_API_KEY } }
    );
    const data = await res.json();
    const s = data.response;
    if (!s) return null;
    const form = (s.form || "").slice(-5);
    const played = s.fixtures?.played?.total || 1;
    const goalsFor = s.goals?.for?.total?.total || 0;
    const goalsAgainst = s.goals?.against?.total?.total || 0;
    return {
      form,
      goalsPerGame: (goalsFor / played).toFixed(1),
      goalsAgainstPerGame: (goalsAgainst / played).toFixed(1),
    };
  } catch { return null; }
}

async function getH2H(homeId, awayId) {
  try {
    const res = await fetch(
      `https://v3.football.api-sports.io/fixtures/headtohead?h2h=${homeId}-${awayId}&last=5`,
      { headers: { "x-apisports-key": FOOTBALL_API_KEY } }
    );
    const data = await res.json();
    const matches = data.response || [];
    if (matches.length === 0) return "Ingen H2H-data";
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
    const res = await fetch(
      `https://v3.football.api-sports.io/injuries?fixture=${fixtureId}`,
      { headers: { "x-apisports-key": FOOTBALL_API_KEY } }
    );
    const data = await res.json();
    const list = (data.response || []).filter((p) => p.team.id === teamId);
    if (list.length === 0) return "Ingen kjente skader";
    return list.slice(0, 3).map((p) => `${p.player.name} (${p.player.reason})`).join(", ");
  } catch { return "Ikke tilgjengelig"; }
}

app.post("/analyze", async (req, res) => {
  const { home, away, league, odds, time, market, fixtureId, homeId, awayId } = req.body;
  if (!home || !away || !league || !odds || !market) {
    return res.status(400).json({ error: "Mangler felter" });
  }

  const leagueId = LEAGUE_IDS[league];
  let homeForm = null, awayForm = null, h2h = "Ikke hentet", homeInj = "Ikke tilgjengelig", awayInj = "Ikke tilgjengelig";

  if (fixtureId && homeId && awayId && leagueId) {
    [homeForm, awayForm, h2h, homeInj, awayInj] = await Promise.all([
      getTeamForm(homeId, leagueId),
      getTeamForm(awayId, leagueId),
      getH2H(homeId, awayId),
      getInjuries(fixtureId, homeId),
      getInjuries(fixtureId, awayId),
    ]);
  }

  const homeFormStr = homeForm
    ? `Form siste 5: ${homeForm.form} | Snitt mål: ${homeForm.goalsPerGame} | Snitt sluppet inn: ${homeForm.goalsAgainstPerGame}`
    : "Ingen formdata";
  const awayFormStr = awayForm
    ? `Form siste 5: ${awayForm.form} | Snitt mål: ${awayForm.goalsPerGame} | Snitt sluppet inn: ${awayForm.goalsAgainstPerGame}`
    : "Ingen formdata";

  const prompt = `Du er verdens beste fotballanalytiker. Analyser kampen for markedet "${market}".

Kamp: ${home} vs ${away} | Liga: ${league} | Tidspunkt: ${time}
Odds: Hjemme ${odds[0]} | Uavgjort ${odds[1]} | Borte ${odds[2]}

REAL STATISTIKK:
${home} form: ${homeFormStr}
${away} form: ${awayFormStr}
H2H: ${h2h}
Skader ${home}: ${homeInj}
Skader ${away}: ${awayInj}

Vurder også: rotasjonsrisiko (B-lag ved kamp snart?), motivasjon/tabellsituasjon, hjemmebane-fordel, taktikk, og om oddsen gir verdi.

Svar KUN med JSON (ingen markdown):
{
  "tip": "Konkret tips",
  "verdict": "STERK eller FORSIKTIG eller UNNGÅ",
  "confidence": 74,
  "analysis": "2-4 setninger på norsk",
  "form_home": "Vurdering ${home}",
  "form_away": "Vurdering ${away}",
  "injuries": "Skadeoppsummering",
  "rotation_risk": "Lav/Middels/Høy — begrunnelse",
  "h2h": "Historikk-oppsummering",
  "value": "Ja/Nei og kort begrunnelse"
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
        max_tokens: 900,
        temperature: 0.6,
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
