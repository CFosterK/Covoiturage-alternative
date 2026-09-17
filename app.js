'use strict';

const APP_VERSION = 44;
const STORAGE_KEY = 'covoiturageData';
const MAX_BACKUP_SIZE = 20_000_000;
const MAX_PEOPLE = 30;
const BACKUP_REMINDER_DAYS = 30;
const DEFAULT_DATA = Object.freeze({
  settings:{distance:85,consumption:6,energyPrice:2.31,energyType:'fuel',toll:6,vehicleCostPerKm:0.10,theme:'system'},
  people:['Passager 1'],
  archivedPeople:[],
  lastBackupAt:null,
  trips:[],
  payments:[]
});

const cloneDefaults = () => JSON.parse(JSON.stringify(DEFAULT_DATA));
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const isNumeric = value => (typeof value==='number' || (typeof value==='string' && value.trim()!=='')) && Number.isFinite(Number(value));
const finite = (value, fallback=0) => isNumeric(value) ? Number(value) : fallback;
const clamp = (value, min, max, fallback=min) => Math.min(max, Math.max(min, finite(value, fallback)));
const localISO = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const getToday = () => localISO(new Date());
const makeId = () => `${Date.now().toString(36)}${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
const safeId = value => /^[A-Za-z0-9_-]{1,80}$/.test(String(value||'')) ? String(value) : makeId();
const isRecord = value => value!==null && typeof value==='object' && !Array.isArray(value);
const optionalNumber = (value,max) => isNumeric(value) ? clamp(value,0,max,0) : null;
const personIndex = value => isNumeric(value) && Number.isInteger(Number(value)) ? Number(value) : -1;
function uniqueId(value,seen){
  let id=safeId(value);
  while(seen.has(id)) id=makeId();
  seen.add(id);
  return id;
}
const safeDate = (value, fallback=getToday()) => {
  const s=String(value||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)) return fallback;
  const [y,m,d]=s.split('-').map(Number), date=new Date(y,m-1,d,12);
  return date.getFullYear()===y && date.getMonth()===m-1 && date.getDate()===d ? s : fallback;
};
const safeIsoDateTime = value => {
  if(typeof value!=='string' || value.length>60) return null;
  const d=new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const cleanName = (value, fallback) => {
  const text=String(value??'').replace(/[\u0000-\u001F\u007F]/g,' ').replace(/\s+/g,' ').trim().slice(0,40);
  return text || fallback;
};
const escapeHTML = value => String(value).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
const euro = n => `${Math.round(finite(n,0))} €`;
const decimal = (n,digits=1) => finite(n,0).toLocaleString('fr-FR',{minimumFractionDigits:0,maximumFractionDigits:digits});

const UI_ICONS = Object.freeze({
  edit:'<span class="btn-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="m16 3 5 5M21 8 8 21H3v-5L16 3a3.54 3.54 0 0 1 5 5Z"/></svg></span>',
  payment:'<span class="btn-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M12 5v14M5 12h14"/></svg></span>',
  archive:'<span class="btn-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><rect x="3" y="3" width="18" height="4" rx="1"/><path d="M5 7v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7M10 12h4"/></svg></span>',
  restore:'<span class="btn-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5M12 7v5l4 2"/></svg></span>',
  trash:'<span class="btn-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M3 6h18M19 6v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M10 10v7M14 10v7"/></svg></span>'
});

function normalizeData(raw){
  const base=cloneDefaults();
  if(!raw || typeof raw!=='object' || Array.isArray(raw)) return base;
  const s=isRecord(raw.settings) ? raw.settings : {};
  const legacyEnergyPrice=s.energyPrice ?? s.diesel;
  const distance=clamp(s.distance,0,2000,85);
  const legacyVehicleCostPerKm = isNumeric(s.vehicleCostPerKm)
    ? Number(s.vehicleCostPerKm)
    : (distance>0 && isNumeric(s.carFee) ? Number(s.carFee)/distance : 0.10);
  base.settings={
    distance,
    consumption:clamp(s.consumption,0,100,6),
    energyPrice:clamp(legacyEnergyPrice,0,20,2.31),
    energyType:['fuel','electric'].includes(s.energyType)?s.energyType:'fuel',
    toll:clamp(s.toll,0,1000,6),
    vehicleCostPerKm:clamp(legacyVehicleCostPerKm,0,10,0.10),
    theme:['system','light','dark'].includes(s.theme)?s.theme:'system'
  };

  const incomingPeople=Array.isArray(raw.people)?raw.people:[];
  if(incomingPeople.length){
    base.people=incomingPeople.map((name,i)=>cleanName(name,`Passager ${i+1}`));
  }
  if(!base.people.length) base.people=['Passager 1'];
  const maxIndex=base.people.length-1;
  base.archivedPeople=[...new Set((Array.isArray(raw.archivedPeople)?raw.archivedPeople:[]).map(personIndex).filter(i=>i>=0&&i<=maxIndex))];
  base.lastBackupAt=safeIsoDateTime(raw.lastBackupAt);

  const tripIds=new Set(), paymentIds=new Set();
  const trips=Array.isArray(raw.trips)?raw.trips:[];
  base.trips=trips.filter(isRecord).map(t=>({
    id:uniqueId(t.id,tripIds),
    date:safeDate(t.date),
    people:[...new Set(Array.isArray(t.people)?t.people.map(personIndex).filter(i=>i>=0&&i<=maxIndex):[])],
    noTrip:t.noTrip===true,
    rate:clamp(t.rate,0,61000,0),
    cost:clamp(t.cost,0,61000,0),
    createdAt:safeIsoDateTime(t.createdAt)||new Date().toISOString(),
    distance:optionalNumber(t.distance,2000),
    consumption:optionalNumber(t.consumption,100),
    energyType:['fuel','electric'].includes(t.energyType)?t.energyType:null,
    energyPrice:optionalNumber(t.energyPrice,20),
    energyUsed:optionalNumber(t.energyUsed,10000),
    vehicleCostPerKm:optionalNumber(t.vehicleCostPerKm,10),
    toll:optionalNumber(t.toll,1000)
  }));

  const payments=Array.isArray(raw.payments)?raw.payments:[];
  base.payments=payments.filter(isRecord).map(p=>({
    id:uniqueId(p.id,paymentIds),
    person:personIndex(p.person),
    amount:clamp(p.amount,0,1_000_000,0),
    date:safeDate(p.date)
  })).filter(p=>Number.isInteger(p.person)&&p.person>=0&&p.person<=maxIndex&&p.amount>0);
  return base;
}

// Missing historical fields are migrated; changed or discarded values are reported.
function normalizationWarnings(raw,next){
  const warnings=[];
  const changed=(source,target,keys) => keys.some(key=>Object.prototype.hasOwnProperty.call(source,key) && (
    typeof target[key]==='number' ? !['number','string'].includes(typeof source[key]) || String(source[key]).trim()==='' || Number(source[key])!==target[key]
      : JSON.stringify(source[key])!==JSON.stringify(target[key])
  ));
  const numericSettings=['distance','consumption','energyPrice','toll','vehicleCostPerKm'];
  const settings={...raw.settings};
  if(settings.energyPrice==null && settings.diesel!=null) settings.energyPrice=settings.diesel;
  if(settings.vehicleCostPerKm==null && settings.carFee!=null && next.settings.distance>0) settings.vehicleCostPerKm=Number(settings.carFee)/next.settings.distance;
  if(changed(settings,next.settings,[...numericSettings,'energyType','theme'])) warnings.push('Certains réglages invalides seront corrigés.');
  if(JSON.stringify(raw.people)!==JSON.stringify(next.people)) warnings.push('Certains noms de passagers seront nettoyés ou complétés.');
  if(raw.archivedPeople!==undefined && JSON.stringify(raw.archivedPeople)!==JSON.stringify(next.archivedPeople)) warnings.push('La liste des passagers archivés sera corrigée.');
  const sourceTrips=raw.trips.filter(isRecord);
  if(sourceTrips.length!==raw.trips.length) warnings.push(`${raw.trips.length-sourceTrips.length} trajet(s) invalide(s) seront écartés.`);
  const tripKeys=['id','date','people','noTrip','rate','cost','createdAt','distance','consumption','energyType','energyPrice','energyUsed','vehicleCostPerKm','toll'];
  const corrected=sourceTrips.filter((t,i)=>changed(t,next.trips[i],tripKeys) || !t.date || !Array.isArray(t.people) || (!t.noTrip && (t.rate==null || t.cost==null))).length;
  if(corrected) warnings.push(`${corrected} trajet(s) contiennent des valeurs qui seront corrigées.`);
  const sourcePayments=Array.isArray(raw.payments)?raw.payments:[];
  if(raw.payments!==undefined && !Array.isArray(raw.payments)) warnings.push('La liste des versements est invalide et sera écartée.');
  const validPayments=sourcePayments.filter(p=>isRecord(p) && personIndex(p.person)>=0 && personIndex(p.person)<next.people.length && clamp(p.amount,0,1_000_000,0)>0);
  if(validPayments.length!==sourcePayments.length) warnings.push(`${sourcePayments.length-validPayments.length} versement(s) invalide(s) seront écartés.`);
  const correctedPayments=validPayments.filter((p,i)=>changed(p,next.payments[i],['id','person','amount','date']) || !p.date).length;
  if(correctedPayments) warnings.push(`${correctedPayments} versement(s) contiennent des valeurs qui seront corrigées.`);
  if(raw.lastBackupAt!=null && !safeIsoDateTime(raw.lastBackupAt)) warnings.push('La date de sauvegarde invalide sera effacée.');
  return warnings;
}

function validDataShape(value){
  return isRecord(value) && isRecord(value.settings) && Array.isArray(value.people) && Array.isArray(value.trips);
}

let data=cloneDefaults(), storedRaw=null, storageProblem='';
try{
  storedRaw=localStorage.getItem(STORAGE_KEY);
  if(storedRaw!==null){
    const raw=JSON.parse(storedRaw);
    if(!validDataShape(raw)) throw new Error('format');
    data=normalizeData(raw);
    const warnings=normalizationWarnings(raw,data);
    if(warnings.length) storageProblem='Des données locales nécessitent une vérification. '+warnings.join(' ');
  }
}catch{ storageProblem='Les données locales ne peuvent pas être lues correctement.'; }
let savedData=JSON.stringify(data);

function saveData({allowRecovery=false}={}){
  try{
    if(storageProblem && !allowRecovery) throw new Error('protected');
    if(localStorage.getItem(STORAGE_KEY)!==storedRaw) throw new Error('conflict');
    const serialized=JSON.stringify(data);
    localStorage.setItem(STORAGE_KEY,serialized);
    savedData=serialized;
    storedRaw=serialized;
    storageProblem='';
    return true;
  }catch(error){
    data=JSON.parse(savedData);
    applyTheme();
    renderAll();
    const message=error.message==='protected'
      ? 'Les données originales sont protégées. Dans Réglages, sauvegardez leur copie puis restaurez une sauvegarde pour les vérifier.'
      : error.message==='conflict'
        ? 'Les données locales ont changé dans une autre fenêtre. Fermez puis rouvrez cette fenêtre avant de réessayer.'
        : 'Impossible d’enregistrer sur cet appareil (stockage plein ou indisponible). La modification a été annulée ; les données précédentes sont conservées.';
    alert(message);
    return false;
  }
}

function flash(message){
  const el=$('#status');
  el.textContent=message;
  clearTimeout(flash.timer);
  flash.timer=setTimeout(()=>{el.textContent='';},2200);
}

const personName = index => data.people[index] || `Passager ${Number(index)+1}`;
const isArchived = index => data.archivedPeople.includes(index);
const activePeopleIndices = () => data.people.map((_,i)=>i).filter(i=>!isArchived(i));
const vehicleCostPerTrip = () => data.settings.distance*data.settings.vehicleCostPerKm;
const tripCost = () => data.settings.distance*data.settings.consumption/100*data.settings.energyPrice+data.settings.toll+vehicleCostPerTrip();
const rate = n => n ? Math.round(tripCost()/(n+1)) : 0;

// Editing is temporary UI state; stored records keep the V37/V38 format.
let editingTripId=null, newTripDraft=null;
const editingTrip=()=>data.trips.find(t=>t.id===editingTripId);
const selectedPassengers=()=>$$('[data-person]:checked').map(el=>Number(el.dataset.person));

function renderPeople(selected=[]){
  const original=editingTrip();
  const active=[...new Set([...activePeopleIndices(),...(original?.people||[])])];
  $('#people').innerHTML=active.length
    ? active.map(i=>`<label class="person"><input type="checkbox" data-person="${i}"${selected.includes(i)?' checked':''}${original?.noTrip?' disabled':''}><span>${escapeHTML(personName(i))}${isArchived(i)?'<small class="archive-tag">archivé</small>':''}</span></label>`).join('')
    : '<p class="small">Aucun passager actif. Vous pouvez en ajouter ou en réactiver dans Réglages.</p>';
  $$('[data-person]').forEach(el=>el.addEventListener('change',event=>{
    if(event.target.checked && $$('[data-person]:checked').length>3){
      event.target.checked=false;
      alert('Maximum 3 passagers par trajet.');
    }
    calcToday();
  }));
  calcToday();
}

function shouldRecalculateTrip(original){
  if(!original || original.noTrip) return false;
  const people=selectedPassengers();
  return $('#tripDate').value!==original.date || people.length!==original.people.length || people.some(i=>!original.people.includes(i));
}

function calcToday(){
  const n=selectedPassengers().length, original=editingTrip();
  const preserve=original && !shouldRecalculateTrip(original);
  const perPerson=preserve?original.rate:rate(n), cost=preserve?original.cost:tripCost();
  $('#count').textContent=n;
  $('#perPerson').textContent=euro(perPerson);
  $('#received').textContent=euro(original?.noTrip?0:perPerson*n);
  $('#tripCost').textContent=euro(cost);
}

function renderTripMode(){
  const original=editingTrip();
  $('#tripTitle').textContent=original?'Modifier le trajet':'Trajet';
  $('#saveTripLabel').textContent=original?'Enregistrer les modifications':'Enregistrer le trajet';
  $('#cancelEdit').classList.toggle('hidden',!original);
  $('#editNotice').classList.toggle('hidden',!original);
  if(original) $('#editNotice').textContent=original.noTrip
    ? 'Ancien enregistrement « Aucun trajet » : seule la date sera modifiée.'
    : 'Si vous changez la date ou les passagers, ce trajet sera recalculé avec les réglages actuels. Les autres trajets restent inchangés.';
}

function startEditTrip(id){
  const original=data.trips.find(t=>t.id===id);
  if(!original) return;
  newTripDraft={date:$('#tripDate').value,people:selectedPassengers()};
  editingTripId=id;
  $('#tripDate').value=original.date;
  renderTripMode();renderPeople(original.people);selectTab('today');
}

function finishEditing(){
  const draft=newTripDraft;
  editingTripId=null;newTripDraft=null;
  $('#tripDate').value=draft?.date||getToday();
  renderTripMode();renderPeople((draft?.people||[]).filter(i=>!isArchived(i)));
}

function saveEditedTrip(){
  const index=data.trips.findIndex(t=>t.id===editingTripId), original=data.trips[index];
  if(!original){alert('Ce trajet n’existe plus.');finishEditing();renderHistory();return;}
  const date=safeDate($('#tripDate').value,null);
  if(!date){alert('Choisissez une date valide.');$('#tripDate').focus();return;}
  const people=original.noTrip?original.people:selectedPassengers();
  const samePeople=people.length===original.people.length && people.every(i=>original.people.includes(i));
  if(people.length>3 && !samePeople){alert('Maximum 3 passagers par trajet.');return;}
  const updated={...original,date,people};
  if(shouldRecalculateTrip(original)){
    const {distance,consumption,energyType,energyPrice,vehicleCostPerKm,toll}=data.settings;
    Object.assign(updated,{rate:rate(people.length),cost:tripCost(),distance,consumption,energyType,energyPrice,energyUsed:distance*consumption/100,vehicleCostPerKm,toll});
  }
  data.trips[index]=updated;
  if(saveData()){
    const draft=newTripDraft;
    finishEditing();renderAll();
    renderPeople((draft?.people||[]).filter(i=>!isArchived(i)));
    selectTab('history');flash('Trajet modifié ✓');
  }
}

function addTrip(){
  if(editingTripId){saveEditedTrip();return;}
  const people=selectedPassengers();
  if(people.length>3){alert('Maximum 3 passagers par trajet.');return;}
  const selectedDate=safeDate($('#tripDate').value,null);
  if(!selectedDate){alert('Choisissez une date valide.');$('#tripDate').focus();return;}
  const distance=data.settings.distance, consumption=data.settings.consumption;
  data.trips.push({
    id:makeId(),date:selectedDate,people,noTrip:false,rate:rate(people.length),cost:tripCost(),createdAt:new Date().toISOString(),
    distance,consumption,energyType:data.settings.energyType,energyPrice:data.settings.energyPrice,
    energyUsed:distance*consumption/100,vehicleCostPerKm:data.settings.vehicleCostPerKm,toll:data.settings.toll
  });
  if(saveData()){ renderAll(); flash('Nouveau trajet enregistré ✓'); }
}

function renderHistory(){
  const select=$('#historyPerson'), previous=select.value||'all';
  select.innerHTML='<option value="all">Tous les passagers</option>'+data.people.map((name,i)=>`<option value="${i}">${escapeHTML(name)}${isArchived(i)?' (archivé)':''}</option>`).join('');
  select.value=previous==='all'||data.people[Number(previous)]!==undefined?previous:'all';
  const expanded=new Set($$('#historyList details[open]').map(el=>el.dataset.id));
  const trips=[...data.trips].filter(t=>select.value==='all'||t.people.includes(Number(select.value))).sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));
  const groups=new Map();
  trips.forEach(t=>{const month=t.date.slice(0,7);if(!groups.has(month))groups.set(month,[]);groups.get(month).push(t);});
  $('#historyList').innerHTML=trips.length?[...groups].map(([month,items])=>{
    const monthLabel=new Date(`${month}-01T12:00:00`).toLocaleDateString('fr-FR',{month:'long',year:'numeric'});
    return `<section class="history-month"><h2 class="month-title">${escapeHTML(monthLabel)}</h2>${items.map(t=>{
      const names=t.noTrip?'Aucun trajet':t.people.length?t.people.map(personName).join(', '):'Sans passager';
      const dateLabel=new Date(`${t.date}T12:00:00`).toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
      const energy=t.energyType==='electric'?'kWh':'L';
      const snapshot=t.noTrip?'Ancien enregistrement sans trajet.':[
        `${t.people.length} passager(s) · ${euro(t.rate)} par passager`,
        `Coût enregistré : ${euro(t.cost)}`,
        t.distance===null?null:`Distance : ${decimal(t.distance)} km`,
        t.energyUsed===null||!t.energyType?null:`Énergie : ${decimal(t.energyUsed,2)} ${energy}`
      ].filter(Boolean).map(escapeHTML).join('<br>');
      return `<details class="history-item" data-id="${t.id}"${expanded.has(t.id)?' open':''}><summary><span class="history-overview"><b>${escapeHTML(dateLabel)}</b><span class="history-names">${escapeHTML(names)}</span>${t.noTrip?'':`<span class="small">Participation prévue : <strong>${euro(t.rate*t.people.length)}</strong></span>`}</span><span class="history-chevron" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="m6 9 6 6 6-6"/></svg></span></summary><div class="history-detail"><p class="small">${snapshot}</p><div class="history-actions"><button class="btn secondary compact has-icon edit-trip" type="button" data-id="${t.id}">${UI_ICONS.edit}<span class="btn-label">${t.noTrip?'Modifier la date':'Modifier'}</span></button><button class="btn danger compact has-icon delete-trip" type="button" data-id="${t.id}">${UI_ICONS.trash}<span class="btn-label">Supprimer</span></button></div></div></details>`;
    }).join('')}</section>`;
  }).join(''):`<p class="small">${data.trips.length?'Aucun trajet pour ce passager.':'Aucun trajet enregistré.'}</p>`;
}

function filteredTrips(){
  const now=new Date(), mode=$('#period').value;
  return data.trips.filter(t=>{
    const d=new Date(`${t.date}T12:00:00`);
    if(mode==='all') return true;
    if(mode==='month') return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();
    const start=new Date(now); start.setHours(0,0,0,0); start.setDate(now.getDate()-((now.getDay()+6)%7));
    const end=new Date(start); end.setDate(start.getDate()+7);
    return d>=start&&d<end;
  });
}

function filteredPayments(){
  const now=new Date(), mode=$('#period').value;
  return data.payments.filter(p=>{
    const d=new Date(`${p.date}T12:00:00`);
    if(mode==='all') return true;
    if(mode==='month') return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();
    const start=new Date(now); start.setHours(0,0,0,0); start.setDate(now.getDate()-((now.getDay()+6)%7));
    const end=new Date(start); end.setDate(start.getDate()+7);
    return d>=start&&d<end;
  });
}

let paymentDisplayLimit=8;
function renderPayments(){
  $('#payPerson').innerHTML=data.people.map((name,i)=>`<option value="${i}">${escapeHTML(name)}${isArchived(i)?' (archivé)':''}</option>`).join('');
  if(!$('#payDate').value) $('#payDate').value=getToday();
  const payments=[...data.payments].sort((a,b)=>b.date.localeCompare(a.date));
  $('#paymentHistory').innerHTML=payments.length?`<div class="small payment-caption">Versements · ${Math.min(paymentDisplayLimit,payments.length)} sur ${payments.length} (toutes périodes)</div>${payments.slice(0,paymentDisplayLimit).map(p=>`<div class="payment-item"><span>${escapeHTML(personName(p.person))}${isArchived(p.person)?'<span class="archive-tag">archivé</span>':''}<br><span class="small">${escapeHTML(new Date(`${p.date}T12:00:00`).toLocaleDateString('fr-FR'))}</span></span><span class="payment-value"><b>${euro(p.amount)}</b><button class="btn danger compact has-icon delete-payment" type="button" aria-label="Supprimer ce versement" data-id="${p.id}">${UI_ICONS.trash}<span class="btn-label">Supprimer</span></button></span></div>`).join('')}${payments.length>paymentDisplayLimit?'<button type="button" class="btn secondary" id="morePayments">Afficher les versements suivants</button>':''}`:'<p class="small">Aucun versement enregistré.</p>';
}

function renderSummary(){
  $('#summaryScope').textContent=$('#period').value==='all'
    ? 'Solde calculé sur tous les trajets et versements enregistrés.'
    : 'Solde de la période uniquement, sans report antérieur. Choisissez « Tout » pour connaître le solde global.';
  const trips=filteredTrips().filter(t=>!t.noTrip);
  const payments=filteredPayments();
  const paidTotal=payments.reduce((sum,p)=>sum+p.amount,0);
  const totalCost=trips.reduce((sum,t)=>sum+t.cost,0);
  $('#sTrips').textContent=trips.length;
  $('#sReceived').textContent=euro(paidTotal);
  $('#sCost').textContent=euro(totalCost);
  $('#sDriver').textContent=euro(totalCost-paidTotal);
  const relevantPeople=data.people.map((_,i)=>i).filter(i=>!isArchived(i)||trips.some(t=>t.people.includes(i))||payments.some(p=>p.person===i));
  $('#personSummary').innerHTML=relevantPeople.map(i=>{
    const personTrips=trips.filter(t=>t.people.includes(i));
    const due=personTrips.reduce((sum,t)=>sum+t.rate,0);
    const paid=payments.filter(p=>p.person===i).reduce((sum,p)=>sum+p.amount,0);
    const balance=due-paid;
    const state=balance>0?`${euro(balance)} à payer`:balance<0?`Crédit ${euro(Math.abs(balance))}`:'Soldé ✓';
    const cls=balance>0?'balance-positive':balance<0?'balance-credit':'balance-zero';
    return `<div class="summary-entry"><div class="summaryPerson"><span><strong class="summary-person-name">${escapeHTML(personName(i))}</strong>${isArchived(i)?'<span class="archive-tag">archivé</span>':''}<br><span class="small">${personTrips.length} trajet(s) · dû ${euro(due)} · versé ${euro(paid)}</span></span><span class="${cls}">${state}</span></div><button class="btn secondary compact has-icon quick-payment" type="button" data-person-index="${i}" aria-label="Enregistrer un versement pour ${escapeHTML(personName(i))}">${UI_ICONS.payment}<span class="btn-label">Enregistrer un versement</span></button></div>`;
  }).join('');
}

let cancelPaymentScroll=()=>{};
function preparePayment(index){
  if(!Number.isInteger(index)||index<0||index>=data.people.length) return;
  cancelPaymentScroll();
  $('#payPerson').value=String(index);$('#payAmount').value='';$('#payDate').value=getToday();
  const waitForKeyboard=document.body.classList.contains('keyboard-editing');
  document.activeElement?.blur();
  const viewport=window.visualViewport;
  let timer;
  const cancel=()=>{
    clearTimeout(timer);
    viewport?.removeEventListener('resize',schedule);
    document.removeEventListener('pointerdown',cancel);
    document.removeEventListener('focusin',cancel);
  };
  const reveal=()=>{
    cancel();
    if(document.body.dataset.view==='summary') $('#payAmount').scrollIntoView({block:'center',behavior:'auto'});
  };
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(reveal,300);};
  cancelPaymentScroll=cancel;
  if(waitForKeyboard){
    // Wait until the previous keyboard stops resizing; never open it here.
    viewport?.addEventListener('resize',schedule);
    document.addEventListener('pointerdown',cancel);
    document.addEventListener('focusin',cancel);
    schedule();
  }else reveal();
}

function installKeyboardNavigation(){
  const viewport=window.visualViewport;
  const touch=matchMedia('(any-pointer: coarse)');
  let fullHeight=Math.max(window.innerHeight,viewport?.height||0);
  let keyboardReduced=false;
  const editable=()=>{
    const field=document.activeElement;
    return field?.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="button"]):not([type="submit"]), textarea, select') && !field.readOnly && !field.disabled ? field : null;
  };
  function showNavigation(){
    document.body.classList.remove('keyboard-editing');
    keyboardReduced=false;
  }
  function focusChanged(){
    if(!touch.matches || !editable()){showNavigation();return;}
    // Hide immediately, before Safari finishes opening the keyboard.
    fullHeight=Math.max(fullHeight,window.innerHeight,viewport?.height||0);
    document.body.classList.add('keyboard-editing');
  }
  function viewportChanged(){
    const field=editable();
    if(!touch.matches || !field){
      showNavigation();
      fullHeight=Math.max(window.innerHeight,viewport?.height||0);
      return;
    }
    if(!viewport || Math.abs(viewport.scale-1)>.05) return;
    const reduced=fullHeight-viewport.height>120;
    if(reduced){
      keyboardReduced=true;
      document.body.classList.add('keyboard-editing');
      // Safari manages the focused field. Do not scroll during keyboard animation.
    }else if(keyboardReduced){
      // iOS can dismiss the keyboard while leaving the input focused.
      showNavigation();
    }
  }
  document.addEventListener('focusin',focusChanged);
  document.addEventListener('focusout',()=>setTimeout(()=>{
    if(!editable()) showNavigation();
  },0));
  viewport?.addEventListener('resize',viewportChanged);
  window.addEventListener('resize',viewportChanged);
}

function applyTheme(){
  const mode=data.settings.theme||'system';
  const dark=mode==='dark'||(mode==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme=dark?'dark':'light';
  $('meta[name="theme-color"]').setAttribute('content',dark?'#0b1017':'#e9eef6');
}

function updateEnergyLabels(){
  const electric=$('#energyType').value==='electric';
  $('#consumptionLabel').textContent=electric?'Consommation (kWh/100 km)':'Consommation (L/100 km)';
  $('#energyPriceLabel').textContent=electric?'Prix énergie / carburant (€/kWh)':'Prix énergie / carburant (€/L)';
  $('#energyHelp').textContent=electric?'Le calcul utilise la consommation en kWh/100 km et le prix de l’électricité en €/kWh.':'Le calcul utilise la consommation en L/100 km et le prix du carburant en €/L.';
}

function updateVehicleCostHelp(){
  const distance=finite($('#distance').value,data.settings.distance);
  const perKm=finite($('#vehicleCostPerKm').value,data.settings.vehicleCostPerKm);
  const perTrip=Math.max(0,distance)*Math.max(0,perKm);
  const amount=perTrip.toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2});
  $('#vehicleCostHelp').textContent=`Soit ${amount} € pour ${Math.max(0,distance).toLocaleString('fr-FR')} km. Ce coût couvre notamment l’usure, l’entretien et la décote du véhicule.`;
}

function renderPeopleSettings(){
  const active=activePeopleIndices();
  $('#activePeopleSettings').innerHTML=active.length?active.map((i,position)=>`<div class="person-setting-row"><div class="field"><label for="personName${i}">Passager ${position+1}</label><input id="personName${i}" data-person-name="${i}" maxlength="40" autocomplete="off" value="${escapeHTML(personName(i))}"></div><button class="btn secondary compact has-icon archive-person" type="button" data-person-index="${i}">${UI_ICONS.archive}<span class="btn-label">Archiver</span></button></div>`).join(''):'<p class="small">Aucun passager actif.</p>';
  const archived=data.archivedPeople.filter(i=>i>=0&&i<data.people.length);
  $('#archivedPeopleSection').classList.toggle('hidden',archived.length===0);
  $('#archivedCount').textContent=`(${archived.length})`;
  $('#archivedPeopleSettings').innerHTML=archived.map(i=>`<div class="archived-person"><span class="archived-label">${escapeHTML(personName(i))}</span><div class="archived-person-actions"><button class="btn secondary compact has-icon reactivate-person" type="button" data-person-index="${i}">${UI_ICONS.restore}<span class="btn-label">Réactiver</span></button><button class="btn danger compact has-icon delete-person" type="button" data-person-index="${i}">${UI_ICONS.trash}<span class="btn-label">Supprimer</span></button></div></div>`).join('');
}

function renderBackupStatus(){
  const el=$('#backupStatus');
  el.classList.remove('warning');
  if(storageProblem){
    el.textContent=storageProblem+' Les originaux restent protégés. Le bouton de sauvegarde exporte leur copie originale ; restaurez ensuite une sauvegarde vérifiée pour reprendre les modifications.';
    el.classList.add('warning');
    return;
  }
  if(!data.lastBackupAt){
    el.textContent='Aucune sauvegarde enregistrée. Une sauvegarde régulière est recommandée.';
    el.classList.add('warning');
    return;
  }
  const date=new Date(data.lastBackupAt), age=Math.max(0,Math.floor((Date.now()-date.getTime())/86400000));
  const label=date.toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'});
  el.textContent=age>BACKUP_REMINDER_DAYS?`Dernière sauvegarde : ${label} (${age} jours). Pensez à en créer une nouvelle.`:`Dernière sauvegarde : ${label}${age===0?' (aujourd’hui)':` · il y a ${age} jour${age>1?'s':''}`}.`;
  if(age>BACKUP_REMINDER_DAYS) el.classList.add('warning');
}

function renderSettings(){
  $('#themeMode').value=data.settings.theme||'system';
  $('#energyType').value=data.settings.energyType||'fuel';
  for(const key of ['distance','consumption','energyPrice','toll','vehicleCostPerKm']) $(`#${key}`).value=data.settings[key];
  updateEnergyLabels();
  updateVehicleCostHelp();
  renderPeopleSettings();
  renderBackupStatus();
  $('#rates').innerHTML=[1,2,3].map(n=>`<div class="summaryPerson"><span>${n} passager${n>1?'s':''}</span><b>${euro(rate(n))} / passager</b></div>`).join('');
}

