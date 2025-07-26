// air-tech-app/assets/js/service.js (v10.3 - Design Fix)

const state = {
    orderId: null, equipmentId: null, equipment: null, order: null, technician: null,
    serviceReport: { reportData: { components: [] } },
    checklistTemplate: null,
    editingComponentIndex: null,
    offlineTemplates: {} // For fallback
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

async function loadChecklistForFacility(facilityType) {
    console.log('Laster sjekkliste for anleggstype:', facilityType);
    
    let templates = null;
    const paths = [
        '/database/checklist-templates.json',
        '../database/checklist-templates.json',
        'database/checklist-templates.json'
    ];

    for (const path of paths) {
        try {
            console.log('Prøver sti:', path);
            const response = await fetch(path);
            if (response.ok) {
                templates = await response.json();
                console.log('Vellykket lasting fra:', path);
                break;
            }
        } catch (e) {
            console.log('Kunne ikke laste fra:', path, e);
        }
    }

    if (!templates) {
        console.error('Kunne ikke laste maler fra noen av de angitte stiene.');
        useOfflineChecklist(facilityType);
        return;
    }
    
    console.log('Maler lastet:', templates);
    
    const template = templates.facilityTypes.find(t => {
        const idMatch = t.id === facilityType;
        const nameMatch = t.name.toLowerCase() === facilityType.toLowerCase();
        console.log(`Sjekker mal: id='${t.id}', name='${t.name}'. Match? id: ${idMatch}, name: ${nameMatch}`);
        return idMatch || nameMatch;
    });
    
    if (!template) {
        console.error('Ingen mal funnet for:', facilityType);
        useOfflineChecklist(facilityType);
        return;
    }
    
    console.log('Bruker mal:', template);
    state.checklistTemplate = template;
}

function useOfflineChecklist(facilityType) {
    console.log('Bruker offline/fallback sjekkliste for:', facilityType);
    const template = state.offlineTemplates[facilityType];
    if (template) {
        state.checklistTemplate = template;
    } else {
        state.checklistTemplate = {
            id: 'fallback', name: 'Standard Sjekkliste',
            systemFields: [
                { name: "system_number", label: "System nummer", required: true, order: 1 },
                { name: "placement", label: "Plassering", required: true, order: 2 }
            ],
            checklistItems: [{ id: "fallback_1", label: "Generell sjekk", inputType: "ok_avvik", order: 1 }],
            allowProducts: true, allowAdditionalWork: true, hasGeneralComment: true, hasDriftSchedule: false
        };
        showToast('Bruker standard sjekkliste (offline).', 'info');
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOM lastet, initialiserer...');
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

        console.log('Anleggstype fra state:', state.equipment.type);
        await loadChecklistForFacility(state.equipment.type);
        
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
    console.log("Kjører renderAll()...");
    renderHeader();
    renderAnleggInfo();
    renderComponentList();
    renderComponentDetailsForm();
    renderChecklist();
    renderSectionVisibility();
    renderDriftScheduleSection();
    resetAndLoadForm();
    document.getElementById('overall-comment').value = state.serviceReport.reportData.overallComment || '';
    updateFinalizeButtonState();
}

function renderHeader() {
    const header = document.getElementById('app-header');
    const tech = state.technician;
    const today = new Date();
    const dateString = `${today.getDate()}. ${today.toLocaleString('no-NO', { month: 'short' })} ${today.getFullYear()}`;

    header.innerHTML = `
        <a href="orders.html?id=${state.orderId}" class="header-nav-button" title="Tilbake til ordre">‹</a>
        <div class="header-main-content">
            <div class="logo-circle">
                <svg width="24" height="24" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="14" stroke="white" stroke-width="2" fill="none"/><circle cx="16" cy="16" r="8" stroke="white" stroke-width="2" fill="none"/><circle cx="16" cy="16" r="3" fill="white"/><path d="M16 2 L16 8" stroke="white" stroke-width="2"/><path d="M16 24 L16 30" stroke="white" stroke-width="2"/><path d="M30 16 L24 16" stroke="white" stroke-width="2"/><path d="M8 16 L2 16" stroke="white" stroke-width="2"/></svg>
            </div>
            <div class="company-info">
                <h1>AIR-TECH AS</h1>
                <span class="app-subtitle">Servicedetaljer</span>
            </div>
        </div>
        <div class="header-user-info">
            ${tech ? `<div class="technician-avatar">${tech.initials}</div>` : ''}
            <span>${dateString}</span>
        </div>
    `;
}

function resetAndLoadForm(isEditing = false) {
    if (!isEditing) {
        state.editingComponentIndex = null;
    }
    document.getElementById('component-form').reset();
    
    const productContainer = document.getElementById('product-lines-container');
    if (productContainer) productContainer.innerHTML = '';
    
    const workContainer = document.getElementById('additional-work-lines-container');
    if (workContainer) workContainer.innerHTML = '';
    
    const checklistContainer = document.getElementById('checklist-items-container');
    if (checklistContainer) {
        checklistContainer.querySelectorAll('.status-btn.active').forEach(btn => btn.classList.remove('active'));
        checklistContainer.querySelectorAll('.avvik-container.show, .byttet-container.show').forEach(el => el.classList.remove('show'));
    }
    
    if (state.editingComponentIndex !== null) {
        loadChecklistForEditing(state.editingComponentIndex);
    }
}

function renderAnleggInfo() { 
    if (!state.equipment || !state.order) return; 
    const typeDisplayName = state.equipment.type.charAt(0).toUpperCase() + state.equipment.type.slice(1); 
    document.getElementById('anlegg-info').innerHTML = `<h4 class="card-title">Anleggsinformasjon</h4><div class="anlegg-info-grid"><div class="info-item"><span class="label">Anleggstype</span><span class="value">${typeDisplayName}</span></div><div class="info-item"><span class="label">Systemtype</span><span class="value">${state.equipment.systemType}</span></div><div class="info-item"><span class="label">Systemnummer</span><span class="value">${state.equipment.systemNumber}</span></div><div class="info-item"><span class="label">Plassering</span><span class="value">${state.equipment.name}</span></div><div class="info-item"><span class="label">Betjener</span><span class="value">${state.equipment.operator || 'Ikke angitt'}</span></div><div class="info-item"><span class="label">Ordrenummer</span><span class="value">${state.order.orderNumber}</span></div></div>`; 
}

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

function getComponentTitle(details) { 
    if (!details) return "Ukjent komponent"; 
    if (state.equipment.type === 'custom') return details.beskrivelse || "Custom sjekk"; 
    const systemNummer = details.systemnummer || ''; 
    const plassering = details.plassering || ''; 
    if (systemNummer && plassering) return `${systemNummer} - ${plassering}`; 
    return systemNummer || plassering || "Sjekkliste"; 
}

function isChecklistComplete(component) {
    if (!component) return false;
    if (state.equipment.type === 'custom') return component.details && component.details.beskrivelse && component.details.beskrivelse.trim() !== '';
    if (!component.checklist || !state.checklistTemplate || !state.checklistTemplate.checklistItems) return false;

    function checkChecklistItemCompletion(items, checklistData) {
        for (const item of items) {
            const result = checklistData[item.id];
            if (item.required) {
                switch (item.inputType) {
                    case 'ok_avvik':
                    case 'ok_byttet_avvik':
                        if (!result || !result.status) return false;
                        if ((result.status === 'avvik' || result.status === 'byttet' || result.status === 'rengjort') && (!result.comment || result.comment.trim() === '')) return false;
                        break;
                    case 'numeric': case 'text': case 'textarea':
                        if (result === undefined || result === null || String(result).trim() === '') return false;
                        break;
                    case 'checkbox':
                        if (result === undefined || result === null) return false;
                        break;
                    case 'group_selection':
                        if (!item.subpoints || item.subpoints.length === 0) return false;
                        const anySubpointComplete = item.subpoints.some(subItem => checklistData[subItem.id] !== undefined && checklistData[subItem.id] !== null);
                        if (!anySubpointComplete) return false;
                        break;
                    case 'switch_select':
                        if (!result || String(result).trim() === '') return false;
                        break;
                }
            }
            if (item.hasSubpoints && item.subpoints && (item.inputType !== 'checkbox' || (result === true))) {
                if (!checkChecklistItemCompletion(item.subpoints, checklistData)) return false;
            }
        }
        return true;
    }
    return checkChecklistItemCompletion(state.checklistTemplate.checklistItems, component.checklist);
}

function renderComponentDetailsForm() {
    console.log("Kjører renderComponentDetailsForm()...");
    const container = document.getElementById('component-details-form');
    let formHTML = '';

    if (!state.checklistTemplate) {
        container.innerHTML = '<p class="placeholder-text">Laster sjekklistedetaljer...</p>';
        return;
    }

    if (state.equipment.type === 'custom') {
        formHTML = `<div class="form-group"><label>Beskrivelse</label><textarea id="comp-beskrivelse" class="large-textarea" placeholder="Beskriv hva som er sjekket/gjort..." rows="4"></textarea></div>`;
    } else if (state.checklistTemplate.systemFields) {
        const fieldsHtml = state.checklistTemplate.systemFields.sort((a, b) => a.order - b.order).map(field => {
            const inputType = field.type === 'textarea' ? 'textarea' : 'input';
            const inputHtml = inputType === 'textarea' ?
                `<textarea id="comp-${field.name}" class="large-textarea" placeholder="${field.label}" rows="4"></textarea>` :
                `<input type="text" id="comp-${field.name}">`;
            return `<div class="form-group"><label for="comp-${field.name}">${field.label}</label>${inputHtml}</div>`;
        }).join('');
        formHTML = `<div class="component-grid">${fieldsHtml}</div>`;
    } else {
        formHTML = `<p class="placeholder-text">Ukjent anleggstype eller manglende mal.</p>`;
    }
    container.innerHTML = formHTML;
}

function renderChecklist() { 
    console.log('Kjører renderChecklist(), mal:', state.checklistTemplate);
    const container = document.getElementById('checklist-items-container'); 
    if (!container) {
        console.error("Container 'checklist-items-container' ikke funnet!");
        return;
    }

    const isCustom = state.equipment.type === 'custom'; 
    container.style.display = isCustom ? 'none' : 'block'; 
    container.previousElementSibling.style.display = isCustom ? 'none' : 'block'; 

    if (isCustom || !state.checklistTemplate || !state.checklistTemplate.checklistItems) { 
        container.innerHTML = isCustom ? '' : '<p class="placeholder-text">Ingen sjekkpunkter for denne typen.</p>';
        if (!state.checklistTemplate) console.error("renderChecklist: Ingen mal i state!");
        return; 
    } 

    const sortedChecklistItems = state.checklistTemplate.checklistItems.sort((a, b) => a.order - b.order);
    container.innerHTML = sortedChecklistItems.map(item => createChecklistItemHTML(item)).join(''); 
    
    setupConditionalLogic();
}

function createChecklistItemHTML(item) {
    let itemHTML = '';
    switch (item.inputType) {
        case 'ok_avvik': itemHTML = createOkAvvikItemHTML(item); break;
        case 'ok_byttet_avvik': itemHTML = createOkByttetAvvikItemHTML(item); break;
        case 'numeric': itemHTML = createNumberItemHTML(item); break;
        case 'text': itemHTML = createTextItemHTML(item); break;
        case 'textarea': itemHTML = createTextareaItemHTML(item); break;
        case 'checkbox': itemHTML = createCheckboxItemHTML(item); break;
        case 'group_selection': itemHTML = createGroupSelectionItemHTML(item); break;
        case 'switch_select': itemHTML = createSwitchSelectHTML(item); break;
    }

    if (item.hasSubpoints && item.subpoints) {
        const subpointsHTML = item.subpoints.sort((a, b) => a.order - b.order).map(subItem => createChecklistItemHTML(subItem)).join('');
        return `<div class="checklist-item-group" data-group-id="${item.id}">${itemHTML}<div class="sub-checklist-items sub-${item.id}" style="display: none;">${subpointsHTML}</div></div>`;
    }
    return itemHTML;
}

function createOkAvvikItemHTML(item) {
    const buttonsHTML = `<button type="button" class="status-btn ok" data-status="ok">OK</button><button type="button" class="status-btn avvik" data-status="avvik">Avvik</button>`;
    return `<div class="checklist-item" data-item-id="${item.id}" data-item-type="ok_avvik"><span class="item-label">${item.label}</span><div class="item-actions">${buttonsHTML}</div></div><div class="avvik-container" id="avvik-${item.id}"><textarea placeholder="Beskriv avvik..."></textarea><button type="button" class="action-btn-secondary"><i data-lucide="camera"></i>Ta bilde</button></div>`;
}

function createOkByttetAvvikItemHTML(item) {
    const buttonsHTML = `<button type="button" class="status-btn ok" data-status="ok">OK</button><button type="button" class="status-btn byttet" data-status="byttet">Byttet</button><button type="button" class="status-btn avvik" data-status="avvik">Avvik</button>`;
    return `<div class="checklist-item" data-item-id="${item.id}" data-item-type="ok_byttet_avvik"><span class="item-label">${item.label}</span><div class="item-actions">${buttonsHTML}</div></div><div class="avvik-container" id="avvik-${item.id}"><textarea placeholder="Beskriv avvik..."></textarea><button type="button" class="action-btn-secondary"><i data-lucide="camera"></i>Ta bilde</button></div><div class="byttet-container" id="byttet-${item.id}"><textarea placeholder="Kommentar til bytte..."></textarea><button type="button" class="action-btn-secondary"><i data-lucide="camera"></i>Ta bilde</button></div>`;
}

function createNumberItemHTML(item) { return `<div class="checklist-item" data-item-id="${item.id}" data-item-type="numeric"><label class="item-label" for="input-${item.id}">${item.label}</label><input type="text" id="input-${item.id}" inputmode="numeric" class="checklist-input-number" /></div>`; }
function createTextItemHTML(item) { return `<div class="checklist-item" data-item-id="${item.id}" data-item-type="text"><label class="item-label" for="input-${item.id}">${item.label}</label><input type="text" id="input-${item.id}" class="checklist-input-text" /></div>`; }
function createTextareaItemHTML(item) { return `<div class="checklist-item-fullwidth" data-item-id="${item.id}" data-item-type="textarea"><label class="item-label" for="input-${item.id}">${item.label}</label><textarea id="input-${item.id}" class="checklist-input-textarea"></textarea></div>`; }

function createCheckboxItemHTML(item) {
    return `<div class="form-check checklist-item" data-item-id="${item.id}" data-item-type="checkbox"><input class="form-check-input" type="checkbox" id="${item.id}" name="${item.id}"><label class="form-check-label" for="${item.id}">${item.label}</label></div>`;
}

function createGroupSelectionItemHTML(item) {
    const subpointsHTML = item.subpoints.sort((a, b) => a.order - b.order).map(subItem => `<div class="form-check checklist-item" data-item-id="${subItem.id}" data-item-type="radio" data-group="${subItem.exclusiveGroup}"><input class="form-check-input" type="radio" name="${subItem.exclusiveGroup}" id="${subItem.id}"><label class="form-check-label" for="${subItem.id}">${subItem.label}</label></div>`).join('');
    return `<div class="checklist-item-group" data-group-id="${item.id}"><span class="item-label">${item.label}</span><div class="sub-checklist-items">${subpointsHTML}</div></div>`;
}

function createSwitchSelectHTML(item) { 
    const options = ['Auto', 'Sommer', 'Vinter', 'Av', 'På']; 
    const optionsHTML = options.map(opt => `<option value="${opt}">${opt}</option>`).join(''); 
    return `<div class="checklist-item-fullwidth" data-item-id="${item.id}" data-item-type="switch_select"><label class="item-label" for="select-${item.id}">${item.label}</label><select id="select-${item.id}" class="checklist-input-select"><option value="">Velg status...</option>${optionsHTML}</select></div>`; 
}

function setupConditionalLogic() {
    document.querySelectorAll('.checklist-item-group input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', (event) => {
            const parentId = event.target.id;
            const subContainer = document.querySelector(`.sub-${parentId}`);
            if (subContainer) subContainer.style.display = event.target.checked ? 'block' : 'none';
        });
    });
}

