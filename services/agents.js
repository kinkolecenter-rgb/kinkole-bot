/**
 * agents.js — Agents IA de KINKOLE AI
 * Upgradé avec : Digital Twin, mémoire long terme, réponses enrichies
 */

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
- POS : terminaux de jeux | Flybox : connexion internet
- Onduleur : alimentation | Générateur : backup électrique
- Imprimantes : tickets et fixtures | Teller : caisse principale

## Incidents fréquents
- Panne réseau, POS hors service, retard ouverture
- Agent absent, ticket problème, pénalité
- Problème générateur, Mobile Money bloqué

# RÈGLES DE RÉPONSE (STRICTES)
1. Toujours en français.
2. Ne jamais inventer — si info manquante, le dire clairement.
3. LANGAGE NATUREL UNIQUEMENT : Ne mentionne JAMAIS de termes informatiques ou noms de variables (comme null, undefined, usd_jour, coffre_statut). Si une donnée manque, écris "Non communiqué" ou "En attente".
4. TEMPORALITÉ LOGIQUE : Prends en compte l'heure actuelle. Ne recommande jamais une action (comme "rappeler l'équipe à 10h") s'il est déjà passé 10h. Concentre-toi sur les actions futures.
5. SUIVI CONTINU : Si un incident critique ou un ID non clôturé du précédent rapport n'est pas déclaré explicitement comme "résolu", tu DOIS le maintenir dans les "Points d'attention immédiats" avec la mention "Toujours en cours".
6. ADAPTE le format à la question :
   - Question simple → réponse directe courte
   - Demande de bilan → format structuré avec émojis
   - Demande de chiffres → liste concise
   - Demande d'action → recommandation directe
7. Maximum 500 mots.
8. Distinguer incident ouvert vs résolu.
9. Utilise l'historique de conversation pour répondre avec cohérence.
10. Quand le Digital Twin est fourni, utilise ses données en PRIORITÉ.

