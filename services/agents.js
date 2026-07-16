const config = require('../config');
const { genererBriefLocal, resumerIncidents } = require('./analyseur');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const SYSTEM_WINNER_BET = `Tu es KINKOLE AI, le bras droit numérique du Center Manager de Winner Bet Kinkole (RDC).

# TON RÔLE
Tu ne décris pas — tu pilotes. Tu analyses, tu priorises, tu recommandes.
ADAPTE ton format à la question posée. Pas de structure rigide pour chaque réponse.

# CONTEXTE MÉTIER
## Structure
- Center Manager (Evael) : supervision globale
- Managers (Eric, Timothée) : gestion quotidienne
- Ass. Managers (Déborah, Trésor) : support opérationnel
- Agents PR : terrain, recrutement clients
- Caissiers/Caissières : tickets et paiements
- QS : contrôle qualité terrain

## Opérations quotidiennes
- Ouverture shop : vérification équipe, matériel, connexion
- Fixtures : impression et distribution des grilles de paris
- Tickets : vente, validation, paiement des gains
- Collecte : ramassage des recettes
- Coffre : sécurisation des fonds
- Rapport matin/soir : bilan opérationnel

## Matériel surveillé
- POS : terminaux de jeux
- Flybox : connexion internet
- Onduleur : alimentation électrique
- Générateur : backup électrique
- Imprimantes : tickets et fixtures
- Teller : caisse principale

## Incidents fréquents
- Panne réseau, POS hors service, retard ouverture
- Agent absent, ticket problème, pénalité
- Problème générateur, Mobile Money bloqué

## Groupes WhatsApp surveillés
- Synchro Kinkole : coordination générale
- Synchro Kinkole pos : suivi POS
- Winner Shop Kinkole : opérations shop
- Rapport PR terrain : rapports agents terrain
- PENALITy QS all shop : pénalités qualité
- General Management : décisions management
- Évacuation Matériels shop : logistique matériel
- Winner printing group : impression fixtures
- Team Composition Shop : composition équipes
- MUKUMBUSU WINNER : rapports journaliers
- Suivi Carburant Kinkole : carburant générateur
- disparu, viré & no cloturé : agents problèmes

# RÈGLES DE RÉPONSE
1. Toujours en français
2. Ne jamais inventer — si info manquante, le dire clairement
3. ADAPTE le format à la question :
   - Question simple → réponse directe courte
   - Demande de bilan → format structuré avec émojis
   - Demande de chiffres → liste concise
   - Demande d'action → recommandation directe
4. Maximum 500 mots
5. Distinguer incident ouvert vs résolu
6. Utilise l'historique de conversation pour répondre avec cohérence
7. Heure locale : Africa/Kinshasa (UTC+1)

# FORMAT BILAN (uniquement pour les briefs et bilans)
🟢/🟡/🔴 [État général en une phrase]
🔴 POINTS D'ATTENTION IMMÉDIATS
👥 MANAGERS
📊 CHIFFRES CLÉS
🎯 MES RECOMMANDATIONS
🏁 DÉCISION SUGGÉRÉE`;

// ✅ Fix 10 : modèles réordonnés du plus capable au moins capable
// ✅ Fix 11 : max_tokens porté à 1000
async function appelerIA(systemPrompt, messages, historique = []) {
    const modeles = [
        'deepseek/deepseek-r1-distill-llama-70b:free',  // 70B — meilleur
        'google/gemma-3-27b-it:free',                    // 27B
        'qwen/qwen-2.5-7b-instruct:free',               // bon rapport qualité/dispo
        'google/gemma-3-12b-it:free',
        'mistralai/mistral-7b-instruct:free',
        'meta-llama/llama-3.1-8b-instruct:free',
        'google/gemma-3-4b-it:free',
        'meta-llama/llama-3.2-3b-instruct:free',
        'meta-llama/llama-3.2-1b-instruct:free',
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
                    max_tokens: 1000,  // ✅ Fix 11
                    temperature: 0.1,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        ...historique,
                        ...messages
                    ]
                })
            });
            const data = await response.json();
            if (!data.error && data.choices?.[0]?.message?.content) {
                console.log(`✅ IA via ${model}`);
                return data.choices[0].message.content;
            }
            console.log(`⚠️ ${model} indispo, essai suivant...`);
        } catch (e) {
            console.log(`⚠️ Erreur ${model}:`, e.message);
        }
    }
    return null; // ✅ Retourne null au lieu du message d'erreur — le caller gère le fallback
}

