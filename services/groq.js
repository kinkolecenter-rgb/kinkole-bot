const config = require('../config');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

async function appelerGroq(messages, systemPrompt) {
    try {
        const response = await fetch(GROQ_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.groqApiKey}`
            },
            body: JSON.stringify({
                model: MODEL,
                max_tokens: 1500,
                messages: [
                    { role: 'system', content: systemPrompt },
                    ...messages
                ]
            })
        });

        const data = await response.json();
        return data.choices?.[0]?.message?.content || '❌ Pas de réponse';
    } catch (e) {
        console.error('❌ Erreur Groq:', e.message);
        return '❌ Erreur de connexion Groq';
    }
}

const genererBrief = async (messages) => {
    if (messages.length === 0) return '📭 Aucun message reçu depuis le dernier brief.';

    const contexte = messages.map(m =>
        `[${new Date(m.timestamp).toLocaleTimeString('fr-FR')}] ${m.groupeNom} | ${m.expediteur}: ${m.texte}`
    ).join('\n');

    const systemPrompt = `Tu es l'assistant du manager d'une société de paris sportifs au Congo (Winner Bet Kinkole).
Tu analyses les messages des groupes WhatsApp et tu produis un brief clair et structuré en français.
Sois concis, professionnel. Regroupe par thème : présences, problèmes matériels, rapports agents, incidents.
Si tu détectes un problème urgent, mets-le en premier avec ⚠️.`;

    return appelerGroq(
        [{ role: 'user', content: `Voici les messages reçus :\n\n${contexte}\n\nFais un brief structuré.` }],
        systemPrompt
    );
};

const repondreQuestion = async (question, messages) => {
    const contexte = messages.map(m =>
        `[${new Date(m.timestamp).toLocaleTimeString('fr-FR')}] ${m.groupeNom} | ${m.expediteur}: ${m.texte}`
    ).join('\n');

    const systemPrompt = `Tu es l'assistant du manager d'une société de paris sportifs au Congo (Winner Bet Kinkole).
Tu as accès aux messages des groupes WhatsApp des dernières heures.
Réponds aux questions du manager de façon précise et concise en français.
Si l'info n'est pas dans les messages, dis-le clairement.`;

    return appelerGroq(
        [{ role: 'user', content: `Messages disponibles :\n\n${contexte}\n\nQuestion du manager : ${question}` }],
        systemPrompt
    );
};

const preparerRapport = async (typeRapport, messages) => {
    const contexte = messages.map(m =>
        `[${new Date(m.timestamp).toLocaleTimeString('fr-FR')}] ${m.groupeNom} | ${m.expediteur}: ${m.texte}`
    ).join('\n');

    const systemPrompt = `Tu es l'assistant du manager d'une société de paris sportifs au Congo (Winner Bet Kinkole).
Tu prépares des rapports officiels basés sur les messages reçus.
Sois précis, professionnel, en français. Utilise les vraies données des messages.`;

    return appelerGroq(
        [{ role: 'user', content: `Messages disponibles :\n\n${contexte}\n\nPrépare un rapport de type "${typeRapport}".` }],
        systemPrompt
    );
};

module.exports = { genererBrief, repondreQuestion, preparerRapport };