# FORMAT BILAN (uniquement pour les briefs et bilans)
🔥 APPROBATION FINANCIÈRE REQUISE (À ajouter TOUT EN HAUT uniquement si une sortie de fonds ou d'argent est demandée)
🟢/🟡/🔴 [État général en une phrase]
🔴 POINTS D'ATTENTION IMMÉDIATS
👥 MANAGERS
📊 CHIFFRES CLÉS
🎯 MES RECOMMANDATIONS
🏁 DÉCISION SUGGÉRÉE`;

// ── Modèles IA ────────────────────────────────────────────────────────────────
const MODELES = [
    'google/gemma-4-31b-it:free',
    'openrouter/free',
    'openai/gpt-oss-20b',
    'deepseek/deepseek-r1-distill-llama-70b:free',
    'google/gemma-3-27b-it:free',
    'qwen/qwen-2.5-7b-instruct:free',
    'google/gemma-3-12b-it:free',
    'mistralai/mistral-7b-instruct:free',
    'meta-llama/llama-3.1-8b-instruct:free',
    'microsoft/phi-3-mini-128k-instruct:free'
];

async function appelerIA(systemPrompt, messages, historique = []) {
   const heureKinshasa = new Date().toLocaleTimeString('fr-FR', { timeZone: 'Africa/Kinshasa', hour: '2-digit', minute: '2-digit' });
    const systemPromptAvecHeure = `${systemPrompt}\n\n[INFO SYSTÈME INVISIBLE] Heure actuelle à Kinshasa : ${heureKinshasa}`;
    for (const model of MODELES) {
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
                    max_tokens: 3000,
                    temperature: 0.1,
                    messages: [
                        { role: 'system', content: systemPromptAvecHeure },
                        ...historique,
                        ...messages
                    ]
                })
            });
            const data = await response.json();
            if (!data.error && data.choices?.[0]?.message?.content) {
                console.log(`✅ IA via ${model}`);
                let rep = data.choices[0].message.content;
                rep = rep.replace(/<think>[\s\S]*?<\/think>\n*/g, '').trim();
                rep = rep.replace(/\*\*([^*]+)\*\*/g, '*$1*');
                return rep;
            }
        } catch (e) {
            console.log(`⚠️ ${model}:`, e.message);
        }
    }
    return null;
}

function formaterMessagesStructures(messages) {
    if (!messages || messages.length === 0) return 'Aucun message disponible.';
    return messages.map(m => {
        const heure = new Date(m.timestamp).toLocaleTimeString('fr-FR', {
            hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kinshasa'
        });
        const cat  = m.categorie ? `[${m.categorie.toUpperCase()}]` : '[INFO]';
        const prio = m.priorite?.emoji || '⚪';
        return `${prio}${cat} ${heure} | ${m.groupeNom || 'Groupe'} | ${m.expediteur || '?'}: ${(m.texte || '').substring(0, 300)}`;
    }).join('\n');
}

// ── Agent Intention ───────────────────────────────────────────────────────────
async function agentIntention(texte, historique = []) {
    const prompt = `Tu es un routeur d'intentions pour KINKOLE AI.

Retourne UNIQUEMENT un JSON valide sans markdown :
{
  "intention": "brief|incidents|performance|rapport|recherche|recommandation|etat_centre|profil_manager|anomalies|reset|inconnu",
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

RÈGLES :
- brief : bilan général ("comment se passe", "état du centre", "que s'est-il passé")
- etat_centre : état temps réel ("comment se porte", "santé du centre", "jumeau")
- incidents : urgences/problèmes
- performance : évaluation manager spécifique
- profil_manager : historique long terme d'un manager ("profil de", "historique de", "retards de")
- anomalies : détection fraude/patterns ("anomalie", "fraude", "pattern", "suspect")
- rapport : générer un rapport formel
- recherche : question précise sur un fait
- recommandation : demande de conseil
- reset : effacer historique`;

    const res = await appelerIA(prompt, [{ role: 'user', content: texte }], historique);
    if (!res) return { intention: 'inconnu', parametres: { question: texte }, confiance: 0.1 };
    try {
        return JSON.parse(res.replace(/```json|```/g, '').trim());
    } catch (e) {
        return { intention: 'inconnu', parametres: { question: texte }, confiance: 0.3 };
    }
}

// ── Agent Brief (enrichi avec Digital Twin) ───────────────────────────────────
async function agentBrief(messages, historique = [], etatTwin = null) {
    if (!messages || messages.length === 0) return '📭 Aucun message reçu pour cette période.';
    const contexte = formaterMessagesStructures(messages);

    let contexteTwin = '';
    if (etatTwin) {
        contexteTwin = `\n\n📡 ÉTAT TEMPS RÉEL DU CENTRE (Digital Twin) :\n${etatTwin}`;
    }

    const reponse = await appelerIA(
        SYSTEM_WINNER_BET,
        [{
            role: 'user',
            content: `Messages WhatsApp reçus :\n\n${contexte}${contexteTwin}\n\nGénère le brief complet. Intègre l'état du Digital Twin s'il est fourni.`
        }],
        historique
    );
    if (!reponse) {
        console.log('⚠️ IA indisponible — brief local...');
        return genererBriefLocal(messages);
    }
    return reponse;
}

// ── Agent État Centre (Digital Twin direct) ───────────────────────────────────
async function agentEtatCentre(etatTwin, messages, historique = []) {
    // Si le twin a une réponse complète, on l'enrichit avec l'IA
    const contexteMsgs = messages.length > 0 ? `\nMessages récents :\n${formaterMessagesStructures(messages.slice(-20))}` : '';

    const reponse = await appelerIA(
        SYSTEM_WINNER_BET,
        [{
            role: 'user',
            content: `ÉTAT TEMPS RÉEL DU CENTRE :\n${etatTwin}${contexteMsgs}\n\nRéponds comme si tu étais un copilote qui connaît l'état exact du centre. Sois direct et actionnable.`
        }],
        historique
    );
    return reponse; // peut être null — l'appelant utilisera twin.repondreEtatCentre() comme fallback
}

// ── Agent Incidents ───────────────────────────────────────────────────────────
async function agentIncidents(messages, historique = [], etatTwin = null) {
    const contexte = formaterMessagesStructures(messages);
    let contexteTwin = etatTwin ? `\nIncidents connus (Digital Twin) : ${etatTwin}\n` : '';

    const reponse = await appelerIA(
        SYSTEM_WINNER_BET,
        [{
            role: 'user',
            content: `${contexteTwin}Messages :\n\n${contexte}\n\nIdentifie TOUS les incidents, pannes et urgences. Indique lesquels sont encore ouverts.`
        }],
        historique
    );
    if (!reponse) return resumerIncidents(messages);
    return reponse;
}

