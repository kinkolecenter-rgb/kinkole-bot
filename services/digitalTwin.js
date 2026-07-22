/**
 * 🏢 DIGITAL TWIN — Jumeau numérique du centre Kinkole
 * 
 * Maintient un état temps réel du centre en mémoire Redis.
 * Mis à jour automatiquement à chaque message entrant.
 * Répond à : "Comment se porte le centre ?"
 */

const config = require('../config');

const CLE_TWIN       = 'twin:etat_centre5';
const CLE_HISTORIQUE = 'twin:historique'; // snapshots horaires
const TTL_TWIN       = 60 * 60 * 24;     // 24h
const TTL_HISTO      = 60 * 60 * 24 * 7; // 7 jours

// ─── Structure de l'état par défaut ──────────────────────────────────────────
function etatVide() {
    return {
        // Horodatage
        derniereMaj: null,
        dateJournee: null,

        // Personnel présent (déduit des messages)
        personnel: {
            managersActifs:    [],  // [{ jid, nom, heureArrivee }]
            caissiers:         [],  // noms extraits du rapport ouverture
            pr:                [],
            agentsAbsents:     []
        },

        // Rapports du jour
        rapports: {
            ouverture:          false,
            fixture:            false,
            coffre_matin:       false,
            coffre_soir:        false,
            fermeture:          false,
            connexion:          0,   // compteur
            composition:        false
        },

        // Incidents ouverts
        incidents: {
            ouverts:           [],   // [{ id, type, description, heure, manager }]
            resolus:           [],
            total_jour:        0
        },

        // État matériel (déduit des messages)
        materiel: {
            connexion:         'inconnu',  // ok | lent | coupé | inconnu
            generateur:        'inconnu',
            imprimante:        'inconnu',
            flybox:            'inconnu',
            pos:               'inconnu'
        },

        // Métriques financières (si disponibles)
        finance: {
            usd_jour:          null,
            coffre_statut:     null,
            pages_fixtures:    null
        },

        // Santé globale calculée (0-100)
        score_sante: 100,
        niveau:      'OPTIMAL',    // OPTIMAL | BON | DÉGRADÉ | CRITIQUE
        alertes:     []
    };
}

