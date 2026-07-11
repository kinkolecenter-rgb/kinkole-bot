const config = require('../config');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

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

async function appelerGroq(systemPrompt, userPrompt) {
    try {
        const response = await fetch(GROQ_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.groqApiKey}`
            },
            body: JSON.stringify({
                model: MODEL,
                max_tokens: 1000,
                temperature: 0.1,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ]
            })
        });
        const data = await response.json();
        if (data.error) return null;
        return data.choices?.[0]?.message?.content || null;
    } catch (e) {
        return null;
    }
}

// Détecte si un message est un rapport et lequel
async function detecterTypeRapport(texte) {
    const prompt = `Analyse ce message WhatsApp et retourne UNIQUEMENT un JSON valide :
{
  "est_rapport": true/false,
  "type": "matin|soir|coffre|fixture|inconnu",
  "periode": "matin|soir|null"
}

Indices :
- matin : "Bonjour Team", "Ouverture du", "Premier ticket", "Etat Matériel"
- soir : "Dernier rapport", "Dernier ticket", "stocks utilisés", "shift"
- coffre : "Coffre ok", "hormis", "Salaire", "Collecte"
- fixture : "Fixtures sport betting", "Taux de change", "Achat", "Vente", "Nb. Pages"

Message :
${texte.substring(0, 500)}`;

    const resultat = await appelerGroq(
        'Tu es un détecteur de type de rapport. Retourne uniquement du JSON valide sans markdown.',
        prompt
    );

    try {
        const clean = resultat?.replace(/```json|```/g, '').trim();
        return JSON.parse(clean);
    } catch (e) {
        return { est_rapport: false, type: 'inconnu' };
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

    const resultat = await appelerGroq(
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

// Destination selon type
function getDestination(type) {
    const map = {
        matin: 'gestion_center',
        soir: 'gestion_center',
        coffre: 's_check',
        fixture: 'rate_fixture'
    };
    return map[type] || null;
}

module.exports = { detecterTypeRapport, verifierCompletude, getDestination };