function renderAll(){
  if(!$('#tripDate').value) $('#tripDate').value=getToday();
  const original=editingTrip();
  if(original) $('#tripDate').value=original.date;
  renderTripMode();renderPeople(original?.people||[]);renderHistory();renderSettings();renderSummary();renderPayments();
}

function selectTab(tab){
  if(tab!=='today' && editingTripId){
    if(!confirm('Quitter la modification sans enregistrer ?')) return;
    finishEditing();
  }
  document.body.dataset.view=tab;
  $$('.tab').forEach(button=>{
    const active=button.dataset.tab===tab;
    button.classList.toggle('active',active);
    button.setAttribute('aria-selected',String(active));
  });
  ['today','history','summary','settings'].forEach(id=>$('#'+id).classList.toggle('hidden',id!==tab));
  if(tab==='summary') renderSummary();
  if(tab==='settings') renderSettings();
  window.scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
}

function saveSettings(){
  const limits={distance:[0,2000],consumption:[0,100],energyPrice:[0,20],toll:[0,1000],vehicleCostPerKm:[0,10]};
  const next={...data.settings};
  for(const [key,[min,max]] of Object.entries(limits)){
    const el=$(`#${key}`), value=Number(el.value);
    if(el.value.trim()===''||!Number.isFinite(value)||value<min||value>max){ alert(`Merci de saisir une valeur valide pour ${key}.`); el.focus(); return; }
    next[key]=value;
  }
  next.energyType=['fuel','electric'].includes($('#energyType').value)?$('#energyType').value:'fuel';
  data.settings=next;
  if(saveData()){renderSettings();calcToday();renderSummary();flash('Réglages enregistrés ✓');}
}