function setupEventListeners() { 
    document.getElementById('component-form').addEventListener('submit', saveChecklist); 
    document.getElementById('checklist-items-container').addEventListener('click', handleStatusClick); 
    document.getElementById('finalize-report-btn').addEventListener('click', finalizeAnlegg); 
    document.getElementById('component-list').addEventListener('click', handleComponentListClick); 
    document.getElementById('new-component-form').addEventListener('click', handleDynamicLineClick); 
}

function handleComponentListClick(e) { 
    const target = e.target.closest('[data-action]'); 
    if (!target) return; 
    const action = target.dataset.action; 
    const index = parseInt(target.dataset.index, 10); 
    if (action === 'edit-component') { 
        state.editingComponentIndex = index; 
        resetAndLoadForm(true); 
    } else if (action === 'delete-checklist') { 
        if (confirm('Er du sikker på at du vil slette denne sjekklisten?')) deleteChecklist(index); 
    } 
}

async function deleteChecklist(index) { 
    setLoading(true); 
    state.serviceReport.reportData.components.splice(index, 1); 
    try { 
        await api.put(`/servicereports/${state.serviceReport.reportId}`, state.serviceReport); 
        renderComponentList(); 
        updateFinalizeButtonState(); 
        showToast('Sjekkliste slettet', 'success'); 
    } catch (error) { 
        showToast(`Sletting feilet: ${error.message}`, 'error'); 
    } finally { 
        setLoading(false); 
    } 
}

