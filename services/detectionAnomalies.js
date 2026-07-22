/**
 * 🔍 DÉTECTION D'ANOMALIES & FRAUDE
 * 
 * Analyse les patterns sur les données historiques pour détecter :
 * - Mêmes heures + mêmes agents + mêmes incidents → fraude potentielle
 * - Connexion Internet toujours en panne le même jour → problème structurel
 * - Machines toujours non-clôturées par le même agent → comportement suspect
 * - Montants USD anormaux par rapport à la moyenne
 */

const CLE_MACHINE_HISTORIQUE = (machineId) => `anomalie:machine:${machineId}`;
const CLE_USD_HISTORIQUE     = 'anomalie:usd:historique';
const CLE_CONNEXION_HISTO    = 'anomalie:connexion:historique';
const CLE_FRAUDE_SCORE       = (jid) => `anomalie:fraude:${jid}`;
const TTL                    = 60 * 60 * 24 * 60; // 60 jours

module.exports = function creerDetectionAnomalies(redis) {

    // ── Enregistrer une machine non-clôturée ─────────────────────────────────
    const enregistrerNonCloture = async (machineId, managerJid) => {
        try {
            const cle = CLE_MACHINE_HISTORIQUE(machineId);
            const raw = await redis.get(cle);
            const histo = raw ? JSON.parse(raw) : { machineId, occurrences: [] };

            histo.occurrences.push({
                date:      new Date().toLocaleDateString('fr-FR', { timeZone: 'Africa/Kinshasa' }),
                jourSem:   new Date().getDay(),
                heure:     new Date().toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit', timeZone:'Africa/Kinshasa' }),
                managerJid
            });

            // Garder 90 jours
            if (histo.occurrences.length > 90) histo.occurrences.shift();

            await redis.set(cle, JSON.stringify(histo), 'EX', TTL);
            return analyserMachine(histo);
        } catch (e) {
            return null;
        }
    };

    // ── Enregistrer montant USD ───────────────────────────────────────────────
    const enregistrerUSD = async (montant) => {
        try {
            const raw = await redis.get(CLE_USD_HISTORIQUE);
            const histo = raw ? JSON.parse(raw) : [];
            histo.push({
                montant,
                date:    new Date().toLocaleDateString('fr-FR', { timeZone: 'Africa/Kinshasa' }),
                jourSem: new Date().getDay(),
                ts:      Date.now()
            });
            if (histo.length > 90) histo.shift();
            await redis.set(CLE_USD_HISTORIQUE, JSON.stringify(histo), 'EX', TTL);

            return analyserUSD(histo, montant);
        } catch (e) {
            return null;
        }
    };

    // ── Enregistrer incident connexion ────────────────────────────────────────
    const enregistrerIncidentConnexion = async () => {
        try {
            const raw = await redis.get(CLE_CONNEXION_HISTO);
            const histo = raw ? JSON.parse(raw) : [];
            histo.push({ jourSem: new Date().getDay(), ts: Date.now() });
            if (histo.length > 90) histo.shift();
            await redis.set(CLE_CONNEXION_HISTO, JSON.stringify(histo), 'EX', TTL);
            return analyserConnexion(histo);
        } catch (e) {
            return null;
        }
    };

    // ── Rapport global anomalies ──────────────────────────────────────────────
    const genererRapportAnomalies = async (managers) => {
        let rapport = `🔍 *RAPPORT D'ANOMALIES*\n\n`;
        let anomaliesDetectees = 0;

        // 1. USD
        try {
            const rawUSD = await redis.get(CLE_USD_HISTORIQUE);
            if (rawUSD) {
                const histo = JSON.parse(rawUSD);
                const analyse = analyserUSD(histo, null);
                if (analyse && analyse.alerte) {
                    rapport += `💵 *USD :*\n${analyse.message}\n\n`;
                    anomaliesDetectees++;
                }
            }
        } catch (e) {}

        // 2. Connexion
        try {
            const rawCo = await redis.get(CLE_CONNEXION_HISTO);
            if (rawCo) {
                const histo = JSON.parse(rawCo);
                const analyse = analyserConnexion(histo);
                if (analyse && analyse.alerte) {
                    rapport += `📡 *Connexion :*\n${analyse.message}\n\n`;
                    anomaliesDetectees++;
                }
            }
        } catch (e) {}

        if (anomaliesDetectees === 0) {
            rapport += `✅ Aucune anomalie significative détectée.\n`;
        }

        return rapport;
    };

    // ── Score de risque d'un manager ─────────────────────────────────────────
    const calculerScoreFraude = async (managerJid, nom) => {
        try {
            const raw = await redis.get(CLE_FRAUDE_SCORE(managerJid));
            return raw ? JSON.parse(raw) : { jid: managerJid, nom, score: 0, signaux: [] };
        } catch (e) {
            return { jid: managerJid, nom, score: 0, signaux: [] };
        }
    };

    const incrementerSignalFraude = async (managerJid, nom, signal) => {
        try {
            const profil = await calculerScoreFraude(managerJid, nom);
            profil.signaux.push({ signal, ts: Date.now() });
            // Signaux récents = 30 derniers jours
            const limite = Date.now() - 30 * 24 * 60 * 60 * 1000;
            profil.signaux = profil.signaux.filter(s => s.ts > limite);
            profil.score   = profil.signaux.length * 10;

            await redis.set(CLE_FRAUDE_SCORE(managerJid), JSON.stringify(profil), 'EX', TTL);

            // Alerte si score élevé
            if (profil.score >= 30) {
                return `⚠️ *ACTIVITÉ INHABITUELLE* : ${nom} — ${profil.signaux.length} signaux en 30 jours\n` +
                       `Derniers : ${profil.signaux.slice(-3).map(s => s.signal).join(', ')}`;
            }
            return null;
        } catch (e) {
            return null;
        }
    };

    return {
        enregistrerNonCloture,
        enregistrerUSD,
        enregistrerIncidentConnexion,
        genererRapportAnomalies,
        calculerScoreFraude,
        incrementerSignalFraude
    };
};

