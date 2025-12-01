// air-tech-app/assets/js/service.js (v9.3 - Stabil)

const state = {
    orderId: null, equipmentId: null, equipment: null, order: null, technician: null,
    serviceReport: { reportData: { components: [] } },
    checklistTemplate: null,
    editingComponentIndex: null
};

const api = {
    async request(endpoint, options = {}) {
        try {
            const response = await fetch(`/api${endpoint}`, {
                headers: { 'Content-Type': 'application/json' }, ...options,
                body: options.body ? JSON.stringify(options.body) : null
            });
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || `API-kall feilet: ${response.statusText}`);
            }
            const text = await response.text();
            return text ? JSON.parse(text) : {};
        } catch (error) { console.error(`API Error: ${error.message}`); throw error; }
    },
    get: (endpoint) => api.request(endpoint),
    put: (endpoint, body) => api.request(endpoint, { method: 'PUT', body }),
};

document.addEventListener('DOMContentLoaded', async () => {
    setLoading(true);
    try {
        const urlParams = new URLSearchParams(window.location.search);
        state.orderId = urlParams.get('orderId'); 
        state.equipmentId = urlParams.get('equipmentId');
        if (!state.orderId || !state.equipmentId) throw new Error("Mangler ID i URL.");

        const equipmentPromise = api.get(`/equipment/${state.equipmentId}`);
        const reportPromise = api.get(`/servicereports/equipment/${state.equipmentId}?orderId=${state.orderId}`);
        const orderPromise = api.get(`/orders/${state.orderId}`);
        const techniciansPromise = api.get('/technicians');
        
        const [equipment, serviceReport, order, technicians] = await Promise.all([equipmentPromise, reportPromise, orderPromise, techniciansPromise]);
        
        state.equipment = equipment;
        state.serviceReport = serviceReport;
        state.order = order;
        state.technician = technicians.find(t => t.id === order.technicianId);

        if (!state.serviceReport.reportData) state.serviceReport.reportData = {};
        if (!state.serviceReport.reportData.components) state.serviceReport.reportData.components = [];
        if (!state.serviceReport.reportData.overallComment) state.serviceReport.reportData.overallComment = '';

        if (state.equipment.type !== 'custom') {
            state.checklistTemplate = await api.get(`/checklists/template/${state.equipment.type}`);
        }
        
        renderAll();
        setupEventListeners();
    } catch (error) {
        console.error("Feil ved initialisering:", error);
        document.body.innerHTML = `<div class="app-container"><main class="main-content"><h1>Feil: ${error.message}</h1><a href="index.html">Tilbake til kalender</a></main></div>`;
    } finally {
        setLoading(false);
    }
});

function renderAll() {
    renderHeader();
    renderAnleggInfo();
    renderComponentList();
    renderComponentDetailsForm();
    renderChecklist();
    renderProductsSection();
    renderAdditionalWorkSection();
    resetAndLoadForm();
    document.getElementById('overall-comment').value = state.serviceReport.reportData.overallComment || '';
    updateFinalizeButtonState();
}

function renderHeader() {
    const header = document.getElementById('app-header');
    const tech = state.technician;
    const today = new Date();
    const dateString = `${today.getDate()}. ${today.toLocaleString('no-NO', { month: 'short' })} ${today.getFullYear()}`;
    const backUrl = `orders.html?id=${state.orderId}`;

    header.innerHTML = `
        <a href="${backUrl}" id="header-back-btn" class="header-nav-button" title="Tilbake til ordre">‹</a>
        <div class="header-main-content">
            <div class="logo-circle">
                <svg width="24" height="24" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="14" stroke="white" stroke-width="2" fill="none"/><circle cx="16" cy="16" r="8" stroke="white" stroke-width="2" fill="none"/><circle cx="16" cy="16" r="3" fill="white"/><path d="M16 2 L16 8" stroke="white" stroke-width="2"/><path d="M16 24 L16 30" stroke="white" stroke-width="2"/><path d="M30 16 L24 16" stroke="white" stroke-width="2"/><path d="M8 16 L2 16" stroke="white" stroke-width="2"/></svg>
            </div>
            <div class="company-info">
                <h1>AIR-TECH AS</h1>
                <span class="app-subtitle">System Sjekk</span>
            </div>
        </div>
        <div class="header-user-info">
            ${tech ? `<div class="technician-avatar">${tech.initials}</div>` : ''}
            <span>${dateString}</span>
        </div>`;
}

