const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('/mnt/user-data/outputs/index.html', 'utf8');
let pass = 0, fail = 0;

function boot() {
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://x.test/' });
  return dom.window;
}
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
const near = (a, b, t = 0.01) => Math.abs(a - b) < t;

// ── 1. Découpage en tranches ────────────────────────────────────────────────
console.log('\n[1] Découpage des paliers');
{
  const w = boot();
  const d = w.decouper;

  let s = d(0, 10000);
  ok('vente entièrement dans le 1er palier → 1 tranche', s.length === 1 && s[0].taux === 0.70);

  s = d(20000, 10000); // 20k → 30k, franchit 25k
  ok('à cheval 20k→30k → 2 tranches', s.length === 2, JSON.stringify(s.map(x => [x.montant, x.taux])));
  ok('  tranche 1 = 5 000 @ 70 %', near(s[0].montant, 5000) && s[0].taux === 0.70);
  ok('  tranche 2 = 5 000 @ 78 %', near(s[1].montant, 5000) && s[1].taux === 0.78);

  s = d(20000, 140000); // 20k → 160k : traverse 25k, 50k, 150k
  ok('traverse 3 seuils → 4 tranches', s.length === 4, JSON.stringify(s.map(x => [Math.round(x.montant), x.taux])));
  ok('  somme des tranches = HT', near(s.reduce((a, x) => a + x.montant, 0), 140000));
  ok('  dernière tranche @ 100 %', s[3].taux === 1.00 && near(s[3].montant, 10000));

  s = d(200000, 10000);
  ok('au-delà de 150k → 1 tranche @ 100 %', s.length === 1 && s[0].taux === 1.00);

  s = d(25000, 5000);
  ok('démarrage pile sur un seuil → 78 % uniquement', s.length === 1 && s[0].taux === 0.78);
}

// ── 2. Calcul d'une vente ───────────────────────────────────────────────────
console.log('\n[2] Cascade sur une vente');
{
  const w = boot();
  const c = w.calcVente(12000, 0);
  ok('HT = TTC / 1,2', near(c.ht, 10000), c.ht);
  ok('TVA = 2 000', near(c.tva, 2000));
  ok('rétro = 7 000 (70 %)', near(c.retro, 7000));
  ok('part Efficity = 3 000', near(c.effPart, 3000));
  ok('cotisations = 1 792 (25,6 % de 7 000)', near(c.cotis, 1792));
  ok('CFP = 7', near(c.cfp, 7));
  ok('VL IR = 154', near(c.vl, 154));
  ok('total URSSAF = 1 953 (27,9 %)', near(c.urssaf, 1953));
  ok('net = 5 047', near(c.net, 5047), c.net);
  ok('cumul après = 10 000', near(c.cumulApres, 10000));
}

// ── 3. Vente à cheval : deux taux sur la même vente ─────────────────────────
console.log('\n[3] Vente à cheval sur un seuil');
{
  const w = boot();
  w.state.report = 20000;
  const c = w.calcVente(12000, 20000); // HT 10 000 → 5k@70% + 5k@78%
  ok('2 tranches détectées', c.tranches.length === 2);
  ok('rétro = 3 500 + 3 900 = 7 400', near(c.retro, 7400), c.retro);
  ok('taux moyen = 74 %', near(c.tauxMoyen, 0.74));
  ok('part Efficity = 2 600', near(c.effPart, 2600));
  ok('URSSAF = 7 400 × 27,9 % = 2 064,60', near(c.urssaf, 2064.6), c.urssaf);
  ok('net = 5 335,40', near(c.net, 5335.4), c.net);
}

// ── 4. VL désactivé ─────────────────────────────────────────────────────────
console.log('\n[4] Toggle versement libératoire');
{
  const w = boot();
  w.state.vlir = false;
  const c = w.calcVente(12000, 0);
  ok('VL = 0', c.vl === 0);
  ok('URSSAF = 25,7 % → 1 799', near(c.urssaf, 1799), c.urssaf);
  ok('net = 5 201', near(c.net, 5201));
}