// ─── Module principal ─────────────────────────────────────────────────────────
module.exports = function creerDigitalTwin(redis) {

    // ── Lecture de l'état actuel ──────────────────────────────────────────────
    const lireEtat = async () => {
        try {
            const raw = await redis.get(CLE_TWIN);
            if (!raw) return etatVide();
            return JSON.parse(raw);
        } catch (e) {
            return etatVide();
        }
    };

    // ── Sauvegarde ────────────────────────────────────────────────────────────
    const sauvegarder = async (etat) => {
        try {
            etat.derniereMaj = Date.now();
            etat.score_sante = calculerScore(etat);
            etat.niveau      = niveauDepuisScore(etat.score_sante);
            await redis.set(CLE_TWIN, JSON.stringify(etat), 'EX', TTL_TWIN);
        } catch (e) {
            console.error('❌ Twin sauvegarde:', e.message);
        }
    };

    // ── Mise à jour depuis un message entrant ─────────────────────────────────
    const mettreAJourDepuisMessage = async (message, typeRapport = null) => {
        const etat = await lireEtat();
        const texte = (message.texte || '').toLowerCase();
        const jid   = message.expediteurJid || '';
        const nom   = message.expediteur    || 'Inconnu';
        const heure = new Date().toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit', timeZone:'Africa/Kinshasa' });

        // Réinitialiser si nouveau jour
        const aujourd = new Date().toLocaleDateString('fr-FR', { timeZone: 'Africa/Kinshasa' });
        if (etat.dateJournee !== aujourd) {
            const fresh = etatVide();
            fresh.dateJournee = aujourd;
            Object.assign(etat, fresh);
        }

        // ── 1. Managers actifs ────────────────────────────────────────────────
        if (jid && !etat.personnel.managersActifs.find(m => m.jid === jid)) {
            etat.personnel.managersActifs.push({ jid, nom, heureArrivee: heure });
        }

        // ── 2. Rapports ───────────────────────────────────────────────────────
        if (typeRapport) {
            switch (typeRapport) {
                case 'ouverture':
                    etat.rapports.ouverture = true;
                    _extrairePersonnelOuverture(etat, message.texte || '');
                    break;
                case 'fixture':
                    etat.rapports.fixture = true;
                    _extraireFinanceFixture(etat, message.texte || '');
                    break;
                case 'coffre':
                    if (new Date().getHours() < 15) etat.rapports.coffre_matin = true;
                    else etat.rapports.coffre_soir = true;
                    etat.finance.coffre_statut = texte.includes('hormis') ? 'anomalie' : 'ok';
                    break;
                case 'fermeture':         etat.rapports.fermeture   = true; break;
                case 'details_connexion': etat.rapports.connexion++;         break;
                case 'composition':       etat.rapports.composition = true;  break;
            }
        }

        // ── 3. État matériel (déduit du texte) ───────────────────────────────
        _mettreAJourMateriel(etat, texte);

        // ── 4. Incidents ──────────────────────────────────────────────────────
        _detecterIncidents(etat, texte, nom, heure);

        // ── 5. Alertes ────────────────────────────────────────────────────────
        etat.alertes = _calculerAlertes(etat);

        await sauvegarder(etat);
    };

    // ── Résoudre un incident ──────────────────────────────────────────────────
    const marquerIncidentResolu = async (machineId) => {
        const etat = await lireEtat();
        const idx  = etat.incidents.ouverts.findIndex(i => i.id === String(machineId));
        if (idx !== -1) {
            const inc = etat.incidents.ouverts.splice(idx, 1)[0];
            inc.resoluA = Date.now();
            etat.incidents.resolus.push(inc);
        }
        await sauvegarder(etat);
    };

    // ── Mettre à jour le montant USD ──────────────────────────────────────────
    const enregistrerUSD = async (montant) => {
        const etat = await lireEtat();
        etat.finance.usd_jour = montant;
        await sauvegarder(etat);
    };

    // ── Rapport texte compact (pour l'IA) ────────────────────────────────────
    const genererResume = async () => {
        const etat = await lireEtat();
        return _formaterEtat(etat);
    };

    // ── Réponse naturelle "Comment se porte le centre ?" ─────────────────────
    const repondreEtatCentre = async () => {
        const etat = await lireEtat();
        const pct  = etat.score_sante;
        const ico  = pct >= 85 ? '🟢' : pct >= 60 ? '🟡' : '🔴';

        let msg = `${ico} *ÉTAT DU CENTRE — ${etat.dateJournee || 'Aujourd\'hui'}*\n`;
        msg += `_Mise à jour : ${etat.derniereMaj ? new Date(etat.derniereMaj).toLocaleTimeString('fr-FR', { timeZone:'Africa/Kinshasa' }) : '—'}_\n\n`;

        // Score
        msg += `📊 *Santé globale :* ${pct}/100 — ${etat.niveau}\n\n`;

        // Personnel
        const nbMgr = etat.personnel.managersActifs.length;
        msg += `👥 *Personnel actif :* ${nbMgr > 0 ? nbMgr + ' manager(s)' : 'Aucun détecté'}\n`;
        if (nbMgr > 0) {
            etat.personnel.managersActifs.slice(0, 4).forEach(m => {
                msg += `  • ${m.nom} (depuis ${m.heureArrivee})\n`;
            });
        }
        if (etat.personnel.caissiers.length > 0) {
            msg += `  👤 Caissiers : ${etat.personnel.caissiers.join(', ')}\n`;
        }
        msg += '\n';

        // Rapports
        const r = etat.rapports;
        msg += `📋 *Rapports :*\n`;
        msg += `  ${r.ouverture ? '✅' : '❌'} Ouverture\n`;
        msg += `  ${r.fixture   ? '✅' : '❌'} Fixture\n`;
        msg += `  ${r.coffre_matin ? '✅' : '❌'} Coffre matin\n`;
        msg += `  ${r.coffre_soir  ? '✅' : '❌'} Coffre soir\n`;
        msg += `  ${r.fermeture    ? '✅' : '❌'} Fermeture\n`;
        if (r.connexion > 0) msg += `  ✅ Connexion (${r.connexion} rapport(s))\n`;
        msg += '\n';

        // Matériel
        const mat = etat.materiel;
        const matProblemes = Object.entries(mat).filter(([,v]) => v === 'en panne' || v === 'lent' || v === 'coupé');
        if (matProblemes.length > 0) {
            msg += `⚠️ *Matériel en anomalie :*\n`;
            matProblemes.forEach(([k, v]) => { msg += `  🔴 ${k} : ${v}\n`; });
            msg += '\n';
        } else {
            msg += `🖥️ *Matériel :* Aucun problème signalé\n\n`;
        }

        // Incidents
        const nbOuverts = etat.incidents.ouverts.length;
        msg += `🚨 *Incidents :* ${nbOuverts > 0 ? nbOuverts + ' ouvert(s)' : 'Aucun ✅'}`;
        if (nbOuverts > 0) {
            msg += '\n';
            etat.incidents.ouverts.slice(0, 5).forEach(i => {
                msg += `  ⚠️ ${i.type} (${i.heure}) — ${i.description.substring(0, 50)}\n`;
            });
        }
        msg += '\n';

        // Finance
        if (etat.finance.usd_jour) msg += `💵 *USD jour :* ${etat.finance.usd_jour}$\n`;
        if (etat.finance.coffre_statut) {
            msg += `🔒 *Coffre :* ${etat.finance.coffre_statut === 'ok' ? '✅ OK' : '⚠️ Anomalie'}\n`;
        }

        // Alertes critiques
        if (etat.alertes.length > 0) {
            msg += `\n🔔 *Alertes :*\n`;
            etat.alertes.forEach(a => { msg += `  ${a}\n`; });
        }

        return msg;
    };

    // ── Snapshot horaire (pour prévisions) ───────────────────────────────────
    const sauvegarderSnapshot = async () => {
        try {
            const etat = await lireEtat();
            const snap = { ...etat, ts: Date.now() };
            await redis.lpush(CLE_HISTORIQUE, JSON.stringify(snap));
            await redis.ltrim(CLE_HISTORIQUE, 0, 167); // 7 jours * 24h
            await redis.expire(CLE_HISTORIQUE, TTL_HISTO);
        } catch (e) {}
    };

    // ── Réinitialiser pour nouveau jour ───────────────────────────────────────
    const reinitialiserJour = async () => {
        const fresh = etatVide();
        fresh.dateJournee = new Date().toLocaleDateString('fr-FR', { timeZone: 'Africa/Kinshasa' });
        await sauvegarder(fresh);
        console.log('🔄 Digital Twin réinitialisé pour la nouvelle journée.');
    };

    return {
        lireEtat,
        mettreAJourDepuisMessage,
        marquerIncidentResolu,
        enregistrerUSD,
        genererResume,
        repondreEtatCentre,
        sauvegarderSnapshot,
        reinitialiserJour
    };
};

