// air-tech-app/assets/js/service.js (v11.0 - Full Dynamic Templates)

const state = {
    orderId: null,
    equipmentId: null, 
    equipment: null,
    order: null,
    technician: null,
    serviceReport: { reportData: { components: [] } },
    checklistTemplate: null,
    editingComponentIndex: null
};

const api = {
    async request(endpoint, options = {}) {
        try {
            const response = await fetch(`/api${endpoint}`, {
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                ...options,
                body: options.body ? JSON.stringify(options.body) : null
            });
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || `API-kall feilet: ${response.statusText}`);
            }
            const text = await response.text();
            return text ? JSON.parse(text) : {};
        } catch (error) {
            console.error(`API Error: ${error.message}`);
            throw error;
        }
    },
    get: (endpoint) => api.request(endpoint),
    put: (endpoint, body) => api.request(endpoint, { method: 'PUT', body }),
    post: (endpoint, body) => api.request(endpoint, { method: 'POST', body })
};

// Helper function to get query parameters
function getQueryParam(param) {
    const params = new URLSearchParams(window.location.search);
    return params.get(param);
}

// Generate unique report ID
function generateReportId() {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000);
    return `RPT-${state.orderId}-${state.equipmentId}-${timestamp}-${random}`;
}

// Main initialization function
async function initializePage() {
    setLoading(true);
    
    try {
        // Get params from URL
        state.orderId = getQueryParam('orderId');
        state.equipmentId = getQueryParam('equipmentId');
        
        if (!state.orderId || !state.equipmentId) {
            throw new Error('Mangler ordre ID eller utstyr ID');
        }
        
        console.log('Initializing with:', { orderId: state.orderId, equipmentId: state.equipmentId });
        
        // Load all necessary data in parallel
        const [order, equipment, technician] = await Promise.all([
            loadOrder(state.orderId),
            loadEquipmentData(state.equipmentId),
            loadTechnician()
        ]);
        
        state.order = order;
        state.equipment = equipment;
        state.technician = technician;
        
        // Load or create service report
        await loadServiceReport();
        
        // Setup event listeners
        setupEventListeners();
        
        // Render everything
        renderAll();
        
    } catch (error) {
        console.error('Initialization error:', error);
        showToast(`Feil ved lasting: ${error.message}`, 'error');
    } finally {
        setLoading(false);
    }
}

async function loadOrder(orderId) {
    try {
        const response = await api.get(`/orders/${orderId}`);
        console.log('Order loaded:', response);
        // Handle both direct order response and wrapped response
        const order = response.order || response;
        return order;
    } catch (error) {
        throw new Error(`Kunne ikke laste ordre: ${error.message}`);
    }
}

async function loadTechnician() {
    try {
        const authData = await api.get('/auth/me');
        return authData.technician || { name: 'Ukjent tekniker', initials: 'UT' };
    } catch (error) {
        console.error('Could not load technician:', error);
        return { name: 'Ukjent tekniker', initials: 'UT' };
    }
}

async function loadEquipmentData(equipmentId) {
    try {
        console.log('Loading equipment with ID:', equipmentId);
        
        const equipment = await api.get(`/equipment/by-id/${equipmentId}`);
        console.log('Equipment data loaded:', equipment);
        
        // Normalize type to lowercase
        if (equipment.type) {
            equipment.type = equipment.type.toLowerCase();
        }
        
        // Load checklist based on equipment type
        const facilityType = equipment.data?.facilityType || equipment.type;
        if (facilityType) {
            await loadChecklistForFacility(facilityType.toLowerCase());
        } else {
            console.warn('No facility type found for equipment');
            showToast('Ingen sjekklistetype funnet for dette utstyret', 'warning');
        }
        
        return equipment;
    } catch (error) {
        console.error('Error loading equipment:', error);
        throw new Error(`Kunne ikke laste anlegg: ${error.message}`);
    }
}

async function loadChecklistForFacility(facilityType) {
    console.log('=== LOADING CHECKLIST ===');
    console.log('Facility type:', facilityType);
    
    try {
        const response = await api.get('/checklist-templates');
        console.log('Templates loaded:', response);
        
        if (!response || !response.facilityTypes) {
            throw new Error('Ingen maler funnet');
        }
        
        // Find matching template
        const template = response.facilityTypes.find(t => 
            t.id === facilityType || 
            t.name.toLowerCase() === facilityType.toLowerCase()
        );
        
        if (template) {
            console.log('Found template:', template);
            state.checklistTemplate = template;
        } else {
            console.warn(`No template found for facility type: ${facilityType}`);
            showToast(`Ingen sjekkliste funnet for type: ${facilityType}`, 'warning');
            
            // Create minimal fallback template
            state.checklistTemplate = {
                id: 'fallback',
                name: 'Standard sjekkliste',
                systemFields: [
                    { name: "beskrivelse", label: "Beskrivelse", required: true, order: 1 }
                ],
                checklistItems: [],
                allowProducts: true,
                allowAdditionalWork: true,
                allowComments: true,
                hasDriftSchedule: false
            };
        }
        
        renderSectionVisibility();
        
    } catch (error) {
        console.error('Error loading checklist template:', error);
        showToast('Kunne ikke laste sjekklistemaler', 'error');
    }
}