// ── 5. Chaînage : l'ordre des ventes détermine les paliers ──────────────────
console.log('\n[5] Chaînage sur l\'année');
{
  const w = boot();
  w.state.report = 0;
  w.state.ventes = [
    { id: 1, ttc: 24000, date: '2026-01-10' },  // HT 20 000 → cumul 20 000
    { id: 2, ttc: 12000, date: '2026-02-10' },  // HT 10 000 → 20k→30k, à cheval
    { id: 3, ttc: 12000, date: '2026-03-10' },  // HT 10 000 → 30k→40k, tout @78 %
  ];
  const a = w.calcAnnee();
  ok('cumul final = 40 000 HT', near(a.cumulFinal, 40000), a.cumulFinal);
  ok('vente 1 : 1 tranche @ 70 %', a.lignes[0].tranches.length === 1 && a.lignes[0].tranches[0].taux === 0.70);
  ok('vente 2 : 2 tranches (franchit 25k)', a.lignes[1].tranches.length === 2);
  ok('vente 3 : 1 tranche @ 78 %', a.lignes[2].tranches.length === 1 && a.lignes[2].tranches[0].taux === 0.78);
  ok('rétro totale = 14 000 + 7 400 + 7 800 = 29 200', near(a.tot.retro, 29200), a.tot.retro);
  ok('CA HT total = 40 000', near(a.tot.ht, 40000));
  ok('TVA totale = 8 000', near(a.tot.tva, 8000));
  ok('net total = 29 200 × 72,1 %', near(a.tot.net, 29200 * (1 - 0.279)), a.tot.net);
  ok('somme des nets = net total', near(a.lignes.reduce((s, l) => s + l.net, 0), a.tot.net));
}

// ── 6. Le report décale tout ────────────────────────────────────────────────
console.log('\n[6] Report initial');
{
  const w = boot();
  w.state.report = 24000;
  w.state.ventes = [{ id: 1, ttc: 12000, date: '2026-01-10' }];
  const a = w.calcAnnee();
  ok('la 1re vente est déjà à cheval (24k → 34k)', a.lignes[0].tranches.length === 2);
  ok('  1 000 @ 70 % puis 9 000 @ 78 %', near(a.lignes[0].tranches[0].montant, 1000) && near(a.lignes[0].tranches[1].montant, 9000));
  ok('cumul final = 34 000', near(a.cumulFinal, 34000));
}

// ── 7. Réordonnancement : le total change si l'ordre change ─────────────────
console.log('\n[7] L\'ordre compte');
{
  const w = boot();
  w.state.report = 0;
  w.state.ventes = [
    { id: 1, ttc: 240000, date: '2026-01-10' }, // HT 200 000
    { id: 2, ttc: 12000,  date: '2026-02-10' }, // HT 10 000 → @100 %
  ];
  const a1 = w.calcAnnee();
  ok('petite vente après une grosse → 100 %', near(a1.lignes[1].tauxMoyen, 1.0));
  w.state.ventes.reverse();
  const a2 = w.calcAnnee();
  ok('petite vente en premier → 70 %', near(a2.lignes[0].tauxMoyen, 0.70));
  ok('CA HT identique dans les deux ordres', near(a1.tot.ht, a2.tot.ht));
  ok('rétrocession totale identique (tranches conservées)', near(a1.tot.retro, a2.tot.retro), a1.tot.retro + ' vs ' + a2.tot.retro);
}

// ── 8. Persistance + migration v1 ───────────────────────────────────────────
console.log('\n[8] Persistance');
{
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://x.test/' });
  const w = dom.window;
  w.state.report = 5000;
  w.state.ventes = [{ id: 42, ttc: 12000, date: '2026-05-05' }];
  w.save();
  const raw = JSON.parse(w.localStorage.getItem('efficity-calc-v2'));
  ok('sauvegarde en v2', raw.report === 5000 && raw.ventes.length === 1);

  // Réouverture
  const dom2 = new JSDOM(html, { runScripts: 'dangerously', url: 'https://x.test/' });
  dom2.window.localStorage.setItem('efficity-calc-v2', JSON.stringify(raw));
  dom2.window.load();
  ok('rechargement : report restauré', dom2.window.state.report === 5000);
  ok('rechargement : vente restaurée', dom2.window.state.ventes[0].ttc === 12000);

  // Migration v1
  const dom3 = new JSDOM(html, { runScripts: 'dangerously', url: 'https://x.test/' });
  dom3.window.localStorage.setItem('efficity-calc-v1', JSON.stringify({
    report: 8000, vlir: false, annee: new Date().getFullYear(),
    ventes: [{ id: 7, ttc: 30000, ht: 25000, date: '17/07/26' }],
  }));
  dom3.window.load();
  ok('migration v1 → v2 : report', dom3.window.state.report === 8000);
  ok('migration v1 → v2 : vente', dom3.window.state.ventes[0].ttc === 30000);
  ok('migration v1 → v2 : date convertie en ISO', dom3.window.state.ventes[0].date === '2026-07-17', dom3.window.state.ventes[0].date);
  ok('migration v1 → v2 : toggle VL', dom3.window.state.vlir === false);

  // Changement d'année
  const dom4 = new JSDOM(html, { runScripts: 'dangerously', url: 'https://x.test/' });
  dom4.window.localStorage.setItem('efficity-calc-v2', JSON.stringify({
    report: 9000, vlir: true, annee: 2024, ventes: [{ id: 1, ttc: 12000, date: '2024-01-01' }],
  }));
  dom4.window.load();
  ok('nouvelle année → reset', dom4.window.state.report === 0 && dom4.window.state.ventes.length === 0);
}

