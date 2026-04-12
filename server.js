const express = require("express");
const cors = require("cors");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
app.use(cors());
app.use(express.json());

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Health check
app.get("/", (req, res) => res.json({ status: "OddsAI backend kjører!" }));

// Main analyze endpoint
app.post("/analyze", async (req, res) => {
  const { home, away, league, odds, time, market } = req.body;

  if (!home || !away || !league || !odds || !market) {
    return res.status(400).json({ error: "Mangler felter: home, away, league, odds, market" });
  }

  const prompt = `Du er verdens beste fotballanalytiker og oddstips-ekspert. Analyser denne kampen grundig for markedet "${market}".

Kamp: ${home} vs ${away}
Liga: ${league}
Odds: Hjemme ${odds[0]} | Uavgjort ${odds[1]} | Borte ${odds[2]}
Tidspunkt: ${time || "ukjent"}

Vurder og inkluder faktorer som:
- Lagets nåværende form (siste 5 kamper, målscoring, defensiv soliditet)
- Sannsynlighet for at laget bruker B-lag (f.eks. ved viktig kamp dagen etter, eller cupkamp nært forestående)
- Skader og suspenderinger på nøkkelspillere
- Hode-til-hode historikk mellom lagene
- Hjemmebane-fordel og bortelaget reiseavstand
- Motivasjon og tabellsituasjon (slåss de mot nedrykk, jagerplass, allerede sikret?)
- Trener-taktikk og formasjon-styrker
- Vær og baneforhold om relevant
- Verdi i odds: er bookmaker-odds feil priset?

Svar KUN med JSON (ingen markdown, ingen tekst utenfor JSON):
{
  "tip": "Konkret tips f.eks. Hjemmeseier",
  "verdict": "STERK eller FORSIKTIG eller UNNGÅ",
  "confidence": 78,
  "analysis": "2-4 setninger helhetlig analyse på norsk",
  "form_home": "Kort vurdering hjemmelaget form",
  "form_away": "Kort vurdering bortelaget form",
  "injuries": "Kjente skader/suspensjoner eller Ingen kjente",
  "rotation_risk": "Lav/Middels/Høy — og kort begrunnelse",
  "h2h": "Kort historikk mellom lagene",
  "value": "Er det verdi i oddsene? Ja/Nei og hvorfor"
}`;

  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 800,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .replace(/```json|```/g, "")
      .trim();

    const parsed = JSON.parse(text);
    res.json(parsed);
  } catch (err) {
    console.error("Feil:", err.message);
    res.status(500).json({ error: "AI-analyse feilet: " + err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`OddsAI backend kjører på port ${PORT}`));
