/**
 * 🧠 MÉMOIRE PERMANENTE PAR MANAGER
 * 
 * Construit un profil évolutif sur plusieurs mois.
 * Détecte les patterns : retards habituels, jours difficiles, tendances.
 * Redis long terme (90 jours).
 */

const CLE_PROFIL    = (jid) => `profil:${jid}`;
const CLE_HISTORIQUE= (jid) => `historique:${jid}`;
const CLE_PATTERNS  = (jid) => `patterns:${jid}`;
const TTL_PROFIL    = 60 * 60 * 24 * 90;  // 90 jours
const TTL_HISTO     = 60 * 60 * 24 * 30;  // 30 jours

function profilVide(jid, nom) {
    return {
        jid,
        nom,
        premierContact: Date.now(),
        dernierContact:  null,

        // Ponctualité (heures d'ouverture déclarées)
        ponctualite: {
            heuresOuverture: [],     // [{ date, heure }]
            retardsMoyenMin:  null,
            retardsCount:     0,
            cibleHeure:       '08:00'
        },

        // Rapports
        rapports: {
            total:           0,
            parType:         {},   // { ouverture: 12, fixture: 10, ... }
            taux_completion: 100,
            consecutifs_ok:  0,
            manques:         []    // [{ date, type }]
        },

        // Incidents
        incidents: {
            declares:        0,
            resolus:         0,
            taux_resolution: 100,
            tempsResolutionMoyenH: null,
            types_frequents: {}    // { connexion: 3, panne: 1 }
        },

        // Jours/heures à risque (patterns)
        patterns: {
            jours_difficiles:   [],   // [1, 2] = lundi, mardi
            heures_pics:        [],
            incidents_recurrents: []
        },

        // Score global (0-100)
        score:          80,
        tendance:       'stable',   // hausse | baisse | stable
        badge:          null        // 'fiable' | 'en-progrès' | 'à-surveiller'
    };
}

