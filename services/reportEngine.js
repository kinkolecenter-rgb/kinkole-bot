/**
 * Moteur d'analyse de rapports (100% JavaScript, sans IA)
 * Extrait les données structurées des messages WhatsApp
 */

function analyserRapport(texte) {
    // Normalisation du texte pour faciliter la recherche
    const texteNorm = texte.toLowerCase().replace(/\*/g, '').replace(/\s+/g, ' ').trim();
    
    let type = 'inconnu';
    let donnees = {};

    // ==========================================
    // 1. DÉTECTION : OUVERTURE
    // ==========================================
    if (texteNorm.includes('ouverture du') || texteNorm.includes('bonjour team')) {
        type = 'ouverture';
        
        // Extraction via Regex
        const matchHeure = texteNorm.match(/(\d{1,2}[h:]\d{2})/);
        const matchManager = texteNorm.match(/mgr\s+([a-z]+)/i);
        const matchCaissieres = texteNorm.match(/caissi[èe]re\s+(\d+)\/(\d+)/i);

        donnees = {
            heure_detectee: matchHeure ? matchHeure[1] : null,
            manager_detecte: matchManager ? matchManager[1] : null,
            caissieres_presentes: matchCaissieres ? `${matchCaissieres[1]}/${matchCaissieres[2]}` : null,
            // Vérification simple de complétude
            materiel_ok: texteNorm.includes('connexion ok') && texteNorm.includes('caisse ok')
        };
    }
    
    // ==========================================
    // 2. DÉTECTION : FIXTURES & TAUX
    // ==========================================
    else if (texteNorm.includes('fixtures sport') || texteNorm.includes('taux de change')) {
        type = 'fixture';
        
        const achat = texteNorm.match(/achat\s*:?\s*(\d+)/);
        const vente = texteNorm.match(/vente\s*:?\s*(\d+)/);
        const loto = texteNorm.match(/loto\s*:?\s*(\d+)/);

        donnees = {
            taux_achat: achat ? parseInt(achat[1]) : null,
            taux_vente: vente ? parseInt(vente[1]) : null,
            loto_pages: loto ? parseInt(loto[1]) : 0
        };
    }
    
    // ==========================================
    // 3. DÉTECTION : ÉTAT DU COFFRE
    // ==========================================
    else if (texteNorm.includes('coffre ok') || texteNorm.includes('etat coffre') || texteNorm.includes('état coffre')) {
        type = 'coffre';
        
        const avecRemarque = texteNorm.includes('hormis');
        
        donnees = {
            statut: 'ok',
            remarques: avecRemarque ? texte.toLowerCase().split('hormis')[1].trim() : 'Aucune'
        };
    }

    // ==========================================
    // 4. DÉTECTION : NON CLÔTURE / INCIDENT
    // ==========================================
    else if (texteNorm.includes('non clôturé') || texteNorm.includes('non cloture')) {
        type = 'incident_cloture';
        
        // On cherche des séries de chiffres (les IDs des agents)
        const ids = texteNorm.match(/\b\d{6}\b/g) || [];
        
        donnees = {
            ids_non_clotures: ids,
            nombre: ids.length
        };
    }

    return {
        est_rapport: type !== 'inconnu',
        type: type,
        donnees: donnees
    };
}

module.exports = { analyserRapport };