function handleDynamicLineClick(e) { 
    const target = e.target.closest('[data-action]'); 
    if (!target) return; 
    const action = target.dataset.action; 
    if (action === 'add-product-line') addProductLine(); 
    if (action === 'add-work-line') addAdditionalWorkLine(); 
    if (action === 'remove-line' && confirm('Er du sikker på at du vil fjerne denne linjen?')) target.closest('.product-item, .work-item').remove(); 
}

function handleStatusClick(e) { 
    const button = e.target.closest('.status-btn'); 
    if (!button) return; 
    const parent = button.parentElement; 
    if (button.classList.contains('active')) { 
        button.classList.remove('active'); 
    } else { 
        parent.querySelectorAll('.status-btn').forEach(btn => btn.classList.remove('active')); 
        button.classList.add('active'); 
    } 
    const itemElement = button.closest('.checklist-item'); 
    const avvikContainer = itemElement.nextElementSibling; 
    const byttetContainer = avvikContainer.nextElementSibling; 
    if(avvikContainer) avvikContainer.classList.toggle('show', button.dataset.status === 'avvik' && button.classList.contains('active')); 
    if(byttetContainer) byttetContainer.classList.toggle('show', (button.dataset.status === 'byttet' || button.dataset.status === 'rengjort') && button.classList.contains('active')); 
}