function savePeople(){
  $$('[data-person-name]').forEach(input=>{
    const i=Number(input.dataset.personName);
    if(Number.isInteger(i)&&i>=0&&i<data.people.length) data.people[i]=cleanName(input.value,personName(i));
  });
  if(saveData()){renderAll();flash('Noms enregistrés ✓');}
}

function addPerson(){
  if(data.people.length>=MAX_PEOPLE) return alert(`La limite est de ${MAX_PEOPLE} passagers enregistrés.`);
  const input=$('#newPersonName');
  const name=cleanName(input.value,`Passager ${data.people.length+1}`);
  data.people.push(name);
  if(saveData()){input.value='';renderAll();flash(`${name} ajouté ✓`);}
}

function archivePerson(index){
  if(!Number.isInteger(index)||index<0||index>=data.people.length||isArchived(index)) return;
  if(!confirm(`Archiver ${personName(index)} ? Son historique et ses versements seront conservés.`)) return;
  data.archivedPeople.push(index);
  data.archivedPeople=[...new Set(data.archivedPeople)];
  if(saveData()){renderAll();flash(`${personName(index)} archivé ✓`);}
}

function reactivatePerson(index){
  if(!Number.isInteger(index)||index<0||index>=data.people.length) return;
  data.archivedPeople=data.archivedPeople.filter(i=>i!==index);
  if(saveData()){renderAll();flash(`${personName(index)} réactivé ✓`);}
}

