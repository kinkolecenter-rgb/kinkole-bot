/**
 * Moteur d'analyse de rapports (100% JavaScript, sans IA)
 * Extrait les données structurées des messages WhatsApp
 */

function analyserRapport(texte) {
    const texteNorm = texte.toLowerCase().replace(/\*/g, '').replace(/\s+/g, ' ').trim();
    
    let type = 'inconnu';
    let donnees = {};

    // ==========================================
    // 1. DÉTECTION : OUVERTURE
    // ==========================================
    if (texteNorm.includes('ouverture du') || texteNorm.includes('bonjour team')) {
        type = 'ouverture';
        
        const matchHeure = texteNorm.match(/(\d{1,2}[h:]\d{2})/);
        const matchManager = texteNorm.match(/mgr\s+([a-z]+)/i);
        const matchCaissieres = texteNorm.match(/caissi[èe]re\s+(\d+)\/(\d+)/i);
        const matchPages = texteNorm.match(/pages?\s*:\s*(\d+)/i);

        donnees = {
            heure_detectee: matchHeure ? matchHeure[1] : null,
            manager_detecte: matchManager ? matchManager[1] : null,
            caissieres_presentes: matchCaissieres ? `${matchCaissieres[1]}/${matchCaissieres[2]}` : null,
            pages_imprimees: matchPages ? parseInt(matchPages[1]) : null,
            materiel_ok: texteNorm.includes('connexion ok') && texteNorm.includes('caisse ok')
        };
    }
        
    // ==========================================
    // 2. DÉTECTION : FIXTURES & TAUX
    // ==========================================
    // Fix 3: detection resserree
    else if (
        texteNorm.includes('fixtures sport') ||
        texteNorm.includes('taux de change') ||
        (texteNorm.includes('achat') && texteNorm.includes('vente') && texteNorm.includes('taux')) ||
        (texteNorm.includes('achat:') && texteNorm.includes('vente:')) ||
        (texteNorm.includes('achat :') && texteNorm.includes('vente :'))
    ) {
        type = 'fixture';
        
        const achat = texteNorm.match(/achat\s*:?\s*([\d\.,]+)/);
        const vente = texteNorm.match(/vente\s*:?\s*([\d\.,]+)/);
        const loto = texteNorm.match(/loto\s*:?\s*(\d+)/);
        const giga = texteNorm.match(/giga\s*:?\s*(\d+)/);
        const felicitation = texteNorm.match(/f[ée]licitations?\s*:?\s*(\d+)/);

        donnees = {
            taux_achat: achat ? parseInt(achat[1].replace(/[\.,]/g, '')) : null,
            taux_vente: vente ? parseInt(vente[1].replace(/[\.,]/g, '')) : null,
            loto: loto ? parseInt(loto[1]) : 0,
            giga: giga ? parseInt(giga[1]) : 0,
            felicitation: felicitation ? parseInt(felicitation[1]) : 0
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
   // ==========================================
    // 4. DÉTECTION : NON CLÔTURE / INCIDENT
    // ==========================================
    else if (
        texteNorm.includes('non clôturé') || 
        texteNorm.includes('non cloture') ||
        texteNorm.includes("n'a pas clôturé") ||
        texteNorm.includes("n'a pas cloture") ||
        texteNorm.includes("n'ont pas clôturer") ||
        texteNorm.includes("n'ont pas cloture") ||
        texteNorm.includes("pas cloturer")
    ) {
        type = 'incident_cloture';
        
        // 💰 1. On extrait le montant (tout ce qui vient après le signe = ou :)
        const matchMontant = texteNorm.match(/[=:]\s*([\d.]+)/);
        const montantExtrait = matchMontant ? matchMontant[1].trim() : null;

        // 🧹 2. On nettoie le texte pour isoler uniquement les IDs
        let texteSansMontants = texteNorm
            .replace(/(=|:)\s*\d+([.,]\d+)?/g, '') 
            .replace(/\b\d+([.,]\d+)?\s*(fc|usd|\$)\b/g, '');
            
        const ids = texteSansMontants.match(/\b\d{5,7}\b/g) || [];
        
        donnees = {
            ids_non_clotures: ids,
            nombre: ids.length,
            montant: montantExtrait // 💾 Sauvegardé pour la Base de données !
        };
    }

    // ==========================================
    // 5. DÉTECTION : DERNIER RAPPORT (FERMETURE)
    // ==========================================
    else if (texteNorm.includes('dernier rapport') || texteNorm.includes('rapport de fermeture')) {
        type = 'fermeture';
        
        const ticketsShop = texteNorm.match(/deux shift.*?:?\s*([\d\.]+)/i);
        const ticketsPos = texteNorm.match(/agents pos\s*:?\s*([\d\.]+)/i);
        const ticketsLoto = texteNorm.match(/loto\s*:?\s*([\d\.]+)/i);
        const instantWin = texteNorm.match(/instant win\s*:?\s*([\d\.]+)/i);
        const ramUtilisee = texteNorm.match(/ram utilis[ée]e?r?\s*:?\s*(\d+)/i);

        donnees = {
            tickets_shop: ticketsShop ? ticketsShop[1] : null,
            tickets_pos: ticketsPos ? ticketsPos[1] : null,
            tickets_loto: ticketsLoto ? ticketsLoto[1] : null,
            tickets_instant_win: instantWin ? instantWin[1] : null,
            ram_utilisee: ramUtilisee ? parseInt(ramUtilisee[1]) : null
        };
    }

    // ==========================================
    // 6. DÉTECTION : DÉTAILS CONNEXION
    // ==========================================
    else if (texteNorm.includes('détails connexion') || texteNorm.includes('details connexion') || 
             texteNorm.includes('connexion 12h') || texteNorm.includes('connexion 15h') || 
             texteNorm.includes('connexion 17h') || texteNorm.includes('ids connect')) {
        type = 'details_connexion';
        donnees = {};
    }

    return {
        est_rapport: type !== 'inconnu',
        type: type,
        donnees: donnees
    };
}

/**
 * Formate un rapport de coffre brut en un modèle propre et standardisé
 */
function formaterRapportCoffre(texteBrut) {
    const txt = texteBrut.toLowerCase().replace(/\n/g, ' ');

    let statut = "OK ✅";
    let exceptions = [];
    let ecarts = [];
    let usdStatus = null;

    if (txt.includes('collect')) exceptions.push('Collecte');
    if (txt.includes('retenu')) exceptions.push('Retenues');
    if (txt.includes('salaire')) exceptions.push('Salaires');

    const matchEcart = txt.match(/(surplus|reliquat)[\s\S]*?(\d+[\.\,]*\d*\s*(cdf|fc)?)/gi);
    if (matchEcart) {
        statut = "À VÉRIFIER ⚠️";
        ecarts = matchEcart.map(e => e.charAt(0).toUpperCase() + e.slice(1));
    }
    if (txt.includes('b.o') || txt.includes('backoffice') || txt.includes('back office')) {
        ecarts.push("Vérification BackOffice requise");
    }

    if (txt.includes('usd')) {
        if (txt.includes('update') || txt.includes('adapted') || txt.includes('updated')) {
            usdStatus = "Updated ✅";
        } else if (txt.includes('moins usd')) {
            usdStatus = "Moins USD ⚠️";
        }
    }

    let header = usdStatus ? "🔒 *RAPPORT COFFRE DU SOIR*" : "🔒 *RAPPORT COFFRE DU MATIN*";
    let msg = `${header}\n\n• *Statut* : ${statut}\n`;
    
    msg += `• *Hormis* : ${exceptions.length > 0 ? exceptions.join(', ') : 'Rien'}\n`;

    if (ecarts.length > 0) {
        msg += `• *Écarts signalés* :\n${ecarts.map(e => `  - ${e}`).join('\n')}\n`;
    }

    if (usdStatus) {
        msg += `• *USD* : ${usdStatus}\n`;
    }

    return msg;
}

module.exports = { analyserRapport, formaterRapportCoffre };