// ✅ Fix 9 : enrichir les messages avec catégorie avant formatage
function formaterMessagesStructures(messages) {
    if (!messages || messages.length === 0) return 'Aucun message disponible.';

    return messages.map(m => {
        const heure = new Date(m.timestamp).toLocaleTimeString('fr-FR', {
            hour: '2-digit', minute: '2-digit',
            timeZone: 'Africa/Kinshasa'
        });
        const cat = m.categorie ? `[${m.categorie.toUpperCase()}]` : '[INFO]';
        const prio = m.priorite?.emoji || '⚪';
        const texte = (m.texte || '').substring(0, 300); // limiter la longueur par message
        return `${prio}${cat} ${heure} | ${m.groupeNom || 'Groupe'} | ${m.expediteur || '?'}: ${texte}`;
    }).join('\n');
}

// ============ AGENT INTENTION ============
async function agentIntention(texte, historique = []) {
    const prompt = `Tu es un routeur d'intentions pour KINKOLE AI.

Analyse la demande et retourne UNIQUEMENT un JSON valide sans markdown :
{
  "intention": "brief|incidents|performance|rapport|recherche|recommandation|reset|inconnu",
  "parametres": {
    "date": "YYYY-MM-DD si date mentionnée, sinon null",
    "groupe": "nom du groupe si mentionné ou null",
    "manager": "nom du manager si mentionné ou null",
    "type_rapport": "type si mentionné ou null",
    "question": "la question exacte"
  },
  "confiance": 0.0
}

Date aujourd'hui : ${new Date().toISOString().split('T')[0]}

RÈGLES DE ROUTAGE :
- brief : demande de bilan général ("comment se passe", "que s'est-il passé", "état du centre")
- incidents : demande d'urgences/problèmes ("y a-t-il des urgences", "incidents", "pannes")
- performance : évaluation d'un manager spécifique ("comment travaille Eric", "performance")
- rapport : générer un rapport formel ("prépare un rapport", "rapport journalier")
- recherche : question précise sur un fait ("combien de rapports", "qui a envoyé", "as-tu envoyé")
- recommandation : demande de conseil ("que recommandes-tu", "que faire")
- reset : effacer historique

IMPORTANT : "combien", "qui", "as-tu", "quel" → toujours RECHERCHE.`;

    const resultat = await appelerIA(prompt, [{ role: 'user', content: texte }], historique);

    if (!resultat) {
        return { intention: 'inconnu', parametres: { question: texte }, confiance: 0.1 };
    }

    try {
        const clean = resultat.replace(/```json|```/g, '').trim();
        return JSON.parse(clean);
    } catch (e) {
        return { intention: 'inconnu', parametres: { question: texte }, confiance: 0.3 };
    }
}

// ============ AGENT INCIDENTS ============
// ✅ Fix 8 : fallback local si IA indisponible
async function agentIncidents(messages, historique = []) {
    const contexte = formaterMessagesStructures(messages);
    const reponse = await appelerIA(
        SYSTEM_WINNER_BET,
        [{
            role: 'user',
            content: `Analyse ces messages et identifie TOUS les incidents, pannes et urgences :\n\n${contexte}\n\nFocalise-toi uniquement sur les problèmes détectés.`
        }],
        historique
    );
    // Fallback local
    if (!reponse) return resumerIncidents(messages);
    return reponse;
}

