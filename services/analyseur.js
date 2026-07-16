const CATEGORIES = {
    INCIDENT: 'incident',
    URGENCE: 'urgence',
    VALIDATION: 'validation',
    RAPPORT: 'rapport',
    PRESENCE: 'présence',
    PANNE: 'panne',
    PAIEMENT: 'paiement',
    INFORMATION: 'information',
    HORS_SUJET: 'hors_sujet'
};

// ✅ Fix 6 : mots resserrés — évite les faux positifs sur rapports normaux
const MOTS_URGENCE = [
    'urgent', 'urgence', 'sos', 'critique', 'bloqué', 'bloque',
    'arrêt total', 'arret total', 'problème grave', 'alarme',
    'vol', 'accident', 'blessé', 'police', 'feu', 'incendie',
    'attaque', 'agression', 'cambriolage'
];

const MOTS_INCIDENT = [
    'problème', 'probleme', 'erreur', 'bug', 'échec', 'echec',
    'retard', 'absent', 'manquant', 'cassé', 'casse', 'hors service',
    'ne fonctionne pas', 'ne marche pas', 'pénalisé', 'penalise',
    'bloqué', 'bloque', 'en panne', 'signaler', 'signalé'
];

const MOTS_VALIDATION = [
    'ok', 'validé', 'valide', 'approuvé', 'approuve', 'confirmé',
    'confirme', 'terminé', 'termine', 'fait', 'réglé', 'regle',
    'résolu', 'resolu', 'clôturé', 'cloturé', 'tout est ok'
];

// ✅ Fix 1 : retiré 'ticket', 'coffre', 'caisse', 'franc', 'dollar' — trop génériques
const MOTS_PAIEMENT = [
    'orange money', 'mpesa', 'airtel money',
    'versement', 'remboursement', 'facture',
    'paiement gain', 'payer le client', 'collecte argent'
];

const MOTS_PRESENCE = [
    'présent', 'present', 'arrivé', 'arrive',
    'équipe', 'equipe', 'composition équipe',
    'agent absent', 'manager absent', 'caissière absente'
];

// ✅ Fix 2 : retiré 'connexion', 'pos', 'terminal' — capturent les rapports normaux
const MOTS_PANNE = [
    'flybox en panne', 'onduleur en panne', 'générateur en panne',
    'generateur en panne', 'électricité coupée', 'electricite coupee',
    'internet coupé', 'réseau coupé', 'reseau coupe',
    'imprimante en panne', 'serveur down', 'offline',
    'pas de courant', 'coupure'
];

const MOTS_RAPPORT = [
    'ouverture du', 'bonjour team', 'dernier rapport',
    'détails connexion', 'details connexion', 'connexion 12h',
    'connexion 15h', 'connexion 17h', 'taux de change',
    'fixtures sport', 'rapport reste', 'reste caution',
    'état d activités', 'etat d activites', 'rapport pos'
];

function classifier(texte) {
    const t = texte.toLowerCase();

    // Ordre de priorité : urgence > panne > incident > rapport > paiement > présence > validation
    if (MOTS_URGENCE.some(m => t.includes(m))) return CATEGORIES.URGENCE;
    if (MOTS_PANNE.some(m => t.includes(m))) return CATEGORIES.PANNE;
    if (MOTS_INCIDENT.some(m => t.includes(m))) return CATEGORIES.INCIDENT;
    if (MOTS_RAPPORT.some(m => t.includes(m))) return CATEGORIES.RAPPORT;
    if (MOTS_PAIEMENT.some(m => t.includes(m))) return CATEGORIES.PAIEMENT;
    if (MOTS_PRESENCE.some(m => t.includes(m))) return CATEGORIES.PRESENCE;
    if (MOTS_VALIDATION.some(m => t.includes(m))) return CATEGORIES.VALIDATION;
    if (texte.length > 20) return CATEGORIES.RAPPORT;
    return CATEGORIES.INFORMATION;
}

function getPriorite(categorie) {
    const priorites = {
        urgence:     { niveau: 4, emoji: '🔴', label: 'CRITIQUE' },
        panne:       { niveau: 3, emoji: '🟠', label: 'IMPORTANT' },
        incident:    { niveau: 3, emoji: '🟠', label: 'IMPORTANT' },
        paiement:    { niveau: 2, emoji: '🟡', label: 'MOYEN' },
        rapport:     { niveau: 2, emoji: '🟡', label: 'MOYEN' },
        'présence':  { niveau: 1, emoji: '🟢', label: 'INFO' },
        validation:  { niveau: 1, emoji: '🟢', label: 'INFO' },
        information: { niveau: 0, emoji: '⚪', label: 'NEUTRE' },
        hors_sujet:  { niveau: 0, emoji: '⚪', label: 'NEUTRE' }
    };
    return priorites[categorie] || priorites.information;
}