async function loadServiceReport() {
    try {
        const reportResponse = await api.get(`/reports/equipment/${state.equipmentId}?orderId=${state.orderId}`);
        
        if (reportResponse.id) {
            // Existing report found
            state.serviceReport = {
                reportId: reportResponse.id,
                reportData: reportResponse.report_data || { components: [], overallComment: '' }
            };
            console.log('Loaded existing service report:', state.serviceReport);
        } else {
            // Create new report
            const newReportId = generateReportId();
            state.serviceReport = {
                reportId: newReportId,
                reportData: { components: [], overallComment: '' }
            };
            console.log('Created new service report with ID:', newReportId);
            
            // Note: We'll save the report when user actually saves data, not here
            // This avoids the 500 error on initial load
        }
        
    } catch (error) {
        console.warn('Could not load existing report, creating new:', error.message);
        // Create a new report in memory if loading fails
        const newReportId = generateReportId();
        state.serviceReport = {
            reportId: newReportId,
            reportData: { components: [], overallComment: '' }
        };
        console.log('Created fallback service report');
    }
}

function renderAll() {
    console.log("Rendering all components...");
    renderHeader();
    renderAnleggInfo();
    renderComponentList();
    renderComponentDetailsForm();
    renderChecklist();
    renderSectionVisibility();
    renderDriftScheduleSection();
    resetAndLoadForm();
    
    // Set overall comment if exists
    const overallCommentEl = document.getElementById('overall-comment');
    if (overallCommentEl) {
        overallCommentEl.value = state.serviceReport.reportData.overallComment || '';
    }
    
    updateFinalizeButtonState();
    updatePageFooterVisibility();
}

function renderHeader() {
    const header = document.getElementById('app-header');
    if (!header) {
        console.error('app-header element not found!');
        return;
    }

    const tech = state.technician || {};
    const today = new Date();
    const norwegianMonths = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];
    const dateString = `${today.getDate()}. ${norwegianMonths[today.getMonth()]} ${today.getFullYear()}`;

    header.innerHTML = `
        <a href="orders.html?id=${state.orderId}" class="header-nav-button" title="Tilbake">‹</a>
        <div class="header-main-content">
            <div class="logo-circle">
                <svg width="24" height="24" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="14" stroke="white" stroke-width="2" fill="none"/><circle cx="16" cy="16" r="8" stroke="white" stroke-width="2" fill="none"/><circle cx="16" cy="16" r="3" fill="white"/><path d="M16 2 L16 8" stroke="white" stroke-width="2"/><path d="M16 24 L16 30" stroke="white" stroke-width="2"/><path d="M30 16 L24 16" stroke="white" stroke-width="2"/><path d="M8 16 L2 16" stroke="white" stroke-width="2"/></svg>
            </div>
            <div class="company-info">
                <h1>AIR-TECH AS</h1>
                <span class="app-subtitle">Service gjennomføring</span>
            </div>
        </div>
        <div class="header-user-info">
            <span id="technician-initials">${tech.initials || ''}</span>
            <span id="current-date">${dateString}</span>
        </div>
    `;
}