async function saveChecklist(e) {
    e.preventDefault();
    const isCustom = state.equipment.type === 'custom';

    if (state.editingComponentIndex === null) {
        if (isCustom) {
            const beskrivelseInput = document.getElementById('comp-beskrivelse');
            if (!beskrivelseInput || beskrivelseInput.value.trim() === '') {
                showToast("Beskrivelse må fylles ut før du kan lagre.", 'error');
                return;
            }
        } else {
            const systemnummerInput = document.getElementById('comp-system_number');
            const plasseringInput = document.getElementById('comp-placement');
            if (!systemnummerInput || !plasseringInput || systemnummerInput.value.trim() === '' || plasseringInput.value.trim() === '') {
                showToast("System nummer og Plassering må fylles ut.", 'error');
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
    if (!isCustom && state.checklistTemplate && state.checklistTemplate.checklistItems) {
        function collectChecklistData(items) {
            items.forEach(item => {
                const element = document.querySelector(`[data-item-id="${item.id}"]`);
                if (!element) return;
                let value = null;
                switch (item.inputType) {
                    case 'ok_avvik': case 'ok_byttet_avvik':
                        const activeButton = element.querySelector('.status-btn.active');
                        if (activeButton) {
                            value = { status: activeButton.dataset.status };
                            const avvikContainer = element.nextElementSibling;
                            const byttetContainer = avvikContainer ? avvikContainer.nextElementSibling : null;
                            if (activeButton.dataset.status === 'avvik' && avvikContainer?.classList.contains('show')) {
                                value.comment = avvikContainer.querySelector('textarea').value || '';
                            } else if ((activeButton.dataset.status === 'byttet' || activeButton.dataset.status === 'rengjort') && byttetContainer?.classList.contains('show')) {
                                value.comment = byttetContainer.querySelector('textarea').value || '';
                            }
                        }
                        break;
                    case 'numeric': case 'text': case 'textarea':
                        value = element.querySelector('input, textarea')?.value;
                        break;
                    case 'checkbox':
                        value = element.querySelector('input[type="checkbox"]')?.checked;
                        break;
                    case 'group_selection':
                        const selectedRadio = element.querySelector('input[type="radio"]:checked');
                        if (selectedRadio) value = selectedRadio.id;
                        break;
                    case 'switch_select':
                        value = element.querySelector('select')?.value;
                        break;
                }
                tempChecklistData[item.id] = value;
                if (item.hasSubpoints && item.subpoints) collectChecklistData(item.subpoints);
            });
        }
        collectChecklistData(state.checklistTemplate.checklistItems);
    }
    
    const products = Array.from(document.querySelectorAll('#product-lines-container .product-item')).map(line => ({ 
        name: line.querySelector('input[name="produktnavn"]').value.trim(), 
        price: line.querySelector('input[name="pris"]').value 
    })).filter(p => p.name || p.price);
    
    const additionalWork = Array.from(document.querySelectorAll('#additional-work-lines-container .work-item')).map(line => ({ 
        description: line.querySelector('input[name="beskrivelse"]').value.trim(), 
        hours: line.querySelector('input[name="timer"]').value, 
        price: line.querySelector('input[name="pris"]').value 
    })).filter(w => w.description || w.hours || w.price);
    
    const newComponentData = { 
        details: tempDetails, 
        checklist: tempChecklistData, 
        products: products.map(p=> ({...p, price: parseFloat(p.price) || 0})), 
        additionalWork: additionalWork.map(w=> ({...w, hours: parseFloat(w.hours) || 0, price: parseFloat(w.price) || 0})) 
    };
    
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

function loadChecklistForEditing(index) {
    const component = state.serviceReport.reportData.components[index];
    if (!component) return;

    if (component.details) {
        Object.entries(component.details).forEach(([key, value]) => {
            const input = document.getElementById(`comp-${key}`);
            if (input) input.value = value;
        });
    }

    if (component.checklist && state.equipment.type !== 'custom' && state.checklistTemplate?.checklistItems) {
        function populateChecklistItem(items, checklistData) {
            items.forEach(item => {
                const result = checklistData[item.id];
                if (result === undefined || result === null) return;
                const element = document.querySelector(`[data-item-id="${item.id}"]`);
                if (!element) return;

                switch (item.inputType) {
                    case 'ok_avvik': case 'ok_byttet_avvik':
                        const statusButton = element.querySelector(`[data-status="${result.status}"]`);
                        if (statusButton) {
                            statusButton.click();
                            const avvikContainer = element.nextElementSibling;
                            const byttetContainer = avvikContainer ? avvikContainer.nextElementSibling : null;
                            if (result.status === 'avvik' && avvikContainer) avvikContainer.querySelector('textarea').value = result.comment || '';
                            else if ((result.status === 'byttet' || result.status === 'rengjort') && byttetContainer) byttetContainer.querySelector('textarea').value = result.comment || '';
                        }
                        break;
                    case 'numeric': case 'text': case 'textarea':
                        const inputElement = element.querySelector('input, textarea');
                        if (inputElement) inputElement.value = result;
                        break;
                    case 'checkbox':
                        const checkboxElement = element.querySelector('input[type="checkbox"]');
                        if (checkboxElement) {
                            checkboxElement.checked = result;
                            checkboxElement.dispatchEvent(new Event('change'));
                        }
                        break;
                    case 'group_selection':
                        const radioElement = element.querySelector(`input[type="radio"][id="${result}"]`);
                        if (radioElement) radioElement.checked = true;
                        break;
                    case 'switch_select':
                        const selectElement = element.querySelector('select');
                        if (selectElement) selectElement.value = result;
                        break;
                }
                if (item.hasSubpoints && item.subpoints) populateChecklistItem(item.subpoints, checklistData);
            });
        }
        populateChecklistItem(state.checklistTemplate.checklistItems, component.checklist);
    }

    const productContainer = document.getElementById('product-lines-container');
    if (productContainer) {
        productContainer.innerHTML = '';
        if (component.products?.length > 0) component.products.forEach(p => addProductLine(p));
    }

    const workContainer = document.getElementById('additional-work-lines-container');
    if (workContainer) {
        workContainer.innerHTML = '';
        if (component.additionalWork?.length > 0) component.additionalWork.forEach(w => addAdditionalWorkLine(w));
    }

    document.getElementById('new-component-form').scrollIntoView({ behavior: 'smooth' });
}

function updateFinalizeButtonState() { 
    const btn = document.getElementById('finalize-report-btn'); 
    if (!btn) return; 
    const allComponents = state.serviceReport.reportData.components; 
    btn.disabled = !(allComponents.length > 0 && allComponents.every(c => isChecklistComplete(c))); 
}

async function finalizeAnlegg() { 
    if (state.serviceReport.reportData.components.length === 0) return showToast("Du må lagre minst én sjekkliste.", 'error'); 
    setLoading(true); 
    state.serviceReport.reportData.overallComment = document.getElementById('overall-comment').value; 
    try { 
        await api.put(`/servicereports/${state.serviceReport.reportId}`, state.serviceReport); 
        await api.put(`/equipment/${state.equipmentId}`, { serviceStatus: 'completed' }); 
        window.location.href = `orders.html?id=${state.orderId}`; 
    } catch(error) { 
        showToast(`Kunne ikke ferdigstille: ${error.message}`, 'error'); 
        setLoading(false); 
    } 
}

function setLoading(isLoading) { 
    const loader = document.getElementById('loading-indicator'); 
    if (loader) loader.style.display = isLoading ? 'flex' : 'none'; 
}

function showToast(message, type = 'info') { 
    const container = document.getElementById('toast-container') || document.body;
    const notification = document.createElement('div'); 
    notification.className = `toast-notification ${type}`; 
    notification.textContent = message; 
    container.appendChild(notification);
    setTimeout(() => { notification.remove(); }, 3000); 
}

function renderSectionVisibility() {
    const productsContainer = document.getElementById('products-section-container');
    const workContainer = document.getElementById('additional-work-section-container');

    if (productsContainer) {
        productsContainer.style.display = state.checklistTemplate?.allowProducts ? 'block' : 'none';
    }
    if (workContainer) {
        workContainer.style.display = state.checklistTemplate?.allowAdditionalWork ? 'block' : 'none';
    }
}

function addProductLine(product = { name: '', price: '' }) {
    const container = document.getElementById('product-lines-container');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'line-item product-item';
    div.innerHTML = `
        <input type="text" class="line-input product-name" placeholder="Produktnavn" value="${product.name}">
        <input type="number" class="line-input product-price" placeholder="Pris" value="${product.price}">
        <button type="button" class="action-btn-icon" data-action="remove-line">×</button>
    `;
    container.appendChild(div);
}

function addAdditionalWorkLine(work = { description: '', hours: '', price: '' }) {
    const container = document.getElementById('additional-work-lines-container');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'line-item work-item';
    div.innerHTML = `
        <div class="work-item-main">
            <textarea class="line-textarea work-description" placeholder="Beskrivelse" rows="2">${work.description}</textarea>
        </div>
        <div class="work-item-footer">
            <div class="input-group">
                <label>Timer</label>
                <input type="number" class="line-input work-hours" placeholder="0" value="${work.hours}" step="0.5">
            </div>
            <div class="input-group">
                <label>Pris</label>
                <input type="number" class="line-input work-price" placeholder="0" value="${work.price}">
            </div>
            <button type="button" class="action-btn-icon" data-action="remove-line">×</button>
        </div>
    `;
    container.appendChild(div);
}

function renderDriftScheduleSection() {
    const container = document.getElementById('drift-schedule-container');
    if (!container) return;

    if (state.checklistTemplate && state.checklistTemplate.hasDriftSchedule && state.checklistTemplate.driftScheduleConfig) {
        const config = state.checklistTemplate.driftScheduleConfig;
        let tableRowsHTML = config.days.map(day => `
            <tr>
                <td>${day}</td>
                ${config.fields.map(field => `<td><input type="text" class="drift-time-input" data-day="${day}" data-field="${field}" placeholder="${field}"></td>`).join('')}
            </tr>
        `).join('');

        container.innerHTML = `
            <div class="checklist-card">
                <h4 class="card-title">${config.title}</h4>
                <div class="card-body">
                    <table class="drift-schedule-table">
                        <thead><tr><th>Dag</th>${config.fields.map(field => `<th>${field}</th>`).join('')}</tr></thead>
                        <tbody>${tableRowsHTML}</tbody>
                    </table>
                </div>
            </div>`;
        container.style.display = 'block';
    } else {
        container.innerHTML = '';
        container.style.display = 'none';
    }
}

// Debugging function to be called from browser console
window.debugChecklist = async () => {
    console.log('Current state:', state);
    console.log('Trying to load ventilation template...');
    await loadChecklistForFacility('ventilation');
    console.log('State after load:', state);
    console.log('Calling renderAll...');
    renderAll();
};