function deleteArchivedPerson(index){
  if(!Number.isInteger(index)||index<0||index>=data.people.length||!isArchived(index)) return;
  const name=personName(index);
  const usedInTrips=data.trips.some(t=>Array.isArray(t.people)&&t.people.includes(index));
  const usedInPayments=data.payments.some(p=>p.person===index);
  const warning=usedInTrips||usedInPayments ? ' Ses versements et sa participation aux trajets seront supprimés. Les trajets où cette personne était le seul passager seront supprimés ; les autres trajets et leurs coûts seront conservés.' : '';
  if(!confirm(`Supprimer définitivement ${name} ? Cette action est irréversible.${warning}`)) return;
  data.people.splice(index,1);
  data.archivedPeople=data.archivedPeople
    .filter(i=>i!==index)
    .map(i=>i>index?i-1:i);
  // Only remove trips whose sole passenger was the deleted person.
  data.trips=data.trips.filter(t=>!(t.people.length===1 && t.people[0]===index)).map(t=>({
    ...t,
    people:(Array.isArray(t.people)?t.people:[]).filter(i=>i!==index).map(i=>i>index?i-1:i)
  }));
  data.payments=data.payments.filter(p=>p.person!==index).map(p=>({
    ...p,
    person:p.person>index?p.person-1:p.person
  }));
  if(!data.people.length){ data.people=['Passager 1']; }
  if(saveData()){renderAll();flash(`${name} supprimé ✓`);}
}