function analyserMessage(message) {
    const categorie = classifier(message.texte || '');
    const priorite = getPriorite(categorie);
    return { ...message, categorie, priorite };
}

// ✅ Fix 3 : seuils abaissés — 1 urgence suffit, 2 pannes suffisent
function detecterTendances(messages) {
    const compteurs = {};
    messages.forEach(m => {
        const cat = m.categorie || classifier(m.texte || '');
        compteurs[cat] = (compteurs[cat] || 0) + 1;
    });

    const tendances = [];
    if (compteurs.urgence >= 1) tendances.push(`🔴 ${compteurs.urgence} urgence(s) détectée(s)`);
    if (compteurs.panne >= 2) tendances.push(`🟠 ${compteurs.panne} pannes signalées`);
    if (compteurs.incident >= 3) tendances.push(`🟠 ${compteurs.incident} incidents`);
    if (compteurs.paiement >= 3) tendances.push(`🟡 ${compteurs.paiement} messages paiements`);
    if (compteurs.validation >= 5) tendances.push(`🟢 ${compteurs.validation} validations reçues`);

    return tendances;
}

function extraireUrgences(messages) {
    return messages
        .map(m => analyserMessage(m))
        .filter(m => m.priorite.niveau >= 3)
        .sort((a, b) => b.priorite.niveau - a.priorite.niveau);
}

// ✅ NOUVEAU : Brief local sans IA — fallback quand OpenRouter est indisponible
function genererBriefLocal(messages) {
    if (!messages || messages.length === 0) {
        return '📭 Aucun message reçu pour cette période.';
    }

    const analyses = messages.map(m => analyserMessage(m));
    const tendances = detecterTendances(analyses);
    const urgences = extraireUrgences(analyses);

    const compteurs = {};
    const parManager = {};
    analyses.forEach(m => {
        const cat = m.categorie || 'information';
        compteurs[cat] = (compteurs[cat] || 0) + 1;
        const exp = m.expediteur || 'Inconnu';
        if (!parManager[exp]) parManager[exp] = 0;
        parManager[exp]++;
    });

    // État général
    let etatEmoji = '🟢';
    if (urgences.some(u => u.priorite.niveau >= 4)) etatEmoji = '🔴';
    else if (urgences.some(u => u.priorite.niveau >= 3)) etatEmoji = '🟡';

    let brief = `${etatEmoji} *BRIEF LOCAL* _(IA indisponible)_\n`;
    brief += `_${messages.length} messages analysés_\n\n`;

    if (urgences.length > 0) {
        brief += `🔴 *POINTS D'ATTENTION*\n`;
        urgences.slice(0, 3).forEach(u => {
            const heure = new Date(u.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kinshasa' });
            brief += `${u.priorite.emoji} ${heure} | ${u.expediteur} : ${(u.texte || '').substring(0, 80)}...\n`;
        });
        brief += '\n';
    }

    if (tendances.length > 0) {
        brief += `📊 *TENDANCES*\n${tendances.join('\n')}\n\n`;
    }

    brief += `👥 *ACTIVITÉ MANAGERS*\n`;
    Object.entries(parManager)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .forEach(([nom, count]) => {
            brief += `• ${nom} : ${count} message(s)\n`;
        });

    brief += `\n📋 *RÉPARTITION*\n`;
    if (compteurs.rapport) brief += `✅ Rapports : ${compteurs.rapport}\n`;
    if (compteurs.incident) brief += `⚠️ Incidents : ${compteurs.incident}\n`;
    if (compteurs.panne) brief += `🟠 Pannes : ${compteurs.panne}\n`;
    if (compteurs.urgence) brief += `🔴 Urgences : ${compteurs.urgence}\n`;
    if (compteurs.validation) brief += `🟢 Validations : ${compteurs.validation}\n`;

    return brief;
}

// ✅ NOUVEAU : Résumé des incidents actifs sans IA
function resumerIncidents(messages) {
    const urgences = extraireUrgences(messages);
    if (urgences.length === 0) return '✅ Aucun incident ou urgence détecté dans les messages récents.';

    let txt = `🚨 *INCIDENTS DÉTECTÉS* (${urgences.length})\n\n`;
    urgences.forEach((u, i) => {
        const heure = new Date(u.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kinshasa' });
        txt += `${i + 1}. ${u.priorite.emoji} *${u.priorite.label}*\n`;
        txt += `   👤 ${u.expediteur} | ${u.groupeNom || ''} | ${heure}\n`;
        txt += `   💬 ${(u.texte || '').substring(0, 100)}\n\n`;
    });
    return txt;
}

module.exports = {
    analyserMessage,
    detecterTendances,
    extraireUrgences,
    genererBriefLocal,
    resumerIncidents,
    classifier,
    getPriorite,
    CATEGORIES
};
