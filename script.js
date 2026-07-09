(function(){
  const STORAGE_KEY = 'jdgRyczaltState_v1';
  const RATES = [2, 3, 5.5, 8.5, 10, 12, 12.5, 14, 15, 17];
  const VAT_OPTIONS = [
    {v:'23', label:'23%'}, {v:'8', label:'8%'}, {v:'5', label:'5%'},
    {v:'0', label:'0%'}, {v:'zw', label:'zw. (освобождён от НДС)'}, {v:'np', label:'np. (вне НДС)'}
  ];
  const MONTHS_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const MONTHS_RU_SHORT = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
  const FORMA_PLATNOSCI = { 'перевод': 6, 'наличные': 1, 'карта': 2, 'BLIK': 7 };
  const KOD_TYTULU = { start: '0540', pref: '0570', maly: '0590', full: '0510' };
  const PHASE_LABELS = { start: 'льгота на старт', pref: 'льготный ZUS', maly: 'Малый ZUS Plus', full: 'полный ZUS' };

  const fmt = n => (Math.round((n||0)*100)/100).toLocaleString('ru-RU', {minimumFractionDigits:2, maximumFractionDigits:2});
  const round2 = n => Math.round((n||0)*100)/100;
  const esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const currentMonthKey = () => { const d = new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); };
  const monthLabel = key => { const [y,m] = key.split('-'); return `${MONTHS_RU[parseInt(m,10)-1]} ${y}`; };
  const formatDateRu = d => `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;

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
    textEl.textContent = 'сохранение…';
    clearTimeout(saveStatusTimeout);
    saveStatusTimeout = setTimeout(() => {
      el.classList.remove('saving');
      textEl.textContent = 'сохранено ' + new Date().toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'});
    }, 350);
  }

  function saveState(){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    flashSaveStatus();
  }

  // Ulga na start: 6 полных календарных месяцев, если ИП открыто 1-го числа месяца;
  // иначе первый (неполный) месяц не считается "полным" — и получается 7 месяцев.
  function computeAutoPhaseForKey(key){
    const start = state.profile.businessStart;
    if(!start) return null;
    const [sy,sm,sd] = start.split('-').map(Number);
    const [py,pm] = key.split('-').map(Number);
    const monthsElapsed = (py*12+pm) - (sy*12+sm);
    if(monthsElapsed < 0) return null;
    const ulgaMonths = (sd && sd > 1) ? 7 : 6;
    if(monthsElapsed < ulgaMonths) return 'start';
    if(monthsElapsed < ulgaMonths + 24) return 'pref';
    return 'full';
  }

  function addMonthsYM(y, m, n){
    const total = (y*12 + (m-1)) + n;
    return { y: Math.floor(total/12), m: (total%12)+1 };
  }

  function getPhaseTransitionInfo(){
    const start = state.profile.businessStart;
    if(!start) return null;
    const [sy,sm,sd] = start.split('-').map(Number);
    const ulgaMonths = (sd && sd > 1) ? 7 : 6;
    const pref = addMonthsYM(sy, sm, ulgaMonths);
    const full = addMonthsYM(sy, sm, ulgaMonths + 24);
    const ulgaEnd = new Date(pref.y, pref.m-1, 0);
    const prefStart = new Date(pref.y, pref.m-1, 1);
    const prefEnd = new Date(full.y, full.m-1, 0);
    const fullStart = new Date(full.y, full.m-1, 1);
    const deadline1 = new Date(prefStart); deadline1.setDate(deadline1.getDate()+7);
    const deadline2 = new Date(fullStart); deadline2.setDate(deadline2.getDate()+7);
    return { ulgaMonths, ulgaEnd, prefStart, prefEnd, fullStart, deadline1, deadline2 };
  }

  function renderZusReminder(){
    const el = document.getElementById('zusReminderBox');
    if(!el) return;
    if(state.settings.zusPhaseMode !== 'auto'){ el.style.display = 'none'; return; }
    const info = getPhaseTransitionInfo();
    if(!info){ el.style.display = 'none'; return; }
    const today = new Date(); today.setHours(0,0,0,0);
    const daysDiff = d => Math.round((d - today) / 86400000);
    const items = [];
    const d1 = daysDiff(info.prefStart);
    if(d1 >= -30 && d1 <= 30){
      items.push(`Льгота на старт заканчивается ${formatDateRu(info.ulgaEnd)}. С ${formatDateRu(info.prefStart)} начинается льготный ZUS — подайте в ZUS заявление об изменении регистрации (выход из старого титула страхования и новое заявление, ZWUA + ZUA той же датой) в течение 7 дней, то есть до ${formatDateRu(info.deadline1)}.`);
    }
    const d2 = daysDiff(info.fullStart);
    if(d2 >= -30 && d2 <= 30){
      items.push(`Льготный ZUS заканчивается ${formatDateRu(info.prefEnd)}. С ${formatDateRu(info.fullStart)} действует полный ZUS — подайте в ZUS заявление об изменении регистрации в течение 7 дней, то есть до ${formatDateRu(info.deadline2)}.`);
    }
    if(!items.length){ el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.innerHTML = '<strong>Напоминание про перерегистрацию в ZUS:</strong><br>' + items.join('<br>');
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
    document.getElementById('tabGlavnaya').hidden = tab !== 'glavnaya';
    document.getElementById('tabSchety').hidden = tab !== 'schety';
    document.getElementById('tabDokumenty').hidden = tab !== 'dokumenty';
    document.getElementById('tabUstawienia').hidden = tab !== 'ustawienia';
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
    window.scrollTo({top:0});
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
    el.innerHTML = '<option value="">— выберите, чтобы заполнить данные —</option>' +
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

  // ---------- invoice form show/hide ----------
  function showInvoiceForm(){
    document.getElementById('invoiceFormCard').style.display = 'block';
    document.getElementById('invoiceFormCard').scrollIntoView({behavior:'smooth', block:'start'});
  }
  function hideInvoiceForm(){
    document.getElementById('invoiceFormCard').style.display = 'none';
    document.getElementById('invoicePreview').innerHTML = '';
  }
  function resetInvoiceForm(){
    draftItems = [];
    draftItemIdCounter = 1;
    document.getElementById('buyerName').value = '';
    document.getElementById('buyerNip').value = '';
    document.getElementById('buyerVatId').value = '';
    document.getElementById('buyerStreet').value = '';
    document.getElementById('buyerZipCity').value = '';
    document.getElementById('buyerJst').checked = false;
    document.getElementById('buyerGv').checked = false;
    document.getElementById('buyerIdType').value = 'nip';
    updateBuyerIdFieldsVisibility();
    document.getElementById('invDate').value = new Date().toISOString().slice(0,10);
    document.getElementById('invSaleDate').value = '';
    document.getElementById('invNumber').value = suggestInvoiceNumber(document.getElementById('invDate').value);
    document.getElementById('invoicePreview').innerHTML = '';
    addDraftItem();
  }

  document.getElementById('newInvoiceBtn').addEventListener('click', () => {
    resetInvoiceForm();
    showInvoiceForm();
  });
  document.getElementById('cancelInvoiceBtn').addEventListener('click', hideInvoiceForm);
  document.getElementById('toggleImportBtn').addEventListener('click', () => {
    const panel = document.getElementById('importPanel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });

  function loadDraftFromSnapshot(snapshot){
    fillBuyerFields(snapshot.buyer || {});

    document.getElementById('invRyczaltRate').value = snapshot.rate;
    document.getElementById('invCurrency').value = snapshot.currency || 'PLN';
    document.getElementById('invKursField').style.display = (snapshot.currency && snapshot.currency !== 'PLN') ? 'flex' : 'none';
    document.getElementById('invKurs').value = snapshot.kurs || '';
    document.getElementById('invPaymentForm').value = snapshot.paymentForm || 'перевод';
    document.getElementById('invPaymentDays').value = snapshot.paymentDays || 7;
    document.getElementById('invPlace').value = snapshot.place || '';
    document.getElementById('invCashMethod').checked = !!snapshot.cashMethod;
    document.getElementById('invSelfBilling').checked = !!snapshot.selfBilling;
    document.getElementById('invReverseCharge').checked = !!snapshot.reverseCharge;
    document.getElementById('invSplitPayment').checked = !!snapshot.splitPayment;
    document.getElementById('invDate').value = new Date().toISOString().slice(0,10);
    document.getElementById('invSaleDate').value = '';
    document.getElementById('invNumber').value = suggestInvoiceNumber(document.getElementById('invDate').value);

    draftItems = (snapshot.items || []).map(it => ({...it, id: draftItemIdCounter++}));
    if(!draftItems.length) addDraftItem(); else renderDraftItems();

    switchTab('schety');
    showInvoiceForm();
  }

  // ---------- draft invoice items ----------
  let draftItems = [];
  let draftItemIdCounter = 1;

  function addDraftItem(){
    draftItems.push({ id: draftItemIdCounter++, desc: '', qty: 1, unit: 'усл.', price: 0, vat: 'zw' });
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
        <td><button class="del-btn" data-id="${it.id}" title="Удалить позицию">&times;</button></td>
      `;
      body.appendChild(tr);
    });
    if(!draftItems.length){
      body.innerHTML = '<tr class="empty-row"><td colspan="9">Нет позиций — добавьте хотя бы одну.</td></tr>';
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

  function suggestInvoiceNumber(dateStr){
    const key = dateStr ? dateStr.slice(0,7) : currentMonthKey();
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
<!-- Рабочий файл — сгенерирован вспомогательно калькулятором, НЕ проверен официальной схемой XSD FA(3).
     Перед реальной отправкой проверьте его в бесплатном Aplikacji Podatnika KSeF (демо-среда) на ksef.podatki.gov.pl,
     либо просто перепишите данные из предпросмотра ниже напрямую в Aplikację Podatnika / e-mikrofirmę. -->
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
    if(!draftItems.length){ alert('Добавьте хотя бы одну позицию счёта.'); return; }

    const seller = {
      name: document.getElementById('sellerName').value,
      nip: document.getElementById('sellerNip').value,
      street: document.getElementById('sellerStreet').value,
      zipCity: document.getElementById('sellerZipCity').value,
      bank: document.getElementById('sellerBank').value,
      bankName: document.getElementById('sellerBankName').value,
      bankSwift: document.getElementById('sellerBankSwift').value,
    };
    if(!seller.name || !seller.nip){ alert('Заполните данные вашей фирмы во вкладке «Настройки» (хотя бы название и NIP).'); return; }

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
    if(!buyer.name){ alert('Укажите название / имя и фамилию покупателя.'); return; }
    if(idType === 'nip' && !buyer.nip){ alert('Укажите NIP покупателя или измените идентификацию покупателя.'); return; }
    if(idType === 'vatue' && (!buyer.vatId || !buyer.country)){ alert('Укажите код страны и иностранный номер VAT покупателя.'); return; }

    const invDateVal = document.getElementById('invDate').value || new Date().toISOString().slice(0,10);
    const currency = document.getElementById('invCurrency').value;
    const kurs = parseFloat(document.getElementById('invKurs').value) || 0;
    if(currency !== 'PLN' && kurs <= 0){ alert('Укажите курс валюты для пересчёта в PLN (для учёта доходов).'); return; }

    const inv = {
      number: document.getElementById('invNumber').value || suggestInvoiceNumber(invDateVal),
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
      return `  • ${esc(it.desc) || '(без описания)'} — ${it.qty} ${esc(it.unit)} × ${fmt(it.price)} ${currency} = ${fmt(c.net)} ${currency} нетто, VAT ${it.vat==='zw'?'zw.':it.vat==='np'?'np.':it.vat+'%'} (${fmt(c.vatAmount)} ${currency}) → ${fmt(c.gross)} ${currency} брутто`;
    }).join('\n');

    const buyerIdLine = idType==='nip' ? `NIP ${esc(buyer.nip)}` : idType==='vatue' ? `${esc(buyer.country)} VAT ${esc(buyer.vatId)}` : '(без идентификатора)';

    const preview = document.getElementById('invoicePreview');
    preview.innerHTML = `
      <h3>Готово — предпросмотр счёта ${esc(inv.number)}</h3>
      <p style="margin:0 0 6px;">Добавлено в список месяца ${esc(monthLabel(periodKey))}. Скачайте XML-файл (рабочий) или просто перепишите данные ниже
      в бесплатное Aplikację Podatnika KSeF / e-mikrofirmę — это займёт пару секунд, и вы будете уверены в соответствии схеме.</p>
      <pre>Продавец: ${esc(seller.name)}, NIP ${esc(seller.nip)}
Покупатель: ${esc(buyer.name)}, ${buyerIdLine}
Дата выставления: ${inv.date}${inv.saleDate ? '    Дата продажи: '+inv.saleDate : ''}    Срок оплаты: ${inv.paymentDays} дн. (${inv.paymentForm})
Номер счёта: ${inv.number}    Валюта: ${currency}${currency!=='PLN' ? ' (курс '+kurs+')' : ''}

Позиции:
${itemLines}

Итого нетто: ${fmt(net)} ${currency}   VAT: ${fmt(vat)} ${currency}   Брутто: ${fmt(gross)} ${currency}
В учёт доходов: ${fmt(net*fx)} zł</pre>
      <div class="actions" style="margin:10px 0 0;">
        <a class="action primary" style="text-decoration:none; display:inline-block;" href="${url}" download="faktura_${safeName}.xml">Скачать XML (рабочий)</a>
      </div>
    `;

    resetInvoiceForm();

    state.activePeriod = periodKey;
    uiYear = parseInt(periodKey.slice(0,4), 10);
    saveState();
    syncZusFieldsFromPeriod();
    renderYearMonthSwitcher();
    renderInvoiceList();
    renderYearSummary();
    renderServiceDatalist();
    renderBuyerQuickPick();
    updateSummary();
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
    if(doc.getElementsByTagName('parsererror').length) throw new Error('не удалось прочитать XML-файл');

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
        errors.push(file.name + ': ошибка чтения файла');
        pending--;
        if(pending === 0) finish();
      };
      reader.readAsText(file, 'UTF-8');
    });
    function finish(){
      if(touched.size){
        state.activePeriod = Array.from(touched).sort().pop();
        syncZusFieldsFromPeriod();
        uiYear = parseInt(state.activePeriod.slice(0,4), 10);
      }
      saveState();
      renderYearMonthSwitcher();
      renderInvoiceList();
      renderYearSummary();
      parseErrorsEl.textContent = errors.length ? ('Не удалось прочитать: ' + errors.join(' · ')) : '';
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
    const key = currentMonthKey();
    const today = new Date().toISOString().slice(0,10);
    ensurePeriod(key).rows.push({ id: state.idCounter++, date: today, number: 'ручная запись', buyer: '', net: 0, vat: 0, gross: 0, basis: 0, rate: 3, source: 'manual' });
    saveState();
    renderInvoiceList();
    renderYearSummary();
    renderYearMonthSwitcher();
  });

  // ---------- invoices list (Счета tab) ----------
  function getAllEntriesFlat(){
    const list = [];
    Object.keys(state.periods).sort().forEach(k => {
      state.periods[k].rows.forEach(r => list.push({ row: r, periodKey: k }));
    });
    return list;
  }

  function populateFilterYearOptions(){
    const sel = document.getElementById('filterYear');
    const prevVal = sel.value;
    const years = new Set(Object.keys(state.periods).map(k => k.slice(0,4)));
    years.add(String(new Date().getFullYear()));
    const sorted = Array.from(years).sort().reverse();
    sel.innerHTML = '<option value="">Все годы</option>' + sorted.map(y => `<option value="${y}">${y}</option>`).join('');
    sel.value = sorted.includes(prevVal) ? prevVal : '';
  }

  function getFilteredEntries(){
    const yearFilter = document.getElementById('filterYear').value;
    const monthFilter = document.getElementById('filterMonth').value;
    const search = (document.getElementById('filterSearch').value || '').trim().toLowerCase();
    return getAllEntriesFlat().filter(({row, periodKey}) => {
      const y = periodKey.slice(0,4), m = periodKey.slice(5,7);
      if(yearFilter && y !== yearFilter) return false;
      if(monthFilter && m !== monthFilter) return false;
      if(search){
        const hay = ((row.buyer||'') + ' ' + (row.number||'')).toLowerCase();
        if(!hay.includes(search)) return false;
      }
      return true;
    }).sort((a,b) => (b.row.date||'').localeCompare(a.row.date||'') || (b.row.id - a.row.id));
  }

  function renderInvoiceStats(entries){
    const curYear = String(new Date().getFullYear());
    let sumYear = 0;
    Object.keys(state.periods).forEach(k => { if(k.slice(0,4) === curYear) sumYear += periodBasisSum(k); });
    document.getElementById('statYear').textContent = fmt(sumYear) + ' zł';
    document.getElementById('statYearLabel').textContent = 'Доход с начала ' + curYear + ' года';
    const sumFiltered = entries.reduce((s,e) => s+(e.row.basis||0), 0);
    document.getElementById('statFiltered').textContent = fmt(sumFiltered) + ' zł';
    document.getElementById('statCount').textContent = entries.length;
  }

  function renderInvoiceList(){
    populateFilterYearOptions();
    const entries = getFilteredEntries();
    const tbody = document.getElementById('tbody');
    tbody.innerHTML = '';
    if(!entries.length){
      tbody.innerHTML = '<tr class="empty-row"><td colspan="10">Счетов не найдено.</td></tr>';
    } else {
      entries.forEach(({row, periodKey}) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${monthLabel(periodKey)}</td>
          <td contenteditable="true" data-field="date" data-period="${periodKey}" data-id="${row.id}">${esc(row.date || '')}</td>
          <td contenteditable="true" data-field="number" data-period="${periodKey}" data-id="${row.id}">${esc(row.number || '')}</td>
          <td contenteditable="true" data-field="buyer" data-period="${periodKey}" data-id="${row.id}">${esc(row.buyer || '')}</td>
          <td class="num">${fmt(row.net)}</td>
          <td class="num">${fmt(row.vat)}</td>
          <td class="num">${fmt(row.gross)}</td>
          <td class="num editable-cell"><input type="number" step="0.01" value="${row.basis}" data-period="${periodKey}" data-id="${row.id}" data-role="basis"></td>
          <td class="rate-cell"><select data-period="${periodKey}" data-id="${row.id}" data-role="rate">${rateOptionsHtml(row.rate)}</select></td>
          <td><div class="row-actions">${row.source==='issued' && row.snapshot ? `<button class="dup-btn" data-period="${periodKey}" data-id="${row.id}" title="Дублировать — выставить похожий счёт">⧉</button>` : ''}<button class="del-btn" data-period="${periodKey}" data-id="${row.id}" title="Удалить">&times;</button></div></td>
        `;
        tbody.appendChild(tr);
      });
    }

    let sumNet=0, sumVat=0, sumGross=0, sumBasis=0;
    entries.forEach(({row}) => { sumNet+=row.net; sumVat+=row.vat; sumGross+=row.gross; sumBasis+=(row.basis||0); });
    document.getElementById('sumNet').textContent = fmt(sumNet);
    document.getElementById('sumVat').textContent = fmt(sumVat);
    document.getElementById('sumGross').textContent = fmt(sumGross);
    document.getElementById('sumBasis').textContent = fmt(sumBasis);

    tbody.querySelectorAll('[contenteditable]').forEach(cell => {
      cell.addEventListener('blur', () => {
        const row = state.periods[cell.dataset.period].rows.find(r => r.id == cell.dataset.id);
        if(row) row[cell.dataset.field] = cell.textContent.trim();
        saveState();
      });
    });
    tbody.querySelectorAll('[data-role="basis"]').forEach(inp => {
      inp.addEventListener('input', () => {
        const row = state.periods[inp.dataset.period].rows.find(r => r.id == inp.dataset.id);
        if(row) row.basis = parseFloat(inp.value) || 0;
        saveState(); renderInvoiceList(); renderYearSummary(); updateSummary(); renderYearMonthSwitcher();
      });
    });
    tbody.querySelectorAll('[data-role="rate"]').forEach(sel => {
      sel.addEventListener('change', () => {
        const row = state.periods[sel.dataset.period].rows.find(r => r.id == sel.dataset.id);
        if(row) row.rate = parseFloat(sel.value);
        saveState(); renderInvoiceList(); renderYearSummary(); updateSummary(); renderYearMonthSwitcher();
      });
    });
    tbody.querySelectorAll('.del-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = state.periods[btn.dataset.period];
        p.rows = p.rows.filter(r => r.id != btn.dataset.id);
        saveState(); renderInvoiceList(); renderYearSummary(); updateSummary(); renderYearMonthSwitcher();
      });
    });
    tbody.querySelectorAll('.dup-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = state.periods[btn.dataset.period];
        const row = p.rows.find(r => r.id == btn.dataset.id);
        if(row && row.snapshot) loadDraftFromSnapshot(row.snapshot);
      });
    });

    renderInvoiceStats(entries);
  }

  ['filterYear','filterMonth'].forEach(id => {
    document.getElementById(id).addEventListener('change', renderInvoiceList);
  });
  document.getElementById('filterSearch').addEventListener('input', renderInvoiceList);

  // ---------- ZUS / phase handling ----------
  function renderZusCard(){
    const key = state.activePeriod;
    const hintEl = document.getElementById('zusPhaseHint');
    const body = document.getElementById('socialBreakdownBody');
    const overrideSelect = document.getElementById('phaseOverrideSelect');
    document.getElementById('zusMonthLabel').textContent = key ? monthLabel(key) : '— месяц не выбран —';
    if(!key || !state.periods[key]){
      hintEl.textContent = 'Выберите месяц выше.';
      body.innerHTML = '<tr><td colspan="6">—</td></tr>';
      overrideSelect.value = '';
      return;
    }
    const p = state.periods[key];
    const phase = getEffectivePhase(key);
    const auto = state.settings.zusPhaseMode === 'auto' ? computeAutoPhaseForKey(key) : null;
    const source = p.phaseOverride
      ? 'задано вручную для этого месяца'
      : (state.settings.zusPhaseMode === 'auto'
          ? (auto ? 'автоматически, на основе даты открытия ИП' : 'автоматически (нет даты открытия ИП в Настройках — по умолчанию льгота на старт)')
          : 'задано на постоянной основе в Настройках');
    hintEl.innerHTML = `Фаза в этом месяце: <strong>${PHASE_LABELS[phase]}</strong> — ${esc(source)}.`;
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
    renderYearMonthSwitcher();
  });

  document.getElementById('socialInput').addEventListener('input', () => {
    if(!state.activePeriod) return;
    ensurePeriod(state.activePeriod).socialOverride = parseFloat(document.getElementById('socialInput').value) || 0;
    saveState(); updateSummary(); renderYearSummary(); renderYearMonthSwitcher();
  });
  document.getElementById('socialResetBtn').addEventListener('click', () => {
    if(!state.activePeriod) return;
    ensurePeriod(state.activePeriod).socialOverride = null;
    saveState(); renderZusCard(); updateSummary(); renderYearSummary(); renderYearMonthSwitcher();
  });

  function refreshAllZusDependent(){
    saveState();
    renderZusCard();
    updateSummary();
    renderYearSummary();
    renderYearMonthSwitcher();
    renderZusReminder();
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
    if(mode !== 'auto'){ el.textContent = `Каждый месяц будет считаться в фазе: ${PHASE_LABELS[mode]}, пока вы не смените режим здесь.`; return; }
    const start = state.profile.businessStart;
    if(!start){ el.textContent = 'Заполните «Дату открытия ИП» в разделе выше, чтобы автоматический режим считал фазы правильно — без неё каждый месяц получит «Льготу на старт».'; return; }
    const info = getPhaseTransitionInfo();
    const ulgaNote = info.ulgaMonths === 7 ? ' (7 месяцев, так как ИП открыто не с 1-го числа — первый неполный месяц не считается «полным»)' : ' (6 месяцев, так как ИП открыто с 1-го числа)';
    el.textContent = `Считая от ${start}: льгота на старт до ${formatDateRu(info.ulgaEnd)}${ulgaNote}, льготный ZUS с ${formatDateRu(info.prefStart)} до ${formatDateRu(info.prefEnd)}, полный ZUS с ${formatDateRu(info.fullStart)}. Это можно переопределить для отдельного месяца во вкладке «Налоги».`;
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
    const year = String(uiYear);
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

  // ---------- result summary (PIT) ----------
  function updateSummary(){
    const key = state.activePeriod;
    const period = key ? state.periods[key] : null;
    const c = key ? computeForPeriod(key) : null;

    document.getElementById('pitMonthLabel').textContent = key ? monthLabel(key) : '— месяц не выбран —';
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
      let html = '<table><thead><tr><th>Ставка</th><th class="num">Доход</th><th class="num">База после вычетов</th><th class="num">Налог</th></tr></thead><tbody>';
      c.breakdown.forEach(b => {
        html += `<tr><td>${b.rate}%</td><td class="num">${fmt(b.groupRevenue)} zł</td><td class="num">${fmt(b.groupBase)} zł</td><td class="num">${fmt(b.groupTax)} zł</td></tr>`;
      });
      html += '</tbody></table>';
      rateBreakdownEl.innerHTML = html;
    }

    document.getElementById('calcDue').textContent = c ? c.due : 0;

    const s = state.settings;
    const tierLabel = c ? (c.tier==='low' ? 'I порог (до '+fmt(s.thresholdLow)+' zł)' : c.tier==='mid' ? 'II порог ('+fmt(s.thresholdLow)+'–'+fmt(s.thresholdHigh)+' zł)' : 'III порог (свыше '+fmt(s.thresholdHigh)+' zł)') : '';
    document.getElementById('cumulativeHint').textContent = c
      ? ('Доход нарастающим итогом: ' + fmt(c.cumulative) + ' zł → ' + tierLabel + ' → взнос на медстрахование: ' + fmt(c.healthUsed) + ' zł/мес.' + (s.tierMode!=='auto' ? ' (задано вручную)' : ''))
      : 'Выберите месяц выше, чтобы увидеть расчёты.';

    document.getElementById('stampPeriod').textContent = key ? monthLabel(key) : 'период не выбран';

    renderDeclaration();
    renderPaymentInfo();
    renderHome();
  }

  function computeZusTotal(key){
    if(!key || !state.periods[key]) return 0;
    const c = computeForPeriod(key);
    const phase = c.phase;
    const sb = computeSocialBreakdown(phase, key);
    let total = c.healthUsed;
    if(phase !== 'start'){
      total += sb.emerytalna + sb.rentowa + sb.wypadkowe + (sb.chorobowe>0?sb.chorobowe:0) + (sb.fp>0?sb.fp:0);
    }
    return round2(total);
  }

  function renderPaymentInfo(){
    const zusBox = document.getElementById('payZusBox');
    const taxBox = document.getElementById('payTaxBox');
    if(!zusBox || !taxBox) return;
    const zusAcc = (state.profile.zusAccount || '').trim();
    const taxAcc = (state.profile.taxMicroAccount || '').trim();
    const key = state.activePeriod;
    const zusTotal = computeZusTotal(key);

    zusBox.innerHTML = zusAcc
      ? `<strong>К оплате: ${fmt(zusTotal)} zł</strong> на счёт NRS <strong>${esc(zusAcc)}</strong>
         <button type="button" class="copy-btn" data-copy="${esc(zusAcc)}">Копировать счёт</button>
         <button type="button" class="copy-btn" data-copy="${fmt(zusTotal)}">Копировать сумму</button>
         <br><span class="unit-note">Покрывает все взносы сразу. Срок: до 20-го числа следующего месяца.</span>`
      : `<strong>Куда платить:</strong> сохраните номер счёта ZUS (NRS) в <strong>Настройки → Куда платить</strong>. Срок: до 20-го числа следующего месяца.`;

    const due = key ? computeForPeriod(key).due : 0;
    taxBox.innerHTML = taxAcc
      ? `<strong>К оплате: ${fmt(due)} zł</strong> на налоговый микросчёт <strong>${esc(taxAcc)}</strong>
         <button type="button" class="copy-btn" data-copy="${esc(taxAcc)}">Копировать счёт</button>
         <button type="button" class="copy-btn" data-copy="${fmt(due)}">Копировать сумму</button>
         <br><span class="unit-note">Укажите «PIT-28» и период${key ? ' ('+esc(monthLabel(key))+')' : ''}. Срок: до 20-го числа следующего месяца.</span>`
      : `<strong>Куда платить:</strong> сохраните налоговый микросчёт в <strong>Настройки → Куда платить</strong>. Срок: до 20-го числа следующего месяца.`;
  }

  document.addEventListener('click', e => {
    const btn = e.target.closest('.copy-btn');
    if(!btn) return;
    const val = btn.dataset.copy;
    navigator.clipboard.writeText(val).then(() => {
      const old = btn.textContent;
      btn.textContent = 'Скопировано!';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = old; btn.classList.remove('copied'); }, 1400);
    }).catch(() => {});
  });

  // ---------- Главная: пошаговый экран месяца ----------
  const MONTHS_RU_GEN = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];

  function payDeadlineLabel(key){
    const [y,m] = key.split('-').map(Number);
    const d = new Date(y, m, 20); // 20-е число следующего месяца
    return `до 20 ${MONTHS_RU_GEN[d.getMonth()]} ${d.getFullYear()}`;
  }

  function renderHome(){
    const key = state.activePeriod || currentMonthKey();
    document.getElementById('homeMonthLabel').textContent = monthLabel(key);

    // онбординг: пока не заполнены данные — показываем чеклист
    const p = state.profile;
    const haveProfile = !!(p.name && p.nip);
    const haveStart = !!p.businessStart;
    const haveAccounts = !!((p.zusAccount||'').trim() && (p.taxMicroAccount||'').trim());
    const onb = document.getElementById('onboardingCard');
    if(!haveProfile || !haveStart){
      onb.style.display = 'block';
      const mark = ok => ok ? '<span style="color:var(--green);font-weight:700;">✓ готово</span>' : '<span style="color:var(--muted);">— не заполнено</span>';
      document.getElementById('onboardingList').innerHTML =
        `<li><span>1. Название фирмы и NIP</span><span class="v">${mark(haveProfile)}</span></li>` +
        `<li><span>2. Дата начала деятельности</span><span class="v">${mark(haveStart)}</span></li>` +
        `<li><span>3. Номера счетов для оплаты ZUS и налога</span><span class="v">${mark(haveAccounts)}</span></li>`;
    } else {
      onb.style.display = 'none';
    }

    // строка про фазу ZUS и когда льгота закончится
    const phase = getEffectivePhase(key);
    const phaseLine = document.getElementById('homePhaseLine');
    let phaseHtml = `Фаза ZUS в этом месяце: <strong>${PHASE_LABELS[phase]}</strong>`;
    if(state.settings.zusPhaseMode === 'auto'){
      const info = getPhaseTransitionInfo();
      if(info){
        if(phase === 'start') phaseHtml += ` · действует до ${formatDateRu(info.ulgaEnd)}, потом льготный ZUS — приложение напомнит подать заявление`;
        else if(phase === 'pref') phaseHtml += ` · действует до ${formatDateRu(info.prefEnd)}, потом полный ZUS`;
      } else {
        phaseHtml += ' · укажите дату начала деятельности в Настройках, чтобы льготы считались автоматически';
      }
    }
    phaseLine.innerHTML = phaseHtml;

    // шаги месяца
    const period = state.periods[key];
    const count = period ? period.rows.filter(r => r.basis !== 0 || r.net !== 0).length : 0;
    const hasInvoices = !!(period && period.rows.length);
    const c = period ? computeForPeriod(key) : null;
    const zusTotal = computeZusTotal(key);
    const due = c ? c.due : 0;
    const deadline = payDeadlineLabel(key);
    const zusAcc = (p.zusAccount||'').trim();
    const taxAcc = (p.taxMicroAccount||'').trim();

    const noAccountNote = which => `<div class="home-note">Сохраните ${which} в <button type="button" class="link-btn" data-home-goto="ustawienia">Настройках → Куда платить</button> — тогда здесь будут готовые реквизиты.</div>`;
    const accountLine = (acc, amount) => `
      <div class="home-pay-line">
        <span class="home-acc">${esc(acc)}</span>
        <span>
          <button type="button" class="copy-btn" data-copy="${esc(acc)}">Копировать счёт</button>
          <button type="button" class="copy-btn" data-copy="${fmt(amount)}">Копировать сумму</button>
        </span>
      </div>`;

    let html = '';

    // Шаг 1 — фактуры
    if(hasInvoices){
      html += `
      <div class="home-step done">
        <div class="step-circle">✓</div>
        <div class="home-step-body">
          <div class="home-step-title">Фактуры за ${esc(monthLabel(key))} выставлены</div>
          <div class="home-step-sub">${count} шт. · доход ${fmt(c.sumBasis)} zł · <button type="button" class="link-btn" data-home-goto="schety">посмотреть</button> · <button type="button" class="link-btn" data-home-action="new-invoice">+ ещё одна</button></div>
        </div>
      </div>`;
    } else {
      html += `
      <div class="home-step">
        <div class="step-circle">1</div>
        <div class="home-step-body">
          <div class="home-step-title">Сначала выставьте фактуру за ${esc(monthLabel(key))}</div>
          <div class="home-step-sub">Как только фактура будет выставлена, здесь появятся суммы ZUS и налога к оплате.</div>
          <div class="actions" style="margin-top:12px;">
            <button class="action primary" data-home-action="new-invoice">+ Выставить фактуру</button>
          </div>
        </div>
      </div>`;
    }

    const locked = hasInvoices ? '' : ' locked';

    // Шаг 2 — ZUS
    html += `
    <div class="home-step${locked}">
      <div class="step-circle">2</div>
      <div class="home-step-body">
        <div class="home-step-title">Оплатите ZUS <span class="home-deadline">${deadline}</span></div>
        ${hasInvoices ? `
          <div class="home-sum">${fmt(zusTotal)} zł</div>
          <div class="home-step-sub">Один перевод — покрывает все взносы (социальные + медицинский). Затем подайте декларацию ZUS DRA через PUE/eZUS — данные готовы во вкладке <button type="button" class="link-btn" data-home-goto="dokumenty">Документы</button>.</div>
          ${zusAcc ? accountLine(zusAcc, zusTotal) : noAccountNote('номер счёта ZUS (NRS)')}
        ` : `<div class="home-step-sub">Сначала выставьте фактуру.</div>`}
      </div>
    </div>`;

    // Шаг 3 — налог
    html += `
    <div class="home-step${locked}">
      <div class="step-circle">3</div>
      <div class="home-step-body">
        <div class="home-step-title">Оплатите налог PIT-28 <span class="home-deadline">${deadline}</span></div>
        ${hasInvoices ? `
          <div class="home-sum">${fmt(due)} zł</div>
          ${due > 0
            ? `<div class="home-step-sub">Перевод на ваш налоговый микросчёт, в назначении платежа: «PIT-28, ${esc(monthLabel(key))}». Детали расчёта — во вкладке <button type="button" class="link-btn" data-home-goto="dokumenty">Документы</button>.</div>
               ${taxAcc ? accountLine(taxAcc, due) : noAccountNote('налоговый микросчёт')}`
            : `<div class="home-step-sub">В этом месяце налог к оплате — 0 zł (вычеты покрыли базу). Платить не нужно.</div>`}
        ` : `<div class="home-step-sub">Сначала выставьте фактуру.</div>`}
      </div>
    </div>`;

    // Шаг 4 — документы
    html += `
    <div class="home-step${locked}">
      <div class="step-circle">4</div>
      <div class="home-step-body">
        <div class="home-step-title">Сохраните документы за месяц</div>
        ${hasInvoices ? `
          <div class="home-step-sub">Эвиденция доходов — обязательный учёт по закону. Скачайте PDF и храните.</div>
          <div class="actions" style="margin-top:12px;">
            <button class="action" data-home-action="evidencja">Эвиденция за месяц (PDF)</button>
            <button class="action" data-home-goto="dokumenty">Все документы</button>
          </div>
        ` : `<div class="home-step-sub">Сначала выставьте фактуру.</div>`}
      </div>
    </div>`;

    document.getElementById('homeSteps').innerHTML = html;
  }

  document.getElementById('tabGlavnaya').addEventListener('click', e => {
    const goto = e.target.closest('[data-home-goto]');
    if(goto){ switchTab(goto.dataset.homeGoto); return; }
    const act = e.target.closest('[data-home-action]');
    if(!act) return;
    if(act.dataset.homeAction === 'new-invoice'){
      switchTab('schety');
      resetInvoiceForm();
      showInvoiceForm();
    } else if(act.dataset.homeAction === 'evidencja'){
      document.getElementById('printEvidencjaMonthBtn').click();
    }
  });

  document.getElementById('onboardingGoBtn').addEventListener('click', () => switchTab('ustawienia'));

  function shiftHomeMonth(delta){
    const key = state.activePeriod || currentMonthKey();
    const [y,m] = key.split('-').map(Number);
    const d = new Date(y, m-1+delta, 1);
    const nk = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
    ensurePeriod(nk);
    setActivePeriod(nk);
  }
  document.getElementById('homePrevMonth').addEventListener('click', () => shiftHomeMonth(-1));
  document.getElementById('homeNextMonth').addEventListener('click', () => shiftHomeMonth(1));

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
    const kodEl = document.getElementById('declKodTytulu');
    const body = document.getElementById('declBody');
    const totalEl = document.getElementById('declTotal');
    const annualEl = document.getElementById('declAnnualHealth');

    if(!key || !state.periods[key]){
      kodEl.textContent = 'Выберите месяц выше.';
      body.innerHTML = '';
      totalEl.textContent = '0,00';
      annualEl.textContent = '';
      return;
    }

    const c = computeForPeriod(key);
    const phase = c.phase;
    const sb = computeSocialBreakdown(phase, key);
    const kod = KOD_TYTULU[phase] || '—';
    kodEl.innerHTML = `Фаза: <strong>${PHASE_LABELS[phase]}</strong>. Код титула страхования (ориентировочно): <strong>${kod}</strong>.
      Декларацию ZUS DRA за ${esc(monthLabel(key))} подайте до 20-го числа следующего месяца, электронно через PUE/eZUS.`;

    const rows = [];
    if(phase !== 'start'){
      rows.push(['Пенсионный', sb.podstawa, sb.emerytalna]);
      rows.push(['По инвалидности', sb.podstawa, sb.rentowa]);
      rows.push(['От несчастных случаев', sb.podstawa, sb.wypadkowe]);
      if(sb.chorobowe > 0) rows.push(['По болезни (добровольный)', sb.podstawa, sb.chorobowe]);
      if(sb.fp > 0) rows.push(['Фонд труда', sb.podstawa, sb.fp]);
    }
    rows.push(['Медицинское страхование', null, c.healthUsed]);

    body.innerHTML = rows.map(r => `<tr><td>${r[0]}</td><td class="num">${r[1]==null ? '—' : fmt(r[1])+' zł'}</td><td class="num">${fmt(r[2])} zł</td></tr>`).join('');
    totalEl.textContent = fmt(rows.reduce((s,r)=>s+r[2],0));

    const year = key.slice(0,4);
    const rec = computeAnnualHealthReconciliation(year);
    if(!rec){
      annualEl.textContent = 'Нет данных за этот год.';
    } else {
      const tierLabel = rec.tier === 'low' ? 'I порог' : rec.tier === 'mid' ? 'II порог' : 'III порог';
      const diffLabel = rec.diff > 0.005 ? `Доплата: ${fmt(rec.diff)} zł (добавьте к взносу за апрель, срок до 20 мая).`
        : rec.diff < -0.005 ? `Переплата: ${fmt(-rec.diff)} zł (можете подать заявление RZS-R на возврат).`
        : 'Нет ни доплаты, ни переплаты.';
      const incompleteNote = rec.monthsCount < 12 ? ` Внимание: в приложении сохранено ${rec.monthsCount} из 12 месяцев этого года — расчёт станет окончательным только после декабря.` : '';
      annualEl.textContent = `Доход за ${year} год: ${fmt(rec.fullYearRevenue)} zł → ${tierLabel} → годовой взнос по итоговому доходу: ${fmt(rec.dueTotal)} zł (${rec.monthsCount} мес. × ${fmt(rec.monthlyRate)} zł). Сумма фактически начисленных месячных взносов: ${fmt(rec.totalPaid)} zł. ${diffLabel}${incompleteNote}`;
    }
  }

  function renderYearSummary(){
    const body = document.getElementById('yearSummaryBody');
    if(!state.activePeriod){
      body.innerHTML = '<tr class="empty-row"><td colspan="4">Период не выбран.</td></tr>';
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
    if(!keys.length) body.innerHTML = '<tr class="empty-row"><td colspan="4">Нет данных за этот год.</td></tr>';
    document.getElementById('yearSumRevenue').textContent = fmt(sumRev);
    document.getElementById('yearSumTaxBase').textContent = fmt(sumTaxBase);
    document.getElementById('yearSumTax').textContent = fmt(sumTax);
  }

  // ---------- year / month switcher (Налоги tab) ----------
  let uiYear = new Date().getFullYear();

  function renderYearMonthSwitcher(){
    document.getElementById('yearLabel').textContent = uiYear;
    const grid = document.getElementById('monthGrid');
    grid.innerHTML = MONTHS_RU_SHORT.map((name, idx) => {
      const mm = String(idx+1).padStart(2,'0');
      const key = `${uiYear}-${mm}`;
      const exists = !!state.periods[key];
      const active = key === state.activePeriod;
      let stat = '';
      if(exists){
        const c = computeForPeriod(key);
        stat = `<span class="month-stat">${fmt(c.sumBasis)} zł</span>`;
      }
      return `<div class="month-cell ${active?'active':''} ${exists?'has-data':''}" data-key="${key}">
        <span class="month-name">${name}</span>${stat}
        ${exists ? `<button type="button" class="month-del" data-key="${key}" title="Удалить месяц">&times;</button>` : ''}
      </div>`;
    }).join('');

    grid.querySelectorAll('.month-cell').forEach(cell => {
      cell.addEventListener('click', e => {
        if(e.target.classList.contains('month-del')) return;
        setActivePeriod(cell.dataset.key);
      });
    });
    grid.querySelectorAll('.month-del').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const k = btn.dataset.key;
        if(confirm(`Удалить весь месяц ${monthLabel(k)} вместе со всеми его счетами? Это действие нельзя отменить.`)){
          delete state.periods[k];
          if(state.activePeriod === k){
            const remaining = Object.keys(state.periods).sort();
            state.activePeriod = remaining.length ? remaining[remaining.length-1] : null;
            if(state.activePeriod) syncZusFieldsFromPeriod();
          }
          saveState();
          renderYearMonthSwitcher();
          renderInvoiceList();
          renderYearSummary();
          updateSummary();
        }
      });
    });

    document.getElementById('openingByYearInput').value = state.settings.openingByYear[String(uiYear)] || 0;
  }

  document.getElementById('yearPrevBtn').addEventListener('click', () => { uiYear--; renderYearMonthSwitcher(); });
  document.getElementById('yearNextBtn').addEventListener('click', () => { uiYear++; renderYearMonthSwitcher(); });

  // ---------- period switcher ----------
  function syncZusFieldsFromPeriod(){
    const key = state.activePeriod;
    const p = state.periods[key];
    if(!p) return;
    renderZusCard();
  }

  function setActivePeriod(key){
    ensurePeriod(key);
    state.activePeriod = key;
    uiYear = parseInt(key.slice(0,4), 10);
    saveState();
    syncZusFieldsFromPeriod();
    renderYearMonthSwitcher();
    updateSummary();
    renderYearSummary();
  }

  // ---------- profile fields ----------
  const profileFieldMap = { sellerName:'name', sellerNip:'nip', sellerPesel:'pesel', sellerStreet:'street', sellerZipCity:'zipCity', sellerEmail:'email', businessStartDate:'businessStart', sellerBank:'bank', sellerBankName:'bankName', sellerBankSwift:'bankSwift', sellerZusAccount:'zusAccount', sellerTaxMicroAccount:'taxMicroAccount' };
  Object.keys(profileFieldMap).forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      state.profile[profileFieldMap[id]] = document.getElementById(id).value;
      saveState();
      if(id === 'businessStartDate'){ renderZusModeHint(); refreshAllZusDependent(); }
      if(id === 'sellerZusAccount' || id === 'sellerTaxMicroAccount') renderPaymentInfo();
      renderHome();
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
    if(!key){ alert('Месяц не выбран.'); return; }
    const period = state.periods[key];
    const c = computeForPeriod(key);
    const chorobowa = state.settings.chorobowa ? 'с добровольным страхованием по болезни' : 'без страхования по болезни';

    let csv = '№;Дата;№ счёта;Покупатель;Нетто;VAT;Брутто;База;Ставка\n';
    period.rows.forEach((r, i) => {
      csv += [i+1, r.date, r.number, r.buyer, fmt(r.net), fmt(r.vat), fmt(r.gross), fmt(r.basis), r.rate+'%']
        .map(v => String(v).replace(/;/g,',')).join(';') + '\n';
    });
    csv += `\nПериод;${monthLabel(key)}\n`;
    csv += `Фаза ZUS;${PHASE_LABELS[c.phase]} (${chorobowa})\n`;
    csv += `Сумма базы дохода;${fmt(c.sumBasis)}\n`;
    csv += `Вычет - социальный взнос;${fmt(c.social)}\n`;
    csv += `Применённый взнос на медстрахование;${fmt(c.healthUsed)}\n`;
    csv += `Вычет - 50% взноса на медстрахование;${fmt(c.halfHealth)}\n`;
    csv += `Налогооблагаемая база;${fmt(c.taxBase)}\n`;
    csv += `Налог к оплате;${c.due}\n`;

    downloadCsv(csv, 'nalog-' + key + '.csv');
  });

  document.getElementById('exportYearCsvBtn').addEventListener('click', () => {
    if(!state.activePeriod){ alert('Месяц не выбран.'); return; }
    const year = state.activePeriod.slice(0,4);
    const keys = Object.keys(state.periods).filter(k => k.slice(0,4) === year).sort();

    let csv = 'Месяц;№;Дата;№ счёта;Покупатель;Нетто;VAT;Брутто;База;Ставка\n';
    keys.forEach(k => {
      state.periods[k].rows.forEach((r,i) => {
        csv += [monthLabel(k), i+1, r.date, r.number, r.buyer, fmt(r.net), fmt(r.vat), fmt(r.gross), fmt(r.basis), r.rate+'%']
          .map(v => String(v).replace(/;/g,',')).join(';') + '\n';
      });
    });
    csv += '\nПомесячный итог\nМесяц;Доход;Налогооблагаемая база;Налог\n';
    let sumRev=0, sumBase=0, sumTax=0;
    keys.forEach(k => {
      const c = computeForPeriod(k);
      sumRev += c.sumBasis; sumBase += c.taxBase; sumTax += c.due;
      csv += [monthLabel(k), fmt(c.sumBasis), fmt(c.taxBase), c.due].join(';') + '\n';
    });
    csv += ['Итого', fmt(sumRev), fmt(sumBase), sumTax].join(';') + '\n';

    downloadCsv(csv, 'nalog-god-' + year + '.csv');
  });

  // ---------- ewidencja przychodów (PDF via print) ----------
  function buildEvidencjaDoc(entries, periodLabel, groupByMonth){
    const usedRates = Array.from(new Set(entries.map(e => e.row.rate))).sort((a,b)=>a-b);
    const s = state.profile;
    const addr = [s.street, s.zipCity].filter(Boolean).join(', ');
    const idLine = [s.nip ? 'NIP ' + s.nip : '', s.pesel ? 'PESEL ' + s.pesel : ''].filter(Boolean).join(' · ');
    const colCount = 3 + usedRates.length + 1;

    function buildRows(list){
      let lp = 1;
      let rowsHtml = '';
      const totals = {}; usedRates.forEach(r => totals[r]=0);
      let grand = 0;
      list.forEach(({row}) => {
        rowsHtml += `<tr><td>${lp++}</td><td>${esc(row.date)}</td><td>${esc(row.number)}</td>` +
          usedRates.map(r => `<td class="num">${row.rate===r ? fmt(row.basis) : ''}</td>`).join('') +
          `<td class="num razem">${fmt(row.basis)}</td></tr>`;
        totals[row.rate] = (totals[row.rate]||0) + row.basis;
        grand += row.basis;
      });
      return { rowsHtml, totals, grand };
    }

    let bodyHtml = '';
    const grandTotals = {}; usedRates.forEach(r=>grandTotals[r]=0);
    let grandTotal = 0;

    if(groupByMonth){
      const byMonth = {};
      entries.forEach(e => { (byMonth[e.periodKey] = byMonth[e.periodKey]||[]).push(e); });
      Object.keys(byMonth).sort().forEach(mk => {
        const list = byMonth[mk].slice().sort((a,b)=> (a.row.date||'').localeCompare(b.row.date||''));
        const { rowsHtml, totals, grand } = buildRows(list);
        bodyHtml += `<tr class="month-row"><td colspan="${colCount}">${esc(monthLabel(mk))}</td></tr>` + rowsHtml;
        bodyHtml += `<tr class="subtotal-row"><td colspan="3">Итого за ${esc(monthLabel(mk))}</td>` +
          usedRates.map(r => `<td class="num">${fmt(totals[r]||0)}</td>`).join('') +
          `<td class="num">${fmt(grand)}</td></tr>`;
        usedRates.forEach(r => grandTotals[r] += totals[r]||0);
        grandTotal += grand;
      });
    } else {
      const list = entries.slice().sort((a,b)=> (a.row.date||'').localeCompare(b.row.date||''));
      const built = buildRows(list);
      bodyHtml = built.rowsHtml;
      usedRates.forEach(r => grandTotals[r] = built.totals[r]||0);
      grandTotal = built.grand;
    }

    const totalRow = `<tr class="total-row"><td colspan="3">RAZEM / ИТОГО</td>` +
      usedRates.map(r => `<td class="num">${fmt(grandTotals[r]||0)}</td>`).join('') +
      `<td class="num">${fmt(grandTotal)}</td></tr>`;

    return `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><title>Ewidencja przychodów — ${esc(periodLabel)}</title>
<style>
  *{box-sizing:border-box;}
  body{font-family: Arial, Helvetica, sans-serif; color:#111; margin:28px; font-size:12px;}
  h1{font-size:16px; margin:0 0 4px;}
  .sub{color:#444; font-size:11px; margin:0 0 2px;}
  .meta{margin: 14px 0 18px; font-size:11.5px; color:#222;}
  table{width:100%; border-collapse: collapse; margin-top:10px;}
  th, td{border:1px solid #888; padding:4px 6px; font-size:11px;}
  th{background:#eee; text-align:center; font-weight:700;}
  td.num{text-align:right; font-variant-numeric: tabular-nums;}
  tr.month-row td{background:#f3f3f3; font-weight:700;}
  tr.subtotal-row td{font-weight:700; background:#fafafa;}
  tr.total-row td{font-weight:800; background:#e4e4e4; border-top:2px solid #333;}
  .footer-note{margin-top:22px; font-size:10px; color:#555;}
  @media print{ body{margin:12mm;} }
</style></head><body>
<h1>Ewidencja przychodów (ryczałt od przychodów ewidencjonowanych)</h1>
<p class="sub">${esc(s.name||'—')}${idLine ? ' · '+esc(idLine) : ''}${addr ? ' · '+esc(addr) : ''}</p>
<div class="meta">Okres: <strong>${esc(periodLabel)}</strong> &nbsp;·&nbsp; Wygenerowano: ${esc(formatDateRu(new Date()))}</div>
<table>
  <thead><tr><th>Lp.</th><th>Data</th><th>Nr dowodu</th>${usedRates.map(r=>`<th>Stawka ${r}%</th>`).join('')}<th>Razem</th></tr></thead>
  <tbody>${bodyHtml}${totalRow}</tbody>
</table>
<p class="footer-note">Wygenerowano automatycznie na podstawie zapisanych faktur. Ewidencja pomocnicza — nie zastępuje weryfikacji księgowej.</p>
</body></html>`;
  }

  function openPrintDoc(html){
    const w = window.open('', '_blank');
    if(!w){ alert('Разрешите всплывающие окна для этого сайта, чтобы напечатать документ.'); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 350);
  }

  document.getElementById('printEvidencjaMonthBtn').addEventListener('click', () => {
    const key = state.activePeriod;
    if(!key || !state.periods[key] || !state.periods[key].rows.length){ alert('Нет счетов за этот месяц.'); return; }
    const entries = state.periods[key].rows.map(row => ({row, periodKey:key}));
    openPrintDoc(buildEvidencjaDoc(entries, monthLabel(key), false));
  });

  document.getElementById('printEvidencjaYearBtn').addEventListener('click', () => {
    if(!state.activePeriod){ alert('Год не выбран.'); return; }
    const year = state.activePeriod.slice(0,4);
    const keys = Object.keys(state.periods).filter(k => k.slice(0,4) === year).sort();
    const entries = [];
    keys.forEach(k => state.periods[k].rows.forEach(row => entries.push({row, periodKey:k})));
    if(!entries.length){ alert('Нет счетов за этот год.'); return; }
    openPrintDoc(buildEvidencjaDoc(entries, year+' год', true));
  });

  document.getElementById('exportJsonBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'uchet-ip-kopiya.json';
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
      }catch(err){ parseErrorsEl.textContent = 'Не удалось загрузить копию JSON: ' + err.message; }
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  });

  document.getElementById('clearBtn').addEventListener('click', () => {
    if(confirm('Удалить ВСЕ данные (профиль, все месяцы, настройки)? Это действие нельзя отменить.')){
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
    renderZusReminder();

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
    uiYear = parseInt(state.activePeriod.slice(0,4), 10);

    syncZusFieldsFromPeriod();
    saveState();
    renderYearMonthSwitcher();
    updateSummary();
    renderYearSummary();
    renderInvoiceList();
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