function addPayment(){
  const person=Number($('#payPerson').value), amount=Number($('#payAmount').value), date=safeDate($('#payDate').value||getToday());
  if(!Number.isInteger(person)||person<0||person>=data.people.length) return alert('Passager invalide.');
  if(!Number.isFinite(amount)||amount<=0||amount>1_000_000) return alert('Merci de saisir un montant supérieur à 0 €.');
  data.payments.push({id:makeId(),person,amount,date});
  if(saveData()){ $('#payAmount').value=''; renderSummary(); renderPayments(); flash('Versement enregistré ✓'); }
}

function downloadBlob(blob,filename){
  const url=URL.createObjectURL(blob), link=document.createElement('a');
  link.href=url; link.download=filename; link.rel='noopener'; document.body.appendChild(link); link.click();
  setTimeout(()=>{URL.revokeObjectURL(url);link.remove();},600);
}

function markBackup(iso){
  data.lastBackupAt=iso;
  if(saveData()) renderBackupStatus();
}

async function backupData(){
  if(storageProblem){
    if(storedRaw===null){ alert('Le stockage est inaccessible. Rouvrez l’application ou restaurez une sauvegarde disponible.'); return; }
    downloadBlob(new Blob([storedRaw],{type:'application/json'}),`covoiturage-recuperation-${getToday()}.json`);
    flash('Copie originale proposée au téléchargement');
    return;
  }
  const backupAt=new Date().toISOString();
  const payloadData={...data,lastBackupAt:backupAt};
  const payload={app:'Covoiturage',version:APP_VERSION,exportedAt:backupAt,data:payloadData};
  const filename=`covoiturage-sauvegarde-${getToday()}.json`;
  const content=JSON.stringify(payload);
  const blob=new Blob([content],{type:'application/json'});
  if(blob.size>MAX_BACKUP_SIZE){ alert('La sauvegarde dépasse la limite de 20 Mo. Aucun fichier incompatible n’a été créé.'); return; }
  try{
    const file=new File([content],filename,{type:'application/json'});
    if(navigator.share&&navigator.canShare?.({files:[file]})){
      await navigator.share({files:[file],title:'Sauvegarde Covoiturage'});
      markBackup(backupAt); flash('Sauvegarde prête ✓'); return;
    }
  }catch(error){ if(error&&error.name==='AbortError') return; }
  downloadBlob(blob,filename);
  markBackup(backupAt);
  flash('Sauvegarde proposée : vérifiez son enregistrement');
}

