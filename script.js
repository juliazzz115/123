(function(){
  const STORAGE_KEY = 'jdgRyczaltState_v1';
  const RATES = [2, 3, 5.5, 8.5, 10, 12, 12.5, 14, 15, 17];
  const VAT_OPTIONS = [
    {v:'23', label:'23%'}, {v:'8', label:'8%'}, {v:'5', label:'5%'},
    {v:'0', label:'0%'}, {v:'zw', label:'zw. (zwolniona)'}, {v:'np', label:'np. (poza zakresem)'}
  ];
  const MONTHS_PL = ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec','Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'];
  const FORMA_PLATNOSCI = { 'przelew': 6, 'gotówka': 1, 'karta': 2, 'BLIK': 7 };
  const KOD_TYTULU = { start: '0570 (tylko zdrowotne)', pref: '0570', full: '0510', maly: '0590' };
  const PHASE_LABELS = { start: 'ulga na start', pref: 'preferencyjny ZUS', maly: 'Mały ZUS Plus', full: 'pełny ZUS' };

  const fmt = n => (Math.round((n||0)*100)/100).toLocaleString('pl-PL', {minimumFractionDigits:2, maximumFractionDigits:2});
  const round2 = n => Math.round((n||0)*100)/100;
  const esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const currentMonthKey = () => { const d = new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); };
  const monthLabel = key => { const [y,m] = key.split('-'); return `${MONTHS_PL[parseInt(m,10)-1]} ${y}`; };

  // ---------- state ----------
  function defaultState(){
    return {
      profile: { name:'', nip:'', pesel:'', street:'', zipCity:'', email:'', businessStart:'', bank:'', bankName:'', bankSwift:'', zusAccount:'', taxMicroAccount:'' },
      settings: {
        thresholdLow: 60000, thresholdHigh: 300000,
        healthLow: 498.35, healthMid: 830.58, healthHigh: 1495.04,
        tierMode: 'auto',
        wypadkoweRate: 1.67, minWage: 4806, avgWageForecast: 9421,
        zusPhaseMode: 'auto', chorobowa: true,
        malyZusIncome: { revenue: 0, days: 365 },
        openingByYear: {}
      },
      periods: {},
      activePeriod: null,
      idCounter: 1
    };
  }

  function loadState(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return defaultState();
      const parsed = JSON.parse(raw);
      const d = defaultState();
      const periods = {};
      Object.keys(parsed.periods || {}).forEach(k => {
        const p = parsed.periods[k];
        periods[k] = {
          rows: p.rows || [],
          phaseOverride: p.phaseOverride || null,
          socialOverride: p.socialOverride != null ? p.socialOverride : null
        };
      });
      return {
        profile: {...d.profile, ...(parsed.profile||{})},
        settings: {
          ...d.settings, ...(parsed.settings||{}),
          openingByYear: {...((parsed.settings||{}).openingByYear||{})},
          malyZusIncome: {...d.settings.malyZusIncome, ...((parsed.settings||{}).malyZusIncome||{})}
        },
        periods,
        activePeriod: parsed.activePeriod || null,
        idCounter: parsed.idCounter || 1
      };
    }catch(e){ return defaultState(); }
  }

  let state = loadState();

  let saveStatusTimeout = null;
  function flashSaveStatus(){
    const el = document.getElementById('saveStatus');
    const textEl = document.getElementById('saveStatusText');
    if(!el) return;
    el.classList.add('saving');
    textEl.textContent = 'zapisywanie…';
    clearTimeout(saveStatusTimeout);
    saveStatusTimeout = setTimeout(() => {
      el.classList.remove('saving');
      textEl.textContent = 'zapisano ' + new Date().toLocaleTimeString('pl-PL', {hour:'2-digit', minute:'2-digit'});
    }, 350);
  }

  function saveState(){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    flashSaveStatus();
  }

  function computeAutoPhaseForKey(key){
    const start = state.profile.businessStart;
    if(!start) return null;
    const [sy,sm] = start.split('-').map(Number);
    const [py,pm] = key.split('-').map(Number);
    const monthsElapsed = (py*12+pm) - (sy*12+sm);
    if(monthsElapsed < 0) return null;
    if(monthsElapsed < 6) return 'start';
    if(monthsElapsed < 30) return 'pref';
    return 'full';
  }

  function getEffectivePhase(key){
    const p = state.periods[key];
    if(p && p.phaseOverride) return p.phaseOverride;
    const mode = state.settings.zusPhaseMode;
    if(mode === 'auto') return computeAutoPhaseForKey(key) || 'start';
    return mode;
  }

  function getEffectiveSocial(key){
    const p = state.periods[key];
    if(p && p.socialOverride != null) return p.socialOverride;
    return computeSocialBreakdown(getEffectivePhase(key), key).total;
  }

  function computeSocialBreakdown(phase, key){
    const s = state.settings;
    let podstawa = 0;
    if(phase === 'pref'){
      podstawa = round2(0.3 * s.minWage);
    } else if(phase === 'full'){
      podstawa = round2(0.6 * s.avgWageForecast);
    } else if(phase === 'maly'){
      const info = s.malyZusIncome || { revenue:0, days:365 };
      const dochodRoczny = 0.5 * (info.revenue || 0);
      const days = info.days || 365;
      const raw = days > 0 ? (dochodRoczny/days)*30 : 0;
      const floor = 0.3*s.minWage, ceil = 0.6*s.avgWageForecast;
      podstawa = round2(Math.min(ceil, Math.max(floor, raw)));
    }
    const active = phase !== 'start';
    const emerytalna = active ? round2(podstawa*0.1952) : 0;
    const rentowa = active ? round2(podstawa*0.08) : 0;
    const wypadkowe = active ? round2(podstawa*(s.wypadkoweRate/100)) : 0;
    const chorobowe = (active && s.chorobowa) ? round2(podstawa*0.0245) : 0;
    const fp = (active && podstawa >= s.minWage) ? round2(podstawa*0.0245) : 0;
    const total = round2(emerytalna+rentowa+wypadkowe+chorobowe+fp);
    return { podstawa, emerytalna, rentowa, wypadkowe, chorobowe, fp, total };
  }

  function ensurePeriod(key){
    if(!state.periods[key]){
      state.periods[key] = { rows: [], phaseOverride: null, socialOverride: null };
    }
    return state.periods[key];
  }

  function periodBasisSum(key){
    const p = state.periods[key];
    return p ? p.rows.reduce((s,r)=>s+(r.basis||0),0) : 0;
  }

  function cumulativeBeforePeriod(key){
    const year = key.slice(0,4);
    let sum = state.settings.openingByYear[year] || 0;
    Object.keys(state.periods).forEach(k => {
      if(k.slice(0,4) === year && k < key) sum += periodBasisSum(k);
    });
    return sum;
  }

  function computeForPeriod(key){
    const p = state.periods[key];
    if(!p) return null;
    const sumNet = p.rows.reduce((s,r)=>s+r.net,0);
    const sumVat = p.rows.reduce((s,r)=>s+r.vat,0);
    const sumGross = p.rows.reduce((s,r)=>s+r.gross,0);
    const sumBasis = p.rows.reduce((s,r)=>s+(r.basis||0),0);

    const phase = getEffectivePhase(key);
    const social = getEffectiveSocial(key);

    const cumulative = cumulativeBeforePeriod(key) + sumBasis;
    const s = state.settings;
    let tier;
    if(s.tierMode === 'low') tier = 'low';
    else if(s.tierMode === 'mid') tier = 'mid';
    else if(s.tierMode === 'high') tier = 'high';
    else tier = cumulative <= s.thresholdLow ? 'low' : (cumulative <= s.thresholdHigh ? 'mid' : 'high');

    const healthUsed = tier === 'low' ? s.healthLow : (tier === 'mid' ? s.healthMid : s.healthHigh);
    const halfHealth = healthUsed / 2;
    const totalDeduction = social + halfHealth;
    const taxBase = Math.max(0, sumBasis - totalDeduction);

    const groups = {};
    p.rows.forEach(r => { const rate = r.rate || 0; groups[rate] = (groups[rate]||0) + (r.basis||0); });
    const rateKeys = Object.keys(groups).filter(k => groups[k] !== 0);

    let totalTax = 0;
    const breakdown = [];
    if(rateKeys.length <= 1){
      const rate = rateKeys.length ? parseFloat(rateKeys[0]) : 0;
      totalTax = taxBase * (rate/100);
    } else {
      rateKeys.forEach(rk => {
        const rate = parseFloat(rk);
        const groupRevenue = groups[rk];
        const share = sumBasis > 0 ? groupRevenue / sumBasis : 0;
        const groupBase = Math.max(0, groupRevenue - totalDeduction*share);
        const groupTax = groupBase * (rate/100);
        totalTax += groupTax;
        breakdown.push({ rate, groupRevenue, groupBase, groupTax });
      });
    }
    const due = Math.max(0, Math.round(totalTax));
    return { sumNet, sumVat, sumGross, sumBasis, phase, social, healthUsed, halfHealth, totalDeduction, taxBase, tier, cumulative, breakdown, due };
  }

  // ---------- tabs ----------
  function switchTab(tab){
    const isPraca = tab === 'praca';
    document.getElementById('tabPraca').hidden = !isPraca;
    document.getElementById('tabUstawienia').hidden = isPraca;
    document.getElementById('topbarSubnav').classList.toggle('hidden', !isPraca);
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
  }
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // ---------- generic helpers ----------
  function rateOptionsHtml(selected){
    return RATES.map(r => `<option value="${r}" ${r===selected?'selected':''}>${r}%</option>`).join('');
  }
  function vatSelectHtml(selected){
    return VAT_OPTIONS.map(o => `<option value="${o.v}" ${o.v===selected?'selected':''}>${o.label}</option>`).join('');
  }
  function calcItem(it){
    const net = (parseFloat(it.qty)||0) * (parseFloat(it.price)||0);
    const rateNum = (it.vat === 'zw' || it.vat === 'np') ? 0 : parseFloat(it.vat);
    const vatAmount = net * (rateNum/100);
    return { net, vatAmount, gross: net + vatAmount };
  }
  function vatFieldIndex(rate){
    switch(rate){
      case '23': return '1';
      case '8': return '2';
      case '5': return '3';
      case '0': return '6';
      case 'zw': return '7';
      case 'np': return '9';
      default: return null;
    }
  }

  // ---------- reuse: known buyers & services from past issued invoices ----------
  function getKnownBuyers(){
    const map = new Map();
    Object.keys(state.periods).sort().forEach(k => {
      state.periods[k].rows.forEach(r => {
        if(r.source === 'issued' && r.snapshot && r.snapshot.buyer && r.snapshot.buyer.name){
          const b = r.snapshot.buyer;
          const key = (b.idType === 'nip' ? 'nip:'+b.nip : b.idType === 'vatue' ? 'vat:'+b.country+b.vatId : 'name:'+b.name).toLowerCase();
          map.set(key, b);
        }
      });
    });
    return Array.from(map.values());
  }

  function getKnownServices(){
    const map = new Map();
    Object.keys(state.periods).sort().forEach(k => {
      state.periods[k].rows.forEach(r => {
        if(r.source === 'issued' && r.snapshot && r.snapshot.items){
          r.snapshot.items.forEach(it => { if(it.desc) map.set(it.desc.toLowerCase(), it); });
        }
      });
    });
    return Array.from(map.values());
  }

  function renderServiceDatalist(){
    const el = document.getElementById('serviceList');
    if(!el) return;
    el.innerHTML = getKnownServices().map(s => `<option value="${esc(s.desc)}"></option>`).join('');
  }

  function renderBuyerQuickPick(){
    const el = document.getElementById('buyerQuickPick');
    if(!el) return;
    const buyers = getKnownBuyers();
    el.innerHTML = '<option value="">— wybierz, żeby wypełnić dane —</option>' +
      buyers.map((b,i) => `<option value="${i}">${esc(b.name)}</option>`).join('');
    el._buyers = buyers;
  }

  function fillBuyerFields(b){
    document.getElementById('buyerIdType').value = b.idType || 'nip';
    document.getElementById('buyerName').value = b.name || '';
    document.getElementById('buyerNip').value = b.nip || '';
    document.getElementById('buyerVatId').value = b.vatId || '';
    document.getElementById('buyerCountry').value = b.country || '';
    document.getElementById('buyerStreet').value = b.street || '';
    document.getElementById('buyerZipCity').value = b.zipCity || '';
    document.getElementById('buyerAddressCountry').value = b.addressCountry || 'PL';
    document.getElementById('buyerJst').checked = !!b.jst;
    document.getElementById('buyerGv').checked = !!b.gv;
    updateBuyerIdFieldsVisibility();
  }

  document.getElementById('buyerQuickPick').addEventListener('change', () => {
    const el = document.getElementById('buyerQuickPick');
    const idx = el.value;
    if(idx === '' || !el._buyers || !el._buyers[idx]) return;
    fillBuyerFields(el._buyers[idx]);
  });

  function loadDraftFromSnapshot(snapshot){
    fillBuyerFields(snapshot.buyer || {});

    document.getElementById('invRyczaltRate').value = snapshot.rate;
    document.getElementById('invCurrency').value = snapshot.currency || 'PLN';
    document.getElementById('invKursField').style.display = (snapshot.currency && snapshot.currency !== 'PLN') ? 'flex' : 'none';
    document.getElementById('invKurs').value = snapshot.kurs || '';
    document.getElementById('invPaymentForm').value = snapshot.paymentForm || 'przelew';
    document.getElementById('invPaymentDays').value = snapshot.paymentDays || 7;
    document.getElementById('invPlace').value = snapshot.place || '';
    document.getElementById('invCashMethod').checked = !!snapshot.cashMethod;
    document.getElementById('invSelfBilling').checked = !!snapshot.selfBilling;
    document.getElementById('invReverseCharge').checked = !!snapshot.reverseCharge;
    document.getElementById('invSplitPayment').checked = !!snapshot.splitPayment;
    document.getElementById('invDate').value = new Date().toISOString().slice(0,10);
    document.getElementById('invSaleDate').value = '';
    document.getElementById('invNumber').value = suggestInvoiceNumber();

    draftItems = (snapshot.items || []).map(it => ({...it, id: draftItemIdCounter++}));
    if(!draftItems.length) addDraftItem(); else renderDraftItems();

    switchTab('praca');
    const el = document.getElementById('step-invoice');
    if(el) el.scrollIntoView({behavior:'smooth', block:'start'});
  }

  // ---------- draft invoice items ----------
  let draftItems = [];
  let draftItemIdCounter = 1;

  function addDraftItem(){
    draftItems.push({ id: draftItemIdCounter++, desc: '', qty: 1, unit: 'usł.', price: 0, vat: 'zw' });
    renderDraftItems();
  }
  document.getElementById('addItemBtn').addEventListener('click', addDraftItem);

  function renderDraftItems(){
    const body = document.getElementById('draftItemsBody');
    body.innerHTML = '';
    let sumNet=0, sumVat=0, sumGross=0;
    draftItems.forEach(it => {
      const c = calcItem(it);
      sumNet += c.net; sumVat += c.vatAmount; sumGross += c.gross;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="text" data-id="${it.id}" data-f="desc" value="${esc(it.desc)}" list="serviceList" style="width:160px;border:1px solid var(--line);border-radius:6px;padding:5px 6px;font-size:12.5px;"></td>
        <td class="num"><input type="number" data-id="${it.id}" data-f="qty" value="${it.qty}" step="0.01" style="width:60px;text-align:right;border:1px solid var(--line);border-radius:6px;padding:5px 6px;font-size:12.5px;"></td>
        <td><input type="text" data-id="${it.id}" data-f="unit" value="${esc(it.unit)}" style="width:60px;border:1px solid var(--line);border-radius:6px;padding:5px 6px;font-size:12.5px;"></td>
        <td class="num"><input type="number" data-id="${it.id}" data-f="price" value="${it.price}" step="0.01" style="width:80px;text-align:right;border:1px solid var(--line);border-radius:6px;padding:5px 6px;font-size:12.5px;"></td>
        <td><select data-id="${it.id}" data-f="vat" style="border:1px solid var(--line);border-radius:6px;padding:5px 6px;font-size:12.5px;">${vatSelectHtml(it.vat)}</select></td>
        <td class="num">${fmt(c.net)}</td>
        <td class="num">${fmt(c.vatAmount)}</td>
        <td class="num">${fmt(c.gross)}</td>
        <td><button class="del-btn" data-id="${it.id}" title="Usuń pozycję">&times;</button></td>
      `;
      body.appendChild(tr);
    });
    if(!draftItems.length){
      body.innerHTML = '<tr class="empty-row"><td colspan="9">Brak pozycji — dodaj przynajmniej jedną.</td></tr>';
    }
    document.getElementById('draftSumNet').textContent = fmt(sumNet);
    document.getElementById('draftSumVat').textContent = fmt(sumVat);
    document.getElementById('draftSumGross').textContent = fmt(sumGross);

    body.querySelectorAll('input,select').forEach(el => {
      el.addEventListener('input', () => {
        const it = draftItems.find(x => x.id == el.dataset.id);
        if(!it) return;
        const f = el.dataset.f;
        it[f] = (f==='qty' || f==='price') ? parseFloat(el.value)||0 : el.value;
        renderDraftItems();
      });
    });
    body.querySelectorAll('.del-btn').forEach(btn => {
      btn.addEventListener('click', () => { draftItems = draftItems.filter(x => x.id != btn.dataset.id); renderDraftItems(); });
    });
    body.querySelectorAll('input[data-f="desc"]').forEach(el => {
      el.addEventListener('change', () => {
        const known = getKnownServices().find(s => s.desc.toLowerCase() === el.value.toLowerCase());
        if(!known) return;
        const it = draftItems.find(x => x.id == el.dataset.id);
        if(it){ it.unit = known.unit; it.price = known.price; it.vat = known.vat; renderDraftItems(); }
      });
    });
  }

  function suggestInvoiceNumber(){
    const key = state.activePeriod || currentMonthKey();
    const period = state.periods[key];
    const issuedCount = (period ? period.rows.filter(r => r.source === 'issued').length : 0) + 1;
    const [y,m] = key.split('-');
    return `${issuedCount}/${m}/${y}`;
  }

  document.getElementById('invCurrency').addEventListener('change', () => {
    document.getElementById('invKursField').style.display = document.getElementById('invCurrency').value === 'PLN' ? 'none' : 'flex';
  });

  function updateBuyerIdFieldsVisibility(){
    const t = document.getElementById('buyerIdType').value;
    document.getElementById('buyerNipField').style.display = t==='nip' ? 'flex' : 'none';
    document.getElementById('buyerVatUeField').style.display = t==='vatue' ? 'flex' : 'none';
    document.getElementById('buyerCountryField').style.display = t==='vatue' ? 'flex' : 'none';
    document.getElementById('buyerJstField').style.display = t!=='none' ? 'flex' : 'none';
    document.getElementById('buyerGvField').style.display = t!=='none' ? 'flex' : 'none';
  }
  document.getElementById('buyerIdType').addEventListener('change', updateBuyerIdFieldsVisibility);

  // ---------- KSeF FA(3) XML builder ----------
  function buildInvoiceXml(seller, buyer, inv, totals){
    const groups = {};
    inv.items.forEach(it => {
      const idx = vatFieldIndex(it.vat);
      if(idx === null) return;
      const c = calcItem(it);
      groups[idx] = groups[idx] || {net:0, vat:0};
      groups[idx].net += c.net; groups[idx].vat += c.vatAmount;
    });
    let sumFields = '';
    Object.keys(groups).sort((a,b)=>a-b).forEach(idx => {
      sumFields += `    <P_13_${idx}>${groups[idx].net.toFixed(2)}</P_13_${idx}>\n`;
      if(['1','2','3','6'].includes(idx)) sumFields += `    <P_14_${idx}>${groups[idx].vat.toFixed(2)}</P_14_${idx}>\n`;
    });

    const foreignCurrency = inv.currency !== 'PLN';
    const linesXml = inv.items.map((it,i) => {
      const c = calcItem(it);
      return `    <FaWiersz>
      <NrWierszaFa>${i+1}</NrWierszaFa>
      <P_7>${esc(it.desc)}</P_7>
      <P_8A>${esc(it.unit)}</P_8A>
      <P_8B>${it.qty}</P_8B>
      <P_9A>${(parseFloat(it.price)||0).toFixed(2)}</P_9A>
      <P_11>${c.net.toFixed(2)}</P_11>
      <P_12>${it.vat}</P_12>${foreignCurrency ? `\n      <KursWaluty>${(parseFloat(inv.kurs)||0).toFixed(6)}</KursWaluty>` : ''}
    </FaWiersz>`;
    }).join('\n');

    const idBlock = buyer.idType === 'vatue'
      ? `<KodUE>${esc(buyer.country)}</KodUE><NrVatUE>${esc(buyer.vatId)}</NrVatUE>`
      : buyer.idType === 'none'
        ? `<BrakID>1</BrakID>`
        : `<NIP>${esc(buyer.nip)}</NIP>`;
    const jstGv = buyer.idType !== 'none' ? `\n    <JST>${buyer.jst?1:2}</JST>\n    <GV>${buyer.gv?1:2}</GV>` : '';

    const platnoscForma = FORMA_PLATNOSCI[inv.paymentForm] || 6;
    let platnoscXml = `  <Platnosc>\n    <FormaPlatnosci>${platnoscForma}</FormaPlatnosci>`;
    if(seller.bank){
      platnoscXml += `\n    <RachunekBankowy>\n      <NrRB>${esc(seller.bank.replace(/\s+/g,''))}</NrRB>`;
      if(seller.bankSwift) platnoscXml += `\n      <SWIFT>${esc(seller.bankSwift)}</SWIFT>`;
      if(seller.bankName) platnoscXml += `\n      <NazwaBanku>${esc(seller.bankName)}</NazwaBanku>`;
      platnoscXml += `\n    </RachunekBankowy>`;
    }
    platnoscXml += `\n  </Platnosc>`;

    return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Plik roboczy — wygenerowany pomocniczo przez kalkulator, NIE zweryfikowany z oficjalnym schematem XSD FA(3).
     Przed realną wysyłką sprawdź go w bezpłatnej Aplikacji Podatnika KSeF (środowisko demo) na ksef.podatki.gov.pl,
     albo po prostu przepisz dane z podglądu poniżej bezpośrednio do Aplikacji Podatnika / e-mikrofirmy. -->
<Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/">
  <Naglowek>
    <KodFormularza kodSystemowy="FA (3)" wersjaSchemy="1-0E">FA</KodFormularza>
    <WariantFormularza>3</WariantFormularza>
    <DataWytworzeniaFa>${new Date().toISOString()}</DataWytworzeniaFa>
    <SystemInfo>Kalkulator ryczaltu JDG (plik roboczy)</SystemInfo>
  </Naglowek>
  <Podmiot1>
    <DaneIdentyfikacyjne>
      <NIP>${esc(seller.nip)}</NIP>
      <Nazwa>${esc(seller.name)}</Nazwa>
    </DaneIdentyfikacyjne>
    <Adres>
      <KodKraju>PL</KodKraju>
      <AdresL1>${esc(seller.street)}</AdresL1>
      <AdresL2>${esc(seller.zipCity)}</AdresL2>
    </Adres>
  </Podmiot1>
  <Podmiot2>
    <DaneIdentyfikacyjne>
      ${idBlock}
      <Nazwa>${esc(buyer.name)}</Nazwa>
    </DaneIdentyfikacyjne>
    <Adres>
      <KodKraju>${esc(buyer.addressCountry || 'PL')}</KodKraju>
      <AdresL1>${esc(buyer.street)}</AdresL1>
      <AdresL2>${esc(buyer.zipCity)}</AdresL2>
    </Adres>${jstGv}
  </Podmiot2>
  <Fa>
    <KodWaluty>${esc(inv.currency)}</KodWaluty>
    <P_1>${inv.date}</P_1>${inv.place ? `\n    <P_1M>${esc(inv.place)}</P_1M>` : ''}
    <P_2>${esc(inv.number)}</P_2>${inv.saleDate ? `\n    <P_6>${inv.saleDate}</P_6>` : ''}
${sumFields}    <P_15>${totals.gross.toFixed(2)}</P_15>
    <Adnotacje>
      <P_16>${inv.cashMethod ? 1 : 2}</P_16>
      <P_17>${inv.selfBilling ? 1 : 2}</P_17>
      <P_18>${inv.reverseCharge ? 1 : 2}</P_18>
      <P_18A>${inv.splitPayment ? 1 : 2}</P_18A>
    </Adnotacje>
    <RodzajFaktury>VAT</RodzajFaktury>
${linesXml}
${platnoscXml}
  </Fa>
</Faktura>`;
  }

  // ---------- issuing an invoice ----------
  document.getElementById('issueInvoiceBtn').addEventListener('click', () => {
    if(!draftItems.length){ alert('Dodaj przynajmniej jedną pozycję faktury.'); return; }

    const seller = {
      name: document.getElementById('sellerName').value,
      nip: document.getElementById('sellerNip').value,
      street: document.getElementById('sellerStreet').value,
      zipCity: document.getElementById('sellerZipCity').value,
      bank: document.getElementById('sellerBank').value,
      bankName: document.getElementById('sellerBankName').value,
      bankSwift: document.getElementById('sellerBankSwift').value,
    };
    if(!seller.name || !seller.nip){ alert('Uzupełnij dane Twojej firmy w zakładce Ustawienia (przynajmniej nazwę i NIP).'); return; }

    const idType = document.getElementById('buyerIdType').value;
    const buyer = {
      idType,
      name: document.getElementById('buyerName').value,
      nip: document.getElementById('buyerNip').value,
      vatId: document.getElementById('buyerVatId').value,
      country: (document.getElementById('buyerCountry').value || '').toUpperCase(),
      street: document.getElementById('buyerStreet').value,
      zipCity: document.getElementById('buyerZipCity').value,
      addressCountry: (document.getElementById('buyerAddressCountry').value || 'PL').toUpperCase(),
      jst: document.getElementById('buyerJst').checked,
      gv: document.getElementById('buyerGv').checked,
    };
    if(!buyer.name){ alert('Podaj nazwę / imię i nazwisko nabywcy.'); return; }
    if(idType === 'nip' && !buyer.nip){ alert('Podaj NIP nabywcy albo zmień identyfikację nabywcy.'); return; }
    if(idType === 'vatue' && (!buyer.vatId || !buyer.country)){ alert('Podaj kod kraju i zagraniczny numer VAT nabywcy.'); return; }

    const invDateVal = document.getElementById('invDate').value || new Date().toISOString().slice(0,10);
    const currency = document.getElementById('invCurrency').value;
    const kurs = parseFloat(document.getElementById('invKurs').value) || 0;
    if(currency !== 'PLN' && kurs <= 0){ alert('Podaj kurs waluty do przeliczenia na PLN (do ewidencji przychodów).'); return; }

    const inv = {
      number: document.getElementById('invNumber').value || suggestInvoiceNumber(),
      date: invDateVal,
      saleDate: document.getElementById('invSaleDate').value,
      place: document.getElementById('invPlace').value,
      paymentDays: document.getElementById('invPaymentDays').value,
      paymentForm: document.getElementById('invPaymentForm').value,
      currency, kurs,
      cashMethod: document.getElementById('invCashMethod').checked,
      selfBilling: document.getElementById('invSelfBilling').checked,
      reverseCharge: document.getElementById('invReverseCharge').checked,
      splitPayment: document.getElementById('invSplitPayment').checked,
      items: draftItems.map(it => ({...it}))
    };

    let net=0, vat=0, gross=0;
    inv.items.forEach(it => { const c = calcItem(it); net += c.net; vat += c.vatAmount; gross += c.gross; });
    const totals = { net, vat, gross };

    const rate = parseFloat(document.getElementById('invRyczaltRate').value);
    const fx = currency === 'PLN' ? 1 : kurs;

    const periodKey = invDateVal.slice(0,7);
    const period = ensurePeriod(periodKey);
    period.rows.push({
      id: state.idCounter++, date: inv.date, number: inv.number,
      buyer: buyer.name,
      net: round2(net*fx), vat: round2(vat*fx), gross: round2(gross*fx),
      basis: round2(net*fx), rate, source: 'issued',
      origCurrency: currency, fxRate: currency==='PLN' ? null : kurs,
      snapshot: {
        buyer: {...buyer},
        items: inv.items.map(it => ({...it})),
        rate, currency, kurs,
        paymentForm: inv.paymentForm, paymentDays: inv.paymentDays, place: inv.place,
        cashMethod: inv.cashMethod, selfBilling: inv.selfBilling, reverseCharge: inv.reverseCharge, splitPayment: inv.splitPayment
      }
    });

    const xml = buildInvoiceXml(seller, buyer, inv, totals);
    const blob = new Blob([xml], {type:'application/xml;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const safeName = inv.number.replace(/[^\w-]+/g, '_');

    const itemLines = inv.items.map(it => {
      const c = calcItem(it);
      return `  • ${esc(it.desc) || '(brak opisu)'} — ${it.qty} ${esc(it.unit)} × ${fmt(it.price)} ${currency} = ${fmt(c.net)} ${currency} netto, VAT ${it.vat==='zw'?'zw.':it.vat==='np'?'np.':it.vat+'%'} (${fmt(c.vatAmount)} ${currency}) → ${fmt(c.gross)} ${currency} brutto`;
    }).join('\n');

    const buyerIdLine = idType==='nip' ? `NIP ${esc(buyer.nip)}` : idType==='vatue' ? `${esc(buyer.country)} VAT ${esc(buyer.vatId)}` : '(bez identyfikatora)';

    const preview = document.getElementById('invoicePreview');
    preview.innerHTML = `
      <h3>Gotowe — podgląd faktury ${esc(inv.number)}</h3>
      <p style="margin:0 0 6px;">Dodano do ewidencji miesiąca ${esc(monthLabel(periodKey))}. Pobierz plik XML (roboczy) albo po prostu przepisz poniższe dane
      do bezpłatnej Aplikacji Podatnika KSeF / e-mikrofirmy — to zajmie dosłownie chwilę i masz pewność zgodności ze schematem.</p>
      <pre>Sprzedawca: ${esc(seller.name)}, NIP ${esc(seller.nip)}
Nabywca: ${esc(buyer.name)}, ${buyerIdLine}
Data wystawienia: ${inv.date}${inv.saleDate ? '    Data sprzedaży: '+inv.saleDate : ''}    Termin płatności: ${inv.paymentDays} dni (${inv.paymentForm})
Numer faktury: ${inv.number}    Waluta: ${currency}${currency!=='PLN' ? ' (kurs '+kurs+')' : ''}

Pozycje:
${itemLines}

Razem netto: ${fmt(net)} ${currency}   VAT: ${fmt(vat)} ${currency}   Brutto: ${fmt(gross)} ${currency}
Do ewidencji przychodów: ${fmt(net*fx)} zł</pre>
      <div class="actions" style="margin:10px 0 0;">
        <a class="action primary" style="text-decoration:none; display:inline-block;" href="${url}" download="faktura_${safeName}.xml">Pobierz XML (roboczy)</a>
      </div>
    `;

    draftItems = [];
    draftItemIdCounter = 1;
    document.getElementById('buyerName').value = '';
    document.getElementById('buyerNip').value = '';
    document.getElementById('buyerVatId').value = '';
    document.getElementById('buyerStreet').value = '';
    document.getElementById('buyerZipCity').value = '';
    document.getElementById('buyerJst').checked = false;
    document.getElementById('buyerGv').checked = false;
    document.getElementById('invSaleDate').value = '';

    state.activePeriod = periodKey;
    saveState();
    syncZusFieldsFromPeriod();
    renderPeriodList();
    renderEvidence();
    renderYearSummary();
    renderServiceDatalist();
    renderBuyerQuickPick();
    addDraftItem();
  });

  // ---------- KSeF XML import / parsing ----------
  function localName(el){ return el.tagName.split(':').pop(); }
  function allByLocal(root, name){ return Array.from(root.getElementsByTagName('*')).filter(el => localName(el) === name); }
  function firstText(root, name){ const arr = allByLocal(root, name); return arr.length ? arr[0].textContent.trim() : null; }
  function numOf(root, name){ const t = firstText(root, name); const v = t !== null ? parseFloat(t.replace(',', '.')) : NaN; return isNaN(v) ? 0 : v; }

  function partyInfo(doc, partyLocalName){
    const nodes = allByLocal(doc, partyLocalName);
    if(!nodes.length) return {nip:'', name:''};
    const node = nodes[0];
    const nip = firstText(node, 'NIP') || '';
    let name = firstText(node, 'Nazwa') || firstText(node, 'PelnaNazwa');
    if(!name){
      const imie = firstText(node, 'ImiePierwsze') || '';
      const nazwisko = firstText(node, 'Nazwisko') || '';
      name = (imie + ' ' + nazwisko).trim();
    }
    return {nip, name: name || ''};
  }

  function parseKsefXml(text, filename){
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if(doc.getElementsByTagName('parsererror').length) throw new Error('nie udało się odczytać pliku XML');

    const number = firstText(doc, 'P_2') || filename.replace(/\.xml$/i,'');
    const date = firstText(doc, 'P_1') || '';
    const gross = numOf(doc, 'P_15');
    const currency = firstText(doc, 'KodWaluty') || 'PLN';

    let net = 0, found = false;
    Array.from(doc.getElementsByTagName('*')).forEach(el => {
      if(/^P_13_\d+$/.test(localName(el))){ net += parseFloat((el.textContent||'0').replace(',','.')) || 0; found = true; }
    });
    if(!found) net = gross;

    let vat = 0;
    Array.from(doc.getElementsByTagName('*')).forEach(el => {
      if(/^P_14_\d+$/.test(localName(el))) vat += parseFloat((el.textContent||'0').replace(',','.')) || 0;
    });

    let kurs = null;
    Array.from(doc.getElementsByTagName('*')).forEach(el => {
      if(kurs === null && localName(el) === 'KursWaluty'){
        const v = parseFloat((el.textContent||'').replace(',','.'));
        if(!isNaN(v)) kurs = v;
      }
    });

    const buyer = partyInfo(doc, 'Podmiot2');
    const fx = currency === 'PLN' ? 1 : (kurs || 1);

    return {
      id: state.idCounter++, date, number,
      buyer: buyer.name || buyer.nip || '—',
      net: round2(net*fx), vat: round2(vat*fx), gross: round2(gross*fx),
      basis: round2(net*fx), rate: 3, source: 'uploaded',
      origCurrency: currency, fxRate: currency==='PLN' ? null : kurs
    };
  }

  function handleFiles(files){
    const errors = [];
    let pending = files.length;
    if(!pending) return;
    const touched = new Set();
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = e => {
        try{
          const row = parseKsefXml(e.target.result, file.name);
          const key = (row.date && /^\d{4}-\d{2}/.test(row.date)) ? row.date.slice(0,7) : (state.activePeriod || currentMonthKey());
          ensurePeriod(key).rows.push(row);
          touched.add(key);
        }
        catch(err){ errors.push(file.name + ': ' + err.message); }
        pending--;
        if(pending === 0) finish();
      };
      reader.onerror = () => {
        errors.push(file.name + ': błąd odczytu pliku');
        pending--;
        if(pending === 0) finish();
      };
      reader.readAsText(file, 'UTF-8');
    });
    function finish(){
      if(touched.size){
        state.activePeriod = Array.from(touched).sort().pop();
        syncZusFieldsFromPeriod();
      }
      saveState();
      renderPeriodList();
      renderEvidence();
      renderYearSummary();
      parseErrorsEl.textContent = errors.length ? ('Nie odczytano: ' + errors.join(' · ')) : '';
    }
  }

  const parseErrorsEl = document.getElementById('parseErrors');
  const fileInput = document.getElementById('fileInput');
  const dropzone = document.getElementById('dropzone');
  fileInput.addEventListener('change', e => { handleFiles(e.target.files); fileInput.value=''; });
  ['dragenter','dragover'].forEach(evt => dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.classList.add('drag'); }));
  ['dragleave','drop'].forEach(evt => dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.classList.remove('drag'); }));
  dropzone.addEventListener('drop', e => { if(e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); });

  document.getElementById('manualAddBtn').addEventListener('click', () => {
    if(!state.activePeriod){ alert('Najpierw wybierz lub utwórz miesiąc w kroku 1.'); return; }
    ensurePeriod(state.activePeriod).rows.push({ id: state.idCounter++, date: '', number: 'ręczny wpis', buyer: '', net: 0, vat: 0, gross: 0, basis: 0, rate: 3, source: 'manual' });
    saveState();
    renderEvidence();
    renderYearSummary();
    renderPeriodList();
  });

  // ---------- evidence table ----------
  function renderEvidence(){
    const tbody = document.getElementById('tbody');
    const key = state.activePeriod;
    const rows = key && state.periods[key] ? state.periods[key].rows : null;

    document.getElementById('evTitlePeriod').textContent = key ? monthLabel(key) : 'brak okresu';

    tbody.innerHTML = '';
    if(rows === null){
      tbody.innerHTML = '<tr class="empty-row"><td colspan="10">Wybierz lub utwórz okres w kroku 1.</td></tr>';
    } else if(!rows.length){
      tbody.innerHTML = '<tr class="empty-row"><td colspan="10">Brak faktur — wgraj pliki powyżej.</td></tr>';
    } else {
      rows.forEach((row, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${idx+1}</td>
          <td contenteditable="true" data-field="date">${esc(row.date || '')}</td>
          <td contenteditable="true" data-field="number">${esc(row.number || '')}</td>
          <td contenteditable="true" data-field="buyer">${esc(row.buyer || '')}</td>
          <td class="num">${fmt(row.net)}</td>
          <td class="num">${fmt(row.vat)}</td>
          <td class="num">${fmt(row.gross)}</td>
          <td class="num editable-cell"><input type="number" step="0.01" value="${row.basis}" data-id="${row.id}" data-role="basis"></td>
          <td class="rate-cell"><select data-id="${row.id}" data-role="rate">${rateOptionsHtml(row.rate)}</select></td>
          <td><div class="row-actions">${row.source==='issued' && row.snapshot ? `<button class="dup-btn" data-id="${row.id}" title="Duplikuj — wystaw podobną fakturę w tym miesiącu">⧉</button>` : ''}<button class="del-btn" data-id="${row.id}" title="Usuń">&times;</button></div></td>
        `;
        tbody.appendChild(tr);

        tr.querySelectorAll('[contenteditable]').forEach(cell => {
          cell.addEventListener('blur', () => { row[cell.dataset.field] = cell.textContent.trim(); saveState(); });
        });
      });
    }

    tbody.querySelectorAll('[data-role="basis"]').forEach(inp => {
      inp.addEventListener('input', () => {
        const row = state.periods[key].rows.find(r => r.id == inp.dataset.id);
        if(row) row.basis = parseFloat(inp.value) || 0;
        saveState(); updateSummary(); renderYearSummary(); renderPeriodList();
      });
    });
    tbody.querySelectorAll('[data-role="rate"]').forEach(sel => {
      sel.addEventListener('change', () => {
        const row = state.periods[key].rows.find(r => r.id == sel.dataset.id);
        if(row) row.rate = parseFloat(sel.value);
        saveState(); updateSummary(); renderYearSummary(); renderPeriodList();
      });
    });
    tbody.querySelectorAll('.del-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.periods[key].rows = state.periods[key].rows.filter(r => r.id != btn.dataset.id);
        saveState(); renderEvidence(); renderYearSummary(); renderPeriodList();
      });
    });
    tbody.querySelectorAll('.dup-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const row = state.periods[key].rows.find(r => r.id == btn.dataset.id);
        if(row && row.snapshot) loadDraftFromSnapshot(row.snapshot);
      });
    });

    updateSummary();
  }

  // ---------- ZUS / phase handling ----------
  function renderZusCard(){
    const key = state.activePeriod;
    const hintEl = document.getElementById('zusPhaseHint');
    const body = document.getElementById('socialBreakdownBody');
    const overrideSelect = document.getElementById('phaseOverrideSelect');
    if(!key || !state.periods[key]){
      hintEl.textContent = 'Wybierz lub utwórz okres w kroku 1.';
      body.innerHTML = '<tr><td colspan="6">—</td></tr>';
      overrideSelect.value = '';
      return;
    }
    const p = state.periods[key];
    const phase = getEffectivePhase(key);
    const auto = state.settings.zusPhaseMode === 'auto' ? computeAutoPhaseForKey(key) : null;
    const source = p.phaseOverride
      ? 'nadpisane ręcznie dla tego miesiąca'
      : (state.settings.zusPhaseMode === 'auto'
          ? (auto ? 'automatycznie, na podstawie daty rozpoczęcia działalności' : 'automatycznie (brak daty rozpoczęcia działalności w Ustawieniach — domyślnie ulga na start)')
          : 'ustawione na stałe w Ustawieniach');
    hintEl.innerHTML = `Faza w tym miesiącu: <strong>${PHASE_LABELS[phase]}</strong> — ${esc(source)}.`;
    overrideSelect.value = p.phaseOverride || '';

    const b = computeSocialBreakdown(phase, key);
    body.innerHTML = `<tr><td>${fmt(b.emerytalna)}</td><td>${fmt(b.rentowa)}</td><td>${fmt(b.wypadkowe)}</td><td>${fmt(b.chorobowe)}</td><td>${fmt(b.fp)}</td><td><strong>${fmt(b.total)}</strong></td></tr>`;

    document.getElementById('socialInput').value = getEffectiveSocial(key);
  }

  document.getElementById('phaseOverrideSelect').addEventListener('change', () => {
    if(!state.activePeriod) return;
    const p = ensurePeriod(state.activePeriod);
    const val = document.getElementById('phaseOverrideSelect').value;
    p.phaseOverride = val || null;
    saveState();
    renderZusCard();
    updateSummary();
    renderYearSummary();
    renderPeriodList();
  });

  document.getElementById('socialInput').addEventListener('input', () => {
    if(!state.activePeriod) return;
    ensurePeriod(state.activePeriod).socialOverride = parseFloat(document.getElementById('socialInput').value) || 0;
    saveState(); updateSummary(); renderYearSummary(); renderPeriodList();
  });
  document.getElementById('socialResetBtn').addEventListener('click', () => {
    if(!state.activePeriod) return;
    ensurePeriod(state.activePeriod).socialOverride = null;
    saveState(); renderZusCard(); updateSummary(); renderYearSummary(); renderPeriodList();
  });

  function refreshAllZusDependent(){
    saveState();
    renderZusCard();
    updateSummary();
    renderYearSummary();
    renderPeriodList();
  }

  document.getElementById('zusPhaseModeSelect').addEventListener('change', () => {
    state.settings.zusPhaseMode = document.getElementById('zusPhaseModeSelect').value;
    document.getElementById('malyZusSettingsFields').style.display = state.settings.zusPhaseMode === 'maly' ? 'grid' : 'none';
    renderZusModeHint();
    refreshAllZusDependent();
  });
  document.getElementById('chorobowaGlobalCheck').addEventListener('change', () => {
    state.settings.chorobowa = document.getElementById('chorobowaGlobalCheck').checked;
    refreshAllZusDependent();
  });
  ['malyRevenuePrevInput','malyDaysPrevInput'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      state.settings.malyZusIncome = {
        revenue: parseFloat(document.getElementById('malyRevenuePrevInput').value) || 0,
        days: parseFloat(document.getElementById('malyDaysPrevInput').value) || 365
      };
      refreshAllZusDependent();
    });
  });

  function renderZusModeHint(){
    const el = document.getElementById('zusModeHint');
    if(!el) return;
    const mode = state.settings.zusPhaseMode;
    if(mode !== 'auto'){ el.textContent = `Każdy miesiąc będzie liczony w fazie: ${PHASE_LABELS[mode]}, dopóki nie zmienisz trybu tutaj.`; return; }
    const start = state.profile.businessStart;
    if(!start){ el.textContent = 'Uzupełnij „Datę rozpoczęcia działalności” w sekcji powyżej, żeby tryb automatyczny mógł liczyć fazy poprawnie — bez niej każdy miesiąc dostanie „Ulgę na start”.'; return; }
    el.textContent = `Licząc od ${start}: miesiące 1–6 = Ulga na start, miesiące 7–30 = Preferencyjny ZUS, od miesiąca 31 = Pełny ZUS. Możesz to nadpisać dla pojedynczego miesiąca w zakładce Praca.`;
  }

  const settingsFieldMap = { thresholdLowInput:'thresholdLow', thresholdHighInput:'thresholdHigh', healthLowInput:'healthLow', healthMidInput:'healthMid', healthHighInput:'healthHigh' };
  Object.keys(settingsFieldMap).forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      state.settings[settingsFieldMap[id]] = parseFloat(document.getElementById(id).value) || 0;
      refreshAllZusDependent();
    });
  });
  document.getElementById('tierModeSelect').addEventListener('change', () => {
    state.settings.tierMode = document.getElementById('tierModeSelect').value;
    refreshAllZusDependent();
  });
  document.getElementById('openingByYearInput').addEventListener('input', () => {
    const year = state.activePeriod ? state.activePeriod.slice(0,4) : String(new Date().getFullYear());
    state.settings.openingByYear[year] = parseFloat(document.getElementById('openingByYearInput').value) || 0;
    refreshAllZusDependent();
  });

  const zusRateFieldMap = { wypadkoweRateInput:'wypadkoweRate', minWageInput:'minWage', avgWageForecastInput:'avgWageForecast' };
  Object.keys(zusRateFieldMap).forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      state.settings[zusRateFieldMap[id]] = parseFloat(document.getElementById(id).value) || 0;
      refreshAllZusDependent();
    });
  });

  // ---------- result summary ----------
  function updateSummary(){
    const key = state.activePeriod;
    const period = key ? state.periods[key] : null;
    const c = key ? computeForPeriod(key) : null;

    document.getElementById('sumNet').textContent = fmt(c ? c.sumNet : 0);
    document.getElementById('sumVat').textContent = fmt(c ? c.sumVat : 0);
    document.getElementById('sumGross').textContent = fmt(c ? c.sumGross : 0);
    document.getElementById('sumBasis').textContent = fmt(c ? c.sumBasis : 0);
    document.getElementById('calcCount').textContent = period ? period.rows.length : 0;
    document.getElementById('calcBasis').textContent = fmt(c ? c.sumBasis : 0) + ' zł';

    document.getElementById('calcSocial').textContent = fmt(c ? c.social : 0);
    document.getElementById('calcHealthUsed').textContent = fmt(c ? c.healthUsed : 0);
    document.getElementById('calcHalfZus').textContent = fmt(c ? c.halfHealth : 0);
    document.getElementById('calcTaxBase').textContent = fmt(c ? c.taxBase : 0) + ' zł';

    const rateBreakdownEl = document.getElementById('rateBreakdown');
    if(!c || !c.breakdown.length){
      rateBreakdownEl.innerHTML = '';
    } else {
      let html = '<table><thead><tr><th>Stawka</th><th class="num">Przychód</th><th class="num">Podstawa po odliczeniach</th><th class="num">Podatek</th></tr></thead><tbody>';
      c.breakdown.forEach(b => {
        html += `<tr><td>${b.rate}%</td><td class="num">${fmt(b.groupRevenue)} zł</td><td class="num">${fmt(b.groupBase)} zł</td><td class="num">${fmt(b.groupTax)} zł</td></tr>`;
      });
      html += '</tbody></table>';
      rateBreakdownEl.innerHTML = html;
    }

    document.getElementById('calcDue').textContent = c ? c.due : 0;

    const s = state.settings;
    const tierLabel = c ? (c.tier==='low' ? 'I próg (do '+fmt(s.thresholdLow)+' zł)' : c.tier==='mid' ? 'II próg ('+fmt(s.thresholdLow)+'–'+fmt(s.thresholdHigh)+' zł)' : 'III próg (powyżej '+fmt(s.thresholdHigh)+' zł)') : '';
    document.getElementById('cumulativeHint').textContent = c
      ? ('Przychód narastająco: ' + fmt(c.cumulative) + ' zł → ' + tierLabel + ' → składka zdrowotna: ' + fmt(c.healthUsed) + ' zł/mies.' + (s.tierMode!=='auto' ? ' (wymuszone ręcznie)' : ''))
      : 'Wybierz okres w kroku 1, żeby zobaczyć wyliczenia.';

    document.getElementById('stampPeriod').textContent = key ? monthLabel(key) : 'okres nieustawiony';

    renderDeclaration();
    renderPaymentInfo();
  }

  function renderPaymentInfo(){
    const zusBox = document.getElementById('payZusBox');
    const taxBox = document.getElementById('payTaxBox');
    if(!zusBox || !taxBox) return;
    const zusAcc = (state.profile.zusAccount || '').trim();
    const taxAcc = (state.profile.taxMicroAccount || '').trim();
    const key = state.activePeriod;

    zusBox.innerHTML = zusAcc
      ? `<strong>Gdzie zapłacić:</strong> jednym przelewem na Twój numer rachunku składkowego (NRS): <strong>${esc(zusAcc)}</strong>. To pokrywa wszystkie składki naraz (społeczne + zdrowotną + FP). Termin: do 20. dnia następnego miesiąca.`
      : `<strong>Gdzie zapłacić:</strong> nie masz jeszcze zapisanego numeru rachunku składkowego (NRS). Uzupełnij go w zakładce <strong>Ustawienia → Gdzie płacić ZUS i podatek</strong> — jednym przelewem na ten numer płacisz wszystkie składki naraz. Termin: do 20. dnia następnego miesiąca.`;

    const due = key ? computeForPeriod(key).due : 0;
    taxBox.innerHTML = taxAcc
      ? `<strong>Gdzie zapłacić:</strong> ${fmt(due)} zł na Twój mikrorachunek podatkowy: <strong>${esc(taxAcc)}</strong>. W tytule przelewu wpisz „PIT-28” i okres${key ? ' ('+esc(monthLabel(key))+')' : ''}. Termin: do 20. dnia miesiąca następującego po miesiącu przychodu.`
      : `<strong>Gdzie zapłacić:</strong> nie masz jeszcze zapisanego mikrorachunku podatkowego. Uzupełnij go w zakładce <strong>Ustawienia → Gdzie płacić ZUS i podatek</strong>. Termin: do 20. dnia miesiąca następującego po miesiącu przychodu, w tytule przelewu wpisz „PIT-28”.`;
  }

  function computeAnnualHealthReconciliation(year){
    const keys = Object.keys(state.periods).filter(k => k.slice(0,4) === year).sort();
    if(!keys.length) return null;
    let totalRevenueInYear = 0, totalPaid = 0;
    keys.forEach(k => {
      const c = computeForPeriod(k);
      totalRevenueInYear += c.sumBasis;
      totalPaid += c.healthUsed;
    });
    const opening = state.settings.openingByYear[year] || 0;
    const fullYearRevenue = opening + totalRevenueInYear;
    const s = state.settings;
    const tier = fullYearRevenue <= s.thresholdLow ? 'low' : (fullYearRevenue <= s.thresholdHigh ? 'mid' : 'high');
    const monthlyRate = tier === 'low' ? s.healthLow : (tier === 'mid' ? s.healthMid : s.healthHigh);
    const monthsCount = keys.length;
    const dueTotal = round2(monthlyRate * monthsCount);
    const diff = round2(dueTotal - totalPaid);
    return { monthsCount, fullYearRevenue, tier, monthlyRate, dueTotal, totalPaid, diff };
  }

  function renderDeclaration(){
    const key = state.activePeriod;
    document.getElementById('declTitlePeriod').textContent = key ? monthLabel(key) : 'brak okresu';
    const kodEl = document.getElementById('declKodTytulu');
    const body = document.getElementById('declBody');
    const totalEl = document.getElementById('declTotal');
    const annualEl = document.getElementById('declAnnualHealth');

    if(!key || !state.periods[key]){
      kodEl.textContent = 'Wybierz lub utwórz okres w kroku 1.';
      body.innerHTML = '';
      totalEl.textContent = '0,00';
      annualEl.textContent = '';
      return;
    }

    const c = computeForPeriod(key);
    const phase = c.phase;
    const sb = computeSocialBreakdown(phase, key);
    const kod = KOD_TYTULU[phase] || '—';
    kodEl.innerHTML = `Faza: <strong>${PHASE_LABELS[phase]}</strong>. Kod tytułu ubezpieczenia (orientacyjnie): <strong>${kod}</strong>.
      Deklarację ZUS DRA za ${esc(monthLabel(key))} złóż do 20. dnia następnego miesiąca, elektronicznie przez PUE/eZUS.`;

    const rows = [];
    if(phase !== 'start'){
      rows.push(['Emerytalna', sb.podstawa, sb.emerytalna]);
      rows.push(['Rentowa', sb.podstawa, sb.rentowa]);
      rows.push(['Wypadkowa', sb.podstawa, sb.wypadkowe]);
      if(sb.chorobowe > 0) rows.push(['Chorobowa (dobrowolna)', sb.podstawa, sb.chorobowe]);
      if(sb.fp > 0) rows.push(['Fundusz Pracy', sb.podstawa, sb.fp]);
    }
    rows.push(['Zdrowotna', null, c.healthUsed]);

    body.innerHTML = rows.map(r => `<tr><td>${r[0]}</td><td class="num">${r[1]==null ? '—' : fmt(r[1])+' zł'}</td><td class="num">${fmt(r[2])} zł</td></tr>`).join('');
    totalEl.textContent = fmt(rows.reduce((s,r)=>s+r[2],0));

    const year = key.slice(0,4);
    const rec = computeAnnualHealthReconciliation(year);
    if(!rec){
      annualEl.textContent = 'Brak danych za ten rok.';
    } else {
      const tierLabel = rec.tier === 'low' ? 'I próg' : rec.tier === 'mid' ? 'II próg' : 'III próg';
      const diffLabel = rec.diff > 0.005 ? `Dopłata: ${fmt(rec.diff)} zł (dolicz do składki za kwiecień, termin do 20 maja).`
        : rec.diff < -0.005 ? `Nadpłata: ${fmt(-rec.diff)} zł (możesz wystąpić o zwrot wnioskiem RZS-R).`
        : 'Brak dopłaty ani nadpłaty.';
      const incompleteNote = rec.monthsCount < 12 ? ` Uwaga: masz w aplikacji zapisane ${rec.monthsCount} z 12 miesięcy tego roku — rozliczenie będzie ostateczne dopiero po grudniu.` : '';
      annualEl.textContent = `Przychód za rok ${year}: ${fmt(rec.fullYearRevenue)} zł → ${tierLabel} → składka roczna wg ostatecznego przychodu: ${fmt(rec.dueTotal)} zł (${rec.monthsCount} mies. × ${fmt(rec.monthlyRate)} zł). Suma faktycznie naliczonych składek miesięcznych: ${fmt(rec.totalPaid)} zł. ${diffLabel}${incompleteNote}`;
    }
  }

  function renderYearSummary(){
    const body = document.getElementById('yearSummaryBody');
    if(!state.activePeriod){
      body.innerHTML = '<tr class="empty-row"><td colspan="4">Brak wybranego okresu.</td></tr>';
      document.getElementById('yearSumRevenue').textContent = '0,00';
      document.getElementById('yearSumTaxBase').textContent = '0,00';
      document.getElementById('yearSumTax').textContent = '0,00';
      return;
    }
    const year = state.activePeriod.slice(0,4);
    const keys = Object.keys(state.periods).filter(k => k.slice(0,4) === year).sort();
    let sumRev=0, sumTaxBase=0, sumTax=0;
    body.innerHTML = keys.map(k => {
      const c = computeForPeriod(k);
      sumRev += c.sumBasis; sumTaxBase += c.taxBase; sumTax += c.due;
      const bold = k === state.activePeriod ? 'font-weight:700;' : '';
      return `<tr style="${bold}"><td>${monthLabel(k)}</td><td class="num">${fmt(c.sumBasis)}</td><td class="num">${fmt(c.taxBase)}</td><td class="num">${fmt(c.due)}</td></tr>`;
    }).join('');
    if(!keys.length) body.innerHTML = '<tr class="empty-row"><td colspan="4">Brak danych za ten rok.</td></tr>';
    document.getElementById('yearSumRevenue').textContent = fmt(sumRev);
    document.getElementById('yearSumTaxBase').textContent = fmt(sumTaxBase);
    document.getElementById('yearSumTax').textContent = fmt(sumTax);
  }

  // ---------- period switcher ----------
  function syncZusFieldsFromPeriod(){
    const key = state.activePeriod;
    const p = state.periods[key];
    if(!p) return;
    renderZusCard();

    const year = key.slice(0,4);
    document.getElementById('openingByYearInput').value = state.settings.openingByYear[year] || 0;

    document.getElementById('invNumber').value = suggestInvoiceNumber();
    const invDateEl = document.getElementById('invDate');
    if(!invDateEl.value || invDateEl.value.slice(0,7) !== key){
      const today = new Date();
      invDateEl.value = today.toISOString().slice(0,7) === key ? today.toISOString().slice(0,10) : key + '-01';
    }
  }

  function setActivePeriod(key){
    ensurePeriod(key);
    state.activePeriod = key;
    saveState();
    syncZusFieldsFromPeriod();
    renderPeriodList();
    renderEvidence();
    renderYearSummary();
  }

  function renderPeriodList(){
    const el = document.getElementById('periodList');
    const keys = Object.keys(state.periods).sort();
    if(!keys.length){
      el.innerHTML = '<span style="color:var(--muted);font-size:12.5px;">Brak zapisanych miesięcy — utwórz pierwszy powyżej.</span>';
      return;
    }
    el.innerHTML = keys.map(k => {
      const c = computeForPeriod(k);
      const active = k === state.activePeriod;
      return `<div class="period-chip ${active?'active':''}" data-key="${k}">
        <span>${monthLabel(k)} <span class="period-chip-sub">— ${fmt(c.sumBasis)} zł, podatek ${c.due} zł</span></span>
        <button type="button" data-key="${k}" data-action="del" title="Usuń miesiąc">&times;</button>
      </div>`;
    }).join('');
    el.querySelectorAll('.period-chip').forEach(chip => {
      chip.addEventListener('click', e => {
        if(e.target.dataset.action === 'del') return;
        setActivePeriod(chip.dataset.key);
        document.getElementById('periodMonthInput').value = chip.dataset.key;
      });
    });
    el.querySelectorAll('button[data-action="del"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const k = btn.dataset.key;
        if(confirm(`Usunąć cały miesiąc ${monthLabel(k)} wraz z jego ewidencją? Tej operacji nie można cofnąć.`)){
          delete state.periods[k];
          if(state.activePeriod === k){
            const remaining = Object.keys(state.periods).sort();
            state.activePeriod = remaining.length ? remaining[remaining.length-1] : null;
            if(state.activePeriod) syncZusFieldsFromPeriod();
          }
          saveState();
          renderPeriodList();
          renderEvidence();
          renderYearSummary();
        }
      });
    });
  }

  document.getElementById('openPeriodBtn').addEventListener('click', () => {
    const val = document.getElementById('periodMonthInput').value;
    if(!val){ alert('Wybierz miesiąc.'); return; }
    setActivePeriod(val);
  });

  // ---------- profile fields ----------
  const profileFieldMap = { sellerName:'name', sellerNip:'nip', sellerPesel:'pesel', sellerStreet:'street', sellerZipCity:'zipCity', sellerEmail:'email', businessStartDate:'businessStart', sellerBank:'bank', sellerBankName:'bankName', sellerBankSwift:'bankSwift', sellerZusAccount:'zusAccount', sellerTaxMicroAccount:'taxMicroAccount' };
  Object.keys(profileFieldMap).forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      state.profile[profileFieldMap[id]] = document.getElementById(id).value;
      saveState();
      if(id === 'businessStartDate'){ renderZusModeHint(); refreshAllZusDependent(); }
      if(id === 'sellerZusAccount' || id === 'sellerTaxMicroAccount') renderPaymentInfo();
    });
  });

  // ---------- export / import / clear ----------
  function downloadCsv(csv, filename){
    const blob = new Blob(['﻿' + csv], {type:'text/csv;charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  }

  document.getElementById('exportCsvBtn').addEventListener('click', () => {
    const key = state.activePeriod;
    if(!key){ alert('Brak wybranego okresu.'); return; }
    const period = state.periods[key];
    const c = computeForPeriod(key);
    const chorobowa = state.settings.chorobowa ? 'z chorobowym' : 'bez chorobowego';

    let csv = 'Lp;Data;Nr faktury;Nabywca;Netto;VAT;Brutto;Podstawa;Stawka\n';
    period.rows.forEach((r, i) => {
      csv += [i+1, r.date, r.number, r.buyer, fmt(r.net), fmt(r.vat), fmt(r.gross), fmt(r.basis), r.rate+'%']
        .map(v => String(v).replace(/;/g,',')).join(';') + '\n';
    });
    csv += `\nOkres;${monthLabel(key)}\n`;
    csv += `Faza działalności;${PHASE_LABELS[c.phase]} (${chorobowa})\n`;
    csv += `Suma podstawy przychodu;${fmt(c.sumBasis)}\n`;
    csv += `Odliczenie - składka społeczna;${fmt(c.social)}\n`;
    csv += `Zastosowana składka zdrowotna;${fmt(c.healthUsed)}\n`;
    csv += `Odliczenie - 50% składki zdrowotnej;${fmt(c.halfHealth)}\n`;
    csv += `Podstawa opodatkowania;${fmt(c.taxBase)}\n`;
    csv += `Podatek do zapłaty;${c.due}\n`;

    downloadCsv(csv, 'ewidencja-' + key + '.csv');
  });

  document.getElementById('exportYearCsvBtn').addEventListener('click', () => {
    if(!state.activePeriod){ alert('Brak wybranego okresu.'); return; }
    const year = state.activePeriod.slice(0,4);
    const keys = Object.keys(state.periods).filter(k => k.slice(0,4) === year).sort();

    let csv = 'Miesiac;Lp;Data;Nr faktury;Nabywca;Netto;VAT;Brutto;Podstawa;Stawka\n';
    keys.forEach(k => {
      state.periods[k].rows.forEach((r,i) => {
        csv += [monthLabel(k), i+1, r.date, r.number, r.buyer, fmt(r.net), fmt(r.vat), fmt(r.gross), fmt(r.basis), r.rate+'%']
          .map(v => String(v).replace(/;/g,',')).join(';') + '\n';
      });
    });
    csv += '\nPodsumowanie miesięczne\nMiesiac;Przychod;Podstawa opodatkowania;Podatek\n';
    let sumRev=0, sumBase=0, sumTax=0;
    keys.forEach(k => {
      const c = computeForPeriod(k);
      sumRev += c.sumBasis; sumBase += c.taxBase; sumTax += c.due;
      csv += [monthLabel(k), fmt(c.sumBasis), fmt(c.taxBase), c.due].join(';') + '\n';
    });
    csv += ['Razem', fmt(sumRev), fmt(sumBase), sumTax].join(';') + '\n';

    downloadCsv(csv, 'ewidencja-rok-' + year + '.csv');
  });

  document.getElementById('exportJsonBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ksiegowosc-jdg-kopia.json';
    a.click();
  });

  document.getElementById('importJsonBtn').addEventListener('click', () => document.getElementById('importInput').click());
  document.getElementById('importInput').addEventListener('change', e => {
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try{
        const data = JSON.parse(ev.target.result);
        const d = defaultState();
        state = {
          profile: {...d.profile, ...(data.profile||{})},
          settings: {
            ...d.settings, ...(data.settings||{}),
            openingByYear: {...((data.settings||{}).openingByYear||{})},
            malyZusIncome: {...d.settings.malyZusIncome, ...((data.settings||{}).malyZusIncome||{})}
          },
          periods: data.periods || {},
          activePeriod: data.activePeriod || null,
          idCounter: data.idCounter || 1
        };
        saveState();
        location.reload();
      }catch(err){ parseErrorsEl.textContent = 'Nie udało się wczytać kopii JSON: ' + err.message; }
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  });

  document.getElementById('clearBtn').addEventListener('click', () => {
    if(confirm('Usunąć WSZYSTKIE dane (profil, wszystkie miesiące, ustawienia)? Tej operacji nie można cofnąć.')){
      localStorage.removeItem(STORAGE_KEY);
      location.reload();
    }
  });

  // ---------- init ----------
  function initPage(){
    document.getElementById('sellerName').value = state.profile.name;
    document.getElementById('sellerNip').value = state.profile.nip;
    document.getElementById('sellerPesel').value = state.profile.pesel;
    document.getElementById('sellerStreet').value = state.profile.street;
    document.getElementById('sellerZipCity').value = state.profile.zipCity;
    document.getElementById('sellerEmail').value = state.profile.email;
    document.getElementById('businessStartDate').value = state.profile.businessStart;
    document.getElementById('sellerBank').value = state.profile.bank;
    document.getElementById('sellerBankName').value = state.profile.bankName;
    document.getElementById('sellerBankSwift').value = state.profile.bankSwift;
    document.getElementById('sellerZusAccount').value = state.profile.zusAccount;
    document.getElementById('sellerTaxMicroAccount').value = state.profile.taxMicroAccount;

    document.getElementById('thresholdLowInput').value = state.settings.thresholdLow;
    document.getElementById('thresholdHighInput').value = state.settings.thresholdHigh;
    document.getElementById('healthLowInput').value = state.settings.healthLow;
    document.getElementById('healthMidInput').value = state.settings.healthMid;
    document.getElementById('healthHighInput').value = state.settings.healthHigh;
    document.getElementById('tierModeSelect').value = state.settings.tierMode;
    document.getElementById('wypadkoweRateInput').value = state.settings.wypadkoweRate;
    document.getElementById('minWageInput').value = state.settings.minWage;
    document.getElementById('avgWageForecastInput').value = state.settings.avgWageForecast;
    document.getElementById('zusPhaseModeSelect').value = state.settings.zusPhaseMode;
    document.getElementById('chorobowaGlobalCheck').checked = state.settings.chorobowa;
    document.getElementById('malyRevenuePrevInput').value = state.settings.malyZusIncome.revenue;
    document.getElementById('malyDaysPrevInput').value = state.settings.malyZusIncome.days;
    document.getElementById('malyZusSettingsFields').style.display = state.settings.zusPhaseMode === 'maly' ? 'grid' : 'none';
    renderZusModeHint();

    document.getElementById('invRyczaltRate').innerHTML = rateOptionsHtml(3);
    document.getElementById('invDate').value = new Date().toISOString().slice(0,10);
    updateBuyerIdFieldsVisibility();

    if(!Object.keys(state.periods).length){
      const key = currentMonthKey();
      ensurePeriod(key);
      state.activePeriod = key;
    } else if(!state.activePeriod || !state.periods[state.activePeriod]){
      state.activePeriod = Object.keys(state.periods).sort().pop();
    }
    document.getElementById('periodMonthInput').value = state.activePeriod;

    syncZusFieldsFromPeriod();
    saveState();
    renderPeriodList();
    renderEvidence();
    renderYearSummary();
    renderServiceDatalist();
    renderBuyerQuickPick();
    renderPaymentInfo();
    addDraftItem();
  }

  initPage();

  if('serviceWorker' in navigator && location.protocol !== 'file:'){
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    });
  }
})();