// ============ AGENT RAPPORTS ============
async function agentRapports(messages, typeRapport, historique = []) {
    const contexte = formaterMessagesStructures(messages);
    const reponse = await appelerIA(
        SYSTEM_WINNER_BET,
        [{
            role: 'user',
            content: `Génère un rapport professionnel de type "${typeRapport}" basé sur ces messages :\n\n${contexte}`
        }],
        historique
    );
    if (!reponse) return `📋 *Rapport ${typeRapport}*\n\n_IA indisponible — génération automatique impossible. Voici les ${messages.length} messages de la période._`;
    return reponse;
}

// ============ AGENT PERFORMANCE ============
async function agentPerformance(messages, nomManager = null, historique = []) {
    const contexte = formaterMessagesStructures(messages);
    const cible = nomManager ? `du manager ${nomManager}` : 'de tous les managers';
    const reponse = await appelerIA(
        SYSTEM_WINNER_BET,
        [{
            role: 'user',
            content: `Évalue la performance ${cible} basée sur ces messages :\n\n${contexte}\n\nDonne un score et des recommandations spécifiques.`
        }],
        historique
    );
    if (!reponse) return `📊 *Performance ${cible}*\n\n_IA indisponible. Utilisez !statut ou !incidents pour les données en temps réel._`;
    return reponse;
}

// ============ AGENT RECHERCHE ============
async function agentRecherche(question, messages, historique = []) {
    const contexte = formaterMessagesStructures(messages);
    const reponse = await appelerIA(
        SYSTEM_WINNER_BET,
        [{
            role: 'user',
            content: `Messages disponibles :\n\n${contexte}\n\nQuestion : ${question}\n\nIMPORTANT : Si la question fait référence à une réponse précédente dans l'historique, utilise ces informations. Réponds directement et précisément.`
        }],
        historique
    );
    if (!reponse) return `🔍 *Recherche*\n\n_IA indisponible. Votre question : "${question}"\n\n${messages.length} messages disponibles dans la période. Essayez !statut ou !incidents._`;
    return reponse;
}

// ============ AGENT RECOMMANDATIONS ============
async function agentRecommandations(messages, historique = []) {
    const contexte = formaterMessagesStructures(messages);
    const reponse = await appelerIA(
        SYSTEM_WINNER_BET,
        [{
            role: 'user',
            content: `Basé sur ces messages :\n\n${contexte}\n\nDonne des recommandations concrètes et prioritaires pour le Center Manager. Chaque recommandation doit avoir une action immédiate associée.`
        }],
        historique
    );
    if (!reponse) {
        // Fallback : recommandations basées sur les urgences détectées
        const urgences = messages.filter(m => m.categorie === 'urgence' || m.categorie === 'panne');
        if (urgences.length > 0) {
            return `🎯 *RECOMMANDATIONS* _(IA indisponible — analyse locale)_\n\n` +
                   urgences.slice(0, 3).map((u, i) => `${i+1}. ⚠️ Traiter : ${(u.texte||'').substring(0,80)}`).join('\n');
        }
        return `🎯 *RECOMMANDATIONS*\n\n_IA indisponible. Aucune urgence détectée localement._`;
    }
    return reponse;
}

// ============ AGENT BRIEF PRINCIPAL ============
// ✅ Fix 8 : fallback vers brief local si IA indisponible
async function agentBrief(messages, historique = []) {
    if (!messages || messages.length === 0) return '📭 Aucun message reçu pour cette période.';

    const contexte = formaterMessagesStructures(messages);
    const reponse = await appelerIA(
        SYSTEM_WINNER_BET,
        [{
            role: 'user',
            content: `Voici les messages reçus dans les groupes WhatsApp de Winner Bet Kinkole :\n\n${contexte}\n\nGénère le brief complet en suivant exactement le format défini.`
        }],
        historique
    );

    // ✅ Fix 8 : si IA indisponible → brief local automatique
    if (!reponse) {
        console.log('⚠️ IA indisponible — génération du brief local...');
        return genererBriefLocal(messages);
    }

    return reponse;
}

module.exports = {
    agentIntention,
    agentIncidents,
    agentRapports,
    agentPerformance,
    agentRecherche,
    agentRecommandations,
    agentBrief
};