async function restoreData(file){
  if(!file) return;
  if(file.size>MAX_BACKUP_SIZE) throw new Error('too-large');
  const parsed=JSON.parse(await file.text());
  const wrapped=isRecord(parsed) && Object.prototype.hasOwnProperty.call(parsed,'data');
  const restored=wrapped?parsed.data:parsed;
  if(!validDataShape(restored) || (wrapped && parsed.app!==undefined && parsed.app!=='Covoiturage')) throw new Error('format');
  if(wrapped && Number(parsed.version)>APP_VERSION) throw new Error('future-version');
  const next=normalizeData(restored), warnings=normalizationWarnings(restored,next);
  const report=warnings.length?'\n\nCorrections prévues :\n'+warnings.join('\n'):'';
  if(!confirm(`Restaurer cette sauvegarde (${next.trips.length} trajets, ${next.payments.length} versements) ? Les données actuelles seront remplacées.${report}`)) return;
  if(wrapped && parsed.exportedAt){ const exported=safeIsoDateTime(parsed.exportedAt); if(exported) next.lastBackupAt=exported; }
  data=next;
  if(saveData({allowRecovery:true})){paymentDisplayLimit=8;applyTheme();renderAll();flash('Sauvegarde restaurée ✓');}
}

function safeCsvValue(value){
  let s=String(value??'');
  if(/^[\s\u0000-\u001F]*[=+\-@]/.test(s)) s=`'${s}`;
  return `"${s.replaceAll('"','""')}"`;
}

