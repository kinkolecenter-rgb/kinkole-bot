const config = require('../config');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

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
   - Question simple ("as-tu envoyé des rapports ?") → réponse directe courte
   - Demande de bilan → format structuré avec émojis
   - Demande de chiffres → liste concise
   - Demande d'action → recommandation directe
4. Maximum 400 mots
5. Distinguer incident ouvert vs résolu
6. Utilise l'historique de conversation pour répondre avec cohérence
7. Si la question fait référence à un échange précédent, tiens-en compte

# FORMAT BILAN (uniquement pour les briefs et bilans)
🟢/🟡/🔴 [État général en une phrase]
🔴 POINTS D'ATTENTION IMMÉDIATS
👥 MANAGERS
📊 CHIFFRES CLÉS
🎯 MES RECOMMANDATIONS
🏁 DÉCISION SUGGÉRÉE`;

// ============ APPEL GROQ AVEC HISTORIQUE ============
async function appelerGroq(systemPrompt, messages, historique = []) {
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
                temperature: 0.3,
                messages: [
                    { role: 'system', content: systemPrompt },
                    ...historique,
                    ...messages
                ]
            })
        });

        const data = await response.json();
        if (data.error) {
            console.error('❌ Groq error:', data.error.message);
            return '❌ Erreur Groq: ' + data.error.message;
        }
        return data.choices?.[0]?.message?.content || '❌ Pas de réponse';
    } catch (e) {
        console.error('❌ Erreur réseau Groq:', e.message);
        return '❌ Erreur de connexion';
    }
}

// ============ FORMATER MESSAGES STRUCTURÉS ============
function formaterMessagesStructures(messages) {
    if (!messages || messages.length === 0) return 'Aucun message disponible.';

    return messages.map(m => {
        const heure = new Date(m.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        const cat = m.categorie ? `[${m.categorie.toUpperCase()}]` : '';
        const prio = m.priorite ? m.priorite.emoji : '';
        return `${prio}${cat} ${heure} | ${m.groupeNom} | ${m.expediteur}: ${m.texte}`;
    }).join('\n');
}

// ============ AGENT INTENTION ============
// Comprend ce que veut le manager en langage naturel
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
- recherche : question précise sur un fait ("combien de rapports", "qui a envoyé", "as-tu envoyé", "quel manager", "combien de tickets")
- recommandation : demande de conseil ("que recommandes-tu", "que faire")
- reset : effacer historique

IMPORTANT : Les questions précises avec "combien", "qui", "as-tu", "quel" → toujours RECHERCHE, jamais brief.

Exemples :
- "Comment se passe mon centre ?" → brief
- "Que s'est-il passé ce matin ?" → brief
- "Combien de rapports envoyés ?" → recherche
- "As-tu envoyé des rapports ?" → recherche
- "Qui a clôturé ?" → recherche
- "Y a-t-il des urgences ?" → incidents
- "Comment travaille Eric ?" → performance, manager=Eric
- "Prépare un rapport journalier" → rapport`;

    const resultat = await appelerGroq(prompt, [
        { role: 'user', content: texte }
    ], historique);

    try {
        const clean = resultat.replace(/```json|```/g, '').trim();
        return JSON.parse(clean);
    } catch (e) {
        return { intention: 'inconnu', parametres: { question: texte }, confiance: 0.3 };
    }
}

// ============ AGENT INCIDENTS ============
async function agentIncidents(messages, historique = []) {
    const contexte = formaterMessagesStructures(messages);
    return appelerGroq(
        SYSTEM_WINNER_BET,
        [{
            role: 'user',
            content: `Analyse ces messages et identifie TOUS les incidents, pannes et urgences :\n\n${contexte}\n\nFocalise-toi uniquement sur les problèmes détectés.`
        }],
        historique
    );
}

// ============ AGENT RAPPORTS ============
async function agentRapports(messages, typeRapport, historique = []) {
    const contexte = formaterMessagesStructures(messages);
    return appelerGroq(
        SYSTEM_WINNER_BET,
        [{
            role: 'user',
            content: `Génère un rapport professionnel de type "${typeRapport}" basé sur ces messages :\n\n${contexte}`
        }],
        historique
    );
}

// ============ AGENT PERFORMANCE ============
async function agentPerformance(messages, nomManager = null, historique = []) {
    const contexte = formaterMessagesStructures(messages);
    const cible = nomManager ? `du manager ${nomManager}` : 'de tous les managers';
    return appelerGroq(
        SYSTEM_WINNER_BET,
        [{
            role: 'user',
            content: `Évalue la performance ${cible} basée sur ces messages :\n\n${contexte}\n\nDonne un score et des recommandations spécifiques.`
        }],
        historique
    );
}

async function agentRecherche(question, messages, historique = []) {
    const contexte = formaterMessagesStructures(messages);
    return appelerGroq(
        SYSTEM_WINNER_BET,
        [{
            role: 'user',
            content: `Messages disponibles :\n\n${contexte}\n\nQuestion : ${question}\n\nRéponds directement et précisément à cette question. Si c'est une question simple, réponds simplement sans format de bilan.`
        }],
        historique
    );
}

// ============ AGENT RECOMMANDATIONS ============
async function agentRecommandations(messages, historique = []) {
    const contexte = formaterMessagesStructures(messages);
    return appelerGroq(
        SYSTEM_WINNER_BET,
        [{
            role: 'user',
            content: `Basé sur ces messages :\n\n${contexte}\n\nDonne des recommandations concrètes et prioritaires pour le Center Manager. Chaque recommandation doit avoir une action immédiate associée.`
        }],
        historique
    );
}

// ============ AGENT BRIEF PRINCIPAL ============
async function agentBrief(messages, historique = []) {
    if (messages.length === 0) return '📭 Aucun message reçu pour cette période.';
    const contexte = formaterMessagesStructures(messages);
    return appelerGroq(
        SYSTEM_WINNER_BET,
        [{
            role: 'user',
            content: `Voici les messages reçus dans les groupes WhatsApp de Winner Bet Kinkole :\n\n${contexte}\n\nGénère le brief complet en suivant exactement le format défini.`
        }],
        historique
    );
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
