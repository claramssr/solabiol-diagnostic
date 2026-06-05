// ╔══════════════════════════════════════════════════════════════════════╗
// ║  NETLIFY FUNCTION — analyze.js                                       ║
// ║  Reçoit la photo + contexte, appelle Claude Vision, renvoie          ║
// ║  un diagnostic structuré (problème, insecte/maladie, confiance)      ║
// ║  La clé API est lue depuis les variables d'environnement Netlify     ║
// ╚══════════════════════════════════════════════════════════════════════╝

exports.handler = async function(event, context) {

  // Sécurité : uniquement les requêtes POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Récupérer la clé API depuis les variables d'environnement
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Clé API manquante' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch(e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Corps de requête invalide' }) };
  }

  const { imageBase64, mediaType } = body;

  if (!imageBase64) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Image manquante' }) };
  }

  // ── Prompt système pour le diagnostic plante Solabiol ──────────────
  const systemPrompt = `Tu es un expert en phytopathologie et protection des plantes pour la marque Solabiol.
Tu analyses des photos de plantes malades ou infestées par des ravageurs.

Ta réponse doit TOUJOURS être un JSON valide avec cette structure exacte :
{
  "confiance": "haute" | "moyenne" | "faible",
  "probleme_principal": "insecte" | "maladie" | "limaces" | "inconnu",
  "diagnostic": "nom précis du ravageur ou de la maladie identifié",
  "description_symptomes": "ce que tu observes sur la photo en 1-2 phrases",
  "questions_supplementaires": ["question 1", "question 2"] | [],
  "chemin_suggere": "code de l'étape dans l'arbre de décision" | null,
  "message_utilisateur": "message court et encourageant pour le jardinier"
}

Règles importantes :
- Si la photo est floue, mal éclairée ou ne montre pas clairement le problème → confiance: "faible" et ajoute 2 questions_supplementaires
- Si tu identifies clairement le problème → confiance: "haute" et questions_supplementaires: []
- Si tu as un doute → confiance: "moyenne" et ajoute 1 question_supplementaires
- Pour chemin_suggere, utilise ces codes : "puceron_zone", "acarien_zone", "cochenille_zone", "aleurode_zone", "chenille_zone", "moucheron_zone", "doryphore", "limaces", "oidium_zone", "mildiou_zone", "taches_noires", "rouille", "pourriture", "inconnu_zone"
- Réponds UNIQUEMENT en JSON, sans texte avant ou après`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType || 'image/jpeg',
                  data: imageBase64
                }
              },
              {
                type: 'text',
                text: 'Analyse cette photo de plante et identifie le problème (ravageur, maladie, etc.). Réponds uniquement en JSON.'
              }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Erreur API Anthropic:', errText);
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Erreur lors de l\'appel à l\'IA', detail: errText })
      };
    }

    const data = await response.json();
    const rawText = data.content[0].text;

    // Parser le JSON retourné par Claude
    let diagnostic;
    try {
      diagnostic = JSON.parse(rawText);
    } catch(e) {
      // Tenter d'extraire le JSON si Claude a ajouté du texte autour
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) {
        diagnostic = JSON.parse(match[0]);
      } else {
        throw new Error('Réponse IA non parseable');
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(diagnostic)
    };

  } catch(err) {
    console.error('Erreur function analyze:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Erreur interne',
        confiance: 'faible',
        message_utilisateur: 'Analyse impossible pour le moment. Répondez aux questions manuellement.'
      })
    };
  }
};
