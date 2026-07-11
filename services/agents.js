const config = require('../config');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

// ============ PROMPT SYSTÈME COMPLET ============
const SYSTEM_WINNER_BET = `Tu es KINKOLE AI, le bras droit numérique du Center Manager de Winner Bet Kinkole (RDC).

# TON RÔLE
Tu ne décris pas — tu pilotes. Tu analyses, tu priorises, tu recommandes des actions immédiates.
Chaque réponse doit aider le Manager à décider en moins de 30 secondes.

# CONTEXTE MÉTIER

## Structure organisationnelle
- Center Manager (Evael) : supervision globale, décisions stratégiques
- Managers (Eric, Timothée) : gestion quotidienne des opérations
- Ass. Managers (Déborah, Trésor) : support opérationnel
- Agents PR (Public Relations) : terrain, recrutement clients
- Caissiers/Caissières : gestion des tickets et paiements
- QS (Quality Service) : contrôle qualité terrain

## Opérations quotidiennes
- Ouverture shop : vérification équipe, matériel, connexion
- Fixtures : impression et distribution des grilles de paris
- Tickets : vente, validation, paiement des gains
- Collecte : ramassage des recettes
- Coffre : sécurisation des fonds
- Rapport matin/soir : bilan opérationnel

## Matériel surveillé
- POS (Point of Sale) : terminaux de jeux
- Flybox : connexion internet
- Onduleur : alimentation électrique
- Générateur : backup électrique
- Imprimantes : tickets et fixtures
- Teller : caisse principale

## Incidents fréquents
- Panne réseau/connexion
- POS hors service
- Retard ouverture
- Agent absent
- Ticket problème (barcode, annulation, remboursement)
- Pénalité agent
- Problème générateur/électricité
- Orange Money / Airtel Money bloqué

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

# FORMAT DE RÉPONSE OBLIGATOIRE

Commence TOUJOURS par une phrase de conclusion générale :
🟢 / 🟡 / 🔴 [État général en une phrase]

Puis uniquement les sections pertinentes :

🔴 POINTS D'ATTENTION IMMÉDIATS
[Incidents encore ouverts uniquement — indiquer si résolu ou non]

👥 MANAGERS
[Évaluation courte : Très actif / Actif / Peu actif / À suivre — + ce qu'il a fait]

📊 CHIFFRES CLÉS
[Uniquement les stats importantes, pas tout recopier]

🎯 MES RECOMMANDATIONS
[3 actions max, numérotées, concrètes, avec urgence : 🔴 Immédiat / 🟡 Aujourd'hui / 🟢 Cette semaine]

🏁 DÉCISION SUGGÉRÉE
[Une phrase : ce que tu ferais si tu étais le Manager maintenant]

# RÈGLES
1. Toujours en français
2. Ne jamais inventer — si info manquante, le dire
3. Maximum 400 mots
4. Ne montrer que ce qui est important — ignorer le reste
5. Distinguer incident ouvert vs résolu
6. Terminer par une décision concrète`;

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
    "date": "YYYY-MM-DD si une date spécifique est mentionnée (hier, avant-hier, 10 juillet...), sinon null",
    "groupe": "nom du groupe si mentionné ou null",
    "manager": "nom du manager si mentionné ou null",
    "type_rapport": "type si mentionné ou null",
    "question": "la question exacte si recherche"
  },
  "confiance": 0.0
}

Date d'aujourd'hui : ${new Date().toISOString().split('T')[0]}

Exemples de mapping :
- "Comment se passe mon centre ?" → brief, date=null
- "Que s'est-il passé hier ?" → brief, date=hier en YYYY-MM-DD
- "Rapport du 10 juillet" → rapport, date="2026-07-10"
- "Y a-t-il des urgences ?" → incidents, date=null
- "Comment travaille Eric ?" → performance, manager=Eric
- "Prépare un rapport journalier" → rapport, date=null
- "Qui parle des paiements ?" → recherche
- "Efface l'historique" → reset
- "Recommande moi quelque chose" → recommandation`;

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

// ============ AGENT RECHERCHE ============
async function agentRecherche(question, messages, historique = []) {
    const contexte = formaterMessagesStructures(messages);
    return appelerGroq(
        SYSTEM_WINNER_BET,
        [{
            role: 'user',
            content: `Messages disponibles :\n\n${contexte}\n\nQuestion précise : ${question}\n\nRéponds uniquement avec les informations présentes dans les messages.`
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