function resetAndLoadForm(isEditing = false) {
    if (!isEditing) {
      state.editingComponentIndex = null;
    }
    document.getElementById('component-form').reset();
    document.getElementById('product-lines-container').innerHTML = '';
    document.getElementById('additional-work-lines-container').innerHTML = '';
    const checklistContainer = document.getElementById('checklist-items-container');
    if (checklistContainer) {
        checklistContainer.querySelectorAll('.status-btn.active').forEach(btn => btn.classList.remove('active'));
        checklistContainer.querySelectorAll('.avvik-container.show, .byttet-container.show').forEach(el => el.classList.remove('show'));
    }
    if (state.editingComponentIndex !== null) {
        loadChecklistForEditing(state.editingComponentIndex);
    }
}

function renderAnleggInfo() { if (!state.equipment || !state.order) return; const typeDisplayName = state.equipment.type.charAt(0).toUpperCase() + state.equipment.type.slice(1); document.getElementById('anlegg-info').innerHTML = `<h4 class="card-title">Anleggsinformasjon</h4><div class="anlegg-info-grid"><div class="info-item"><span class="label">Anleggstype</span><span class="value">${typeDisplayName}</span></div><div class="info-item"><span class="label">Systemtype</span><span class="value">${state.equipment.systemType}</span></div><div class="info-item"><span class="label">Systemnummer</span><span class="value">${state.equipment.systemNumber}</span></div><div class="info-item"><span class="label">Plassering</span><span class="value">${state.equipment.name}</span></div><div class="info-item"><span class="label">Betjener</span><span class="value">${state.equipment.operator || 'Ikke angitt'}</span></div><div class="info-item"><span class="label">Ordrenummer</span><span class="value">${state.order.orderNumber}</span></div></div>`; }
function renderComponentList() {
    const container = document.getElementById('component-list-container');
    const components = state.serviceReport.reportData.components;
    if (!components || components.length === 0) {
        container.innerHTML = '<p class="placeholder-text">Ingen sjekklister er lagret.</p>';
        return;
    }
    container.innerHTML = components.map((comp, index) => {
        const isComplete = isChecklistComplete(comp);
        const statusClass = isComplete ? 'complete' : 'incomplete';
        let title = getComponentTitle(comp.details);
        return `<div class="component-summary-card ${statusClass}"><div class="info-wrapper" data-action="edit-component" data-index="${index}"><span class="status"><i data-lucide="${isComplete ? 'check-circle-2' : 'alert-circle'}"></i></span><span class="info"><strong>${title}</strong></span></div><button class="delete-checklist-btn" data-action="delete-checklist" data-index="${index}" title="Slett sjekkliste">X</button></div>`;
    }).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function getComponentTitle(details) { if (!details) return "Ukjent komponent"; if (state.equipment.type === 'custom') return details.beskrivelse || "Custom sjekk"; const systemNummer = details.systemnummer || ''; const plassering = details.plassering || ''; if (systemNummer && plassering) return `${systemNummer} - ${plassering}`; return systemNummer || plassering || "Sjekkliste"; }
function isChecklistComplete(component) { if (!component) return false; if (state.equipment.type === 'custom') return component.details && component.details.beskrivelse && component.details.beskrivelse.trim() !== ''; if (!component.checklist || !state.checklistTemplate || !state.checklistTemplate.items) return false; for (const item of state.checklistTemplate.items) { const result = component.checklist[item.id]; if (item.label === 'Innstilling brytere') { if (!result || String(result).trim() === '') return false; } else if (item.type === 'select') { if (!result || !result.status) return false; } else if (['number', 'text', 'textarea'].includes(item.type)) { if (result === undefined || result === null || String(result).trim() === '') return false; } } return true; }

function renderComponentDetailsForm() {
    const container = document.getElementById('component-details-form');
    let formHTML = '';
    const standardFields = `<div class="form-group"><label for="comp-systemnummer">System nummer</label><input type="text" id="comp-systemnummer"></div><div class="form-group"><label for="comp-plassering">Plassering</label><input type="text" id="comp-plassering"></div><div class="form-group"><label for="comp-betjener">Betjener</label><input type="text" id="comp-betjener"></div>`;
    switch(state.equipment.type) {
        case 'boligventilasjon': formHTML = `<div class="component-grid"><div class="form-group"><label>Etasje</label><input type="text" id="comp-etasje"></div><div class="form-group"><label>Leil.nr / Plassering</label><input type="text" id="comp-plassering"></div><div class="form-group"><label>Agg.type</label><input type="text" id="comp-aggtype"></div><div class="form-group"><label>System nr.</label><input type="text" id="comp-systemnummer"></div><div class="form-group"><label>Filter tilluft</label><input type="text" id="comp-filter_tilluft"></div><div class="form-group"><label>Filter avtrekk</label><input type="text" id="comp-filter_avtrekk"></div></div>`; break;
        case 'vifter': formHTML = `<div class="component-grid">${standardFields}<div class="form-group"><label for="comp-viftetype">Viftetype</label><input type="text" id="comp-viftetype"></div><div class="form-group"><label for="comp-filter_tilluft">Filter tilluft</label><input type="text" id="comp-filter_tilluft"></div><div class="form-group"><label for="comp-filter_avtrekk">Filter avtrekk</label><input type="text" id="comp-filter_avtrekk"></div></div>`; break;
        case 'ventilasjon': formHTML = `<div class="component-grid">${standardFields}<div class="form-group"><label for="comp-systemtype">Systemtype</label><input type="text" id="comp-systemtype"></div></div>`; break;
        case 'custom': formHTML = `<div class="form-group"><label>Beskrivelse</label><textarea id="comp-beskrivelse" class="large-textarea" placeholder="Beskriv hva som er sjekket/gjort..." rows="4"></textarea></div>`; break;
        default: formHTML = `<p class="placeholder-text">Ukjent anleggstype.</p>`;
    }
    container.innerHTML = formHTML;
}
function renderChecklist() { const container = document.getElementById('checklist-items-container'); const isCustom = state.equipment.type === 'custom'; container.style.display = isCustom ? 'none' : 'block'; container.previousElementSibling.style.display = isCustom ? 'none' : 'block'; if (isCustom || !state.checklistTemplate || !state.checklistTemplate.items) { container.innerHTML = ''; return; } container.innerHTML = state.checklistTemplate.items.map(item => { if (item.label === 'Innstilling brytere') { return createSwitchSettingsHTML(item); } switch (item.type) { case 'select': return createSelectItemHTML(item); case 'number': return createNumberItemHTML(item); case 'textarea': return createTextareaItemHTML(item); case 'text': return createTextItemHTML(item); default: return ''; } }).join(''); }
function createSwitchSettingsHTML(item) { const options = ['Auto', 'Sommer', 'Vinter', 'Av', 'På']; const optionsHTML = options.map(opt => `<option value="${opt}">${opt}</option>`).join(''); return `<div class="checklist-item-fullwidth" data-item-id="${item.id}" data-item-type="switch-select"><label class="item-label" for="select-${item.id}">${item.label}</label><select id="select-${item.id}" class="checklist-input-select"><option value="">Velg status...</option>${optionsHTML}</select></div>`; }
function renderProductsSection() { const container = document.getElementById('products-section-container'); if (state.equipment.type === 'custom') { container.innerHTML = ''; return; } container.innerHTML = `<div class="dynamic-section-header"><h4 class="card-title" style="margin:0;">Produkter</h4><button type="button" class="add-line-btn-icon" data-action="add-product-line" title="Legg til produkt">+</button></div><div id="product-lines-container" class="line-item-container"></div>`; }
function addProductLine(product = {}) { const container = document.getElementById('product-lines-container'); if (!container) return; const line = document.createElement('div'); line.className = 'line-item product-item'; line.innerHTML = `<input type="text" class="line-input product-name" placeholder="Produkt" value="${product.name || ''}"><input type="number" class="line-input product-price" placeholder="Pris" value="${product.price || ''}"><button type="button" class="action-btn-icon" data-action="remove-line" title="Fjern linje">-</button>`; container.appendChild(line); }
function renderAdditionalWorkSection() { const container = document.getElementById('additional-work-section-container'); if (state.equipment.type === 'custom') { container.innerHTML = ''; return; } container.innerHTML = `<div class="dynamic-section-header"><h4 class="card-title" style="margin:0;">Tilleggsarbeid</h4><button type="button" class="add-line-btn-icon" data-action="add-work-line" title="Legg til arbeid">+</button></div><div id="additional-work-lines-container" class="line-item-container"></div>`; }
function addAdditionalWorkLine(work = {}) { const container = document.getElementById('additional-work-lines-container'); if (!container) return; const line = document.createElement('div'); line.className = 'line-item work-item'; line.innerHTML = `<div class="work-item-main"><textarea class="line-input work-description" placeholder="Beskrivelse av utført tilleggsarbeid..." rows="2">${work.description || ''}</textarea></div><div class="work-item-footer"><div class="input-group"><label>Timer</label><input type="text" inputmode="decimal" class="line-input work-hours" value="${work.hours || ''}"></div><div class="input-group"><label>Pris (kr)</label><input type="text" inputmode="numeric" class="line-input work-price" value="${work.price || ''}"></div><button type="button" class="action-btn-icon" data-action="remove-line" title="Fjern linje">-</button></div>`; container.appendChild(line); }
function createSelectItemHTML(item) { const buttonsHTML = item.options.map(opt => `<button type="button" class="status-btn ${opt.toLowerCase()}" data-status="${opt.toLowerCase()}">${opt}</button>`).join(''); return `<div class="checklist-item" data-item-id="${item.id}" data-item-type="select"><span class="item-label">${item.label}</span><div class="item-actions">${buttonsHTML}</div></div><div class="avvik-container" id="avvik-${item.id}"><textarea placeholder="Beskriv avvik..."></textarea><button type="button" class="action-btn-secondary"><i data-lucide="camera"></i>Ta bilde</button></div><div class="byttet-container" id="byttet-${item.id}"><textarea placeholder="Kommentar til bytte..."></textarea><button type="button" class="action-btn-secondary"><i data-lucide="camera"></i>Ta bilde</button></div>`; }
function createNumberItemHTML(item) { return `<div class="checklist-item" data-item-id="${item.id}" data-item-type="number"><label class="item-label" for="input-${item.id}">${item.label}</label><input type="text" id="input-${item.id}" inputmode="numeric" class="checklist-input-number" /></div>`; }
function createTextItemHTML(item) { return `<div class="checklist-item" data-item-id="${item.id}" data-item-type="text"><label class="item-label" for="input-${item.id}">${item.label}</label><input type="text" id="input-${item.id}" class="checklist-input-text" /></div>`; }
function createTextareaItemHTML(item) { return `<div class="checklist-item-fullwidth" data-item-id="${item.id}" data-item-type="textarea"><label class="item-label" for="input-${item.id}">${item.label}</label><textarea id="input-${item.id}" class="checklist-input-textarea"></textarea></div>`; }

function setupEventListeners() { document.getElementById('component-form').addEventListener('submit', saveChecklist); document.getElementById('checklist-items-container').addEventListener('click', handleStatusClick); document.getElementById('finalize-report-btn').addEventListener('click', finalizeAnlegg); document.getElementById('component-list').addEventListener('click', handleComponentListClick); document.getElementById('new-component-form').addEventListener('click', handleDynamicLineClick); document.getElementById('app-header').addEventListener('click', async (e) => { const backButton = e.target.closest('#header-back-btn'); if (backButton) { e.preventDefault(); setLoading(true); try { await saveChecklist({ preventDefault: () => {} }); window.location.href = backButton.href; } catch (error) { console.error("Kunne ikke lagre ved tilbake-navigering:", error); window.location.href = backButton.href; } finally { setLoading(false); } } }); }
function handleComponentListClick(e) { const target = e.target.closest('[data-action]'); if (!target) return; const action = target.dataset.action; const index = parseInt(target.dataset.index, 10); if (action === 'edit-component') { state.editingComponentIndex = index; resetAndLoadForm(true); } else if (action === 'delete-checklist') { if (confirm('Er du sikker på at du vil slette denne sjekklisten?')) { deleteChecklist(index); } } }
async function deleteChecklist(index) { setLoading(true); state.serviceReport.reportData.components.splice(index, 1); try { await api.put(`/servicereports/${state.serviceReport.reportId}`, state.serviceReport); renderComponentList(); updateFinalizeButtonState(); showToast('Sjekkliste slettet', 'success'); } catch (error) { showToast(`Sletting feilet: ${error.message}`, 'error'); } finally { setLoading(false); } }
function handleDynamicLineClick(e) { const target = e.target.closest('[data-action]'); if (!target) return; const action = target.dataset.action; if (action === 'add-product-line') addProductLine(); if (action === 'add-work-line') addAdditionalWorkLine(); if (action === 'remove-line') if (confirm('Er du sikker på at du vil fjerne denne linjen?')) target.closest('.line-item').remove(); }
function handleStatusClick(e) { const button = e.target.closest('.status-btn'); if (!button) return; const parent = button.parentElement; if (button.classList.contains('active')) { button.classList.remove('active'); } else { parent.querySelectorAll('.status-btn').forEach(btn => btn.classList.remove('active')); button.classList.add('active'); } const itemElement = button.closest('.checklist-item'); const avvikContainer = itemElement.nextElementSibling; const byttetContainer = avvikContainer.nextElementSibling; if(avvikContainer) avvikContainer.classList.toggle('show', button.dataset.status === 'avvik' && button.classList.contains('active')); if(byttetContainer) byttetContainer.classList.toggle('show', (button.dataset.status === 'byttet' || button.dataset.status === 'rengjort') && button.classList.contains('active')); }

async function saveChecklist(e) {
    e.preventDefault();

    const isCustom = state.equipment.type === 'custom';

    // Validering kjøres kun for nye sjekklister, før setLoading(true)
    if (state.editingComponentIndex === null) {
        if (isCustom) {
            const beskrivelseInput = document.getElementById('comp-beskrivelse');
            if (!beskrivelseInput || beskrivelseInput.value.trim() === '') {
                showToast("Beskrivelse må fylles ut før du kan lagre en sjekkliste.", 'error');
                return;
            }
        } else {
            const systemnummerInput = document.getElementById('comp-systemnummer');
            const plasseringInput = document.getElementById('comp-plassering');

            if (!systemnummerInput || !plasseringInput || systemnummerInput.value.trim() === '' || plasseringInput.value.trim() === '') {
                showToast("System nummer og Plassering må fylles ut før du kan lagre en sjekkliste.", 'error');
                return;
            }
        }
    }

    setLoading(true);

    const tempDetails = {};
    document.getElementById('component-details-form').querySelectorAll('input, textarea').forEach(input => {
        const key = input.id.replace('comp-', '');
        tempDetails[key] = input.value;
    });
    
    const tempChecklistData = {};
    if (!isCustom) { document.querySelectorAll('#checklist-items-container [data-item-id]').forEach(item => { const id = item.dataset.itemId; const type = item.dataset.itemType; let value = null; if (type === 'switch-select') { value = item.querySelector('select').value; } else if (type === 'select') { const activeButton = item.querySelector('.status-btn.active'); if (activeButton) { value = { status: activeButton.dataset.status }; const commentContainer = activeButton.closest('.checklist-item').nextElementSibling; if(commentContainer && (commentContainer.classList.contains('avvik-container') || commentContainer.classList.contains('byttet-container')) && commentContainer.classList.contains('show')) { value.comment = commentContainer.querySelector('textarea').value || ''; } } } else if (item.querySelector('input, textarea')) { value = item.querySelector('input, textarea').value; } tempChecklistData[id] = value; }); }
    const products = Array.from(document.querySelectorAll('#product-lines-container .line-item')).map(line => ({ name: line.querySelector('.product-name').value.trim(), price: line.querySelector('.product-price').value })).filter(p => p.name || p.price);
    const additionalWork = Array.from(document.querySelectorAll('#additional-work-lines-container .line-item')).map(line => ({ description: line.querySelector('.work-description').value.trim(), hours: line.querySelector('.work-hours').value, price: line.querySelector('.work-price').value })).filter(w => w.description || w.hours || w.price);
    
    const newComponentData = { details: tempDetails, checklist: tempChecklistData, products: products.map(p=> ({...p, price: parseFloat(p.price) || 0})), additionalWork: additionalWork.map(w=> ({...w, hours: parseFloat(w.hours) || 0, price: parseFloat(w.price) || 0})) };
    
    if (state.editingComponentIndex === null) {
        state.serviceReport.reportData.components.push(newComponentData);
    } else {
        state.serviceReport.reportData.components[state.editingComponentIndex] = newComponentData;
    }

    try {
        state.serviceReport = await api.put(`/servicereports/${state.serviceReport.reportId}`, state.serviceReport);
        if (state.equipment.serviceStatus === 'not_started') {
            await api.put(`/equipment/${state.equipmentId}`, { serviceStatus: 'in_progress' });
            state.equipment.serviceStatus = 'in_progress';
        }
        
        state.editingComponentIndex = null;
        resetAndLoadForm(); 
        renderComponentList();
        updateFinalizeButtonState();
        showToast('Sjekkliste lagret!', 'success');
        
    } catch (error) {
        showToast(`Kunne ikke lagre: ${error.message}`, 'error');
    } finally {
        setLoading(false);
    }
}
function loadChecklistForEditing(index) { const component = state.serviceReport.reportData.components[index]; if (!component) return; if (component.details) Object.entries(component.details).forEach(([key, value]) => { const input = document.getElementById(`comp-${key}`); if (input) input.value = value; }); if (component.checklist && state.equipment.type !== 'custom') { Object.entries(component.checklist).forEach(([itemId, result]) => { const itemElement = document.querySelector(`[data-item-id="${itemId}"]`); if (!itemElement) return; const itemType = itemElement.dataset.itemType; if (itemType === 'switch-select') { const select = itemElement.querySelector('select'); if (select && result) select.value = result; } else if (itemType === 'select' && result && result.status) { const button = itemElement.querySelector(`[data-status="${result.status}"]`); if (button) { button.click(); if(button.classList.contains('active')){const commentContainer = button.closest('.checklist-item').nextElementSibling;if(commentContainer && result.comment){commentContainer.querySelector('textarea').value = result.comment;}} } } else if (['text', 'textarea', 'number'].includes(itemType) && result) { const input = itemElement.querySelector('input, textarea'); if(input) input.value = result; } }); } const productContainer = document.getElementById('product-lines-container'); if (productContainer) { productContainer.innerHTML = ''; if (component.products && component.products.length > 0) component.products.forEach(p => addProductLine(p)); } const workContainer = document.getElementById('additional-work-lines-container'); if (workContainer) { workContainer.innerHTML = ''; if (component.additionalWork && component.additionalWork.length > 0) component.additionalWork.forEach(w => addAdditionalWorkLine(w)); } document.getElementById('new-component-form').scrollIntoView({ behavior: 'smooth' }); }
function updateFinalizeButtonState() { const btn = document.getElementById('finalize-report-btn'); if (!btn) return; const allComponents = state.serviceReport.reportData.components; btn.disabled = !(allComponents.length > 0 && allComponents.every(c => isChecklistComplete(c))); }
async function finalizeAnlegg() { if (state.serviceReport.reportData.components.length === 0) return showToast("Du må lagre minst én sjekkliste.", 'error'); setLoading(true); state.serviceReport.reportData.overallComment = document.getElementById('overall-comment').value; try { await api.put(`/servicereports/${state.serviceReport.reportId}`, state.serviceReport); await api.put(`/equipment/${state.equipmentId}`, { serviceStatus: 'completed' }); window.location.href = `orders.html?id=${state.orderId}`; } catch(error) { showToast(`Kunne ikke ferdigstille: ${error.message}`, 'error'); setLoading(false); } }
function setLoading(isLoading) { const loader = document.getElementById('loading-indicator'); if (loader) loader.style.display = isLoading ? 'flex' : 'none'; }
function showToast(message, type = 'info') { const notification = document.createElement('div'); notification.className = `notification ${type}`; notification.textContent = message; Object.assign(notification.style, { position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)', padding: '1em', borderRadius: '8px', color: 'white', zIndex: '1001', background: type === 'error' ? '#d9534f' : '#5cb85c', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', animation: 'fadeInUp 0.5s' }); document.body.appendChild(notification); setTimeout(() => { notification.remove(); }, 3000); }