// ── 9. Saisie utilisateur ───────────────────────────────────────────────────
console.log('\n[9] Parsing des montants');
{
  const w = boot();
  ok('"30000" → 30000', w.parseNum('30000') === 30000);
  ok('"30 000,50" → 30000.5', w.parseNum('30 000,50') === 30000.5);
  ok('"30\u00a0000" (espace insécable) → 30000', w.parseNum('30\u00a0000') === 30000);
  ok('"" → 0', w.parseNum('') === 0);
  ok('"abc" → 0', w.parseNum('abc') === 0);
  ok('"-500" → 0 (pas de négatif)', w.parseNum('-500') === 0);
}

// ── 10. Parcours UI complet ─────────────────────────────────────────────────
console.log('\n[10] Parcours UI');
{
  const w = boot();
  const d = w.document;
  d.getElementById('newTtc').value = '30000';
  d.getElementById('addBtn').click();
  ok('vente ajoutée via le bouton', w.state.ventes.length === 1);
  ok('champ TTC vidé après ajout', d.getElementById('newTtc').value === '');
  ok('ligne rendue dans la liste', d.querySelectorAll('.vente').length === 1);
  ok('détail ouvert automatiquement', d.querySelector('.vente').classList.contains('open'));

  const id = w.state.ventes[0].id;
  const inp = d.getElementById('ttc-' + id);
  ok('champ d\'édition présent', !!inp);
  inp.value = '60000';
  inp.dispatchEvent(new w.Event('input', { bubbles: true }));
  ok('édition prise en compte', w.state.ventes[0].ttc === 60000);
  ok('cumul recalculé = 50 000 HT', near(w.calcAnnee().cumulFinal, 50000), w.calcAnnee().cumulFinal);
  ok('la vente est maintenant à cheval sur 2 paliers (s\'arrête pile sur 50k)', w.calcAnnee().lignes[0].tranches.length === 2, w.calcAnnee().lignes[0].tranches.length);

  d.getElementById('report').value = '10000';
  d.getElementById('report').dispatchEvent(new w.Event('input', { bubbles: true }));
  ok('report pris en compte → cumul 60 000', near(w.calcAnnee().cumulFinal, 60000));

  d.getElementById('vlToggle').click();
  ok('toggle VL désactivé', w.state.vlir === false);
  ok('VL retiré du calcul', w.calcAnnee().lignes[0].vl === 0);

  w.confirm = () => true;
  d.querySelector('[data-del]').click();
  ok('suppression', w.state.ventes.length === 0);
  ok('état vide affiché', !!d.querySelector('.empty'));
}

// ── 11. Cohérence : aucun euro perdu ────────────────────────────────────────
console.log('\n[11] Cohérence comptable (100 tirages aléatoires)');
{
  const w = boot();
  let erreurs = 0;
  for (let n = 0; n < 100; n++) {
    w.state.report = Math.random() * 60000;
    w.state.ventes = Array.from({ length: 1 + Math.floor(Math.random() * 6) }, (_, i) => ({
      id: i, ttc: Math.random() * 120000, date: '2026-01-01',
    }));
    const a = w.calcAnnee();
    for (const l of a.lignes) {
      if (!near(l.ttc, l.ht + l.tva, 0.02)) erreurs++;
      if (!near(l.ht, l.retro + l.effPart, 0.02)) erreurs++;
      if (!near(l.retro, l.net + l.urssaf, 0.02)) erreurs++;
      if (!near(l.tranches.reduce((s, t) => s + t.montant, 0), l.ht, 0.02)) erreurs++;
      if (l.tauxMoyen < 0.699 || l.tauxMoyen > 1.001) erreurs++;
    }
    if (!near(a.cumulFinal, w.state.report + a.tot.ht, 0.02)) erreurs++;
  }
  ok('TTC = HT + TVA, HT = rétro + Efficity, rétro = net + URSSAF, Σtranches = HT', erreurs === 0, erreurs + ' écart(s)');
}

console.log('\n────────────────────────────');
console.log(pass + ' réussis · ' + fail + ' échoués');
process.exit(fail ? 1 : 0);