// ── Agent Performance ─────────────────────────────────────────────────────────
async function agentPerformance(messages, nomManager = null, historique = [], profilLongTerme = null) {
    const contexte = formaterMessagesStructures(messages);
    const cible    = nomManager ? `du manager ${nomManager}` : 'de tous les managers';
    let contexteProfile = profilLongTerme ? `\nPROFIL LONG TERME :\n${profilLongTerme}\n` : '';

    const reponse = await appelerIA(
        SYSTEM_WINNER_BET,
        [{
            role: 'user',
            content: `${contexteProfile}Messages du jour :\n\n${contexte}\n\nÉvalue la performance ${cible}. Donne un score chiffré et des recommandations spécifiques.`
        }],
        historique
    );
    if (!reponse) return `📊 *Performance ${cible}*\n\n_IA indisponible. Utilisez !statut ou !incidents._`;
    return reponse;
}

// ── Agent Profil Manager (mémoire long terme) ─────────────────────────────────
async function agentProfilManager(nomManager, profilTexte, historique = []) {
    const reponse = await appelerIA(
        SYSTEM_WINNER_BET,
        [{
            role: 'user',
            content: `Voici le profil long terme du manager ${nomManager} :\n\n${profilTexte}\n\nAnalyse ce profil et donne une évaluation complète : points forts, points faibles, tendances, et recommandations concrètes pour le Center Manager.`
        }],
        historique
    );
    if (!reponse) return profilTexte; // retourner le profil brut si IA down
    return reponse;
}

// ── Agent Anomalies ───────────────────────────────────────────────────────────
async function agentAnomalies(rapportAnomalies, historique = []) {
    const reponse = await appelerIA(
        SYSTEM_WINNER_BET,
        [{
            role: 'user',
            content: `Voici le rapport d'anomalies détectées :\n\n${rapportAnomalies}\n\nAnalyse ces anomalies et donne des recommandations d'action prioritaires.`
        }],
        historique
    );
    if (!reponse) return rapportAnomalies;
    return reponse;
}

// ── Agent Rapports ────────────────────────────────────────────────────────────
async function agentRapports(messages, typeRapport, historique = []) {
    const contexte = formaterMessagesStructures(messages);
    const reponse  = await appelerIA(
        SYSTEM_WINNER_BET,
        [{ role: 'user', content: `Génère un rapport professionnel de type "${typeRapport}" basé sur :\n\n${contexte}` }],
        historique
    );
    if (!reponse) return `📋 *Rapport ${typeRapport}*\n\n_IA indisponible. ${messages.length} messages disponibles._`;
    return reponse;
}

// ── Agent Recherche ───────────────────────────────────────────────────────────
async function agentRecherche(question, messages, historique = []) {
    const contexte = formaterMessagesStructures(messages);
    const reponse  = await appelerIA(
        SYSTEM_WINNER_BET,
        [{
            role: 'user',
            content: `Messages disponibles :\n\n${contexte}\n\nQuestion : ${question}\n\nRéponds directement et précisément.`
        }],
        historique
    );
    if (!reponse) return `🔍 *Recherche*\n\n_IA indisponible. Question : "${question}"\n${messages.length} messages disponibles._`;
    return reponse;
}

// ── Agent Recommandations ─────────────────────────────────────────────────────
async function agentRecommandations(messages, historique = [], etatTwin = null) {
    const contexte     = formaterMessagesStructures(messages);
    const contexteTwin = etatTwin ? `\nÉtat du centre :\n${etatTwin}\n` : '';

    const reponse = await appelerIA(
        SYSTEM_WINNER_BET,
        [{
            role: 'user',
            content: `${contexteTwin}Messages :\n\n${contexte}\n\nDonne des recommandations concrètes et prioritaires. Chaque recommandation doit avoir une action immédiate associée.`
        }],
        historique
    );
    if (!reponse) {
        const urgences = messages.filter(m => m.categorie === 'urgence' || m.categorie === 'panne');
        if (urgences.length > 0) {
            return `🎯 *RECOMMANDATIONS* _(IA indisponible — locale)_\n\n` +
                   urgences.slice(0, 3).map((u, i) => `${i+1}. ⚠️ Traiter : ${(u.texte||'').substring(0,80)}`).join('\n');
        }
        return `🎯 *RECOMMANDATIONS*\n\n_IA indisponible. Aucune urgence détectée._`;
    }
    return reponse;
}

module.exports = {
    agentIntention,
    agentBrief,
    agentEtatCentre,
    agentIncidents,
    agentRapports,
    agentPerformance,
    agentProfilManager,
    agentAnomalies,
    agentRecherche,
    agentRecommandations
};