module.exports = function creerMemoireManager(redis) {

    // ── Lire profil ───────────────────────────────────────────────────────────
    const lireProfil = async (jid, nom = 'Inconnu') => {
        try {
            const raw = await redis.get(CLE_PROFIL(jid));
            if (raw) return JSON.parse(raw);
            return profilVide(jid, nom);
        } catch (e) {
            return profilVide(jid, nom);
        }
    };

    // ── Sauvegarder profil ────────────────────────────────────────────────────
    const sauvegarderProfil = async (profil) => {
        try {
            profil.dernierContact = Date.now();
            profil.score    = calculerScore(profil);
            profil.tendance = calculerTendance(profil);
            profil.badge    = attribuerBadge(profil);
            await redis.set(CLE_PROFIL(profil.jid), JSON.stringify(profil), 'EX', TTL_PROFIL);
        } catch (e) {
            console.error('❌ MemoireManager sauvegarder:', e.message);
        }
    };

    // ── Enregistrer un rapport envoyé ────────────────────────────────────────
    const enregistrerRapport = async (jid, nom, typeRapport, texte = '') => {
        const profil = await lireProfil(jid, nom);
        profil.rapports.total++;
        profil.rapports.parType[typeRapport] = (profil.rapports.parType[typeRapport] || 0) + 1;
        profil.rapports.consecutifs_ok++;

        // Heure d'ouverture pour la ponctualité
        if (typeRapport === 'ouverture') {
            const matchHeure = texte.match(/(\d{1,2})[h:](\d{2})/);
            if (matchHeure) {
                const heure = `${matchHeure[1].padStart(2,'0')}:${matchHeure[2]}`;
                const dateStr = new Date().toLocaleDateString('fr-FR', { timeZone: 'Africa/Kinshasa' });
                profil.ponctualite.heuresOuverture.push({ date: dateStr, heure });
                // Garder 60 entrées max
                if (profil.ponctualite.heuresOuverture.length > 60) {
                    profil.ponctualite.heuresOuverture.shift();
                }
                _calculerPonctualite(profil);
            }
        }

        // Historique court terme
        await _ajouterHistorique(jid, { type: 'rapport', sousType: typeRapport, ts: Date.now() });
        await sauvegarderProfil(profil);
    };

    // ── Enregistrer un rapport manqué ────────────────────────────────────────
    const enregistrerRapportManque = async (jid, nom, typeRapport) => {
        const profil = await lireProfil(jid, nom);
        const dateStr = new Date().toLocaleDateString('fr-FR', { timeZone: 'Africa/Kinshasa' });
        profil.rapports.manques.push({ date: dateStr, type: typeRapport });
        if (profil.rapports.manques.length > 30) profil.rapports.manques.shift();
        profil.rapports.consecutifs_ok = 0;
        profil.rapports.taux_completion = _calculerTauxCompletion(profil);
        await sauvegarderProfil(profil);
    };

    // ── Enregistrer un incident déclaré ──────────────────────────────────────
    const enregistrerIncident = async (jid, nom, typeIncident) => {
        const profil = await lireProfil(jid, nom);
        profil.incidents.declares++;
        profil.incidents.types_frequents[typeIncident] = (profil.incidents.types_frequents[typeIncident] || 0) + 1;
        _mettreAJourJoursDifficiles(profil);
        await _ajouterHistorique(jid, { type: 'incident', sousType: typeIncident, ts: Date.now() });
        await sauvegarderProfil(profil);
    };

    // ── Enregistrer résolution ────────────────────────────────────────────────
    const enregistrerResolution = async (jid, nom, dureeHeures = null) => {
        const profil = await lireProfil(jid, nom);
        profil.incidents.resolus++;
        if (profil.incidents.declares > 0) {
            profil.incidents.taux_resolution = Math.round((profil.incidents.resolus / profil.incidents.declares) * 100);
        }
        if (dureeHeures !== null) {
            const total    = (profil.incidents.tempsResolutionMoyenH || dureeHeures) * (profil.incidents.resolus - 1);
            profil.incidents.tempsResolutionMoyenH = Math.round((total + dureeHeures) / profil.incidents.resolus * 10) / 10;
        }
        await sauvegarderProfil(profil);
    };

    // ── Résumé d'un manager ───────────────────────────────────────────────────
    const getResume = async (jid, nom = 'Inconnu') => {
        const profil = await lireProfil(jid, nom);
        return _formaterProfil(profil);
    };

    // ── Résumé de tous les managers ───────────────────────────────────────────
    const getResumeEquipe = async (managers) => {
        const profils = [];
        for (const [jid, info] of Object.entries(managers)) {
            const p = await lireProfil(jid, info.nom);
            profils.push(p);
        }
        profils.sort((a, b) => b.score - a.score);

        let txt = `👥 *PROFILS MANAGERS* _(Mémoire long terme)_\n\n`;
        profils.forEach((p, i) => {
            const emoji = p.score >= 85 ? '🟢' : p.score >= 65 ? '🟡' : '🔴';
            const tendance = p.tendance === 'hausse' ? '📈' : p.tendance === 'baisse' ? '📉' : '➡️';
            txt += `${i+1}. ${emoji} *${p.nom}* ${tendance} ${p.badge ? `[${p.badge}]` : ''}\n`;
            txt += `   Score : ${p.score}/100 | Rapports : ${p.rapports.total} | Taux : ${p.rapports.taux_completion}%\n`;
            if (p.ponctualite.retardsMoyenMin !== null) {
                txt += `   ⏱ Retard moyen ouverture : ${p.ponctualite.retardsMoyenMin} min\n`;
            }
            if (p.incidents.declares > 0) {
                txt += `   🚨 Incidents : ${p.incidents.declares} déclarés, ${p.incidents.taux_resolution}% résolus\n`;
            }
            if (p.patterns.jours_difficiles.length > 0) {
                const jours = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
                txt += `   📅 Jours difficiles : ${p.patterns.jours_difficiles.map(j => jours[j]).join(', ')}\n`;
            }
            txt += '\n';
        });
        return txt;
    };

    // ── Détection de pattern récurrent ───────────────────────────────────────
    const detecterPatterns = async (jid, nom = 'Inconnu') => {
        const profil = await lireProfil(jid, nom);
        const alertes = [];

        // Retards chroniques
        if (profil.ponctualite.retardsMoyenMin !== null && profil.ponctualite.retardsMoyenMin > 15) {
            alertes.push(`⏱️ *${nom}* est en retard en moyenne de ${profil.ponctualite.retardsMoyenMin} min à l'ouverture`);
        }

        // Taux de complétion faible
        if (profil.rapports.taux_completion < 80) {
            alertes.push(`📋 *${nom}* n'envoie que ${profil.rapports.taux_completion}% de ses rapports`);
        }

        // Incidents récurrents
        const topIncident = Object.entries(profil.incidents.types_frequents)
            .sort((a, b) => b[1] - a[1])[0];
        if (topIncident && topIncident[1] >= 3) {
            alertes.push(`🔁 *${nom}* : incidents "${topIncident[0]}" répétés ${topIncident[1]} fois`);
        }

        return alertes;
    };

    return {
        lireProfil,
        enregistrerRapport,
        enregistrerRapportManque,
        enregistrerIncident,
        enregistrerResolution,
        getResume,
        getResumeEquipe,
        detecterPatterns
    };
};

// ─── Fonctions privées ────────────────────────────────────────────────────────

