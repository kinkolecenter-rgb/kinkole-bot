const getModeleMatin = (d) =>
`Bonjour Team
* Ouverture du ${d.date} shop ${d.site} par ${d.manager} ${d.heure_ouv}
* Ouverture premier agent à ${d.premier_agent}
* Ouverture teller à ${d.teller}
* Premier ticket joué et payé
     ------------------------------------
* ${d.nom_premier_paye} : ${d.heure_premier_paye}
* Premier ticket payé par ${d.caissier_paye} ${d.heure_premier_paye}
* Nombre de caissière ${d.nb_caissiers}
* Equipe matin caisse :
     -------------------------------
${d.equipe_caisse}
* PR : ${d.pr}
     ---------
${d.pr_equipe}
* Center ${d.center}

      Etat Matériel
       ---------------------
* bureau ${d.bureau}
* Couloir caisse ${d.couloir}
* Charing room ${d.charging_room}
* Salle ${d.salle}
* Connexion ${d.connexion}
* Onduleur ${d.onduleur}
* Flybox ${d.flybox}
* Caisse ${d.caisse}
* Page : ${d.page}
* ram : ${d.ram}
* plus bico : ${d.bico}
* Sous Big gén ${d.big_gen}`;

const getModeleSoir = (d) =>
`Bonsoir Team
* Fermeture du ${d.date} shop ${d.site}
* Heure fermeture : ${d.heure_ferm}
* Dernier ticket : ${d.dernier_ticket}
* Collecte : ${d.collecte}
* Coffre : ${d.coffre}
* Rapport caisse : ${d.rapport_caisse}
* Etat fin journée : ${d.etat_fin}
* Superviseur : ${d.superviseur}`;

const getModeleSCheck = (d) =>
`Coffre ok hormis
* collect ${d.collect}`;

const getModeleRateFixture = (d) =>
`Fixtures sport betting kinkole shop
Nb. Pages: ${d.nb_pages}
Nb.Copies par agent: ${d.nb_copies}
Fixture (other)
loto: ${d.loto}
Giga: ${d.giga}
Félicitation : ${d.felicitation}
Total/agt: ${d.total_agt}
Taux de change
Achat: ${d.achat}
Vente: ${d.vente}`;

module.exports = { getModeleMatin, getModeleSoir, getModeleSCheck, getModeleRateFixture };
