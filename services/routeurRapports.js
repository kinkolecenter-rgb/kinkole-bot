const config = require('../config');

// const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
// const MODEL = 'llama-3.3-70b-versatile';
// const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
// Modèles de référence
const MODELE_MATIN = `Bonjour Team
* Ouverture du [DATE] shop [SHOP] par [MANAGER] [HEURE_OUV]
* Ouverture premier agent à [HEURE_AGENT]
* Ouverture teller à [HEURE_TELLER]
* Premier ticket joué et payé
* [NOM_PREMIER_PAYE] : [HEURE_PREMIER_PAYE]
* Premier ticket payé par [CAISSIER] [HEURE_PAYE]
* Nombre de caissière [NB_CAISSIERS]
* Equipe matin caisse : [LISTE_CAISSE]
* PR : [NB_PR] — [NOMS_PR]
* Center [CENTER]
Etat Matériel: [MATERIEL]
* Page : [PAGES]
* ram : [RAM]
* plus bico : [BICO]
* Sous Big gén [BIG_GEN]`;

const MODELE_SOIR = `Dernier rapport du [DATE]
* Dernier ticket effectué par [NOM] à [HEURE]
* Dernier ticket payé par [NOM] à [HEURE]
* Nombre de tickets joués par les deux shift : [NB_TICKETS]
* Nombre de tickets joués par les agents pos : [NB_POS]
* Moyenne de tickets par agent : [MOYENNE]
* Nombre de tickets loto : [LOTO]
* Nombre de tickets instant win : [INSTANT_WIN]
Etat des stocks utilisés: [STOCKS_UTILISES]
Etat des stocks restants: [STOCKS_RESTANTS]`;

const MODELE_COFFRE = `Coffre ok hormis
* [ELEMENTS_COFFRE]`;

const MODELE_FIXTURE = `Fixtures sport betting kinkole shop
Nb. Pages: [NB_PAGES]
Nb.Copies par agent: [NB_COPIES]
loto: [LOTO]
Giga: [GIGA]
Félicitation: [FELICITATION]
Total/agt: [TOTAL]
Taux de change
Achat: [ACHAT]
Vente: [VENTE]`;

async function appelerIA(systemPrompt, userPrompt) {
    const modeles = [
    'meta-llama/llama-3.1-8b-instruct:free',
    'meta-llama/llama-3.2-3b-instruct:free',
    'meta-llama/llama-3.2-1b-instruct:free',
    'google/gemma-3-27b-it:free',
    'google/gemma-3-12b-it:free',
    'google/gemma-3-4b-it:free',
    'mistralai/mistral-7b-instruct:free',
    'qwen/qwen-2.5-7b-instruct:free',
    'deepseek/deepseek-r1-distill-llama-70b:free',
    'microsoft/phi-3-mini-128k-instruct:free'
];

    for (const model of modeles) {
        try {
            const response = await fetch(OPENROUTER_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.openrouterApiKey}`,
                    'HTTP-Referer': 'https://kinkole-bot.railway.app'
                },
                body: JSON.stringify({
                    model,
                    max_tokens: 200,
                    temperature: 0.1,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ]
                })
            });
            const data = await response.json();
            if (!data.error && data.choices?.[0]?.message?.content) {
                return data.choices[0].message.content;
            }
        } catch (e) {
            console.log(`⚠️ Erreur ${model}:`, e.message);
        }
    }
    return null;
}

// Détecte si un message est un rapport et lequel
async function detecterTypeRapport(texte, expediteur) {
    const prompt = `Tu es un détecteur de type de message opérationnel pour Winner Bet Kinkole.

RÈGLE PRINCIPALE : Tout message envoyé par un manager dans un groupe opérationnel est un rapport, même sans le mot "rapport".

Retourne UNIQUEMENT un JSON valide :
{
  "est_rapport": true/false,
  "type": "ouverture|soir|coffre|fixture|composition|connexion|pos|stocks|caution|non_cloture|autre",
  "periode": "matin|soir|null",
  "resume": "résumé en une phrase du contenu"
}

Types :
- ouverture : "Bonjour Team", ouverture shop, premier ticket, état matériel
- soir : "Dernier rapport", dernier ticket, stocks utilisés/restants
- coffre : "Coffre ok", salaire, collecte
- fixture : "Fixtures sport betting", taux de change, achat/vente
- composition : "TEAM Composition", managers, caissiers, PR, sécurité
- connexion : "Détails connexion", ids connectés, tickets loto, instant win
- pos : "Rapport pos", machines en panne, backup, remplacement
- stocks : stocks utilisés, restants, RAM, rolls
- caution : "Rapport Reste Caution", montants agents
- non_cloture : "Non clôture", liste d'agents
- autre : tout autre message opérationnel

IMPORTANT : 
- "<Médias omis>" seul sans texte → est_rapport=false
- "[Média sans légende]" → est_rapport=false
- Message trop court (moins de 10 caractères) → est_rapport=false
- Tout le reste envoyé par un manager → est_rapport=true
- salutations (Bonjour, Bonsoir, Salut...)
- remerciements (Merci, Ok, Reçu, Bien noté...)
- emojis seuls
- réponses courtes (Oui, Non, D'accord...)

Message :
${texte.substring(0, 600)}`;

    const resultat = await appelerIA(
        'Tu es un détecteur de rapport. Retourne uniquement du JSON valide sans markdown.',
        prompt
    );

    try {
        const clean = resultat?.replace(/```json|```/g, '').trim();
        return JSON.parse(clean);
    } catch (e) {
        return { est_rapport: false, type: 'autre' };
    }
}

// Vérifie si le rapport est complet selon son modèle
async function verifierCompletude(texte, type) {
    const modeles = {
        matin: MODELE_MATIN,
        soir: MODELE_SOIR,
        coffre: MODELE_COFFRE,
        fixture: MODELE_FIXTURE
    };

    const modele = modeles[type];
    if (!modele) return { complet: false, manquants: ['Type inconnu'] };

    const prompt = `Compare ce rapport avec le modèle et retourne UNIQUEMENT un JSON valide :
{
  "complet": true/false,
  "manquants": ["liste des champs manquants ou vides"]
}

MODÈLE DE RÉFÉRENCE :
${modele}

RAPPORT REÇU :
${texte}

Si une info est présente même partiellement, ne la mets pas dans manquants.
Si tout est présent, retourne complet=true et manquants=[].`;

    const resultat = await appelerIA(
        'Tu es un vérificateur de rapport. Retourne uniquement du JSON valide sans markdown.',
        prompt
    );

    try {
        const clean = resultat?.replace(/```json|```/g, '').trim();
        return JSON.parse(clean);
    } catch (e) {
        return { complet: true, manquants: [] };
    }
}

function getDestination(type) {
    const map = {
        ouverture:  'gestion_center',
        soir:       'gestion_center',
        connexion:  'gestion_center',  // ✅ ajouté
        coffre:     's_check',
        fixture:    'rate_fixture'
    };
    return map[type] || null;
}

module.exports = { detecterTypeRapport, verifierCompletude, getDestination };