// ─── Fonctions privées ────────────────────────────────────────────────────────

function _extrairePersonnelOuverture(etat, texte) {
    // Caissiers
    const matchCaisse = texte.match(/[ée]quipe\s+matin\s+caisse\s*:\s*([^\n]+)/i);
    if (matchCaisse) {
        etat.personnel.caissiers = matchCaisse[1].split(/[,&\/]/).map(s => s.trim()).filter(Boolean);
    }
    // PR
    const matchPR = texte.match(/PR\s*:\s*\d+\s*[—-]\s*([^\n]+)/i);
    if (matchPR) {
        etat.personnel.pr = matchPR[1].split(/[,&\/]/).map(s => s.trim()).filter(Boolean);
    }
    // Pages fixtures
    const matchPages = texte.match(/[Pp]age\s*:\s*(\d+)/);
    if (matchPages) etat.finance.pages_fixtures = parseInt(matchPages[1]);
}

function _extraireFinanceFixture(etat, texte) {
    const matchAchat = texte.match(/[Aa]chat\s*:\s*([\d.]+)/);
    const matchVente = texte.match(/[Vv]ente\s*:\s*([\d.]+)/);
    // Stocké dans materiel pour info (pas de champ taux dédié)
    if (matchAchat) etat.finance.taux_achat = matchAchat[1];
    if (matchVente) etat.finance.taux_vente = matchVente[1];
}

function _mettreAJourMateriel(etat, texte) {
    const pannePatterns = [
        { keys: ['flybox', 'connexion', 'internet', 'réseau', 'reseau'], champ: 'connexion' },
        { keys: ['générateur', 'generateur', 'courant', 'électricité', 'electricite'], champ: 'generateur' },
        { keys: ['imprimante'], champ: 'imprimante' },
        { keys: ['flybox'], champ: 'flybox' },
        { keys: ['pos', 'terminal'], champ: 'pos' }
    ];

    for (const p of pannePatterns) {
        for (const k of p.keys) {
            if (!texte.includes(k)) continue;
            if (texte.includes('panne') || texte.includes('coupé') || texte.includes('hors service') || texte.includes('ne fonctionne')) {
                etat.materiel[p.champ] = 'en panne';
            } else if (texte.includes('lent') || texte.includes('lente') || texte.includes('faible')) {
                etat.materiel[p.champ] = 'lent';
            } else if (texte.includes('ok') || texte.includes('rétabli') || texte.includes('retabli') || texte.includes('normal')) {
                etat.materiel[p.champ] = 'ok';
            }
        }
    }
}

