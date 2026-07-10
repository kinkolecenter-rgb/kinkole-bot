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

const MOTS_URGENCE = [
    'urgent', 'urgence', 'sos', 'critique', 'bloqué', 'bloque',
    'panne', 'offline', 'arrêt', 'arret', 'problème grave', 'alarme',
    'vol', 'accident', 'blessé', 'police', 'feu', 'incendie'
];

const MOTS_INCIDENT = [
    'problème', 'probleme', 'erreur', 'bug', 'échec', 'echec',
    'retard', 'absent', 'manquant', 'cassé', 'casse', 'hors service',
    'ne fonctionne pas', 'ne marche pas', 'pénalisé', 'penalise'
];

const MOTS_VALIDATION = [
    'ok', 'validé', 'valide', 'approuvé', 'approuve', 'confirmé',
    'confirme', 'terminé', 'termine', 'fait', 'réglé', 'regle',
    'résolu', 'resolu'
];

const MOTS_PAIEMENT = [
    'paiement', 'ticket', 'collecte', 'coffre', 'caisse',
    'orange money', 'mpesa', 'airtel money', 'versement',
    'remboursement', 'facture', 'montant', 'franc', 'dollar'
];

const MOTS_PRESENCE = [
    'présent', 'present', 'absent', 'arrivé', 'arrive',
    'ouverture', 'fermeture', 'équipe', 'equipe', 'agent',
    'caissier', 'manager', 'composition'
];

const MOTS_PANNE = [
    'panne', 'connexion', 'réseau', 'reseau', 'flybox', 'onduleur',
    'générateur', 'generateur', 'électricité', 'electricite',
    'pos', 'terminal', 'imprimante', 'serveur', 'internet'
];

function classifier(texte) {
    const t = texte.toLowerCase();

    if (MOTS_URGENCE.some(m => t.includes(m))) return CATEGORIES.URGENCE;
    if (MOTS_PANNE.some(m => t.includes(m))) return CATEGORIES.PANNE;
    if (MOTS_INCIDENT.some(m => t.includes(m))) return CATEGORIES.INCIDENT;
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
        présence:    { niveau: 1, emoji: '🟢', label: 'INFO' },
        validation:  { niveau: 1, emoji: '🟢', label: 'INFO' },
        information: { niveau: 0, emoji: '⚪', label: 'NEUTRE' },
        hors_sujet:  { niveau: 0, emoji: '⚪', label: 'NEUTRE' }
    };
    return priorites[categorie] || priorites.information;
}

function analyserMessage(message) {
    const categorie = classifier(message.texte);
    const priorite = getPriorite(categorie);
    return { ...message, categorie, priorite };
}

function detecterTendances(messages) {
    const compteurs = {};
    messages.forEach(m => {
        const cat = m.categorie || classifier(m.texte);
        compteurs[cat] = (compteurs[cat] || 0) + 1;
    });

    const tendances = [];
    if (compteurs.urgence >= 2) tendances.push(`🔴 ${compteurs.urgence} urgences détectées`);
    if (compteurs.panne >= 3) tendances.push(`🟠 ${compteurs.panne} pannes signalées`);
    if (compteurs.incident >= 5) tendances.push(`🟠 ${compteurs.incident} incidents`);
    if (compteurs.paiement >= 5) tendances.push(`🟡 ${compteurs.paiement} messages sur les paiements`);

    return tendances;
}

function extraireUrgences(messages) {
    return messages
        .map(m => analyserMessage(m))
        .filter(m => m.priorite.niveau >= 3)
        .sort((a, b) => b.priorite.niveau - a.priorite.niveau);
}

module.exports = {
    analyserMessage,
    detecterTendances,
    extraireUrgences,
    classifier,
    getPriorite,
    CATEGORIES
};
