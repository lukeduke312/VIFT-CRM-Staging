/**
 * PageShells — Placeholder-rendering för sidor som byggs i Fas 3+ (v75)
 * Fas 2-sidor (Kunder, AO, Tid, Faktura) har egna filer.
 * v75: gemensamma beräkningsfunktioner _lineExVat/_offRawExVat, offert-totaler-fix (alla 5 platser)
 * v93: send-offer-email — offerToken/sentBy server-side; auto-token+snapshot; rätt länk; ingen mailto-fallback
 * v94: patch state (offerPatch/attachmentPatches/emailEvent) före persist; kundvy via snapshot
 * v95: v4-patch; serverpatchar vid fel; attachment-validering; snapshot-kontroll; email_sent i tidslinje
 * v96: v5-patch; persist endast vid verkliga serverpatchar; korrekt misslyckad e-posthändelse
 */

/* ── Offerter (v2 – tjänstemallar + kalkylator) ─────── */

/**
 * _lineExVat(l) — enda gemensam beräkning för en offertrads exklusive moms-belopp.
 *
 * Hanterar ALLA radtyper och datastrukturer:
 *  • service  → l.exVat (förkalkylerat av priskriget)
 *  • manual   → qty * unitPrice
 *  • fixed    → 1 * unitPrice  (ingen qty-fältet)
 *  • äldre rader utan type-fält → qty * unitPrice (fallback till l.total om qty/price saknas)
 *
 * Används ÖVERALLT: offertlista, detaljvy, sammanfattning, PDF, utskrift, e-post, AO-skapande.
 */
function _lineExVat(l) {
  if (!l || l.type === 'text') return 0;
  if (l.type === 'service')    return (l.exVat != null ? +l.exVat : 0);
  const qty  = (l.qty != null && l.qty !== '') ? +l.qty : 1;
  const up   = +(l.unitPrice || l.price || 0);
  const comp = Math.round(qty * up);
  /* Fallback: om beräkningen ger 0 men l.total är satt, använd l.total (bakåtkompatibilitet) */
  if (comp === 0 && l.total) return +l.total;
  return comp;
}

/** Summa ex. moms för ett helt offert-objekt (rader + extras) */
function _offRawExVat(off) {
  const prLines = (off.lines  || []).filter(l => l.type !== 'text');
  const extras  = off.extras  || [];
  const lineSum = prLines.reduce((s, l) => s + _lineExVat(l), 0);
  const extrSum = extras.reduce((s, e) => s + Math.round((+(e.qty||1)) * (+(e.unitPrice||0))), 0);
  return Math.round(lineSum + extrSum);
}

/* ── PART 1: OfferPriceRules — alla priser EXKLUSIVE MOMS ─── */
const OfferPriceRules = {
  altan: {
    tiers: [
      {max:30,  pricePerM2:95},
      {max:60,  pricePerM2:85},
      {max:100, pricePerM2:75},
      {max:150, pricePerM2:70},
      {max:Infinity, pricePerM2:65}
    ],
    minCharge: 1500,
    addons: {
      algae:     {label:'Algbehandling',        price:15,  unit:'m²'},
      stairs:    {label:'Trappsteg tillägg',    price:450, unit:'st'},
      treatment: {label:'Impregnering/efterbehandling', price:18, unit:'m²'},
      disposal:  {label:'Bortforsling',         price:750, unit:'st'}
    },
    vatRate: 25,
    rutApplicable: true,
    rutRate: 0.5
  },
  sten: {
    tiers: [
      {max:30,  pricePerM2:85},
      {max:60,  pricePerM2:72},
      {max:100, pricePerM2:62},
      {max:150, pricePerM2:55},
      {max:Infinity, pricePerM2:48}
    ],
    minCharge: 1500,
    addons: {
      weeds:        {label:'Ogräs- och algbehandling', price:12, unit:'m²'},
      jointing:     {label:'Fogsandning',              price:25, unit:'m²'},
      impregnation: {label:'Impregnering',             price:22, unit:'m²'},
      disposal:     {label:'Bortforsling',             price:600, unit:'st'}
    },
    vatRate: 25,
    rotApplicable: true,
    rotRate: 0.3
  },
  hack: {
    basePricePerLm: 55,
    heightFactors: {'≤ 1 m':1.0,'1–2 m':1.35,'2–3 m':1.75,'> 3 m':2.2},
    sideFactors:   {'1 sida':1.0,'2 sidor':1.8,'3 sidor':2.5},
    diffFactors:   {'Normal':1.0,'Svår (tät/gammal)':1.3},
    minCharge: 1200,
    addons: {
      disposal: {label:'Bortforsling klippt material', price:650, unit:'st'}
    },
    vatRate: 25,
    rutApplicable: true,
    rutRate: 0.5
  },
  fasad: {
    basePricePerM2: 60,
    floorFactors: {'1 vån':1.0,'2 vån':1.25,'3 vån':1.55,'4+ vån':1.85},
    minCharge: 2000,
    addons: {
      algae:    {label:'Algbehandling',       price:15,   unit:'m²'},
      softwash: {label:'Softwash-behandling', price:18,   unit:'m²'},
      lift:     {label:'Lift / ställning',    price:4500, unit:'st'},
      disposal: {label:'Bortforsling',        price:600,  unit:'st'}
    },
    vatRate: 25,
    rotApplicable: true,
    rotRate: 0.3
  }
};

/* ── PART 2: Helper functions ─── */
function _offTierPrice(area, tiers) {
  for (let i = 0; i < tiers.length; i++) {
    if (area <= tiers[i].max) return tiers[i].pricePerM2;
  }
  return tiers[tiers.length - 1].pricePerM2;
}

function _offTierLabel(area, tiers) {
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    const prev = i === 0 ? 0 : tiers[i-1].max;
    if (area <= t.max) {
      const fromLbl = prev === 0 ? '0' : (prev + 1);
      const toLbl   = t.max === Infinity ? '∞' : t.max;
      return fromLbl + '–' + toLbl + ' m²: ' + t.pricePerM2 + ' kr/m²';
    }
  }
  return '';
}


/* ── PART 3: OffersPage (v4 – steg-wizard + tjänstoverlay) ─── */
const OffersPage = {
  _editLines:    [],
  _editExtras:   [],
  _editOfferId:  null,
  _wizardStep:   1,
  _wizardData:   {},
  _activeSvcId:  null,
  _svcFields:    {},
  _svcEditIdx:   null,
  _svcReduction: 'ingen',   // 'ingen' | 'rut' | 'rot' — unified state, injected into calc
  _filter:       'alla',
  _search:       '',

  /* ── Tjänstemallar ─── */
  _T: [
    {
      id:'altan', name:'Altantvätt', icon:'refresh-cw', vatRate:25, defaultReduction:'rut',
      defaultDesc:'Altantvätt inkl. rengöring, avfettning och behandling.',
      fields:[
        {id:'area',      label:'Yta (m²)',       type:'number', req:true},
        {id:'material',  label:'Material/typ',   type:'chips',  opts:['Trä / Komposit','Betong','Natursten','Tegel','Annat'], def:'Trä / Komposit'},
        {id:'dirt',      label:'Smutsnivå',      type:'chips',  opts:['Lätt','Måttlig','Kraftig'], def:'Måttlig'},
        {id:'algae',     label:'Algbehandling',  type:'bool',   addLabel:'Algbehandling (+15 kr/m²)'},
        {id:'stairs',    label:'Trappsteg',      type:'bool',   addLabel:'Trappsteg (+450 kr/st)'},
        {id:'treatment', label:'Efterbehandling',type:'bool',   addLabel:'Impregnering (+18 kr/m²)'},
        {id:'disposal',  label:'Bortforsling',   type:'bool',   addLabel:'Bortforsling (+750 kr)'},
        {id:'rut',       label:'RUT-avdrag 50 %',type:'bool',   isRut:true},
      ],
      calc(f){
        const rules = OfferPriceRules.altan;
        const a = parseFloat(f.area) || 0;
        const pricePerM2 = _offTierPrice(a, rules.tiers);
        const tierLbl    = _offTierLabel(a, rules.tiers);
        let base = a * pricePerM2;
        if (a > 0 && base < rules.minCharge) base = rules.minCharge;
        const ls = [{desc:'Altantvätt ' + a + ' m² (' + (f.dirt||'Måttlig') + ')', qty:a, unit:'m²', price:pricePerM2}];
        if (a > 0 && a * pricePerM2 < rules.minCharge) {
          ls[0] = {desc:'Altantvätt ' + a + ' m² (minimidebitering)', qty:1, unit:'st', price:rules.minCharge};
        }
        if (f.algae)     ls.push({desc:rules.addons.algae.label,     qty:a, unit:'m²', price:rules.addons.algae.price});
        if (f.stairs)    ls.push({desc:rules.addons.stairs.label,    qty:1, unit:'st', price:rules.addons.stairs.price});
        if (f.treatment) ls.push({desc:rules.addons.treatment.label, qty:a, unit:'m²', price:rules.addons.treatment.price});
        if (f.disposal)  ls.push({desc:rules.addons.disposal.label,  qty:1, unit:'st', price:rules.addons.disposal.price});
        const exVat = Math.round(ls.reduce((s,l)=>s+l.qty*l.price,0));
        const totalIncVat = exVat + Math.round(exVat * rules.vatRate / 100);
        const rutAmt = f.rut ? Math.round(totalIncVat * rules.rutRate) : 0;
        return {ls, exVat, rutAmt, tierLbl, pricePerM2, inputValues:{...f}, priceRuleRef:'altan'};
      }
    },
    {
      id:'sten', name:'Stentvätt', icon:'layers', vatRate:25, defaultReduction:'rot',
      defaultDesc:'Högtryckstvätt av stenläggning, plattor och markytor.',
      fields:[
        {id:'area',         label:'Yta (m²)',    type:'number', req:true},
        {id:'material',     label:'Stentyp',     type:'chips',  opts:['Betongplattor','Natursten','Klinker','Asfalt','Annat'], def:'Betongplattor'},
        {id:'dirt',         label:'Smutsnivå',   type:'chips',  opts:['Lätt','Måttlig','Kraftig'], def:'Måttlig'},
        {id:'weeds',        label:'Ogräs/alger', type:'bool',   addLabel:'Ogräs- och algbehandling (+12 kr/m²)'},
        {id:'jointing',     label:'Fogsandning', type:'bool',   addLabel:'Fogsandning (+25 kr/m²)'},
        {id:'impregnation', label:'Impregnering',type:'bool',   addLabel:'Impregnering (+22 kr/m²)'},
        {id:'disposal',     label:'Bortforsling',type:'bool',   addLabel:'Bortforsling (+600 kr)'},
        {id:'rot',          label:'ROT-avdrag 30 %', type:'bool', isRot:true},
      ],
      calc(f){
        const rules = OfferPriceRules.sten;
        const a = parseFloat(f.area) || 0;
        const pricePerM2 = _offTierPrice(a, rules.tiers);
        const tierLbl    = _offTierLabel(a, rules.tiers);
        let base = a * pricePerM2;
        const ls = [{desc:'Stentvätt ' + a + ' m² (' + (f.dirt||'Måttlig') + ')', qty:a, unit:'m²', price:pricePerM2}];
        if (a > 0 && base < rules.minCharge) {
          ls[0] = {desc:'Stentvätt ' + a + ' m² (minimidebitering)', qty:1, unit:'st', price:rules.minCharge};
        }
        if (f.weeds)        ls.push({desc:rules.addons.weeds.label,       qty:a, unit:'m²', price:rules.addons.weeds.price});
        if (f.jointing)     ls.push({desc:rules.addons.jointing.label,    qty:a, unit:'m²', price:rules.addons.jointing.price});
        if (f.impregnation) ls.push({desc:rules.addons.impregnation.label,qty:a, unit:'m²', price:rules.addons.impregnation.price});
        if (f.disposal)     ls.push({desc:rules.addons.disposal.label,    qty:1, unit:'st', price:rules.addons.disposal.price});
        const exVat = Math.round(ls.reduce((s,l)=>s+l.qty*l.price,0));
        const totalIncVat = exVat + Math.round(exVat * rules.vatRate / 100);
        const rutAmt = f.rot ? Math.round(totalIncVat * rules.rotRate) : 0;
        return {ls, exVat, rutAmt, tierLbl, pricePerM2, inputValues:{...f}, priceRuleRef:'sten'};
      }
    },
    {
      id:'hack', name:'Häckklippning', icon:'scissors', vatRate:25, defaultReduction:'rut',
      defaultDesc:'Klippning av häck inkl. uppsamling av klippt material.',
      fields:[
        {id:'length',     label:'Löpmeter häck',   type:'number', req:true},
        {id:'height',     label:'Höjd',            type:'chips',  opts:['≤ 1 m','1–2 m','2–3 m','> 3 m'], def:'1–2 m'},
        {id:'sides',      label:'Antal sidor',     type:'chips',  opts:['1 sida','2 sidor','3 sidor'], def:'2 sidor'},
        {id:'difficulty', label:'Svårighet',       type:'chips',  opts:['Normal','Svår (tät/gammal)'], def:'Normal'},
        {id:'disposal',   label:'Bortforsling',    type:'bool',   addLabel:'Bortforsling (+650 kr)'},
        {id:'rut',        label:'RUT-avdrag 50 %', type:'bool',   isRut:true},
      ],
      calc(f){
        const rules = OfferPriceRules.hack;
        const lm  = parseFloat(f.length) || 0;
        const hf  = rules.heightFactors[f.height||'1–2 m'] || 1.35;
        const sf  = rules.sideFactors[f.sides||'2 sidor']  || 1.8;
        const df  = rules.diffFactors[f.difficulty||'Normal'] || 1.0;
        const prLm = Math.round(rules.basePricePerLm * hf * sf * df);
        let base = lm * prLm;
        const ls = [{desc:'Häckklippning ' + lm + ' lm (' + (f.height||'1–2 m') + ', ' + (f.sides||'2 sidor') + (f.difficulty&&f.difficulty!=='Normal'?', Svår':'') + ')', qty:lm, unit:'lm', price:prLm}];
        if (lm > 0 && base < rules.minCharge) {
          ls[0] = {desc:'Häckklippning ' + lm + ' lm (minimidebitering)', qty:1, unit:'st', price:rules.minCharge};
        }
        if (f.disposal) ls.push({desc:rules.addons.disposal.label, qty:1, unit:'st', price:rules.addons.disposal.price});
        const exVat = Math.round(ls.reduce((s,l)=>s+l.qty*l.price,0));
        const totalIncVat = exVat + Math.round(exVat * rules.vatRate / 100);
        const rutAmt = f.rut ? Math.round(totalIncVat * rules.rutRate) : 0;
        const tierLbl = lm + ' lm × ' + prLm + ' kr/lm';
        return {ls, exVat, rutAmt, tierLbl, pricePerM2:prLm, inputValues:{...f}, priceRuleRef:'hack'};
      }
    },
    {
      id:'fasad', name:'Fasadtvätt', icon:'building-2', vatRate:25, defaultReduction:'rot',
      defaultDesc:'Fasadtvätt inkl. förberedelse, tvätt och skyddsåtgärder.',
      fields:[
        {id:'area',     label:'Fasadyta (m²)',  type:'number', req:true},
        {id:'floors',   label:'Antal våningar', type:'chips',  opts:['1 vån','2 vån','3 vån','4+ vån'], def:'2 vån'},
        {id:'material', label:'Fasadmaterial',  type:'chips',  opts:['Puts / Betong','Tegel','Träpanel','Plåt','Annat'], def:'Puts / Betong'},
        {id:'algae',    label:'Algbehandling',  type:'bool',   addLabel:'Algbehandling (+15 kr/m²)'},
        {id:'softwash', label:'Softwash',       type:'bool',   addLabel:'Softwash-behandling (+18 kr/m²)'},
        {id:'lift',     label:'Lift/ställning', type:'bool',   addLabel:'Lift / ställning (+4 500 kr)'},
        {id:'disposal', label:'Bortforsling',   type:'bool',   addLabel:'Bortforsling (+600 kr)'},
        {id:'rot',      label:'ROT-avdrag 30 %',type:'bool',   isRot:true},
      ],
      calc(f){
        const rules = OfferPriceRules.fasad;
        const a  = parseFloat(f.area) || 0;
        const ff = rules.floorFactors[f.floors||'2 vån'] || 1.25;
        const pricePerM2 = Math.round(rules.basePricePerM2 * ff);
        let base = a * pricePerM2;
        const ls = [{desc:'Fasadtvätt ' + a + ' m² (' + (f.floors||'2 vån') + ')', qty:a, unit:'m²', price:pricePerM2}];
        if (a > 0 && base < rules.minCharge) {
          ls[0] = {desc:'Fasadtvätt ' + a + ' m² (minimidebitering)', qty:1, unit:'st', price:rules.minCharge};
        }
        if (f.algae)    ls.push({desc:rules.addons.algae.label,    qty:a, unit:'m²', price:rules.addons.algae.price});
        if (f.softwash) ls.push({desc:rules.addons.softwash.label, qty:a, unit:'m²', price:rules.addons.softwash.price});
        if (f.lift)     ls.push({desc:rules.addons.lift.label,     qty:1, unit:'st', price:rules.addons.lift.price});
        if (f.disposal) ls.push({desc:rules.addons.disposal.label, qty:1, unit:'st', price:rules.addons.disposal.price});
        const exVat = Math.round(ls.reduce((s,l)=>s+l.qty*l.price,0));
        const totalIncVat = exVat + Math.round(exVat * rules.vatRate / 100);
        const rutAmt = f.rot ? Math.round(totalIncVat * rules.rotRate) : 0;
        const tierLbl = (f.floors||'2 vån') + ': ' + pricePerM2 + ' kr/m²';
        return {ls, exVat, rutAmt, tierLbl, pricePerM2, inputValues:{...f}, priceRuleRef:'fasad'};
      }
    },
    {
      id:'fs', name:'Fastighetsservice', icon:'wrench', vatRate:25,
      defaultDesc:'Fastighetsservice och skötsel enligt överenskommelse.',
      fields:[
        {id:'type',     label:'Avtalstyp',              type:'chips',  opts:['Månadsavtal','Kvartal','Engångsuppdrag'], def:'Engångsuppdrag'},
        {id:'hours',    label:'Timmar per period',      type:'number', req:true},
        {id:'periods',  label:'Antal perioder',         type:'number', def:1},
        {id:'rate',     label:'Timpris ex moms (kr/h)', type:'number', def:695},
        {id:'material', label:'Material (kr)',          type:'number'},
        {id:'rot',      label:'ROT-avdrag 30 %',        type:'bool',   isRot:true},
      ],
      calc(f){
        const hrs  = parseFloat(f.hours)    || 0;
        const per  = parseInt(f.periods)    || 1;
        const rate = parseFloat(f.rate)     || 695;
        const type = f.type                 || 'Engångsuppdrag';
        const mat  = parseFloat(f.material) || 0;
        const ls = [{desc:'Fastighetsservice – ' + type + (per>1?' × '+per+' ggr':'') + ' (' + hrs + ' tim/period)', qty:hrs*per, unit:'tim', price:rate}];
        if (mat) ls.push({desc:'Material och förbrukningsmaterial', qty:1, unit:'st', price:mat});
        const exVat = Math.round(ls.reduce((s,l)=>s+l.qty*l.price,0));
        const totalIncVat = exVat + Math.round(exVat * 0.25);
        const rutAmt = f.rut ? Math.round(totalIncVat * 0.5) : f.rot ? Math.round(totalIncVat * 0.3) : 0;
        return {ls, exVat, rutAmt, tierLbl:'', pricePerM2:rate, inputValues:{...f}, priceRuleRef:'fs'};
      }
    },
    {
      id:'tf', name:'Teknisk förvaltning', icon:'settings', vatRate:25,
      defaultDesc:'Teknisk förvaltning av fastighet enligt förvaltningsavtal.',
      fields:[
        {id:'months',  label:'Antal månader',         type:'number', req:true, def:12},
        {id:'monthly', label:'Månadsavgift ex moms',  type:'number', req:true},
        {id:'setup',   label:'Uppstartskostnad (kr)',  type:'number'},
        {id:'ovk',     label:'OVK-besiktning ingår',  type:'bool',   addLabel:'OVK inkl. protokoll (+3 500 kr)'},
      ],
      calc(f){
        const months  = parseInt(f.months)         || 12;
        const monthly = parseFloat(f.monthly)      || 0;
        const setup   = parseFloat(f.setup)        || 0;
        const ls = [{desc:'Teknisk förvaltning (' + months + ' månader)', qty:months, unit:'mån', price:monthly}];
        if (setup) ls.push({desc:'Uppstart och fastighetsgenomgång', qty:1, unit:'st', price:setup});
        if (f.ovk)  ls.push({desc:'OVK-besiktning inkl. protokoll',  qty:1, unit:'st', price:3500});
        const exVat = Math.round(ls.reduce((s,l)=>s+l.qty*l.price,0));
        return {ls, exVat, rutAmt:0, tierLbl:'', pricePerM2:monthly, inputValues:{...f}, priceRuleRef:'tf'};
      }
    },
    {
      id:'ovr', name:'Övrigt arbete', icon:'activity', vatRate:25,
      defaultDesc:'Arbete på löpande räkning.',
      fields:[
        {id:'desc_svc', label:'Benämning',                type:'text',   req:true},
        {id:'qty',      label:'Antal timmar',             type:'number', req:true},
        {id:'rate',     label:'Timpris ex moms (kr/h)',   type:'number', def:695},
        {id:'material', label:'Material (kr)',            type:'number'},
        {id:'rut',      label:'RUT-avdrag 50 %',          type:'bool',   isRut:true},
        {id:'rot',      label:'ROT-avdrag 30 %',          type:'bool',   isRot:true},
      ],
      calc(f){
        const rate = parseFloat(f.rate)     || 695;
        const qty  = parseFloat(f.qty)      || 0;
        const mat  = parseFloat(f.material) || 0;
        const ls   = [{desc:f.desc_svc||'Arbete', qty, unit:'tim', price:rate}];
        if (mat) ls.push({desc:'Material', qty:1, unit:'st', price:mat});
        const exVat = Math.round(ls.reduce((s,l)=>s+l.qty*l.price,0));
        const totalIncVat = exVat + Math.round(exVat * 0.25);
        const rutAmt = f.rut ? Math.round(totalIncVat * 0.5) : f.rot ? Math.round(totalIncVat * 0.3) : 0;
        return {ls, exVat, rutAmt, tierLbl:'', pricePerM2:rate, inputValues:{...f}, priceRuleRef:'ovr'};
      }
    },
  ],

  _getT() {
    if ((state.serviceTemplates||[]).length > 0) {
      return ServiceTemplateService.buildAllWizardTemplates();
    }
    return this._T;
  },

  _TERMS: {
    payment:  '30 dagar netto',
    validity: '30 dagar',
    general:  'Priser anges exklusive moms om inget annat anges. Eventuella tillkommande arbeten debiteras enligt löpande räkning efter godkännande. VIFT reserverar sig för dolda fel och förutsättningar som ej kunnat bedömas vid offerttillfället.'
  },

  /* ── Offertlista ─── */
  render() {
    const el = document.getElementById('pg-offer-content');
    if (!el) return;
    const all = (state.offers || []).slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // KPI — always over all offers, unaffected by filter/search
    const kpi = {utkast:0, skickad:0, godkänd:0, nekad:0, total:0};
    let totalGodkändVal = 0;
    all.forEach(o => {
      if (kpi[o.status] !== undefined) kpi[o.status]++;
      kpi.total++;
      if (o.status === 'godkänd') totalGodkändVal += OffersPage._offerExVat(o);
    });

    // Render static shell (KPI + toolbar + tabs container + results container).
    // The search input is part of the shell and is NOT re-rendered on keystroke.
    el.innerHTML =
      `<div class="off-kpi-row">
         <div class="off-kpi-card"><div class="off-kpi-val">${kpi.utkast}</div><div class="off-kpi-lbl">Utkast</div></div>
         <div class="off-kpi-card"><div class="off-kpi-val">${kpi.skickad}</div><div class="off-kpi-lbl">Skickade</div></div>
         <div class="off-kpi-card off-kpi-card--green"><div class="off-kpi-val">${kpi.godkänd}</div><div class="off-kpi-lbl">Godkända</div></div>
         <div class="off-kpi-card off-kpi-card--navy"><div class="off-kpi-val">${fmt(totalGodkändVal)}</div><div class="off-kpi-lbl">Godkänt värde ex. moms</div></div>
       </div>
       <div style="display:flex;gap:7px;align-items:center;margin-bottom:6px;">
         <div class="swrap" style="flex:1;">
           <span class="sico">${ic('search',16)}</span>
           <input id="off-search-input" type="search" placeholder="Sök offert, kund, titel eller ID…"
             value="${(this._search||'').replace(/"/g,'&quot;')}"
             oninput="OffersPage._onSearchInput(this)">
           ${this._search ? `<button class="off-clr-btn" onclick="OffersPage._clearSearch()" title="Rensa sökning">${ic('x',13)}</button>` : ''}
         </div>
         <button class="btn bp bsm" onclick="OffersPage.openCreate()">${ic('plus',14)} Ny offert</button>
       </div>
       <div id="off-tabs-row" class="ftabs" style="margin-bottom:6px;"></div>
       <div id="off-results"></div>`;

    this._renderTabRow(kpi);
    this._renderResults();
  },

  _getKpi() {
    const kpi = {utkast:0, skickad:0, godkänd:0, nekad:0, total:0};
    (state.offers||[]).forEach(o => {
      if (o.deleted || o.archived) return;
      if (kpi[o.status] !== undefined) kpi[o.status]++;
      kpi.total++;
    });
    return kpi;
  },

  _renderTabRow(kpi) {
    const el = document.getElementById('off-tabs-row');
    if (!el) return;
    const c = kpi || this._getKpi();
    const f = this._filter || 'alla';
    const kpiPamind   = (state.offers||[]).filter(o=>!o.deleted&&!o.archived&&o.status==='påmind').length;
    const kpiArkiv    = (state.offers||[]).filter(o=>o.archived&&!o.deleted).length;
    const kpiPapperskorg = (state.offers||[]).filter(o=>o.deleted).length;
    /* Punkt 124 — "Behöver åtgärd": ändring-begärd + digitala länkflaggor */
    const now7d = Date.now();
    const kpiAtgard = (state.offers||[]).filter(o => {
      if (o.deleted || o.archived) return false;
      if (o.status === 'ändring-begärd') return true;
      if (o.status === 'godkänd' && !o.workOrderId) return true;
      const tokenActive = o.publicToken && !o.tokenRevokedAt && !(o.tokenExpiresAt && new Date(o.tokenExpiresAt).getTime() < now7d);
      if (tokenActive && !o.openCount && o.sentAt && (now7d - new Date(o.sentAt).getTime()) > 2 * 86400000) return true;
      if (o.tokenExpiresAt && !o.tokenRevokedAt && new Date(o.tokenExpiresAt).getTime() > now7d && (new Date(o.tokenExpiresAt).getTime() - now7d) < 3 * 86400000) return true;
      return false;
    }).length;
    const tabs = [
      {v:'alla',         l:'Alla',                   n:c.total},
      {v:'utkast',       l:'Utkast',                 n:c.utkast},
      {v:'skickad',      l:'Skickade',               n:c.skickad},
      {v:'atgard',       l:'Behöver åtgärd',         n:kpiAtgard, urgent: kpiAtgard > 0},
      {v:'påmind',       l:'Påminda',                n:kpiPamind},
      {v:'godkänd',      l:'Godkända',               n:c.godkänd},
      {v:'nekad',        l:'Nekade',                 n:c.nekad},
      {v:'arkiverade',   l:'Arkiverade',             n:kpiArkiv},
      {v:'papperskorg',  l:'Papperskorg',            n:kpiPapperskorg},
    ];
    el.innerHTML = tabs.map(t =>
      `<button class="ft ${f===t.v?'on':''}" onclick="OffersPage._setFilter('${t.v}')" style="${t.urgent?'color:var(--or);':''}">${t.l}${t.n?` <span style="background:${t.urgent?'var(--or)':'rgba(0,0,0,.10)'};${t.urgent?'color:#fff;':''}border-radius:9px;padding:0 5px;font-size:9px;">${t.n}</span>`:''}</button>`
    ).join('');
  },

  _setFilter(v) {
    this._filter = v;
    this._renderTabRow();
    this._renderResults();
  },

  _onSearchInput(inputEl) {
    this._search = inputEl.value;
    // Toggle clear button without touching the input element
    const wrap = inputEl.parentElement;
    let btn = wrap.querySelector('.off-clr-btn');
    if (this._search && !btn) {
      btn = document.createElement('button');
      btn.className = 'off-clr-btn';
      btn.title = 'Rensa sökning';
      btn.setAttribute('onclick', 'OffersPage._clearSearch()');
      btn.innerHTML = ic('x', 13);
      wrap.appendChild(btn);
    } else if (!this._search && btn) {
      btn.remove();
    }
    this._renderResults();
  },

  _clearSearch() {
    this._search = '';
    const inp = document.getElementById('off-search-input');
    if (inp) { inp.value = ''; inp.focus(); }
    const btn = document.querySelector('.off-clr-btn');
    if (btn) btn.remove();
    this._renderResults();
  },

  _renderResults() {
    const el = document.getElementById('off-results');
    if (!el) return;
    const all = (state.offers || []).slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const filterTab = this._filter || 'alla';
    const q = (this._search || '').toLowerCase().trim();

    let offers = all;
    if (filterTab === 'papperskorg') {
      offers = offers.filter(o => o.deleted);
    } else if (filterTab === 'arkiverade') {
      offers = offers.filter(o => o.archived && !o.deleted);
    } else if (filterTab === 'alla') {
      offers = offers.filter(o => !o.archived && !o.deleted);
    } else if (filterTab === 'atgard') {
      const nowA = Date.now();
      offers = offers.filter(o => {
        if (o.deleted || o.archived) return false;
        if (o.status === 'ändring-begärd') return true;
        if (o.status === 'godkänd' && !o.workOrderId) return true;
        const tokActive = o.publicToken && !o.tokenRevokedAt && !(o.tokenExpiresAt && new Date(o.tokenExpiresAt).getTime() < nowA);
        if (tokActive && !o.openCount && o.sentAt && (nowA - new Date(o.sentAt).getTime()) > 2 * 86400000) return true;
        if (o.tokenExpiresAt && !o.tokenRevokedAt && new Date(o.tokenExpiresAt).getTime() > nowA && (new Date(o.tokenExpiresAt).getTime() - nowA) < 3 * 86400000) return true;
        return false;
      });
    } else {
      offers = offers.filter(o => !o.archived && !o.deleted && o.status === filterTab);
    }
    if (q) offers = offers.filter(o => {
      const cu = getCu(o.customerId);
      const cuName = cu ? CustomerService.displayName(cu).toLowerCase() : '';
      return o.id.toLowerCase().includes(q)
        || (o.title||'').toLowerCase().includes(q)
        || cuName.includes(q)
        || (o.summary||'').toLowerCase().includes(q)
        || (o.status||'').toLowerCase().includes(q);
    });

    if (offers.length === 0) {
      const noBase = filterTab==='alla' && !q;
      const clearBtn = q ? `<button class="btn bs bsm" style="margin-top:10px;" onclick="OffersPage._clearSearch()">Rensa sökning</button>` : '';
      el.innerHTML = `<div class="empty">${ic('file-text',36)}
        <h3>${noBase?'Inga offerter':'Inga träffar'}</h3>
        <p>${noBase?'Klicka "Ny offert" för att komma igång':q?'Inga offerter matchar din sökning.':'Inga offerter i detta filter.'}</p>
        ${noBase?`<button class="btn bp bsm" onclick="OffersPage.openCreate()" style="margin-top:8px;">${ic('plus',12)} Ny offert</button>`:clearBtn}
      </div>`;
      return;
    }

    el.innerHTML = offers.map(o => {
      const cu      = getCu(o.customerId);
      const cuName  = cu ? CustomerService.displayName(cu) : '—';
      const disp    = o.title || o.id;
      const prLines = (o.lines||[]).filter(l=>l.type!=='text');
      const extras  = o.extras||[];
      const rawExVat= _offRawExVat(o);
      const _disc   = o.discount||{type:'percent',value:0};
      const discAmt = _disc.value?(_disc.type==='percent'?Math.round(rawExVat*Math.min(_disc.value,100)/100):Math.min(Math.round(_disc.value),rawExVat)):0;
      const exVatD  = rawExVat - discAmt;
      const incVat  = exVatD + Math.round(exVatD*0.25);
      const rutAmt  = Math.round(prLines.filter(l=>l.type==='service').reduce((s,l)=>s+(l.rutAmount||0),0));
      const cust    = incVat - rutAmt;
      const insight = OffersPage._offerInsight(o);
      const statusColors = {utkast:'#94a3b8',skickad:'var(--blue)',påmind:'var(--pu)',väntar:'var(--or)',godkänd:'var(--gr)',nekad:'var(--rd)',utgången:'var(--mt)',ersatt:'#94a3b8'};
      const borderColor = statusColors[o.status] || 'var(--br)';
      // Nästa aktivitet
      const nextActLine = (() => {
        const acts = (state.activities||[]).filter(a => a.relatedType==='offer' && a.relatedId===o.id && a.status==='open');
        if (!acts.length) {
          if (o.status==='skickad'||o.status==='påmind') {
            return `<span style="font-size:10px;color:var(--or);">${ic('bell',9)} Ingen uppföljning bokad</span>`;
          }
          return '';
        }
        const sorted = acts.slice().sort((a,b)=>(a.dueDate||'').localeCompare(b.dueDate||''));
        const next = sorted[0];
        const isOverdue = next.dueDate && next.dueDate < tdy();
        const dateStr = next.dueDate ? new Date(next.dueDate+'T12:00:00').toLocaleDateString('sv-SE',{day:'numeric',month:'short'}) : '—';
        return isOverdue
          ? `<span style="font-size:10px;color:var(--rd);font-weight:700;">${ic('alert-circle',9)} Uppföljning försenad: ${dateStr}</span>`
          : `<span style="font-size:10px;color:var(--gr);">${ic('calendar-check',9)} Uppföljning: ${dateStr}</span>`;
      })();
      return `<div class="list-item off-offer-card" style="border-left-color:${borderColor};" onclick="Router.showPage('pg-offer-detail',{offerId:'${o.id}'})">
  <div class="off-offer-card-top">
    <div style="display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden;">
      <span class="off-offer-card-id">${o.id}</span>
      ${sbdg(o.status)}
    </div>
    <div style="display:flex;align-items:baseline;gap:5px;flex-shrink:0;margin-left:8px;">
      <strong style="font-size:13px;color:var(--navy);">${fmt(rutAmt ? cust : incVat)} kr</strong>
      <span style="font-size:11px;color:var(--mt);">${rutAmt?'kund inkl. moms':'inkl. moms'}</span>
    </div>
  </div>
  <div class="off-offer-card-title">${disp}</div>
  <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:6px;flex-wrap:wrap;">
    <div>
      <div class="off-offer-card-cu">${ic('user',11)} ${cuName}</div>
      <div class="off-offer-card-meta">
        ${ic('calendar',9)} ${fmtDate(o.createdAt)}
        ${o.sentAt ? `&nbsp;·&nbsp;${ic('send',9)} Skickad ${fmtDate(o.sentAt)}` : ''}
        ${o.validUntil ? `&nbsp;·&nbsp;${ic('clock',9)} Giltig t.o.m. ${fmtDate(o.validUntil)}` : ''}
      </div>
      ${nextActLine ? `<div style="margin-top:3px;">${nextActLine}</div>` : ''}
    </div>
    ${insight ? `<span class="off-offer-insight ${insight.cls}" style="margin-top:0;">${insight.txt}</span>` : ''}
  </div>
</div>`;
    }).join('');
  },

  _offerExVat(o) {
    return _offRawExVat(o);
  },

  _offerInsight(o) {
    const now = Date.now();
    const validDate  = o.validUntil ? new Date(o.validUntil).getTime() : null;
    const daysLeft   = validDate ? Math.round((validDate - now) / 86400000) : null;
    const sentDate   = o.sentAt ? new Date(o.sentAt).getTime() : null;
    const daysSent   = sentDate ? Math.round((now - sentDate) / 86400000) : null;

    /* Tokengiltighet */
    const tokenActive  = o.publicToken && !o.tokenRevokedAt;
    const tokenExpired = o.tokenExpiresAt && new Date(o.tokenExpiresAt).getTime() < now;
    const tokenDaysL   = o.tokenExpiresAt ? Math.round((new Date(o.tokenExpiresAt).getTime() - now) / 86400000) : null;

    if (o.status === 'godkänd' && o.workOrderId)  return {cls:'ins-godkand', txt: ic('check-circle',10) + ' Arbetsorder ' + o.workOrderId + ' skapad'};
    if (o.status === 'godkänd' && !o.workOrderId) return {cls:'ins-godkand', txt: ic('check-circle',10) + ' Godkänd — skapa arbetsorder'};
    if (o.status === 'nekad')           return {cls:'ins-nekad',   txt: ic('x-circle',10) + ' Nekad — följ upp orsak'};
    if (o.status === 'ändring-begärd')  return {cls:'ins-followup',txt: ic('edit-3',10) + ' Ändring begärd av kund — åtgärda'};
    if (o.status === 'utgången')        return {cls:'ins-nekad',   txt: ic('clock',10) + ' Utgången — förnya offerten'};
    /* Tokenaktiv men kund ej öppnat > 2 dagar — påminn */
    if (tokenActive && !tokenExpired && o.openCount === 0 && daysSent !== null && daysSent > 2)
      return {cls:'ins-followup', txt: ic('link',10) + ' Länk skickad men ej öppnad — påminn kunden'};
    /* Kund har öppnat men inte svarat */
    if (tokenActive && !tokenExpired && o.openCount > 0 && (o.status === 'skickad' || o.status === 'väntar') && daysSent > 3)
      return {cls:'ins-followup', txt: ic('eye',10) + ' Kund har öppnat — inväntar svar (' + (o.openCount||0) + ' visn.)'};
    /* Token snart utgången */
    if (tokenActive && tokenDaysL !== null && tokenDaysL >= 0 && tokenDaysL <= 3)
      return {cls:'ins-expiry', txt: '⚠️ Länk utgår om ' + tokenDaysL + ' dag' + (tokenDaysL===1?'':'ar')};
    if (daysLeft !== null && daysLeft >= 0 && daysLeft <= 7) return {cls:'ins-expiry', txt: '⚠️ Offert utgår om ' + daysLeft + ' dag' + (daysLeft === 1 ? '' : 'ar')};
    if ((o.status === 'skickad' || o.status === 'väntar') && daysSent !== null && daysSent > 5) return {cls:'ins-followup', txt: ic('bell',10) + ' Skickad för ' + daysSent + ' dagar — dags följa upp'};
    if (o.status === 'skickad')  return {cls:'ins-skickad', txt: ic('send',10) + ' Skickad — inväntar svar'};
    if (o.status === 'väntar')   return {cls:'ins-followup',txt: ic('clock',10) + ' Väntar på svar'};
    if (o.status === 'utkast')   return {cls:'ins-utkast',  txt: ic('edit-3',10) + ' Utkast — färdigställ och skicka'};
    return null;
  },

  /* ── Wizard open ─── */
  openCreate(preCustomerId) {
    const T = this._TERMS;
    const today    = new Date().toISOString().split('T')[0];
    const validDef = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
    this._editLines    = [];
    this._editExtras   = [];
    this._editOfferId  = null;
    this._wizardStep   = 1;
    this._activeSvcId  = null;
    this._svcFields    = {};
    this._svcEditIdx   = null;
    this._svcReduction = 'ingen';
    this._discount     = {type:'percent', value:0};
    this._wizardData   = {
      customerId: preCustomerId || '', title: '', date: today, validUntil: validDef,
      summary: '', scope: '', includes: '', excludes: '',
      paymentTerms: T.payment, validityText: T.validity, generalTerms: T.general, internalNote: ''
    };
    this._showWizard();
  },

  openEdit(offerId) {
    const off = getOff(offerId);
    if (!off) return;
    const T = this._TERMS;
    const today    = new Date().toISOString().split('T')[0];
    const validDef = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
    this._editLines    = (off.lines  || []).map(l => ({...l}));
    this._editExtras   = (off.extras || []).map(e => ({...e}));
    this._editOfferId  = off.id;
    this._wizardStep   = 1;
    this._activeSvcId  = null;
    this._svcFields    = {};
    this._svcEditIdx   = null;
    this._svcReduction = 'ingen';
    this._discount     = off.discount ? {...off.discount} : {type:'percent', value:0};
    this._wizardData  = {
      customerId:   off.customerId   || '',
      title:        off.title        || '',
      date:         (off.createdAt||'').split('T')[0] || today,
      validUntil:   off.validUntil   || validDef,
      summary:      off.summary      || '',
      scope:        off.scope        || '',
      includes:     off.includes     || '',
      excludes:     off.excludes     || '',
      paymentTerms: off.paymentTerms || T.payment,
      validityText: off.validityText || T.validity,
      generalTerms: off.generalTerms || T.general,
      internalNote: off.internalNote || ''
    };
    this._showWizard();
  },

  /* ── Wizard core ─── */
  _showWizard() {
    // Render wizard inside the content area so sidebar stays visible
    const pgOffer = document.getElementById('pg-offer');
    if (pgOffer && !pgOffer.classList.contains('active')) Router.showPage('pg-offer');
    const con = document.getElementById('pg-offer-content');
    if (!con) return;
    con.dataset.wiz = '1';
    // Override .con padding/gap so wizard fills the area cleanly
    con.style.cssText = 'padding:0;gap:0;display:block;box-sizing:border-box;';
    con.innerHTML = '<div id="off-wizard"></div>';
    document.getElementById('off-wizard').innerHTML = this._wizardHtml();
    const scroll = document.getElementById('content-scroll');
    if (scroll) scroll.scrollTop = 0;
  },

  _wizardClose() {
    const con = document.getElementById('pg-offer-content');
    if (con) { delete con.dataset.wiz; con.style.cssText = ''; }
    document.getElementById('off-svc-overlay')?.remove();
    this.render();
  },

  _rerender() {
    const con = document.getElementById('pg-offer-content');
    if (!con || !con.dataset.wiz) return;
    const wiz = document.getElementById('off-wizard');
    if (wiz) wiz.innerHTML = this._wizardHtml();
    const scroll = document.getElementById('content-scroll');
    if (scroll) scroll.scrollTop = 0;
  },

  _wizardHtml() {
    const step = this._wizardStep;
    const isEdit = !!this._editOfferId;
    const labels = ['Kund & info', 'Tjänster & rader', 'Villkor & spara'];

    const stepInd = labels.map((lbl, i) => {
      const n = i + 1;
      const done   = n < step;
      const active = n === step;
      const circ = `<div style="width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex-shrink:0;
        background:${done?'#22c55e':active?'var(--navy)':'#d1d5db'};color:${done||active?'#fff':'#9ca3af'};">
        ${done ? ic('check',11) : n}</div>`;
      const bar = i < labels.length - 1 ? `<div style="width:20px;height:2px;background:${done?'#22c55e':'#d1d5db'};margin:0 4px;margin-bottom:14px;flex-shrink:0;"></div>` : '';
      return `<div style="display:flex;align-items:center;">${
        `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
          ${circ}
          <div style="font-size:9px;font-weight:${active?'700':'500'};color:${active?'var(--navy)':'#9ca3af'};white-space:nowrap;">${lbl}</div>
        </div>`
      }${bar}</div>`;
    }).join('');

    // Header sticks to top of #content-scroll (no fixed overlay — wizard lives inside the page)
    const hdr = `<div style="background:#fff;border-bottom:1px solid var(--br);padding:10px 14px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:10;box-shadow:0 1px 6px rgba(0,0,0,.07);">
      <div style="flex:1;font-size:13px;font-weight:800;color:var(--navy);">${isEdit ? 'Redigera offert' : 'Ny offert'}</div>
      <div style="display:flex;align-items:flex-end;">${stepInd}</div>
      <button type="button" onclick="OffersPage._wizardClose()" title="Stäng" style="width:30px;height:30px;border:none;background:rgba(0,0,0,.07);border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${ic('x',15)}</button>
    </div>`;

    let ftr;
    if (step === 1) {
      ftr = `<div style="background:#fff;border-top:1px solid var(--br);padding:8px 14px;display:flex;gap:7px;justify-content:flex-end;">
        <button type="button" class="btn bs bsm" onclick="OffersPage._wizardClose()">Avbryt</button>
        <button type="button" class="btn bp bsm" onclick="OffersPage._nextStep()">${ic('arrow-right',12)} Nästa: Tjänster</button>
      </div>`;
    } else if (step === 2) {
      ftr = `<div style="background:#fff;border-top:1px solid var(--br);padding:8px 14px;display:flex;gap:7px;justify-content:space-between;">
        <button type="button" class="btn bs bsm" onclick="OffersPage._prevStep()">${ic('arrow-left',12)} Tillbaka</button>
        <button type="button" class="btn bp bsm" onclick="OffersPage._nextStep()">Nästa: Villkor ${ic('arrow-right',12)}</button>
      </div>`;
    } else {
      ftr = `<div style="background:#fff;border-top:1px solid var(--br);padding:8px 14px;display:flex;gap:7px;justify-content:space-between;">
        <button type="button" class="btn bs bsm" onclick="OffersPage._prevStep()">${ic('arrow-left',12)} Tillbaka</button>
        <button type="button" class="btn bp" style="flex:1;" onclick="OffersPage._save()">${ic('save',13)} ${isEdit ? 'Spara ändringar' : 'Spara offert'}</button>
      </div>`;
    }

    const innerCls = this._wizardStep === 3 ? 'off-wiz-inner' : 'off-wiz-inner-wide';
    return hdr + `<div class="${innerCls}">${this._stepHtml()}</div>` + ftr;
  },

  _stepHtml() {
    if (this._wizardStep === 1) return this._step1Html();
    if (this._wizardStep === 2) return this._step2Html();
    return this._step3Html();
  },

  /* ── Step 1: Kund & info ─── */
  _step1Html() {
    const d   = this._wizardData;
    const esc = s => (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const cuOpts = [{v:'',l:'— Välj kund —'}, ...(state.customers||[]).map(c=>({v:c.id,l:CustomerService.displayName(c)}))];
    return `
      <div class="off-s1-grid">
        <div class="off-s1-col">
          <div class="fg">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px;">
              <label style="margin-bottom:0;">Kund <span style="color:var(--rd)">*</span></label>
              <button type="button" class="off-new-cu-btn" onclick="OffersPage._quickNewCustomer()">
                ${ic('user-plus',11)} Ny kund
              </button>
            </div>
            ${CustomSelect.render('off-cu',{options:cuOpts,value:d.customerId,placeholder:'— Välj kund —',searchable:true,onchange:"OffersPage._wizardData.customerId=this.value"})}
          </div>
          <div class="fg">
            <label>Rubrik / titel</label>
            <input id="off-title" value="${esc(d.title)}" placeholder="T.ex. Serviceavtal 2025 – Solvägen 3"
              oninput="OffersPage._wizardData.title=this.value">
            <div style="font-size:10px;color:var(--mt);margin-top:3px;">T.ex. 'Stentvätt Solvägen 3' eller 'Serviceavtal 2025'</div>
          </div>
          <div class="g2">
            <div class="fg"><label>Datum</label>
              <input type="date" id="off-date" value="${esc(d.date)}"
                oninput="OffersPage._wizardData.date=this.value"></div>
            <div class="fg"><label>Giltig till</label>
              <input type="date" id="off-valid" value="${esc(d.validUntil)}"
                oninput="OffersPage._wizardData.validUntil=this.value"></div>
          </div>
          <details style="margin-bottom:10px;">
            <summary style="font-size:12px;font-weight:600;color:var(--navy);cursor:pointer;padding:6px 0;list-style:none;display:flex;align-items:center;gap:5px;">
              ${ic('zap',11)} Lägg till uppdragsbeskrivning
            </summary>
            <summary style="display:none;"></summary>
            <div style="padding-top:6px;">
              <div class="fg">
                <label>Kort sammanfattning</label>
                <textarea id="off-summary" rows="3" placeholder="T.ex. Stentvätt av marksten, ca 120 m², med algbehandling…"
                  oninput="OffersPage._wizardData.summary=this.value">${esc(d.summary)}</textarea>
                <button type="button" class="off-gen-btn" onclick="OffersPage._genTextSuggestion()">
                  ${ic('zap',11)} Generera textförslag
                </button>
                ${d._lastGenFrom ? `<div style="font-size:10px;color:var(--mt);margin-top:4px;display:flex;align-items:center;gap:4px;">${ic('check',9)}<span>Senast: <em>${d._lastGenFrom}</em></span></div>` : ''}
              </div>
            </div>
          </details>
        </div>
        <div class="off-s1-col">
          <details style="margin-bottom:10px;border:1px solid var(--br);border-radius:var(--rs);overflow:hidden;" ${d.scope||d.includes||d.excludes?'open':''}>
            <summary style="padding:10px 12px;font-size:12px;font-weight:600;color:var(--navy);cursor:pointer;background:var(--bg);list-style:none;display:flex;align-items:center;gap:6px;">
              ${ic('align-left',12)} Uppdragsbeskrivning (valfritt)
            </summary>
            <div style="padding:10px 12px;">
              <div class="fg">
                <label>Uppdragets omfattning</label>
                ${this._toolbarHtml('off-scope','scope')}
                <textarea id="off-scope" rows="4" placeholder="Beskriv vad uppdraget innebär…"
                  oninput="OffersPage._wizardData.scope=this.value">${esc(d.scope)}</textarea>
              </div>
              <div class="g2">
                <div class="fg"><label>Vad ingår</label>
                  <textarea id="off-includes" rows="3" placeholder="- Rengöring&#10;- Material…"
                    oninput="OffersPage._wizardData.includes=this.value">${esc(d.includes)}</textarea></div>
                <div class="fg"><label>Vad ingår ej</label>
                  <textarea id="off-excludes" rows="3" placeholder="- Målning&#10;- Elektriker…"
                    oninput="OffersPage._wizardData.excludes=this.value">${esc(d.excludes)}</textarea></div>
              </div>
            </div>
          </details>
        </div>
      </div>`;
  },

  /* ── Snabbskapa ny kund ─── */
  _quickNewCustomer() {
    const body = `
      <p style="font-size:12px;color:var(--mt);margin:0 0 14px;">Kunden skapas direkt och väljs automatiskt på offerten.</p>
      <div class="fg"><label>Namn / Företag <span style="color:var(--rd)">*</span></label>
        <input id="qcu-name" placeholder="Förnamn Efternamn eller Företagsnamn AB"></div>
      <div class="g2">
        <div class="fg"><label>Telefon</label><input id="qcu-phone" placeholder="070-xxx xx xx"></div>
        <div class="fg"><label>E-post</label><input id="qcu-email" type="email" placeholder="namn@exempel.se"></div>
      </div>
      <div class="fg"><label>Gatuadress</label><input id="qcu-addr" placeholder="Storgatan 1"
        autocomplete="off"
        oninput="AddressService.handleInput(this)"
        onblur="setTimeout(()=>AddressService.hideSuggestions(),150)"
        data-addr-zip="qcu-zip" data-addr-city="qcu-city"></div>
      <div class="g2">
        <div class="fg"><label>Postnummer</label><input id="qcu-zip" placeholder="123 45"></div>
        <div class="fg"><label>Stad</label><input id="qcu-city" placeholder="Stockholm"></div>
      </div>`;
    Modal.open({
      title: ic('user-plus',14) + ' Skapa ny kund',
      body,
      buttons: [
        { label: 'Skapa & välj', cls: 'btn bp', onClick: () => {
          const name = document.getElementById('qcu-name')?.value.trim();
          if (!name) { showToast('Namn krävs'); return; }
          const cu = CustomerService.create({
            name, phone: document.getElementById('qcu-phone')?.value.trim()||'',
            email: document.getElementById('qcu-email')?.value.trim()||'',
            address: document.getElementById('qcu-addr')?.value.trim()||'',
            zip: document.getElementById('qcu-zip')?.value.trim()||'',
            city: document.getElementById('qcu-city')?.value.trim()||'',
            type: 'privat', status: 'aktiv'
          });
          this._wizardData.customerId = cu.id;
          Modal.close();
          this._rerender();
          showToast(name + ' skapad och vald');
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('qcu-name')?.focus(), 80);
  },

  /* ── Step 2: Tjänster & rader ─── */
  _step2Html() {
    const discType = this._discount?.type || 'percent';
    const discVal  = this._discount?.value || 0;
    return `
      <div class="off-wiz-s2">
        <div class="off-wiz-s2-lines">
          <div class="off-action-cards" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px;">
            <button type="button" class="off-action-card" style="padding:8px 10px;" onclick="OffersPage._openSvcCalc(null)">
              <span class="off-action-card-icon">${ic('zap',14)}</span>
              <div><div class="off-action-card-title">Tjänst / kalkyl</div><div class="off-action-card-sub">VIFT:s prismodell</div></div>
            </button>
            <button type="button" class="off-action-card" style="padding:8px 10px;" onclick="OffersPage._addFixedLine()">
              <span class="off-action-card-icon">${ic('tag',14)}</span>
              <div><div class="off-action-card-title">Fastpris</div><div class="off-action-card-sub">Eget fast pris</div></div>
            </button>
            <button type="button" class="off-action-card" style="padding:8px 10px;" onclick="OffersPage._addManualLine()">
              <span class="off-action-card-icon">${ic('plus',14)}</span>
              <div><div class="off-action-card-title">Löpande rad</div><div class="off-action-card-sub">Antal × à-pris</div></div>
            </button>
            <button type="button" class="off-action-card" style="padding:8px 10px;" onclick="OffersPage._addTextBlock()">
              <span class="off-action-card-icon">${ic('align-left',14)}</span>
              <div><div class="off-action-card-title">Fritext</div><div class="off-action-card-sub">Info utan pris</div></div>
            </button>
          </div>
          <div id="off-lines">${this._linesHtml()}</div>
          <details style="margin-top:7px;border:1px solid var(--br);border-radius:var(--rs);overflow:hidden;">
            <summary style="padding:8px 11px;font-size:11px;font-weight:700;cursor:pointer;background:#fff;display:flex;align-items:center;gap:5px;">${ic('plus',11)} Tillval (valfria extratjänster)</summary>
            <div style="padding:7px 11px 11px;">
              <div id="off-extras">${this._extrasInnerHtml()}</div>
              <button type="button" class="btn bs bxs" style="margin-top:5px;" onclick="OffersPage._addExtra()">${ic('plus',10)} Lägg till tillval</button>
            </div>
          </details>
        </div>
        <div class="off-wiz-s2-summ">
          <div id="off-totals-bar">${this._totalsBarHtml()}</div>
          <div class="off-discount-ctrl">
            <label>Rabatt</label>
            <div style="display:flex;gap:4px;align-items:center;">
              <select id="off-disc-type" style="width:auto;"
                onchange="OffersPage._discount.type=this.value;OffersPage._refreshTotals()">
                <option value="percent"${discType==='percent'?' selected':''}>%</option>
                <option value="fixed"${discType==='fixed'?' selected':''}>kr</option>
              </select>
              <input type="number" id="off-disc-val" value="${discVal}" min="0" step="1" placeholder="0"
                style="width:64px;"
                oninput="OffersPage._discount.value=parseFloat(this.value)||0;OffersPage._refreshTotals()">
            </div>
          </div>
        </div>
      </div>`;
  },

  /* ── Step 3: Villkor & spara ─── */
  _step3Html() {
    const d   = this._wizardData;
    const esc = s => (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const prLines = this._editLines.filter(l => l.type !== 'text').length;
    const txtLines = this._editLines.filter(l => l.type === 'text').length;
    return `
      <div style="margin-bottom:16px;border:2px solid var(--navy);border-radius:var(--rs);overflow:hidden;">
        <div style="background:var(--navy);padding:8px 14px;">
          <div style="font-size:11px;font-weight:800;color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:.5px;">Offertsummering</div>
        </div>
        <div style="background:#fff;padding:4px 0;">
          ${this._totalsBarHtml().replace('<div class="off-totals-card">','<div class="off-totals-card" style="border:none;border-radius:0;margin:0;">').replace('<div class="off-totals-card-hd">Sammanfattning</div>','')}
        </div>
        <div style="padding:4px 14px 8px;font-size:10px;color:var(--mt);background:#f8f9fa;border-top:1px solid var(--bg);">
          ${prLines} pristrader · ${txtLines} textblock
        </div>
      </div>
      <div class="g2">
        <div class="fg"><label>Betalningsvillkor</label>
          <input id="off-payment" value="${esc(d.paymentTerms)}" placeholder="T.ex. 30 dagar netto"
            oninput="OffersPage._wizardData.paymentTerms=this.value"></div>
        <div class="fg"><label>Offertens giltighetstid</label>
          <input id="off-validity" value="${esc(d.validityText)}" placeholder="T.ex. 30 dagar"
            oninput="OffersPage._wizardData.validityText=this.value"></div>
      </div>
      <div class="fg">
        <label>Allmänna villkor</label>
        <textarea id="off-terms" rows="4" placeholder="Allmänna villkor…"
          oninput="OffersPage._wizardData.generalTerms=this.value">${esc(d.generalTerms)}</textarea>
      </div>
      <details style="margin-top:10px;border:1px solid var(--br);border-radius:var(--rs);overflow:hidden;" ${d.internalNote?'open':''}>
        <summary style="padding:10px 12px;font-size:12px;font-weight:600;color:var(--mt);cursor:pointer;background:var(--bg);list-style:none;display:flex;align-items:center;gap:6px;">
          ${ic('lock',11)} Intern anteckning (valfritt, visas ej för kund)
        </summary>
        <div style="padding:10px 12px;">
          <textarea id="off-note" rows="2" placeholder="Intern anteckning…"
            oninput="OffersPage._wizardData.internalNote=this.value">${esc(d.internalNote)}</textarea>
        </div>
      </details>`;
  },

  _totalsBarHtml() {
    const rawExVat = this._calcExVat(this._editLines, this._editExtras);
    const discAmt  = this._calcDiscount(rawExVat);
    const exVat    = rawExVat - discAmt;
    const vat      = Math.round(exVat * 0.25);
    const incVat   = exVat + vat;
    const rutAmt   = this._calcRutAmt(this._editLines);
    const cust     = incVat - rutAmt;
    return `<div class="off-totals-card">
      <div class="off-totals-card-hd">Sammanfattning</div>
      <div class="off-totals-card-body">
        <div class="off-totals-row"><span>Summa ex. moms</span><strong>${fmt(rawExVat)} kr</strong></div>
        ${discAmt ? `<div class="off-totals-rut" style="color:#b45309;"><span>Rabatt</span><span>−${fmt(discAmt)} kr</span></div>` : ''}
        <div class="off-totals-row"><span>Moms 25 %</span><strong>${fmt(vat)} kr</strong></div>
        <div class="off-totals-divider"></div>
        <div class="off-totals-total"><span>Totalt inkl. moms</span><span>${fmt(incVat)} kr</span></div>
        ${rutAmt ? `
        <div class="off-totals-divider"></div>
        <div class="off-totals-rut"><span>RUT/ROT-reduktion</span><span>−${fmt(rutAmt)} kr</span></div>` : ''}
        <div class="off-totals-cust">
          <span class="off-totals-cust-lbl">Kundpris inkl. moms</span>
          <span class="off-totals-cust-val">${fmt(cust)} kr</span>
        </div>
      </div>
    </div>`;
  },

  /* ── Step navigation ─── */
  _nextStep() {
    if (this._wizardStep === 1) {
      const cuId = document.getElementById('off-cu')?.value || this._wizardData.customerId;
      if (!cuId) { showToast('Välj en kund'); return; }
      this._wizardData.customerId = cuId;
    }
    if (this._wizardStep === 2) {
      if (!this._editLines.some(l => l.type !== 'text')) {
        showToast('Lägg till minst en rad eller tjänst'); return;
      }
    }
    if (this._wizardStep < 3) { this._wizardStep++; this._rerender(); }
  },

  _prevStep() {
    if (this._wizardStep === 3) {
      const map = {'off-payment':'paymentTerms','off-validity':'validityText','off-terms':'generalTerms','off-note':'internalNote'};
      Object.entries(map).forEach(([id,key]) => {
        const el = document.getElementById(id);
        if (el) this._wizardData[key] = el.value;
      });
    }
    if (this._wizardStep > 1) { this._wizardStep--; this._rerender(); }
  },

  /* ── Line card HTML ─── */
  _linesHtml() {
    if (!this._editLines.length) return `
      <div class="off-lines-empty">
        <div class="off-lines-empty-icon">${ic('file-text',22)}</div>
        <div class="off-lines-empty-txt">Inga rader ännu</div>
        <div class="off-lines-empty-sub">Lägg till en tjänst ovan</div>
      </div>`;
    return this._editLines.map((l, i) => {
      if (l.type === 'text')    return this._renderTextCard(l, i);
      if (l.type === 'service') return this._renderServiceCard(l, i);
      if (l.type === 'fixed')   return this._renderFixedCard(l, i);
      return this._renderManualCard(l, i);
    }).join('');
  },

  _renderServiceCard(l, i) {
    const exVat  = l.exVat || 0;
    const vat    = Math.round(exVat * (l.vatRate||25) / 100);
    const incVat = exVat + vat;
    const rutAmt = l.rutAmount || 0;
    const cust   = incVat - rutAmt;
    return `<div class="off-svc-card">
      <div class="off-svc-card-hd">
        <div style="flex:1;min-width:0;">
          <div class="off-svc-card-title">${l.templateName||'Tjänst'}</div>
          <div class="off-svc-card-meta">${ic('zap',9)} Tjänst</div>
          ${l.calculationNote ? `<div class="off-svc-card-sub" style="margin-bottom:2px;">Prisnivå: ${l.calculationNote.replace('Prisnivå: ','')}</div>` : ''}
          ${(l.subLines||[]).map(sl=>`<div class="off-svc-card-sub">${sl.desc} · ${sl.qty} ${sl.unit} × ${fmt(sl.price)} = <strong>${fmt(Math.round(sl.qty*sl.price))} kr</strong></div>`).join('')}
        </div>
        <div style="flex-shrink:0;text-align:right;">
          <div class="off-svc-card-price">${fmt(exVat)} kr</div>
          <div class="off-svc-card-price-sub">ex. moms</div>
          ${rutAmt ? `<div class="off-svc-card-rut">Kund: ${fmt(cust)} kr inkl.</div>` : ''}
        </div>
      </div>
      <input value="${(l.description||'').replace(/"/g,'&quot;')}" placeholder="Beskrivning på offerten…"
        style="font-size:11px;margin-bottom:6px;"
        oninput="OffersPage._editLines[${i}].description=this.value">
      <div style="display:flex;gap:5px;">
        <button type="button" class="btn bs bxs" onclick="OffersPage._openSvcCalc(${i})">${ic('pencil',10)} Redigera</button>
        <button type="button" class="btn bd bxs" onclick="OffersPage._removeLine(${i})">${ic('trash-2',10)} Ta bort</button>
      </div>
    </div>`;
  },

  _renderManualCard(l, i) {
    const units = ['st','tim','m','m²','m³','lm','kg','l','paket','mån'];
    const total  = Math.round((l.qty!=null?l.qty:1)*(l.unitPrice||0));
    return `<div style="background:#fff;border:1px solid var(--br);border-radius:var(--rs);padding:10px 12px;margin-bottom:7px;">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:7px;">
        <span style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--mt);">${ic('minus',9)} Manuell rad</span>
        <div style="flex:1;"></div>
        <strong style="font-size:12px;color:var(--navy);" id="off-lt-${i}">${fmt(total)} kr</strong>
        <button type="button" class="btn bd bxs" onclick="OffersPage._removeLine(${i})">${ic('x',10)}</button>
      </div>
      <input value="${(l.description||'').replace(/"/g,'&quot;')}" placeholder="Benämning" style="margin-bottom:6px;font-size:12px;"
        oninput="OffersPage._editLines[${i}].description=this.value">
      <div style="display:grid;grid-template-columns:72px 72px 1fr;gap:5px;">
        <div><label style="font-size:9px;color:var(--mt);font-weight:600;display:block;margin-bottom:2px;">Antal</label>
          <input type="number" value="${l.qty!=null?l.qty:1}" min="0" step="0.5"
            oninput="OffersPage._editLines[${i}].qty=parseFloat(this.value)||0;OffersPage._refreshTotals()"></div>
        <div><label style="font-size:9px;color:var(--mt);font-weight:600;display:block;margin-bottom:2px;">Enhet</label>
          <select onchange="OffersPage._editLines[${i}].unit=this.value">
            ${units.map(u=>`<option${(l.unit||'st')===u?' selected':''}>` + u + `</option>`).join('')}
          </select></div>
        <div><label style="font-size:9px;color:var(--mt);font-weight:600;display:block;margin-bottom:2px;">À-pris ex. moms (kr)</label>
          <input type="number" value="${l.unitPrice||0}" min="0" step="1"
            oninput="OffersPage._editLines[${i}].unitPrice=parseFloat(this.value)||0;OffersPage._refreshTotals()"></div>
      </div>
    </div>`;
  },

  _renderTextCard(l, i) {
    return `<div style="background:#fff;border:1px solid var(--br);border-radius:var(--rs);padding:10px 12px;margin-bottom:7px;border-left:3px solid #cbd5e1;">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:7px;">
        <span style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--mt);">${ic('align-left',9)} Fritextblock</span>
        <div style="flex:1;"></div>
        <button type="button" class="btn bd bxs" onclick="OffersPage._removeLine(${i})">${ic('x',10)}</button>
      </div>
      <input value="${(l.blockTitle||'').replace(/"/g,'&quot;')}" placeholder="Rubrik (t.ex. Förutsättningar)" style="margin-bottom:6px;font-weight:600;font-size:12px;"
        oninput="OffersPage._editLines[${i}].blockTitle=this.value">
      <textarea rows="2" placeholder="Fritext som visas på offerten…"
        oninput="OffersPage._editLines[${i}].text=this.value">${l.text||''}</textarea>
    </div>`;
  },

  /* ── Extras ─── */
  _extrasInnerHtml() {
    const units = ['st','tim','m','m²','kg','paket'];
    if (!this._editExtras.length) return `<p style="font-size:12px;color:var(--mt);margin:0 0 4px;">Inga tillval ännu.</p>`;
    return this._editExtras.map((e, i) => `
      <div style="display:grid;grid-template-columns:1fr 65px 75px 90px 28px;gap:5px;align-items:center;padding:5px 0;border-bottom:1px solid var(--bg);">
        <input value="${(e.description||'').replace(/"/g,'&quot;')}" placeholder="Tillval"
          oninput="OffersPage._editExtras[${i}].description=this.value">
        <input type="number" value="${e.qty||1}" min="0" step="0.5"
          oninput="OffersPage._editExtras[${i}].qty=parseFloat(this.value)||0;OffersPage._refreshTotals()">
        <select onchange="OffersPage._editExtras[${i}].unit=this.value">
          ${units.map(u=>`<option${(e.unit||'st')===u?' selected':''}>` + u + `</option>`).join('')}
        </select>
        <input type="number" value="${e.unitPrice||0}" min="0" step="1" placeholder="À-pris"
          oninput="OffersPage._editExtras[${i}].unitPrice=parseFloat(this.value)||0;OffersPage._refreshTotals()">
        <button type="button" class="btn bd bxs" onclick="OffersPage._removeExtra(${i})">${ic('x',10)}</button>
      </div>`).join('');
  },

  _addExtra() {
    this._editExtras.push({id:'E'+Date.now(), description:'', qty:1, unit:'st', unitPrice:0, vatRate:25});
    const el = document.getElementById('off-extras');
    if (el) el.innerHTML = this._extrasInnerHtml();
  },

  _removeExtra(idx) {
    this._editExtras.splice(idx, 1);
    const el = document.getElementById('off-extras');
    if (el) el.innerHTML = this._extrasInnerHtml();
    this._refreshTotals();
  },

  /* ── New offer helpers ─── */

  _calcDiscount(rawExVat) {
    const d = this._discount;
    if (!d || !d.value) return 0;
    if (d.type === 'percent') return Math.round(rawExVat * Math.min(d.value, 100) / 100);
    return Math.min(Math.round(d.value), rawExVat);
  },

  _addFixedLine() {
    this._editLines.push({id:'F'+Date.now(), type:'fixed', description:'', unitPrice:0, vatRate:25});
    const el = document.getElementById('off-lines');
    if (el) el.innerHTML = this._linesHtml();
    this._refreshTotals();
    setTimeout(() => {
      const inputs = document.querySelectorAll('#off-lines .off-fixed-name');
      if (inputs.length) inputs[inputs.length-1].focus();
    }, 50);
  },

  _renderFixedCard(l, i) {
    const tot    = Math.round(l.unitPrice || 0);
    const incVat = tot + Math.round(tot * 0.25);
    return `<div class="off-svc-card" style="border-left-color:#0ea5e9;">
      <div class="off-svc-card-hd">
        <div style="flex:1;min-width:0;">
          <div class="off-svc-card-meta">${ic('tag',9)} Fastpris</div>
          <input class="off-fixed-name" value="${(l.description||'').replace(/"/g,'&quot;')}" placeholder="Benämning…"
            oninput="OffersPage._editLines[${i}].description=this.value">
        </div>
        <div style="flex-shrink:0;text-align:right;">
          <div class="off-svc-card-price" id="off-lt-${i}">${fmt(tot)} kr</div>
          <div class="off-svc-card-price-sub">ex. moms · ${fmt(incVat)} kr inkl.</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:130px 1fr;gap:6px;margin-top:6px;">
        <div><label style="font-size:9px;color:var(--mt);font-weight:600;display:block;margin-bottom:2px;">Pris ex moms (kr)</label>
          <input type="number" value="${l.unitPrice||0}" min="0" step="1"
            oninput="OffersPage._editLines[${i}].unitPrice=parseFloat(this.value)||0;OffersPage._refreshTotals()"></div>
        <div><label style="font-size:9px;color:var(--mt);font-weight:600;display:block;margin-bottom:2px;">Intern anteckning</label>
          <input value="${(l.note||'').replace(/"/g,'&quot;')}" placeholder="Syns ej för kund"
            oninput="OffersPage._editLines[${i}].note=this.value" style="font-size:11px;"></div>
      </div>
      <div style="margin-top:6px;">
        <button type="button" class="btn bd bxs" onclick="OffersPage._removeLine(${i})">${ic('trash-2',10)} Ta bort</button>
      </div>
    </div>`;
  },

  _toolbarHtml(fieldId, key) {
    const ins = (p,s,ph) => `OffersPage._insertFormat('${fieldId}','${key}','${p}','${s}','${ph}')`;
    return `<div class="off-toolbar">
      <button type="button" class="btn bs bxs" onclick="${ins('- ','','punkt')}" title="Punktlista">• Lista</button>
      <button type="button" class="btn bs bxs" onclick="${ins('**','**','text')}" title="Fet text"><b>B</b></button>
      <button type="button" class="btn bs bxs" onclick="${ins('\\n','','\\n')}" title="Radbrytning">↵</button>
    </div>`;
  },

  _insertFormat(fieldId, key, prefix, suffix, placeholder) {
    const el = document.getElementById(fieldId);
    if (!el) return;
    const s = el.selectionStart, e = el.selectionEnd;
    const sel = el.value.substring(s, e) || placeholder || 'text';
    const ins = prefix + sel + (suffix || '');
    el.value = el.value.substring(0, s) + ins + el.value.substring(e);
    el.focus();
    el.setSelectionRange(s + prefix.length, s + prefix.length + sel.length);
    const keyMap = {scope:'scope', includes:'includes', excludes:'excludes', summary:'summary'};
    if (keyMap[key]) this._wizardData[keyMap[key]] = el.value;
  },

  _genTextSuggestion() {
    const raw = document.getElementById('off-summary')?.value || this._wizardData.summary || '';
    this._wizardData.summary = document.getElementById('off-summary')?.value || this._wizardData.summary;
    const sum = raw.toLowerCase();

    const qtyMatch = sum.match(/(\d+(?:[.,]\d+)?)\s*(m²|m2|kvm|lm|löpmeter)/i);
    const qty = qtyMatch ? parseFloat((qtyMatch[1]||'').replace(',','.')) : null;
    const qtyUnit = qtyMatch ? (/(lm|löpmeter)/i.test(qtyMatch[2]) ? 'lm' : 'm²') : 'm²';
    const qtyStr = qty ? `ca ${qty} ${qtyUnit}` : '';

    // Multi-moment detection — verb takes priority over object; each DEFS entry fires independently
    const WASH_V = /\b(tvätta|tvättar|tvättat|rengöra|rengör|rengöring|högtryckstvätta|högtrycksvätta|softwash|spola|spolning|avlägsna smuts|algtvätt|algbehandla|få bort alger)\b/;
    const CLIP_V = /\b(klippa|klipper|klippt|trimma|trimmar|trimmat)\b/;
    const RIV_V  = /\b(riva|river|rivit|rivning|demontera|demonterar|demontering)\b/;

    const DEFS = [
      {
        id: 'rivning', label: 'Rivning / Demontering',
        trigger: s => RIV_V.test(s) || /montera ned|ta ned konstruktion|riva ut/.test(s),
        action: 'rivning och demontering av befintliga konstruktioner',
        scopeCtx: 'Arbetet utförs metodiskt och säkert med rätt skyddsutrustning och hantering av rivmaterial.',
        includes: ['Demontering och rivning av angivna konstruktioner','Sortering och borttransport av rivmaterial','Dokumentation inför efterföljande arbeten'],
        excludes: ['Hantering av farligt avfall (asbest, PCB) utan separat avtal','Nya konstruktioner eller igensättning','Återuppbyggnad efter rivning'],
      },
      {
        id: 'fasadpanel', label: 'Fasadpanel / Panelarbete',
        // Suppress if rivning is the primary verb — then that moment owns the panel work
        trigger: s => (/\b(fasadpanel|panelarbete|liggande panel|stående panel)\b|\bpanel\b/.test(s)) &&
                      !RIV_V.test(s) && !/fasadtvätt/.test(s),
        action: 'montering och byte av fasadpanel',
        scopeCtx: 'Arbetet innefattar mätning, tillpassning och montering av ny panel med korrekt infästning och tätning.',
        includes: ['Demontering av befintlig panel','Montering av ny fasadpanel enligt specifikation','Tätning och fogning'],
        excludes: ['Målning av ny panel (tillval)','Bärande konstruktioner utöver panel','Material ej specificerat i offert'],
      },
      {
        id: 'trall', label: 'Trall / Altangolv',
        trigger: s => /\b(trall|altangolv|altantrall|trallplank)\b/.test(s),
        action: 'byte eller montering av trall och altangolv',
        scopeCtx: 'Arbetet innefattar demontering av gammalt golv, anpassning av underlag och montering av nya trallbrädor.',
        includes: ['Demontering av befintlig trall','Montering av ny trall enligt specifikation','Justering av underlag och syll'],
        excludes: ['Impregnering eller oljning (tillval)','Rekonstruktion av bärande balk','Material ej specificerat i offert'],
      },
      {
        id: 'målning', label: 'Målning / Ytbehandling',
        trigger: s => /\b(måla|målar|målat|målning|ytbehandling|ytbehandla|lacka|lackar|lackering)\b/.test(s),
        action: 'målning och ytbehandling av angivna ytor',
        scopeCtx: 'Arbetet utförs av erfaren målare med rätt material och metod för aktuell yta och miljö.',
        includes: ['Förarbete: slipning, spackling och grundning','Målning med överenskommet material och antal lager','Skydd av angränsande ytor'],
        excludes: ['Borttagning av gammal färg utöver normalt förarbete','Specialbehandlingar (brandskyddsfärg, klotterskydd)','Material ej inkluderat i offert'],
      },
      {
        id: 'felsökning', label: 'Felsökning / Kontroll',
        trigger: s => /\b(felsök|felsöker|felsökt|felsökning|felsöka|diagnostiser|lokalisera|lokaliserar|lokaliserat|kontrollera|kontrollerar|kontrollerat|undersöka|undersöker|undersökt|besiktiga|besiktigar|besiktning|inventera|inventering|utreda|utreder|utredning|bedöma|bedömer)\b|hitta felet|hitta läckan|leta efter fel|hitta orsak/.test(s),
        action: 'felsökning och lokalisering av fel eller skada',
        scopeCtx: 'Arbetet utförs systematiskt av erfaren tekniker med rätt utrustning och dokumenteras skriftligt.',
        includes: ['Systematisk felsökning och diagnostik','Dokumentation av fynd och skadeläge','Skriftlig åtgärdsrapport med prioritering','Löpande kommunikation med uppdragsgivare'],
        excludes: ['Avhjälpande åtgärder utöver felsökning (offerteras separat)','Ingrepp i konstruktion utan separat avtal','Garanterat resultat vid dolda eller komplexa fel'],
      },
      {
        id: 'skadedjur', label: 'Skadedjursbekämpning',
        trigger: s => /\b(myror|myrproblem|råttor|möss|gnagare|getingar|vespa|skalbaggar|insektsangrepp|skadedjur|bekämpa|bekämpning|sanera|sanering|utrota)\b/.test(s),
        action: 'inspektion och bekämpning av skadedjur',
        scopeCtx: 'Arbetet innefattar kartläggning av angreppsvägar, åtgärdsplan och genomförande av bekämpning.',
        includes: ['Inspektion och kartläggning av angreppsvägar','Identifiering av skadedjursart och omfattning','Bekämpning och uppföljning','Skriftlig rapport efter utfört arbete'],
        excludes: ['Rivning eller byggarbeten för åtkomst (separat offert)','Garanterad utrotning vid kraftiga angrepp utan fortsatt avtal','Löpande förebyggande avtal (separat prissättning)'],
      },
      {
        id: 'återställning', label: 'Återställning',
        trigger: s => /återställ/.test(s),
        action: 'återställning av skadade ytor och konstruktioner',
        scopeCtx: 'Arbetet syftar till att återställa konstruktionen till ursprungligt eller godkänt skick.',
        includes: ['Bedömning av skadeomfattning','Reparation och återställning av drabbade delar','Kontroll och besiktning efter åtgärd','Dokumentation och rapport'],
        excludes: ['Förebyggande åtgärder utöver specificerat arbete','Orsaksutredning utan separat avtal','Material ej specificerat i offert'],
      },
      {
        id: 'stenreparation', label: 'Plattreparation / Markstenjustering',
        trigger: s => /\b(laga|lagning|reparera|justera|rikta|sättning|sättningar|komplettera|komplettering)\b/.test(s) &&
                      /\b(marksten|plattor|sten|uppfart|stenläggning|markytan?|gångbanor?)\b/.test(s),
        action: 'reparation och justering av marksten och belagda ytor',
        scopeCtx: 'Arbetet utförs med precision för att återställa jämna och stabila markytor.',
        includes: ['Uppbrytning och återläggning av skadade eller sjunkna plattor','Justering av underlag och sättningar','Återläggning och fogning','Kontroll och jämning av angränsande ytor'],
        excludes: ['Ny fogsand utöver fogning vid reparation (tillval)','Impregnering (tillval)','Helrenovering av yta utan separat offert'],
      },
      {
        id: 'reparation', label: 'Reparation / Åtgärd',
        trigger: s => /\b(fixa|fixar|fixat|laga|lagar|lagat|reparera|reparerar|reparerat|reparation|åtgärda|åtgärdar|åtgärdat|åtgärd|justera|justerar|justerat|byta|byter|bytt|byte|täta|tätar|tätat|tätning|komplettera|komplettering)\b/.test(s),
        action: 'reparation och åtgärd av angivna delar',
        scopeCtx: 'Arbetet utförs av erfaren personal med rätt kompetens och verktyg för respektive moment.',
        includes: ['Bedömning och planering av åtgärd','Reparation eller justering enligt beskrivning','Test och kontroll efter åtgärd','Städning och bortforsling av eget avfall'],
        excludes: ['Större utbyten utöver specificerad åtgärd','Material ej inkluderat i offert','Tillkommande arbeten som framkommer under utförandet'],
      },
      {
        id: 'altantvätt', label: 'Altantvätt',
        trigger: s => /\b(altantvätt)\b/.test(s) || (WASH_V.test(s) && /\b(altan|terrass|uteplats)\b/.test(s)),
        action: 'professionell rengöring av altan, räcken och träytor',
        scopeCtx: 'Arbetet utförs varsamt med metod anpassad för aktuellt träslag och ytskikt för att uppnå ett rent resultat utan att skada underlaget.',
        includes: ['Högtrycksrengöring anpassad för träyta','Biologisk algbehandling','Rengöring av räcken, trappor och trädetaljer','Eftersköljning och kontroll av utfört arbete'],
        excludes: ['Oljning eller impregnering (tillval)','Slipning eller utbyte av plankor','Målning'],
      },
      {
        id: 'fasadtvätt', label: 'Fasadtvätt / Utvändig tvätt',
        trigger: s => /\b(fasadtvätt)\b/.test(s) ||
                      (WASH_V.test(s) && /\b(fasad|hus|byggnad|fasadyta|fasaddel|sockel|vägg|puts|tegel)\b/.test(s)),
        action: 'professionell tvätt av fasad och utvändiga ytor',
        scopeCtx: 'Utförs av certifierad personal med metod och tryck anpassat efter materialtyp och föroreningsgrad för att uppnå ett rent och vårdat resultat utan att skada underlaget.',
        includes: ['Inventering och bedömning av fasadtyp och ytskikt','Högtrycks- eller softwashtvätt med anpassad metod','Biologisk algbehandling vid behov','Rengöring kring fönster, dörrar och detaljer'],
        excludes: ['Puts- eller murningsarbeten','Målning av fasad','Fönsterputsning (tillval)'],
      },
      {
        id: 'stentvätt', label: 'Stentvätt / Markytor',
        trigger: s => /\b(stentvätt|stenhögtryck)\b/.test(s) ||
                      (WASH_V.test(s) && /\b(sten|marksten|betongplattor|stenläggning|plattor|stenterrass|uppfart|entréyta|hårdgjord|markytor?|gångbana|gångväg)\b/.test(s)),
        action: 'högtrycksrengöring av marksten och belagda ytor',
        scopeCtx: 'Arbetet utförs med professionell utrustning och miljögodkända rengöringsmedel anpassade för aktuell yta och smutsnivå.',
        includes: ['Högtrycksrengöring av angiven yta','Biologisk algbehandling','Rengöring av kanter, kantstöd och detaljer','Efterspolning och kontroll av utfört arbete'],
        excludes: ['Ny fogsand efter tvätt (tillval)','Reparation av skadade plattor','Bortforsling av annat material'],
      },
      {
        id: 'taktvätt', label: 'Taktvätt / Mossrening',
        trigger: s => /\b(taktvätt|mossrening|mossborttagning)\b/.test(s) || (WASH_V.test(s) && /\btak\b/.test(s)),
        action: 'taktvätt och mossrening',
        scopeCtx: 'Arbetet utförs varsamt för att inte skada takbeläggning eller tätskikt.',
        includes: ['Manuell eller mekanisk mossborttagning','Högtryckssköljning av takyta','Biologisk mossdödare (förebyggande)','Kontroll av takrännor och stuprör'],
        excludes: ['Reparation av skadade takpannor','Tätning av genomföringar','Byte av takbeläggning'],
      },
      {
        id: 'fönsterputsning', label: 'Fönsterputsning',
        trigger: s => /\bfönsterputs|\b(glasrengöring)\b|putsa fönster/.test(s) || (WASH_V.test(s) && /fönster/.test(s)),
        action: 'professionell fönsterputsning',
        scopeCtx: 'Utförs med professionell utrustning och rengöringsmedel anpassade för glas och karmar.',
        includes: ['Putsning av angivna fönster in- och/eller utvändigt','Rengöring av fönsterkarmar och fönsterbräden'],
        excludes: ['Reparation av trasigt glas','Svåråtkomliga fönster utan ställning (pristillägg)','Inglasade balkonger (separat offert)'],
      },
      {
        id: 'häckklippning', label: 'Häckklippning',
        trigger: s => /häck/.test(s) || (CLIP_V.test(s) && /\b(buska|buskar|buskage)\b/.test(s)),
        action: 'häckklippning och formklippning av buskage',
        scopeCtx: 'Arbetet utförs med professionell utrustning av erfaren personal.',
        includes: ['Klippning och formning av häck och buskage','Uppsamling och borttransport av klippmaterial'],
        excludes: ['Trädfällning eller stubbrytning','Plantering eller komplettering av häck','Kemisk bekämpning av ogräs'],
      },
      {
        id: 'gräsklippning', label: 'Gräsklippning',
        trigger: s => /\b(gräsklippning|grästrimning|gräsmatta)\b/.test(s) || (CLIP_V.test(s) && /gräs/.test(s)),
        action: 'professionell gräsklippning',
        scopeCtx: 'Arbetet utförs med professionell utrustning anpassad efter ytans storlek.',
        includes: ['Klippning av gräsmatta till önskad höjd','Kantklippning längs gångbanor och rabatter','Uppsamling och borttransport av gräsklipp'],
        excludes: ['Gödning eller behandling av gräsmatta (tillval)','Nysådd eller lagning av fläckar','Borttagning av mossa'],
      },
      {
        id: 'ogräs', label: 'Ogräsrensning',
        trigger: s => /\b(ogräs|ogräsrensning|rensa ogräs|fogrensning|rensa fogar|ogräsfri)\b/.test(s),
        action: 'ogräsrensning och rensning av belagda ytor',
        scopeCtx: 'Arbetet utförs manuellt och med lämpliga verktyg för aktuell yta och fogbredd.',
        includes: ['Rensning av ogräs i fogar och längs kanter','Uppsamling och borttransport av ogräs','Eftersopning av rengjord yta'],
        excludes: ['Kemisk bekämpning utan separat avtal','Ny fogsand (tillval)','Markstensreparationer'],
      },
      {
        id: 'fogsand', label: 'Fogsand / Fogning',
        trigger: s => /\b(fogsand|fogning|foga|fogar|fogat)\b|lägga fogsand|fylla fogsand|fylla i fogsand/.test(s),
        action: 'läggning av fogsand och fogning av stenyta',
        scopeCtx: 'Arbetet utförs efter rengöring för optimal fästighet och hållbarhet.',
        includes: ['Bortsopning av gammal fogsand','Läggning av ny fogsand','Vattning och eftersopning'],
        excludes: ['Högtryckstvätt (tillval inför fogsand)','Justering av ojämna plattor','Material utöver specificerad mängd'],
      },
      {
        id: 'impregnering', label: 'Impregnering / Ytskydd',
        trigger: s => /impregner|träskydd|träolja|olja trä|stenimpregnering|markimpregnering/.test(s),
        action: 'impregnering och ytskyddsbehandling',
        scopeCtx: 'Arbetet utförs med godkänt skyddsmedel för aktuellt material och exponering.',
        includes: ['Rengöring av yta inför behandling','Applicering av impregnering / ytskyddsmedel','Kontroll av täckning och inträngning'],
        excludes: ['Slipning eller utbyte av plankor (tillval)','Målning (separat offert)','Material ej specificerat i offert'],
      },
      {
        id: 'markarbete', label: 'Markarbete / Schaktning',
        trigger: s => /\b(schakta|schaktning|gräva|grävning|dränera|dränering|dagvatten|markarbete|markarbeten)\b/.test(s),
        action: 'markarbete och schaktning',
        scopeCtx: 'Arbetet utförs med rätt maskinell utrustning och med hänsyn till befintliga ledningar.',
        includes: ['Schaktning och bortforsling av massor','Dränering eller dagvattenåtgärder enligt plan','Återfyllning och komprimering'],
        excludes: ['Ledningskartering (uppdragsgivarens ansvar)','Asfalts- eller plattläggning (tillval)','Specialmaskiner utöver offert'],
      },
      {
        id: 'snöröjning', label: 'Snöröjning / Halkbekämpning',
        trigger: s => /\b(snöröjning|plogga|ploggar|plogning|skotta|skottning|sanda|sandning|salta|saltning|halkbekämpning)\b/.test(s),
        action: 'snöröjning och halkbekämpning',
        scopeCtx: 'Arbetet utförs snabbt och effektivt för att säkerställa framkomlighet och säkerhet.',
        includes: ['Plogning och skottning av ytor och gångar','Sandning och/eller saltning vid halka','Bortforsling av snö vid behov'],
        excludes: ['Skador orsakade av plogutrustning på ej markerade hinder','Återställning av vegetation efter vintersäsong'],
      },
      {
        id: 'fastighetsservice', label: 'Fastighetsservice',
        trigger: s => /\b(fastighetsservice|förvaltning|rondering|tillsyn|skötsel|trapphus|tvättstuga|entré|källare|garage|förråd)\b/.test(s),
        action: 'fastighetsservice och löpande skötsel',
        scopeCtx: 'Arbetet utförs enligt överenskommen specifikation för att säkerställa fastighetens funktion och värde.',
        includes: ['Regelbundna tillsynsrundor med protokollföring','Felanmälan och åtgärd vid avvikelser','Rapportering till uppdragsgivare'],
        excludes: ['Större renoveringsarbeten','Specialisttjänster (el, VVS, hiss)','Material ej inkluderat i offert'],
      },
      {
        id: 'bygg', label: 'Bygg / Renovering',
        trigger: s => /\b(bygga|bygger|byggt|renovera|renoverar|renovering|nybyggnation)\b/.test(s),
        action: 'bygg och renoveringsarbete',
        scopeCtx: 'Arbetet utförs av behörig personal med rätt kompetens och material.',
        includes: ['Arbete och personal enligt offert','Nödvändig utrustning och skyddsmaterial','Dokumentation och besiktning vid behov'],
        excludes: ['Bygglov och myndighetskontakter (uppdragsgivarens ansvar)','Specialisttjänster (el, VVS) utöver offert','Material ej specificerat i offert'],
      },
    ];

    let matched = DEFS.filter(d => d.trigger(sum));

    // Suppress generic reparation when a more specific repair moment matched
    const specificRepair = matched.some(m => ['trall','fasadpanel','återställning','stenreparation'].includes(m.id));
    if (specificRepair) matched = matched.filter(m => m.id !== 'reparation');
    // Suppress generic reparation when rivning owns the action
    if (matched.some(m => m.id === 'rivning')) matched = matched.filter(m => m.id !== 'reparation');
    // Suppress fastighetsservice when more specific moments cover the work
    const hasSpecificWork = matched.some(m => !['fastighetsservice','reparation'].includes(m.id));
    if (hasSpecificWork) matched = matched.filter(m => m.id !== 'fastighetsservice');

    // Fallback: infer from added service lines when summary is empty/short
    if (matched.length === 0) {
      const svcLines = this._editLines.filter(l => l.type === 'service');
      if (svcLines.length) {
        const ids = svcLines.map(l => (l.templateId || l.priceRuleRef || '').toLowerCase()).join(' ');
        const fbId = /altan/.test(ids) ? 'altantvätt' : /fasad/.test(ids) ? 'fasadtvätt' :
                     /sten/.test(ids) ? 'stentvätt' : /häck/.test(ids) ? 'häckklippning' :
                     /fs|fastighet/.test(ids) ? 'fastighetsservice' : /fönster/.test(ids) ? 'fönsterputsning' : null;
        if (fbId) matched = [DEFS.find(d => d.id === fbId)].filter(Boolean);
      }
    }

    let scope, includes, excludes, label;

    if (matched.length === 0) {
      scope    = `Arbetet omfattar åtgärder enligt kundens beskrivning och avser de ytor och moment som anges i offerten. Utförandet anpassas efter platsens förutsättningar och eventuella avvikelser kommuniceras med kund innan tillkommande arbete påbörjas.`;
      includes = '- Arbete och personal enligt offert\n- Nödvändig utrustning och skyddsmaterial\n- Städning och bortforsling av eget avfall\n- Löpande kommunikation med kund';
      excludes = '- Material ej specificerat i offert\n- Tillkommande arbeten utöver offertens omfattning\n- Specialisttjänster utan separat avtal';
      label    = 'Generell';
    } else {
      label = matched.map(m => m.label).join(' + ');

      // Build scope — single moment vs multi-moment
      const actions = matched.map(m => m.action);
      if (matched.length === 1) {
        scope = `Arbetet omfattar ${actions[0]}${qtyStr ? ' (' + qtyStr + ')' : ''}. ${matched[0].scopeCtx}`;
      } else {
        const last = actions[actions.length - 1];
        const rest = actions.slice(0, -1);
        const actionStr = rest.join(', ') + ' samt ' + last;
        scope = `Uppdraget omfattar ${actionStr}${qtyStr ? ' (' + qtyStr + ')' : ''}. Samtliga moment utförs av VIFT:s personal med anpassad metod och utrustning för respektive yta och materialtyp. Eventuella avvikelser kommuniceras med kund innan tillkommande arbete påbörjas.`;
      }

      // Merge includes (deduplicated by first 22 chars)
      const inclSeen = new Set();
      const inclLines = [];
      for (const m of matched) {
        for (const inc of m.includes) {
          const key = inc.substring(0, 22);
          if (!inclSeen.has(key)) { inclSeen.add(key); inclLines.push('- ' + inc); }
        }
      }
      if (!inclLines.some(l => /städning/i.test(l))) {
        inclLines.push('- Städning av arbetsplats efter utfört arbete');
      }
      includes = inclLines.join('\n');

      // Merge excludes (deduplicated by first 22 chars)
      const exclSeen = new Set();
      const exclLines = [];
      for (const m of matched) {
        for (const exc of m.excludes) {
          const key = exc.substring(0, 22);
          if (!exclSeen.has(key)) { exclSeen.add(key); exclLines.push('- ' + exc); }
        }
      }
      if (!exclLines.some(l => /tillkommande/i.test(l))) {
        exclLines.push('- Tillkommande arbeten som framkommer under utförandet');
      }
      excludes = exclLines.join('\n');
    }

    this._wizardData.scope       = scope;
    this._wizardData.includes    = includes;
    this._wizardData.excludes    = excludes;
    this._wizardData._lastGenFrom = label + ' (' + new Date().toLocaleTimeString('sv-SE',{hour:'2-digit',minute:'2-digit'}) + ')';
    this._rerender();
    showToast('Textförslag baserat på: ' + label);
  },

  /* ── Totals ─── */
  _calcExVat(lines, extras) {
    const lSum = (lines||[]).filter(l=>l.type!=='text').reduce((s,l)=>s+_lineExVat(l),0);
    const eSum = (extras||[]).reduce((s,e)=>s+Math.round((+(e.qty||1))*(+(e.unitPrice||0))),0);
    return Math.round(lSum + eSum);
  },

  _calcRutAmt(lines) {
    return Math.round((lines||[]).filter(l=>l.type==='service').reduce((s,l)=>s+(l.rutAmount||0),0));
  },

  _refreshTotals() {
    this._editLines.forEach((l, i) => {
      if (l.type === 'manual' || l.type === 'fixed') {
        const el = document.getElementById('off-lt-' + i);
        if (el) el.textContent = fmt(Math.round((l.qty!=null?l.qty:1)*(l.unitPrice||0))) + ' kr';
      }
    });
    const bar = document.getElementById('off-totals-bar');
    if (bar) bar.innerHTML = this._totalsBarHtml();
  },

  /* ── Line management ─── */
  _addManualLine() {
    this._editLines.push({id:'M'+Date.now(),type:'manual',description:'',qty:1,unit:'st',unitPrice:0,vatRate:25,total:0});
    const el = document.getElementById('off-lines');
    if (el) el.innerHTML = this._linesHtml();
    this._refreshTotals();
    setTimeout(() => {
      const inputs = document.querySelectorAll('#off-lines input[placeholder="Benämning"]');
      if (inputs.length) inputs[inputs.length-1].focus();
    }, 50);
  },

  _addTextBlock() {
    this._editLines.push({id:'T'+Date.now(),type:'text',blockTitle:'',text:''});
    const el = document.getElementById('off-lines');
    if (el) el.innerHTML = this._linesHtml();
  },

  _removeLine(idx) {
    this._editLines.splice(idx, 1);
    const el = document.getElementById('off-lines');
    if (el) el.innerHTML = this._linesHtml();
    this._refreshTotals();
  },

  /* ── Service calc overlay ─── */
  _openSvcCalc(editIdx) {
    this._svcEditIdx = editIdx;
    if (editIdx !== null && editIdx !== undefined) {
      const l = this._editLines[editIdx];
      if (l && l.type === 'service') {
        this._activeSvcId  = l.templateId || l.priceRuleRef;
        this._svcFields    = {...(l.inputValues || {})};
        this._svcReduction = l.reductionType || 'ingen';
      }
    } else {
      this._activeSvcId  = null;
      this._svcFields    = {};
      this._svcReduction = 'ingen';
    }
    // Respect sidebar on desktop: overlay starts at page-area left edge
    const isDesktop = window.innerWidth >= 1024;
    const sidebarW  = isDesktop ? (document.getElementById('bottom-nav')?.offsetWidth || 240) : 0;
    const alignItems = isDesktop ? 'center' : 'flex-end';
    const ovPad      = isDesktop ? '20px' : '0';

    let ov = document.getElementById('off-svc-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'off-svc-overlay';
      ov.onclick = e => { if (e.target === ov) OffersPage._closeSvcCalc(); };
      document.body.appendChild(ov);
    }
    ov.style.cssText = `position:fixed;top:0;right:0;bottom:0;left:${sidebarW}px;z-index:600;
      background:rgba(0,0,0,.42);display:flex;align-items:${alignItems};justify-content:center;padding:${ovPad};box-sizing:border-box;`;
    ov.innerHTML = this._svcOverlayHtml(isDesktop);
    if (this._activeSvcId) setTimeout(() => { this._initChips(); this._updateSvcPreview(); }, 20);
  },

  _closeSvcCalc() {
    document.getElementById('off-svc-overlay')?.remove();
    this._svcEditIdx = null;
  },

  _svcOverlayHtml(isDesktop) {
    const isEdit     = this._svcEditIdx !== null && this._svcEditIdx !== undefined;
    const activeTmpl = this._getT().find(t => t.id === this._activeSvcId);
    const maxH       = isDesktop ? '84vh' : '92vh';
    const radius     = isDesktop ? '10px' : '14px 14px 0 0';

    const calcBody = activeTmpl
      ? this._svcCalcHtml(activeTmpl)
      : `<div style="padding:36px 16px;text-align:center;color:var(--mt);">
          <div style="margin-bottom:10px;">${ic('zap',28)}</div>
          <div style="font-size:13px;font-weight:600;">Välj en tjänst ${isDesktop ? 'till vänster' : 'ovan'}</div>
          <div style="font-size:11px;margin-top:4px;">Alla priser exklusive moms</div>
        </div>`;

    const descVal  = activeTmpl ? (activeTmpl.defaultDesc||'').replace(/"/g,'&quot;') : '';
    const addLabel = isEdit ? 'Uppdatera tjänst' : 'Lägg till i offert';

    const hdr = `<div class="off-svc-hdr">
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:800;color:var(--navy);">${ic('zap',13)} ${isEdit ? 'Redigera tjänst' : 'Lägg till tjänst'}</div>
        <div style="font-size:10px;color:var(--mt);">Alla priser exklusive moms</div>
      </div>
      <button type="button" onclick="OffersPage._closeSvcCalc()" class="off-close-btn">${ic('x',14)}</button>
    </div>`;

    const footer = `<div id="off-svc-footer" class="off-svc-footer">
      <div class="off-svc-footer-inner">
        <div class="fg">
          <label>Beskrivning på offerten</label>
          <input id="svc-custom-desc" value="${descVal}" placeholder="Kundvänlig beskrivning…" style="font-size:11px;">
        </div>
        <button type="button" class="btn bp bsm off-svc-add-btn" onclick="OffersPage._addSvcLine()">
          ${ic('plus',12)} ${addLabel}
        </button>
      </div>
    </div>`;

    if (!isDesktop) {
      const chips = this._getT().map(t => {
        const active = t.id === this._activeSvcId;
        return `<button type="button" id="off-svc-chip-${t.id}"
          onclick="OffersPage._activateSvc('${t.id}',false)"
          class="off-svc-chip${active ? ' off-svc-chip--active' : ''}">${t.name}</button>`;
      }).join('');
      return `<div class="off-svc-modal" style="max-height:${maxH};border-radius:${radius};">
        ${hdr}
        <div class="off-svc-chips-bar">${chips}</div>
        <div id="off-svc-body" class="off-svc-body">${calcBody}</div>
        ${footer}
      </div>`;
    }

    const svcList = this._getT().map(t => {
      const active = t.id === this._activeSvcId;
      return `<button type="button" id="off-svc-chip-${t.id}"
        onclick="OffersPage._activateSvc('${t.id}',false)"
        class="off-svc-menu-item${active ? ' off-svc-menu-item--active' : ''}">
        ${ic(t.icon,12)}<span>${t.name}</span>
      </button>`;
    }).join('');

    return `<div class="off-svc-modal" style="max-height:${maxH};border-radius:${radius};">
      ${hdr}
      <div class="off-svc-layout">
        <div class="off-svc-menu">${svcList}</div>
        <div id="off-svc-body" class="off-svc-body">${calcBody}</div>
      </div>
      ${footer}
    </div>`;
  },

  _activateSvc(tId, keepFields) {
    this._activeSvcId = tId;
    this._getT().forEach(t => {
      const btn = document.getElementById('off-svc-chip-' + t.id);
      if (!btn) return;
      const a = t.id === tId;
      btn.classList.toggle('off-svc-menu-item--active', a);
      btn.classList.toggle('off-svc-chip--active', a);
    });
    const tmpl = this._getT().find(t => t.id === tId);
    if (!tmpl) return;
    if (!keepFields) {
      this._svcFields    = {};
      this._svcReduction = tmpl.defaultReduction || 'ingen';
      tmpl.fields.forEach(f => {
        if (f.isRut || f.isRot) return;  // handled by _svcReduction
        if (f.type === 'pricegroup') {
          const pgs = (state.priceGroups || []).filter(p => p.billingType !== 'monthly');
          const defId = f.def || (pgs[0] && pgs[0].id) || '';
          this._svcFields[f.id] = defId;
          const pg = pgs.find(p => p.id === defId);
          if (pg && !this._svcFields['rate']) this._svcFields['rate'] = pg.hourRate;
        } else if (f.def !== undefined)           this._svcFields[f.id] = f.def;
        else if (f.type==='chips'&&f.opts) this._svcFields[f.id] = f.opts[0];
        else if (f.type==='bool')          this._svcFields[f.id] = false;
        else if (f.type==='number')        this._svcFields[f.id] = 0;
        else                               this._svcFields[f.id] = '';
      });
    }
    const body = document.getElementById('off-svc-body');
    if (body) {
      body.innerHTML = this._svcCalcHtml(tmpl);
      setTimeout(() => { this._initChips(); this._updateSvcPreview(); }, 20);
    }
    // Update footer description to match the new service's default
    const descEl = document.getElementById('svc-custom-desc');
    if (descEl && !keepFields) descEl.value = tmpl.defaultDesc || '';
  },

  _svcCalcHtml(tmpl) {
    if (!tmpl) return '';
    const numF  = tmpl.fields.filter(f=>f.type==='number');
    const chipF = tmpl.fields.filter(f=>f.type==='chips');
    const txtF  = tmpl.fields.filter(f=>f.type==='text');
    const pgF   = tmpl.fields.filter(f=>f.type==='pricegroup');
    const boolF = tmpl.fields.filter(f=>f.type==='bool'&&!f.isRut&&!f.isRot);
    const curRed = this._svcReduction;
    let html = '';

    // ── Quantity / number inputs ──
    numF.forEach(f => {
      const unit = {area:'m²',length:'lm',hours:'tim',qty:'tim',months:'mån'}[f.id]||'';
      const val  = this._svcFields[f.id]!=null&&this._svcFields[f.id]!==0 ? this._svcFields[f.id] : (f.def||'');
      html += `<div style="margin-bottom:10px;">
        <label style="font-size:10px;font-weight:700;color:var(--navy);display:block;margin-bottom:3px;">${f.label}${f.req?' <span style="color:var(--rd)">*</span>':''}</label>
        <div style="display:flex;align-items:center;gap:6px;">
          <input type="number" id="svc-f-${f.id}" value="${val}" min="0"
            step="${['rate','monthly','material'].includes(f.id)?'1':'0.5'}" placeholder="0"
            style="font-size:18px;font-weight:800;width:80px;text-align:center;padding:6px 8px;border:2px solid var(--navy);border-radius:var(--rs);color:var(--navy);"
            oninput="OffersPage._svcFields['${f.id}']=parseFloat(this.value)||0;OffersPage._updateSvcPreview()">
          ${unit?`<span style="font-size:14px;color:var(--mt);font-weight:700;">${unit}</span>`:''}
        </div>
      </div>`;
    });

    // ── Price group selector ──
    pgF.forEach(f => {
      const pgs = (state.priceGroups || []).filter(p => p.active !== false && p.billingType !== 'monthly');
      const curVal = this._svcFields[f.id] || f.def || (pgs[0] && pgs[0].id) || '';
      html += `<div style="margin-bottom:10px;">
        <label style="font-size:10px;font-weight:700;color:var(--navy);display:block;margin-bottom:3px;">${f.label}${f.req?' <span style="color:var(--rd)">*</span>':''}</label>
        <select id="svc-f-${f.id}" style="width:100%;font-size:13px;font-weight:600;padding:6px 8px;border:1.5px solid var(--br);border-radius:var(--rs);"
          onchange="OffersPage._svcFields['${f.id}']=this.value;var _pg=(state.priceGroups||[]).find(p=>p.id===this.value);if(_pg){OffersPage._svcFields['rate']=_pg.hourRate;var rEl=document.getElementById('svc-f-rate');if(rEl)rEl.value=_pg.hourRate;}OffersPage._updateSvcPreview()">
          ${pgs.map(pg => `<option value="${pg.id}" ${curVal===pg.id?'selected':''}>${esc(pg.name)} (${fmt(pg.hourRate)} kr/tim)</option>`).join('')}
        </select>
      </div>`;
    });

    // ── Text inputs ──
    txtF.forEach(f => {
      html += `<div style="margin-bottom:10px;">
        <label style="font-size:10px;font-weight:700;color:var(--navy);display:block;margin-bottom:3px;">${f.label}${f.req?' <span style="color:var(--rd)">*</span>':''}</label>
        <input type="text" id="svc-f-${f.id}" value="${this._svcFields[f.id]||''}" placeholder="${f.label}" style="width:100%;"
          oninput="OffersPage._svcFields['${f.id}']=this.value;OffersPage._updateSvcPreview()">
      </div>`;
    });

    // ── Chip selectors ──
    chipF.forEach(f => {
      html += `<div style="margin-bottom:8px;">
        <label style="font-size:9px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px;">${f.label}</label>
        <div data-chips="${f.id}" style="display:flex;flex-wrap:wrap;gap:3px;">
          ${(f.opts||[]).map(o=>`<button type="button" data-val="${o}"
            style="padding:4px 9px;border-radius:20px;border:1.5px solid var(--br);font-size:10px;font-weight:600;cursor:pointer;background:#fff;color:var(--tx);transition:all .1s;"
            onclick="OffersPage._setChip('${f.id}','${o.replace(/'/g,"\\'")}',this)">${o}</button>`).join('')}
        </div>
      </div>`;
    });

    // ── Bool add-ons ──
    if (boolF.length) {
      html += `<div style="margin-bottom:8px;">
        <label style="font-size:9px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px;">Tillval</label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">`;
      boolF.forEach(f => {
        html += `<label style="display:flex;align-items:center;gap:6px;padding:5px 8px;border:1.5px solid var(--br);border-radius:var(--rs);cursor:pointer;font-size:10px;font-weight:600;line-height:1.3;">
          <input type="checkbox" id="svc-f-${f.id}" style="width:14px;height:14px;flex-shrink:0;" ${this._svcFields[f.id]?'checked':''}
            onchange="OffersPage._svcFields['${f.id}']=this.checked;OffersPage._updateSvcPreview()">
          <span>${f.addLabel||f.label}</span></label>`;
      });
      html += `</div></div>`;
    }

    // ── Unified tax reduction selector — always show all three options ──
    const redOpts = [
      {v:'ingen', l:'Ingen reduktion'},
      {v:'rut',   l:'RUT – 50 %'},
      {v:'rot',   l:'ROT – 30 %'},
    ];
    html += `<div style="margin-bottom:8px;padding-top:6px;border-top:1px solid var(--br);">
      <label style="font-size:9px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px;">Skattereduktion</label>
      <div style="display:flex;gap:3px;">
        ${redOpts.map(o=>`<button type="button" id="svc-red-${o.v}"
          onclick="OffersPage._setReduction('${o.v}')"
          style="flex:1;padding:5px 6px;border-radius:6px;border:1.5px solid ${curRed===o.v?'var(--navy)':'var(--br)'};
            font-size:10px;font-weight:700;cursor:pointer;white-space:nowrap;
            background:${curRed===o.v?'var(--navy)':'#fff'};
            color:${curRed===o.v?'#fff':'var(--mt)'};">${o.l}</button>`).join('')}
      </div>
      <div style="font-size:9px;color:var(--mt);margin-top:3px;">Förutsätter att kunden har rätt till avdraget</div>
    </div>`;

    // ── Live preview ──
    html += `<div id="svc-preview" style="background:var(--navy);color:#fff;border-radius:var(--rs);padding:9px 11px;margin-top:4px;min-height:44px;">
      <div style="font-size:10px;opacity:.65;">Fyll i fälten ovan för att se kalkylen…</div>
    </div>`;
    return html;
  },

  /* ── Chips ─── */
  _setChip(fieldId, value, btn) {
    this._svcFields[fieldId] = value;
    const group = btn.closest('[data-chips]');
    if (group) {
      group.querySelectorAll('button').forEach(b => {
        const a = b === btn;
        b.style.background  = a ? 'var(--navy)' : '#fff';
        b.style.color       = a ? '#fff'        : 'var(--tx)';
        b.style.borderColor = a ? 'var(--navy)' : 'var(--br)';
        b.style.fontWeight  = a ? '700'         : '600';
      });
    }
    this._updateSvcPreview();
  },

  _setReduction(val) {
    this._svcReduction = val;
    ['ingen','rut','rot'].forEach(v => {
      const btn = document.getElementById('svc-red-' + v);
      if (!btn) return;
      const active = v === val;
      btn.style.background  = active ? 'var(--navy)' : '#fff';
      btn.style.color       = active ? '#fff'        : 'var(--mt)';
      btn.style.borderColor = active ? 'var(--navy)' : 'var(--br)';
    });
    this._updateSvcPreview();
  },

  _initChips() {
    const tmpl = this._getT().find(t => t.id === this._activeSvcId);
    if (!tmpl) return;
    tmpl.fields.filter(f=>f.type==='chips').forEach(f => {
      const val   = this._svcFields[f.id] || f.def || (f.opts&&f.opts[0]);
      const group = document.querySelector('[data-chips="' + f.id + '"]');
      if (!group) return;
      group.querySelectorAll('button').forEach(btn => {
        const a = btn.dataset.val === val || btn.textContent.trim() === val;
        btn.style.background  = a ? 'var(--navy)' : '#fff';
        btn.style.color       = a ? '#fff'        : 'var(--tx)';
        btn.style.borderColor = a ? 'var(--navy)' : 'var(--br)';
        btn.style.fontWeight  = a ? '700'         : '600';
      });
    });
  },

  /* ── Svc preview ─── */
  _updateSvcPreview() {
    const tmpl = this._getT().find(t => t.id === this._activeSvcId);
    const prev = document.getElementById('svc-preview');
    if (!tmpl || !prev) return;
    // Collect non-reduction fields from DOM
    tmpl.fields.forEach(f => {
      if (f.type === 'chips' || f.isRut || f.isRot) return;
      const el = document.getElementById('svc-f-' + f.id);
      if (!el) return;
      if (f.type==='bool')            this._svcFields[f.id] = el.checked;
      else if (f.type==='number')     this._svcFields[f.id] = parseFloat(el.value)||0;
      else if (f.type==='pricegroup') {
        this._svcFields[f.id] = el.value;
        const _pg = (state.priceGroups||[]).find(p=>p.id===el.value);
        if (_pg) this._svcFields['rate'] = _pg.hourRate;
      } else                          this._svcFields[f.id] = el.value;
    });
    // Inject unified reduction choice into calc fields
    const fields = {
      ...this._svcFields,
      rut: this._svcReduction === 'rut',
      rot: this._svcReduction === 'rot',
    };
    try {
      const result = tmpl.calc(fields);
      const {ls, exVat, rutAmt} = result;
      if (!exVat && exVat !== 0) {
        prev.innerHTML = `<div style="font-size:10px;opacity:.65;">Fyll i obligatoriska fält för att se kalkylen.</div>`;
        return;
      }
      const vat    = Math.round(exVat * (tmpl.vatRate||25) / 100);
      const incVat = exVat + vat;
      const custPr = incVat - (rutAmt||0);
      const redLbl = this._svcReduction === 'rut' ? 'RUT' : this._svcReduction === 'rot' ? 'ROT' : '';

      // Internal calc detail (small, muted)
      let html = '';
      if (result.tierLbl) {
        html += `<div style="font-size:8px;opacity:.5;margin-bottom:3px;letter-spacing:.3px;">Prisnivå: ${result.tierLbl}</div>`;
      }
      html += `<div style="font-size:9px;opacity:.65;margin-bottom:5px;padding-bottom:5px;border-bottom:1px solid rgba(255,255,255,.12);">`;
      ls.forEach(l => {
        html += `<div style="margin-bottom:1px;">${l.desc} · ${l.qty} ${l.unit} × ${fmt(l.price)} kr = ${fmt(Math.round(l.qty*l.price))} kr</div>`;
      });
      html += `</div>`;

      // Price rows
      html += `<div style="display:flex;justify-content:space-between;font-size:10px;opacity:.7;margin-bottom:1px;"><span>Ex. moms</span><span>${fmt(exVat)} kr</span></div>`;
      html += `<div style="display:flex;justify-content:space-between;font-size:10px;opacity:.7;margin-bottom:4px;"><span>Moms ${tmpl.vatRate||25}%</span><span>${fmt(vat)} kr</span></div>`;
      html += `<div style="display:flex;justify-content:space-between;font-size:11px;font-weight:700;padding-top:4px;border-top:1px solid rgba(255,255,255,.15);margin-bottom:${rutAmt?'3px':'6px'};">
        <span>Totalt inkl. moms</span><span>${fmt(incVat)} kr</span></div>`;

      if (rutAmt) {
        html += `<div style="display:flex;justify-content:space-between;font-size:10px;color:#86efac;margin-bottom:4px;">
          <span>Prelim. ${redLbl}-avdrag</span><span>-${fmt(rutAmt)} kr</span></div>`;
      }

      // Customer price — always shown, prominent
      const displayPrice = rutAmt ? custPr : incVat;
      html += `<div style="display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,.13);border-radius:6px;padding:6px 9px;">
        <span style="font-size:10px;opacity:.8;">Kundpris inkl. moms</span>
        <span style="font-size:17px;font-weight:800;">${fmt(displayPrice)} kr</span>
      </div>`;
      if (rutAmt) {
        html += `<div style="font-size:8px;opacity:.45;margin-top:3px;text-align:right;">* Prelim., förutsätter rätt till avdraget</div>`;
      }

      prev.innerHTML = html;
    } catch(e) {
      prev.innerHTML = `<div style="font-size:10px;opacity:.65;">Fyll i obligatoriska fält (markerade *) för att se kalkyl.</div>`;
    }
  },

  /* ── Add/update service line ─── */
  _addSvcLine() {
    const tmpl = this._getT().find(t => t.id === this._activeSvcId);
    if (!tmpl) { showToast('Välj en tjänstetyp'); return; }
    // Collect non-reduction fields from DOM
    tmpl.fields.forEach(f => {
      if (f.type==='chips' || f.isRut || f.isRot) return;
      const el = document.getElementById('svc-f-' + f.id);
      if (!el) return;
      if (f.type==='bool')            this._svcFields[f.id] = el.checked;
      else if (f.type==='number')     this._svcFields[f.id] = parseFloat(el.value)||0;
      else if (f.type==='pricegroup') {
        this._svcFields[f.id] = el.value;
        const _pg = (state.priceGroups||[]).find(p=>p.id===el.value);
        if (_pg) this._svcFields['rate'] = _pg.hourRate;
      } else                          this._svcFields[f.id] = el.value;
    });
    // Inject unified reduction
    this._svcFields.rut = this._svcReduction === 'rut';
    this._svcFields.rot = this._svcReduction === 'rot';
    const missing = tmpl.fields.filter(f=>f.req&&!f.isRut&&!f.isRot&&!this._svcFields[f.id]&&this._svcFields[f.id]!==0);
    if (missing.length) { showToast('Fyll i: ' + missing.map(f=>f.label).join(', ')); return; }
    const result  = tmpl.calc(this._svcFields);
    const {ls, exVat, rutAmt} = result;
    const desc = (document.getElementById('svc-custom-desc')?.value||'').trim() || tmpl.defaultDesc;
    const lineData = {
      id:              'SVC' + Date.now(),
      type:            'service',
      templateId:      tmpl.id,
      templateName:    tmpl.name,
      description:     desc,
      subLines:        ls.map(l=>({...l})),
      exVat:           Math.round(exVat),
      vatRate:         tmpl.vatRate,
      rutAmount:       Math.round(rutAmt||0),
      reductionType:   this._svcReduction,
      total:           Math.round(exVat),
      inputValues:     {...this._svcFields},
      priceRuleRef:    tmpl.id,
      tierLbl:         result.tierLbl||'',
      calculationNote: result.tierLbl||''
    };
    const editIdx = this._svcEditIdx;
    if (editIdx !== null && editIdx !== undefined && this._editLines[editIdx]) {
      const prev = this._editLines[editIdx];
      lineData.id = prev.id;
      if (prev.description && desc === (tmpl.defaultDesc||'')) lineData.description = prev.description;
      this._editLines[editIdx] = lineData;
    } else {
      this._editLines.push(lineData);
    }
    this._closeSvcCalc();
    const el = document.getElementById('off-lines');
    if (el) el.innerHTML = this._linesHtml();
    this._refreshTotals();
    showToast(editIdx !== null && editIdx !== undefined ? tmpl.name + ' uppdaterad' : tmpl.name + ' tillagd');
  },

  /* ── Save ─── */
  _save() {
    if (this._wizardStep === 3) {
      const map = {'off-payment':'paymentTerms','off-validity':'validityText','off-terms':'generalTerms','off-note':'internalNote'};
      Object.entries(map).forEach(([id,key]) => {
        const el = document.getElementById(id);
        if (el) this._wizardData[key] = el.value;
      });
    }
    const d = this._wizardData;
    if (!d.customerId) { showToast('Välj en kund'); return; }
    const cleanLines = this._editLines.filter(l => {
      if (l.type==='text')    return (l.blockTitle||'').trim()||(l.text||'').trim();
      if (l.type==='service') return true;
      return (l.description||'').trim()||(l.unitPrice||0)>0;
    });
    if (!cleanLines.some(l=>l.type!=='text')) { showToast('Lägg till minst en offertrad eller tjänst'); return; }
    const cleanExtras = this._editExtras.filter(e=>(e.description||'').trim()||(e.unitPrice||0)>0);
    const now  = new Date().toISOString();
    const data = {
      customerId:   d.customerId,
      title:        d.title        || '',
      summary:      d.summary      || '',
      scope:        d.scope        || '',
      includes:     d.includes     || '',
      excludes:     d.excludes     || '',
      lines:        cleanLines.map(l=>{
        if(l.type==='service'||l.type==='text') return {...l};
        return {...l, total: Math.round((l.qty!=null?l.qty:1)*(l.unitPrice||0))};
      }),
      extras:       cleanExtras,
      validUntil:   d.validUntil   || '',
      paymentTerms: d.paymentTerms || '',
      validityText: d.validityText || '',
      generalTerms: d.generalTerms || '',
      internalNote: d.internalNote || '',
      discount:     this._discount || {type:'percent', value:0},
      updatedAt:    now
    };
    const offerId = this._editOfferId;
    if (!offerId) {
      const newOff = Object.assign(Schema.offer(), data, {
        id: newId(state.offers,'OFF'), status:'utkast', timeline: [],
        createdAt: d.date ? d.date + 'T00:00:00.000Z' : now
      });
      OfferDetailPage._logEvt(newOff, 'create', 'Offert skapad');
      state.offers.push(newOff);
      persist();
      this._wizardClose();
      Router.showPage('pg-offer');
      showToast('Offert ' + newOff.id + ' skapad');
    } else {
      const idx = (state.offers||[]).findIndex(o=>o.id===offerId);
      if (idx < 0) return;
      const updated = Object.assign({}, state.offers[idx], data);
      OfferDetailPage._logEvt(updated, 'edit', 'Offert redigerad');
      state.offers[idx] = updated;
      persist();
      this._wizardClose();
      OfferDetailPage.render({offerId});
      showToast('Offert uppdaterad');
    }
  }
};


/* ── PART 10: OfferDetailPage ─────────── */
const OfferDetailPage = {
  offerId: null,

  render(params) {
    const el = document.getElementById('pg-offer-detail-content');
    if (!el) return;
    const id = params && params.offerId;
    this.offerId = id;
    const off = id ? getOff(id) : null;
    if (!off) { el.innerHTML = `<div class="empty">${ic('file-text',32)}<h3>Offert hittades inte</h3></div>`; return; }

    const cu       = getCu(off.customerId);
    const allLines = off.lines || [];
    const prLines  = allLines.filter(l => l.type !== 'text');
    const txtBlks  = allLines.filter(l => l.type === 'text');
    const extras   = off.extras || [];

    /* Diagnostik: logga raddata i konsolen för felsökning */
    console.log('[OfferDetail] off.id=', off.id, 'lines=', JSON.stringify(off.lines||[]), 'rawExVat=', _offRawExVat(off));

    const rawExVat = _offRawExVat(off);
    const _disc   = off.discount || {type:'percent', value:0};
    const discAmt = _disc.value
      ? (_disc.type==='percent' ? Math.round(rawExVat * Math.min(_disc.value,100) / 100) : Math.min(Math.round(_disc.value), rawExVat))
      : 0;
    const exVat  = rawExVat - discAmt;
    const vat    = Math.round(exVat * 0.25);
    const incVat = exVat + vat;
    const rutAmt = Math.round(prLines.filter(l=>l.type==='service').reduce((s,l)=>s+(l.rutAmount||0),0));
    const cust   = incVat - rutAmt;

    const cuName = cu ? CustomerService.displayName(cu) : '—';
    const now2 = Date.now();
    const validDate = off.validUntil ? new Date(off.validUntil).getTime() : null;
    const daysLeft  = validDate ? Math.round((validDate - now2) / 86400000) : null;
    const expiring  = daysLeft !== null && daysLeft >= 0 && daysLeft <= 7;

    // ── Primary CTA based on status ──
    const primaryCta = (() => {
      const st = off.status;
      if (st === 'utkast')
        return `<button type="button" class="off-hero-cta-btn" onclick="OfferDetailPage.showSendModal('${off.id}')">${ic('send',14)} Skicka offert till kund</button>`;
      if (st === 'skickad' || st === 'påmind' || st === 'väntar')
        return `<button type="button" class="off-hero-cta-btn off-hero-cta-btn--or" onclick="OfferDetailPage._quickAction('${off.id}','followup')">${ic('bell',14)} Logga uppföljning</button>`;
      if (st === 'godkänd' && !off.workOrderId)
        return `<button type="button" class="off-hero-cta-btn off-hero-cta-btn--gr" onclick="OfferDetailPage.createAO()">${ic('clipboard-list',14)} Skapa arbetsorder</button>`;
      if (st === 'nekad')
        return `<button type="button" class="off-hero-cta-btn" onclick="OfferDetailPage.createNewVersion('${off.id}')">${ic('git-branch',14)} Ny version</button>`;
      if (st === 'utgången')
        return `<button type="button" class="off-hero-cta-btn off-hero-cta-btn--or" onclick="OfferDetailPage.duplicate('${off.id}')">${ic('refresh-cw',14)} Förnya offert</button>`;
      return '';
    })();

    // ── Quick facts strip ──
    const _fa = (icon, col, lbl, val, warn) =>
      `<div class="off-detail-fact${warn?' off-detail-fact--warn':''}">` +
      `<span class="off-detail-fact-icon" style="color:${col};">${ic(icon,12)}</span>` +
      `<div><span class="off-detail-fact-lbl">${lbl}</span><span class="off-detail-fact-val">${val}</span></div>` +
      `</div>`;
    const factItems = [
      cu && cu.email   ? _fa('mail','var(--blue)','E-post', cu.email) : '',
      cu && cu.phone   ? _fa('phone','var(--blue)','Telefon', cu.phone) : '',
      cu && (cu.address||cu.zip||cu.city) ? _fa('building-2','var(--mt)','Adress', [cu.address,cu.zip,cu.city].filter(Boolean).join(', ')) : '',
      off.createdAt    ? _fa('calendar','var(--mt)','Datum', fmtDate(off.createdAt)) : '',
      off.validUntil   ? _fa('clock', expiring?'var(--or)':'var(--mt)', 'Giltig till', fmtDate(off.validUntil)+(expiring?` · ${daysLeft}d kvar`:''), expiring) : '',
      off.paymentTerms ? _fa('receipt','var(--mt)','Betalning', off.paymentTerms) : '',
      off.validityText ? _fa('info','var(--mt)','Giltighetstid', off.validityText) : '',
    ].filter(Boolean).join('');

    // ── Offer line rows (customer-facing, kalkyl hidden by default) ──
    const linesHtml = prLines.length === 0
      ? `<p style="padding:12px 14px;font-size:12px;color:var(--mt);">Inga offertrader</p>`
      : prLines.map((l, idx) => {
          if (l.type === 'service') {
            const lExVat  = l.exVat || 0;
            const lVat    = Math.round(lExVat * (l.vatRate||25) / 100);
            const lIncVat = lExVat + lVat;
            const lRut    = l.rutAmount || 0;
            const lCust   = lIncVat - lRut;
            const kId     = `kalk-${off.id}-${idx}`;
            return `<div class="off-line-row off-line-row--svc">` +
              `<div class="off-line-row-header">` +
                `<div class="off-line-row-name">${ic('zap',11)} ${l.templateName||'Tjänst'}</div>` +
                `<div class="off-line-row-price">` +
                  (lRut ? `<span class="off-line-rut-badge">RUT/ROT</span>` : '') +
                  `<span class="off-line-kundpris">${fmt(lRut ? lCust : lIncVat)} kr</span>` +
                `</div>` +
              `</div>` +
              (l.description ? `<div class="off-line-desc">${l.description}</div>` : '') +
              (lRut > 0 ? `<div class="off-line-rut-row">${ic('info',10)} Kundpris efter RUT/ROT-avdrag — totalt inkl. moms ${fmt(lIncVat)} kr, avdrag −${fmt(lRut)} kr</div>` : '') +
              `<button class="off-line-kalk-btn" onclick="OfferDetailPage._toggleKalk('${kId}')">Visa beräkning</button>` +
              `<div id="${kId}" style="display:none;" class="off-line-kalk">` +
                (l.calculationNote ? `<div style="font-size:11px;color:var(--mt);margin-bottom:4px;">${l.calculationNote}</div>` : '') +
                `<div style="font-size:11px;color:var(--mt);">Ex. moms: ${fmt(lExVat)} kr · Moms ${l.vatRate||25}%: ${fmt(lVat)} kr · Inkl. moms: ${fmt(lIncVat)} kr</div>` +
              `</div>` +
            `</div>`;
          }
          const tot    = l.total || Math.round((l.qty||1)*(l.unitPrice||0));
          const totInc = tot + Math.round(tot * 0.25);
          return `<div class="off-line-row">` +
            `<div class="off-line-row-header">` +
              `<div class="off-line-row-name">${l.description||'—'}</div>` +
              `<div class="off-line-row-price"><span class="off-line-kundpris">${fmt(totInc)} kr</span><span style="font-size:10px;opacity:.6;margin-left:3px;">inkl. moms</span></div>` +
            `</div>` +
            `<div class="off-line-desc">${l.qty||1} ${l.unit||'st'} × ${fmt(l.unitPrice||0)} kr ex. moms</div>` +
          `</div>`;
        }).join('');

    el.innerHTML = `
      <div class="off-detail-hero">
        <div class="off-detail-hero-nav">
          <div style="display:flex;align-items:center;gap:8px;">
            <button type="button" class="off-hero-btn" onclick="Router.back()">${ic('arrow-left',12)} Tillbaka</button>
            <div>
              <div class="off-detail-hero-id" style="margin-bottom:0;">${off.id}${(off.versionNumber||1) > 1 ? ` <span class="bdg bdg-purple" style="font-size:10px;">v${off.versionNumber}</span>` : ''}${off.parentOfferId ? ` <span style="font-size:10px;opacity:.7;"> ← ${off.parentOfferId}</span>` : ''}</div>
              <div style="font-size:16px;font-weight:800;line-height:1.2;color:#fff;">${off.title||'Offert'}</div>
            </div>
          </div>
          <div class="off-hero-brand-status">
            <img src="${BrandingService.logoDark()}" class="off-hero-logo" alt="VIFT"
              onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
            <div class="off-hero-vift-badge" style="display:none;">VIFT<span>Fastighetsservice</span></div>
            <div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap;">
              ${sbdg(off.status)}
              ${CustomSelect.render('offd-status',{
                options:[{v:'utkast',l:'Utkast'},{v:'skickad',l:'Skickad'},{v:'påmind',l:'Påmind'},{v:'väntar',l:'Väntar svar'},{v:'godkänd',l:'Godkänd'},{v:'nekad',l:'Nekad'},{v:'utgången',l:'Utgången'},{v:'ersatt',l:'Ersatt'}],
                value:off.status, onchange:'OfferDetailPage.setStatus(this.value)'
              })}
            </div>
          </div>
        </div>

        <div style="display:flex;align-items:center;gap:7px;margin-bottom:8px;">
          <span style="font-size:15px;font-weight:800;color:#fff;">${cuName}</span>
          ${off.validUntil?`<span style="font-size:11px;opacity:.7;">· ${ic('calendar',11)} Giltig t.o.m. ${fmtDate(off.validUntil)}${expiring?` <span style="color:#fbbf24;font-weight:800;">(${daysLeft}d kvar)</span>`:''}</span>`:''}
        </div>

        <div class="off-hero-price-grid">
          <div>
            <div class="off-hero-pg-lbl">Ex. moms</div>
            <div class="off-hero-pg-val">${fmt(exVat)} kr</div>
            ${discAmt?`<div class="off-hero-pg-sub" style="color:#fbbf24;">Rabatt −${fmt(discAmt)} kr</div>`:`<div class="off-hero-pg-sub">+${fmt(vat)} kr moms</div>`}
          </div>
          <div>
            <div class="off-hero-pg-lbl">${rutAmt?'Kundpris inkl. moms':'Totalt inkl. moms'}</div>
            <div class="off-hero-pg-val off-hero-pg-val--big">${fmt(cust)} kr</div>
            ${rutAmt?`<div class="off-hero-pg-sub" style="color:#86efac;">RUT/ROT −${fmt(rutAmt)} kr</div>`:`<div class="off-hero-pg-sub">inkl. 25% moms</div>`}
          </div>
        </div>

        ${primaryCta ? `<div class="off-hero-cta">${primaryCta}</div>` : ''}

        <div class="off-detail-hero-actions">
          <!-- Status-based primary actions (alltid synliga) -->
          ${(!off.archived&&!off.deleted)&&(off.status==='skickad'||off.status==='påmind'||off.status==='väntar')?`
            <button type="button" class="off-hero-btn off-hero-btn--green" onclick="OfferDetailPage.setStatus('godkänd')">${ic('check-circle',12)} Godkänd</button>
            <button type="button" class="off-hero-btn off-hero-btn--red" onclick="OfferDetailPage.setStatus('nekad')">${ic('x-circle',12)} Nekad</button>
            <button type="button" class="off-hero-btn" onclick="OfferDetailPage._quickAction('${off.id}','verbal')">${ic('thumbs-up',12)} Muntligt godkänd</button>
            <button type="button" class="off-hero-btn" onclick="OfferDetailPage.showReminderModal('${off.id}')">${ic('bell',12)} Skicka påminnelse</button>
          `:''}
          ${off.status==='godkänd'&&!off.workOrderId&&!off.archived&&!off.deleted?`<button type="button" class="off-hero-btn off-hero-btn--green" onclick="OfferDetailPage.createAO()">${ic('clipboard-list',12)} Skapa AO</button>`:''}
          ${off.workOrderId?`<button type="button" class="off-hero-btn" onclick="Router.showPage('pg-ao-detail',{aoId:'${off.workOrderId}'})">${ic('clipboard-list',12)} AO: ${off.workOrderId}</button>`:''}
          ${(off.archived||off.deleted)?`<button type="button" class="off-hero-btn off-hero-btn--green" onclick="OfferDetailPage.restoreOffer('${off.id}')">${ic('rotate-ccw',12)} Återställ</button>`:''}
          <!-- Fler åtgärder (Redigera, PDF, Ny version, Duplicera, Arkivera, Ta bort) -->
          <button type="button" class="off-hero-btn off-hero-btn--dim" onclick="OfferDetailPage.openFlerAtgarder('${off.id}')">${ic('more-horizontal',12)} Fler åtgärder</button>
        </div>
      </div>

      <!-- Mobile quick-info banner (hidden on desktop via CSS) -->
      <div class="off-mobile-quick">
        <span class="off-mobile-quick-name">${cuName}</span>
        ${sbdg(off.status)}
        <span style="font-size:11px;font-weight:700;color:var(--navy);margin-left:auto;">Kund: ${fmt(cust)} kr</span>
      </div>

      ${factItems ? `<div class="off-detail-facts" style="flex-wrap:wrap;">${factItems}</div>` : ''}

      ${off.summary||off.scope||off.includes||off.excludes?`
      <div class="card">
        <div class="card-header"><h3>${ic('align-left',13)} Uppdragsbeskrivning</h3></div>
        <div class="card-body">
          ${off.summary?`<div class="off-field-stack"><div class="off-field-label">Sammanfattning</div><div class="off-field-content off-rt">${OfferDetailPage._renderText(off.summary)}</div></div>`:''}
          ${off.scope?`<div class="off-field-stack"><div class="off-field-label">Uppdragets omfattning</div><div class="off-field-content off-rt">${OfferDetailPage._renderText(off.scope)}</div></div>`:''}
          ${off.includes||off.excludes?`<div class="off-incl-excl">
            ${off.includes?`<div class="off-incl-col"><div class="off-incl-hd">${ic('check',11)} Ingår</div><div class="off-field-content off-rt">${OfferDetailPage._renderText(off.includes)}</div></div>`:''}
            ${off.excludes?`<div class="off-excl-col"><div class="off-excl-hd">${ic('x',11)} Ingår ej</div><div class="off-field-content off-rt" style="color:var(--mt);">${OfferDetailPage._renderText(off.excludes)}</div></div>`:''}
          </div>`:''}
        </div>
      </div>`:''}

      <div class="card">
        <div class="card-header">
          <h3>${ic('file-text',13)} Offertrader</h3>
          ${prLines.length>0?`<span class="bdg bdg-grey">${prLines.length} rad${prLines.length===1?'':'er'}</span>`:''}
        </div>
        ${linesHtml}
        <div class="off-detail-sum" style="margin:0;border-radius:0 0 var(--rs) var(--rs);border-left:none;border-right:none;border-bottom:none;">
          <div class="off-detail-sum-row"><span class="dk">Summa ex. moms</span><strong>${fmt(rawExVat)} kr</strong></div>
          ${discAmt?`<div class="off-detail-sum-row disc"><span class="dk">Rabatt (${_disc.type==='percent'?_disc.value+'%':fmt(_disc.value)+' kr'})</span><span>−${fmt(discAmt)} kr</span></div>`:''}
          <div class="off-detail-sum-row"><span class="dk">Moms 25 %</span><span>${fmt(vat)} kr</span></div>
          <div class="off-detail-sum-row"><span class="dk">Totalt inkl. moms</span><strong>${fmt(incVat)} kr</strong></div>
          ${rutAmt?`<div class="off-detail-sum-row rut"><span>RUT/ROT-reduktion</span><span>−${fmt(rutAmt)} kr</span></div>`:''}
          <div class="off-detail-sum-final">
            <span class="off-detail-sum-final-lbl">${rutAmt?'Kundpris inkl. moms':'Totalt inkl. moms'}</span>
            <span class="off-detail-sum-final-val">${fmt(cust)} kr</span>
          </div>
          ${rutAmt?`<div style="font-size:10px;color:var(--mt);margin-top:6px;">* Avdraget är preliminärt och förutsätter att kunden har rätt till skattereduktion.</div>`:''}
          ${prLines.some(l=>(l.description||'').includes('minimidebitering'))?`<div style="font-size:10px;color:var(--mt);margin-top:6px;padding:7px 9px;background:#fffbeb;border-left:3px solid #d97706;border-radius:0 4px 4px 0;">${ic('info',10)} <strong>Minimidebitering:</strong> Tjänsten har ett lägsta debiteringsbelopp som täcker etablering, utrustning och grundarbete.</div>`:''}
        </div>
      </div>

      ${extras.length?`<div class="card">
        <div class="card-header"><h3>${ic('plus',13)} Tillval</h3></div>
        ${extras.map(e=>`<div class="off-line-row">
          <div class="off-line-row-header">
            <div class="off-line-row-name">${e.description||'—'}</div>
            <div class="off-line-row-price"><span class="off-line-kundpris">${fmt(Math.round((e.qty||1)*(e.unitPrice||0)))} kr</span><span style="font-size:10px;opacity:.6;margin-left:3px;">ex. moms</span></div>
          </div>
          <div class="off-line-desc">${e.qty||1} ${e.unit||'st'} × ${fmt(e.unitPrice||0)} kr</div>
        </div>`).join('')}
      </div>`:''}

      ${txtBlks.filter(tb=>tb.blockTitle||tb.text).map(tb=>`
      <div class="card">
        ${tb.blockTitle?`<div class="card-header"><h3>${ic('align-left',13)} ${tb.blockTitle}</h3></div>`:''}
        <div class="card-body"><p style="white-space:pre-wrap;font-size:13px;line-height:1.6;">${tb.text||''}</p></div>
      </div>`).join('')}

      ${off.generalTerms?`<div class="card">
        <div class="card-header"><h3>${ic('file-text',13)} Allmänna villkor</h3></div>
        <div class="card-body"><p style="font-size:12px;color:var(--mt);white-space:pre-wrap;line-height:1.6;">${off.generalTerms}</p></div>
      </div>`:''}

      ${off.internalNote?`<div class="nbox">${ic('lock',12)} <strong>Intern:</strong> ${off.internalNote}</div>`:''}

      ${OfferDetailPage._digitalLinkPanel(off)}

      ${OfferDetailPage._attachmentsPanel(off)}

      ${OfferDetailPage._salesAssistantHtml(off)}

      ${OfferDetailPage._timelineHtml(off)}`;
  },

  openFlerAtgarder(offerId) {
    const off = getOff(offerId);
    if (!off) return;
    const btns = [];
    if (!off.archived && !off.deleted)
      btns.push(`<button class="action-sheet-btn" onclick="OffersPage.openEdit('${off.id}');Modal.close()">${ic('pencil',16)} Redigera offert</button>`);
    btns.push(`<button class="action-sheet-btn" onclick="OfferDetailPage.printPdf('${off.id}');Modal.close()">${ic('printer',16)} Skriv ut / PDF</button>`);
    if (!off.deleted)
      btns.push(`<button class="action-sheet-btn" onclick="OfferDetailPage.createNewVersion('${off.id}');Modal.close()">${ic('git-branch',16)} Skapa ny version</button>`);
    if (!off.deleted)
      btns.push(`<button class="action-sheet-btn" onclick="OfferDetailPage.duplicate('${off.id}');Modal.close()">${ic('copy',16)} Duplicera</button>`);
    if (!off.archived && !off.deleted) {
      btns.push(`<hr style="border:none;border-top:1px solid var(--br);margin:6px 0;">`);
      btns.push(`<button class="action-sheet-btn action-sheet-btn--warn" onclick="OfferDetailPage.archiveOffer('${off.id}');Modal.close()">${ic('archive',16)} Arkivera</button>`);
      btns.push(`<button class="action-sheet-btn action-sheet-btn--red" onclick="OfferDetailPage.deleteOffer('${off.id}');Modal.close()">${ic('trash',16)} Flytta till papperskorgen</button>`);
    }
    if (off.deleted)
      btns.push(`<button class="action-sheet-btn action-sheet-btn--red" onclick="OfferDetailPage.permanentDeleteOffer('${off.id}');Modal.close()">${ic('trash-2',16)} Radera permanent</button>`);
    Modal.open({
      title: ic('more-horizontal',14) + ' Fler åtgärder',
      body: `<div class="action-sheet-list">${btns.join('')}</div>`,
      buttons: [{ label: 'Stäng', cls: 'btn bs', onClick: () => Modal.close() }]
    });
  },

  setStatus(status) {
    const off = getOff(this.offerId);
    if (!off) return;
    const prev = off.status;
    off.status    = status;
    off.updatedAt = new Date().toISOString();
    if (status === 'skickad') off.sentAt          = new Date().toISOString();
    if (status === 'påmind')  off.reminderSentAt  = new Date().toISOString();
    if (status === 'godkänd' || status === 'nekad') off.answeredAt = new Date().toISOString();
    this._logEvt(off, 'status', 'Status: ' + statusLabel(prev) + ' → ' + statusLabel(status));
    persist();
    this.render({offerId: this.offerId});
    showToast('Status: ' + statusLabel(status));
  },

  duplicate(offerId) {
    const off = getOff(offerId);
    if (!off) return;
    const now = new Date().toISOString();
    const newOff = Object.assign({}, JSON.parse(JSON.stringify(off)), {
      id: newId(state.offers, 'OFF'), status: 'utkast',
      title: (off.title || 'Offert') + ' (kopia)',
      versionNumber: 1, parentOfferId: '',
      sentAt: '', answeredAt: '', reminderSentAt: '', emailSentTo: '', workOrderId: '',
      archived: false, deleted: false,
      createdAt: now, updatedAt: now, timeline: []
    });
    this._logEvt(newOff, 'create', 'Duplicerad från ' + offerId);
    state.offers.push(newOff);
    persist();
    Router.showPage('pg-offer-detail', {offerId: newOff.id});
    showToast('Kopia ' + newOff.id + ' skapad');
  },

  archiveOffer(offerId) {
    const off = getOff(offerId);
    if (!off) return;
    Modal.confirm('Arkivera offert ' + offerId + '? Den försvinner från standardlistorna men kan återställas.', () => {
      off.archived = true;
      off.updatedAt = new Date().toISOString();
      this._logEvt(off, 'arkiverad', 'Offert arkiverad');
      persist();
      OffersPage._setFilter('arkiverade');
      Router.showPage('pg-offer');
      showToast('Offert arkiverad');
    });
  },

  deleteOffer(offerId) {
    const off = getOff(offerId);
    if (!off) return;
    Modal.confirm('Flytta offert ' + offerId + ' till papperskorgen?', () => {
      off.deleted = true;
      off.archived = false;
      off.updatedAt = new Date().toISOString();
      this._logEvt(off, 'borttagen', 'Offert flyttad till papperskorg');
      persist();
      Router.showPage('pg-offer');
      showToast('Offert i papperskorgen');
    });
  },

  restoreOffer(offerId) {
    const off = getOff(offerId);
    if (!off) return;
    off.archived = false;
    off.deleted  = false;
    off.updatedAt = new Date().toISOString();
    this._logEvt(off, 'återställd', 'Offert återställd');
    persist();
    this.render({offerId});
    showToast('Offert återställd');
  },

  permanentDeleteOffer(offerId) {
    Modal.confirm('Radera offert ' + offerId + ' permanent? Detta går inte att ångra.', () => {
      const idx = (state.offers||[]).findIndex(o => o.id === offerId);
      if (idx >= 0) state.offers.splice(idx, 1);
      persist();
      Router.showPage('pg-offer');
      showToast('Offert raderad');
    });
  },

  createAO() {
    const off = getOff(this.offerId);
    if (!off) return;

    const prLines  = (off.lines||[]).filter(l => l.type !== 'text');
    const svcLines = prLines.filter(l => l.type === 'service');
    const svcNames = svcLines.map(l => l.templateName).filter(Boolean);

    // Title
    const aoTitle = off.title
      || (svcNames.length ? svcNames.join(', ') : 'Arbete enligt offert ' + off.id);

    // Rich description
    const descParts = [];
    if (off.scope)                           descParts.push(off.scope);
    if (off.summary && off.summary !== off.scope) descParts.push(off.summary);
    if (off.includes)                        descParts.push('Ingår: ' + off.includes);
    if (off.excludes)                        descParts.push('Ingår ej: ' + off.excludes);
    if (!descParts.length && prLines.length) descParts.push(prLines.map(l => l.templateName||l.description).filter(Boolean).join(', '));
    const desc = descParts.join('\n\n');

    // Checklist from service lines
    const CHKLST = {
      'svc_altan': ['Kontrollera altanens skick före start', 'Flytta lösa föremål vid behov', 'Tvätta ytan enligt metod', 'Kontrollera resultat efter tvätt'],
      'svc_sten':  ['Kontrollera stenyta före start', 'Rensa smuts och ogräs', 'Tvätta stenläggning', 'Kontrollera fogar och efterbehandling'],
      'svc_hack':  ['Kontrollera höjd och sidor enligt offert', 'Klipp enligt specifikation', 'Samla upp och bortforsla avklipp', 'Slutkontrollera ytan'],
      'svc_fasad': ['Skydda fönster och detaljer', 'Tvätta fasad uppifrån och ner', 'Kontrollera att smuts är borta', 'Ta bort skydd och städa av'],
      'svc_fs':    ['Kontrollera objektets skick vid ankomst', 'Utför service enligt uppdrag', 'Dokumentera utfört arbete', 'Meddela kund vid avvikelse'],
      'svc_tf':    ['Kontrollera tekniska installationer', 'Utför förvaltningsuppgifter', 'Dokumentera status', 'Rapportera till kund'],
      'svc_ovr':   ['Kontrollera arbetsplats vid ankomst', 'Utför beskrivet arbete', 'Städa upp efter arbete', 'Rapportera utfört arbete']
    };
    const checklist = [];
    let cIdx = 0;
    svcLines.forEach(l => {
      const tmplChecklist = CHKLST[l.templateId || l.priceRuleRef];
      const items = tmplChecklist || (l.templateName || l.description ? [l.templateName || l.description] : []);
      items.forEach(text => {
        checklist.push({ id: 'c' + (Date.now() + cIdx++), text, done: false });
      });
    });
    // Non-service, non-text lines add a single checklist entry
    prLines.filter(l => l.type !== 'service').forEach(l => {
      if (l.description) checklist.push({ id: 'c' + (Date.now() + cIdx++), text: l.description, done: false });
    });

    // estimatedHours from lines with unit='tim'
    let estimatedHours = 0;
    prLines.forEach(l => {
      if ((l.unit === 'tim' || l.unit === 'h') && l.qty) estimatedHours += parseFloat(l.qty) || 0;
      (l.subLines||[]).forEach(sl => {
        if ((sl.unit === 'tim' || sl.unit === 'h') && sl.qty) estimatedHours += parseFloat(sl.qty) || 0;
      });
    });

    // Initial AO log entry
    const by = state.currentUser ? `${state.currentUser.firstName} ${state.currentUser.lastName}`.trim() : 'Admin';
    const aoLog = [{
      id: 'L' + Date.now(), type: 'created_from_offer',
      text: `${by} skapade AO från offert ${off.id}`,
      userName: by, timestamp: new Date().toISOString()
    }];

    /* Dubbelkonverteringsskydd (punkt 123) */
    if (off.workOrderId) {
      showToast('Offerten är redan konverterad till ' + off.workOrderId);
      return;
    }

    const ao = WorkOrderService.create({
      title:               aoTitle,
      description:         desc,
      customerId:          off.customerId,
      propertyId:          off.propertyId || '',
      address:             off.address    || '',
      internalNote:        off.internalNote || '',
      status:              'nytt',
      priority:            'normal',
      priceType:           'fast',
      fixedPrice:          OffersPage._offerExVat(off),
      offerId:             off.id,
      sourceOfferId:       off.parentOfferId || off.id,
      sourceOfferVersionId:off.id,
      sourceOfferNumber:   off.id,
      estimatedHours:      estimatedHours || 0,
      checklist,
      log:                 aoLog,
      staff: [], materials: [], notes: [], timeEntries: []
    });

    const now3 = new Date().toISOString();
    off.workOrderId    = ao.id;
    off.convertedAt    = now3;
    off.updatedAt      = now3;
    this._logEvt(off, 'ao', 'Arbetsorder ' + ao.id + ' skapad från offert v' + (off.versionNumber||1));

    // Mark any open follow-up activity for this offer as done
    (state.activities || [])
      .filter(a => a.relatedType === 'offer' && a.relatedId === off.id && !a.done)
      .forEach(a => { a.done = true; a.doneAt = new Date().toISOString(); });

    persist();
    this.render({offerId: this.offerId});
    showToast('AO ' + ao.id + ' skapad');
    setTimeout(() => Router.showPage('pg-ao-detail', {aoId: ao.id}), 800);
  },

  /* ── Händelselogg ─── */
  _logEvt(off, type, text) {
    if (!off) return;
    if (!Array.isArray(off.timeline)) off.timeline = [];
    const user = (typeof state !== 'undefined' && state.currentUser) ? (state.currentUser.name || state.currentUser.username || 'Admin') : 'Admin';
    off.timeline.push({ ts: new Date().toISOString(), type, text, user });
  },

  _timelineHtml(off) {
    /* Kombinera interna händelser (off.timeline) med externa kundhändelser (state.offerEvents) */
    const tl = (off.timeline || []).slice().map(function(e) { return Object.assign({}, e, {_src:'internal'}); });

    const extEvents = (state.offerEvents || []).filter(function(e) { return e.offerId === off.id; });
    const _extLabel = { opened:'Kund öppnade länk', approved:'Kund godkände offert', change_requested:'Kund begärde ändring', declined:'Kund nekade offert', revoked:'Länk återkallad', renewed:'Länk förnyad', email_sent:'Offert skickad via e-post' };
    extEvents.forEach(function(e) {
      var baseLabel = e.type === 'email_sent' && e.status === 'failed'
        ? 'E-postutskick misslyckades'
        : (_extLabel[e.type] || e.type);
      var recipientText = e.type === 'email_sent' && Array.isArray(e.recipients) && e.recipients.length
        ? ' — ' + e.recipients.join(', ')
        : '';
      var desc = baseLabel + recipientText + (e.byCustomer ? ' — ' + e.byCustomer : '') + (e.byEmail ? ' (' + e.byEmail + ')' : '') + (e.comment ? ': ' + e.comment.slice(0,120) : '') + (e.error ? ': ' + String(e.error).slice(0,160) : '');
      tl.push({ ts: e.ts || e.sentAt || '', type: e.type, text: desc, user: e.sentBy || e.byCustomer || (e.type === 'email_sent' ? 'System' : 'Kund'), _src:'customer' });
    });

    tl.sort(function(a, b) { return (b.ts || '').localeCompare(a.ts || ''); });

    const typeIcon = {create:'plus-circle', edit:'pencil', status:'refresh-cw', send:'send', pdf:'printer', comment:'message-square', ao:'clipboard-list', ring:'phone', email:'mail', followup:'bell', reminder:'clock', price:'dollar-sign', change:'edit-3', verbal:'thumbs-up', reason:'help-circle', tip:'message-square',
      opened:'eye', approved:'check-circle', change_requested:'edit-3', declined:'x-circle', revoked:'x-circle', renewed:'refresh-cw', email_sent:'send' };
    const typeColor = {create:'var(--navy)', edit:'var(--mt)', status:'var(--or)', send:'var(--blue)', pdf:'#6366f1', comment:'#0891b2', ao:'var(--grn)', ring:'var(--sky)', email:'var(--blue)', followup:'var(--or)', reminder:'var(--yl)', price:'#b45309', change:'var(--pu)', verbal:'var(--gr)', reason:'var(--mt)', tip:'var(--mt)',
      opened:'var(--sky)', approved:'var(--gr)', change_requested:'var(--or)', declined:'var(--rd)', revoked:'var(--rd)', renewed:'var(--blue)', email_sent:'var(--blue)' };
    const id = off.id;
    const isSent = off.status === 'skickad' || off.status === 'påmind' || off.status === 'väntar';
    return `<div class="card" style="margin-top:8px;">
      <div class="card-header">
        <h3 style="display:flex;align-items:center;gap:6px;">${ic('activity',13)} Säljarbete & tidslinje</h3>
      </div>
      <div class="off-tl-action-bar">
        <span style="font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.4px;align-self:center;white-space:nowrap;">Åtgärd:</span>
        <button type="button" class="off-tl-action-btn" onclick="OfferDetailPage._quickAction('${id}','ring')">${ic('phone',11)} Ring kund</button>
        <button type="button" class="off-tl-action-btn" onclick="OfferDetailPage._quickAction('${id}','email')">${ic('mail',11)} Mailade kund</button>
        <button type="button" class="off-tl-action-btn" onclick="OfferDetailPage._quickAction('${id}','followup')">${ic('bell',11)} Uppföljning</button>
        <button type="button" class="off-tl-action-btn" onclick="OfferDetailPage._quickAction('${id}','reminder')">${ic('clock',11)} Påminnelse</button>
        ${isSent?`<button type="button" class="off-tl-action-btn" onclick="OfferDetailPage._quickAction('${id}','price')">${ic('dollar-sign',11)} Prisförhandling</button>`:''}
        ${isSent?`<button type="button" class="off-tl-action-btn" onclick="OfferDetailPage._quickAction('${id}','change')">${ic('edit-3',11)} Kund vill ändra</button>`:''}
        ${isSent?`<button type="button" class="off-tl-action-btn" onclick="OfferDetailPage._quickAction('${id}','verbal')" style="background:rgba(21,128,61,.08);color:var(--gr);">${ic('thumbs-up',11)} Muntligt godkänd</button>`:''}
        ${off.status==='nekad'?`<button type="button" class="off-tl-action-btn" onclick="OfferDetailPage._quickAction('${id}','reason')">${ic('help-circle',11)} Orsak nekad</button>`:''}
        <button type="button" class="off-tl-action-btn" onclick="OfferDetailPage._quickAction('${id}','tip')">${ic('message-square',11)} Intern notering</button>
      </div>
      ${(() => {
        const openActs = ActivitiesService.getByRelated('offer', off.id).filter(a => a.status === 'open');
        if (!openActs.length) return '';
        const _fmtD = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('sv-SE', {day:'numeric',month:'short'}) : '—';
        return `<div style="padding:8px 14px 4px;border-top:1px solid var(--br);border-bottom:1px solid var(--br);background:rgba(255,181,39,.04);">
          <div style="font-size:10px;font-weight:700;color:var(--or);text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px;display:flex;align-items:center;gap:5px;">
            ${ic('bell',10)} Inbokade uppföljningar (${openActs.length})
          </div>
          ${openActs.map(a => {
            const isOverdue = a.dueDate && a.dueDate < tdy();
            const staff     = getStaff(a.assignedTo);
            const staffName = staff ? `${staff.firstName} ${staff.lastName}` : '—';
            const dateStr   = a.dueDate ? _fmtD(a.dueDate) + (a.dueTime ? ' kl ' + a.dueTime : '') : '—';
            const priColor  = a.priority === 'hög' ? 'var(--rd)' : a.priority === 'låg' ? 'var(--mt)' : 'var(--or)';
            return `<div style="display:flex;align-items:flex-start;gap:8px;padding:5px 0;border-bottom:1px solid rgba(0,0,0,.05);">
              <span style="color:${isOverdue?'var(--rd)':priColor};flex-shrink:0;margin-top:1px;">${ic(ActivitiesService.typeIcon(a.type),13)}</span>
              <div style="flex:1;min-width:0;">
                <div style="font-size:12px;font-weight:700;color:${isOverdue?'var(--rd)':'var(--navy)'};">${dateStr}${isOverdue?' <span class="bdg bdg-red" style="font-size:9px;margin-left:4px;">Försenad</span>':''}</div>
                ${a.note?`<div style="font-size:11px;color:var(--tx);margin-top:1px;">${a.note}</div>`:''}
                <div style="font-size:10px;color:var(--mt);margin-top:1px;">${ic('user',9)} ${staffName}${a.priority&&a.priority!=='normal'?' · '+a.priority:''}</div>
              </div>
              <div style="display:flex;gap:4px;flex-shrink:0;">
                <button class="btn bxs bsu" style="font-size:11px;padding:3px 7px;" onclick="OfferDetailPage._completeActivity('${a.id}','${off.id}')" title="Markera klar">${ic('check',12)} Klar</button>
                <button class="btn bxs bs" style="font-size:11px;padding:3px 7px;" onclick="OfferDetailPage._rescheduleActivity('${a.id}','${off.id}')" title="Flytta">${ic('calendar',12)}</button>
              </div>
            </div>`;
          }).join('')}
        </div>`;
      })()}
      <div style="padding:0;">
        ${tl.length===0
          ? `<p style="padding:12px 14px;font-size:12px;color:var(--mt);">Inga händelser ännu.</p>`
          : tl.map(e => `<div class="off-tl-item">
              <span class="off-tl-dot" style="color:${typeColor[e.type]||'var(--mt)'};">${ic(typeIcon[e.type]||'circle',10)}</span>
              <div class="off-tl-body">
                <div class="off-tl-text">${e.text||''}</div>
                <div class="off-tl-meta">${fmtDate(e.ts)} · ${e.user||''}</div>
              </div>
            </div>`).join('')}
        <div class="off-tl-comment">
          <input id="off-tl-inp" placeholder="Lägg till intern kommentar…" style="flex:1;">
          <button class="btn bs bxs" onclick="OfferDetailPage._addComment('${off.id}')">${ic('send',11)} Spara</button>
        </div>
      </div>
    </div>`;
  },

  _quickAction(offerId, type) {
    const off = getOff(offerId);
    if (!off) return;
    const labels = {ring:'Ringde kund', email:'Mailade kund', followup:'Boka uppföljning', reminder:'Påminnelse satt', price:'Prisförhandling', change:'Kund vill ändra', verbal:'Muntligt godkänd', reason:'Orsak till nekad offert', tip:'Intern notering'};
    const label = labels[type] || type;

    // followup / reminder → rich activity-creation modal
    if (type === 'followup' || type === 'reminder') {
      const tomorrow = _ds(1);
      const staffOpts = (state.staff || []).filter(s => s.active !== false)
        .map(s => `<option value="${s.id}"${state.currentUser && s.id === state.currentUser.id ? ' selected' : ''}>${s.firstName} ${s.lastName}</option>`).join('');
      const actType = type === 'followup' ? 'followup' : 'call';
      Modal.open({
        title: `${ic('bell',14)} ${label}`,
        body: `<div style="display:flex;flex-direction:column;gap:10px;">
          <div class="fg"><label>Typ</label>
            <select id="act-type">
              <option value="followup"${actType==='followup'?' selected':''}>Uppföljning</option>
              <option value="call"${actType==='call'?' selected':''}>Ring kund</option>
              <option value="email">Mejl</option>
              <option value="meeting">Möte</option>
              <option value="task">Uppgift</option>
            </select></div>
          <div style="display:flex;gap:8px;">
            <div class="fg" style="flex:1;"><label>Datum</label><input type="date" id="act-date" value="${tomorrow}"></div>
            <div class="fg" style="width:90px;"><label>Tid</label><input type="time" id="act-time" value="09:00"></div>
          </div>
          <div class="fg"><label>Ansvarig</label><select id="act-assignee">${staffOpts}</select></div>
          <div class="fg"><label>Notering</label><textarea id="act-note" rows="2" placeholder="Vad ska göras?"></textarea></div>
          <div class="fg"><label>Prioritet</label>
            <select id="act-priority">
              <option value="normal">Normal</option>
              <option value="hög">Hög</option>
              <option value="låg">Låg</option>
            </select>
          </div>
        </div>`,
        buttons: [
          { label: 'Spara aktivitet', cls: 'btn bp', onClick: () => {
            const actT    = document.getElementById('act-type')?.value || 'followup';
            const date    = document.getElementById('act-date')?.value || tomorrow;
            const time    = document.getElementById('act-time')?.value || '';
            const assignee= document.getElementById('act-assignee')?.value || null;
            const note    = (document.getElementById('act-note')?.value || '').trim();
            const priority= document.getElementById('act-priority')?.value || 'normal';
            const cu      = getCu(off.customerId);
            const cuName  = cu ? cu.name : (off.customerId || off.id);
            const actTitle= `${ActivitiesService.typeLabel(actT)} — ${cuName}`;
            const act = ActivitiesService.create({
              title:       actTitle,
              type:        actT,
              relatedType: 'offer',
              relatedId:   off.id,
              customerId:  off.customerId || null,
              assignedTo:  assignee,
              dueDate:     date,
              dueTime:     time,
              note:        note,
              priority:    priority
            });
            const dateStr = new Date(date).toLocaleDateString('sv-SE', {day:'numeric',month:'short'});
            this._logEvt(off, 'followup', `Uppföljning bokad ${dateStr}${time?' kl '+time:''}${note?': '+note:''}`);
            off.updatedAt = new Date().toISOString();
            persist();
            Sidebar.updateBadges();
            Modal.close();
            this.render({offerId});
            showToast(`Aktivitet skapad — ${dateStr}`);
          }},
          { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
        ]
      });
      setTimeout(() => document.getElementById('act-note')?.focus(), 80);
      return;
    }

    // All other types: simple text modal
    Modal.open({
      title: label,
      body: `<div class="fg"><label>${label}</label><textarea id="qa-text" rows="3" placeholder="Anteckning…"></textarea></div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => {
          const txt = (document.getElementById('qa-text')?.value || '').trim();
          this._logEvt(off, type, label + (txt ? ': ' + txt : ''));
          off.updatedAt = new Date().toISOString();
          if (type === 'verbal') {
            off.status = 'godkänd';
            off.answeredAt = new Date().toISOString();
            this._logEvt(off, 'status', 'Status: Skickad → Godkänd (muntligt)');
          }
          persist();
          Modal.close();
          this.render({offerId});
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('qa-text')?.focus(), 80);
  },

  _addComment(offerId) {
    const inp = document.getElementById('off-tl-inp');
    const txt = (inp?.value || '').trim();
    if (!txt) return;
    const off = getOff(offerId);
    if (!off) return;
    this._logEvt(off, 'comment', txt);
    off.updatedAt = new Date().toISOString();
    persist();
    this.render({offerId});
    showToast('Kommentar sparad');
  },

  _toggleKalk(kId) {
    const el  = document.getElementById(kId);
    const btn = el && el.previousElementSibling;
    if (!el) return;
    const show = el.style.display === 'none';
    el.style.display = show ? 'block' : 'none';
    if (btn && btn.classList.contains('off-line-kalk-btn')) {
      btn.textContent = show ? 'Dölj beräkning' : 'Visa beräkning';
    }
  },

  /* ── Text rendering ─── */
  _sanitizeText(raw) {
    if (!raw) return '';
    // Filter list lines that are garbage: too short, or known bad fragments
    const BAD = /^(göra|görs|gör|på|allting|allt|etc|osv|mm|m\.m\.|bl\.a\.|t\.ex\.)$/i;
    return raw.split('\n').filter(line => {
      if (!line.startsWith('- ')) return true; // keep non-list lines as-is
      const content = line.slice(2).trim();
      if (content.length < 5) return false;
      if (BAD.test(content)) return false;
      return true;
    }).join('\n');
  },

  _renderText(raw) {
    if (!raw) return '';
    raw = this._sanitizeText(raw);
    const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const lines = raw.split('\n');
    let html = '', inList = false;
    for (let line of lines) {
      // Bold: **text**
      line = esc(line).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      if (line.startsWith('## ')) {
        if (inList) { html += '</ul>'; inList = false; }
        html += `<div style="font-size:12px;font-weight:800;color:var(--navy);margin:6px 0 2px;">${line.slice(3)}</div>`;
      } else if (line.startsWith('- ')) {
        if (!inList) { html += '<ul class="off-rt-list">'; inList = true; }
        html += `<li>${line.slice(2)}</li>`;
      } else {
        if (inList) { html += '</ul>'; inList = false; }
        if (line.trim()) html += `<div>${line}</div>`;
      }
    }
    if (inList) html += '</ul>';
    return html;
  },

  /* ── AI Säljassistent ─── */
  _salesAssistantHtml(off) {
    const now = Date.now();
    const sentDate  = off.sentAt ? new Date(off.sentAt).getTime() : null;
    const daysSent  = sentDate  ? Math.round((now - sentDate)  / 86400000) : null;
    const validDate = off.validUntil ? new Date(off.validUntil).getTime() : null;
    const daysLeft  = validDate ? Math.round((validDate - now) / 86400000) : null;
    const prLines   = (off.lines||[]).filter(l => l.type !== 'text');
    const extras    = off.extras||[];
    const rawExVat  = _offRawExVat(off);
    const _disc     = off.discount||{type:'percent',value:0};
    const discAmt   = _disc.value?(_disc.type==='percent'?Math.round(rawExVat*Math.min(_disc.value,100)/100):Math.min(Math.round(_disc.value),rawExVat)):0;
    const exVat     = rawExVat - discAmt;
    const incVat    = exVat + Math.round(exVat*0.25);
    const rutAmt    = Math.round(prLines.filter(l=>l.type==='service').reduce((s,l)=>s+(l.rutAmount||0),0));
    const cust      = incVat - rutAmt;
    const tips = [];

    // Check open activities for this offer
    const offerActs   = (state.activities || []).filter(a => a.relatedType === 'offer' && a.relatedId === off.id && a.status === 'open');
    const overdueActs = offerActs.filter(a => a.dueDate && a.dueDate < tdy());
    const todayActs   = offerActs.filter(a => a.dueDate === tdy());
    const nextAct     = offerActs.sort((a,b) => (a.dueDate||'').localeCompare(b.dueDate||''))[0];

    if (overdueActs.length > 0) {
      const a = overdueActs[0];
      const daysAgo = Math.round((Date.now() - new Date(a.dueDate).getTime()) / 86400000);
      tips.push({icon:'alert-circle', color:'var(--rd)', title:`Försenad uppföljning (${daysAgo} dag${daysAgo===1?'':'ar'} sen)`, body:(a.note || 'Uppföljning krävs') + ` — planerat ${fmtDate(a.dueDate)}`, cta:'Markera klar', ctaFn:`ActivitiesService.complete('${a.id}');OfferDetailPage.render({offerId:'${off.id}'})`});
    } else if (todayActs.length > 0) {
      const a = todayActs[0];
      tips.push({icon:'bell', color:'var(--or)', title:'Uppföljning idag!', body:a.note || 'Planerad uppföljning att utföra idag.', cta:'Markera klar', ctaFn:`ActivitiesService.complete('${a.id}');OfferDetailPage.render({offerId:'${off.id}'})`});
    } else if (nextAct) {
      const dateStr = fmtDate(nextAct.dueDate);
      tips.push({icon:'calendar-check', color:'var(--gr)', title:`Nästa uppföljning: ${dateStr}`, body:nextAct.note || 'Uppföljning inbokad.', cta:'Boka ny', ctaFn:`OfferDetailPage._quickAction('${off.id}','followup')`});
    }

    if (off.status === 'utkast') {
      if (!prLines.length) {
        tips.push({icon:'alert-circle', color:'var(--rd)', title:'Offerten är tom', body:'Lägg till minst en tjänst eller rad i steg 2 innan du skickar.', cta:'Redigera', ctaFn:`OffersPage.openEdit('${off.id}')`});
      } else if (!off.scope && !off.summary) {
        tips.push({icon:'edit-3', color:'var(--mt)', title:'Lägg till uppdragsbeskrivning', body:'En tydlig uppdragsbeskrivning ökar vinstchansen avsevärt. Klicka Redigera och använd textgeneratorn.', cta:'Redigera & generera text', ctaFn:`OffersPage.openEdit('${off.id}')`});
      } else {
        tips.push({icon:'send', color:'var(--blue)', title:'Klar att skicka?', body:'Offerten ser komplett ut. Skicka den till kunden för att komma vidare i affären.', cta:'Skicka offert', ctaFn:`OfferDetailPage.showSendModal('${off.id}')`});
      }
      if (rutAmt > 0 && prLines.length > 0) {
        tips.push({icon:'info', color:'var(--gr)', title:`Lyft RUT/ROT i kommunikationen`, body:`Kunden betalar bara ${fmt(cust).toLocaleString('sv-SE')} kr efter avdraget. Nämn det redan i e-postmeddelandet — det är en tydlig och konkret säljpunkt.`});
      }
      if (prLines.length > 0 && cust > 20000) {
        tips.push({icon:'phone', color:'var(--mt)', title:'Ring kunden innan du skickar', body:`Stor affär (${fmt(cust)} kr kund) — ett samtal innan utskick ökar konverteringen avsevärt.`, cta:'Logga samtal', ctaFn:`OfferDetailPage._quickAction('${off.id}','ring')`});
      }
    }

    if (off.status === 'skickad' || off.status === 'påmind' || off.status === 'väntar') {
      if (daysSent !== null && daysSent > 7) {
        tips.push({icon:'alert-circle', color:'var(--rd)', title:`Skickad för ${daysSent} dagar sedan — risk för förlust`, body:'Äldre offerter konverterar sämre. Ring kunden direkt och håll liv i dialogen.', cta:'Logga samtal', ctaFn:`OfferDetailPage._quickAction('${off.id}','ring')`});
      } else if (daysSent !== null && daysSent >= 3) {
        tips.push({icon:'bell', color:'var(--or)', title:`Dags att följa upp (${daysSent} dagar sedan)`, body:'Skicka ett vänligt uppföljningsmejl och fråga om kunden har frågor kring offerten.', cta:'Logga uppföljning', ctaFn:`OfferDetailPage._quickAction('${off.id}','followup')`});
      }
      if (daysLeft !== null && daysLeft >= 0 && daysLeft <= 5) {
        tips.push({icon:'clock', color:'var(--or)', title:`Giltighet utgår om ${daysLeft} dag${daysLeft===1?'':'ar'}`, body:'Kontakta kunden nu och förläng giltigheten om nödvändigt för att inte tappa affären.'});
      }
      if (rutAmt > 0) {
        tips.push({icon:'dollar-sign', color:'var(--gr)', title:'Lyft RUT/ROT-avdraget i uppföljningen', body:`Kunden betalar bara ${(cust).toLocaleString('sv-SE')} kr efter avdraget — en konkret och övertygande säljpunkt.`});
      }
      if (cust > 20000) {
        tips.push({icon:'phone', color:'var(--mt)', title:'Stor affär — personlig kontakt rekommenderas', body:'För offerter över 20 000 kr ökar chansen med ett personligt samtal snarare än enbart e-post.'});
      }
      if (!offerActs.length) {
        tips.push({icon:'bell', color:'var(--mt)', title:'Ingen uppföljning bokad', body:'Boka en uppföljning inom 3 dagar för bästa konvertering.', cta:'Boka uppföljning', ctaFn:`OfferDetailPage._quickAction('${off.id}','followup')`});
      }
    }

    if (off.status === 'påmind') {
      if (daysSent !== null && daysSent > 14) {
        tips.push({icon:'alert-circle', color:'var(--rd)', title:`Skickad påminnelse för ${daysSent} dagar sedan`, body:'Ring kunden direkt — ärendet riskerar att falla bort.', cta:'Logga samtal', ctaFn:`OfferDetailPage._quickAction('${off.id}','ring')`});
      }
    }

    if (off.status === 'nekad') {
      tips.push({icon:'help-circle', color:'var(--mt)', title:'Analysera varför affären föll', body:'Var det pris, timing, konkurrent eller omfattning? Logga orsaken för framtida lärdomar.', cta:'Logga orsak', ctaFn:`OfferDetailPage._quickAction('${off.id}','reason')`});
      tips.push({icon:'git-branch', color:'var(--blue)', title:'Föreslå nytt erbjudande', body:'Skapa en ny version och justera — antingen priset, villkoren eller tjänsternas omfattning. Många affärer återvinns med rätt anpassning.', cta:'Ny version', ctaFn:`OfferDetailPage.createNewVersion('${off.id}')`});
    }

    if (off.status === 'godkänd' && !off.workOrderId) {
      tips.push({icon:'clipboard-list', color:'var(--gr)', title:'Skapa arbetsorder nu', body:'Offerten är godkänd — starta jobbet genom att skapa en arbetsorder direkt från offerten.', cta:'Skapa AO', ctaFn:`OfferDetailPage.createAO()`});
    }
    if (off.status === 'godkänd' && off.workOrderId) {
      tips.push({icon:'clipboard-list', color:'var(--gr)', title:`Arbetsorder ${off.workOrderId} skapad`, body:'Gå till arbetsordern för att planera, dokumentera och slutföra uppdraget.', cta:'Öppna AO', ctaFn:`Router.showPage('pg-ao-detail',{aoId:'${off.workOrderId}'})`});
    }

    if (!tips.length) return '';

    return `<div class="card" style="border-left:3px solid var(--sky);margin-top:0;">
      <div class="card-header">
        <h3 style="display:flex;align-items:center;gap:6px;">${ic('zap',13)} Säljassistent</h3>
      </div>
      <div class="card-body" style="padding:6px 14px 10px;display:flex;flex-direction:column;gap:8px;">
        ${tips.map(t=>`<div style="display:flex;gap:10px;align-items:flex-start;padding:8px 10px;background:var(--bg);border-radius:var(--rs);">
          <span style="color:${t.color};flex-shrink:0;margin-top:1px;">${ic(t.icon,14)}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:700;color:var(--navy);margin-bottom:2px;">${t.title}</div>
            <div style="font-size:11px;color:var(--mt);line-height:1.4;">${t.body}</div>
            ${t.cta?`<button type="button" class="btn bs bxs" style="margin-top:6px;font-size:10px;" onclick="${t.ctaFn}">${t.cta}</button>`:''}
          </div>
        </div>`).join('')}
      </div>
    </div>`;
  },

  /* ── PDF/Print ─── */
  printPdf(offerId) {
    const off = getOff(offerId);
    if (!off) return;
    const cu        = getCu(off.customerId);
    const cuName    = cu ? CustomerService.displayName(cu) : '—';
    const cuContact = cu ? cu.contactPerson || '' : '';
    const cuAddr    = cu ? [cu.address, cu.zip, cu.city].filter(Boolean).join(', ') : '';
    const cuPhone   = cu ? cu.phone || '' : '';
    const cuEmail   = cu ? cu.email || '' : '';
    const s         = state.settings || {};
    const co        = s.companyName    || 'VIFT Fastighetsservice & Förvaltning AB';
    const coPhone   = s.companyPhone   || '';
    const coEmail   = s.companyEmail   || '';
    const coAddr    = s.companyAddress || '';
    const orgNr     = s.orgNr          || '';
    const logoUrl   = BrandingService.logoLightAbsolute();

    const prLines  = (off.lines||[]).filter(l=>l.type!=='text');
    const txtBlks  = (off.lines||[]).filter(l=>l.type==='text'&&(l.blockTitle||l.text));
    const extras   = off.extras||[];
    const rawExVat = _offRawExVat(off);
    const _disc    = off.discount||{type:'percent',value:0};
    const discAmt  = _disc.value?(_disc.type==='percent'?Math.round(rawExVat*Math.min(_disc.value,100)/100):Math.min(Math.round(_disc.value),rawExVat)):0;
    const exVat    = rawExVat - discAmt;
    const vat      = Math.round(exVat*0.25);
    const incVat   = exVat+vat;
    const rutAmt   = Math.round(prLines.filter(l=>l.type==='service').reduce((s,l)=>s+(l.rutAmount||0),0));
    const cust     = incVat - rutAmt;
    const hasRut   = rutAmt > 0;
    const fmt2     = n => (n||0).toLocaleString('sv-SE');
    const esc2     = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const san2     = s => OfferDetailPage._sanitizeText(s||'');

    // RUT or ROT label
    const rutLabel = (() => {
      const svcs = prLines.filter(l=>l.type==='service'&&(l.rutAmount||0)>0);
      if (svcs.length === 0) return 'RUT/ROT-avdrag';
      return svcs.every(l=>l.reductionType==='rot') ? 'ROT-avdrag' : 'RUT-avdrag';
    })();

    // Line rows — customer-facing, no internal kalkyl
    const lineRows = prLines.map(l => {
      if (l.type==='service') {
        const lExVat=l.exVat||0, lVat=Math.round(lExVat*(l.vatRate||25)/100);
        return `<tr>
          <td><strong>${esc2(l.templateName||'Tjänst')}</strong>${l.description&&l.description!==l.templateName?'<br><span class="ld">'+esc2(l.description)+'</span>':''}</td>
          <td class="r">${fmt2(lExVat)} kr</td>
          <td class="r">${l.vatRate||25}%</td>
          <td class="r fw">${fmt2(lExVat+lVat)} kr</td>
        </tr>`;
      }
      const tot=Math.round((l.qty||1)*(l.unitPrice||0));
      return `<tr>
        <td>${esc2(l.description||'—')}<br><span class="ld">${l.qty||1} ${l.unit||'st'} × ${fmt2(l.unitPrice||0)} kr ex. moms</span></td>
        <td class="r">${fmt2(tot)} kr</td>
        <td class="r">25%</td>
        <td class="r fw">${fmt2(tot+Math.round(tot*0.25))} kr</td>
      </tr>`;
    }).join('');

    const extrasRows = extras.length ? extras.map(e => {
      const tot=Math.round((e.qty||1)*(e.unitPrice||0));
      return `<tr class="xtra">
        <td>${esc2(e.description||'Tillval')}<br><span class="ld">${e.qty||1} ${e.unit||'st'} × ${fmt2(e.unitPrice||0)} kr</span></td>
        <td class="r">${fmt2(tot)} kr</td>
        <td class="r">25%</td>
        <td class="r">${fmt2(tot+Math.round(tot*0.25))} kr</td>
      </tr>`;
    }).join('') : '';

    const defaultTerms = 'Offerten är giltig enligt angiven giltighetstid från offererat datum. Betalning 30 dagar netto. Dröjsmålsränta 8 % per år. Vid godkänd offert upprättas skriftlig orderbekräftelse. VIFT förbehåller sig rätten att justera priset vid väsentliga förändringar av uppdragets omfattning. Priser angivna exklusive moms om inget annat framgår.';
    const footerLine = [coPhone?'Tel: '+coPhone:'', coEmail||'', orgNr?'Org.nr: '+orgNr:''].filter(Boolean).join('  ·  ');

    const html = `<!DOCTYPE html>
<html lang="sv">
<head>
<meta charset="UTF-8">
<title>Offert ${esc2(off.id)} – ${esc2(cuName)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Helvetica Neue',Arial,Helvetica,sans-serif;font-size:13px;color:#1e293b;background:#fff;}
.pg{max-width:800px;margin:0 auto;padding:36px 44px;}

/* Header */
.hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;padding-bottom:20px;border-bottom:1px solid #f1f5f9;gap:28px;}
.hdr-accent{height:2px;background:linear-gradient(90deg,#0d2b4e 0%,#3b82f6 60%,transparent 100%);border-radius:2px;margin-bottom:26px;margin-top:-24px;}
.logo-wrap{display:flex;align-items:center;gap:0;}
.logo-img{max-height:44px;max-width:160px;width:auto;height:auto;object-fit:contain;display:block;}
.logo-fb{display:none;background:#0d2b4e;color:#fff;font-weight:900;font-size:18px;padding:9px 14px 8px;border-radius:6px;letter-spacing:-0.5px;line-height:1;}
.logo-sep{width:1px;background:#e8ecf0;height:36px;margin:0 14px;flex-shrink:0;}
.logo-co{font-size:11px;font-weight:700;color:#0d2b4e;line-height:1.4;}
.logo-detail{font-size:10px;color:#94a3b8;margin-top:3px;line-height:1.6;}

.off-meta{text-align:right;flex-shrink:0;padding-top:2px;}
.off-num-lbl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.4px;color:#94a3b8;margin-bottom:2px;}
.off-num{font-size:20px;font-weight:900;color:#0d2b4e;letter-spacing:-0.5px;line-height:1;margin-bottom:4px;}
.off-title{font-size:11px;font-weight:600;color:#64748b;margin-bottom:3px;}
.off-date{font-size:10px;color:#94a3b8;line-height:1.6;}
.validity{display:inline-block;background:#f0f9ff;border:1px solid #bae6fd;color:#0369a1;font-size:9px;font-weight:700;padding:2px 9px;border-radius:20px;margin-top:5px;letter-spacing:.2px;}

/* Parties */
.parties{display:grid;grid-template-columns:1fr 1fr;gap:0;margin-bottom:24px;padding-bottom:20px;border-bottom:1px solid #f1f5f9;}
.party{padding:0 24px 0 0;}
.party:last-child{padding:0 0 0 24px;border-left:1px solid #f1f5f9;}
.p-lbl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.9px;color:#94a3b8;margin-bottom:6px;}
.p-name{font-size:14px;font-weight:800;color:#0d2b4e;margin-bottom:4px;line-height:1.3;}
.p-det{font-size:11px;color:#64748b;line-height:1.75;}

/* Sections */
.sec{margin-bottom:16px;}
.sec-h{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;padding-bottom:6px;margin-bottom:10px;border-bottom:1px solid #f1f5f9;}
.sec-t{font-size:12px;line-height:1.8;color:#334155;}

/* Ingår/ingår ej */
.ie{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:22px;}
.ie-in{border-left:3px solid #4ade80;padding:8px 12px;}
.ie-out{border-left:3px solid #fb923c;padding:8px 12px;}
.ie-lbl-in{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#16a34a;margin-bottom:6px;}
.ie-lbl-out{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#c2410c;margin-bottom:6px;}
.ie-t{font-size:11px;line-height:1.75;white-space:pre-wrap;color:#374151;}
.ie-t.muted{color:#64748b;}

/* Table */
table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:6px;}
thead th{background:transparent;color:#64748b;padding:5px 10px 9px;font-size:9px;font-weight:700;letter-spacing:.5px;text-align:left;border-bottom:2px solid #0d2b4e;}
thead th.r{text-align:right;}
tbody td{padding:10px 10px;border-bottom:1px solid #f0f4f8;vertical-align:top;}
tbody tr:last-child td{border-bottom:none;}
tbody tr:nth-child(even) td{background:#fafbfc;}
td.r{text-align:right;white-space:nowrap;}
td.fw{font-weight:600;color:#0d2b4e;}
.ld{font-size:10px;color:#94a3b8;margin-top:2px;}
.xtra td{color:#94a3b8;font-style:italic;}

/* Totals */
.tot-wrap{display:flex;justify-content:flex-end;margin:8px 0 20px;}
.tot-box{min-width:260px;}
.tot-r{display:flex;justify-content:space-between;align-items:center;padding:6px 0;font-size:12px;color:#64748b;border-bottom:1px solid #f1f5f9;}
.tot-r.disc{color:#b45309;border-bottom:1px solid #f1f5f9;}
.tot-div{height:1px;background:#cbd5e1;margin:2px 0;border:none;}
.tot-fin{display:flex;justify-content:space-between;align-items:center;padding:10px 0 4px;font-size:18px;font-weight:900;color:#0d2b4e;border-bottom:none;}
.tot-r.rut-deduct{color:#16a34a;font-weight:700;border-bottom:none;font-size:13px;}

/* RUT/ROT */
.rut{display:flex;align-items:flex-start;gap:14px;background:#f0fdf4;border-left:4px solid #4ade80;border-radius:0 8px 8px 0;padding:13px 16px;margin-bottom:20px;}
.rut-icon{width:38px;height:38px;background:#16a34a;border-radius:6px;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#fff;font-weight:900;font-size:11px;line-height:1.2;text-align:center;}
.rut-body{flex:1;}
.rut-lbl{font-size:11px;font-weight:700;color:#16a34a;margin-bottom:3px;}
.rut-amt{font-size:22px;font-weight:900;color:#16a34a;line-height:1;}
.rut-sub{font-size:11px;color:#374151;margin-top:4px;line-height:1.6;}
.rut-note{font-size:10px;color:#64748b;margin-top:4px;font-style:italic;line-height:1.5;}

/* Terms */
.terms{border-top:1px solid #f1f5f9;padding-top:14px;margin-top:16px;}
.terms-h{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.9px;color:#94a3b8;margin-bottom:7px;}
.terms-t{font-size:10px;color:#94a3b8;line-height:1.75;}

/* Footer */
.ftr{margin-top:24px;padding-top:10px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;font-size:9px;color:#94a3b8;}
.ftr-brand{font-weight:700;color:#475569;font-size:10px;}

@media print{body{padding:0;}.pg{padding:18px 22px;}@page{margin:10mm 14mm;size:A4;}}
</style>
</head>
<body>
<div class="pg">

<div class="hdr">
  <div class="logo-wrap">
    <img class="logo-img" src="${logoUrl}" alt="VIFT"
      onerror="this.style.display='none';this.nextElementSibling.style.display='inline-block'">
    <div class="logo-fb">VIFT</div>
    <div class="logo-sep"></div>
    <div class="logo-info">
      <div class="logo-co">${esc2(co)}</div>
      ${coAddr?`<div class="logo-detail">${esc2(coAddr)}</div>`:''}
      ${coPhone||coEmail?`<div class="logo-detail">${[coPhone?'Tel: '+esc2(coPhone):'',coEmail?esc2(coEmail):''].filter(Boolean).join('  ·  ')}</div>`:''}
    </div>
  </div>
  <div class="off-meta">
    <div class="off-num-lbl">Offert</div>
    <div class="off-num">${esc2(off.id)}</div>
    ${off.title?`<div class="off-title">${esc2(off.title)}</div>`:''}
    <div class="off-date">Datum: ${(off.createdAt||'').split('T')[0]||'—'}</div>
    ${off.validUntil?`<div><span class="validity">Giltig till ${esc2(off.validUntil)}</span></div>`:''}
  </div>
</div>
<div class="hdr-accent"></div>

<div class="parties">
  <div class="party">
    <div class="p-lbl">Offereras till</div>
    <div class="p-name">${esc2(cuName)}</div>
    <div class="p-det">${[cuContact?esc2(cuContact):'', cuPhone?'Tel: '+esc2(cuPhone):'', cuEmail?esc2(cuEmail):'', cuAddr?esc2(cuAddr):''].filter(Boolean).join('<br>')}</div>
  </div>
  <div class="party">
    <div class="p-lbl">Offertvillkor</div>
    <div class="p-det">${[off.paymentTerms?'Betalning: '+esc2(off.paymentTerms):'', off.validityText?'Giltighetstid: '+esc2(off.validityText):'Giltighetstid: 30 dagar', orgNr?'Org.nr: '+esc2(orgNr):''].filter(Boolean).join('<br>')}</div>
  </div>
</div>

${off.summary?`<div class="sec"><div class="sec-h">Sammanfattning</div><div class="sec-t">${esc2(off.summary).replace(/\n/g,'<br>')}</div></div>`:''}
${off.scope?`<div class="sec"><div class="sec-h">Uppdragets omfattning</div><div class="sec-t">${esc2(off.scope).replace(/\n/g,'<br>')}</div></div>`:''}

${off.includes||off.excludes?`<div class="ie">
  ${off.includes?`<div class="ie-in"><div class="ie-lbl-in">✓ Ingår i uppdraget</div><div class="ie-t">${esc2(san2(off.includes))}</div></div>`:''}
  ${off.excludes?`<div class="ie-out"><div class="ie-lbl-out">✗ Ingår ej</div><div class="ie-t muted">${esc2(san2(off.excludes))}</div></div>`:''}
</div>`:''}

<div class="sec-h">Offertrader</div>
<table>
  <thead><tr>
    <th>Tjänst / Beskrivning</th>
    <th class="r">Ex. moms</th>
    <th class="r">Moms</th>
    <th class="r">Inkl. moms</th>
  </tr></thead>
  <tbody>${lineRows}</tbody>
</table>

${extras.length?`<table style="margin-top:8px;"><thead><tr><th colspan="4" style="background:#475569;font-size:10px;">Tillval (ej inkluderat i totalpriset)</th></tr></thead><tbody>${extrasRows}</tbody></table>`:''}
${txtBlks.map(tb=>`<div class="sec" style="margin-top:14px;">${tb.blockTitle?`<div class="sec-h">${esc2(tb.blockTitle)}</div>`:''}${tb.text?`<div class="sec-t">${esc2(tb.text).replace(/\n/g,'<br>')}</div>`:''}</div>`).join('')}

<div class="tot-wrap">
  <div class="tot-box">
    <div class="tot-r"><span>Summa ex. moms</span><span>${fmt2(rawExVat)} kr</span></div>
    ${discAmt?`<div class="tot-r disc"><span>Rabatt</span><span>−${fmt2(discAmt)} kr</span></div>`:''}
    <div class="tot-r"><span>Moms 25 %</span><span>${fmt2(vat)} kr</span></div>
    <hr class="tot-div">
    <div class="tot-fin"><span>${hasRut?'Totalt inkl. moms':'Totalt att betala'}</span><span>${fmt2(incVat)} kr</span></div>
    ${hasRut?`<div class="tot-r rut-deduct" style="margin-top:4px;"><span>${rutLabel}</span><span>−${fmt2(rutAmt)} kr</span></div>`:''}
  </div>
</div>

${(off.lines||[]).some(l=>(l.description||'').includes('minimidebitering'))?`<div style="margin-bottom:12px;padding:7px 10px;background:#fffbeb;border-left:3px solid #d97706;font-size:10px;color:#555;line-height:1.5;border-radius:0 4px 4px 0;"><strong>Minimidebitering:</strong> Tjänsten har ett lägsta debiteringsbelopp som täcker etablering, utrustning och grundarbete.</div>`:''}

${hasRut?`<div class="rut">
  <div class="rut-icon">${rutLabel.startsWith('ROT')?'ROT':'RUT'}</div>
  <div class="rut-body">
    <div class="rut-lbl">${rutLabel} — skattereduktion</div>
    <div class="rut-amt">${fmt2(cust)} kr</div>
    <div class="rut-sub">Kundpris inkl. moms &nbsp;·&nbsp; Preliminärt avdrag: −${fmt2(rutAmt)} kr &nbsp;·&nbsp; Totalt inkl. moms: ${fmt2(incVat)} kr</div>
    <div class="rut-note">* Avdraget är preliminärt och förutsätter att kunden har rätt till skattereduktion. VIFT administrerar ansökan direkt till Skatteverket.</div>
  </div>
</div>`:''}

<div style="margin-top:28px;border-top:1px solid #e2e8f0;padding-top:18px;">
  <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.9px;color:#94a3b8;margin-bottom:14px;">Godkännande</div>
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;">
    <div>
      <div style="height:36px;border-bottom:1px solid #94a3b8;margin-bottom:5px;"></div>
      <div style="font-size:10px;color:#64748b;">Godkänd av</div>
    </div>
    <div>
      <div style="height:36px;border-bottom:1px solid #94a3b8;margin-bottom:5px;"></div>
      <div style="font-size:10px;color:#64748b;">Datum</div>
    </div>
    <div>
      <div style="height:36px;border-bottom:1px solid #94a3b8;margin-bottom:5px;"></div>
      <div style="font-size:10px;color:#64748b;">Namnförtydligande</div>
    </div>
  </div>
</div>

<div class="terms">
  <div class="terms-h">Allmänna villkor</div>
  <div class="terms-t">${off.generalTerms ? esc2(off.generalTerms).replace(/\n/g,'<br>') : esc2(defaultTerms)}</div>
</div>

<div class="ftr">
  <div>
    <span class="ftr-brand">${esc2(co)}</span>
    ${coAddr?' · '+esc2(coAddr):''}
  </div>
  <div>${footerLine}</div>
</div>

</div>
</body></html>`;

    /* ── Visa PDF i in-page overlay (fungerar på mobil, iPad, iPhone Safari och PWA) ── */
    const prev = document.getElementById('pdf-preview-ov');
    if (prev) prev.remove();

    const blob    = new Blob([html], {type: 'text/html'});
    const blobUrl = URL.createObjectURL(blob);

    const ov = document.createElement('div');
    ov.id = 'pdf-preview-ov';
    ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#e8edf2;display:flex;flex-direction:column;padding-top:env(safe-area-inset-top);';

    const offLabel = esc2(off.id) + (off.title ? ' – ' + esc2(off.title) : '');

    ov.innerHTML = `
      <div style="flex-shrink:0;background:#0d2b4e;padding:10px 14px;display:flex;align-items:center;gap:8px;">
        <button id="pdf-close-btn" style="background:rgba(255,255,255,.15);border:none;color:#fff;padding:8px 14px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;">← Tillbaka</button>
        <span style="flex:1;color:#fff;font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${offLabel}</span>
        <button id="pdf-print-btn" style="background:#3b82f6;border:none;color:#fff;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;">Skriv ut</button>
      </div>
      <iframe id="pdf-frame" style="flex:1;border:none;width:100%;background:#fff;" title="Offert ${esc2(off.id)}"></iframe>
    `;
    document.body.appendChild(ov);

    /* Stäng: ta bort overlay och frigör blob-URL */
    document.getElementById('pdf-close-btn').onclick = () => {
      ov.remove();
      URL.revokeObjectURL(blobUrl);
    };

    /* Skriv ut via iframe (iframe + blob fungerar i alla moderna browsers inkl. iOS Safari) */
    document.getElementById('pdf-print-btn').onclick = () => {
      const fr = document.getElementById('pdf-frame');
      if (fr && fr.contentWindow) {
        try { fr.contentWindow.print(); }
        catch(_) { window.open(blobUrl, '_blank'); }
      }
    };

    /* Ladda HTML i iframe via blob-URL — säkert och utan popup-blockers */
    document.getElementById('pdf-frame').src = blobUrl;

    this._logEvt(off, 'pdf', 'PDF genererad');
    off.pdfGeneratedAt = new Date().toISOString();
    off.updatedAt = new Date().toISOString();
    persist();
  },

  /* ── Skicka offert via Edge Function (Resend) ─── */
  showSendModal(offerId) {
    const off = getOff(offerId);
    if (!off) return;
    const cu = getCu(off.customerId);
    const cuEmail    = cu ? (cu.email||'') : '';
    const firstName  = cu ? (cu.firstName||cu.name||'') : '';
    const _interpolate = (tmplStr, extra) => {
      const sentDate = off.sentAt ? new Date(off.sentAt).toLocaleDateString('sv-SE',{day:'numeric',month:'short',year:'numeric'}) : '—';
      const data = {
        offerId: off.id,
        titleSuffix: off.title ? ' – ' + off.title : '',
        firstName: firstName || 'kund',
        customerName: cu ? CustomerService.displayName(cu) : '',
        validUntil: off.validUntil || '—',
        paymentLine: off.paymentTerms ? 'Betalningsvillkor: ' + off.paymentTerms + '.' : '',
        sentDate,
        OFFER_LINK: '{{OFFER_LINK}}',
        ...(extra||{})
      };
      return (tmplStr||'').replace(/\{\{(\w+)\}\}/g, (_, k) => data[k] !== undefined ? data[k] : '');
    };

    const defaultTmpl = (state.emailTemplates||[]).find(t=>t.type==='send_offer') || {
      subject: 'Offert ' + off.id + (off.title?' – '+off.title:''),
      body: 'Hej {{firstName}},\n\nTack för ditt intresse. Bifogat hittar du vår offert ' + off.id + (off.title?' – '+off.title:'') + '.\n\nOfferten är giltig till ' + (off.validUntil||'—') + '.\n\nDu kan också se och svara på offerten online: {{OFFER_LINK}}\n\nMed vänliga hälsningar,\nVIFT Fastighetsservice'
    };

    const tmplOpts = (state.emailTemplates||[]).filter(t=>t.active!==false)
      .map(t => '<option value="' + t.id + '"' + (t.type==='send_offer'?' selected':'') + '>' + esc(t.name) + '</option>').join('');

    const subject = _interpolate(defaultTmpl.subject);
    const body2   = _interpolate(defaultTmpl.body);

    // Bilagor för offerten
    const offerAtts = (state.offerAttachments||[]).filter(a => a.offerId===off.id && !a.deleted && !a.hidden);
    const attCheckboxes = offerAtts.length > 0
      ? `<div class="fg"><label>Bifoga filer</label>
          <div style="display:flex;flex-direction:column;gap:4px;max-height:120px;overflow-y:auto;padding:6px;background:var(--bg);border:1px solid var(--br);border-radius:6px;">
            ${offerAtts.map(a => `<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;">
              <input type="checkbox" class="send-att-cb" value="${esc(a.id)}" ${a.includeInPublicView?'checked':''}>
              <span>${esc(a.displayName||a.originalFileName)}</span>
            </label>`).join('')}
          </div>
        </div>`
      : '';

    Modal.open({
      title: ic('send',14) + ' Skicka offert',
      wide: true,
      body: `
        ${tmplOpts ? `<div class="fg"><label>Mejlmall</label>
          <select id="send-tmpl" onchange="OfferDetailPage._applySendTemplate('${offerId}',this.value)">${tmplOpts}</select></div>` : ''}
        <div class="fg"><label>Till <small style="color:var(--mt);font-weight:400;">— kommaseparerade adresser</small></label>
          <input id="send-to" value="${esc(cuEmail)}" placeholder="kund@exempel.se, annan@exempel.se" type="email" style="width:100%;box-sizing:border-box;"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div class="fg"><label>CC</label>
            <input id="send-cc" placeholder="cc@exempel.se" type="email" style="width:100%;box-sizing:border-box;"></div>
          <div class="fg"><label>BCC</label>
            <input id="send-bcc" placeholder="bcc@exempel.se" type="email" style="width:100%;box-sizing:border-box;"></div>
        </div>
        <div class="fg"><label>Ämne</label>
          <input id="send-subject" value="${esc(subject)}" style="width:100%;box-sizing:border-box;"></div>
        <div class="fg"><label>Meddelande <small style="color:var(--mt);font-weight:400;">— ${ic('link',10)} {{OFFER_LINK}} ersätts med säker offertlänk (skapas automatiskt vid utskick)</small></label>
          <textarea id="send-body" rows="8" style="width:100%;box-sizing:border-box;">${esc(body2)}</textarea></div>
        ${attCheckboxes}
        <label style="display:flex;align-items:center;gap:8px;padding:8px 0;cursor:pointer;font-size:12px;">
          <input type="checkbox" id="send-followup" checked style="width:15px;height:15px;">
          <span>Skapa uppföljning automatiskt om <strong>3 dagar</strong></span>
        </label>
        <div style="background:var(--bg);border-radius:var(--rs);padding:8px 12px;font-size:11px;color:var(--mt);">
          ${ic('info',10)} Skickar via Resend. Händelselogg sparas i offerttidslinjen.
        </div>`,
      buttons: [
        { label: ic('send',13) + ' Skicka', cls: 'btn bp', onClick: () => this._doSendEmail(off) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('send-to')?.focus(), 80);
  },

  _applyServerPatches(off, json) {
    var changed = false;
    if (json.offerPatch) {
      var stateOff = (state.offers||[]).find(function(o){ return o.id === off.id; });
      if (stateOff) Object.assign(stateOff, json.offerPatch);
      Object.assign(off, json.offerPatch);
      changed = true;
    }
    if (json.attachmentPatches && json.attachmentPatches.length) {
      (state.offerAttachments||[]).forEach(function(a) {
        var p = json.attachmentPatches.find(function(x){ return x.id === a.id; });
        if (p) { a.lockedInVersion = p.lockedInVersion; changed = true; }
      });
    }
    if (json.emailEvent) {
      if (!Array.isArray(state.offerEvents)) state.offerEvents = [];
      // Undvik dubbletter (idempotens)
      if (!state.offerEvents.find(function(e){ return e.id === json.emailEvent.id; })) {
        state.offerEvents.push(json.emailEvent);
        changed = true;
      }
    }
    return changed;
  },

  async _doSendEmail(off) {
    const toRaw   = (document.getElementById('send-to')?.value||'').trim();
    const ccRaw   = (document.getElementById('send-cc')?.value||'').trim();
    const bccRaw  = (document.getElementById('send-bcc')?.value||'').trim();
    const subject = (document.getElementById('send-subject')?.value||'').trim();
    const bodyTxt = (document.getElementById('send-body')?.value||'').trim();

    if (!toRaw)    { showToast('Fyll i e-postadress'); return; }
    if (!subject)  { showToast('Ämnesrad saknas');     return; }
    if (!bodyTxt)  { showToast('Meddelandetext saknas'); return; }

    const parseEmails = s => s.split(/[\s,;]+/).map(e=>e.trim()).filter(e=>e.includes('@'));
    const recipients  = parseEmails(toRaw);
    const cc          = parseEmails(ccRaw);
    const bcc         = parseEmails(bccRaw);

    if (!recipients.length) { showToast('Ingen giltig e-postadress'); return; }

    const attachmentIds = [...document.querySelectorAll('.send-att-cb:checked')].map(cb => cb.value);

    // Konvertera plaintext body till enkel HTML
    const bodyHtml = '<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#1e293b;">' +
      bodyTxt.replace(/\n/g,'<br>') + '</div>';

    // Knapp deaktivera för att undvika dubbelklick
    const sendBtn = document.querySelector('.modal-footer .btn.bp');
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'Skickar…'; }

    let messageId  = '';
    let sendOk     = false;
    let sendErr    = '';
    let serverJson = {};
    let patchesApplied = false;

    // Skicka via Edge Function — offerToken och sentBy hanteras server-side
    try {
      const jwt = typeof Auth !== 'undefined' ? Auth.getAccessToken() : null;
      if (!jwt) throw new Error('Inte inloggad');

      const base  = (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '').replace(/\/$/, '');
      const efUrl = base + '/functions/v1/send-offer-email';
      const res   = await fetch(efUrl, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'apikey': (typeof SUPABASE_AKEY !== 'undefined' ? SUPABASE_AKEY : ''),
          'Authorization': 'Bearer ' + jwt,
        },
        body: JSON.stringify({
          offerId:      off.id,
          recipients,
          cc,
          bcc,
          subject,
          bodyHtml,
          attachmentIds,
        })
      });

      serverJson = await res.json().catch(() => ({}));

      // Applicera serverpatchar på state INNAN vi kontrollerar res.ok —
      // token, snapshot och bilagelås är redan sparade server-side
      patchesApplied = this._applyServerPatches(off, serverJson);

      if (res.ok) {
        sendOk    = true;
        messageId = serverJson.messageId || '';
      } else {
        sendErr = serverJson.detail || serverJson.error || ('HTTP ' + res.status);
      }
    } catch (e) {
      sendErr = String(e);
    }

    // Vid fel: bevara serverändringar med persist() och stanna kvar i dialogen
    if (!sendOk) {
      console.error('[send-offer-email] Fel:', sendErr);
      showToast('Kunde inte skicka offerten: ' + sendErr, 'error');
      if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = ic('send',13) + ' Skicka'; }
      if (patchesApplied) persist();
      return;
    }

    // Endast vid lyckat utskick: uppdatera CRM-statusfält
    off.status      = 'skickad';
    off.sentAt      = off.sentAt || serverJson.sentAt || new Date().toISOString();
    off.emailSentTo = recipients[0];
    off.updatedAt   = new Date().toISOString();

    // LOGGA INTE email_sent internt — serverns emailEvent täcker det i den externa tidslinjen

    // Uppföljning — detta är en separat intern händelse, inte email_sent
    if (document.getElementById('send-followup')?.checked) {
      if (typeof ActivitiesService !== 'undefined') {
        ActivitiesService.create({
          title:       'Följ upp offert ' + off.id + (off.title?' – '+off.title:''),
          type:        'followup',
          relatedType: 'offer',
          relatedId:   off.id,
          customerId:  off.customerId || null,
          assignedTo:  state.currentUser?.id || null,
          dueDate:     _ds(3),
          dueTime:     '09:00',
          note:        'Offert skickad till ' + recipients.join(', ') + ' — följ upp om 3 dagar',
          priority:    'normal',
        });
        this._logEvt(off, 'followup', 'Uppföljning bokad om 3 dagar (automatisk)');
        if (typeof Sidebar !== 'undefined') Sidebar.updateBadges();
      }
    }

    persist();
    Modal.close();
    this.render({ offerId: off.id });
    showToast('Offert skickad till ' + recipients.join(', '));
  },

  _applySendTemplate(offerId, tmplId) {
    const off  = getOff(offerId);
    const cu   = getCu(off?.customerId);
    const tmpl = (state.emailTemplates||[]).find(t=>t.id===tmplId);
    if (!tmpl || !off) return;
    const firstName = cu ? (cu.firstName||cu.name||'') : '';
    const sentDate  = off.sentAt ? new Date(off.sentAt).toLocaleDateString('sv-SE',{day:'numeric',month:'short',year:'numeric'}) : '—';
    const data = {
      offerId: off.id, titleSuffix: off.title?' – '+off.title:'', firstName: firstName||'kund',
      validUntil: off.validUntil||'—', paymentLine: off.paymentTerms?'Betalningsvillkor: '+off.paymentTerms+'.':'',
      sentDate, OFFER_LINK: '{{OFFER_LINK}}'
    };
    const interp = s => (s||'').replace(/\{\{(\w+)\}\}/g, (_,k) => data[k]!==undefined?data[k]:'');
    const subj = document.getElementById('send-subject');
    const body = document.getElementById('send-body');
    if (subj) subj.value = interp(tmpl.subject);
    if (body) body.value = interp(tmpl.body);
  },

  showReminderModal(offerId) {
    const off = getOff(offerId);
    if (!off) return;
    const cu = getCu(off.customerId);
    const cuEmail = cu ? (cu.email||'') : '';
    const firstName = cu ? (cu.firstName||cu.name||'') : '';
    const tmpl = (state.emailTemplates||[]).find(t=>t.type==='reminder');
    const sentDate = off.sentAt ? new Date(off.sentAt).toLocaleDateString('sv-SE',{day:'numeric',month:'short',year:'numeric'}) : '—';
    const data = {
      offerId: off.id, titleSuffix: off.title?' – '+off.title:'', firstName: firstName||'kund',
      validUntil: off.validUntil||'—', sentDate, paymentLine:'', viftPhone:''
    };
    const interp = s => (s||'').replace(/\{\{(\w+)\}\}/g, (_,k) => data[k]!==undefined?data[k]:'');
    const subject = interp(tmpl?.subject || ('Påminnelse: Offert ' + off.id + (off.title?' – '+off.title:'')));
    const body2   = interp(tmpl?.body || ('Hej,\n\nPåminnelse om offert ' + off.id + '.\n\nMed vänliga hälsningar,\nVIFT Fastighetsservice'));

    Modal.open({
      title: ic('bell',14) + ' Skicka påminnelse',
      wide: true,
      body: `
        <div class="fg"><label>Till (e-post)</label>
          <input id="remind-to" value="${esc(cuEmail)}" placeholder="kund@exempel.se" type="email"></div>
        <div class="fg"><label>Ämne</label><input id="remind-subject" value="${esc(subject)}"></div>
        <div class="fg"><label>Meddelande</label>
          <textarea id="remind-body" rows="7">${esc(body2)}</textarea></div>
        <div style="background:var(--bg);border-radius:var(--rs);padding:8px 12px;font-size:11px;color:var(--mt);">
          ${ic('info',10)} Skickar via Resend. Status ändras till "Påmind".
        </div>`,
      buttons: [
        { label: ic('bell',13) + ' Skicka påminnelse', cls: 'btn bp', onClick: () => this._doSendReminder(off) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('remind-to')?.focus(), 80);
  },

  async _doSendReminder(off) {
    const toRaw   = (document.getElementById('remind-to')?.value||'').trim();
    const subject = (document.getElementById('remind-subject')?.value||'').trim();
    const bodyTxt = (document.getElementById('remind-body')?.value||'').trim();
    if (!toRaw) { showToast('Fyll i e-postadress'); return; }

    const parseEmails = s => s.split(/[\s,;]+/).map(e=>e.trim()).filter(e=>e.includes('@'));
    const recipients  = parseEmails(toRaw);
    if (!recipients.length) { showToast('Ingen giltig e-postadress'); return; }

    const bodyHtml = '<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#1e293b;">' +
      bodyTxt.replace(/\n/g,'<br>') + '</div>';

    const sendBtn = document.querySelector('.modal-footer .btn.bp');
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'Skickar…'; }

    let sendOk     = false;
    let sendErr    = '';
    let remindJson = {};
    let patchesApplied = false;
    try {
      const jwt   = typeof Auth !== 'undefined' ? Auth.getAccessToken() : null;
      if (!jwt) throw new Error('Inte inloggad');
      const base  = (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '').replace(/\/$/, '');
      const res   = await fetch(base + '/functions/v1/send-offer-email', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': (typeof SUPABASE_AKEY !== 'undefined' ? SUPABASE_AKEY : ''),
          'Authorization': 'Bearer ' + jwt
        },
        body: JSON.stringify({
          offerId: off.id,
          recipients, cc: [], bcc: [], subject, bodyHtml,
          attachmentIds: [],
        })
      });
      remindJson = await res.json().catch(()=>({}));

      // Applicera serverpatchar på state OAVSETT utskicksresultat
      patchesApplied = this._applyServerPatches(off, remindJson);

      sendOk = res.ok;
      if (!sendOk) sendErr = remindJson.detail || remindJson.error || ('HTTP ' + res.status);
    } catch(e) {
      sendErr = String(e);
    }

    // Vid fel: bevara serverändringar med persist() och stanna kvar i dialogen
    if (!sendOk) {
      console.error('[send-offer-email] Påminnelsefel:', sendErr);
      showToast('Kunde inte skicka påminnelsen: ' + sendErr, 'error');
      if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = ic('bell',13) + ' Skicka påminnelse'; }
      if (patchesApplied) persist();
      return;
    }

    // Endast vid lyckat utskick: uppdatera CRM-statusfält
    off.status         = 'påmind';
    off.reminderSentAt = new Date().toISOString();
    off.updatedAt      = new Date().toISOString();
    this._logEvt(off, 'reminder', 'Påminnelse skickad till ' + recipients.join(', '));
    persist();
    Modal.close();
    this.render({ offerId: off.id });
    showToast('Påminnelse skickad');
  },

  createNewVersion(offerId) {
    const off = getOff(offerId);
    if (!off) return;
    const newVer = (off.versionNumber || 1) + 1;
    Modal.open({
      title: ic('git-branch',14) + ' Skapa ny version',
      body: `<p style="font-size:13px;margin-bottom:12px;">Skapa version <strong>${newVer}</strong> av ${off.id}?</p>
        <p style="font-size:12px;color:var(--mt);">Gamla versionen markeras som <em>Ersatt</em>. Den nya versionen kopierar alla rader, kund, text och villkor och sätts till <em>Utkast</em>.</p>`,
      buttons: [
        { label: ic('git-branch',12) + ' Skapa version ' + newVer, cls: 'btn bp', onClick: () => {
          const now = new Date().toISOString();
          off.status    = 'ersatt';
          off.updatedAt = now;
          this._logEvt(off, 'status', 'Version ' + (off.versionNumber||1) + ' ersatt av ny version');
          // Create new version
          const newOff = JSON.parse(JSON.stringify(off));
          newOff.id             = newId(state.offers, 'OFF');
          newOff.status         = 'utkast';
          newOff.versionNumber  = newVer;
          newOff.parentOfferId  = offerId;
          newOff.sentAt         = '';
          newOff.answeredAt     = '';
          newOff.reminderSentAt = '';
          newOff.emailSentTo    = '';
          newOff.workOrderId    = '';
          newOff.createdAt      = now;
          newOff.updatedAt      = now;
          newOff.timeline       = [];
          newOff.customerApproval = { token:'', approvedAt:null, approvedByName:'', approvedByEmail:'', ip:'', comment:'' };
          this._logEvt(newOff, 'create', 'Version ' + newVer + ' skapad från ' + offerId + ' v' + (off.versionNumber||1));
          state.offers.push(newOff);
          persist();
          Modal.close();
          Router.showPage('pg-offer-detail', {offerId: newOff.id});
          showToast('Version ' + newVer + ' skapad: ' + newOff.id);
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  /* ── Digital offertlänk — panel ────────────────────────── */
  _digitalLinkPanel(off) {
    if (off.archived || off.deleted) return '';
    const hasToken = !!off.publicToken;
    const revoked  = !!off.tokenRevokedAt;
    const expired  = off.tokenExpiresAt && new Date(off.tokenExpiresAt).getTime() < Date.now();

    if (!hasToken) {
      /* Visa knapp för att generera länk om offert är skickad eller klare */
      const canSend = !off.archived && !off.deleted;
      if (!canSend) return '';
      return `<div class="card" style="margin-top:8px;">
        <div class="card-header"><h3 style="display:flex;align-items:center;gap:6px;">${ic('link',13)} Digital offertlänk</h3></div>
        <div class="card-body" style="padding:14px 16px;">
          <p style="font-size:12px;color:var(--mt);margin:0 0 10px;">Generera en säker länk som kunden kan öppna för att godkänna, begära ändring eller neka offerten.</p>
          <button type="button" class="btn bp" style="font-size:12px;" onclick="OfferDetailPage.generateDigitalLink('${esc(off.id)}')">${ic('link',12)} Generera digital länk</button>
        </div>
      </div>`;
    }

    const host    = window.location.origin;
    const linkUrl = `${host}/public-offer.html?t=${off.publicToken}`;
    const expiryLabel = off.tokenExpiresAt
      ? 'Giltig till ' + (typeof fmtDate === 'function' ? fmtDate(off.tokenExpiresAt.slice(0,10)) : off.tokenExpiresAt.slice(0,10))
      : 'Ingen utgångsdatum';

    const statusDot = revoked ? `<span style="color:var(--rd);">● Återkallad</span>`
                    : expired ? `<span style="color:var(--or);">● Utgången</span>`
                    : `<span style="color:var(--gr);">● Aktiv</span>`;

    const openInfo = off.openedAt
      ? `Öppnad ${off.openCount || 1} gång${(off.openCount||1)===1?'':'er'}, första: ${typeof fmtDate==='function' ? fmtDate(off.openedAt.slice(0,10)) : off.openedAt.slice(0,10)}`
      : 'Ej öppnad ännu';

    return `<div class="card" style="margin-top:8px;">
      <div class="card-header">
        <h3 style="display:flex;align-items:center;gap:6px;">${ic('link',13)} Digital offertlänk</h3>
        <span style="font-size:11px;">${statusDot}</span>
      </div>
      <div class="card-body" style="padding:14px 16px;display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;align-items:center;gap:6px;">
          <input id="off-pub-link" readonly value="${esc(linkUrl)}" style="flex:1;font-size:11px;padding:6px 8px;border:1px solid var(--br);border-radius:6px;background:var(--bg);color:var(--tx);font-family:monospace;">
          <button type="button" class="btn bs" style="font-size:11px;white-space:nowrap;" onclick="OfferDetailPage._copyLink('${esc(linkUrl)}')">${ic('copy',11)} Kopiera</button>
        </div>
        <div style="font-size:11px;color:var(--mt);display:flex;gap:16px;flex-wrap:wrap;">
          <span>${ic('calendar',10)} ${esc(expiryLabel)}</span>
          <span>${ic('eye',10)} ${esc(openInfo)}</span>
        </div>
        ${revoked ? `<div style="background:var(--rd-bg,#fef2f2);border:1px solid var(--rd,#dc2626);border-radius:6px;padding:8px 10px;font-size:11px;color:var(--rd,#dc2626);">${ic('alert-circle',10)} Länken är återkallad — kunden kan inte längre öppna den.</div>` : ''}
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${!revoked && !['godkänd','nekad'].includes(off.status) ? `<button type="button" class="btn bp" style="font-size:11px;" onclick="OfferDetailPage.sendReminder('${esc(off.id)}')">${ic('send',11)} Skicka påminnelse</button>` : ''}
          ${!revoked ? `<button type="button" class="btn bs" style="font-size:11px;" onclick="OfferDetailPage.revokeDigitalLink('${esc(off.id)}')">${ic('x-circle',11)} Återkalla länk</button>` : ''}
          <button type="button" class="btn bs" style="font-size:11px;" onclick="OfferDetailPage.extendDigitalLink('${esc(off.id)}')">${ic('clock',11)} Förläng giltighetstid</button>
          <button type="button" class="btn bs" style="font-size:11px;" onclick="OfferDetailPage.generateDigitalLink('${esc(off.id)}')">${ic('refresh-cw',11)} Ny länk (ogiltigförklarar gammal)</button>
        </div>
      </div>
    </div>`;
  },

  _copyLink(url) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => showToast('Länk kopierad!')).catch(() => {
        const el = document.getElementById('off-pub-link');
        if (el) { el.select(); document.execCommand('copy'); showToast('Länk kopierad!'); }
      });
    } else {
      const el = document.getElementById('off-pub-link');
      if (el) { el.select(); document.execCommand('copy'); showToast('Länk kopierad!'); }
    }
  },

  /* ── Bilagor — panel ─────────────────────────────────────── */
  _attachmentsPanel(off) {
    if (off.archived || off.deleted) return '';
    const atts = (state.offerAttachments || []).filter(a => a.offerId === off.id && a.active !== false);
    const locked = !!off.publicToken && !off.tokenRevokedAt;

    const attRows = atts.length === 0
      ? `<p style="font-size:12px;color:var(--mt);margin:0;text-align:center;padding:12px 0;">Inga bilagor uppladdade</p>`
      : atts.sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0)).map(a => {
          const lockedBadge = a.lockedInVersion ? `<span style="font-size:10px;color:var(--or);margin-left:4px;">${ic('lock',10)} låst</span>` : '';
          const pubBadge = a.includeInPublicView ? `<span style="font-size:10px;color:var(--gr);margin-left:4px;">${ic('eye',10)} kundvy</span>` : '';
          const pdfBadge = a.includeInCombinedPdf ? `<span style="font-size:10px;color:var(--bl);margin-left:4px;">${ic('file-text',10)} PDF</span>` : '';
          const sizeLbl = a.sizeBytes > 1048576 ? (a.sizeBytes/1048576).toFixed(1)+' MB' : Math.round(a.sizeBytes/1024)+' KB';
          return `<div class="att-row">
            <div style="flex:1;min-width:0;">
              <div style="font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(a.displayName||a.originalFileName)}</div>
              <div style="font-size:10px;color:var(--mt);">${esc(a.mimeType)} · ${sizeLbl}${lockedBadge}${pubBadge}${pdfBadge}</div>
            </div>
            <div style="display:flex;gap:4px;flex-shrink:0;">
              <button type="button" class="btn bs" title="Visa" style="font-size:10px;padding:3px 7px;" onclick="OfferDetailPage._viewAttachment('${esc(a.id)}')">${ic('eye',10)}</button>
              <button type="button" class="btn bs" title="Ladda ner" style="font-size:10px;padding:3px 7px;" onclick="OfferDetailPage._downloadAttachment('${esc(a.id)}')">${ic('download',10)}</button>
              <button type="button" class="btn bs" style="font-size:10px;padding:3px 7px;" onclick="OfferDetailPage._editAttachment('${esc(a.id)}','${esc(off.id)}')">${ic('edit-2',10)}</button>
              <button type="button" class="btn bs" style="font-size:10px;padding:3px 7px;color:var(--rd);" onclick="OfferDetailPage._deleteAttachment('${esc(a.id)}','${esc(off.id)}')">${ic('trash-2',10)}</button>
            </div>
          </div>`;
        }).join('');

    const lockedNotice = locked ? `<div style="font-size:11px;color:var(--or);display:flex;align-items:center;gap:4px;margin-bottom:8px;">${ic('lock',11)} Bilagor som laddades upp innan digital länk genererades är versionslåsta.</div>` : '';

    return `<div class="card" style="margin-top:8px;">
      <div class="card-header">
        <h3 style="display:flex;align-items:center;gap:6px;">${ic('paperclip',13)} Bilagor (${atts.length})</h3>
        <div style="display:flex;gap:6px;">
          ${atts.length > 0 ? `<button type="button" class="btn bs" style="font-size:11px;" onclick="OfferDetailPage._generateCombinedPdf('${esc(off.id)}')">${ic('file-text',11)} Samlad PDF</button>` : ''}
          <button type="button" class="btn bp" style="font-size:11px;" onclick="OfferDetailPage._openUploadDialog('${esc(off.id)}','${esc(off.id)}')">${ic('upload',11)} Ladda upp</button>
        </div>
      </div>
      <div class="card-body" style="padding:14px 16px;">
        ${lockedNotice}
        <div class="att-dropzone" id="att-drop-${esc(off.id)}"
          ondragover="event.preventDefault();this.classList.add('att-dropzone-over')"
          ondragleave="this.classList.remove('att-dropzone-over')"
          ondrop="event.preventDefault();this.classList.remove('att-dropzone-over');OfferDetailPage._handleFileDrop(event,'${esc(off.id)}','${esc(off.id)}')"
          onclick="OfferDetailPage._openUploadDialog('${esc(off.id)}','${esc(off.id)}')"
        >
          ${ic('upload-cloud',18)} Dra hit filer eller klicka för att välja
        </div>
        <input type="file" id="att-file-${esc(off.id)}" multiple accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.svg,.tiff,.docx,.xlsx,.pptx,.doc,.xls,.txt,.csv,.zip,.dwg" style="display:none;"
          onchange="OfferDetailPage._handleFileSelect(event,'${esc(off.id)}','${esc(off.id)}')">
        <div id="att-upload-progress-${esc(off.id)}" style="margin-top:6px;font-size:11px;color:var(--mt);"></div>
        <div style="margin-top:10px;display:flex;flex-direction:column;gap:6px;">
          ${attRows}
        </div>
      </div>
    </div>`;
  },

  _handleFileDrop(ev, offerId, versionId) {
    const files = Array.from(ev.dataTransfer.files || []);
    if (files.length) this._uploadFiles(files, offerId, versionId);
  },

  _handleFileSelect(ev, offerId, versionId) {
    const files = Array.from(ev.target.files || []);
    if (files.length) this._uploadFiles(files, offerId, versionId);
    ev.target.value = '';
  },

  _openUploadDialog(offerId, versionId) {
    const inp = document.getElementById('att-file-' + offerId);
    if (inp) inp.click();
  },

  async _uploadFiles(files, offerId, versionId) {
    const EDGE_BASE = (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '').replace(/\/$/, '');
    const progressEl = document.getElementById('att-upload-progress-' + offerId);
    if (progressEl) progressEl.textContent = 'Laddar upp ' + files.length + ' fil(er)…';

    let uploaded = 0, errors = 0;
    for (const file of files) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('offerId', offerId);
      fd.append('offerVersionId', versionId || offerId);
      fd.append('uploadedBy', (state.currentUser && state.currentUser.id) || '');
      try {
        const res = await fetch(EDGE_BASE + '/functions/v1/offer-attachment-upload', {
          method: 'POST',
          headers: {
            'apikey': (typeof SUPABASE_AKEY !== 'undefined' ? SUPABASE_AKEY : ''),
            'Authorization': 'Bearer ' + (Auth.getAccessToken() || '')
          },
          body: fd
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || res.status);
        const att = Object.assign(Schema.offerAttachment(), json.attachment || {});
        if (!state.offerAttachments) state.offerAttachments = [];
        state.offerAttachments.push(att);
        uploaded++;
      } catch(e) {
        errors++;
        console.error('[uploadFiles]', file.name, e);
      }
    }
    persist();
    if (progressEl) progressEl.textContent = uploaded + ' fil(er) uppladdade' + (errors ? ', ' + errors + ' fel' : '') + '.';
    setTimeout(() => { if (progressEl) progressEl.textContent = ''; }, 4000);
    this.render({offerId});
  },

  async _viewAttachment(attachmentId) {
    const EDGE_BASE = (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '').replace(/\/$/, '');
    const att = (state.offerAttachments || []).find(a => a.id === attachmentId);
    if (!att) return;

    const previewWindow = window.open('about:blank', '_blank');

    if (!previewWindow) {
      showToast('Webbläsaren blockerade visningsfönstret', 'error');
      return;
    }

    try {
      previewWindow.document.title = 'Öppnar bilaga…';
      showToast('Öppnar bilaga…');

      const res = await fetch(EDGE_BASE + '/functions/v1/offer-attachment-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': (typeof SUPABASE_AKEY !== 'undefined' ? SUPABASE_AKEY : ''),
          'Authorization': 'Bearer ' + (Auth.getAccessToken() || '')
        },
        body: JSON.stringify({
          attachmentId,
          offerId: att.offerId,
          mode: 'view'
        })
      });

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error || res.status);
      }

      if (!json.url || typeof json.url !== 'string') {
        throw new Error('Servern returnerade ingen visningslänk');
      }

      const targetUrl = new URL(json.url, EDGE_BASE).href;
      previewWindow.location.replace(targetUrl);
    } catch (e) {
      previewWindow.close();
      showToast('Fel vid visning: ' + e.message, 'error');
    }
  },

  async _downloadAttachment(attachmentId) {
    const EDGE_BASE = (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '').replace(/\/$/, '');
    const att = (state.offerAttachments || []).find(a => a.id === attachmentId);
    if (!att) return;
    try {
      showToast('Hämtar nedladdningslänk…');
      const res = await fetch(EDGE_BASE + '/functions/v1/offer-attachment-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': (typeof SUPABASE_AKEY !== 'undefined' ? SUPABASE_AKEY : ''),
          'Authorization': 'Bearer ' + (Auth.getAccessToken() || '')
        },
        body: JSON.stringify({
          attachmentId,
          offerId: att.offerId,
          mode: 'download'
        })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.status);
      const a = document.createElement('a');
      a.href = json.url;
      a.download = json.fileName || att.originalFileName || 'bilaga';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch(e) {
      showToast('Fel vid nedladdning: ' + e.message, 'error');
    }
  },

  _editAttachment(attachmentId, offerId) {
    const att = (state.offerAttachments || []).find(a => a.id === attachmentId);
    if (!att) return;
    Modal.open({
      title: 'Redigera bilaga',
      body: `<div style="display:flex;flex-direction:column;gap:12px;">
        <div>
          <label style="font-size:12px;font-weight:500;">Visningsnamn</label>
          <input id="att-edit-name" class="form-control" style="margin-top:4px;" value="${esc(att.displayName||att.originalFileName)}">
        </div>
        <div>
          <label style="font-size:12px;font-weight:500;">Beskrivning</label>
          <textarea id="att-edit-desc" class="form-control" rows="2" style="margin-top:4px;">${esc(att.description||'')}</textarea>
        </div>
        <div style="display:flex;gap:12px;">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;">
            <input type="checkbox" id="att-edit-pub" ${att.includeInPublicView!==false?'checked':''}>
            Synlig i kundvy
          </label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;">
            <input type="checkbox" id="att-edit-pdf" ${att.includeInCombinedPdf?'checked':''}>
            Inkludera i samlad PDF
          </label>
        </div>
      </div>`,
      okLabel: 'Spara',
      ok: () => {
        att.displayName          = document.getElementById('att-edit-name').value.trim() || att.originalFileName;
        att.description          = document.getElementById('att-edit-desc').value.trim();
        att.includeInPublicView  = document.getElementById('att-edit-pub').checked;
        att.includeInCombinedPdf = document.getElementById('att-edit-pdf').checked;
        persist();
        this.render({offerId});
        showToast('Bilaga uppdaterad');
      }
    });
  },

  async _deleteAttachment(attachmentId, offerId) {
    const att = (state.offerAttachments || []).find(a => a.id === attachmentId);
    if (!att) return;
    const confirmed = await Modal.confirm(`Ta bort bilagan "${esc(att.displayName||att.originalFileName)}"?`);
    if (!confirmed) return;

    const EDGE_BASE = (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '').replace(/\/$/, '');
    try {
      const res = await fetch(EDGE_BASE + '/functions/v1/offer-attachment-upload', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'apikey': (typeof SUPABASE_AKEY !== 'undefined' ? SUPABASE_AKEY : ''),
          'Authorization': 'Bearer ' + (Auth.getAccessToken() || '')
        },
        body: JSON.stringify({ attachmentId, offerId })
      });
      if (!res.ok) {
        const j = await res.json().catch(()=>({}));
        throw new Error(j.error || res.status);
      }
    } catch(e) {
      showToast('Fel vid borttagning: ' + e.message, 'error');
      return;
    }
    att.active = false;
    persist();
    this.render({offerId});
    showToast('Bilaga borttagen');
  },

  _generateCombinedPdf(offerId) {
    const atts = (state.offerAttachments || []).filter(a =>
      a.offerId === offerId && a.active !== false && a.includeInPublicView !== false
    );
    const embeddable = atts.filter(a => a.includeInCombinedPdf &&
      ['application/pdf','image/jpeg','image/png'].includes(a.mimeType));
    const separate   = atts.filter(a => !a.includeInCombinedPdf ||
      !['application/pdf','image/jpeg','image/png'].includes(a.mimeType));

    const sepHtml = separate.length ? `<div style="margin-top:10px;font-size:11px;color:var(--mt);">
      <strong>Hämtas separat:</strong> ${separate.map(a=>esc(a.displayName||a.originalFileName)).join(', ')}
    </div>` : '';

    Modal.open({
      title: 'Samlad PDF',
      body: `<p style="font-size:12px;margin:0 0 10px;">Genererar en PDF med offertinnehållet plus ${embeddable.length} inbäddningsbara bilagor.</p>
        ${sepHtml}
        <p style="font-size:11px;color:var(--mt);margin-top:10px;">DOCX, XLSX och TXT-filer kan inte bäddas in utan konvertering och listas på en sista sida.</p>`,
      okLabel: 'Generera PDF',
      ok: () => OfferDetailPage._requestCombinedPdf(offerId)
    });
  },

  async _requestCombinedPdf(offerId) {
    const EDGE_BASE = (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '').replace(/\/$/, '');
    try {
      showToast('Genererar PDF…');
      const res = await fetch(EDGE_BASE + '/functions/v1/offer-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': (typeof SUPABASE_AKEY !== 'undefined' ? SUPABASE_AKEY : ''),
          'Authorization': 'Bearer ' + (Auth.getAccessToken() || '')
        },
        body: JSON.stringify({ offerId })
      });
      if (!res.ok) {
        const j = await res.json().catch(()=>({}));
        throw new Error(j.error || res.status);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'offert-' + offerId + '.pdf';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch(e) {
      showToast('PDF-generering misslyckades: ' + e.message, 'error');
    }
  },

  /* ── Digital offertlänk — generera token ───────────────── */
  generateDigitalLink(offerId) {
    const off = getOff(offerId);
    if (!off) return;

    const hasExisting = !!off.publicToken && !off.tokenRevokedAt;
    const confirmMsg  = hasExisting
      ? 'En aktiv länk finns redan. Generera ny länk? Den gamla ogiltigförklaras omedelbart.'
      : 'Generera digital offertlänk?';

    const _doGenerate = (days) => {
      const arr    = new Uint8Array(32);
      crypto.getRandomValues(arr);
      const token  = Array.from(arr).map(b => b.toString(16).padStart(2,'0')).join('');
      const now    = new Date().toISOString();
      const expiry = new Date(Date.now() + days * 86400000).toISOString().slice(0,10);

      /* Lås snapshot av publika fält */
      const snapshot = {
        id: off.id, title: off.title, versionNumber: off.versionNumber,
        lines: (off.lines||[]).map(function(l) {
          const p = {}; ['id','type','description','templateName','qty','unit','unitPrice','discount','total','vatRate','exVat','rutAmount','subLines','text'].forEach(function(k){ if (k in l) p[k] = l[k]; }); return p;
        }),
        extras: (off.extras||[]).map(function(l) {
          const p = {}; ['id','description','qty','unit','unitPrice'].forEach(function(k){ if (k in l) p[k] = l[k]; }); return p;
        }),
        discount: off.discount, taxType: off.taxType, rotRutAmount: off.rotRutAmount,
        date: off.date || off.createdAt?.slice(0,10) || now.slice(0,10),
        validUntil: off.validUntil, paymentTerms: off.paymentTerms,
        validityText: off.validityText, terms: off.terms, includes: off.includes,
        excludes: off.excludes, scope: off.scope, summary: off.summary,
        generalTerms: off.generalTerms, address: off.address,
        customerName: (() => { const cu = getCu(off.customerId); return cu ? (typeof CustomerService!=='undefined'?CustomerService.displayName(cu):cu.name||'') : ''; })(),
        publicAttachmentIds: (state.offerAttachments||[])
          .filter(function(a){ return a.offerId===offerId && a.active!==false && a.includeInPublicView===true; })
          .map(function(a){ return a.id; })
      };
      off.publicToken        = token;
      off.tokenCreatedAt     = now;
      off.tokenExpiresAt     = expiry + 'T23:59:59.000Z';
      off.tokenRevokedAt     = '';
      off.openCount          = 0;
      off.openedAt           = '';
      off.lockedSnapshotJSON = JSON.stringify(snapshot);
      off.updatedAt          = now;
      if (off.status === 'utkast') { off.status = 'skickad'; off.sentAt = now; }
      /* Versionslås aktiva bilagor som ännu inte är låsta */
      (state.offerAttachments || []).forEach(function(a) {
        if (a.offerId === offerId && a.active !== false && !a.lockedInVersion) {
          a.lockedInVersion = offerId + '-' + token.slice(0, 8);
        }
      });
      this._logEvt(off, 'send', 'Digital offertlänk genererad — giltig till ' + expiry + ' (' + days + ' dagar)');
      persist();
      this.render({offerId});
      showToast('Länk genererad — giltig i ' + days + ' dagar');
    };

    Modal.open({
      title: ic('link',14) + ' Digital offertlänk',
      body: `<p style="font-size:13px;margin:0 0 12px;">${esc(confirmMsg)}</p>
        <div class="fg"><label>Giltighetstid</label>
          <select id="link-days">
            <option value="14">14 dagar</option>
            <option value="30" selected>30 dagar</option>
            <option value="60">60 dagar</option>
            <option value="90">90 dagar</option>
          </select>
        </div>
        <div style="background:var(--bg);border-radius:var(--rs);padding:8px 12px;font-size:11px;color:var(--mt);margin-top:10px;">
          ${ic('info',10)} Länken kräver ingen inloggning för kunden. Dela den via e-post, SMS eller kundportalen.
        </div>`,
      buttons: [
        { label: ic('link',12) + ' Generera länk', cls: 'btn bp', onClick: () => {
          const days = parseInt(document.getElementById('link-days')?.value || '30', 10);
          Modal.close();
          _doGenerate(days);
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  revokeDigitalLink(offerId) {
    Modal.confirm('Återkalla offertlänken? Kunden kan inte längre öppna offerten via länken.', () => {
      const off = getOff(offerId);
      if (!off) return;
      off.tokenRevokedAt = new Date().toISOString();
      off.updatedAt      = new Date().toISOString();
      this._logEvt(off, 'send', 'Digital offertlänk återkallad');
      persist();
      this.render({offerId});
      showToast('Länk återkallad');
    });
  },

  extendDigitalLink(offerId) {
    Modal.open({
      title: ic('clock',14) + ' Förläng giltighetstid',
      body: `<div class="fg"><label>Ny giltighetstid (från idag)</label>
        <select id="extend-days">
          <option value="7">7 dagar</option>
          <option value="14">14 dagar</option>
          <option value="30" selected>30 dagar</option>
          <option value="60">60 dagar</option>
          <option value="90">90 dagar</option>
        </select></div>`,
      buttons: [
        { label: 'Förläng', cls: 'btn bp', onClick: () => {
          const days = parseInt(document.getElementById('extend-days')?.value || '30', 10);
          const off  = getOff(offerId);
          if (!off) return;
          const expiry = new Date(Date.now() + days * 86400000).toISOString().slice(0,10);
          off.tokenExpiresAt = expiry + 'T23:59:59.000Z';
          off.updatedAt      = new Date().toISOString();
          this._logEvt(off, 'send', 'Giltighetstid förlängd — ny utgång: ' + expiry);
          persist();
          Modal.close();
          this.render({offerId});
          showToast('Giltighetstid förlängd till ' + expiry);
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  /* ── Manuell påminnelse (punkt 125) ────────────────────────
     Öppnar modal: valfritt förläng giltighetstid + mailto-länk.
     Blockeras om offerten är godkänd, nekad eller återkallad.
  ──────────────────────────────────────────────────────────── */
  sendReminder(offerId) {
    const off = getOff(offerId);
    if (!off) return;

    /* Säkerhetsspärr — ingen påminnelse om slutgiltigt svar */
    if (['godkänd','nekad'].includes(off.status) || off.tokenRevokedAt) {
      showToast('Påminnelse kan inte skickas – offerten är ' + (off.tokenRevokedAt ? 'återkallad' : off.status) + '.', 'warning');
      return;
    }

    const host    = window.location.origin;
    const linkUrl = `${host}/public-offer.html?t=${off.publicToken}`;
    const cuName  = off.customerName || '';
    const email   = off.contactEmail || '';
    const title   = off.title        || off.id;

    const subject = encodeURIComponent(`Påminnelse: Offert "${title}"`);
    const body    = encodeURIComponent(
      `Hej${cuName ? ' ' + cuName : ''},\n\nVi vill påminna om att vi väntar på svar på offerten "${title}".\n\nDu kan öppna och svara på offerten via länken nedan:\n${linkUrl}\n\nHör gärna av dig om du har frågor.\n\nMed vänliga hälsningar`
    );
    const mailto = `mailto:${email}?subject=${subject}&body=${body}`;

    Modal.open({
      title: ic('send',14) + ' Skicka påminnelse',
      body: `<div style="display:flex;flex-direction:column;gap:12px;">
        <p style="font-size:13px;margin:0;">Kund: <strong>${esc(cuName || '–')}</strong><br>E-post: <strong>${esc(email || '–')}</strong></p>
        <div class="fg">
          <label>Förläng giltighetstid (valfritt)</label>
          <select id="remind-extend">
            <option value="">Behåll nuvarande utgångsdatum</option>
            <option value="7">Förläng 7 dagar från idag</option>
            <option value="14">Förläng 14 dagar från idag</option>
            <option value="30">Förläng 30 dagar från idag</option>
          </select>
        </div>
        <div style="font-size:12px;color:var(--mt);">
          ${ic('info',11)} Klicka "Skicka påminnelse" för att öppna din e-postklient med förifylt meddelande.
          Länken till offerten inkluderas automatiskt.
        </div>
        <div style="background:var(--bg2,var(--bg));border:1px solid var(--br);border-radius:6px;padding:8px 10px;font-size:11px;font-family:monospace;word-break:break-all;">${esc(linkUrl)}</div>
      </div>`,
      buttons: [
        { label: ic('send',12) + ' Skicka påminnelse', cls: 'btn bp', onClick: () => {
          const days = parseInt(document.getElementById('remind-extend')?.value || '0', 10);
          if (days > 0) {
            const expiry = new Date(Date.now() + days * 86400000).toISOString().slice(0,10);
            off.tokenExpiresAt = expiry + 'T23:59:59.000Z';
            off.updatedAt      = new Date().toISOString();
            this._logEvt(off, 'send', 'Giltighetstid förlängd vid påminnelse — ny utgång: ' + expiry);
          }
          this._logEvt(off, 'send', 'Manuell påminnelse skickad till ' + (email || cuName || 'kund'));
          off.updatedAt = new Date().toISOString();
          persist();
          Modal.close();
          window.open(mailto, '_blank');
          this.render({offerId});
          showToast('Påminnelse öppnad i e-postklient');
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _completeActivity(actId, offerId) {
    const act = ActivitiesService._get(actId);
    if (!act) return;
    ActivitiesService.complete(actId);
    const off = getOff(offerId);
    if (off) {
      const user = state.currentUser ? (state.currentUser.name || state.currentUser.username || 'Admin') : 'Admin';
      const note = act.note ? `: ${act.note}` : '';
      this._logEvt(off, 'followup', `Uppföljning utförd${note}`);
      off.updatedAt = new Date().toISOString();
      persist();
    }
    Sidebar.updateBadges();
    this.render({offerId});
    showToast('Uppföljning markerad klar');
  },

  _rescheduleActivity(actId, offerId) {
    const act = ActivitiesService._get(actId);
    if (!act) return;
    const oldDate = act.dueDate;
    Modal.open({
      title: `${ic('calendar',14)} Flytta uppföljning`,
      body: `<div style="display:flex;gap:8px;">
        <div class="fg" style="flex:1;"><label>Nytt datum</label><input type="date" id="rs2-date" value="${act.dueDate||tdy()}"></div>
        <div class="fg" style="width:90px;"><label>Tid</label><input type="time" id="rs2-time" value="${act.dueTime||'09:00'}"></div>
      </div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => {
          const d = document.getElementById('rs2-date')?.value;
          const t = document.getElementById('rs2-time')?.value;
          if (!d) { showToast('Välj ett datum'); return; }
          ActivitiesService.reschedule(actId, d, t);
          const off = getOff(offerId);
          if (off) {
            const user    = state.currentUser ? (state.currentUser.name || state.currentUser.username || 'Admin') : 'Admin';
            const fromStr = oldDate ? new Date(oldDate + 'T12:00:00').toLocaleDateString('sv-SE', {day:'numeric',month:'short'}) : '—';
            const toStr   = new Date(d + 'T12:00:00').toLocaleDateString('sv-SE', {day:'numeric',month:'short'});
            this._logEvt(off, 'reminder', `Uppföljning flyttad från ${fromStr} till ${toStr}`);
            off.updatedAt = new Date().toISOString();
            persist();
          }
          Modal.close();
          Sidebar.updateBadges();
          this.render({offerId});
          showToast('Uppföljning flyttad');
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  }
};

/* ── Fastigheter ──────────────────────── */
const PropertiesPage = {
  _q: '',
  _filter: 'aktiva',

  render() {
    const el = document.getElementById('pg-objects-content');
    if (!el) return;
    const allProps = state.properties || [];
    const aktiva    = allProps.filter(p => p.status !== 'inaktiv');
    const arkiverade = allProps.filter(p => p.status === 'inaktiv');
    let props = this._filter === 'arkiverade' ? arkiverade : aktiva;
    if (this._q) {
      const q = this._q.toLowerCase();
      props = props.filter(p =>
        p.name.toLowerCase().includes(q) || (p.address||'').toLowerCase().includes(q) || (p.city||'').toLowerCase().includes(q)
      );
    }
    SelectionModel.init('property');
    const visibleIds = props.map(p => p.id);
    el.innerHTML = `
      <div class="ao-toolbar" style="margin-bottom:6px;">
        <div class="swrap">
          <span class="sico">${ic('search',16)}</span>
          <input type="search" placeholder="Sök fastighet…" value="${this._q}"
            oninput="PropertiesPage._q=this.value;PropertiesPage.render()">
        </div>
        ${Auth.can('admin') ? `<button class="btn bs bsm" onclick="Router.showPage('pg-import-wizard',{type:'property'})">${ic('upload',14)} Importera</button>` : ''}
        <button class="btn bs bsm" onclick="ImportExportService.showExportMenu('property',this)">${ic('download',14)} Exportera</button>
        <button class="btn bp bsm" onclick="PropertiesPage.openCreate()">${ic('plus',14)} Ny fastighet</button>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <div class="ftabs" style="margin-bottom:0;flex:1;">
          <button class="ft ${this._filter==='aktiva'?'on':''}" onclick="PropertiesPage._filter='aktiva';PropertiesPage.render()">Aktiva (${aktiva.length})</button>
          <button class="ft ${this._filter==='arkiverade'?'on':''}" onclick="PropertiesPage._filter='arkiverade';PropertiesPage.render()">Arkiverade (${arkiverade.length})</button>
        </div>
        ${props.length > 0 ? SelectionModel.selectAllHtml(visibleIds) : ''}
      </div>` +
      (props.length === 0
        ? `<div class="empty">${ic('building-2',36)}<h3>Inga fastigheter</h3></div>`
        : props.map(p => {
            const cu = getCu(p.customerId);
            const cuName = cu ? CustomerService.displayName(cu) : '—';
            const aos = (state.workOrders||[]).filter(a => a.propertyId === p.id).length;
            return `
              <div class="list-item" onclick="PropertiesPage.openDetail('${p.id}')">
                <div class="item-row">
                  ${SelectionModel.checkboxHtml(p.id)}
                  <div style="flex:1;min-width:0;">
                    <div class="item-title">${p.name}</div>
                    <div class="item-sub">${[p.address, p.city].filter(Boolean).join(', ')}${cuName!=='—'?' · '+cuName:''}</div>
                    ${p.type||p.area ? `<div style="font-size:11px;color:var(--mt);margin-top:2px;">${[p.type,p.area?p.area+' m²':null].filter(Boolean).join(' · ')}</div>` : ''}
                  </div>
                  ${aos > 0 ? `<span class="bdg bdg-sky" style="align-self:flex-start;">${aos} AO</span>` : ''}
                </div>
              </div>`;
          }).join(''));
  },

  _formHtml(p) {
    const v = (k, d='') => p ? (p[k]!=null?p[k]:d) : d;
    return `
      <div class="fg"><label>Namn / beteckning <span style="color:var(--rd)">*</span></label>
        <input id="prop-name" value="${v('name')}" placeholder="T.ex. Solvägen 1, Fastighet A…"></div>
      <div class="fg"><label>Ägare / kund</label>
        <select id="prop-cu">
          <option value="">— Välj kund —</option>
          ${(state.customers||[]).map(c=>`<option value="${c.id}" ${v('customerId')===c.id?'selected':''}>${CustomerService.displayName(c)}</option>`).join('')}
        </select></div>
      <div class="fg"><label>Gatuadress</label>
        <input id="prop-addr" value="${v('address')}" placeholder="Börja skriva adress…"
          autocomplete="off"
          oninput="AddressService.handleInput(this)"
          onblur="setTimeout(()=>AddressService.hideSuggestions(),150)"
          data-addr-zip="prop-zip" data-addr-city="prop-city"></div>
      <div class="g2">
        <div class="fg"><label>Postnummer</label><input id="prop-zip" value="${v('zip')}" placeholder="123 45"></div>
        <div class="fg"><label>Stad</label><input id="prop-city" value="${v('city')}" placeholder="Stockholm"></div>
      </div>
      <div class="g2">
        <div class="fg"><label>Typ</label>
          <select id="prop-type">
            ${['Flerbostadshus','Kontorsfastighet','Industrifastighet','BRF','Villa','Butiksfastighet','Lager','Övrigt'].map(t=>`<option ${v('type')===t?'selected':''}>${t}</option>`).join('')}
          </select></div>
        <div class="fg"><label>Yta (m²)</label>
          <input type="number" id="prop-area" value="${v('area',0)}" min="0" placeholder="0"></div>
      </div>
      <div class="fg"><label>Antal våningar</label>
        <input type="number" id="prop-floors" value="${v('floors',1)}" min="1" max="50"></div>
      <div class="fg"><label>Portkod / åtkomst</label>
        <input id="prop-access" value="${v('accessCode')}" placeholder="T.ex. 1234#"></div>
      <div class="fg"><label>Anteckning</label>
        <textarea id="prop-note" rows="2" placeholder="Intern anteckning…">${v('note')}</textarea></div>`;
  },

  openCreate() {
    Modal.open({
      title: 'Ny fastighet',
      wide: true,
      body: this._formHtml(null),
      buttons: [
        { label: 'Skapa', cls: 'btn bp', onClick: () => PropertiesPage._save(null) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('prop-name')?.focus(), 80);
  },

  openDetail(propId) {
    Router.showPage('pg-obj-detail', { propId });
  },

  openEdit(propId) {
    const p = (state.properties||[]).find(x=>x.id===propId);
    if (!p) return;
    Modal.open({
      title: `Redigera ${p.name}`,
      wide: true,
      body: this._formHtml(p),
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => PropertiesPage._save(propId) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _save(propId) {
    const name = document.getElementById('prop-name')?.value.trim();
    if (!name) { showToast('Namn krävs'); return; }
    const data = {
      name,
      customerId: document.getElementById('prop-cu')?.value || '',
      address:    document.getElementById('prop-addr')?.value.trim() || '',
      zip:        document.getElementById('prop-zip')?.value.trim() || '',
      city:       document.getElementById('prop-city')?.value.trim() || '',
      type:       document.getElementById('prop-type')?.value || '',
      area:       parseFloat(document.getElementById('prop-area')?.value) || 0,
      floors:     parseInt(document.getElementById('prop-floors')?.value) || 1,
      accessCode: document.getElementById('prop-access')?.value.trim() || '',
      note:       document.getElementById('prop-note')?.value.trim() || '',
      updatedAt:  new Date().toISOString()
    };
    if (!propId) {
      state.properties = state.properties || [];
      state.properties.push({ ...data, id: newId(state.properties,'OBJ'), createdAt: new Date().toISOString() });
      showToast(`${name} skapad`);
    } else {
      const idx = (state.properties||[]).findIndex(x=>x.id===propId);
      if (idx < 0) return;
      state.properties[idx] = { ...state.properties[idx], ...data };
      showToast('Fastighet uppdaterad');
    }
    persist(); Modal.close(); this.render();
  }
};

/* ── Artiklar ─────────────────────────── */
const ArticlesPage = {
  _filter: 'alla',
  _q: '',

  render() {
    const el = document.getElementById('pg-articles-content');
    if (!el) return;
    const cats = ['alla','kemikalier','material','forbruk','arbete','kostnad'];
    const catLabels = { alla:'Alla', kemikalier:'Kemikalier', material:'Byggmaterial', forbruk:'Förbrukning', arbete:'Arbete', kostnad:'Kostnader' };
    let arts = state.articles || [];
    if (this._filter !== 'alla') arts = arts.filter(a => a.category === this._filter);
    if (this._q) {
      const q = this._q.toLowerCase();
      arts = arts.filter(a => a.name.toLowerCase().includes(q) || (a.articleNumber||'').includes(q));
    }
    SelectionModel.init('article');
    const artVisibleIds = arts.map(a => a.id);
    el.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px;">
        <div class="swrap" style="flex:1;">
          <span class="sico">${ic('search',16)}</span>
          <input type="search" placeholder="Sök artikel, artnr…" value="${this._q}"
            oninput="ArticlesPage._q=this.value;ArticlesPage.render()">
        </div>
        ${Auth.can('admin') ? `<button class="btn bs bsm" onclick="Router.showPage('pg-import-wizard',{type:'article'})">${ic('upload',14)} Importera</button>` : ''}
        <button class="btn bs bsm" onclick="ImportExportService.showExportMenu('article',this)">${ic('download',14)} Exportera</button>
        <button class="btn bp bsm" onclick="ArticlesPage.openCreate()">${ic('plus',14)} Ny artikel</button>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <div class="ftabs" style="margin-bottom:0;flex:1;">
          ${cats.map(c=>`<button class="ft ${this._filter===c?'on':''}" onclick="ArticlesPage._filter='${c}';ArticlesPage.render()">${catLabels[c]}</button>`).join('')}
        </div>
        ${arts.length > 0 ? SelectionModel.selectAllHtml(artVisibleIds) : ''}
      </div>
      ${arts.length === 0
        ? `<div class="empty">${ic('package',32)}<h3>Inga artiklar</h3></div>`
        : arts.map(a => {
            const margin = a.buyPrice > 0 && a.sellPrice > 0
              ? Math.round((1 - a.buyPrice / a.sellPrice) * 100)
              : null;
            return `
          <div class="list-item" onclick="ArticlesPage.openEdit('${a.id}')">
            <div class="item-row">
              ${SelectionModel.checkboxHtml(a.id)}
              <div style="flex:1;min-width:0;">
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
                  ${a.active===false?`<span style="width:6px;height:6px;border-radius:50%;background:var(--mt);flex-shrink:0;display:inline-block;"></span>`:''}
                  <span class="item-title" style="margin:0;">${a.articleNumber ? `<span style="font-size:11px;color:var(--mt);font-weight:600;">${a.articleNumber} – </span>` : ''}${a.name}</span>
                </div>
                <div class="item-sub">
                  ${fmt(a.sellPrice)} kr/${a.unit} inkl ${a.vatRate||25}% moms
                  ${margin !== null ? `· <span style="color:${margin>=30?'var(--gr)':margin>=10?'var(--or)':'var(--rd)'};">${margin}% marginal</span>` : ''}
                </div>
              </div>
              <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;">
                <span class="bdg ${catLabels[a.category]?'bdg-sky':'bdg-grey'}" style="font-size:9px;">${catLabels[a.category]||a.category||'—'}</span>
                ${a.active===false?`<span class="bdg bdg-grey" style="font-size:9px;">Inaktiv</span>`:''}
              </div>
            </div>
          </div>`;}).join('')}`;
  },

  _formHtml(a) {
    const catLabels = { kemikalier:'Kemikalier', material:'Byggmaterial', forbruk:'Förbrukning', arbete:'Arbete', kostnad:'Kostnader' };
    return `
      <div class="g2">
        <div class="fg"><label>Artikelnummer</label>
          <input id="art-num" value="${a?a.articleNumber||'':''}" placeholder="T.ex. 1001"></div>
        <div class="fg"><label>Kategori</label>
          <select id="art-cat">
            ${Object.entries(catLabels).map(([v,l])=>`<option value="${v}" ${a&&a.category===v?'selected':''}>${l}</option>`).join('')}
          </select></div>
      </div>
      <div class="fg"><label>Benämning <span style="color:var(--rd)">*</span></label>
        <input id="art-name" value="${a?a.name||'':''}" placeholder="T.ex. Fogmassa Sikaflex 291i"></div>
      <div class="g2">
        <div class="fg"><label>Enhet</label>
          <select id="art-unit">${unitsHtml(a?a.unit:'st')}</select></div>
        <div class="fg"><label>Momssats</label>
          <select id="art-vat">
            ${[0,6,12,25].map(r=>`<option value="${r}" ${a&&a.vatRate===r?'selected':r===25?'selected':''} >${r}%</option>`).join('')}
          </select></div>
      </div>
      <div class="g2">
        <div class="fg"><label>Inköpspris (kr/enhet)</label>
          <input type="number" id="art-buy" value="${a?a.buyPrice||0:0}" min="0" placeholder="0"></div>
        <div class="fg"><label>Försäljningspris ex moms (kr/enhet)</label>
          <input type="number" id="art-sell" value="${a?a.sellPrice||0:0}" min="0" placeholder="0"></div>
      </div>`;
  },

  openCreate() {
    if (!Auth.require('article_manage')) return;
    Modal.open({
      title: 'Ny artikel',
      body: this._formHtml(null),
      buttons: [
        { label: 'Skapa', cls: 'btn bp', onClick: () => ArticlesPage._save(null) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('art-name')?.focus(), 80);
  },

  openEdit(artId) {
    const a = (state.articles||[]).find(x=>x.id===artId);
    if (!a) return;
    Modal.open({
      title: a.name,
      wide: true,
      body: this._formHtml(a),
      buttons: [
        { label: a.active!==false ? `${ic('eye-off',13)} Inaktivera` : `${ic('eye',13)} Aktivera`,
          cls: 'btn bw', onClick: () => ArticlesPage._toggleActive(artId) },
        { label: 'Spara', cls: 'btn bp', onClick: () => ArticlesPage._save(artId) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _save(artId) {
    const name = document.getElementById('art-name')?.value.trim();
    if (!name) { showToast('Benämning krävs'); return; }
    const data = {
      articleNumber: document.getElementById('art-num')?.value.trim() || '',
      name,
      category: document.getElementById('art-cat')?.value || 'material',
      unit:     document.getElementById('art-unit')?.value || 'st',
      vatRate:  parseInt(document.getElementById('art-vat')?.value) || 25,
      buyPrice: parseFloat(document.getElementById('art-buy')?.value) || 0,
      sellPrice:parseFloat(document.getElementById('art-sell')?.value) || 0,
      updatedAt: new Date().toISOString()
    };
    if (!artId) {
      state.articles.push({ ...data, id: newId(state.articles,'ART'), active: true, createdAt: new Date().toISOString() });
      showToast(`${name} skapad`);
    } else {
      const idx = (state.articles||[]).findIndex(a=>a.id===artId);
      if (idx < 0) return;
      state.articles[idx] = { ...state.articles[idx], ...data };
      showToast('Artikel uppdaterad');
    }
    persist(); Modal.close(); this.render();
  },

  _toggleActive(artId) {
    const idx = (state.articles||[]).findIndex(a=>a.id===artId);
    if (idx < 0) return;
    state.articles[idx] = { ...state.articles[idx], active: !state.articles[idx].active, updatedAt: new Date().toISOString() };
    persist(); Modal.close();
    showToast(state.articles[idx].active ? 'Aktiverad' : 'Inaktiverad');
    this.render();
  }
};

/* ── Prisgrupper ──────────────────────── */
const PriceGroupsPage = {
  _tab: 'grupper',

  render() {
    const el = document.getElementById('pg-pricegroups-content');
    if (!el) return;
    const tab = this._tab || 'grupper';
    el.innerHTML = `
      <div class="ftabs" style="margin-bottom:8px;">
        <button class="ft ${tab==='grupper'?'on':''}" onclick="PriceGroupsPage._tab='grupper';PriceGroupsPage.render()">Prisgrupper</button>
        <button class="ft ${tab==='profiler'?'on':''}" onclick="PriceGroupsPage._tab='profiler';PriceGroupsPage.render()">Prisprofiler</button>
      </div>
      <div id="pg-pricegroups-tab-body"></div>`;
    if (tab === 'grupper') this._renderGrupper();
    else this._renderProfiler();
  },

  _renderGrupper() {
    const el = document.getElementById('pg-pricegroups-tab-body');
    if (!el) return;
    const pgs = state.priceGroups || [];
    el.innerHTML =
      `<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
         <h3 style="flex:1;font-size:14px;font-weight:700;">Prisgrupper</h3>
         ${Auth.can('admin') ? `<button class="btn bs bsm" onclick="Router.showPage('pg-import-wizard',{type:'priceGroup'})">${ic('upload',14)} Importera</button>` : ''}
         <button class="btn bs bsm" onclick="ImportExportService.showExportMenu('priceGroup',this)">${ic('download',14)} Exportera</button>
         <button class="btn bp bsm" onclick="PriceGroupsPage.openCreate()">${ic('plus',14)} Ny prisgrupp</button>
       </div>` +
      (pgs.length === 0
        ? `<div class="empty">${ic('dollar-sign',36)}<h3>Inga prisgrupper</h3></div>`
        : pgs.map(pg => `
          <div class="list-item" onclick="PriceGroupsPage.openEdit('${pg.id}')">
            <div class="item-row">
              <div style="flex:1;min-width:0;">
                <div class="item-title">${pg.name}</div>
                ${pg.description ? `<div class="item-sub">${pg.description}</div>` : ''}
              </div>
              <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;">
                <span style="font-size:14px;font-weight:800;color:var(--navy);">${fmt(pg.hourRate)} <span style="font-size:10px;font-weight:500;color:var(--mt);">kr/tim</span></span>
                <span class="bdg ${pg.active ? 'bdg-green' : 'bdg-grey'}" style="font-size:9px;">${pg.active ? 'Aktiv' : 'Inaktiv'}</span>
              </div>
            </div>
          </div>`).join(''));
  },

  _renderProfiler() {
    const el = document.getElementById('pg-pricegroups-tab-body');
    if (!el) return;
    const pps = (state.priceProfiles || []).slice().sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0));
    const pgs = state.priceGroups || [];
    const pgName = id => { const g = pgs.find(x=>x.id===id); return g ? g.name : (id||'—'); };
    el.innerHTML =
      `<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
         <h3 style="flex:1;font-size:14px;font-weight:700;">Prisprofiler</h3>
         <button class="btn bp bsm" onclick="PriceGroupsPage.openCreateProfile()">${ic('plus',14)} Ny profil</button>
       </div>` +
      (pps.length === 0
        ? `<div class="empty">${ic('users',36)}<h3>Inga prisprofiler</h3></div>`
        : pps.map(pp => `
          <div class="list-item">
            <div class="item-row">
              <div style="flex:1;min-width:0;">
                <div class="item-title" style="font-weight:700;">${esc(pp.name)}</div>
                <div class="item-sub">${pgName(pp.defaultPriceGroupId)}${pp.notes ? ' · ' + esc(pp.notes) : ''}</div>
              </div>
              <button class="btn bs bxs" onclick="PriceGroupsPage.openEditProfile('${pp.id}')">${ic('pencil',13)}</button>
            </div>
          </div>`).join(''));
  },

  _formHtml(pg) {
    return `
      <div class="fg"><label>Namn <span style="color:var(--rd)">*</span></label>
        <input id="pg-name" value="${pg?pg.name||'':''}" placeholder="T.ex. Standard, Jour, Övertid"></div>
      <div class="fg"><label>Timpris ex moms (kr/tim)</label>
        <input type="number" id="pg-rate" value="${pg?pg.hourRate||0:0}" min="0"></div>
      <div class="fg"><label>Beskrivning</label>
        <input id="pg-desc" value="${pg?pg.description||'':''}" placeholder="Valfri beskrivning"></div>`;
  },

  _profileFormHtml(pp) {
    const pgs = state.priceGroups || [];
    return `
      <div class="fg"><label>Namn <span style="color:var(--rd)">*</span></label>
        <input id="pp-name" value="${pp?esc(pp.name||''):''}" placeholder="T.ex. BRF, Privatkund"></div>
      <div class="fg"><label>Standard prisgrupp</label>
        <select id="pp-pg">
          <option value="">— Ingen —</option>
          ${pgs.map(g=>`<option value="${g.id}" ${pp&&pp.defaultPriceGroupId===g.id?'selected':''}>${esc(g.name)} (${fmt(g.hourRate)} kr/tim)</option>`).join('')}
        </select></div>
      <div class="fg"><label>Anteckningar</label>
        <textarea id="pp-notes" rows="2">${pp?esc(pp.notes||''):''}</textarea></div>`;
  },

  openCreate() {
    if (!Auth.require('article_manage')) return;
    Modal.open({
      title: 'Ny prisgrupp',
      body: this._formHtml(null),
      buttons: [
        { label: 'Skapa', cls: 'btn bp', onClick: () => PriceGroupsPage._save(null) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('pg-name')?.focus(), 80);
  },

  openEdit(pgId) {
    const pg = (state.priceGroups||[]).find(x=>x.id===pgId);
    if (!pg) return;
    Modal.open({
      title: pg.name,
      body: this._formHtml(pg),
      buttons: [
        { label: pg.active ? `${ic('eye-off',13)} Inaktivera` : `${ic('eye',13)} Aktivera`, cls: 'btn bw',
          onClick: () => { const idx=(state.priceGroups||[]).findIndex(x=>x.id===pgId); if(idx<0)return; state.priceGroups[idx].active=!state.priceGroups[idx].active; persist();Modal.close();PriceGroupsPage.render();showToast(state.priceGroups[idx].active?'Aktiverad':'Inaktiverad'); }},
        { label: 'Spara', cls: 'btn bp', onClick: () => PriceGroupsPage._save(pgId) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  openCreateProfile() {
    if (!Auth.require('article_manage')) return;
    Modal.open({
      title: 'Ny prisprofil',
      body: this._profileFormHtml(null),
      buttons: [
        { label: 'Skapa', cls: 'btn bp', onClick: () => PriceGroupsPage._saveProfile(null) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('pp-name')?.focus(), 80);
  },

  openEditProfile(ppId) {
    const pp = (state.priceProfiles||[]).find(x=>x.id===ppId);
    if (!pp) return;
    Modal.open({
      title: pp.name,
      body: this._profileFormHtml(pp),
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => PriceGroupsPage._saveProfile(ppId) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _save(pgId) {
    const name = document.getElementById('pg-name')?.value.trim();
    if (!name) { showToast('Namn krävs'); return; }
    const data = {
      name,
      hourRate: parseFloat(document.getElementById('pg-rate')?.value) || 0,
      description: document.getElementById('pg-desc')?.value.trim() || '',
      updatedAt: new Date().toISOString()
    };
    if (!pgId) {
      state.priceGroups = state.priceGroups || [];
      state.priceGroups.push({ ...data, id: newId(state.priceGroups,'PG'), active: true, createdAt: new Date().toISOString() });
      showToast(`${name} skapad`);
    } else {
      const idx = (state.priceGroups||[]).findIndex(x=>x.id===pgId);
      if (idx < 0) return;
      state.priceGroups[idx] = { ...state.priceGroups[idx], ...data };
      showToast('Prisgrupp uppdaterad');
    }
    persist(); Modal.close(); this.render();
  },

  _saveProfile(ppId) {
    const name = document.getElementById('pp-name')?.value.trim();
    if (!name) { showToast('Namn krävs'); return; }
    const data = {
      name,
      defaultPriceGroupId: document.getElementById('pp-pg')?.value || '',
      notes: document.getElementById('pp-notes')?.value.trim() || '',
      updatedAt: new Date().toISOString()
    };
    state.priceProfiles = state.priceProfiles || [];
    if (!ppId) {
      const maxSort = state.priceProfiles.reduce((m,p)=>Math.max(m,p.sortOrder||0),0);
      state.priceProfiles.push({ ...data, id: 'PP-' + String(state.priceProfiles.length+1).padStart(3,'0'), active: true, sortOrder: maxSort+10, createdAt: new Date().toISOString() });
      showToast(`${name} skapad`);
    } else {
      const idx = state.priceProfiles.findIndex(x=>x.id===ppId);
      if (idx < 0) return;
      state.priceProfiles[idx] = { ...state.priceProfiles[idx], ...data };
      showToast('Prisprofil uppdaterad');
    }
    persist(); Modal.close(); this.render();
  }
};

/* ── Personal ─────────────────────────── */
const StaffPage = {
  _filter: 'aktiva',

  render() {
    const el = document.getElementById('pg-staff-content');
    if (!el) return;
    SelectionModel.init('staff');
    const all     = state.staff || [];
    const aktiva  = all.filter(s => s.active);
    const inaktiva = all.filter(s => !s.active);
    const list    = this._filter === 'aktiva' ? aktiva : inaktiva;
    const visibleIds = list.map(s => s.id);
    const roleColor = (rid) => ({ admin:'bdg-red', chef:'bdg-orange', personal:'bdg-blue' }[rid] || 'bdg-grey');
    const roleLabel = (rid) => { const r = (state.roles||[]).find(x=>x.id===rid); return r ? r.label : (rid || '—'); };

    el.innerHTML =
      `<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
         <div class="ftabs" style="flex:1;margin-bottom:0;">
           <button class="ft ${this._filter==='aktiva'?'on':''}" onclick="StaffPage._filter='aktiva';StaffPage.render()">Aktiva (${aktiva.length})</button>
           <button class="ft ${this._filter==='inaktiva'?'on':''}" onclick="StaffPage._filter='inaktiva';StaffPage.render()">Inaktiva (${inaktiva.length})</button>
         </div>
         ${SelectionModel.selectAllHtml(visibleIds)}
         ${Auth.can('admin') ? `<button class="btn bs bsm" onclick="Router.showPage('pg-import-wizard',{type:'staff'})">${ic('upload',14)} Importera</button>` : ''}
         <button class="btn bs bsm" onclick="ImportExportService.showExportMenu('staff',this)">${ic('download',14)} Exportera</button>
         <button class="btn bp bsm" onclick="StaffPage.openCreate()">${ic('plus',14)} Ny personal</button>
       </div>` +
      (list.length === 0
        ? `<div class="empty">${ic('users',32)}<h3>Inga ${this._filter} medarbetare</h3></div>`
        : list.map(s => `
          <div class="list-item" onclick="StaffPage.openEdit('${s.id}')">
            <div class="item-row">
              ${SelectionModel.checkboxHtml(s.id)}
              <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">
                <div style="width:38px;height:38px;border-radius:50%;background:var(--acc);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:var(--acc-text);flex-shrink:0;">${(s.firstName||'?').charAt(0)}${(s.lastName||'').charAt(0)}</div>
                <div>
                  <div class="item-title">${s.firstName} ${s.lastName}</div>
                  <div class="item-sub">${s.title||'—'}${s.phone?' · '+s.phone:''}</div>
                </div>
              </div>
              <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
                <span class="bdg ${roleColor(s.role)}">${roleLabel(s.role)}</span>
                <button class="btn bxs ${s.active?'bw':'bsu'}" style="font-size:10px;padding:3px 8px;margin-top:2px;"
                  onclick="event.stopPropagation();StaffPage._toggleActive('${s.id}')">
                  ${s.active?ic('user-x',11)+' Inaktivera':ic('user-check',11)+' Aktivera'}
                </button>
              </div>
            </div>
          </div>`).join('')
      );
  },

  _formHtml(s) {
    const allRoles = state.roles || [];
    const activeRoles = allRoles.filter(r => r.active !== false);
    const fallbackRoles = [
      { id:'personal', label:'Tekniker / Personal', description:'', active:true },
      { id:'chef',     label:'Chef / Projektledare', description:'', active:true },
      { id:'admin',    label:'Admin', description:'', active:true }
    ];
    const displayRoles = activeRoles.length ? activeRoles : fallbackRoles;
    const activeTitles = (state.titles||[]).filter(t => t.active !== false);
    return `
      <div class="g2">
        <div class="fg"><label>Förnamn <span style="color:var(--rd)">*</span></label>
          <input id="sf-first" value="${s?s.firstName:''}" placeholder="Förnamn" autocomplete="off"></div>
        <div class="fg"><label>Efternamn <span style="color:var(--rd)">*</span></label>
          <input id="sf-last" value="${s?s.lastName:''}" placeholder="Efternamn" autocomplete="off"></div>
      </div>
      <div class="fg"><label>Titel / yrkesroll</label>
        ${activeTitles.length > 0 ? `
          <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
            <div id="sf-title-display" style="flex:1;">
              ${s && s.title
                ? `<span class="chip on">${s.title}</span>`
                : '<span style="font-size:12px;color:var(--mt);">Ingen titel vald</span>'}
            </div>
            <button type="button" class="btn bs bsm" onclick="StaffPage._openTitlePicker()">
              ${ic('list',13)} Välj titel
            </button>
          </div>
          <input type="hidden" id="sf-title" value="${s?s.title||'':''}">
          ${s && s.title && !activeTitles.some(t => t.name === s.title)
            ? `<div class="nbox" style="margin-top:4px;font-size:11px;">⚠ "${s.title}" finns inte bland aktiva titlar</div>`
            : ''}` :
          `<div class="nbox" style="font-size:12px;">Inga aktiva titlar. <button type="button" class="btn bghost bxs" style="margin-left:4px;" onclick="Modal.close();Router.showPage('pg-admin')">Gå till Admin ${ic('arrow-right',10)}</button></div>
          <input type="hidden" id="sf-title" value="${s?s.title||'':''}">`
        }</div>
      <div class="g2">
        <div class="fg"><label>Telefon</label>
          <input id="sf-phone" value="${s?s.phone||'':''}" placeholder="070-XXX XX XX" type="tel"></div>
        <div class="fg"><label>E-post</label>
          <input id="sf-email" value="${s?s.email||'':''}" placeholder="namn@vift.se" type="email"></div>
      </div>
      <div style="border-top:1px solid var(--br);margin:4px 0;"></div>
      <div class="fg"><label>Användarnamn <span style="color:var(--rd)">*</span></label>
        <input id="sf-uname" value="${s?s.username||'':''}" placeholder="användarnamn" autocomplete="off"></div>
      <div class="fg"><label>Roll / behörighet</label>
        <input type="hidden" id="sf-role" value="${s?s.role||'personal':'personal'}">
        <div style="display:flex;flex-direction:column;gap:5px;margin-top:4px;">
          ${displayRoles.map(r => {
            const isSel = s ? s.role === r.id : r.id === 'personal';
            return `<div onclick="StaffPage._selectRole('${r.id}')" id="sf-role-opt-${r.id}"
              style="display:flex;align-items:center;gap:10px;padding:9px 12px;border:1.5px solid ${isSel?'var(--sky)':'var(--br)'};border-radius:var(--rs);cursor:pointer;transition:border-color .1s;">
              <div id="sf-role-dot-${r.id}" style="width:16px;height:16px;border-radius:50%;border:2px solid ${isSel?'var(--navy)':'var(--br)'};background:${isSel?'var(--navy)':'transparent'};flex-shrink:0;transition:all .1s;"></div>
              <div style="flex:1;min-width:0;">
                <div style="font-size:13px;font-weight:700;">${r.label}</div>
                ${r.description?`<div style="font-size:11px;color:var(--mt);">${r.description}</div>`:''}
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
      <div class="nbox" style="font-size:11px;color:var(--mt);">
        ${ic('lock',11)} Inloggning hanteras via Supabase Auth. ${s ? 'Lösenord ändras i Supabase Dashboard.' : 'Skapa inloggningskonto i Supabase Dashboard efter att personposten sparats.'}
      </div>`;
  },

  _openTitlePicker() {
    const titles = (state.titles || []).filter(t => t.active !== false);
    if (titles.length === 0) { showToast('Inga aktiva titlar. Gå till Admin → Titlar.'); return; }
    Modal.open({
      title: 'Välj titel',
      body: `
        <div class="fg" style="margin-bottom:8px;">
          <input id="tp-search" placeholder="Sök titel…" autocomplete="off"
            oninput="document.getElementById('tp-list').innerHTML=StaffPage._titlePickerItems(this.value)">
        </div>
        <div id="tp-list" style="max-height:280px;overflow-y:auto;">
          ${this._titlePickerItems('')}
        </div>`,
      buttons: [
        { label: 'Rensa val', cls: 'btn bw', onClick: () => StaffPage._selectTitleFromPicker('') },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('tp-search')?.focus(), 80);
  },

  _titlePickerItems(q) {
    const titles = (state.titles || []).filter(t => t.active !== false);
    const cur = document.getElementById('sf-title')?.value || '';
    const filtered = q ? titles.filter(t => t.name.toLowerCase().includes(q.toLowerCase())) : titles;
    if (!filtered.length) return '<p style="font-size:12px;color:var(--mt);padding:8px 0;">Inga aktiva titlar matchar</p>';
    return filtered.map(t => {
      const isSel = cur === t.name;
      const usageCount = (state.staff||[]).filter(s => s.title === t.name).length;
      return `<div class="crow" onclick="StaffPage._selectTitleFromPicker('${t.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'")}')"
        style="${isSel?'background:var(--navy10,#eef2ff);':''};cursor:pointer;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;">${t.name}</div>
          ${t.description ? `<div style="font-size:11px;color:var(--mt);">${t.description}</div>` : ''}
          ${usageCount > 0 ? `<div style="font-size:10px;color:var(--sky);">${usageCount} person${usageCount===1?'':'er'}</div>` : ''}
        </div>
        ${isSel ? `<span style="color:var(--grn);">${ic('check-circle',16)}</span>` : ''}
      </div>`;
    }).join('');
  },

  _selectTitleFromPicker(title) {
    const inp = document.getElementById('sf-title');
    if (inp) inp.value = title;
    const display = document.getElementById('sf-title-display');
    if (display) {
      display.innerHTML = title
        ? `<span class="chip on">${title}</span>`
        : '<span style="font-size:12px;color:var(--mt);">Ingen titel vald</span>';
    }
    Modal.close();
  },

  _selectRole(roleId) {
    document.getElementById('sf-role').value = roleId;
    const roles = (state.roles && state.roles.length
      ? state.roles.filter(r => r.active !== false)
      : [{ id:'personal' }, { id:'chef' }, { id:'admin' }]);
    roles.forEach(r => {
      const opt = document.getElementById('sf-role-opt-' + r.id);
      const dot = document.getElementById('sf-role-dot-' + r.id);
      const isSel = r.id === roleId;
      if (opt) opt.style.borderColor = isSel ? 'var(--sky)' : 'var(--br)';
      if (dot) {
        dot.style.borderColor = isSel ? 'var(--navy)' : 'var(--br)';
        dot.style.background  = isSel ? 'var(--navy)' : 'transparent';
      }
    });
  },

  openCreate() {
    if (!Auth.require('staff_manage')) return;
    Modal.open({
      title: 'Ny personal',
      body: this._formHtml(null),
      buttons: [
        { label: 'Skapa', cls: 'btn bp', onClick: () => StaffPage._save(null) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => { document.getElementById('sf-first')?.focus(); }, 80);
  },

  openEdit(staffId) {
    if (!Auth.require('staff_manage')) return;
    const s = (state.staff||[]).find(x => x.id === staffId);
    if (!s) return;
    Modal.open({
      title: `${s.firstName} ${s.lastName}`,
      wide: true,
      body: this._formHtml(s),
      buttons: [
        { label: s.active ? `${ic('user-x',13)} Inaktivera` : `${ic('user-check',13)} Aktivera`,
          cls: s.active ? 'btn bw' : 'btn bsu',
          onClick: () => StaffPage._toggleActive(staffId) },
        { label: 'Spara', cls: 'btn bp', onClick: () => StaffPage._save(staffId) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => { document.getElementById('sf-first')?.focus(); }, 80);
  },

  _save(staffId) {
    const first = document.getElementById('sf-first')?.value.trim();
    const last  = document.getElementById('sf-last')?.value.trim();
    const uname = document.getElementById('sf-uname')?.value.trim();
    if (!first || !last) { showToast('Förnamn och efternamn krävs'); return; }
    if (!uname)          { showToast('Användarnamn krävs'); return; }

    const data = {
      firstName: first, lastName: last,
      title:  document.getElementById('sf-title')?.value.trim() || '',
      phone:  document.getElementById('sf-phone')?.value.trim() || '',
      email:  document.getElementById('sf-email')?.value.trim() || '',
      username: uname,
      role: document.getElementById('sf-role')?.value || 'personal',
      updatedAt: new Date().toISOString()
    };

    if (!staffId) {
      if ((state.staff||[]).find(s => s.username === uname)) { showToast('Användarnamnet används redan'); return; }
      state.staff.push({ ...data, id: newId(state.staff||[], 'ST'), permissions: [], active: true, createdAt: new Date().toISOString() });
      persist(); Modal.close(); showToast(`${first} ${last} skapad — kom ihåg att skapa inloggningskonto i Supabase Dashboard`);
    } else {
      const idx = (state.staff||[]).findIndex(s => s.id === staffId);
      if (idx < 0) return;
      if ((state.staff||[]).find(s => s.username === uname && s.id !== staffId)) { showToast('Användarnamnet används redan'); return; }
      state.staff[idx] = { ...state.staff[idx], ...data };
      persist(); Modal.close();
      const _cu = Auth.getUser();
      if (_cu && _cu.id === staffId) {
        // Redigerar sig själv — uppdatera currentUser och re-rendera sidebar direkt
        state.currentUser = { ..._cu, firstName: data.firstName, lastName: data.lastName, role: data.role, username: data.username, title: data.title };
        Auth._resolveUser();
        Sidebar.render();
        showToast('Sparat — dina behörigheter uppdaterade omedelbart');
      } else {
        const changedName = data.firstName + ' ' + data.lastName;
        showToast('Sparat — ' + changedName + ' ser nya behörigheter vid nästa inloggning');
      }
    }
    this.render();
  },

  _toggleActive(staffId) {
    const idx = (state.staff||[]).findIndex(s => s.id === staffId);
    if (idx < 0) return;
    state.staff[idx] = { ...state.staff[idx], active: !state.staff[idx].active, updatedAt: new Date().toISOString() };
    persist(); Modal.close();
    showToast(state.staff[idx].active ? 'Aktiverad' : 'Inaktiverad');
    this.render();
  }
};

/* ── Offerttjänster & Prismodeller ─── */
const ServiceTemplatesPage = {
  _q: '',
  _filter: 'alla',
  _editSvcId: null,
  _editTiers: [],
  _editOptions: [],
  _testFields: {},
  _testReduction: 'ingen',

  render() {
    const el = document.getElementById('pg-service-templates-content');
    if (!el) return;
    const all = ServiceTemplateService.getAll().slice().sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0));
    const filtered = all.filter(s => {
      if (this._filter === 'aktiva'   && s.active === false) return false;
      if (this._filter === 'inaktiva' && s.active !== false) return false;
      const q = (this._q||'').toLowerCase();
      if (q && !s.name.toLowerCase().includes(q) && !(s.category||'').toLowerCase().includes(q)) return false;
      return true;
    });
    const nAktiva   = all.filter(s=>s.active!==false).length;
    const nInaktiva = all.filter(s=>s.active===false).length;
    el.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>${ic('zap',15)} Offerttjänster & Prismodeller</h3>
          <button class="btn bp bsm" onclick="ServiceTemplatesPage.openCreate()">${ic('plus',13)} Ny tjänst</button>
        </div>
        <div style="display:flex;gap:7px;align-items:center;padding:10px 16px 6px;">
          <div class="swrap" style="flex:1;">
            <span class="sico">${ic('search',14)}</span>
            <input type="search" placeholder="Sök tjänst eller kategori…" value="${(this._q||'').replace(/"/g,'&quot;')}"
              oninput="ServiceTemplatesPage._q=this.value;ServiceTemplatesPage.render()">
          </div>
        </div>
        <div class="ftabs" style="padding:0 16px 8px;">
          ${[['alla','Alla',all.length],['aktiva','Aktiva',nAktiva],['inaktiva','Inaktiva',nInaktiva]].map(([v,l,n])=>
            `<button class="ft ${this._filter===v?'on':''}" onclick="ServiceTemplatesPage._filter='${v}';ServiceTemplatesPage.render()">${l} <span style="background:rgba(0,0,0,.1);border-radius:9px;padding:0 5px;font-size:9px;">${n}</span></button>`
          ).join('')}
        </div>
        <div class="card-body" style="padding:0;">
          ${filtered.length === 0
            ? `<div style="padding:24px;text-align:center;color:var(--mt);font-size:13px;">Inga tjänster hittades</div>`
            : filtered.map((s,i) => `
              <div class="crow" style="padding:10px 16px;border-bottom:1px solid var(--br);${s.active===false?'opacity:.6':''}">
                <div style="width:36px;height:36px;border-radius:8px;background:${s.active===false?'var(--br)':'var(--navy)'};display:flex;align-items:center;justify-content:center;color:#fff;flex-shrink:0;margin-right:10px;">
                  ${ic(s.icon||'zap',16)}
                </div>
                <div style="flex:1;min-width:0;">
                  <div style="font-size:13px;font-weight:700;color:var(--navy);">${s.name}${s.active===false?' <span class="bdg bdg-grey" style="font-size:9px;">Inaktiv</span>':''}</div>
                  <div style="font-size:11px;color:var(--mt);">${s.category||'—'} · ${ServiceTemplateService.modelLabel(s.pricingModel)} · Min ${fmt(s.minChargeExVat||0)} kr</div>
                </div>
                <div style="display:flex;gap:4px;flex-shrink:0;">
                  <button class="btn bs bxs" title="Testkalkyl" onclick="ServiceTemplatesPage.openTest('${s.id}')">${ic('calculator',13)}</button>
                  <button class="btn bs bxs" title="Duplicera" onclick="ServiceTemplatesPage.duplicate('${s.id}')">${ic('copy',13)}</button>
                  <button class="btn ${s.active===false?'bsu':'bw'} bxs" title="${s.active===false?'Aktivera':'Inaktivera'}" onclick="ServiceTemplatesPage.toggleActive('${s.id}')">${ic(s.active===false?'eye':'eye-off',13)}</button>
                  <button class="btn bs bxs" onclick="ServiceTemplatesPage.openEdit('${s.id}')">${ic('pencil',13)}</button>
                </div>
              </div>`).join('')
          }
        </div>
      </div>`;
  },

  openCreate() {
    const newSvc = ServiceTemplateService.create({
      name:'Ny tjänst', icon:'zap', category:'Övrigt',
      pricingModel:'fixed', qtyField:'qty', basePricePerUnit:0,
      defaultDescription:'', includes:[], excludes:[]
    });
    this.openEdit(newSvc.id);
  },

  openEdit(id) {
    const svc = ServiceTemplateService.get(id);
    if (!svc) return;
    this._editSvcId = id;
    this._editTiers   = JSON.parse(JSON.stringify(svc.tiers || []));
    this._editOptions = JSON.parse(JSON.stringify(svc.options || []));
    this._testFields  = {};
    this._testReduction = svc.defaultReduction || 'ingen';
    Modal.open({
      title: `${ic('settings',14)} Redigera: ${svc.name}`,
      body: this._editBody(svc),
      wide: true,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => this._save() },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => { Modal.close(); this.render(); } }
      ]
    });
    setTimeout(() => this._initEditChips(), 30);
  },

  _editBody(svc) {
    const modelOpts = ['tiered_unit','factor_unit','factor_lm','hourly','monthly','hourly_custom','fixed'];
    const icons = ['zap','refresh-cw','layers','scissors','building-2','wrench','settings','activity','sparkles','leaf','droplets','truck','home','tool','star'];
    const reducts = [{v:'ingen',l:'Ingen'},{v:'rut',l:'RUT 50%'},{v:'rot',l:'ROT 30%'}];
    return `
      <!-- Grundinfo -->
      <div style="font-size:11px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Grundinfo</div>
      <div class="g2" style="margin-bottom:8px;">
        <div class="fg"><label>Namn <span style="color:var(--rd)">*</span></label>
          <input id="svc-ed-name" value="${esc(svc.name)}"></div>
        <div class="fg"><label>Kategori</label>
          <input id="svc-ed-cat" value="${esc(svc.category||'')}" placeholder="T.ex. Tvätt & rengöring"></div>
      </div>
      <div class="g2" style="margin-bottom:8px;">
        <div class="fg"><label>Ikon</label>
          <select id="svc-ed-icon">
            ${icons.map(i=>`<option value="${i}" ${svc.icon===i?'selected':''}>${i}</option>`).join('')}
          </select></div>
        <div class="fg"><label>Enhet (t.ex. m², lm, tim)</label>
          <input id="svc-ed-unit" value="${esc(svc.unit||'st')}"></div>
      </div>
      <div class="g2" style="margin-bottom:8px;">
        <div class="fg"><label>Moms %</label>
          <input id="svc-ed-vat" type="number" value="${svc.vatRate||25}" min="0" max="100"></div>
        <div class="fg"><label>Minimidebitering ex moms</label>
          <input id="svc-ed-mincharge" type="number" value="${svc.minChargeExVat||0}" min="0"></div>
      </div>
      <div class="g2" style="margin-bottom:8px;">
        <div class="fg"><label>Standard skattereduktion</label>
          <select id="svc-ed-red">
            ${reducts.map(r=>`<option value="${r.v}" ${svc.defaultReduction===r.v?'selected':''}>${r.l}</option>`).join('')}
          </select></div>
        <div class="fg"><label>Sorteringsordning</label>
          <input id="svc-ed-sort" type="number" value="${svc.sortOrder||0}" min="0" step="5"></div>
      </div>
      <div class="fg" style="margin-bottom:12px;">
        <label><input type="checkbox" id="svc-ed-active" ${svc.active!==false?'checked':''}> Aktiv (visas i offertwizard)</label>
      </div>

      <!-- Prismodell -->
      <div style="border-top:1px solid var(--br);padding-top:12px;margin-bottom:8px;">
        <div style="font-size:11px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Prismodell</div>
        <div class="fg" style="margin-bottom:8px;"><label>Modelltyp</label>
          <select id="svc-ed-model" onchange="ServiceTemplatesPage._onModelChange()">
            ${modelOpts.map(m=>`<option value="${m}" ${svc.pricingModel===m?'selected':''}>${ServiceTemplateService.modelLabel(m)}</option>`).join('')}
          </select></div>
        <div id="svc-ed-model-fields">${this._modelFields(svc)}</div>
      </div>

      <!-- Tillval -->
      <div style="border-top:1px solid var(--br);padding-top:12px;margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div style="font-size:11px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;">Tillval / Tillägg</div>
          <button type="button" class="btn bsu bxs" onclick="ServiceTemplatesPage._addOption()">${ic('plus',11)} Lägg till</button>
        </div>
        <div id="svc-ed-options">${this._optionsHtml()}</div>
      </div>

      <!-- Texter -->
      <div style="border-top:1px solid var(--br);padding-top:12px;margin-bottom:8px;">
        <div style="font-size:11px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Offerttexter</div>
        <div class="fg" style="margin-bottom:8px;"><label>Standardbeskrivning</label>
          <textarea id="svc-ed-desc" rows="2" style="resize:vertical;">${esc(svc.defaultDescription||'')}</textarea></div>
        <div class="fg" style="margin-bottom:8px;"><label>Vad ingår (en per rad)</label>
          <textarea id="svc-ed-includes" rows="3" style="resize:vertical;">${(svc.includes||[]).join('\n')}</textarea></div>
        <div class="fg" style="margin-bottom:8px;"><label>Vad ingår ej (en per rad)</label>
          <textarea id="svc-ed-excludes" rows="3" style="resize:vertical;">${(svc.excludes||[]).join('\n')}</textarea></div>
        <div class="fg"><label>Intern kalkylnotis</label>
          <input id="svc-ed-note" value="${esc(svc.internalNote||'')}"></div>
      </div>

      <!-- Testkalkyl -->
      <div style="border-top:1px solid var(--br);padding-top:12px;">
        <div style="font-size:11px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">${ic('calculator',11)} Testkalkyl</div>
        <div id="svc-test-area" style="background:var(--bg);border:1px solid var(--br);border-radius:var(--rs);padding:12px;font-size:12px;color:var(--mt);">
          Spara tjänsten och använd testkalkyl via listan.
        </div>
      </div>`;
  },

  _modelFields(svc) {
    const model = svc.pricingModel || 'fixed';
    if (model === 'tiered_unit') {
      return `<div style="margin-bottom:6px;"><label style="font-size:10px;font-weight:700;color:var(--mt);">Prisstegar (ex moms per enhet)</label>
        <div id="svc-ed-tiers">${this._tiersHtml()}</div>
        <button type="button" class="btn bsu bxs" style="margin-top:4px;" onclick="ServiceTemplatesPage._addTier()">${ic('plus',11)} Lägg till steg</button>
      </div>`;
    }
    if (model === 'factor_unit' || model === 'factor_lm') {
      const unitLabel = model === 'factor_lm' ? 'lm' : svc.unit || 'enhet';
      return `<div class="g2" style="margin-bottom:8px;">
        <div class="fg"><label>Baspris ex moms (kr/${unitLabel})</label>
          <input id="svc-ed-base" type="number" value="${svc.basePricePerUnit||0}" min="0"></div>
        <div class="fg"><label>Primärt mängdfält (t.ex. area, length)</label>
          <input id="svc-ed-qtyfield" value="${esc(svc.qtyField||'area')}"></div>
      </div>
      <div style="font-size:11px;color:var(--mt);">Faktorer redigeras i nästa version. Nuvarande faktorer behålls.</div>`;
    }
    if (model === 'hourly') {
      return `<div class="g2" style="margin-bottom:8px;">
        <div class="fg"><label>Standardtimpris ex moms (kr)</label>
          <input id="svc-ed-base" type="number" value="${svc.basePricePerUnit||695}" min="0"></div>
        <div class="fg"><label>Mängdfält</label>
          <input id="svc-ed-qtyfield" value="${esc(svc.qtyField||'hours')}"></div>
      </div>`;
    }
    if (model === 'monthly') {
      return `<div class="fg" style="margin-bottom:8px;"><label>Mängdfält (antal månader)</label>
        <input id="svc-ed-qtyfield" value="${esc(svc.qtyField||'months')}"></div>`;
    }
    if (model === 'hourly_custom') {
      return `<div class="g2" style="margin-bottom:8px;">
        <div class="fg"><label>Standardtimpris ex moms (kr)</label>
          <input id="svc-ed-base" type="number" value="${svc.basePricePerUnit||695}" min="0"></div>
        <div class="fg"><label>Mängdfält</label>
          <input id="svc-ed-qtyfield" value="${esc(svc.qtyField||'qty')}"></div>
      </div>`;
    }
    return `<div class="fg" style="margin-bottom:8px;"><label>Fastpris ex moms (kr)</label>
      <input id="svc-ed-base" type="number" value="${svc.basePricePerUnit||0}" min="0"></div>`;
  },

  _tiersHtml() {
    if (!this._editTiers.length) return '<div style="font-size:11px;color:var(--mt);padding:6px 0;">Inga steg tillagda.</div>';
    return this._editTiers.map((t,i) => `
      <div style="display:flex;gap:4px;align-items:center;margin-bottom:4px;">
        <div class="fg" style="flex:1;margin:0;"><input type="number" placeholder="Från (m²)" value="${t.from}" min="0"
          oninput="ServiceTemplatesPage._editTiers[${i}].from=parseFloat(this.value)||0"></div>
        <div class="fg" style="flex:1;margin:0;"><input type="number" placeholder="Till (tom=∞)" value="${t.to===null?'':t.to}" min="0"
          oninput="ServiceTemplatesPage._editTiers[${i}].to=this.value===''?null:(parseFloat(this.value)||0)"></div>
        <div class="fg" style="flex:1;margin:0;"><input type="number" placeholder="kr/enhet" value="${t.priceExVat}" min="0"
          oninput="ServiceTemplatesPage._editTiers[${i}].priceExVat=parseFloat(this.value)||0"></div>
        <button type="button" class="btn bd bxs" onclick="ServiceTemplatesPage._removeTier(${i})">${ic('x',11)}</button>
      </div>`).join('');
  },

  _addTier() {
    const last = this._editTiers[this._editTiers.length-1];
    const from = last ? (last.to !== null ? last.to + 1 : 0) : 0;
    this._editTiers.push({from, to:null, priceExVat:0});
    const el = document.getElementById('svc-ed-tiers');
    if (el) el.innerHTML = this._tiersHtml();
  },

  _removeTier(i) {
    this._editTiers.splice(i,1);
    const el = document.getElementById('svc-ed-tiers');
    if (el) el.innerHTML = this._tiersHtml();
  },

  _optionsHtml() {
    if (!this._editOptions.length) return '<div style="font-size:11px;color:var(--mt);padding:6px 0;">Inga tillval tillagda.</div>';
    return this._editOptions.map((o,i) => `
      <div style="display:flex;gap:4px;align-items:center;margin-bottom:4px;">
        <div class="fg" style="flex:2;margin:0;"><input placeholder="Namn" value="${esc(o.name||'')}"
          oninput="ServiceTemplatesPage._editOptions[${i}].name=this.value"></div>
        <div style="flex:1;min-width:0;">
          <select oninput="ServiceTemplatesPage._editOptions[${i}].type=this.value" style="width:100%;padding:6px 8px;border:1px solid var(--br);border-radius:var(--rs);font-size:12px;">
            <option value="fixed" ${o.type==='fixed'?'selected':''}>Fastpris</option>
            <option value="per_unit" ${o.type==='per_unit'?'selected':''}>Per enhet</option>
          </select>
        </div>
        <div class="fg" style="flex:1;margin:0;"><input type="number" placeholder="Pris ex moms" value="${o.priceExVat||0}" min="0"
          oninput="ServiceTemplatesPage._editOptions[${i}].priceExVat=parseFloat(this.value)||0"></div>
        <button type="button" class="btn bd bxs" onclick="ServiceTemplatesPage._removeOption(${i})">${ic('x',11)}</button>
      </div>`).join('');
  },

  _addOption() {
    this._editOptions.push({id:'opt_'+Date.now(), name:'', type:'fixed', priceExVat:0});
    const el = document.getElementById('svc-ed-options');
    if (el) el.innerHTML = this._optionsHtml();
  },

  _removeOption(i) {
    this._editOptions.splice(i,1);
    const el = document.getElementById('svc-ed-options');
    if (el) el.innerHTML = this._optionsHtml();
  },

  _onModelChange() {
    const model = document.getElementById('svc-ed-model')?.value || 'fixed';
    const svcId = this._editSvcId;
    const svc = ServiceTemplateService.get(svcId) || {};
    const mockSvc = {...svc, pricingModel: model};
    const el = document.getElementById('svc-ed-model-fields');
    if (el) el.innerHTML = this._modelFields(mockSvc);
    if (model === 'tiered_unit') {
      const tel = document.getElementById('svc-ed-tiers');
      if (tel) tel.innerHTML = this._tiersHtml();
    }
  },

  _initEditChips() {
    // Nothing complex needed — chips are rendered by _modelFields inline
  },

  _save() {
    const id   = this._editSvcId;
    const name = document.getElementById('svc-ed-name')?.value?.trim();
    if (!name) { showToast('Ange ett namn'); return; }
    const model  = document.getElementById('svc-ed-model')?.value || 'fixed';
    const base   = parseFloat(document.getElementById('svc-ed-base')?.value || 0) || 0;
    const qtyFld = document.getElementById('svc-ed-qtyfield')?.value?.trim() || 'qty';
    const changes = {
      name,
      category:           (document.getElementById('svc-ed-cat')?.value  || '').trim(),
      icon:               document.getElementById('svc-ed-icon')?.value  || 'zap',
      unit:               (document.getElementById('svc-ed-unit')?.value || 'st').trim(),
      vatRate:            parseFloat(document.getElementById('svc-ed-vat')?.value) || 25,
      minChargeExVat:     parseFloat(document.getElementById('svc-ed-mincharge')?.value) || 0,
      defaultReduction:   document.getElementById('svc-ed-red')?.value  || 'ingen',
      sortOrder:          parseInt(document.getElementById('svc-ed-sort')?.value) || 0,
      active:             document.getElementById('svc-ed-active')?.checked !== false,
      pricingModel:       model,
      basePricePerUnit:   base,
      qtyField:           qtyFld,
      tiers:              model === 'tiered_unit' ? this._editTiers.slice() : (ServiceTemplateService.get(id)?.tiers || []),
      options:            this._editOptions.slice(),
      defaultDescription: (document.getElementById('svc-ed-desc')?.value || '').trim(),
      includes:           (document.getElementById('svc-ed-includes')?.value || '').split('\n').map(s=>s.trim()).filter(Boolean),
      excludes:           (document.getElementById('svc-ed-excludes')?.value || '').split('\n').map(s=>s.trim()).filter(Boolean),
      internalNote:       (document.getElementById('svc-ed-note')?.value  || '').trim()
    };
    ServiceTemplateService.update(id, changes);
    Modal.close();
    this.render();
    showToast(`"${name}" sparad`);
  },

  toggleActive(id) {
    const svc = ServiceTemplateService.toggleActive(id);
    this.render();
    showToast(svc && svc.active !== false ? 'Aktiverad' : 'Inaktiverad');
  },

  duplicate(id) {
    const copy = ServiceTemplateService.duplicate(id);
    if (copy) { this.render(); showToast('Duplicerad — redigera kopian för att aktivera'); }
  },

  openTest(id) {
    const svc = ServiceTemplateService.get(id);
    if (!svc) return;
    const tmpl = ServiceTemplateService.buildWizardTemplate(svc);
    this._testFields = {};
    this._testReduction = svc.defaultReduction || 'ingen';
    // Pre-fill defaults
    (svc.fields||[]).forEach(f => {
      if (f.def !== undefined)           this._testFields[f.id] = f.def;
      else if (f.type==='chips'&&f.opts) this._testFields[f.id] = f.opts[0];
      else if (f.type==='bool')          this._testFields[f.id] = false;
      else if (f.type==='number')        this._testFields[f.id] = 0;
      else if (f.type==='pricegroup') {
        const pgs = (state.priceGroups || []).filter(p => p.billingType !== 'monthly');
        const defId = f.def || (pgs[0]&&pgs[0].id) || '';
        this._testFields[f.id] = defId;
        const pg = pgs.find(p=>p.id===defId);
        if (pg && !this._testFields['rate']) this._testFields['rate'] = pg.hourRate;
      } else                               this._testFields[f.id] = '';
    });
    const redOpts = [{v:'ingen',l:'Ingen'},{v:'rut',l:'RUT 50%'},{v:'rot',l:'ROT 30%'}];
    const fieldHtml = (svc.fields||[]).filter(f=>!f.isRut&&!f.isRot).map(f => {
      if (f.type === 'number') return `<div class="fg" style="margin-bottom:6px;"><label style="font-size:10px;">${f.label}</label>
        <input type="number" value="${f.def||0}" min="0" style="width:100%;"
          oninput="ServiceTemplatesPage._testFields['${f.id}']=parseFloat(this.value)||0;ServiceTemplatesPage._updateTestPreview('${id}')"></div>`;
      if (f.type === 'chips') return `<div style="margin-bottom:6px;"><div style="font-size:10px;font-weight:700;color:var(--mt);margin-bottom:3px;">${f.label}</div>
        <div style="display:flex;flex-wrap:wrap;gap:3px;">
          ${(f.opts||[]).map(o=>`<button type="button"
            style="padding:3px 8px;border-radius:12px;border:1.5px solid var(--br);font-size:10px;cursor:pointer;background:${o===(f.def||f.opts[0])?'var(--navy)':'#fff'};color:${o===(f.def||f.opts[0])?'#fff':'var(--tx)'};"
            onclick="ServiceTemplatesPage._testFields['${f.id}']='${o.replace(/'/g,"\\'")}';this.closest('div').querySelectorAll('button').forEach(b=>{b.style.background='#fff';b.style.color='var(--tx)';});this.style.background='var(--navy)';this.style.color='#fff';ServiceTemplatesPage._updateTestPreview('${id}')">${o}</button>`).join('')}
        </div></div>`;
      if (f.type === 'bool') return `<div style="margin-bottom:6px;"><label style="display:flex;align-items:center;gap:6px;font-size:11px;cursor:pointer;">
        <input type="checkbox" onchange="ServiceTemplatesPage._testFields['${f.id}']=this.checked;ServiceTemplatesPage._updateTestPreview('${id}')">
        <span>${f.addLabel||f.label}</span></label></div>`;
      if (f.type === 'pricegroup') {
        const pgs = (state.priceGroups || []).filter(p => p.billingType !== 'monthly');
        const defVal = f.def || (pgs[0]&&pgs[0].id) || '';
        return `<div class="fg" style="margin-bottom:6px;"><label style="font-size:10px;">${f.label}</label>
          <select style="width:100%;" onchange="ServiceTemplatesPage._testFields['${f.id}']=this.value;ServiceTemplatesPage._testFields['rate']=(state.priceGroups||[]).filter(p=>p.billingType!=='monthly').find(p=>p.id===this.value)?.hourRate||0;ServiceTemplatesPage._updateTestPreview('${id}')">
            ${pgs.map(pg=>`<option value="${pg.id}" ${(f.def||defVal)===pg.id?'selected':''}>${esc(pg.name)} (${fmt(pg.hourRate)} kr/tim)</option>`).join('')}
          </select></div>`;
      }
      return `<div class="fg" style="margin-bottom:6px;"><label style="font-size:10px;">${f.label}</label>
        <input type="text" value="" style="width:100%;"
          oninput="ServiceTemplatesPage._testFields['${f.id}']=this.value;ServiceTemplatesPage._updateTestPreview('${id}')"></div>`;
    }).join('');

    Modal.open({
      title: `${ic('calculator',14)} Testkalkyl: ${svc.name}`,
      body: `
        <div class="g2" style="gap:12px;">
          <div>${fieldHtml}
            <div style="padding-top:8px;border-top:1px solid var(--br);">
              <div style="font-size:10px;font-weight:700;color:var(--mt);margin-bottom:4px;">Skattereduktion</div>
              <div style="display:flex;gap:4px;">
                ${redOpts.map(o=>`<button type="button" id="test-red-${o.v}"
                  style="flex:1;padding:5px;border-radius:6px;border:1.5px solid ${this._testReduction===o.v?'var(--navy)':'var(--br)'};font-size:10px;font-weight:700;cursor:pointer;background:${this._testReduction===o.v?'var(--navy)':'#fff'};color:${this._testReduction===o.v?'#fff':'var(--mt)'};"
                  onclick="ServiceTemplatesPage._setTestReduction('${o.v}','${id}')">${o.l}</button>`).join('')}
              </div>
            </div>
          </div>
          <div id="svc-test-preview" style="background:var(--navy);color:#fff;border-radius:var(--rs);padding:12px;min-height:120px;">
            <div style="font-size:11px;opacity:.6;">Fyll i fälten för att se kalkyl…</div>
          </div>
        </div>`,
      buttons: [{ label: 'Stäng', cls: 'btn bs', onClick: () => Modal.close() }]
    });
    setTimeout(() => this._updateTestPreview(id), 50);
  },

  _setTestReduction(val, svcId) {
    this._testReduction = val;
    ['ingen','rut','rot'].forEach(v => {
      const btn = document.getElementById('test-red-' + v);
      if (!btn) return;
      btn.style.background  = v===val ? 'var(--navy)' : '#fff';
      btn.style.color       = v===val ? '#fff'        : 'var(--mt)';
      btn.style.borderColor = v===val ? 'var(--navy)' : 'var(--br)';
    });
    this._updateTestPreview(svcId);
  },

  _updateTestPreview(svcId) {
    const prev = document.getElementById('svc-test-preview');
    if (!prev) return;
    const svc  = ServiceTemplateService.get(svcId);
    if (!svc) return;
    const tmpl = ServiceTemplateService.buildWizardTemplate(svc);
    const fields = {...this._testFields, rut:this._testReduction==='rut', rot:this._testReduction==='rot'};
    try {
      const r = tmpl.calc(fields);
      const {ls, exVat, rutAmt} = r;
      const vat    = Math.round(exVat * (svc.vatRate||25) / 100);
      const incVat = exVat + vat;
      const custPr = incVat - (rutAmt||0);
      let html = '';
      if (r.tierLbl) html += `<div style="font-size:8px;opacity:.5;margin-bottom:4px;">${r.tierLbl}</div>`;
      html += `<div style="font-size:9px;opacity:.65;margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,.12);">`;
      ls.forEach(l => { html += `<div>${l.desc} · ${l.qty} ${l.unit} × ${fmt(l.price)} kr = ${fmt(Math.round(l.qty*l.price))} kr</div>`; });
      html += `</div>`;
      html += `<div style="display:flex;justify-content:space-between;font-size:10px;opacity:.7;margin-bottom:2px;"><span>Ex. moms</span><span>${fmt(exVat)} kr</span></div>`;
      html += `<div style="display:flex;justify-content:space-between;font-size:10px;opacity:.7;margin-bottom:5px;"><span>Moms ${svc.vatRate||25}%</span><span>${fmt(vat)} kr</span></div>`;
      html += `<div style="display:flex;justify-content:space-between;font-size:11px;font-weight:700;padding-top:5px;border-top:1px solid rgba(255,255,255,.15);margin-bottom:${rutAmt?'4px':'8px'};"><span>Totalt inkl. moms</span><span>${fmt(incVat)} kr</span></div>`;
      if (rutAmt) {
        const redLbl = this._testReduction==='rut'?'RUT':'ROT';
        html += `<div style="display:flex;justify-content:space-between;font-size:10px;color:#86efac;margin-bottom:4px;"><span>Prelim. ${redLbl}-avdrag</span><span>-${fmt(rutAmt)} kr</span></div>`;
      }
      html += `<div style="display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,.13);border-radius:6px;padding:6px 9px;">
        <span style="font-size:10px;opacity:.8;">Kundpris inkl. moms</span>
        <span style="font-size:17px;font-weight:800;">${fmt(rutAmt?custPr:incVat)} kr</span></div>`;
      prev.innerHTML = html;
    } catch(e) {
      prev.innerHTML = `<div style="font-size:10px;opacity:.65;">Fyll i obligatoriska fält för att se kalkyl.</div>`;
    }
  }
};

/* ── Admin ────────────────────────────── */
const AdminPage = {
  _titleQ: '',
  _tab: 'foretag',

  render() {
    const el = document.getElementById('pg-admin-content');
    if (!el) return;
    if (!Auth.require('admin_manage')) {
      el.innerHTML = `<div class="empty">${ic('lock',32)}<h3>Behörighet saknas</h3><p>Du har inte tillgång till systeminställningar.</p></div>`;
      return;
    }
    const s = state.settings || {};
    const allTitles = state.titles || [];
    const titles = this._titleQ
      ? allTitles.filter(t => typeof t === 'object' && t.name && t.name.toLowerCase().includes(this._titleQ.toLowerCase()))
      : allTitles;

    const tabDefs = [
      { key: 'foretag',        label: 'Företag'                                    },
      { key: 'ekonomi',        label: 'Ekonomi'                                    },
      { key: 'personal',       label: 'Personal'                                   },
      { key: 'priser',         label: 'Priser'                                     },
      { key: 'system',         label: 'System'                                     },
      { key: 'fastighetskort', label: `${ic('building-2',12)} Fastighetskort`      },
      { key: 'ansvariga',      label: `${ic('user-check',12)} Ansvariga`           },
      { key: 'avvikelse',      label: `${ic('alert-triangle',12)} Avvikelser`      },
      { key: 'notiser',        label: `${ic('bell',12)} Notiser`                   },
      { key: 'epost',          label: `${ic('mail',12)} E-post-mallar`             }
    ];
    const tabBar = `<div class="admin-tabs">
      ${tabDefs.map(t => `<button class="btn bsm admin-tab ${this._tab===t.key?'bp':'bs'}" onclick="AdminPage._tab='${t.key}';AdminPage.render()">${t.label}</button>`).join('')}
    </div>`;

    const sections = {};

    sections.foretag = `
      <div class="admin-section-group" style="margin-bottom:14px;">
        <div class="admin-section-header">
          <div class="admin-section-icon" style="background:#eff6ff;color:var(--blue);">${ic('building-2',18)}</div>
          <div>
            <div class="admin-section-title">Företagsinformation & Branding</div>
            <div class="admin-section-desc">Företagsuppgifter, logotype och varumärkesfärger</div>
          </div>
        </div>

        <!-- Uppgifter -->
        <div style="padding:14px 16px;border-bottom:1px solid var(--br);">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <div style="font-size:12px;font-weight:800;color:var(--navy);">Uppgifter</div>
            <button class="btn bs bxs" onclick="AdminPage.openEditCompany()">${ic('pencil',13)} Redigera</button>
          </div>
          <div class="dr"><span class="dk">Företag</span><span class="dv">${s.companyName || '—'}</span></div>
          <div class="dr"><span class="dk">Slogan</span><span class="dv">${s.slogan || '—'}</span></div>
          <div class="dr"><span class="dk">Telefon</span><span class="dv">${s.companyPhone || '—'}</span></div>
          <div class="dr"><span class="dk">E-post</span><span class="dv">${s.companyEmail || '—'}</span></div>
          <div class="dr"><span class="dk">Adress</span><span class="dv">${s.companyAddress || '—'}</span></div>
          <div class="dr"><span class="dk">Org.nr</span><span class="dv">${s.orgNr || '—'}</span></div>
          <div class="dr"><span class="dk">Moms-nr</span><span class="dv">${s.vatNr || '—'}</span></div>
        </div>

        <!-- Branding & Logga — inside group -->
        <div>

          <!-- Logo ljus bakgrund -->
          <div style="display:flex;align-items:center;gap:14px;padding:14px 16px;border-bottom:1px solid var(--br);">
            <div style="flex:1;min-width:0;">
              <div style="font-size:12px;font-weight:700;margin-bottom:2px;">Logga — ljus bakgrund</div>
              <div style="font-size:11px;color:var(--mt);margin-bottom:8px;">PDF, utskrift, e-post</div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                <label class="btn bs bxs" style="cursor:pointer;display:inline-flex;align-items:center;gap:5px;font-size:11px;">
                  ${ic('upload',11)} Ladda upp SVG/PNG/JPG
                  <input type="file" style="display:none;" accept=".svg,.png,.jpg,.jpeg,image/svg+xml,image/png,image/jpeg"
                    onchange="AdminPage._uploadLogo(this,'logoLight')">
                </label>
                ${s.logoLight ? `<button class="btn bd bxs" style="font-size:11px;" onclick="AdminPage._clearLogo('logoLight')">${ic('x',10)} Rensa</button>` : ''}
                ${s.logoLight ? `<span style="font-size:10px;color:var(--gn);align-self:center;">${ic('check',10)} Uppladdad</span>` : `<span style="font-size:10px;color:var(--mt);align-self:center;">Använder standardlogga</span>`}
              </div>
            </div>
            <div style="width:130px;height:52px;border:1px solid var(--br);border-radius:8px;background:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:8px;flex-shrink:0;">
              <img id="admin-preview-light" src="${BrandingService.logoLight()}" alt="Logo"
                style="max-width:100%;max-height:100%;object-fit:contain;"
                onerror="this.style.opacity='.2'">
            </div>
          </div>

          <!-- Logo mörk bakgrund -->
          <div style="display:flex;align-items:center;gap:14px;padding:14px 16px;border-bottom:1px solid var(--br);">
            <div style="flex:1;min-width:0;">
              <div style="font-size:12px;font-weight:700;margin-bottom:2px;">Logga — mörk bakgrund</div>
              <div style="font-size:11px;color:var(--mt);margin-bottom:8px;">Sidebar, offertdetalj, hero</div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                <label class="btn bs bxs" style="cursor:pointer;display:inline-flex;align-items:center;gap:5px;font-size:11px;">
                  ${ic('upload',11)} Ladda upp SVG/PNG/JPG
                  <input type="file" style="display:none;" accept=".svg,.png,.jpg,.jpeg,image/svg+xml,image/png,image/jpeg"
                    onchange="AdminPage._uploadLogo(this,'logoDark')">
                </label>
                ${s.logoDark ? `<button class="btn bd bxs" style="font-size:11px;" onclick="AdminPage._clearLogo('logoDark')">${ic('x',10)} Rensa</button>` : ''}
                ${s.logoDark ? `<span style="font-size:10px;color:var(--gn);align-self:center;">${ic('check',10)} Uppladdad</span>` : `<span style="font-size:10px;color:var(--mt);align-self:center;">Använder ljus logga eller standard</span>`}
              </div>
            </div>
            <div style="width:130px;height:52px;border:1px solid var(--navy);border-radius:8px;background:var(--navy);display:flex;align-items:center;justify-content:center;overflow:hidden;padding:8px;flex-shrink:0;">
              <img id="admin-preview-dark" src="${BrandingService.logoDark()}" alt="Logo"
                style="max-width:100%;max-height:100%;object-fit:contain;"
                onerror="this.style.opacity='.2'">
            </div>
          </div>

          <!-- Förhandsvisning sidebar -->
          <div style="padding:14px 16px;border-bottom:1px solid var(--br);">
            <div style="font-size:11px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Förhandsvisning sidebar</div>
            <div style="background:var(--navy);border-radius:10px;padding:14px 16px;display:flex;align-items:center;gap:10px;max-width:260px;">
              <img src="${BrandingService.logoDark()}" style="height:30px;width:auto;max-width:120px;object-fit:contain;border-radius:5px;"
                onerror="this.style.display='none'">
              <span style="font-size:10px;color:rgba(255,255,255,.4);">VIFT System</span>
            </div>
          </div>

          <!-- Färger -->
          <div style="padding:14px 16px;">
            <div style="font-size:11px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;">Varumärkesfärger</div>
            <div style="display:flex;gap:20px;flex-wrap:wrap;">
              <div>
                <div style="font-size:11px;font-weight:600;margin-bottom:4px;">Primär</div>
                <div style="display:flex;align-items:center;gap:8px;">
                  <input type="color" value="${s.primaryColor||'#0f3763'}"
                    style="width:36px;height:28px;border:1px solid var(--br);border-radius:4px;cursor:pointer;padding:2px;"
                    oninput="AdminPage._saveColor(this.value,'primaryColor');this.nextElementSibling.textContent=this.value">
                  <span style="font-size:11px;color:var(--mt);font-family:monospace;">${s.primaryColor||'#0f3763'}</span>
                </div>
              </div>
              <div>
                <div style="font-size:11px;font-weight:600;margin-bottom:4px;">Sekundär</div>
                <div style="display:flex;align-items:center;gap:8px;">
                  <input type="color" value="${s.secondaryColor||'#1d75d8'}"
                    style="width:36px;height:28px;border:1px solid var(--br);border-radius:4px;cursor:pointer;padding:2px;"
                    oninput="AdminPage._saveColor(this.value,'secondaryColor');this.nextElementSibling.textContent=this.value">
                  <span style="font-size:11px;color:var(--mt);font-family:monospace;">${s.secondaryColor||'#1d75d8'}</span>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>`;

    sections.ekonomi = `
      <div class="admin-section-group" style="margin-bottom:14px;">
        <div class="admin-section-header">
          <div class="admin-section-icon" style="background:#f0fdf4;color:var(--gr);">${ic('trending-up',18)}</div>
          <div>
            <div class="admin-section-title">Ekonomi</div>
            <div class="admin-section-desc">Intern timkostnad och lönsamhetsparametrar</div>
          </div>
          <button class="btn bs bxs" style="margin-left:auto;flex-shrink:0;" onclick="AdminPage.openEditEkonomi()">${ic('pencil',13)} Redigera</button>
        </div>
        <div style="padding:14px 16px;">
          <div class="dr">
            <span class="dk">Intern timkostnad</span>
            <span class="dv">${fmt((s.internalHourlyCost || 250))} kr/h ex moms</span>
          </div>
          <p style="font-size:11px;color:var(--mt);margin-top:6px;line-height:1.5;">Används för att beräkna täckningsbidrag. Visas aldrig för kund.</p>
        </div>
      </div>`;

    sections.personal = `
      <div class="admin-section-group" style="margin-bottom:14px;">
        <div class="admin-section-header">
          <div class="admin-section-icon" style="background:#faf5ff;color:var(--pu);">${ic('users',18)}</div>
          <div style="flex:1;min-width:0;">
            <div class="admin-section-title">Personal & Roller</div>
            <div class="admin-section-desc">Titlar/yrkesroller, behörighetsroller och personalregister</div>
          </div>
          <button class="btn bs bxs" style="flex-shrink:0;" onclick="Router.showPage('pg-staff')">${ic('arrow-right',13)} Personal</button>
        </div>

        <!-- Titlar -->
        <div style="border-bottom:1px solid var(--br);">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-bottom:1px solid var(--bg);">
            <div style="font-size:12px;font-weight:800;color:var(--navy);">Titlar / yrkesroller</div>
            <button class="btn bp bxs" onclick="AdminPage.openAddTitle()">${ic('plus',13)} Lägg till</button>
          </div>
          <div style="padding:6px 16px 4px;">
            <div class="swrap">
              <span class="sico">${ic('search',14)}</span>
              <input type="search" placeholder="Sök titel…" value="${this._titleQ}"
                oninput="AdminPage._titleQ=this.value;AdminPage.render()" style="font-size:12px;">
            </div>
          </div>
          <div style="padding:4px 16px 4px;">
            ${allTitles.length === 0
              ? '<p style="font-size:12px;color:var(--mt);padding:6px 0;">Inga titlar registrerade</p>'
              : titles.length === 0
                ? `<p style="font-size:12px;color:var(--mt);padding:6px 0;">Ingen titel matchar "${this._titleQ}"</p>`
                : titles.map(t => {
                    const origIdx = allTitles.findIndex(x => x.id === t.id);
                    const usageCount = (state.staff||[]).filter(s => s.title === t.name).length;
                    return `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--bg);">
                      <div style="flex:1;min-width:0;">
                        <div style="display:flex;align-items:center;gap:6px;">
                          <span style="font-size:13px;font-weight:600;">${t.name}</span>
                          <span class="bdg ${t.active?'bdg-green':'bdg-grey'}" style="font-size:9px;">${t.active?'Aktiv':'Inaktiv'}</span>
                        </div>
                        ${t.description ? `<div style="font-size:11px;color:var(--mt);">${t.description}</div>` : ''}
                        ${usageCount > 0
                          ? `<div style="font-size:10px;color:var(--sky);cursor:pointer;" onclick="AdminPage.showTitleStaff('${t.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'")}')">
                              ${usageCount} person${usageCount===1?'':'er'} – Visa ${ic('arrow-right',9)}
                            </div>`
                          : '<div style="font-size:10px;color:var(--mt);">Ej använd</div>'}
                      </div>
                      <button class="btn bxs bs" onclick="AdminPage.openEditTitle(${origIdx})">${ic('pencil',11)}</button>
                      <button class="btn bxs ${t.active?'bw':'bsu'}" onclick="AdminPage.toggleTitleActive(${origIdx})"
                        style="font-size:10px;">${t.active?ic('eye-off',11):ic('eye',11)}</button>
                      <button class="btn bxs bd" onclick="AdminPage.removeTitle(${origIdx})"
                        ${usageCount>0?`title="Används av ${usageCount} person(er)"`:''}>${ic('trash',11)}</button>
                    </div>`;
                  }).join('')
            }
          </div>
        </div>

        <!-- Roller -->
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-bottom:1px solid var(--bg);">
            <div style="font-size:12px;font-weight:800;color:var(--navy);">Roller & behörigheter</div>
            <button class="btn bp bxs" onclick="AdminPage.openAddRole()">${ic('plus',13)} Ny roll</button>
          </div>
          <div style="padding:4px 16px 4px;">
            ${(state.roles||[]).length === 0
              ? '<p style="font-size:12px;color:var(--mt);padding:6px 0;">Inga roller definierade</p>'
              : (state.roles||[]).map(r => {
                  const permCount  = (r.permissions||[]).length;
                  const staffCount = (state.staff||[]).filter(s=>s.role===r.id).length;
                  const isActive   = r.active !== false;
                  return `<div style="padding:9px 0;border-bottom:1px solid var(--bg);display:flex;align-items:flex-start;gap:8px;${isActive?'':'opacity:.65'}">
                    <div style="flex:1;min-width:0;">
                      <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;flex-wrap:wrap;">
                        <span style="font-size:13px;font-weight:700;">${r.label}</span>
                        <span class="bdg ${isActive?'bdg-green':'bdg-grey'}" style="font-size:9px;">${isActive?'Aktiv':'Inaktiv'}</span>
                        ${r.isBuiltin?`<span class="bdg bdg-grey" style="font-size:9px;">Inbyggd</span>`:''}
                        ${staffCount>0?`<span class="bdg bdg-blue" style="font-size:9px;cursor:pointer;" onclick="AdminPage.showRoleStaff('${r.id}')">${staffCount} pers.</span>`:''}
                      </div>
                      ${r.description?`<div style="font-size:11px;color:var(--mt);">${r.description}</div>`:''}
                      <div style="font-size:10px;color:var(--sky);margin-top:2px;">${permCount===0?'Inga behörigheter':permCount+' behörighet'+(permCount===1?'':'er')+(r.permissions&&r.permissions.includes('all')?' (superadmin)':'')}</div>
                    </div>
                    <div style="display:flex;gap:4px;flex-shrink:0;">
                      <button class="btn bxs bs" onclick="AdminPage.openEditRole('${r.id}')">${ic('pencil',11)}</button>
                      <button class="btn bxs ${isActive?'bw':'bsu'}" onclick="AdminPage.toggleRoleActive('${r.id}')"
                        title="${isActive?'Inaktivera':'Aktivera'}" style="font-size:10px;">${isActive?ic('eye-off',11):ic('eye',11)}</button>
                      ${!r.isBuiltin?`<button class="btn bxs bd" onclick="AdminPage.removeRole('${r.id}')">${ic('trash',11)}</button>`:''}
                    </div>
                  </div>`;
                }).join('')
            }
          </div>
        </div>
      </div>`;

    sections.priser = `
      <div class="admin-section-group" style="margin-bottom:14px;">
        <div class="admin-section-header">
          <div class="admin-section-icon" style="background:#fff7ed;color:var(--or);">${ic('package',18)}</div>
          <div>
            <div class="admin-section-title">Priser & Tjänster</div>
            <div class="admin-section-desc">Offerttjänstemallar, artiklar och prisgrupper</div>
          </div>
        </div>

        <!-- Tjänstemallar -->
        <div style="border-bottom:1px solid var(--br);">
          <div style="padding:10px 16px;border-bottom:1px solid var(--bg);">
            <div style="font-size:12px;font-weight:800;color:var(--navy);">Offert-tjänstemallar</div>
            <div style="font-size:11px;color:var(--mt);margin-top:2px;">Inbyggda kalkylatormallar. Definierar prismodell, RUT/ROT-typ och fält.</div>
          </div>
          <div style="padding:4px 16px 4px;">
            ${OffersPage._T.map(t=>`<div style="padding:7px 0;border-bottom:1px solid var(--bg);display:flex;align-items:center;gap:8px;">
              <span style="background:var(--acc);border-radius:var(--rx);padding:5px;color:var(--acc-text);flex-shrink:0;">${ic(t.icon,13)}</span>
              <div style="flex:1;min-width:0;">
                <div style="font-size:12px;font-weight:700;">${t.name}</div>
                <div style="font-size:10px;color:var(--mt);">${t.defaultReduction==='rut'?'RUT 50 %':t.defaultReduction==='rot'?'ROT 30 %':'Ingen reduktion'} · Moms ${t.vatRate||25} % · ${t.fields.filter(f=>!f.isRut&&!f.isRot).length} fält</div>
              </div>
              <span class="bdg bdg-green" style="font-size:9px;">Aktiv</span>
            </div>`).join('')}
          </div>
        </div>

        <!-- Register shortcuts -->
        <div style="padding:14px 16px;">
          <div style="font-size:12px;font-weight:800;color:var(--navy);margin-bottom:10px;">Register</div>
          <div class="dr">
            <span class="dk">${ic('zap',13)} Offerttjänster</span>
            <span class="dv"><button class="btn bs bxs" onclick="Router.showPage('pg-service-templates')">${(state.serviceTemplates||[]).filter(s=>s.active!==false).length} aktiva – Hantera ${ic('arrow-right',12)}</button></span>
          </div>
          <div class="dr">
            <span class="dk">${ic('package',13)} Artiklar</span>
            <span class="dv"><button class="btn bs bxs" onclick="Router.showPage('pg-articles')">${(state.articles||[]).filter(a=>a.active!==false).length} aktiva – Hantera ${ic('arrow-right',12)}</button></span>
          </div>
          <div class="dr">
            <span class="dk">${ic('dollar-sign',13)} Prisgrupper</span>
            <span class="dv"><button class="btn bs bxs" onclick="Router.showPage('pg-pricegroups')">${(state.priceGroups||[]).filter(p=>p.active).length} aktiva – Hantera ${ic('arrow-right',12)}</button></span>
          </div>
        </div>
      </div>`;

    sections.system = `
      <div class="admin-section-group" style="margin-bottom:14px;">
        <div class="admin-section-header">
          <div class="admin-section-icon" style="background:#f1f5f9;color:var(--mt);">${ic('settings',18)}</div>
          <div>
            <div class="admin-section-title">System</div>
            <div class="admin-section-desc">Dataöversikt och systemåterställning</div>
          </div>
        </div>

        <!-- Systemöversikt -->
        <div style="padding:14px 16px;border-bottom:1px solid var(--br);">
          <div style="font-size:12px;font-weight:800;color:var(--navy);margin-bottom:10px;">Dataöversikt</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;">
            <div class="dr"><span class="dk">Kunder</span><span class="dv">${(state.customers||[]).length} st</span></div>
            <div class="dr"><span class="dk">Arbetsorder</span><span class="dv">${(state.workOrders||[]).length} st</span></div>
            <div class="dr"><span class="dk">Offerter</span><span class="dv">${(state.offers||[]).length} st</span></div>
            <div class="dr"><span class="dk">Fakturor</span><span class="dv">${(state.invoices||[]).length} st</span></div>
            <div class="dr"><span class="dk">Återkommande</span><span class="dv">${(state.recurringOrders||[]).length} st</span></div>
            <div class="dr"><span class="dk">Tidsposter</span><span class="dv">${(state.timeEntries||[]).length} st</span></div>
          </div>
        </div>

        <!-- Import & Export -->
        <div style="padding:14px 16px;border-bottom:1px solid var(--br);">
          <div style="font-size:12px;font-weight:800;color:var(--navy);margin-bottom:6px;">Import &amp; Export</div>
          <p style="font-size:12px;color:var(--mt);margin-bottom:10px;line-height:1.5;">
            Importera kunder från CSV eller XLSX. Exportera register. Historik och ångra via importloggen.
          </p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn bs bsm" onclick="Router.showPage('pg-import-wizard',{type:'customer'})">${ic('upload',13)} Importera kunder</button>
            <button class="btn bs bsm" onclick="Router.showPage('pg-import-log',{})">${ic('clock',13)} Importlogg (${(state.importLogs||[]).length})</button>
          </div>
        </div>

        <!-- Återställning -->
        <div style="padding:14px 16px;">
          <div style="font-size:12px;font-weight:800;color:var(--navy);margin-bottom:6px;">Demodata & återställning</div>
          <p style="font-size:12px;color:var(--mt);margin-bottom:10px;line-height:1.5;">Rensa localStorage och ladda om demodata. Återställer allt till startläget.</p>
          <button class="btn bd bsm" onclick="if(confirm('Rensa all data och återgå till demodata?')){localStorage.clear();location.reload();}">${ic('trash',13)} Återställ demodata</button>
        </div>
      </div>`;

    /* ── Notiser-fliken (tillgänglig för alla inloggade) ───── */
    const push    = typeof PushService !== 'undefined' ? PushService : null;
    const pSupp   = push ? push.isSupported() : false;
    const pState  = push ? push.permissionState() : 'unsupported';
    const pIOS    = push ? push.isIOS() : false;
    const pSA     = push ? push.isStandalone() : false;
    const pKey    = push ? push._vapidKey() : '';
    const pReason = push ? push.blockReason() : 'unsupported';

    const statusBadge = () => {
      if (!pSupp)                   return '<span class="bdg bdg-grey">Ej stödd</span>';
      if (pIOS && !pSA)             return '<span class="bdg bdg-grey">Kräver hemskärmsapp</span>';
      if (!pKey)                    return '<span class="bdg" style="background:#fef9c3;color:#854d0e;">VAPID saknas</span>';
      if (pState === 'denied')      return '<span class="bdg bdg-red">Blockerad</span>';
      if (pState === 'granted')     return '<span class="bdg bdg-green">Aktiv</span>';
      return '<span class="bdg bdg-grey">Ej aktiverad</span>';
    };

    const iosNote = pIOS && !pSA ? `
      <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:12px 14px;margin-bottom:14px;font-size:12px;line-height:1.6;">
        ${ic('smartphone',14)} <strong>iPhone kräver hemskärmsapp</strong><br>
        Pushnotiser fungerar bara när CRM är installerat via Safari → Dela → Lägg till på hemskärmen.<br>
        Öppna appen därifrån och kom sedan hit för att aktivera notiser.
      </div>` : '';

    const deniedNote = pState === 'denied' ? `
      <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:12px 14px;margin-bottom:14px;font-size:12px;line-height:1.6;">
        ${ic('x-circle',14)} <strong>Notiser blockerade av systemet</strong><br>
        Du har nekat notisbehörighet. Gå till ${pIOS ? 'iPhone-inställningar → VIFT CRM → Notiser' : 'webbläsarens webbplatsinställningar'} och tillåt notiser.
      </div>` : '';

    const vapidNote = !pKey ? `
      <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:12px 14px;margin-bottom:14px;font-size:12px;line-height:1.8;">
        ${ic('key',14)} <strong>VAPID-nyckel saknas — notiser kan inte aktiveras</strong><br>
        <code>window.VIFT_CONFIG.vapidPublicKey</code> är tom i <code>config.js</code> på servern.<br><br>
        <strong>Åtgärda i 4 steg:</strong><br>
        1. Generera nyckelpar: <code>npx web-push generate-vapid-keys --json</code><br>
        2. Kopiera <code>publicKey</code>-värdet (börjar med B…)<br>
        3. Redigera <code>config.js</code> på Loopia: <code>vapidPublicKey: 'B...'</code><br>
        4. Ladda upp filen och ladda om sidan<br><br>
        <button class="btn bs bsm" onclick="location.reload()" style="margin-right:8px;">${ic('refresh-cw',12)} Ladda om sidan</button>
        <span style="font-size:11px;opacity:.7;">Klicka efter att config.js uppdaterats på servern</span>
      </div>` : '';

    const canAct = pSupp && (!pIOS || pSA) && pKey && pState !== 'denied';

    sections.notiser = `
      <div class="card">
        <div class="card-header" style="gap:10px;">
          <div>${ic('bell',16)} Mobilnotiser</div>
          ${statusBadge()}
        </div>
        <div class="card-body" style="padding:14px 16px;">

          ${iosNote}${deniedNote}${vapidNote}

          <!-- Info-rutor -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;">
            <div style="background:var(--bg);border-radius:8px;padding:10px 12px;">
              <div style="font-size:10px;color:var(--mt);font-weight:700;text-transform:uppercase;margin-bottom:3px;">Push API</div>
              <div style="font-size:12px;font-weight:700;">${pSupp ? '✓ Stödd' : '✗ Saknas'}</div>
            </div>
            <div style="background:var(--bg);border-radius:8px;padding:10px 12px;">
              <div style="font-size:10px;color:var(--mt);font-weight:700;text-transform:uppercase;margin-bottom:3px;">Appläge</div>
              <div style="font-size:12px;font-weight:700;">${pSA ? '✓ Hemskärmsapp' : '○ Browser'}</div>
            </div>
            <div style="background:var(--bg);border-radius:8px;padding:10px 12px;">
              <div style="font-size:10px;color:var(--mt);font-weight:700;text-transform:uppercase;margin-bottom:3px;">Behörighet</div>
              <div style="font-size:12px;font-weight:700;">${
                pState === 'granted' ? '✓ Tillåten'
                : pState === 'denied' ? '✗ Blockerad'
                : '— Ej frågad'}</div>
            </div>
            <div style="background:var(--bg);border-radius:8px;padding:10px 12px;">
              <div style="font-size:10px;color:var(--mt);font-weight:700;text-transform:uppercase;margin-bottom:3px;">VAPID-nyckel</div>
              <div style="font-size:12px;font-weight:700;">${pKey ? '✓ Konfigurerad' : '✗ Saknas'}</div>
            </div>
          </div>

          <!-- Åtgärder -->
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:16px;">
            ${canAct ? `
              <button class="btn bp bsm" onclick="AdminPage._activatePush()">
                ${ic('bell',13)} Aktivera notiser
              </button>
              <button class="btn bs bsm" onclick="AdminPage._testPush()">
                ${ic('send',13)} Skicka testnotis
              </button>
              <button class="btn bd bsm" onclick="AdminPage._deactivatePush()">
                ${ic('bell-off',13)} Stäng av
              </button>
            ` : `
              <button class="btn bp bsm" disabled style="opacity:.4;cursor:not-allowed;">
                ${ic('bell',13)} Aktivera notiser
              </button>
              <span style="font-size:11px;color:var(--mt);">${
                pReason === 'no-vapid-key'       ? 'VAPID-nyckel saknas i config.js — se instruktion ovan' :
                pReason === 'ios-not-standalone' ? 'Öppna appen från hemskärmen, inte i Safari' :
                pReason === 'permission-denied'  ? 'Behörighet blockerad — ändra i systeminställningarna' :
                pReason === 'unsupported'        ? 'Push API stöds ej i den här browsern/OS-versionen' :
                'Kan ej aktivera just nu'
              }</span>
            `}
          </div>

          <div id="push-status-msg" style="font-size:12px;margin-bottom:12px;"></div>

          <!-- Enhetsinformation -->
          <div style="font-size:11px;color:var(--mt);">
            ${pIOS ? 'iOS' : navigator.platform || navigator.userAgent.split(' ').pop()} · ${
              (() => { const ua = navigator.userAgent;
                return /CriOS/i.test(ua) ? 'Chrome (iOS)' :
                       /FxiOS/i.test(ua) ? 'Firefox (iOS)' :
                       /Safari/i.test(ua) && !/Chrome/i.test(ua) ? 'Safari' :
                       /Chrome/i.test(ua) ? 'Chrome' : 'Okänd browser'; })()
            }
          </div>

          <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--br);font-size:11px;color:var(--mt);line-height:1.8;">
            ${ic('info',11)} Pushnotiser skickas när en AO tilldelas dig eller vid viktiga händelser.
            Notisen visas även när appen är stängd. iOS 16.4+ krävs på iPhone.<br>
            ${ic('refresh-cw',10)} <strong>Gammal version?</strong> Öppna webbläsarens inställningar → Rensa webbplatsdata för crm.viftfast.se → Ladda om.
          </div>
        </div>
      </div>`;

    const propCats = (state.propertyCategories || []).sort((a,b) => (a.order||99)-(b.order||99));
    sections.fastighetskort = `
      <div class="admin-section-group">
        <div class="admin-section-header">
          <div class="admin-section-icon" style="background:#eff6ff;color:var(--blue);">${ic('building-2',18)}</div>
          <div>
            <div class="admin-section-title">Fastighetskortets kategorier</div>
            <div class="admin-section-desc">Tekniska systemkategorier som visas i fastighetskort</div>
          </div>
        </div>
        <div style="padding:8px 16px 4px;display:flex;justify-content:flex-end;">
          <button class="btn bp bxs" onclick="AdminPage.openAddCategory()">${ic('plus',13)} Ny kategori</button>
        </div>
        ${propCats.length === 0
          ? `<div style="padding:16px;font-size:12px;color:var(--mt);">Inga kategorier. Ladda om sidan för att läsa in standardkategorier.</div>`
          : propCats.map(cat => {
            const activeFields = (cat.fields||[]).filter(f=>f.active!==false).length;
            const totalFields  = (cat.fields||[]).length;
            return `
            <div style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-top:1px solid var(--br);">
              <span style="color:var(--mt);flex-shrink:0;">${ic(cat.icon||'folder',16)}</span>
              <div style="flex:1;min-width:0;">
                <div style="font-size:13px;font-weight:700;color:var(--navy);">${esc(cat.label)}</div>
                <div style="font-size:10px;color:var(--mt);">slug: ${esc(cat.slug)} · ${activeFields}/${totalFields} fält aktiva</div>
              </div>
              <span class="bdg ${cat.active!==false?'bdg-green':'bdg-grey'}" style="font-size:9px;">${cat.active!==false?'Aktiv':'Inaktiv'}</span>
              <button class="btn bxs bs" style="font-size:11px;" onclick="AdminPage.openManageFields('${cat.id}')">${ic('list',12)} Fält</button>
              <button class="btn bxs bs" onclick="AdminPage.openEditCategory('${cat.id}')">${ic('pencil',12)}</button>
            </div>`;
          }).join('')}
      </div>`;

    /* ── Ansvariga: titelregister (Leverans D) ──────────── */
    const propRoles = state.propertyRoles || [];
    sections.ansvariga = `
      <div class="admin-section-group">
        <div class="admin-section-header">
          <div>
            <div class="admin-section-title">${ic('user-check',16)} Titelregister — ansvariga per fastighet</div>
            <div class="admin-section-desc">Roller som kan kopplas till personal och kontakter per fastighet/objekt</div>
          </div>
          <button class="btn bp bxs" onclick="AdminPage.openAddPropRole()">${ic('plus',13)} Ny titel</button>
        </div>
        ${propRoles.length === 0
          ? `<div style="padding:16px;font-size:12px;color:var(--mt);">Inga titlar. Lägg till t.ex. Ansvarig förvaltare, Fastighetsskötare, Felanmälningskontakt.</div>`
          : propRoles.map(r => `
            <div style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-top:1px solid var(--br);">
              <div style="flex:1;min-width:0;">
                <div style="font-size:13px;font-weight:700;">${esc(r.name)}</div>
                <div style="font-size:10px;color:var(--mt);">${r.scope==='property'?'Fastighet':r.scope==='object'?'Objekt':'Fastighet & objekt'}${r.isInternal?'':' · Extern'}${r.onlyOnePrimary?' · Max 1 primär':''}</div>
              </div>
              <span class="bdg ${r.active!==false?'bdg-green':'bdg-grey'}" style="font-size:9px;">${r.active!==false?'Aktiv':'Inaktiv'}</span>
              <button class="btn bxs bs" onclick="AdminPage.openEditPropRole('${r.id}')">${ic('pencil',11)}</button>
              <button class="btn bxs ${r.active!==false?'bw':'bsu'}" onclick="AdminPage.togglePropRole('${r.id}')">${r.active!==false?ic('eye-off',11)+' Inaktivera':ic('eye',11)+' Aktivera'}</button>
            </div>`).join('')}
      </div>`;

    /* ── Avvikelsekategorier (Fas 4B) ──────────────────── */
    const devCats = state.deviationCategories || [];
    sections.avvikelse = `
      <div class="admin-section-group">
        <div class="admin-section-header">
          <div>
            <div class="admin-section-title">${ic('alert-triangle',16)} Avvikelsekategorier</div>
            <div class="admin-section-desc">Kategorier för strukturerade anmärkningar från ronderingar</div>
          </div>
          <button class="btn bp bxs" onclick="AdminPage.openAddDevCat()">${ic('plus',13)} Ny kategori</button>
        </div>
        ${devCats.length === 0
          ? `<div style="padding:16px;font-size:12px;color:var(--mt);">Inga avvikelsekategorier ännu. Skapa din första kategori.</div>`
          : devCats.map((c, idx) => `
            <div style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-top:1px solid var(--br);">
              <span style="color:${c.color||'var(--acc)'};flex-shrink:0;">${ic(c.icon||'alert-triangle',16)}</span>
              <div style="flex:1;min-width:0;">
                <div style="font-size:13px;font-weight:700;">${esc(c.name)}</div>
              </div>
              <span class="bdg ${c.active!==false?'bdg-green':'bdg-grey'}" style="font-size:9px;">${c.active!==false?'Aktiv':'Inaktiv'}</span>
              <button class="btn bxs bs" onclick="AdminPage.openEditDevCat('${c.id}')">${ic('pencil',11)}</button>
              <button class="btn bxs ${c.active!==false?'bw':'bsu'}" onclick="AdminPage.toggleDevCat('${c.id}')">${c.active!==false?ic('eye-off',11)+' Inaktivera':ic('eye',11)+' Aktivera'}</button>
            </div>`).join('')}
      </div>`;

    /* ── Punkt 80: E-post-mallar ───────────────────────────── */
    const tmpls = (state.emailTemplates || []).sort((a,b)=>(a.sortOrder||99)-(b.sortOrder||99));
    sections.epost = `
      <div class="admin-section-group">
        <div class="admin-section-header">
          <div>
            <div class="admin-section-title">${ic('mail',16)} E-post-mallar</div>
            <div class="admin-section-desc">Mallar för offertutskick, påminnelser och bekräftelser. Variabler: {{firstName}}, {{offerId}}, {{validUntil}}, {{viftPhone}} m.fl.</div>
          </div>
          <button class="btn bp bxs" onclick="AdminPage.openEditEmailTemplate(null)">${ic('plus',13)} Ny mall</button>
        </div>
        ${tmpls.length === 0
          ? `<div style="padding:16px;font-size:12px;color:var(--mt);">Inga e-post-mallar. Skapa din första mall.</div>`
          : tmpls.map(t => `
            <div style="display:flex;align-items:start;gap:8px;padding:12px 16px;border-top:1px solid var(--br);">
              <div style="flex:1;min-width:0;">
                <div style="font-size:13px;font-weight:600;">${esc(t.name||'Namnlös mall')}</div>
                <div style="font-size:11px;color:var(--mt);margin-top:2px;">${esc(t.subject||'')}</div>
                <div style="font-size:11px;color:var(--mt);margin-top:4px;white-space:pre-wrap;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${esc((t.body||'').slice(0,120))}</div>
              </div>
              <div style="display:flex;gap:4px;flex-shrink:0;margin-top:2px;">
                <span class="bdg ${t.active!==false?'bdg-green':'bdg-grey'}" style="font-size:9px;">${t.active!==false?'Aktiv':'Inaktiv'}</span>
                <button class="btn bxs bs" onclick="AdminPage.openEditEmailTemplate('${esc(t.id)}')">${ic('pencil',11)}</button>
                <button class="btn bxs ${t.active!==false?'bw':'bsu'}" onclick="AdminPage.toggleEmailTemplate('${esc(t.id)}')">${t.active!==false?ic('eye-off',11)+' Inaktivera':ic('eye',11)+' Aktivera'}</button>
              </div>
            </div>`).join('')}
      </div>`;

    el.innerHTML = tabBar + (sections[this._tab] || sections.foretag);
  },

  /* ── E-post-mallar CRUD (Punkt 80) ──────────────────────── */
  openEditEmailTemplate(id) {
    const t = id ? (state.emailTemplates||[]).find(x=>x.id===id) : null;
    const isNew = !t;
    const typeOpts = [
      { key:'send_offer',  label:'Skicka offert'           },
      { key:'reminder',    label:'Påminnelse offert'       },
      { key:'approved',    label:'Tack för godkännande'    },
      { key:'followup',    label:'Uppföljning'             },
      { key:'declined',    label:'Tack för återkoppling'   },
      { key:'new_ao',      label:'Ny arbetsorder (intern)' },
      { key:'övrigt',      label:'Övrigt'                  }
    ].map(x=>`<option value="${x.key}"${(t?.type||'övrigt')===x.key?' selected':''}>${x.label}</option>`).join('');

    Modal.open({
      title: isNew ? ic('mail',13) + ' Ny e-post-mall' : ic('pencil',13) + ' Redigera e-post-mall',
      body: `<div style="display:flex;flex-direction:column;gap:12px;">
        <div style="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:end;">
          <div class="fg"><label>Mallnamn *</label><input class="form-control" id="et-name" value="${esc(t?.name||'')}" placeholder="Namn på mallen"></div>
          <div class="fg"><label>Typ</label><select class="form-control" id="et-type">${typeOpts}</select></div>
        </div>
        <div class="fg"><label>Ämnesrad *</label><input class="form-control" id="et-subj" value="${esc(t?.subject||'')}" placeholder="Ämnesrad med {{variabler}}"></div>
        <div class="fg">
          <label>Meddelandetext *</label>
          <textarea class="form-control" id="et-body" rows="10" style="font-family:monospace;font-size:12px;">${esc(t?.body||'')}</textarea>
          <div style="font-size:10px;color:var(--mt);margin-top:4px;">Tillgängliga variabler: <code>{{firstName}}</code> <code>{{offerId}}</code> <code>{{titleSuffix}}</code> <code>{{validUntil}}</code> <code>{{sentDate}}</code> <code>{{paymentLine}}</code> <code>{{viftPhone}}</code></div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;font-size:12px;">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="checkbox" id="et-active" ${t?.active!==false?'checked':''}> Aktiv</label>
          <div class="fg" style="margin:0;display:flex;align-items:center;gap:6px;">
            <label style="margin:0;">Sortering</label>
            <input type="number" class="form-control" id="et-sort" value="${t?.sortOrder||99}" min="1" max="999" style="width:70px;">
          </div>
        </div>
      </div>`,
      okLabel: isNew ? 'Skapa mall' : 'Spara',
      ok: () => {
        const name = document.getElementById('et-name')?.value.trim();
        const subj = document.getElementById('et-subj')?.value.trim();
        const body = document.getElementById('et-body')?.value;
        if (!name || !subj || !body) { showToast('Namn, ämne och text krävs', 'error'); return; }
        const now = new Date().toISOString();
        if (t) {
          t.name      = name;
          t.type      = document.getElementById('et-type')?.value   || 'övrigt';
          t.subject   = subj;
          t.body      = body;
          t.active    = document.getElementById('et-active')?.checked !== false;
          t.sortOrder = parseInt(document.getElementById('et-sort')?.value||'99',10);
          t.updatedAt = now;
        } else {
          if (!state.emailTemplates) state.emailTemplates = [];
          state.emailTemplates.push({
            id:        newId(state.emailTemplates, 'ET'),
            name,
            type:      document.getElementById('et-type')?.value || 'övrigt',
            subject:   subj,
            body,
            active:    document.getElementById('et-active')?.checked !== false,
            sortOrder: parseInt(document.getElementById('et-sort')?.value||'99',10),
            createdAt: now,
            updatedAt: now
          });
        }
        persist();
        Modal.close();
        AdminPage._tab = 'epost';
        AdminPage.render();
        showToast(t ? 'Mall sparad' : 'Mall skapad');
      }
    });
  },

  toggleEmailTemplate(id) {
    const t = (state.emailTemplates||[]).find(x=>x.id===id);
    if (!t) return;
    t.active    = !t.active;
    t.updatedAt = new Date().toISOString();
    persist();
    AdminPage._tab = 'epost';
    AdminPage.render();
    showToast(t.active ? 'Mall aktiverad' : 'Mall inaktiverad');
  },

  /* ── Avvikelsekategorier CRUD ────────────────────────── */

  openAddDevCat() {
    this._devCatForm(null);
  },

  openEditDevCat(id) {
    const c = (state.deviationCategories || []).find(x => x.id === id);
    if (c) this._devCatForm(c);
  },

  _devCatForm(cat) {
    const isEdit = !!cat;
    Modal.open({
      title: isEdit ? 'Redigera avvikelsekategori' : 'Ny avvikelsekategori',
      body: `
        <div class="fg"><label>Namn *</label>
          <input type="text" id="dc-name" value="${cat ? esc(cat.name) : ''}" placeholder="T.ex. Säkerhet, Skada, Slitage..."></div>
        <div class="fg"><label>Ikon (lucide-namn)</label>
          <input type="text" id="dc-icon" value="${cat ? esc(cat.icon||'alert-triangle') : 'alert-triangle'}" placeholder="alert-triangle"></div>
        <div class="fg"><label>Färg</label>
          <input type="color" id="dc-color" value="${cat ? (cat.color||'#6366f1') : '#6366f1'}" style="height:36px;width:60px;border:none;cursor:pointer;border-radius:6px;">
        </div>`,
      buttons: [
        { label: isEdit ? 'Spara' : 'Skapa', cls: 'btn bp', onClick: () => this._saveDevCat(cat ? cat.id : null) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _saveDevCat(id) {
    const name  = ((document.getElementById('dc-name')||{}).value||'').trim();
    if (!name) { showToast('Ange namn'); return; }
    const icon  = ((document.getElementById('dc-icon')||{}).value||'alert-triangle').trim();
    const color = (document.getElementById('dc-color')||{}).value || '#6366f1';
    const now   = new Date().toISOString();
    if (id) {
      const c = (state.deviationCategories || []).find(x => x.id === id);
      if (c) { c.name = name; c.icon = icon; c.color = color; c.updatedAt = now; }
    } else {
      if (!state.deviationCategories) state.deviationCategories = [];
      state.deviationCategories.push(Object.assign(Schema.deviationCategory(), {
        id: newId(state.deviationCategories, 'DEVCAT'), name, icon, color, createdAt: now, updatedAt: now
      }));
    }
    persist();
    Modal.close();
    this.render();
  },

  toggleDevCat(id) {
    const c = (state.deviationCategories || []).find(x => x.id === id);
    if (!c) return;
    c.active = !c.active;
    c.updatedAt = new Date().toISOString();
    persist();
    this.render();
  },

  /* ── Titelregister för ansvariga (Leverans D) ────────────── */

  openAddPropRole() { this._propRoleForm(null); },
  openEditPropRole(id) {
    const r = (state.propertyRoles || []).find(x => x.id === id);
    if (r) this._propRoleForm(r);
  },
  _propRoleForm(role) {
    const isEdit = !!role;
    Modal.open({
      title: isEdit ? 'Redigera titel' : 'Ny ansvarstitel',
      body: `
        <div class="fg"><label>Namn *</label>
          <input type="text" id="pr-name" value="${role ? esc(role.name) : ''}" placeholder="T.ex. Ansvarig förvaltare...">
        </div>
        <div class="fg"><label>Beskrivning</label>
          <input type="text" id="pr-desc" value="${role ? esc(role.description||'') : ''}" placeholder="Valfri beskrivning...">
        </div>
        <div class="fg"><label>Tillämpning</label>
          <select id="pr-scope" class="fi">
            <option value="property" ${!role||role.scope==='property'?'selected':''}>Fastighet</option>
            <option value="object" ${role&&role.scope==='object'?'selected':''}>Objekt</option>
            <option value="both" ${role&&role.scope==='both'?'selected':''}>Fastighet & objekt</option>
          </select>
        </div>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;margin-top:6px;">
          <input type="checkbox" id="pr-primary" ${role&&role.onlyOnePrimary?'checked':''}> Max 1 primär per fastighet
        </label>`,
      buttons: [
        { label: isEdit ? 'Spara' : 'Skapa', cls: 'btn bp', onClick: () => this._savePropRole(role ? role.id : null) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },
  _savePropRole(id) {
    const name = ((document.getElementById('pr-name')||{}).value||'').trim();
    if (!name) { showToast('Ange namn'); return; }
    const desc         = (document.getElementById('pr-desc')||{}).value||'';
    const scope        = (document.getElementById('pr-scope')||{}).value||'property';
    const onlyOnePrimary = !!(document.getElementById('pr-primary')||{}).checked;
    const data = { name, description: desc, scope, onlyOnePrimary };
    if (id) {
      PropertyContactService.updateRole(id, data);
    } else {
      PropertyContactService.createRole(data);
    }
    Modal.close();
    this.render();
  },
  togglePropRole(id) {
    PropertyContactService.toggleRoleActive(id);
    this.render();
  },

  /* ── Fält-CRUD per kategori ──────────────────────────────── */

  _labelToKey(label) {
    const latin = label.toLowerCase()
      .replace(/å/g,'a').replace(/ä/g,'a').replace(/ö/g,'o')
      .replace(/[^a-z0-9\s]/g,' ').trim().replace(/\s+/g,' ');
    const words = latin.split(' ').filter(Boolean);
    if (!words.length) return 'field';
    return words[0] + words.slice(1).map(w => w[0].toUpperCase() + w.slice(1)).join('');
  },

  _fieldTypeLabel(t) {
    return { text:'Text',textarea:'Lång text',date:'Datum',number:'Nummer',boolean:'Ja/Nej',
             dropdown:'Lista',link:'Länk',phone:'Telefon',email:'E-post',
             interval:'Intervall',status:'Status',comment:'Kommentar' }[t] || t;
  },

  _fieldHasData(catSlug, fieldKey) {
    return (state.properties||[]).some(p => {
      const t = (p.technicalSystems||{})[catSlug];
      if (!t || typeof t !== 'object') return false;
      return t[fieldKey] !== undefined && t[fieldKey] !== null && t[fieldKey] !== '';
    });
  },

  openManageFields(catId) {
    const cat = (state.propertyCategories||[]).find(c => c.id === catId);
    if (!cat) return;
    if (!cat.fields) cat.fields = [];
    const fields = [...cat.fields].sort((a,b) => (a.order||99)-(b.order||99));
    const typeColors = { date:'bdg-sky',number:'bdg-sky',boolean:'bdg-purple',
                         dropdown:'bdg-purple',status:'bdg-purple',interval:'bdg-purple',
                         link:'bdg-blue',phone:'bdg-green',email:'bdg-green',
                         textarea:'bdg-grey',comment:'bdg-grey' };

    const rows = fields.length === 0
      ? `<p style="font-size:12px;color:var(--mt);padding:8px 0;">Inga fält ännu. Lägg till ett fält för att komma igång.</p>`
      : fields.map((f, idx) => {
          const hasData  = this._fieldHasData(cat.slug, f.key);
          const typeCls  = typeColors[f.type] || 'bdg-grey';
          const inactive = f.active === false;
          return `
          <div style="display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid var(--bg);${inactive?'opacity:.55;':''}">
            <div style="display:flex;flex-direction:column;gap:2px;flex-shrink:0;">
              <button class="btn bxs bs" style="padding:2px 5px;font-size:10px;line-height:1;" ${idx===0?'disabled':''} onclick="AdminPage._moveField('${catId}','${f.id}',-1)">${ic('chevron-up',10)}</button>
              <button class="btn bxs bs" style="padding:2px 5px;font-size:10px;line-height:1;" ${idx===fields.length-1?'disabled':''} onclick="AdminPage._moveField('${catId}','${f.id}',1)">${ic('chevron-down',10)}</button>
            </div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;font-weight:700;color:var(--navy);${inactive?'text-decoration:line-through;':''}">${esc(f.label)}</div>
              <div style="display:flex;align-items:center;gap:4px;margin-top:2px;flex-wrap:wrap;">
                <span class="bdg ${typeCls}" style="font-size:9px;">${this._fieldTypeLabel(f.type)}</span>
                <span style="font-size:9px;color:var(--mt);">key: ${esc(f.key)}</span>
                ${hasData ? `<span class="bdg bdg-orange" style="font-size:9px;">${ic('database',8)} Har data</span>` : ''}
                ${f.required ? `<span class="bdg bdg-red" style="font-size:9px;">Obligatorisk</span>` : ''}
                ${inactive ? `<span style="font-size:9px;color:var(--mt);">Inaktiv</span>` : ''}
              </div>
            </div>
            <button class="btn bxs bs" title="Duplicera" onclick="AdminPage._duplicateField('${catId}','${f.id}')">${ic('copy',11)}</button>
            <button class="btn bxs bs" title="Redigera" onclick="AdminPage.openEditField('${catId}','${f.id}')">${ic('pencil',11)}</button>
            ${inactive
              ? `<button class="btn bxs bs" title="Aktivera" onclick="AdminPage._toggleFieldActive('${catId}','${f.id}',true)">${ic('eye',11)}</button>`
              : `<button class="btn bxs bs" title="Inaktivera" onclick="AdminPage._toggleFieldActive('${catId}','${f.id}',false)">${ic('eye-off',11)}</button>`}
            <button class="btn bxs bd" title="${hasData?'Har data — inaktivera istället':'Ta bort'}" ${hasData?'disabled style="opacity:.4;"':''} onclick="AdminPage._deleteField('${catId}','${f.id}')">${ic('trash',11)}</button>
          </div>`;
        }).join('');

    Modal.open({
      title: `${ic('list',14)} Fält — ${esc(cat.label)}`,
      wide: true,
      body: `
        <div style="margin-bottom:10px;display:flex;justify-content:flex-end;">
          <button class="btn bp bxs" onclick="AdminPage.openAddField('${catId}')">${ic('plus',13)} Lägg till fält</button>
        </div>
        <div id="field-list-${catId}">${rows}</div>`,
      buttons: [{ label: 'Stäng', cls: 'btn bs', onClick: () => Modal.close() }]
    });
  },

  openAddField(catId) {
    const cat = (state.propertyCategories||[]).find(c => c.id === catId);
    if (!cat) return;
    const nextOrder = ((cat.fields||[]).reduce((m,f)=>Math.max(m,f.order||0),0)) + 1;
    const types = ['text','textarea','date','number','boolean','dropdown','link','phone','email','interval','status','comment'];
    Modal.open({
      title: `${ic('plus',14)} Nytt fält — ${esc(cat.label)}`,
      wide: true,
      body: `
        <div class="g2">
          <div class="fg"><label>Fältnamn (label)</label>
            <input id="fl-label" placeholder="T.ex. Senaste service"
              oninput="(function(){var k=AdminPage._labelToKey(document.getElementById('fl-label').value);document.getElementById('fl-key').value=k;})()">
          </div>
          <div class="fg"><label>Nyckel (key, stabil)</label>
            <input id="fl-key" placeholder="senasteService" style="font-family:monospace;font-size:12px;">
          </div>
        </div>
        <div class="g2">
          <div class="fg"><label>Fälttyp</label>
            <select id="fl-type" onchange="AdminPage._toggleOptionsField()">
              ${types.map(t=>`<option value="${t}">${this._fieldTypeLabel(t)}</option>`).join('')}
            </select>
          </div>
          <div class="fg"><label>Sorteringsordning</label>
            <input type="number" id="fl-order" value="${nextOrder}">
          </div>
        </div>
        <div class="fg" id="fl-options-wrap" style="display:none;">
          <label>Valalternativ (ett per rad, för Lista/Status)</label>
          <textarea id="fl-options" rows="4" placeholder="T.ex.&#10;Godkänd&#10;Ej utförd&#10;Planerad"></textarea>
        </div>
        <div style="display:flex;gap:16px;margin-top:4px;">
          <label style="display:flex;align-items:center;gap:6px;font-weight:600;cursor:pointer;font-size:13px;">
            <input type="checkbox" id="fl-active" checked> Aktiv
          </label>
          <label style="display:flex;align-items:center;gap:6px;font-weight:600;cursor:pointer;font-size:13px;">
            <input type="checkbox" id="fl-required"> Obligatorisk
          </label>
        </div>`,
      buttons: [
        { label: 'Spara fält', cls: 'btn bp', onClick: () => {
          const label   = document.getElementById('fl-label')?.value.trim();
          const key     = document.getElementById('fl-key')?.value.trim().replace(/[^a-zA-Z0-9_]/g,'');
          const type    = document.getElementById('fl-type')?.value || 'text';
          const order   = parseInt(document.getElementById('fl-order')?.value) || nextOrder;
          const active  = document.getElementById('fl-active')?.checked !== false;
          const required= !!document.getElementById('fl-required')?.checked;
          const optsRaw = document.getElementById('fl-options')?.value || '';
          const options = optsRaw.split('\n').map(s=>s.trim()).filter(Boolean);
          if (!label) { showToast('Fältnamn krävs'); return; }
          if (!key)   { showToast('Nyckel krävs (autogenereras från namn)'); return; }
          if (!cat.fields) cat.fields = [];
          if (cat.fields.some(f => f.key === key)) { showToast('Nyckel används redan i kategorin'); return; }
          const id = 'f-' + cat.slug + '-' + Date.now();
          cat.fields.push({ id, key, label, type, order, active, required, options });
          persist();
          Modal.close();
          AdminPage.openManageFields(catId);
          showToast('Fält tillagt');
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => AdminPage.openManageFields(catId) }
      ]
    });
    this._toggleOptionsField();
  },

  _toggleOptionsField() {
    const type = document.getElementById('fl-type')?.value;
    const wrap = document.getElementById('fl-options-wrap');
    if (wrap) wrap.style.display = ['dropdown','status'].includes(type) ? '' : 'none';
  },

  openEditField(catId, fieldId) {
    const cat   = (state.propertyCategories||[]).find(c => c.id === catId);
    const field = cat && (cat.fields||[]).find(f => f.id === fieldId);
    if (!cat || !field) return;
    const hasData = this._fieldHasData(cat.slug, field.key);
    const types   = ['text','textarea','date','number','boolean','dropdown','link','phone','email','interval','status','comment'];
    Modal.open({
      title: `${ic('pencil',14)} Redigera fält — ${esc(field.label)}`,
      wide: true,
      body: `
        <div class="g2">
          <div class="fg"><label>Fältnamn (label)</label>
            <input id="fl-label" value="${esc(field.label)}">
          </div>
          <div class="fg"><label>Nyckel (låst — ändra bryter befintlig data)</label>
            <input id="fl-key" value="${esc(field.key)}" disabled style="opacity:.5;background:var(--bg);font-family:monospace;font-size:12px;">
          </div>
        </div>
        <div class="g2">
          <div class="fg"><label>Fälttyp</label>
            <select id="fl-type" onchange="AdminPage._toggleOptionsField()">
              ${types.map(t=>`<option value="${t}" ${field.type===t?'selected':''}>${this._fieldTypeLabel(t)}</option>`).join('')}
            </select>
          </div>
          <div class="fg"><label>Sorteringsordning</label>
            <input type="number" id="fl-order" value="${field.order||99}">
          </div>
        </div>
        <div class="fg" id="fl-options-wrap" style="display:${['dropdown','status'].includes(field.type)?'':'none'};">
          <label>Valalternativ (ett per rad)</label>
          <textarea id="fl-options" rows="4">${esc((field.options||[]).join('\n'))}</textarea>
        </div>
        ${hasData ? `<div class="nbox" style="margin-top:6px;font-size:11px;">${ic('database',11)} Detta fält har data i ${(state.properties||[]).filter(p=>{const t=(p.technicalSystems||{})[cat.slug];return t&&typeof t==='object'&&t[field.key];}).length} fastighet(er). Ändring av typ kan ge oväntad rendering.</div>` : ''}
        <div style="display:flex;gap:16px;margin-top:4px;">
          <label style="display:flex;align-items:center;gap:6px;font-weight:600;cursor:pointer;font-size:13px;">
            <input type="checkbox" id="fl-active" ${field.active!==false?'checked':''}> Aktiv
          </label>
          <label style="display:flex;align-items:center;gap:6px;font-weight:600;cursor:pointer;font-size:13px;">
            <input type="checkbox" id="fl-required" ${field.required?'checked':''}> Obligatorisk
          </label>
        </div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => {
          const label   = document.getElementById('fl-label')?.value.trim();
          const type    = document.getElementById('fl-type')?.value || field.type;
          const order   = parseInt(document.getElementById('fl-order')?.value) || field.order;
          const active  = document.getElementById('fl-active')?.checked !== false;
          const required= !!document.getElementById('fl-required')?.checked;
          const optsRaw = document.getElementById('fl-options')?.value || '';
          const options = optsRaw.split('\n').map(s=>s.trim()).filter(Boolean);
          if (!label) { showToast('Fältnamn krävs'); return; }
          Object.assign(field, { label, type, order, active, required, options });
          persist();
          Modal.close();
          AdminPage.openManageFields(catId);
          showToast('Fält uppdaterat');
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => AdminPage.openManageFields(catId) }
      ]
    });
    this._toggleOptionsField();
  },

  _toggleFieldActive(catId, fieldId, active) {
    const cat   = (state.propertyCategories||[]).find(c => c.id === catId);
    const field = cat && (cat.fields||[]).find(f => f.id === fieldId);
    if (!field) return;
    field.active = active;
    persist();
    AdminPage.openManageFields(catId);
    showToast(active ? 'Fält aktiverat' : 'Fält inaktiverat');
  },

  _deleteField(catId, fieldId) {
    const cat = (state.propertyCategories||[]).find(c => c.id === catId);
    if (!cat) return;
    const field = (cat.fields||[]).find(f => f.id === fieldId);
    if (!field) return;
    if (this._fieldHasData(cat.slug, field.key)) {
      showToast('Fältet har data — inaktivera istället för att bevara data');
      return;
    }
    cat.fields = (cat.fields||[]).filter(f => f.id !== fieldId);
    persist();
    AdminPage.openManageFields(catId);
    showToast('Fält borttaget');
  },

  _moveField(catId, fieldId, dir) {
    const cat = (state.propertyCategories||[]).find(c => c.id === catId);
    if (!cat || !cat.fields) return;
    const sorted = [...cat.fields].sort((a,b) => (a.order||99)-(b.order||99));
    const idx = sorted.findIndex(f => f.id === fieldId);
    if (idx < 0) return;
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const aOrd = sorted[idx].order || (idx + 1);
    const bOrd = sorted[swapIdx].order || (swapIdx + 1);
    sorted[idx].order    = bOrd;
    sorted[swapIdx].order = aOrd;
    persist();
    AdminPage.openManageFields(catId);
  },

  _duplicateField(catId, fieldId) {
    const cat   = (state.propertyCategories||[]).find(c => c.id === catId);
    const field = cat && (cat.fields||[]).find(f => f.id === fieldId);
    if (!cat || !field) return;
    const maxOrder = (cat.fields||[]).reduce((m,f)=>Math.max(m,f.order||0),0);
    const baseKey  = field.key + '_kopia';
    let newKey = baseKey;
    let n = 2;
    while ((cat.fields||[]).some(f => f.key === newKey)) { newKey = baseKey + n; n++; }
    const newField = Object.assign({}, field, {
      id:    'f-' + cat.slug + '-' + Date.now(),
      key:   newKey,
      label: field.label + ' (kopia)',
      order: maxOrder + 1
    });
    cat.fields.push(newField);
    persist();
    AdminPage.openManageFields(catId);
    showToast('Fält duplicerat');
  },

  openAddCategory() {
    Modal.open({
      title: `${ic('plus',14)} Ny kategori`,
      body: `
        <div class="g2">
          <div class="fg"><label>Namn</label><input id="cat-label" placeholder="T.ex. Hiss"></div>
          <div class="fg"><label>Slug (unikt ID)</label><input id="cat-slug" placeholder="elevator"></div>
        </div>
        <div class="g2">
          <div class="fg"><label>Ikon (Lucide-namn)</label><input id="cat-icon" placeholder="folder" value="folder"></div>
          <div class="fg"><label>Sorteringsordning</label><input type="number" id="cat-order" value="${(state.propertyCategories||[]).length+1}"></div>
        </div>
        <div class="fg" style="margin-top:4px;">
          <label style="display:flex;align-items:center;gap:8px;font-weight:600;cursor:pointer;">
            <input type="checkbox" id="cat-active" checked> Aktiv (visas i fastighetskort)
          </label>
        </div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => {
          const label = document.getElementById('cat-label')?.value.trim();
          const slug  = document.getElementById('cat-slug')?.value.trim().toLowerCase().replace(/[^a-z0-9_]/g,'');
          const icon  = document.getElementById('cat-icon')?.value.trim() || 'folder';
          const order = parseInt(document.getElementById('cat-order')?.value) || 99;
          const active= document.getElementById('cat-active')?.checked !== false;
          if (!label || !slug) { showToast('Namn och slug krävs'); return; }
          if ((state.propertyCategories||[]).some(c => c.slug === slug)) { showToast('Slug redan används'); return; }
          const cats = state.propertyCategories || [];
          cats.push({ id: 'cat-'+slug, slug, label, icon, order, active, showByDefault: active, fields: [] });
          state.propertyCategories = cats;
          persist();
          Modal.close();
          AdminPage.render();
          showToast('Kategori skapad');
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  openEditCategory(catId) {
    const cat = (state.propertyCategories||[]).find(c => c.id === catId);
    if (!cat) return;
    Modal.open({
      title: `${ic('pencil',14)} Redigera kategori`,
      body: `
        <div class="g2">
          <div class="fg"><label>Namn</label><input id="cat-label" value="${esc(cat.label)}"></div>
          <div class="fg"><label>Slug (låst)</label><input id="cat-slug" value="${esc(cat.slug)}" disabled style="opacity:.5;background:var(--bg);"></div>
        </div>
        <div class="g2">
          <div class="fg"><label>Ikon (Lucide-namn)</label><input id="cat-icon" value="${esc(cat.icon||'folder')}"></div>
          <div class="fg"><label>Sorteringsordning</label><input type="number" id="cat-order" value="${cat.order||99}"></div>
        </div>
        <div class="fg" style="margin-top:4px;">
          <label style="display:flex;align-items:center;gap:8px;font-weight:600;cursor:pointer;">
            <input type="checkbox" id="cat-active" ${cat.active!==false?'checked':''}> Aktiv (visas i fastighetskort)
          </label>
        </div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => {
          const label = document.getElementById('cat-label')?.value.trim();
          const icon  = document.getElementById('cat-icon')?.value.trim() || 'folder';
          const order = parseInt(document.getElementById('cat-order')?.value) || 99;
          const active= document.getElementById('cat-active')?.checked !== false;
          if (!label) { showToast('Namn krävs'); return; }
          Object.assign(cat, { label, icon, order, active });
          persist();
          Modal.close();
          AdminPage.render();
          showToast('Kategori sparad');
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  async _activatePush() {
    const msg = document.getElementById('push-status-msg');
    if (msg) msg.textContent = 'Aktiverar…';
    try {
      await PushService.subscribe();
      if (msg) msg.innerHTML = '<span style="color:var(--gr);">✓ Notiser aktiverade på den här enheten!</span>';
      AdminPage.render();
    } catch(e) {
      const text = e.message === 'permission-denied'
        ? 'Du nekade notisbehörighet. Tillåt i webbläsar-/systeminställningarna och försök igen.'
        : 'Fel: ' + e.message;
      if (msg) msg.innerHTML = '<span style="color:var(--rd);">' + text + '</span>';
    }
  },

  async _testPush() {
    const msg = document.getElementById('push-status-msg');
    const ok  = await PushService.isSubscribed();
    if (!ok) {
      if (msg) msg.innerHTML = '<span style="color:var(--rd);">Aktivera notiser först.</span>';
      return;
    }
    if (msg) msg.textContent = 'Skickar testnotis…';
    try {
      await PushService.sendTest();
      if (msg) msg.innerHTML = '<span style="color:var(--gr);">✓ Testnotis skickad — kolla din mobil!</span>';
    } catch(e) {
      if (msg) msg.innerHTML = '<span style="color:var(--rd);">Fel: ' + e.message + '</span>';
    }
  },

  async _deactivatePush() {
    const msg = document.getElementById('push-status-msg');
    if (msg) msg.textContent = 'Stänger av…';
    try {
      await PushService.unsubscribe();
      if (msg) msg.innerHTML = '<span style="color:var(--mt);">Notiser avstängda på den här enheten.</span>';
      AdminPage.render();
    } catch(e) {
      if (msg) msg.innerHTML = '<span style="color:var(--rd);">Fel: ' + e.message + '</span>';
    }
  },

  openEditCompany() {
    if (!Auth.require('admin_manage')) return;
    const s = state.settings || {};
    Modal.open({
      title: 'Företagsinformation',
      body: `
        <div class="fg"><label>Företagsnamn</label><input id="co-name" value="${s.companyName||''}"></div>
        <div class="fg"><label>Slogan / verksamhetsbeskrivning</label><input id="co-slogan" value="${s.slogan||''}" placeholder="Fastighetsservice & Förvaltning"></div>
        <div class="g2">
          <div class="fg"><label>Telefon</label><input id="co-phone" value="${s.companyPhone||''}" type="tel"></div>
          <div class="fg"><label>E-post</label><input id="co-email" value="${s.companyEmail||''}" type="email"></div>
        </div>
        <div class="fg"><label>Adress</label><input id="co-addr" value="${s.companyAddress||''}"></div>
        <div class="fg"><label>Webbsida</label><input id="co-web" value="${s.website||''}" type="url" placeholder="https://"></div>
        <div class="g2">
          <div class="fg"><label>Org.nr</label><input id="co-orgnr" value="${s.orgNr||''}"></div>
          <div class="fg"><label>Moms-nr</label><input id="co-vatnr" value="${s.vatNr||''}"></div>
        </div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => {
          state.settings = {
            ...state.settings,
            companyName:    document.getElementById('co-name')?.value.trim()   || s.companyName,
            slogan:         document.getElementById('co-slogan')?.value.trim() || '',
            companyPhone:   document.getElementById('co-phone')?.value.trim()  || '',
            companyEmail:   document.getElementById('co-email')?.value.trim()  || '',
            companyAddress: document.getElementById('co-addr')?.value.trim()   || '',
            website:        document.getElementById('co-web')?.value.trim()    || '',
            orgNr:          document.getElementById('co-orgnr')?.value.trim()  || '',
            vatNr:          document.getElementById('co-vatnr')?.value.trim()  || ''
          };
          persist(); Modal.close(); AdminPage.render(); showToast('Sparat');
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  openEditEkonomi() {
    if (!Auth.require('admin_manage')) return;
    const s = state.settings || {};
    Modal.open({
      title: `${ic('trending-up',15)} Ekonomi & Lönsamhet`,
      body: `
        <div class="fg">
          <label>Intern timkostnad (kr/h ex moms)</label>
          <input type="number" id="ek-rate" value="${s.internalHourlyCost || 250}" min="0" step="10" style="font-size:16px;font-weight:700;text-align:center;">
          <p style="font-size:11px;color:var(--mt);margin-top:6px;line-height:1.5;">Standardkostnad per timme för personalen. Används i lönsamhetsberäkningar internt — visas aldrig för kund i PDF eller e-post.</p>
        </div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => {
          const rate = parseFloat(document.getElementById('ek-rate')?.value) || 250;
          state.settings = Object.assign({}, state.settings, { internalHourlyCost: rate });
          persist(); Modal.close(); AdminPage.render();
          showToast(`Intern timkostnad: ${fmt(rate)} kr/h`);
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _uploadLogo(input, field) {
    const file = input.files && input.files[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { showToast('Filen är för stor (max 3 MB)'); return; }
    const reader = new FileReader();
    reader.onload = e => {
      BrandingService.update({ [field]: e.target.result });
      AdminPage.render();
      showToast('Logga uppladdad');
    };
    reader.onerror = () => showToast('Kunde inte läsa filen');
    reader.readAsDataURL(file);
  },

  _clearLogo(field) {
    BrandingService.clearLogo(field);
    AdminPage.render();
    showToast('Logga återställd till standard');
  },

  _saveColor(value, field) {
    BrandingService.update({ [field]: value });
  },

  showRoleStaff(roleId) {
    const role = (state.roles||[]).find(r => r.id === roleId);
    const staffList = (state.staff||[]).filter(s => s.role === roleId);
    if (!staffList.length) { showToast('Ingen personal med denna roll'); return; }
    Modal.open({
      title: `Personal med roll: ${role ? role.label : roleId}`,
      body: staffList.map(s => `
        <div class="crow">
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:700;">${s.firstName} ${s.lastName}</div>
            <div style="font-size:11px;color:var(--mt);">${s.title||''} ${s.email?'· '+s.email:''}</div>
          </div>
          <span class="bdg ${s.active?'bdg-green':'bdg-grey'}">${s.active?'Aktiv':'Inaktiv'}</span>
        </div>`).join(''),
      buttons: [{ label: 'Stäng', cls: 'btn bs', onClick: () => Modal.close() }]
    });
  },

  toggleRoleActive(roleId) {
    const r = (state.roles||[]).find(x => x.id === roleId);
    if (!r) return;
    // Guard: don't deactivate the last active admin-level role
    if (r.active !== false) {
      const activeAdmins = (state.roles||[]).filter(x => x.active !== false && (x.permissions||[]).includes('all'));
      if (activeAdmins.length <= 1 && (r.permissions||[]).includes('all')) {
        showToast('Kan inte inaktivera – det finns bara en admin-roll'); return;
      }
    }
    r.active = r.active === false ? true : false;
    persist(); AdminPage.render(); showToast(r.active ? 'Roll aktiverad' : 'Roll inaktiverad');
  },

  showTitleStaff(title) {
    const staffWithTitle = (state.staff||[]).filter(s => s.title === title);
    if (!staffWithTitle.length) { showToast('Ingen personal med denna titel'); return; }
    Modal.open({
      title: `Personal med titel: ${title}`,
      body: staffWithTitle.map(s => `
        <div class="crow" onclick="Modal.close();Router.showPage('pg-staff')">
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:700;">${s.firstName} ${s.lastName}</div>
            <div style="font-size:11px;color:var(--mt);">${s.email||''}</div>
          </div>
          <span class="bdg ${s.active?'bdg-green':'bdg-grey'}">${s.active?'Aktiv':'Inaktiv'}</span>
        </div>`).join(''),
      buttons: [{ label: 'Stäng', cls: 'btn bs', onClick: () => Modal.close() }]
    });
  },

  openAddTitle() {
    if (!Auth.require('admin_manage')) return;
    Modal.open({
      title: 'Lägg till titel',
      body: `
        <div class="fg"><label>Titel / yrkesroll <span style="color:var(--rd)">*</span></label>
          <input id="adm-title" placeholder="T.ex. Låssmed, VVS-tekniker…"
            onkeydown="if(event.key==='Enter'){event.preventDefault();document.getElementById('adm-title-desc')?.focus();}"></div>
        <div class="fg"><label>Beskrivning (valfritt)</label>
          <input id="adm-title-desc" placeholder="Kort beskrivning av yrkesrollen…"
            onkeydown="if(event.key==='Enter'){event.preventDefault();AdminPage._addTitle();}"></div>`,
      buttons: [
        { label: 'Lägg till', cls: 'btn bp', onClick: () => AdminPage._addTitle() },
        { label: 'Avbryt',   cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('adm-title')?.focus(), 80);
  },

  _addTitle() {
    const name = (document.getElementById('adm-title')?.value || '').trim();
    if (!name) { showToast('Ange en titel'); return; }
    if ((state.titles||[]).some(x => x.name.toLowerCase() === name.toLowerCase())) { showToast('Finns redan'); return; }
    const desc = (document.getElementById('adm-title-desc')?.value || '').trim();
    state.titles = state.titles || [];
    const newId_ = 'TIT-' + String(Date.now()).slice(-6);
    state.titles.push({ id: newId_, name, description: desc, active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    persist(); Modal.close(); AdminPage.render(); showToast(`"${name}" tillagd`);
  },

  openEditTitle(idx) {
    const t = (state.titles||[])[idx];
    if (!t) return;
    Modal.open({
      title: 'Redigera titel',
      body: `
        <div class="fg"><label>Titel / yrkesroll <span style="color:var(--rd)">*</span></label>
          <input id="adm-edit-title" value="${t.name}"
            onkeydown="if(event.key==='Enter'){event.preventDefault();document.getElementById('adm-edit-desc')?.focus();}"></div>
        <div class="fg"><label>Beskrivning</label>
          <input id="adm-edit-desc" value="${t.description||''}" placeholder="Kort beskrivning…"
            onkeydown="if(event.key==='Enter'){event.preventDefault();AdminPage._saveEditTitle(${idx});}"></div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => AdminPage._saveEditTitle(idx) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('adm-edit-title')?.focus(), 80);
  },

  _saveEditTitle(idx) {
    const name = (document.getElementById('adm-edit-title')?.value || '').trim();
    if (!name) { showToast('Ange en titel'); return; }
    const t = (state.titles||[])[idx];
    if (!t) return;
    const oldName = t.name;
    if (name.toLowerCase() !== oldName.toLowerCase() &&
        (state.titles||[]).some((x, i) => i !== idx && x.name.toLowerCase() === name.toLowerCase())) {
      showToast('Titeln finns redan'); return;
    }
    // Update staff records that had the old name
    (state.staff||[]).forEach(s => { if (s.title === oldName) s.title = name; });
    t.name = name;
    t.description = (document.getElementById('adm-edit-desc')?.value || '').trim();
    t.updatedAt = new Date().toISOString();
    persist(); Modal.close(); AdminPage.render(); showToast('Titel uppdaterad');
  },

  toggleTitleActive(idx) {
    const t = (state.titles||[])[idx];
    if (!t) return;
    t.active = !t.active;
    t.updatedAt = new Date().toISOString();
    persist(); AdminPage.render(); showToast(t.active ? 'Titel aktiverad' : 'Titel inaktiverad');
  },

  removeTitle(idx) {
    const t = (state.titles||[])[idx];
    if (!t) return;
    const usageCount = (state.staff||[]).filter(s => s.title === t.name).length;
    if (usageCount > 0) { showToast(`Kan inte ta bort – används av ${usageCount} person${usageCount===1?'':'er'}`); return; }
    if (!confirm(`Ta bort titeln "${t.name}"?`)) return;
    state.titles.splice(idx, 1);
    persist(); AdminPage.render(); showToast('Borttagen');
  },

  openAddRole() {
    if (!Auth.require('admin_manage')) return;
    Modal.open({
      title: 'Ny anpassad roll',
      body: `
        <div class="fg"><label>Roll-ID (unik nyckel) <span style="color:var(--rd)">*</span></label>
          <input id="role-id" placeholder="t.ex. konsult, vikarie, tekniker2…" autocomplete="off"
            oninput="this.value=this.value.toLowerCase().replace(/[^a-z0-9_]/g,'')"></div>
        <div class="fg"><label>Visningsnamn <span style="color:var(--rd)">*</span></label>
          <input id="role-label" placeholder="T.ex. Konsult, Vikarie…" autocomplete="off"></div>
        <div class="fg"><label>Beskrivning</label>
          <input id="role-desc" placeholder="Kort beskrivning av rollen och dess tillgång…"></div>`,
      buttons: [
        { label: 'Skapa roll', cls: 'btn bp', onClick: () => AdminPage._addRole() },
        { label: 'Avbryt',    cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('role-id')?.focus(), 80);
  },

  _addRole() {
    const id    = document.getElementById('role-id')?.value.trim();
    const label = document.getElementById('role-label')?.value.trim();
    if (!id || !label) { showToast('ID och visningsnamn krävs'); return; }
    if ((state.roles||[]).some(r => r.id === id)) { showToast('Roll-ID används redan'); return; }
    state.roles = state.roles || [];
    state.roles.push({
      id, label, isBuiltin: false, active: true,
      description: document.getElementById('role-desc')?.value.trim() || '',
      permissions: []
    });
    persist(); Modal.close(); AdminPage.render(); showToast(`Roll "${label}" skapad`);
  },

  _PERMISSIONS: [
    { id:'all',                label:'Alla behörigheter (superadmin)' },
    { id:'dashboard_view',     label:'Se dashboard' },
    { id:'ao_create',          label:'Skapa / redigera arbetsorder' },
    { id:'ao_complete',        label:'Klarmarkera arbetsorder' },
    { id:'ao_view_all',        label:'Se alla arbetsorder' },
    { id:'customer_manage',    label:'Hantera kunder' },
    { id:'offer_manage',       label:'Hantera offerter' },
    { id:'invoice_view',       label:'Se fakturaunderlag' },
    { id:'invoice_create',     label:'Skapa fakturaunderlag' },
    { id:'article_manage',     label:'Hantera artiklar & prisgrupper' },
    { id:'staff_view',         label:'Se personal' },
    { id:'staff_manage',       label:'Hantera personal' },
    { id:'admin_manage',       label:'Adminpanel & systeminställningar' },
    { id:'reports_view',       label:'Se rapporter (exkluderar löneunderlag)' },
    { id:'payroll_view',       label:'Se löneunderlag & exportera lönedata' },
    { id:'payroll_manage',     label:'Attestera och korrigera löneunderlag' },
    { id:'recurring_manage',   label:'Hantera återkommande ärenden' },
    { id:'sales_manage',       label:'Hantera säljchanser' },
    { id:'objects_sensitive',  label:'Visa känsliga fält (portkod, nyckel, larm)' }
  ],

  _PERM_LABELS: {
    'all':               'Superadmin – full åtkomst',
    'dashboard_view':    'Visa dashboard',
    'ao_view_all':       'Visa alla arbetsordrar',
    'ao_view_own':       'Visa egna arbetsordrar',
    'ao_create':         'Skapa arbetsordrar',
    'ao_edit':           'Redigera arbetsordrar',
    'ao_complete':       'Avsluta/slutföra arbetsordrar',
    'ao_time':           'Registrera tid',
    'ao_material':       'Registrera material',
    'ao_checklist':      'Hantera checklista',
    'customer_manage':   'Hantera kunder & fastigheter',
    'offer_manage':      'Hantera offerter',
    'invoice_view':      'Visa fakturaunderlag',
    'invoice_create':    'Skapa/redigera fakturaunderlag',
    'staff_view':        'Visa personal',
    'staff_manage':      'Hantera personal',
    'admin_manage':      'Systeminställningar & roller',
    'article_manage':    'Hantera artiklar & prisgrupper',
    'recurring_manage':  'Hantera återkommande ärenden',
    'sales_manage':      'Hantera säljchanser',
    'reports_view':      'Visa rapporter (exkluderar löneunderlag)',
    'payroll_view':      'Visa löneunderlag och exportera lönedata',
    'payroll_manage':    'Attestera, korrigera och bulkattestera tidposter',
    'objects_sensitive': 'Visa känsliga objektfält (portkod, nyckel, larm)',
  },

  _PERM_GROUPS: [
    { label: 'Superadmin',         perms: ['all'] },
    { label: 'Dashboard',          perms: ['dashboard_view'] },
    { label: 'Arbetsorder',        perms: ['ao_view_all','ao_view_own','ao_create','ao_edit','ao_complete','ao_time','ao_material','ao_checklist'] },
    { label: 'Kunder & Offerter',  perms: ['customer_manage','offer_manage'] },
    { label: 'Fakturering',        perms: ['invoice_view','invoice_create'] },
    { label: 'Personal & Admin',   perms: ['staff_view','staff_manage','admin_manage','article_manage'] },
    { label: 'Löner',              perms: ['payroll_view','payroll_manage'] },
    { label: 'Övrigt',             perms: ['recurring_manage','sales_manage','reports_view'] },
    { label: 'Säkerhet & Åtkomst', perms: ['objects_sensitive'] }
  ],

  openEditRole(roleId) {
    const r = (state.roles||[]).find(x => x.id === roleId);
    if (!r) return;
    const perms = r.permissions || [];
    const permMap = this._PERM_LABELS || {};

    const groupsHtml = this._PERM_GROUPS.map((g, gi) => {
      const groupCheckedCount = g.perms.filter(pid => perms.includes(pid)).length;
      const rows = g.perms.map(pid => `
        <label style="display:flex;align-items:center;gap:8px;padding:6px 0 6px 12px;border-bottom:1px solid var(--bg);cursor:pointer;">
          <input type="checkbox" name="role-perm" value="${pid}" ${perms.includes(pid)?'checked':''}
            style="width:15px;height:15px;flex-shrink:0;" onchange="AdminPage._onPermChange(this)">
          <span style="font-size:12px;">${permMap[pid]||pid}</span>
        </label>`).join('');
      return `
        <div style="margin-top:8px;border:1px solid var(--br);border-radius:var(--rs);overflow:hidden;">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 10px;background:var(--bg);border-bottom:1px solid var(--br);">
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-size:11px;font-weight:700;color:var(--navy);text-transform:uppercase;letter-spacing:.4px;">${g.label}</span>
              <span class="bdg bdg-${groupCheckedCount>0?'sky':'grey'}" style="font-size:9px;">${groupCheckedCount}/${g.perms.length}</span>
            </div>
            <button type="button" class="btn bghost bxs" style="font-size:10px;padding:2px 7px;"
              onclick="AdminPage._togglePermGroup(${gi})">Markera alla</button>
          </div>
          ${rows}
        </div>`;
    }).join('');

    Modal.open({
      title: `Redigera roll: ${r.label}`,
      wide: true,
      body: `
        <div class="fg"><label>Visningsnamn</label>
          <input id="role-edit-label" value="${r.label}" ${r.isBuiltin?'readonly style="background:var(--bg);"':''}></div>
        <div class="fg"><label>Beskrivning</label>
          <input id="role-edit-desc" value="${r.description||''}" placeholder="Kort beskrivning…"></div>
        <div style="margin-top:4px;">
          <div style="font-size:11px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px;">Behörigheter</div>
          ${groupsHtml}
        </div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => AdminPage._saveEditRole(roleId) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _togglePermGroup(groupIdx) {
    const group = this._PERM_GROUPS[groupIdx];
    if (!group) return;
    const cbs = document.querySelectorAll('input[name="role-perm"]');
    const groupCbs = Array.from(cbs).filter(cb => group.perms.includes(cb.value));
    const allChecked = groupCbs.every(cb => cb.checked);
    groupCbs.forEach(cb => {
      cb.checked = !allChecked;
      this._onPermChange(cb);
    });
  },

  _onPermChange(checkbox) {
    if (checkbox.value === 'all' && checkbox.checked) {
      document.querySelectorAll('input[name="role-perm"]').forEach(cb => { cb.checked = cb.value === 'all'; });
    } else if (checkbox.value !== 'all' && checkbox.checked) {
      const allCb = document.querySelector('input[name="role-perm"][value="all"]');
      if (allCb) allCb.checked = false;
    }
  },

  _saveEditRole(roleId) {
    const idx = (state.roles||[]).findIndex(r => r.id === roleId);
    if (idx < 0) return;
    const label = document.getElementById('role-edit-label')?.value.trim();
    if (!label) { showToast('Visningsnamn krävs'); return; }
    const checked = Array.from(document.querySelectorAll('input[name="role-perm"]:checked')).map(cb => cb.value);
    state.roles[idx] = {
      ...state.roles[idx],
      label,
      description: document.getElementById('role-edit-desc')?.value.trim() || '',
      permissions: checked
    };
    persist(); Modal.close(); AdminPage.render();
    // Re-resolve logged-in user in case their role's permissions just changed
    Auth._resolveUser(); Sidebar.render();
    showToast('Roll uppdaterad — behörigheter träder i kraft direkt');
  },

  removeRole(roleId) {
    const usageCount = (state.staff||[]).filter(s => s.role === roleId).length;
    if (usageCount > 0) { showToast(`Kan inte ta bort – används av ${usageCount} person${usageCount===1?'':'er'}`); return; }
    if (!confirm('Ta bort rollen?')) return;
    state.roles = (state.roles||[]).filter(r => r.id !== roleId);
    persist(); AdminPage.render(); showToast('Roll borttagen');
  }
};

/* ── Shell-sidor utan rendering ───────── */
/* CalendarPage definieras i src/pages/CalendarPage.js */
/* ContractsPage definieras i src/pages/ContractsPage.js (Punkt 81) */
const InspectionsPage = { render() { RonderingPage.render(); } };
/* PayrollPage definieras i src/pages/PayrollPage.js (Punkt 76) */
/* ReportsPage definieras i src/pages/ReportsPage.js */

/* ── Hjälpfunktioner ──────────────────── */
function _shellEmpty(title, msg) {
  return `<div class="empty">${ic('settings',36)}<h3>${title}</h3><p>${msg}</p></div>`;
}

function _shellFull(title, msg) {
  return `
    <div class="card">
      <div class="card-header"><h3>${title}</h3></div>
      <div class="card-body"><div class="ibox">${msg}</div></div>
    </div>`;
}

function _renderShell(elId, title, msg) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = _shellFull(title, msg);
}

/* ── Aktiviteter ──────────────────────── */
const ActivitiesPage = {
  _filter: 'alla',

  render(params = {}) {
    const el = document.getElementById('pg-activities-content');
    if (!el) return;
    if (params.filter) this._filter = params.filter;

    const today     = tdy();
    const acts      = state.activities || [];
    const user      = state.currentUser;

    // Counts for filter tabs
    const overdueCnt  = acts.filter(a => a.status === 'open' && a.dueDate && a.dueDate < today).length;
    const todayCnt    = acts.filter(a => a.status === 'open' && a.dueDate === today).length;
    const upcomingCnt = acts.filter(a => a.status === 'open' && a.dueDate && a.dueDate > today).length;
    const minaCnt     = acts.filter(a => a.status === 'open' && user && a.assignedTo === user.id).length;

    const filter = this._filter;
    let filtered = acts;
    if (filter === 'mina')           filtered = acts.filter(a => a.status === 'open' && user && a.assignedTo === user.id);
    else if (filter === 'idag')      filtered = acts.filter(a => a.status === 'open' && a.dueDate === today);
    else if (filter === 'försenade') filtered = acts.filter(a => a.status === 'open' && a.dueDate && a.dueDate < today);
    else if (filter === 'kommande')  filtered = acts.filter(a => a.status === 'open' && a.dueDate && a.dueDate > today);
    else if (filter === 'klara')     filtered = acts.filter(a => a.status === 'done');
    else if (filter === 'offerter')  filtered = acts.filter(a => a.relatedType === 'offer');
    else if (filter === 'ao')        filtered = acts.filter(a => a.relatedType === 'workOrder');
    else filtered = acts.filter(a => a.status === 'open'); // 'alla' = all open

    // Sort: overdue first, then by date
    filtered = filtered.slice().sort((a,b) => {
      const ad = a.dueDate || '9999', bd = b.dueDate || '9999';
      return ad.localeCompare(bd);
    });

    const _tab = (key, label, cnt) =>
      `<button class="ft ${filter===key?'on':''}" onclick="ActivitiesPage._filter='${key}';ActivitiesPage.render()">${label}${cnt>0?` (${cnt})`:''}</button>`;

    const _item = (act) => {
      const isOverdue = act.status === 'open' && act.dueDate && act.dueDate < today;
      const isToday   = act.status === 'open' && act.dueDate === today;
      const isDone    = act.status === 'done';
      const staff     = getStaff(act.assignedTo);
      const staffName = staff ? `${staff.firstName} ${staff.lastName}` : '—';

      let relLink = '';
      if (act.relatedType === 'offer') {
        const off = getOff(act.relatedId);
        relLink = off ? `<a style="color:var(--blue);cursor:pointer;text-decoration:none;" onclick="Router.showPage('pg-offer-detail',{offerId:'${act.relatedId}'})">${ic('file-text',11)} Offert ${act.relatedId}</a>` : '';
      } else if (act.relatedType === 'workOrder') {
        relLink = `<a style="color:var(--blue);cursor:pointer;text-decoration:none;" onclick="Router.showPage('pg-ao-detail',{aoId:'${act.relatedId}'})">${ic('clipboard-list',11)} AO ${act.relatedId}</a>`;
      }

      const dateColor = isDone ? 'var(--mt)' : isOverdue ? 'var(--rd)' : isToday ? 'var(--or)' : 'var(--mt)';
      const dateLabel = isDone
        ? `Klar ${act.completedAt ? fmtDate(act.completedAt) : ''}`
        : (act.dueDate ? (isOverdue ? `Försenad (${fmtDate(act.dueDate)})` : `${fmtDate(act.dueDate)}${act.dueTime?' kl '+act.dueTime:''}`) : '—');

      return `<div class="card" style="margin-bottom:0;${isDone?'opacity:.65;':''}">
        <div style="padding:10px 14px;display:flex;gap:10px;align-items:flex-start;">
          <span style="color:${dateColor};flex-shrink:0;margin-top:2px;">${ic(ActivitiesService.typeIcon(act.type),16)}</span>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
              <span style="font-size:13px;font-weight:700;color:var(--navy);">${act.title || ActivitiesService.typeLabel(act.type)}</span>
              <span style="font-size:11px;color:${dateColor};font-weight:600;">${dateLabel}</span>
              ${isOverdue?`<span class="bdg bdg-red" style="font-size:9px;">Försenad</span>`:''}
              ${isToday?`<span class="bdg bdg-orange" style="font-size:9px;">Idag</span>`:''}
              ${act.priority==='hög'?`<span class="bdg bdg-red" style="font-size:9px;">Hög prio</span>`:''}
            </div>
            ${act.note?`<div style="font-size:12px;color:var(--tx);margin-top:2px;">${act.note}</div>`:''}
            <div style="font-size:11px;color:var(--mt);margin-top:3px;display:flex;gap:8px;flex-wrap:wrap;">
              ${relLink}
              <span>${ic('user',9)} ${staffName}</span>
            </div>
          </div>
          ${!isDone?`<div style="display:flex;gap:6px;flex-shrink:0;">
            <button class="btn bsm bsu bxs" onclick="ActivitiesPage.complete('${act.id}')" title="Markera klar">${ic('check',13)}</button>
            <button class="btn bsm bs bxs" onclick="ActivitiesPage.openReschedule('${act.id}')" title="Flytta">${ic('calendar',13)}</button>
          </div>`:`<span class="bdg bdg-grey" style="font-size:9px;flex-shrink:0;">Klar</span>`}
        </div>
      </div>`;
    };

    el.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:4px;">
        <h2 style="font-size:16px;font-weight:800;color:var(--navy);margin:0;">Aktiviteter</h2>
      </div>
      <div class="ft-bar" style="overflow-x:auto;white-space:nowrap;padding-bottom:2px;">
        ${_tab('alla','Alla öppna', acts.filter(a=>a.status==='open').length)}
        ${_tab('mina','Mina',minaCnt)}
        ${_tab('idag','Idag',todayCnt)}
        ${_tab('försenade','Försenade',overdueCnt)}
        ${_tab('kommande','Kommande',upcomingCnt)}
        ${_tab('klara','Klara',acts.filter(a=>a.status==='done').length)}
        ${_tab('offerter','Offertuppföljningar',acts.filter(a=>a.relatedType==='offer').length)}
        ${_tab('ao','AO-uppföljningar',acts.filter(a=>a.relatedType==='workOrder').length)}
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${filtered.length === 0
          ? `<div class="empty">${ic('bell',32)}<h3>Inga aktiviteter</h3><p>Boka en uppföljning på en offert eller arbetsorder.</p></div>`
          : filtered.map(_item).join('')}
      </div>`;
  },

  complete(id) {
    const act = ActivitiesService._get(id);
    ActivitiesService.complete(id);

    if (act) {
      const ts   = new Date().toISOString();
      const user = state.currentUser ? (state.currentUser.name || state.currentUser.username || 'Admin') : 'Admin';
      const note = act.note ? `: ${act.note}` : '';
      if (act.relatedType === 'offer') {
        const off = getOff(act.relatedId);
        if (off) {
          if (!Array.isArray(off.timeline)) off.timeline = [];
          off.timeline.push({ ts, type: 'followup', text: `Uppföljning utförd${note}`, user });
          off.updatedAt = ts;
          persist();
        }
      } else if (act.relatedType === 'workOrder') {
        const ao = getAO(act.relatedId);
        if (ao) {
          if (!Array.isArray(ao.notes)) ao.notes = [];
          ao.notes.push({ ts, type: 'log', text: `Uppföljning utförd${note}`, user, createdBy: user });
          ao.updatedAt = ts;
          persist();
        }
      }
    }

    Sidebar.updateBadges();
    this.render();
    showToast('Aktivitet markerad klar');
  },

  openReschedule(id) {
    const act = ActivitiesService._get(id);
    if (!act) return;
    const oldDate = act.dueDate;
    Modal.open({
      title: `${ic('calendar',14)} Flytta aktivitet`,
      body: `<div style="display:flex;gap:8px;">
        <div class="fg" style="flex:1;"><label>Nytt datum</label><input type="date" id="rs-date" value="${act.dueDate||tdy()}"></div>
        <div class="fg" style="width:90px;"><label>Tid</label><input type="time" id="rs-time" value="${act.dueTime||'09:00'}"></div>
      </div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => {
          const d = document.getElementById('rs-date')?.value;
          const t = document.getElementById('rs-time')?.value;
          if (!d) { showToast('Välj ett datum'); return; }
          ActivitiesService.reschedule(id, d, t);

          const ts      = new Date().toISOString();
          const user    = state.currentUser ? (state.currentUser.name || state.currentUser.username || 'Admin') : 'Admin';
          const fromStr = oldDate ? new Date(oldDate + 'T12:00:00').toLocaleDateString('sv-SE', {day:'numeric',month:'short'}) : '—';
          const toStr   = new Date(d + 'T12:00:00').toLocaleDateString('sv-SE', {day:'numeric',month:'short'});
          if (act.relatedType === 'offer') {
            const off = getOff(act.relatedId);
            if (off) {
              if (!Array.isArray(off.timeline)) off.timeline = [];
              off.timeline.push({ ts, type: 'reminder', text: `Uppföljning flyttad från ${fromStr} till ${toStr}`, user });
              off.updatedAt = ts;
              persist();
            }
          } else if (act.relatedType === 'workOrder') {
            const ao = getAO(act.relatedId);
            if (ao) {
              if (!Array.isArray(ao.notes)) ao.notes = [];
              ao.notes.push({ ts, type: 'log', text: `Uppföljning flyttad från ${fromStr} till ${toStr}`, user, createdBy: user });
              ao.updatedAt = ts;
              persist();
            }
          }

          Modal.close();
          Sidebar.updateBadges();
          this.render();
          showToast('Aktivitet flyttad');
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  }
};