function _detecterIncidents(etat, texte, auteur, heure) {
    const TYPES_INCIDENTS = [
        { mots: ['vol', 'volé', 'vole'],                          type: 'Vol',          priorite: 4 },
        { mots: ['bagarre', 'agression', 'attaque'],               type: 'Sécurité',     priorite: 4 },
        { mots: ['perte argent', 'argent manquant', 'manque'],     type: 'Finance',      priorite: 3 },
        { mots: ['générateur', 'generateur', 'pas de courant'],    type: 'Électricité',  priorite: 3 },
        { mots: ['internet coupé', 'connexion coupée', 'flybox'],  type: 'Connexion',    priorite: 2 },
        { mots: ['imprimante en panne', 'imprimante bloquée'],     type: 'Matériel',     priorite: 2 },
        { mots: ['absent', 'pas venu', 'manquant'],                type: 'Absence',      priorite: 2 }
    ];

    for (const pattern of TYPES_INCIDENTS) {
        const detected = pattern.mots.some(m => texte.includes(m));
        if (!detected) continue;
        // Éviter doublons récents (même type dans les 30min)
        const recent = etat.incidents.ouverts.find(i =>
            i.type === pattern.type &&
            (Date.now() - (i.ts || 0)) < 30 * 60 * 1000
        );
        if (!recent) {
            etat.incidents.ouverts.push({
                id:          `INC-${Date.now()}`,
                type:        pattern.type,
                priorite:    pattern.priorite,
                description: texte.substring(0, 120),
                auteur,
                heure,
                ts:          Date.now()
            });
            etat.incidents.total_jour++;
        }
    }
}

function _calculerAlertes(etat) {
    const alertes = [];
    const h = new Date().getHours();

    if (h >= 9  && !etat.rapports.ouverture) alertes.push('⚠️ Rapport ouverture non reçu');
    if (h >= 11 && !etat.rapports.fixture)   alertes.push('⚠️ Fixture non envoyée');
    if (h >= 22 && !etat.rapports.coffre_soir) alertes.push('🔴 Coffre soir manquant');

    const critiques = etat.incidents.ouverts.filter(i => i.priorite >= 4);
    if (critiques.length > 0) alertes.push(`🚨 ${critiques.length} incident(s) critique(s) ouvert(s)`);

    const pannes = Object.values(etat.materiel).filter(v => v === 'en panne');
    if (pannes.length >= 2) alertes.push(`🔴 ${pannes.length} équipements en panne simultanément`);

    return alertes;
}

function calculerScore(etat) {
    let score = 100;

    // Rapports manquants selon l'heure
    const h = new Date().getHours();
    if (h >= 9  && !etat.rapports.ouverture) score -= 15;
    if (h >= 11 && !etat.rapports.fixture)   score -= 10;
    if (h >= 22 && !etat.rapports.fermeture) score -= 15;

    // Incidents
    score -= etat.incidents.ouverts.length * 8;
    score -= etat.incidents.ouverts.filter(i => i.priorite >= 4).length * 10;

    // Matériel
    const pannes = Object.values(etat.materiel).filter(v => v === 'en panne').length;
    score -= pannes * 5;

    return Math.max(0, Math.min(100, score));
}

function niveauDepuisScore(score) {
    if (score >= 85) return 'OPTIMAL';
    if (score >= 65) return 'BON';
    if (score >= 40) return 'DÉGRADÉ';
    return 'CRITIQUE';
}

function _formaterEtat(etat) {
    return JSON.stringify({
        score:      etat.score_sante,
        niveau:     etat.niveau,
        rapports:   etat.rapports,
        personnel:  { nb: etat.personnel.managersActifs.length, noms: etat.personnel.managersActifs.map(m => m.nom) },
        incidents:  { ouverts: etat.incidents.ouverts.length, details: etat.incidents.ouverts.slice(0, 5) },
        materiel:   etat.materiel,
        finance:    etat.finance,
        alertes:    etat.alertes
    }, null, 2);
}