function exportCsv(){
  const rows=[['Date','Passagers','Nombre','Tarif/passager','Participation prévue','Coût trajet'],...data.trips.map(t=>[t.date,t.people.map(personName).join(' / '),t.people.length,t.rate,t.rate*t.people.length,t.cost.toFixed(2)])];
  const csv='\ufeff'+rows.map(row=>row.map(safeCsvValue).join(';')).join('\n');
  downloadBlob(new Blob([csv],{type:'text/csv;charset=utf-8'}),'covoiturage.csv');
}

$$('.tab').forEach(button=>button.addEventListener('click',()=>selectTab(button.dataset.tab)));
$('#save').addEventListener('click',addTrip);
$('#tripDate').addEventListener('input',calcToday);
$('#tripDate').addEventListener('change',calcToday);
$('#cancelEdit').addEventListener('click',()=>{finishEditing();selectTab('history');});
$('#historyPerson').addEventListener('change',renderHistory);
$('#personSummary').addEventListener('click',event=>{
  const button=event.target.closest('.quick-payment');if(button)preparePayment(Number(button.dataset.personIndex));
});
$('#saveSettings').addEventListener('click',saveSettings);
$('#energyType').addEventListener('change',updateEnergyLabels);
$('#distance').addEventListener('input',updateVehicleCostHelp);
$('#vehicleCostPerKm').addEventListener('input',updateVehicleCostHelp);
$('#savePeople').addEventListener('click',savePeople);
$('#addPerson').addEventListener('click',addPerson);
$('#newPersonName').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();addPerson();}});
$('#activePeopleSettings').addEventListener('click',event=>{
  const button=event.target.closest('.archive-person'); if(!button) return;
  archivePerson(Number(button.dataset.personIndex));
});
$('#archivedPeopleSettings').addEventListener('click',event=>{
  const reactivate=event.target.closest('.reactivate-person');
  if(reactivate){ reactivatePerson(Number(reactivate.dataset.personIndex)); return; }
  const remove=event.target.closest('.delete-person');
  if(remove){ deleteArchivedPerson(Number(remove.dataset.personIndex)); }
});
$('#addPayment').addEventListener('click',addPayment);
$('#themeMode').addEventListener('change',event=>{data.settings.theme=event.target.value;if(saveData()){applyTheme();flash('Apparence mise à jour ✓');}});
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change',()=>{if((data.settings.theme||'system')==='system')applyTheme();});
$('#period').addEventListener('change',renderSummary);
$('#backupData').addEventListener('click',()=>{void backupData().catch(()=>alert('La sauvegarde n’a pas pu être créée. Réessayez.'));});
$('#restoreFile').addEventListener('change',async event=>{
  const input=event.target, file=input.files&&input.files[0];
  try{await restoreData(file);}catch(error){
    alert(error.message==='too-large'?'Ce fichier dépasse la limite de restauration de 20 Mo.':error.message==='future-version'?'Cette sauvegarde provient d’une version plus récente. Mettez à jour l’application avant de la restaurer.':'Ce fichier ne semble pas être une sauvegarde Covoiturage valide. Les données actuelles sont conservées.');
  }finally{input.value='';}
});
$('#export').addEventListener('click',exportCsv);

