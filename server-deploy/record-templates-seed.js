// Modèles de rapports orthopédiques livrés au premier démarrage (une seule
// fois : les supprimer ne les fait pas revenir). Ce sont des points de départ,
// modifiables dans « Modèles de rapports ».
//
// Syntaxe commune au front (PatientDetail.jsx) :
//  - {{animal}} {{espece}} {{race}} {{age}} {{sexe}} {{poids}} {{date}} sont
//    remplacés par la fiche ; une valeur inconnue devient un champ [..].
//  - [texte] est un champ à compléter : Tab / Maj+Tab sautent de l'un à l'autre
//    et sélectionnent le texte entre crochets pour le remplacer d'une frappe.

const ORTHO_TEMPLATES = [
  {
    name: 'Consultation orthopédique — boiterie',
    recordType: 'Consultation',
    title: 'Consultation orthopédique — boiterie [membre]',
    description: `Motif : boiterie du membre [thoracique/pelvien] [gauche/droit] depuis [durée], d'apparition [brutale/progressive].
Anamnèse : [traumatisme : oui/non], [évolution], [traitements déjà reçus et réponse].

Examen général : {{poids}} kg, état général [bon], T° [..] °C.

Examen statique : [répartition du poids, amyotrophie, déformations].
Examen dynamique : boiterie [x/5] au pas, [x/5] au trot, [en charge/suppression d'appui intermittente/permanente].

Palpation-manipulation :
- Doigts / carpe / tarse : [RAS]
- Coude : [RAS / douleur en flexion-extension, épanchement]
- Épaule : [RAS / douleur, test du biceps]
- Hanche : [RAS / douleur en extension, Ortolani [positif/négatif]]
- Grasset : tiroir [positif/négatif], compression tibiale [positive/négative], rotule [stable / luxation médiale grade ..], épanchement [oui/non]
- Rachis : [RAS / douleur lombo-sacrée]
Examen neurologique : [proprioception et réflexes normaux].

Imagerie : [radiographies réalisées : vues, conclusions].
Hypothèses / diagnostic : [..]`,
    treatment: `- [Anti-inflammatoire : méloxicam 0,1 mg/kg PO SID] pendant [..] jours
- [Antalgique complémentaire]
- Repos : [sorties en laisse courte uniquement] pendant [..] semaines
- Examens complémentaires proposés : [..]
- Contrôle dans [..] semaines`,
  },
  {
    name: 'TPLO — rupture du ligament croisé crânial',
    recordType: 'Chirurgie',
    title: 'TPLO grasset [gauche/droit]',
    description: `Indication : rupture [complète/partielle] du LCCr du grasset [gauche/droit], boiterie depuis [durée].
Bilan préopératoire : tiroir [positif/négatif], compression tibiale [positive/négative], click méniscal [oui/non].
Radiographies : TPA préopératoire [..]°, arthrose [absente/légère/modérée/sévère].

Anesthésie : [protocole], ASA [..]. Antibioprophylaxie : [céfazoline 22 mg/kg IV].
Exploration articulaire par [arthrotomie médiale/arthroscopie] : LCCr [rupture complète/partielle], ménisque médial [intact / lésé → méniscectomie partielle / release].
Ostéotomie radiaire [..] mm, rotation [..] mm.
Implants : plaque TPLO [marque, taille], [..] vis [type/diamètre].
TPA postopératoire : [..]°.
Fermeture plan par plan, peau : [surjet intradermique/agrafes].

Radiographies postopératoires : implants en place, [commentaire].
Complications peropératoires : [aucune].`,
    treatment: `- [Méloxicam 0,1 mg/kg PO SID] pendant [10] jours
- [Gabapentine 10 mg/kg PO BID] pendant [7] jours
- Collerette jusqu'au retrait des fils
- Repos strict en cage/enclos 6 semaines, sorties en laisse courte 3 × 10 min/j
- Cryothérapie 3 × 10 min/j pendant 3 jours
- Contrôle de plaie et retrait des fils à J[12-14]
- Contrôle radiographique à 6-8 semaines
- Physiothérapie : [à débuter à J..]`,
  },
  {
    name: 'Luxation médiale de rotule — correction chirurgicale',
    recordType: 'Chirurgie',
    title: 'Correction de luxation médiale de rotule [gauche/droite]',
    description: `Indication : luxation médiale de rotule grade [I-IV] du grasset [gauche/droit], [boiterie intermittente / suppression d'appui].
Bilan : LCCr [stable/instable], [déformations osseuses associées].

Anesthésie : [protocole], ASA [..]. Antibioprophylaxie : [céfazoline 22 mg/kg IV].
Arthrotomie latérale : cartilage [état], trochlée [profondeur].
Gestes réalisés :
- Trochléoplastie [en bloc / en coin / abrasion] : [..]
- Transposition de la tubérosité tibiale : [..] mm latéralement, fixation par [..] broche(s) [diamètre] [± hauban]
- [Imbrication capsulaire latérale / desmotomie médiale]
Rotule stable en fin d'intervention en flexion-extension : [oui].
Fermeture plan par plan, peau : [..].

Radiographies postopératoires : [implants en place, alignement].
Complications peropératoires : [aucune].`,
    treatment: `- [Méloxicam 0,1 mg/kg PO SID] pendant [10] jours
- [Antalgique complémentaire]
- Collerette jusqu'au retrait des fils
- Repos strict 6 semaines, sorties en laisse courte
- Contrôle de plaie et retrait des fils à J[12-14]
- Contrôle radiographique à 6-8 semaines`,
  },
  {
    name: 'Ostéosynthèse de fracture',
    recordType: 'Chirurgie',
    title: 'Ostéosynthèse — fracture [os] [gauche/droit]',
    description: `Circonstances : [AVP/chute/..], le [date]. Délai avant chirurgie : [..].
Bilan : fracture [ouverte/fermée] [diaphysaire/métaphysaire/articulaire] [transverse/oblique/comminutive] du [os] [gauche/droit]. Lésions associées : [bilan thoracique, autres].

Anesthésie : [protocole], ASA [..]. Antibioprophylaxie : [céfazoline 22 mg/kg IV].
Abord : [..].
Réduction [ouverte/« open but do not touch »/fermée], [anatomique/alignement].
Implants : [plaque type, taille, nombre de trous] + [..] vis [type/diamètre] ; [clou centromédullaire / broches / cerclages / fixateur externe].
Stabilité obtenue : [bonne].
Fermeture plan par plan, peau : [..].

Radiographies postopératoires : [réduction, position des implants].
Complications peropératoires : [aucune].`,
    treatment: `- [Méloxicam 0,1 mg/kg PO SID] pendant [10] jours
- [Antalgique complémentaire]
- [Antibiotique si fracture ouverte]
- Collerette jusqu'au retrait des fils
- Repos strict [6-8] semaines, sorties en laisse courte
- Contrôle de plaie et retrait des fils à J[12-14]
- Contrôle radiographique à 6 semaines`,
  },
  {
    name: 'Exérèse de la tête et du col fémoral (FHO)',
    recordType: 'Chirurgie',
    title: 'Exérèse tête et col fémoral [gauche/droite]',
    description: `Indication : [luxation coxo-fémorale irréductible / Legg-Calvé-Perthes / fracture de la tête fémorale / coxarthrose] [gauche/droite].

Anesthésie : [protocole], ASA [..]. Antibioprophylaxie : [céfazoline 22 mg/kg IV].
Abord crânio-latéral de la hanche. Ostéotomie du col fémoral à [l'oscillante/l'ostéotome], régularisation du trait, absence d'arête résiduelle vérifiée à la palpation et en mobilisation.
[Interposition musculaire : oui/non].
Fermeture plan par plan, peau : [..].

Radiographies postopératoires : [ostéotomie complète, pas d'esquille].
Complications peropératoires : [aucune].`,
    treatment: `- [Méloxicam 0,1 mg/kg PO SID] pendant [10-14] jours
- [Gabapentine 10 mg/kg PO BID] pendant [7] jours
- Mobilisation PRÉCOCE : marche en laisse dès J[2-3], mobilisation passive 3 × /j
- Physiothérapie conseillée
- Contrôle de plaie et retrait des fils à J[12-14]
- Contrôle de la récupération fonctionnelle à 4-6 semaines`,
  },
  {
    name: 'Dépistage dysplasie hanches / coudes',
    recordType: 'Examen',
    title: 'Dépistage dysplasie [hanches/coudes]',
    description: `{{animal}}, {{espece}} {{race}}, {{sexe}}, {{age}}, {{poids}} kg. Puce : [n°].
Sédation : [protocole].

Hanches (vue VD extension) :
- Gauche : angle de Norberg [..]°, congruence [..], arthrose [absente/..]
- Droite : angle de Norberg [..]°, congruence [..], arthrose [absente/..]
Stade FCI : [A/B/C/D/E]  [PennHIP DI : G [..] / D [..]]

Coudes (vues de profil fléchie [± crânio-caudale]) :
- Gauche : [ostéophytes .. mm, sclérose sous-trochléaire, PCM, NUPA]
- Droit : [..]
Grade IEWG : [0/1/2/3]

Conclusion : [..]`,
    treatment: `- Clichés [envoyés pour lecture officielle à ..]
- Conseils : [contrôle du poids, activité adaptée]
- [Suivi proposé]`,
  },
  {
    name: 'Contrôle postopératoire J10-15',
    recordType: 'Consultation',
    title: 'Contrôle postopératoire J[..] — [intervention]',
    description: `Intervention : [..] le [date].
Propriétaire : [repos respecté oui/non], appétit [bon], [traitement bien donné].

Examen : {{poids}} kg. Appui [franc/partiel/suppression], boiterie [x/5].
Plaie : [propre, sèche, cicatrisation correcte / érythème, sérome, déhiscence].
Retrait des [fils/agrafes] : [oui].
Palpation du site : [douleur absente/modérée], [mobilité articulaire ..].

Conclusion : évolution [favorable].`,
    treatment: `- [Fin du traitement anti-inflammatoire / poursuite ..]
- Poursuite du repos [strict] jusqu'au contrôle radiographique de 6-8 semaines
- [Physiothérapie : exercices ..]
- Prochain contrôle : [date]`,
  },
  {
    name: 'Contrôle radiographique 6-8 semaines',
    recordType: 'Examen',
    title: 'Contrôle radiographique [..] semaines — [intervention]',
    description: `Intervention : [..] le [date] ([..] semaines).
Examen : {{poids}} kg, appui [franc], boiterie [x/5], amyotrophie [..].
Mobilité articulaire : [..], douleur : [absente].

Radiographies (vues [..]) :
- Consolidation : [complète/en cours/retard], [cal osseux ..]
- Implants : [en place, pas de migration ni de rupture]
- [Ligne d'ostéotomie / foyer de fracture : ..]
- Arthrose : [évolution]

Conclusion : [..]`,
    treatment: `- Reprise progressive de l'activité sur [4-6] semaines : [laisse longue puis course libre]
- [Physiothérapie / hydrothérapie]
- [Contrôle supplémentaire si besoin : ..]`,
  },
];

module.exports = { ORTHO_TEMPLATES };