function _calculerPonctualite(profil) {
    const cible = profil.ponctualite.cibleHeure;
    const [ch, cm] = cible.split(':').map(Number);
    const cibleMin = ch * 60 + cm;

    const retards = profil.ponctualite.heuresOuverture
        .map(e => {
            const [h, m] = e.heure.split(':').map(Number);
            return (h * 60 + m) - cibleMin;
        })
        .filter(r => r > 0);

    profil.ponctualite.retardsCount = retards.length;
    profil.ponctualite.retardsMoyenMin = retards.length > 0
        ? Math.round(retards.reduce((a, b) => a + b, 0) / retards.length)
        : 0;
}

function _calculerTauxCompletion(profil) {
    const total   = profil.rapports.total + profil.rapports.manques.length;
    if (total === 0) return 100;
    return Math.round((profil.rapports.total / total) * 100);
}

function _mettreAJourJoursDifficiles(profil) {
    const jourSemaine = new Date().getDay(); // 0=dim, 1=lun...
    const counts = profil.patterns.jours_difficiles;
    // Tracker les jours où il y a le plus d'incidents
    if (!profil._jourCounts) profil._jourCounts = {};
    profil._jourCounts[jourSemaine] = (profil._jourCounts[jourSemaine] || 0) + 1;
    // Jours difficiles = ceux avec >= 2 incidents
    profil.patterns.jours_difficiles = Object.entries(profil._jourCounts)
        .filter(([, v]) => v >= 2)
        .map(([k]) => parseInt(k));
}

async function _ajouterHistorique(jid, event) {
    // Note: cette fonction utilise redis via closure — non applicable ici
    // Elle est réservée à un usage futur si on expose redis dans le module
}

function calculerScore(profil) {
    let score = 70;

    // Taux de complétion rapports
    score += Math.round(profil.rapports.taux_completion * 0.15); // max +15

    // Ponctualité
    const retard = profil.ponctualite.retardsMoyenMin || 0;
    if (retard <= 5)  score += 10;
    else if (retard <= 15) score += 5;
    else score -= 5;

    // Incidents
    const txRes = profil.incidents.taux_resolution;
    if (txRes >= 90) score += 5;
    else if (txRes < 70) score -= 10;
    score -= Math.min(15, profil.incidents.declares * 2);

    // Bonus fiabilité
    if (profil.rapports.consecutifs_ok >= 7) score += 5;

    return Math.max(0, Math.min(100, Math.round(score)));
}

function calculerTendance(profil) {
    // Compare les 2 dernières semaines (approximation)
    const recent  = profil.rapports.consecutifs_ok;
    const manques = profil.rapports.manques.length;
    if (recent >= 5 && manques === 0) return 'hausse';
    if (manques >= 3)                 return 'baisse';
    return 'stable';
}

function attribuerBadge(profil) {
    if (profil.score >= 90 && profil.rapports.consecutifs_ok >= 10) return '🏆 Fiable';
    if (profil.score >= 80 && profil.tendance === 'hausse')          return '📈 En progrès';
    if (profil.score < 60  || profil.tendance === 'baisse')          return '⚠️ À surveiller';
    return null;
}

function _formaterProfil(profil) {
    const emoji = profil.score >= 85 ? '🟢' : profil.score >= 65 ? '🟡' : '🔴';
    let txt = `${emoji} *PROFIL ${profil.nom.toUpperCase()}*\n`;
    txt += `Score : *${profil.score}/100* ${profil.badge || ''}\n\n`;
    txt += `📋 Rapports : ${profil.rapports.total} envoyés (${profil.rapports.taux_completion}% complétés)\n`;
    if (profil.ponctualite.retardsMoyenMin !== null) {
        txt += `⏱ Ponctualité : retard moyen ${profil.ponctualite.retardsMoyenMin} min\n`;
    }
    if (profil.incidents.declares > 0) {
        txt += `🚨 Incidents : ${profil.incidents.declares} déclarés | ${profil.incidents.taux_resolution}% résolus`;
        if (profil.incidents.tempsResolutionMoyenH) {
            txt += ` | résolu en ~${profil.incidents.tempsResolutionMoyenH}h en moyenne`;
        }
        txt += '\n';
    }
    if (profil.patterns.jours_difficiles.length > 0) {
        const jours = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
        txt += `📅 Jours difficiles : ${profil.patterns.jours_difficiles.map(j => jours[j]).join(', ')}\n`;
    }
    const topTypes = Object.entries(profil.incidents.types_frequents)
        .sort((a, b) => b[1] - a[1]).slice(0, 2);
    if (topTypes.length > 0) {
        txt += `🔁 Incidents récurrents : ${topTypes.map(([t, n]) => `${t}(×${n})`).join(', ')}\n`;
    }
    return txt;
}