function renderAnleggInfo() {
    const container = document.getElementById('anlegg-info');
    if (!container || !state.equipment || !state.order) return;
    
    const typeDisplayName = state.equipment.type ? 
        state.equipment.type.charAt(0).toUpperCase() + state.equipment.type.slice(1) : 
        'Ukjent';
    
    // Status mapping
    const statusMap = {
        'not_started': { text: 'Ikke startet', icon: 'clock' },
        'in_progress': { text: 'Under arbeid', icon: 'tool' },
        'completed': { text: 'Ferdigstilt', icon: 'check-circle' }
    };
    
    const currentStatus = statusMap[state.equipment.serviceStatus || 'not_started'];
    
    container.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <h4 class="card-title" style="margin: 0;">Anleggsinformasjon</h4>
            <div class="anlegg-status-indicator ${state.equipment.serviceStatus || 'not_started'}">
                <i data-lucide="${currentStatus.icon}" style="width: 16px; height: 16px;"></i>
                <span>${currentStatus.text}</span>
            </div>
        </div>
        <div class="anlegg-info-grid">
            <div class="info-item">
                <span class="label">Anleggstype</span>
                <span class="value">${typeDisplayName}</span>
            </div>
            <div class="info-item">
                <span class="label">Systemtype</span>
                <span class="value">${state.equipment.systemType || 'Ikke angitt'}</span>
            </div>
            <div class="info-item">
                <span class="label">Systemnummer</span>
                <span class="value">${state.equipment.systemNumber || 'Ikke angitt'}</span>
            </div>
            <div class="info-item">
                <span class="label">Plassering</span>
                <span class="value">${state.equipment.name || 'Ikke angitt'}</span>
            </div>
            <div class="info-item">
                <span class="label">Betjener</span>
                <span class="value">${state.equipment.operator || 'Ikke angitt'}</span>
            </div>
            <div class="info-item">
                <span class="label">Ordrenummer</span>
                <span class="value">${state.order.orderNumber || state.order.id}</span>
            </div>
        </div>
    `;
    
    // Re-initialize lucide icons
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

function renderComponentList() {
    const container = document.getElementById('component-list-container');
    if (!container) return;
    
    const components = state.serviceReport.reportData.components;
    
    if (!components || components.length === 0) {
        container.innerHTML = '<p class="placeholder-text">Ingen sjekklister er lagret.</p>';
        return;
    }
    
    container.innerHTML = components.map((comp, index) => {
        const isComplete = isChecklistComplete(comp);
        const statusClass = isComplete ? 'complete' : 'incomplete';
        const title = getComponentTitle(comp.details);
        
        return `
            <div class="component-summary-card ${statusClass}">
                <div class="info-wrapper" data-action="edit-component" data-index="${index}">
                    <span class="status">
                        <i data-lucide="${isComplete ? 'check-circle-2' : 'alert-circle'}"></i>
                    </span>
                    <span class="info"><strong>${title}</strong></span>
                </div>
                <button class="delete-checklist-btn" data-action="delete-checklist" data-index="${index}" title="Slett sjekkliste">
                    X
                </button>
            </div>
        `;
    }).join('');
    
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }

    // Update footer visibility and button state
    updatePageFooterVisibility();
}

function updatePageFooterVisibility() {
    const overallCommentSection = document.getElementById('overall-comment-section');
    const attachmentsSection = document.getElementById('attachments-section');
    
    const hasComponents = state.serviceReport.reportData.components && 
                         state.serviceReport.reportData.components.length > 0;
    
    // Show additional sections only if there are components
    if (overallCommentSection) {
        overallCommentSection.style.display = hasComponents ? 'block' : 'none';
    }
    if (attachmentsSection) {
        attachmentsSection.style.display = hasComponents ? 'block' : 'none';
    }
    
    // Always update button state
    updateFinalizeButtonState();
}

function getComponentTitle(details) {
    if (!details) return "Ukjent komponent";
    
    // Use fields defined in systemFields
    const fields = state.checklistTemplate?.systemFields || [];
    const titleParts = [];
    
    fields.forEach(field => {
        const value = details[field.name];
        if (value) {
            titleParts.push(value);
        }
    });
    
    if (titleParts.length > 0) {
        return titleParts.join(' - ');
    }
    
    // Fallback to first non-empty value
    const firstValue = Object.values(details).find(v => v && v.toString().trim());
    return firstValue || "Sjekkliste";
}

function renderComponentDetailsForm() {
    console.log("Rendering component details form...");
    const container = document.getElementById('component-details-form');
    if (!container) {
        console.error('component-details-form container not found!');
        return;
    }
    
    if (!state.checklistTemplate) {
        container.innerHTML = '<p class="placeholder-text">Laster sjekklistedetaljer...</p>';
        return;
    }
    
    let formHTML = '';
    
    // Use dynamic systemFields from template
    if (state.checklistTemplate.systemFields && state.checklistTemplate.systemFields.length > 0) {
        const fieldsHtml = state.checklistTemplate.systemFields
            .sort((a, b) => a.order - b.order)
            .map(field => {
                const inputType = field.type === 'textarea' ? 'textarea' : 'input';
                const inputHtml = inputType === 'textarea' ?
                    `<textarea id="comp-${field.name}" class="large-textarea" placeholder="${field.label}" rows="4"></textarea>` :
                    `<input type="text" id="comp-${field.name}" placeholder="${field.label}">`;
                
                return `
                    <div class="form-group">
                        <label for="comp-${field.name}">${field.label}${field.required ? ' *' : ''}</label>
                        ${inputHtml}
                    </div>
                `;
            }).join('');
        
        formHTML = `<div class="component-grid">${fieldsHtml}</div>`;
    } else {
        // Minimal fallback
        formHTML = `
            <div class="form-group">
                <label>Beskrivelse</label>
                <textarea id="comp-beskrivelse" class="large-textarea" placeholder="Beskriv hva som er sjekket/gjort..." rows="4"></textarea>
            </div>
        `;
    }
    
    container.innerHTML = formHTML;
}

function renderChecklist() {
    console.log('Rendering checklist...');
    const container = document.getElementById('checklist-items-container');
    if (!container) {
        console.error("Container 'checklist-items-container' not found!");
        return;
    }
    
    // Check if there are checklist items in the template
    const hasChecklistItems = state.checklistTemplate?.checklistItems && 
                             state.checklistTemplate.checklistItems.length > 0;
    
    container.style.display = hasChecklistItems ? 'block' : 'none';
    
    // Hide/show header too
    const header = container.previousElementSibling;
    if (header && header.classList.contains('card-title')) {
        header.style.display = hasChecklistItems ? 'block' : 'none';
    }
    
    if (!hasChecklistItems) {
        container.innerHTML = '';
        return;
    }
    
    // Render checklist items
    const itemsHTML = state.checklistTemplate.checklistItems
        .sort((a, b) => a.order - b.order)
        .map(item => createChecklistItemHTML(item))
        .join('');
    
    container.innerHTML = itemsHTML;
    
    // Initialize lucide icons if available
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

function createChecklistItemHTML(item) {
    // Fiks for gamle datastrukturer som mangler inputType og har 'text' i stedet for 'label'
    if (!item.inputType) {
        // console.warn(`Missing inputType for item: ${item.id}, defaulting to 'ok_avvik'`);
        item.inputType = 'ok_avvik'; // Standard fallback
    }
    
    // Fiks for gamle datastrukturer som har 'text' i stedet for 'label'
    if (item.text && !item.label) {
        item.label = item.text;
    }
    
    // Sørg for at vi har en label
    if (!item.label) {
        item.label = item.text || `Sjekkpunkt ${item.id}`;
    }

    switch (item.inputType) {
        case 'ok_avvik':
            return createOkAvvikItemHTML(item);
        case 'ok_byttet_avvik':
            return createOkByttetAvvikItemHTML(item);
        case 'numeric':
            return createNumberItemHTML(item);
        case 'text':
            return createTextItemHTML(item);
        case 'textarea':
            return createTextareaItemHTML(item);
        case 'checkbox':
            return createCheckboxItemHTML(item);
        case 'group_selection':
            return createGroupSelectionItemHTML(item);
        case 'switch_select':
            return createSwitchSelectHTML(item);
        case 'comment':
            return createCommentItemHTML(item);
        default:
            console.warn(`Unknown input type: ${item.inputType} for item:`, item);
            // Fallback til OK/Avvik for ukjente typer
            return createOkAvvikItemHTML(item);
    }
}

// Checklist item HTML generators
function createOkAvvikItemHTML(item) {
    const buttonsHTML = `
        <button type="button" class="status-btn ok" data-status="ok">OK</button>
        <button type="button" class="status-btn avvik" data-status="avvik">Avvik</button>
    `;
    
    return `
        <div class="checklist-item" data-item-id="${item.id}" data-item-type="ok_avvik">
            <span class="item-label">${item.label}</span>
            <div class="item-actions">${buttonsHTML}</div>
        </div>
        <div class="avvik-container" id="avvik-${item.id}">
            <textarea placeholder="Beskriv avvik..."></textarea>
            <button type="button" class="action-btn-secondary">
                <i data-lucide="camera"></i>Ta bilde
            </button>
        </div>
    `;
}

function createOkByttetAvvikItemHTML(item) {
    const buttonsHTML = `
        <button type="button" class="status-btn ok" data-status="ok">OK</button>
        <button type="button" class="status-btn byttet" data-status="byttet">Byttet</button>
        <button type="button" class="status-btn rengjort" data-status="rengjort">Rengjort</button>
        <button type="button" class="status-btn avvik" data-status="avvik">Avvik</button>
    `;
    
    return `
        <div class="checklist-item" data-item-id="${item.id}" data-item-type="ok_byttet_avvik">
            <span class="item-label">${item.label}</span>
            <div class="item-actions">${buttonsHTML}</div>
        </div>
        <div class="avvik-container" id="avvik-${item.id}">
            <textarea placeholder="Beskriv avvik..."></textarea>
            <button type="button" class="action-btn-secondary">
                <i data-lucide="camera"></i>Ta bilde
            </button>
        </div>
        <div class="byttet-container" id="byttet-${item.id}">
            <textarea placeholder="Kommentar..."></textarea>
            <button type="button" class="action-btn-secondary">
                <i data-lucide="camera"></i>Ta bilde
            </button>
        </div>
    `;
}

function createNumberItemHTML(item) {
    return `
        <div class="checklist-item" data-item-id="${item.id}" data-item-type="numeric">
            <label class="item-label" for="input-${item.id}">${item.label}</label>
            <input type="text" id="input-${item.id}" inputmode="numeric" class="checklist-input-number" />
        </div>
    `;
}

function createTextItemHTML(item) {
    return `
        <div class="checklist-item" data-item-id="${item.id}" data-item-type="text">
            <label class="item-label" for="input-${item.id}">${item.label}</label>
            <input type="text" id="input-${item.id}" class="checklist-input-text" />
        </div>
    `;
}

function createTextareaItemHTML(item) {
    return `
        <div class="checklist-item-fullwidth" data-item-id="${item.id}" data-item-type="textarea">
            <label class="item-label" for="input-${item.id}">${item.label}</label>
            <textarea id="input-${item.id}" class="checklist-input-textarea"></textarea>
        </div>
    `;
}

function createCheckboxItemHTML(item) {
    return `
        <div class="form-check checklist-item" data-item-id="${item.id}" data-item-type="checkbox">
            <input class="form-check-input" type="checkbox" id="${item.id}" name="${item.id}">
            <label class="form-check-label" for="${item.id}">${item.label}</label>
        </div>
    `;
}

function createGroupSelectionItemHTML(item) {
    const subpointsHTML = item.subpoints
        .sort((a, b) => a.order - b.order)
        .map(subItem => `
            <div class="form-check checklist-item" data-item-id="${subItem.id}" data-item-type="radio" data-group="${subItem.exclusiveGroup}">
                <input class="form-check-input" type="radio" name="${subItem.exclusiveGroup}" id="${subItem.id}">
                <label class="form-check-label" for="${subItem.id}">${subItem.label}</label>
            </div>
        `).join('');
    
    return `
        <div class="checklist-item-group" data-group-id="${item.id}">
            <span class="item-label">${item.label}</span>
            <div class="sub-checklist-items">${subpointsHTML}</div>
        </div>
    `;
}

function createSwitchSelectHTML(item) {
    const options = ['Auto', 'Sommer', 'Vinter', 'Av', 'På'];
    const optionsHTML = options.map(opt => `<option value="${opt}">${opt}</option>`).join('');
    
    return `
        <div class="checklist-item-fullwidth" data-item-id="${item.id}" data-item-type="switch_select">
            <label class="item-label" for="select-${item.id}">${item.label}</label>
            <select id="select-${item.id}" class="checklist-input-select">
                <option value="">Velg status...</option>
                ${optionsHTML}
            </select>
        </div>
    `;
}

function createCommentItemHTML(item) {
    // Comment type is typically just a textarea
    return `
        <div class="checklist-item-fullwidth" data-item-id="${item.id}" data-item-type="comment">
            <label class="item-label" for="comment-${item.id}">${item.label}</label>
            <textarea id="comment-${item.id}" class="checklist-input-textarea" 
                      placeholder="${item.placeholder || 'Skriv kommentar her...'}"></textarea>
        </div>
    `;
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

function renderDriftScheduleSection() {
    const container = document.getElementById('drift-schedule-container');
    if (!container) return;
    
    if (state.checklistTemplate?.hasDriftSchedule && state.checklistTemplate.driftScheduleConfig) {
        const config = state.checklistTemplate.driftScheduleConfig;
        let tableRowsHTML = config.days.map(day => `
            <tr>
                <td>${day}</td>
                ${config.fields.map(field => `
                    <td>
                        <input type="text" class="drift-time-input" 
                               data-day="${day}" 
                               data-field="${field}" 
                               placeholder="${field}">
                    </td>
                `).join('')}
            </tr>
        `).join('');
        
        container.innerHTML = `
            <div class="checklist-card">
                <h4 class="card-title">${config.title}</h4>
                <div class="card-body">
                    <table class="drift-schedule-table">
                        <thead>
                            <tr>
                                <th>Dag</th>
                                ${config.fields.map(field => `<th>${field}</th>`).join('')}
                            </tr>
                        </thead>
                        <tbody>${tableRowsHTML}</tbody>
                    </table>
                </div>
            </div>
        `;
        container.style.display = 'block';
    } else {
        container.innerHTML = '';
        container.style.display = 'none';
    }
}

function resetAndLoadForm(isEditing = false) {
    if (!isEditing) {
        state.editingComponentIndex = null;
    }
    
    // Reset form
    const form = document.getElementById('component-form');
    if (form) {
        form.reset();
    }
    
    // Clear product and work lines
    const productContainer = document.getElementById('product-lines-container');
    if (productContainer) productContainer.innerHTML = '';
    
    const workContainer = document.getElementById('additional-work-lines-container');
    if (workContainer) workContainer.innerHTML = '';
    
    // Reset checklist buttons
    const checklistContainer = document.getElementById('checklist-items-container');
    if (checklistContainer) {
        checklistContainer.querySelectorAll('.status-btn.active').forEach(btn => btn.classList.remove('active'));
        checklistContainer.querySelectorAll('.avvik-container.show, .byttet-container.show').forEach(el => el.classList.remove('show'));
    }
    
    // Load data if editing
    if (state.editingComponentIndex !== null) {
        loadChecklistForEditing(state.editingComponentIndex);
    }
}

function loadChecklistForEditing(index) {
    const component = state.serviceReport.reportData.components[index];
    if (!component) return;
    
    // Load system fields
    if (component.details) {
        Object.entries(component.details).forEach(([key, value]) => {
            const input = document.getElementById(`comp-${key}`);
            if (input) input.value = value;
        });
    }
    
    // Load checklist items
    if (component.checklist && state.checklistTemplate?.checklistItems) {
        populateChecklistItems(state.checklistTemplate.checklistItems, component.checklist);
    }
    
    // Load products
    if (component.products?.length > 0) {
        component.products.forEach(product => addProductLine(product));
    }
    
    // Load additional work
    if (component.additionalWork?.length > 0) {
        component.additionalWork.forEach(work => addAdditionalWorkLine(work));
    }
    
    // Load drift schedule
    if (component.driftSchedule) {
        Object.entries(component.driftSchedule).forEach(([day, times]) => {
            Object.entries(times).forEach(([field, value]) => {
                const input = document.querySelector(`input[data-day="${day}"][data-field="${field}"]`);
                if (input) input.value = value;
            });
        });
    }
}

function populateChecklistItems(items, checklistData) {
    items.forEach(item => {
        const result = checklistData[item.id];
        if (!result) return;
        
        const element = document.querySelector(`[data-item-id="${item.id}"]`);
        if (!element) return;
        
        switch (item.inputType) {
            case 'ok_avvik':
            case 'ok_byttet_avvik':
                if (result.status) {
                    const statusButton = element.querySelector(`[data-status="${result.status}"]`);
                    if (statusButton) {
                        statusButton.click();
                        
                        if (result.status === 'avvik' && result.comment) {
                            const avvikContainer = element.nextElementSibling;
                            if (avvikContainer) {
                                const textarea = avvikContainer.querySelector('textarea');
                                if (textarea) textarea.value = result.comment;
                            }
                        }
                        
                        if ((result.status === 'byttet' || result.status === 'rengjort') && result.comment) {
                            const byttetContainer = document.getElementById(`byttet-${item.id}`);
                            if (byttetContainer) {
                                const textarea = byttetContainer.querySelector('textarea');
                                if (textarea) textarea.value = result.comment;
                            }
                        }
                    }
                }
                break;
                
            case 'numeric':
            case 'text':
            case 'textarea':
                const input = document.getElementById(`input-${item.id}`);
                if (input) input.value = result;
                break;
                
            case 'comment':
                const commentInput = document.getElementById(`comment-${item.id}`);
                if (commentInput) commentInput.value = result;
                break;
                
            case 'checkbox':
                const checkbox = document.getElementById(item.id);
                if (checkbox) checkbox.checked = !!result;
                break;
                
            case 'switch_select':
                const select = document.getElementById(`select-${item.id}`);
                if (select) select.value = result;
                break;
        }
        
        // Handle subpoints recursively
        if (item.hasSubpoints && item.subpoints) {
            populateChecklistItems(item.subpoints, checklistData);
        }
    });
}

function setupEventListeners() {
    // Form submission
    const form = document.getElementById('component-form');
    if (form) {
        form.addEventListener('submit', saveChecklist);
    }
    
    // Status buttons
    document.getElementById('checklist-items-container')?.addEventListener('click', handleStatusClick);
    
    // Finalize button
    document.getElementById('finalize-report-btn')?.addEventListener('click', finalizeAnlegg);
    
    // Component list actions
    document.getElementById('component-list')?.addEventListener('click', handleComponentListClick);
    
    // Dynamic lines (products/work)
    document.getElementById('new-component-form')?.addEventListener('click', handleDynamicLineClick);
}

function handleStatusClick(e) {
    const button = e.target.closest('.status-btn');
    if (!button) return;
    
    const parent = button.parentElement;
    const itemElement = button.closest('.checklist-item');
    const itemId = itemElement.dataset.itemId;
    
    // Toggle active state
    if (button.classList.contains('active')) {
        button.classList.remove('active');
    } else {
        parent.querySelectorAll('.status-btn').forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
    }
    
    // Handle avvik/byttet containers
    const avvikContainer = document.getElementById(`avvik-${itemId}`);
    const byttetContainer = document.getElementById(`byttet-${itemId}`);
    
    if (avvikContainer) {
        avvikContainer.classList.toggle('show', 
            button.dataset.status === 'avvik' && button.classList.contains('active')
        );
    }
    
    if (byttetContainer) {
        byttetContainer.classList.toggle('show', 
            (button.dataset.status === 'byttet' || button.dataset.status === 'rengjort') && 
            button.classList.contains('active')
        );
    }
}

function handleComponentListClick(e) {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    
    const action = target.dataset.action;
    const index = parseInt(target.dataset.index, 10);
    
    if (action === 'edit-component') {
        state.editingComponentIndex = index;
        resetAndLoadForm(true);
        
        // Scroll to form
        document.getElementById('new-component-form')?.scrollIntoView({ behavior: 'smooth' });
    } else if (action === 'delete-checklist') {
        if (confirm('Er du sikker på at du vil slette denne sjekklisten?')) {
            deleteChecklist(index);
        }
    }
}

function handleDynamicLineClick(e) {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    
    const action = target.dataset.action;
    
    if (action === 'add-product-line') {
        addProductLine();
    } else if (action === 'add-work-line') {
        addAdditionalWorkLine();
    } else if (action === 'remove-line') {
        if (confirm('Er du sikker på at du vil fjerne denne linjen?')) {
            target.closest('.product-item, .work-item').remove();
        }
    }
}

async function saveChecklist(e) {
    e.preventDefault();
    
    // Validate system fields
    const hasSystemFields = state.checklistTemplate?.systemFields && 
                           state.checklistTemplate.systemFields.length > 0;
    
    if (hasSystemFields) {
        for (const field of state.checklistTemplate.systemFields) {
            if (field.required) {
                const input = document.getElementById(`comp-${field.name}`);
                if (!input || input.value.trim() === '') {
                    showToast(`${field.label} må fylles ut før du kan lagre.`, 'error');
                    return;
                }
            }
        }
    }
    
    setLoading(true);
    
    // Collect all form data
    const componentData = collectComponentData();
    
    // Add or update component
    if (state.editingComponentIndex === null) {
        state.serviceReport.reportData.components.push(componentData);
    } else {
        state.serviceReport.reportData.components[state.editingComponentIndex] = componentData;
    }
    
    try {
        // Save to server - include all required fields
        await api.put(`/servicereports/${state.serviceReport.reportId}`, {
            orderId: state.orderId,
            equipmentId: state.equipmentId,
            reportData: state.serviceReport.reportData
        });
        
        // Update equipment status if needed
        if (state.equipment.serviceStatus === 'not_started') {
            await api.put(`/equipment/${state.equipmentId}`, { serviceStatus: 'in_progress' });
            state.equipment.serviceStatus = 'in_progress';
        }
        
        // Reset form and update UI
        state.editingComponentIndex = null;
        resetAndLoadForm();
        renderComponentList();
        updatePageFooterVisibility();
        updateFinalizeButtonState();
        showToast('Sjekkliste lagret!', 'success');
        
    } catch (error) {
        showToast(`Kunne ikke lagre: ${error.message}`, 'error');
    } finally {
        setLoading(false);
    }
}

function collectComponentData() {
    const componentData = {
        details: {},
        checklist: {},
        products: [],
        additionalWork: [],
        driftSchedule: {}
    };
    
    // Collect system fields
    if (state.checklistTemplate?.systemFields) {
        state.checklistTemplate.systemFields.forEach(field => {
            const input = document.getElementById(`comp-${field.name}`);
            if (input) {
                componentData.details[field.name] = input.value;
            }
        });
    }
    
    // Collect checklist data
    if (state.checklistTemplate?.checklistItems) {
        componentData.checklist = collectChecklistData(state.checklistTemplate.checklistItems);
    }
    
    // Collect products
    componentData.products = Array.from(document.querySelectorAll('#product-lines-container .product-item'))
        .map(line => ({
            name: line.querySelector('.product-name').value.trim(),
            price: parseFloat(line.querySelector('.product-price').value) || 0
        }))
        .filter(p => p.name || p.price > 0);
    
    // Collect additional work
    componentData.additionalWork = Array.from(document.querySelectorAll('#additional-work-lines-container .work-item'))
        .map(line => ({
            description: line.querySelector('.work-description').value.trim(),
            hours: parseFloat(line.querySelector('.work-hours').value) || 0,
            price: parseFloat(line.querySelector('.work-price').value) || 0
        }))
        .filter(w => w.description || w.hours > 0 || w.price > 0);
    
    // Collect drift schedule
    if (state.checklistTemplate?.hasDriftSchedule) {
        document.querySelectorAll('.drift-time-input').forEach(input => {
            const day = input.dataset.day;
            const field = input.dataset.field;
            const value = input.value.trim();
            
            if (value) {
                if (!componentData.driftSchedule[day]) {
                    componentData.driftSchedule[day] = {};
                }
                componentData.driftSchedule[day][field] = value;
            }
        });
    }
    
    return componentData;
}

function collectChecklistData(items) {
    const data = {};
    
    items.forEach(item => {
        const element = document.querySelector(`[data-item-id="${item.id}"]`);
        if (!element) return;
        
        let value = null;
        
        switch (item.inputType) {
            case 'ok_avvik':
            case 'ok_byttet_avvik':
                const activeBtn = element.querySelector('.status-btn.active');
                if (activeBtn) {
                    value = { status: activeBtn.dataset.status };
                    
                    if (activeBtn.dataset.status === 'avvik') {
                        const avvikContainer = document.getElementById(`avvik-${item.id}`);
                        const comment = avvikContainer?.querySelector('textarea')?.value;
                        if (comment) value.comment = comment;
                    }
                    
                    if (activeBtn.dataset.status === 'byttet' || activeBtn.dataset.status === 'rengjort') {
                        const byttetContainer = document.getElementById(`byttet-${item.id}`);
                        const comment = byttetContainer?.querySelector('textarea')?.value;
                        if (comment) value.comment = comment;
                    }
                }
                break;
                
            case 'numeric':
            case 'text':
            case 'textarea':
                const input = document.getElementById(`input-${item.id}`);
                if (input) value = input.value;
                break;
                
            case 'comment':
                const commentInput = document.getElementById(`comment-${item.id}`);
                if (commentInput) value = commentInput.value;
                break;
                
            case 'checkbox':
                const checkbox = document.getElementById(item.id);
                if (checkbox) value = checkbox.checked;
                break;
                
            case 'group_selection':
                const selectedRadio = element.querySelector('input[type="radio"]:checked');
                if (selectedRadio) value = selectedRadio.id;
                break;
                
            case 'switch_select':
                const select = element.querySelector('select');
                if (select) value = select.value;
                break;
        }
        
        if (value !== null && value !== '') {
            data[item.id] = value;
        }
        
        // Handle subpoints
        if (item.hasSubpoints && item.subpoints) {
            const subData = collectChecklistData(item.subpoints);
            Object.assign(data, subData);
        }
    });
    
    return data;
}

async function deleteChecklist(index) {
    setLoading(true);
    
    state.serviceReport.reportData.components.splice(index, 1);
    
    try {
        await api.put(`/servicereports/${state.serviceReport.reportId}`, {
            orderId: state.orderId,
            equipmentId: state.equipmentId,
            reportData: state.serviceReport.reportData
        });
        renderComponentList();
        updatePageFooterVisibility();
        updateFinalizeButtonState();
        showToast('Sjekkliste slettet', 'success');
    } catch (error) {
        showToast(`Sletting feilet: ${error.message}`, 'error');
    } finally {
        setLoading(false);
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
                <input type="number" class="line-input work-hours" placeholder="0" value="${work.hours}">
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

function isChecklistComplete(component) {
    if (!component) return false;
    
    // Check system fields
    const systemFields = state.checklistTemplate?.systemFields || [];
    for (const field of systemFields) {
        if (field.required) {
            const value = component.details?.[field.name];
            if (!value || value.toString().trim() === '') {
                return false;
            }
        }
    }
    
    // If no checklist items, we're done
    if (!state.checklistTemplate?.checklistItems || 
        state.checklistTemplate.checklistItems.length === 0) {
        return true;
    }
    
    // Check checklist items
    if (!component.checklist) return false;
    
    return checkChecklistItemCompletion(state.checklistTemplate.checklistItems, component.checklist);
}

function checkChecklistItemCompletion(items, checklistData) {
    for (const item of items) {
        const result = checklistData[item.id];
        
        if (item.required) {
            switch (item.inputType) {
                case 'ok_avvik':
                case 'ok_byttet_avvik':
                    if (!result || !result.status) return false;
                    if ((result.status === 'avvik' || result.status === 'byttet' || result.status === 'rengjort') && 
                        (!result.comment || result.comment.trim() === '')) {
                        return false;
                    }
                    break;
                    
                case 'numeric':
                case 'text':
                case 'textarea':
                case 'comment':
                    // Comments are typically optional unless specifically marked as required
                    if (item.required && (result === undefined || result === null || String(result).trim() === '')) {
                        return false;
                    }
                    break;
                    
                case 'checkbox':
                    if (result === undefined || result === null) return false;
                    break;
                    
                case 'group_selection':
                    if (!item.subpoints || item.subpoints.length === 0) return false;
                    const anySubpointComplete = item.subpoints.some(subItem => 
                        checklistData[subItem.id] !== undefined && checklistData[subItem.id] !== null
                    );
                    if (!anySubpointComplete) return false;
                    break;
                    
                case 'switch_select':
                    if (!result || String(result).trim() === '') return false;
                    break;
            }
        }
        
        // Check subpoints if needed
        if (item.hasSubpoints && item.subpoints && 
            (item.inputType !== 'checkbox' || result === true)) {
            if (!checkChecklistItemCompletion(item.subpoints, checklistData)) {
                return false;
            }
        }
    }
    
    return true;
}

function updateFinalizeButtonState() {
    const finalizeBtn = document.getElementById('finalize-report-btn');
    if (!finalizeBtn) return;
    
    const allComponents = state.serviceReport.reportData.components || [];
    const hasComponents = allComponents.length > 0;
    
    // Button is enabled only if there are components
    finalizeBtn.disabled = !hasComponents;
    
    // Update button text based on equipment status
    const btnIcon = finalizeBtn.querySelector('i');
    const btnText = finalizeBtn.querySelector('span') || finalizeBtn;
    
    if (state.equipment?.serviceStatus === 'completed') {
        btnText.textContent = 'Anlegg er ferdigstilt';
        finalizeBtn.style.backgroundColor = '#28a745';
        finalizeBtn.style.borderColor = '#28a745';
    } else {
        btnText.textContent = 'Ferdigstill Anlegg';
        // Color is handled by CSS based on disabled state
    }
}

async function finalizeAnlegg() {
    if (state.serviceReport.reportData.components.length === 0) {
        showToast("Du må lagre minst én sjekkliste.", 'error');
        return;
    }
    
    setLoading(true);
    
    // Save overall comment
    const overallComment = document.getElementById('overall-comment')?.value || '';
    state.serviceReport.reportData.overallComment = overallComment;
    
    try {
        // Save final report with all required fields
        await api.put(`/servicereports/${state.serviceReport.reportId}`, {
            orderId: state.orderId,
            equipmentId: state.equipmentId,
            reportData: state.serviceReport.reportData
        });
        
        // Update equipment status
        await api.put(`/equipment/${state.equipmentId}`, { serviceStatus: 'completed' });

        // Update UI to reflect new status
        state.equipment.serviceStatus = 'completed';
        updateFinalizeButtonState();
        
        // Oppdater lokal state også
        state.equipment.serviceStatus = 'completed';
        updateFinalizeButtonState();

        // Vis melding før navigering
        showToast('Anlegg ferdigstilt!', 'success');

        // Vent litt før navigering så bruker ser meldingen
        setTimeout(() => {
            window.location.href = `orders.html?id=${state.orderId}`;
        }, 1000);
        
    } catch (error) {
        showToast(`Kunne ikke ferdigstille: ${error.message}`, 'error');
        setLoading(false);
    }
}

function setLoading(isLoading) {
    const loader = document.getElementById('loading-indicator');
    if (loader) {
        loader.style.display = isLoading ? 'flex' : 'none';
    }
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container') || document.body;
    const notification = document.createElement('div');
    notification.className = `toast-notification ${type}`;
    notification.textContent = message;
    container.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    console.log('Service page: DOM loaded');
    
    // Wait for auth
    if (window.authManager) {
        await window.authManager.waitForInitialization();
        
        if (!window.authManager.isLoggedIn()) {
            console.log("Not logged in, redirecting...");
            window.location.href = '/login.html';
            return;
        }
    } else {
        console.error('authManager not found!');
        window.location.href = '/login.html';
        return;
    }
    
    try {
        await initializePage();
    } catch (error) {
        console.error('Critical initialization error:', error);
        showToast('Kunne ikke laste siden: ' + error.message, 'error');
    }
});

// Export for debugging
window.debugService = {
    state,
    reloadTemplate: () => loadChecklistForFacility(state.equipment?.type || 'custom'),
    renderAll
};