// ─── Analyseurs ───────────────────────────────────────────────────────────────

function analyserMachine(histo) {
    const occurrences = histo.occurrences;
    if (occurrences.length < 3) return null;

    // Pattern jour de semaine
    const compteursJour = {};
    occurrences.forEach(o => {
        compteursJour[o.jourSem] = (compteursJour[o.jourSem] || 0) + 1;
    });
    const jourMax = Object.entries(compteursJour).sort((a, b) => b[1] - a[1])[0];
    const jours = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];

    if (jourMax && jourMax[1] >= 3) {
        return {
            alerte: true,
            niveau: 'MOYEN',
            message: `🔁 Machine *${histo.machineId}* non-clôturée ${jourMax[1]}× le ${jours[jourMax[0]]} — pattern détecté`
        };
    }

    // Fréquence élevée récente
    const recent30j = occurrences.filter(o => {
        const d = o.ts || 0;
        return Date.now() - d < 30 * 24 * 60 * 60 * 1000;
    });
    if (recent30j.length >= 5) {
        return {
            alerte: true,
            niveau: 'ÉLEVÉ',
            message: `🚨 Machine *${histo.machineId}* non-clôturée ${recent30j.length}× en 30 jours`
        };
    }
    return null;
}

function analyserUSD(histo, montantActuel) {
    if (histo.length < 5) return null;

    const montants = histo.map(h => h.montant).filter(m => m > 0);
    if (montants.length < 5) return null;

    const moyenne = montants.reduce((a, b) => a + b, 0) / montants.length;
    const ecartType = Math.sqrt(montants.reduce((a, b) => a + Math.pow(b - moyenne, 2), 0) / montants.length);

    // Vérifier montant actuel
    if (montantActuel !== null) {
        const zscore = Math.abs((montantActuel - moyenne) / (ecartType || 1));
        if (zscore > 2.5) {
            const sens = montantActuel > moyenne ? 'exceptionnellement élevé' : 'anormalement bas';
            return {
                alerte: true,
                niveau: zscore > 3 ? 'CRITIQUE' : 'MOYEN',
                message: `📊 USD du jour (${montantActuel}$) ${sens} vs moyenne (${Math.round(moyenne)}$)`
            };
        }
    }

    // Tendance baisse sur 7 jours
    if (histo.length >= 7) {
        const recent7 = histo.slice(-7).map(h => h.montant);
        const moyenneRecente = recent7.reduce((a, b) => a + b, 0) / 7;
        if (moyenneRecente < moyenne * 0.75) {
            return {
                alerte: true,
                niveau: 'MOYEN',
                message: `📉 USD en baisse : moyenne 7j = ${Math.round(moyenneRecente)}$ vs moyenne générale ${Math.round(moyenne)}$`
            };
        }
    }
    return null;
}

function analyserConnexion(histo) {
    if (histo.length < 5) return null;

    // Compter par jour de semaine
    const compteurs = {};
    histo.forEach(h => {
        compteurs[h.jourSem] = (compteurs[h.jourSem] || 0) + 1;
    });
    const jourMax = Object.entries(compteurs).sort((a, b) => b[1] - a[1])[0];
    const jours = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];

    if (jourMax && jourMax[1] >= 3) {
        return {
            alerte: true,
            niveau: 'MOYEN',
            message: `📡 Connexion tombe souvent le *${jours[jourMax[0]]}* (${jourMax[1]}× détecté) — vérifier l'infrastructure ce jour-là`
        };
    }
    return null;
}