$('#historyList').addEventListener('click',event=>{
  const edit=event.target.closest('.edit-trip');if(edit){startEditTrip(edit.dataset.id);return;}
  const button=event.target.closest('.delete-trip'); if(!button) return;
  const id=button.dataset.id;
  if(confirm('Supprimer ce trajet ?')){data.trips=data.trips.filter(t=>t.id!==id);if(saveData()) renderAll();}
});
$('#paymentHistory').addEventListener('click',event=>{
  if(event.target.closest('#morePayments')){
    const selectedPerson=$('#payPerson').value;
    paymentDisplayLimit+=8;renderPayments();$('#payPerson').value=selectedPerson;
    return;
  }
  const button=event.target.closest('.delete-payment'); if(!button) return;
  const id=button.dataset.id;
  if(confirm('Supprimer ce versement ?')){data.payments=data.payments.filter(p=>p.id!==id);if(saveData()){renderAll();flash('Versement supprimé');}}
});

document.addEventListener('click',event=>{
  const button=event.target.closest('button'); if(!button || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  button.animate([{transform:'scale(1)'},{transform:'scale(.97)'},{transform:'scale(1)'}],{duration:180,easing:'ease-out'});
});

installKeyboardNavigation();
applyTheme();
renderAll();
if(storageProblem) alert(storageProblem+' Aucune donnée originale n’a été remplacée. Consultez la rubrique Sauvegarde dans Réglages.');

if('serviceWorker' in navigator){
  navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).then(registration=>{
    const notify=()=>flash('Mise à jour prête : fermez puis rouvrez l’application.');
    if(registration.waiting) notify();
    registration.addEventListener('updatefound',()=>{
      const worker=registration.installing;
      worker?.addEventListener('statechange',()=>{if(worker.state==='installed' && navigator.serviceWorker.controller) notify();});
    });
  }).catch(()=>flash('Le mode hors ligne n’a pas pu être préparé. Réessayez avec une connexion.'));
}
