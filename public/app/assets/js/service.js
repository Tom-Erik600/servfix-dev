// Global state for change tracking
const changeTracker = {
    hasUnsavedChanges: false,
    uploadedImages: [], // Buffer for bilder før lagring
    originalData: null
};

// Mark form as dirty when changes occur
function markFormAsDirty() {
    changeTracker.hasUnsavedChanges = true;
    console.log('📝 Form marked as dirty');
}

// Auto-detect changes in overall comment
function setupOverallCommentDetection() {
    const overallCommentField = document.getElementById('overall-comment');
    if (overallCommentField) {
        overallCommentField.addEventListener('input', markFormAsDirty);
        overallCommentField.addEventListener('change', markFormAsDirty);
    }
}
// Mark form as clean after successful save
function markFormAsClean() {
    changeTracker.hasUnsavedChanges = false;
    changeTracker.uploadedImages = [];
    updateSaveButtonState();
}

// Update save button to show unsaved state
function updateSaveButtonState() {
    const saveBtn = document.getElementById('save-component-btn');
    if (saveBtn) {
        if (changeTracker.hasUnsavedChanges) {
            saveBtn.style.background = '#ff6b35'; // Orange for unsaved
            saveBtn.textContent = '💾 Lagre endringer *';
        } else {
            saveBtn.style.background = '#28a745'; // Green for saved
            saveBtn.textContent = '💾 Lagre sjekkliste';
        }
    }
}

// Navigation guard
window.addEventListener('beforeunload', function(e) {
    if (changeTracker.hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = 'Du har ulagrede endringer. Er du sikker på at du vil forlate siden?';
        return e.returnValue;
    }
});

// Custom navigation guard for internal links
function confirmNavigation(targetUrl) {
    if (!changeTracker.hasUnsavedChanges) {
        window.location.href = targetUrl;
        return;
    }
    
    showSavePrompt(targetUrl);
}

// Elegant save prompt
function showSavePrompt(targetUrl = null) {
    // Remove existing modal
    const existingModal = document.getElementById('save-prompt-modal');
    if (existingModal) {
        existingModal.remove();
    }
    
    const modal = document.createElement('div');
    modal.id = 'save-prompt-modal';
    modal.innerHTML = `
        <div>
            <h3>🚨 Ulagrede endringer</h3>
            <p>Du har gjort endringer som ikke er lagret. Hva vil du gjøre?</p>
            
            <button onclick="saveAndContinue('${targetUrl || ''}')">
                💾 Lagre og fortsett
            </button>
            <button onclick="discardAndContinue('${targetUrl || ''}')">
                🗑️ Forkast endringer
            </button>
            <button onclick="cancelNavigation()">
                ❌ Avbryt
            </button>
        </div>
    `;
    
    document.body.appendChild(modal);
}

// Show save prompt modal
function showSavePrompt(targetUrl = null) {
    const modal = document.createElement('div');
    modal.id = 'save-prompt-modal';
    modal.innerHTML = `
        <div style="
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.7); display: flex; align-items: center;
            justify-content: center; z-index: 10000;">
            <div style="
                background: white; border-radius: 12px; padding: 24px;
                max-width: 500px; width: 90%; text-align: center;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);">
                
                <h3 style="margin: 0 0 16px 0; color: #ff6b35;">🚨 Ulagrede endringer</h3>
                <p style="margin: 0 0 20px 0; color: #666; line-height: 1.5;">
                    Du har gjort endringer som ikke er lagret. Hva vil du gjøre?
                </p>
                
                <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
                    <button onclick="saveAndContinue('${targetUrl || ''}')" style="
                        padding: 10px 16px; border: none; border-radius: 6px;
                        background: #28a745; color: white; cursor: pointer;
                        font-weight: 500;">
                        💾 Lagre og fortsett
                    </button>
                    <button onclick="discardAndContinue('${targetUrl || ''}')" style="
                        padding: 10px 16px; border: none; border-radius: 6px;
                        background: #dc3545; color: white; cursor: pointer;
                        font-weight: 500;">
                        🗑️ Forkast endringer
                    </button>
                    <button onclick="cancelNavigation()" style="
                        padding: 10px 16px; border: none; border-radius: 6px;
                        background: #6c757d; color: white; cursor: pointer;
                        font-weight: 500;">
                        ❌ Avbryt
                    </button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

// Save and continue navigation
// Save and continue navigation
async function saveAndContinue(targetUrl) {
    const isValid = validateRequiredFields();
    
    if (!isValid) {
        showToast('❌ Fyll ut alle obligatoriske felter før lagring', 'error');
        return;
    }
    
    try {
        // 1. Lagre sjekklisten (hvis det er en aktiv sjekkliste)
        const hasActiveComponent = state.editingComponentIndex !== null || 
                                 document.querySelector('#component-form [name="etasje"]')?.value;
        
        if (hasActiveComponent) {
            await saveComponent();
        }
        
        // 2. Lagre "Øvrige kommentarer til rapport"
        const overallComment = document.getElementById('overall-comment')?.value || '';
        if (overallComment.trim() !== '') {
            state.serviceReport.reportData.overallComment = overallComment;
            
            await api.put(`/reports/${state.serviceReport.reportId}`, {
                orderId: state.orderId,
                equipmentId: state.equipmentId,
                reportData: state.serviceReport.reportData
            });
            
            console.log('💬 Overall comment saved:', overallComment);
        }
        
        // 3. Bilder er allerede lagret når de ble lastet opp, så ingen ekstra handling trengs
        
        // 4. Merk som clean og naviger
        markFormAsClean();
        closeSavePrompt();
        
        showToast('✅ Alt er lagret!', 'success');
        
        if (targetUrl && targetUrl !== 'null' && targetUrl !== '') {
            setTimeout(() => {
                window.location.href = targetUrl;
            }, 1000);
        }
        
    } catch (error) {
        console.error('Error in saveAndContinue:', error);
        showToast('❌ Kunne ikke lagre: ' + error.message, 'error');
    }
}
window.saveAndContinue = saveAndContinue;

window.discardAndContinue = function(targetUrl) {
    // TODO: Delete uploaded images from GCS if not saved
    markFormAsClean();
    closeSavePrompt();
    
    if (targetUrl && targetUrl !== 'null' && targetUrl !== '') {
        window.location.href = targetUrl;
    }
};

window.cancelNavigation = function() {
    closeSavePrompt();
};
// Discard changes and continue
window.discardAndContinue = function(targetUrl) {
    markFormAsClean();
    closeSavePrompt();
    
    if (targetUrl && targetUrl !== '' && targetUrl !== 'null') {
        window.location.href = targetUrl;
    }
};

// Cancel navigation
window.cancelNavigation = function() {
    closeSavePrompt();
};

// Close save prompt modal
function closeSavePrompt() {
    const modal = document.getElementById('save-prompt-modal');
    if (modal) {
        modal.remove();
    }
}

// Validate required fields
function validateRequiredFields() {
    const requiredFields = ['etasje', 'leilighet_nr', 'aggregat_type', 'system_nummer'];
    
    for (const fieldName of requiredFields) {
        const field = document.querySelector(`[name="${fieldName}"], #${fieldName}`);
        if (!field || !field.value || field.value.trim() === '') {
            field?.focus();
            return false;
        }
    }
    
    return true;
}

// Show preview of uploaded but unsaved images
function showUploadedImagesPreview() {
    const container = document.getElementById('unsaved-images-preview');
    if (!container || changeTracker.uploadedImages.length === 0) {
        return;
    }
    
    container.innerHTML = `
        <p><strong>Opplastede bilder som ikke er lagret:</strong></p>
        <div class="unsaved-images-grid">
            ${changeTracker.uploadedImages.map(img => `
                <div class="unsaved-image-item">
                    <img src="${img.url}" alt="${img.type}" style="width: 60px; height: 45px; object-fit: cover;">
                    <span>${img.type}</span>
                </div>
            `).join('')}
        </div>
    `;
}

// Save and continue navigation
async function saveAndContinue(targetUrl) {
    console.log('💾 Lagrer og fortsetter...');
    
    try {
        // 1. Lagre "Øvrige kommentarer til rapport" hvis det finnes
        const overallComment = document.getElementById('overall-comment')?.value || '';
        if (overallComment.trim() !== '') {
            state.serviceReport.reportData.overallComment = overallComment;
            
            await api.put(`/reports/${state.serviceReport.reportId}`, {
                orderId: state.orderId,
                equipmentId: state.equipmentId,
                reportData: state.serviceReport.reportData
            });
            
            console.log('💬 Overall comment saved:', overallComment);
        }
        
        // 2. Bilder er allerede lagret når de ble lastet opp
        // 3. Sjekklister er allerede lagret når de ble lagret
        // 4. Alt annet er allerede lagret
        
        // Merk som clean og naviger
        markFormAsClean();
        closeSavePrompt();
        
        showToast('✅ Alt lagret!', 'success');
        
        if (targetUrl && targetUrl !== 'null' && targetUrl !== '') {
            setTimeout(() => {
                window.location.href = targetUrl;
            }, 800);
        }
        
    } catch (error) {
        console.error('Error in saveAndContinue:', error);
        showToast('❌ Kunne ikke lagre: ' + error.message, 'error');
    }
}
// Discard changes and continue
function discardAndContinue(targetUrl) {
    // TODO: Delete uploaded images from GCS if not saved
    markFormAsClean();
    closeSavePrompt();
    
    if (targetUrl && targetUrl !== 'null') {
        window.location.href = targetUrl;
    }
}

// Cancel navigation
function cancelNavigation() {
    closeSavePrompt();
}

// Close save prompt modal
function closeSavePrompt() {
    const modal = document.querySelector('.save-prompt-modal');
    if (modal) {
        modal.remove();
    }
}

// Validate required fields
function validateRequiredFields() {
    const requiredFields = ['etasje', 'leilighet_nr', 'aggregat_type', 'system_nummer'];
    
    for (const fieldName of requiredFields) {
        const field = document.querySelector(`[name="${fieldName}"], #${fieldName}`);
        if (!field || !field.value || field.value.trim() === '') {
            field?.focus();
            return false;
        }
    }
    
    return true;
}
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

// Global variabel for å holde styr på hvilken knapp som ble klikket
let currentPhotoContext = null;

// Global variabel for bildegallerier
const imageGallery = {
    general: [],
    avvik: []
};


// Navigation guard - prevent accidental navigation
window.addEventListener('beforeunload', function(e) {
    if (changeTracker.hasUnsavedChanges || changeTracker.hasUploadedImages) {
        e.preventDefault();
        e.returnValue = 'Du har ulagrede endringer. Er du sikker på at du vil forlate siden?';
        return e.returnValue;
    }
});

// Custom navigation guard for internal links
function confirmNavigation(targetUrl) {
    if (!changeTracker.hasUnsavedChanges && !changeTracker.hasUploadedImages) {
        window.location.href = targetUrl;
        return;
    }
    
    showSavePrompt(targetUrl);
}

// Override back button and link clicks
document.addEventListener('click', function(e) {
    // Detect navigation attempts
    if (e.target.closest('a[href]') && !e.target.closest('.photo-option')) {
        const href = e.target.closest('a').getAttribute('href');
        if (href && !href.startsWith('#') && (changeTracker.hasUnsavedChanges || changeTracker.hasUploadedImages)) {
            e.preventDefault();
            confirmNavigation(href);
        }
    }
});

// Mark form as dirty when changes occur
function markFormAsDirty() {
    changeTracker.hasUnsavedChanges = true;
    console.log('📝 Form marked as dirty');
}

// Mark form as clean after successful save
function markFormAsClean() {
    changeTracker.hasUnsavedChanges = false;
    changeTracker.hasUploadedImages = false;
    console.log('✅ Form marked as clean');
}

// DEBUGGING: Test backend endepunkter direkte
async function debugImageEndpoints() {
    console.log('🔍 DEBUGGING IMAGE ENDPOINTS');
    console.log('Report ID:', state.serviceReport?.reportId);
    
    // Test general images endpoint
    try {
        const generalResponse = await fetch(`/api/images/general/${state.serviceReport.reportId}`, {
            credentials: 'include'
        });
        console.log('📸 General endpoint status:', generalResponse.status);
        
        if (generalResponse.ok) {
            const generalData = await generalResponse.json();
            console.log('📸 General data:', generalData);
        } else {
            const errorText = await generalResponse.text();
            console.log('📸 General error:', errorText);
        }
    } catch (error) {
        console.log('📸 General fetch error:', error);
    }
    
    // Test avvik images endpoint
    try {
        const avvikResponse = await fetch(`/api/images/avvik/${state.serviceReport.reportId}`, {
            credentials: 'include'
        });
        console.log('📸 Avvik endpoint status:', avvikResponse.status);
        
        if (avvikResponse.ok) {
            const avvikData = await avvikResponse.json();
            console.log('📸 Avvik data:', avvikData);
        } else {
            const errorText = await avvikResponse.text();
            console.log('📸 Avvik error:', errorText);
        }
    } catch (error) {
        console.log('📸 Avvik fetch error:', error);
    }
    
    // Check service report in database
    console.log('🔍 SERVICE REPORT STATE:', {
        reportId: state.serviceReport?.reportId,
        id: state.serviceReport?.id,
        orderId: state.serviceReport?.orderId,
        equipmentId: state.serviceReport?.equipmentId
    });
}

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
        
        // Find matching template - prøv både exact match og lowercase
        let template = response.facilityTypes.find(t => 
            t.id === facilityType || 
            t.name.toLowerCase() === facilityType.toLowerCase() ||
            t.id === facilityType.toLowerCase()
        );
        
        // Fallback: prøv å finne basert på equipment type
        if (!template) {
            template = response.facilityTypes.find(t => 
                t.id.includes(facilityType) || 
                facilityType.includes(t.id)
            );
        }
        
        if (template) {
            console.log('Found template:', template);
// VIKTIG: Initialiser driftScheduleConfig hvis den mangler
if (template.hasDriftSchedule && !template.driftScheduleConfig) {
    template.driftScheduleConfig = {
        title: 'Driftstider',
        days: ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'],
        fields: ['Start', 'Stopp']
    };
}
            state.checklistTemplate = template;
            
            // Sørg for at template har nødvendige felter
            if (!template.systemFields) {
                template.systemFields = [];
            }
            if (!template.checklistItems) {
                template.checklistItems = [];
            }
            
        } else {
            console.warn(`No template found for facility type: ${facilityType}`);
            console.log('Available templates:', response.facilityTypes.map(t => ({ id: t.id, name: t.name })));
            
            showToast(`Ingen sjekkliste funnet for type: ${facilityType}. Bruker standard mal.`, 'warning');
            
            // Create comprehensive fallback template
            state.checklistTemplate = {
                id: 'fallback',
                name: 'Standard sjekkliste',
                systemFields: [
                    { name: "system_nummer", label: "System nummer", required: true, order: 1 },
                    { name: "type", label: "Type", required: true, order: 2 },
                    { name: "plassering", label: "Plassering", required: true, order: 3 },
                    { name: "beskrivelse", label: "Beskrivelse", required: false, order: 4 }
                ],
                checklistItems: [
                    { id: 'item1', label: 'Visuell kontroll', inputType: 'ok_avvik', order: 1 },
                    { id: 'item2', label: 'Funksjonskontroll', inputType: 'ok_avvik', order: 2 },
                    { id: 'item3', label: 'Rengjøring utført', inputType: 'ok_avvik', order: 3 },
                    { id: 'item4', label: 'Sikkerhetskontroll', inputType: 'ok_avvik', order: 4 },
                    { id: 'item5', label: 'Generell kommentar', inputType: 'textarea', order: 5 }
                ],
                allowProducts: true,
                allowAdditionalWork: true,
                allowComments: true,
                hasDriftSchedule: false
            };
        }
        
        // Trigger UI updates
        renderComponentDetailsForm();
        renderChecklist();
        renderSectionVisibility();
        
    } catch (error) {
        console.error('Error loading checklist template:', error);
        showToast('Kunne ikke laste sjekklistemaler - bruker standard mal', 'error');
        
        // Emergency fallback
        state.checklistTemplate = {
            id: 'emergency',
            name: 'Nødmal',
            systemFields: [
                { name: "beskrivelse", label: "Beskrivelse", required: true, order: 1 }
            ],
            checklistItems: [
                { id: 'emergency1', label: 'Dokumenter utført arbeid', inputType: 'textarea', order: 1 }
            ],
            allowProducts: true,
            allowAdditionalWork: true,
            allowComments: true,
            hasDriftSchedule: false
        };
        
        renderComponentDetailsForm();
        renderChecklist();
        renderSectionVisibility();
    }
}

async function loadServiceReport() {
    try {
        const reportResponse = await api.get(`/reports/equipment/${state.equipmentId}?orderId=${state.orderId}`);
        
        // DEBUGGING: Se hva backend faktisk returnerer
        console.log('🔍 RAW BACKEND RESPONSE:', reportResponse);
        console.log('🔍 RESPONSE KEYS:', Object.keys(reportResponse || {}));
        
        if (reportResponse.id) {
            // Existing report found
            state.serviceReport = {
                id: reportResponse.id,
                reportId: reportResponse.id,  // ← RIKTIG: Bruk id som reportId
                orderId: reportResponse.order_id,
                equipmentId: reportResponse.equipment_id,
                technicianId: reportResponse.technician_id,
                reportData: reportResponse.report_data || {},
                status: reportResponse.status,
                createdAt: reportResponse.created_at,
                updatedAt: reportResponse.updated_at
            };
            
            // VIKTIG: Sørg for at avvikNumbers eksisterer i reportData
            if (!state.serviceReport.reportData.avvikNumbers) {
                state.serviceReport.reportData.avvikNumbers = {};
            }
            
            console.log('Loaded existing report with reportId:', state.serviceReport.reportId);
        } else {
            // Create new report - FIKSET: Generer reportId riktig
            const timestamp = Date.now();
            const random = Math.floor(Math.random() * 1000);
            const newReportId = `RPT-${state.orderId}-${state.equipmentId}-${timestamp}-${random}`;
            
            state.serviceReport = {
                reportId: newReportId,  // KRITISK: Dette feltet må settes
                orderId: state.orderId,
                equipmentId: state.equipmentId,
                technicianId: state.technician?.id || 'TECH-TK', // Fallback hvis technician ikke er lastet
                reportData: {
                    components: [],
                    productList: [],
                    additionalWork: [],
                    overallComment: '',
                    avvikNumbers: {} // VIKTIG: Initialiser avvikNumbers objekt
                },
                status: 'draft'
            };
            
            console.log('Created new report with reportId:', newReportId);
            
            try {
                const response = await fetch('/api/reports', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        reportId: state.serviceReport.reportId,
                        orderId: state.orderId,
                        equipmentId: state.equipmentId,
                        reportData: state.serviceReport.reportData
                    })
                });
                
                if (!response.ok) {
                    throw new Error('Kunne ikke opprette rapport');
                }
                
                console.log('Report created in database');
            } catch (error) {
                console.error('Failed to create report:', error);
                showToast('Kunne ikke opprette rapport. Prøv igjen.', 'error');
                throw error;
            }
        }
        
        // DEBUGGING: Verifiser at reportId er satt
        console.log('🔍 FINAL SERVICE REPORT STATE:', {
            hasReportId: !!state.serviceReport.reportId,
            reportId: state.serviceReport.reportId
        });
        
    } catch (error) {
        console.error('Error loading service report:', error);
        throw error;
    }
}

function renderAll() {
    console.log("Rendering all components...");
    
    try { renderHeader(); } catch (e) { console.error('Error in renderHeader:', e); }
    try { renderAnleggInfo(); } catch (e) { console.error('Error in renderAnleggInfo:', e); }
    try { renderComponentList(); } catch (e) { console.error('Error in renderComponentList:', e); }
    try { renderComponentDetailsForm(); } catch (e) { console.error('Error in renderComponentDetailsForm:', e); }
    try { renderChecklist(); } catch (e) { console.error('Error in renderChecklist:', e); }
    try { renderSectionVisibility(); } catch (e) { console.error('Error in renderSectionVisibility:', e); }
    try { renderDriftScheduleSection(); } catch (e) { console.error('Error in renderDriftScheduleSection:', e); }
    try { resetAndLoadForm(); } catch (e) { console.error('Error in resetAndLoadForm:', e); }
    try { setupOverallCommentDetection(); } catch (e) { console.error('Error in setupOverallCommentDetection:', e); }
    
    // Set overall comment if exists
    try {
        const overallCommentEl = document.getElementById('overall-comment');
        if (overallCommentEl) {
            overallCommentEl.value = state.serviceReport.reportData.overallComment || '';
        }
    } catch (e) { console.error('Error setting overall comment:', e); }
    
    try { updateFinalizeButtonState(); } catch (e) { console.error('Error in updateFinalizeButtonState:', e); }
    try { updatePageFooterVisibility(); } catch (e) { console.error('Error in updatePageFooterVisibility:', e); }
    try { renderGeneralImages(); } catch (e) { console.error('Error in renderGeneralImages:', e); }
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
    if (!container) return;
    
    // Handle display name for equipment type
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
                <span class="label">Plassering</span>
                <span class="value">${state.equipment.name || 'Ikke angitt'}</span>
            </div>
            <div class="info-item">
                <span class="label">Ordrenummer</span>
                <span class="value">${state.order.orderNumber || state.order.id}</span>
            </div>
            ${state.order.customer ? `
            <div class="info-item">
                <span class="label">Kunde</span>
                <span class="value">${state.order.customer.name || 'Ikke angitt'}</span>
            </div>
            ` : ''}
        </div>
        ${state.equipment.internalNotes ? `
            <div class="internal-notes-section" style="margin-top: 12px; padding: 12px; background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 6px;">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                    <i data-lucide="info" style="width: 16px; height: 16px; color: #856404;"></i>
                    <strong style="color: #856404; font-size: 14px;">Intern kommentar</strong>
                </div>
                <div style="color: #856404; font-size: 14px; line-height: 1.4;">
                    ${state.equipment.internalNotes}
                </div>
            </div>
        ` : ''}
    `;
    
    // Initialize lucide icons
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
        console.log('Rendering systemFields:', state.checklistTemplate.systemFields);
        
        const fieldsHtml = state.checklistTemplate.systemFields
            .sort((a, b) => a.order - b.order)
            .map(field => {
                // Sikkerhetstsjekk for fieldproperties
                const fieldName = field.name || `field_${Date.now()}`;
                const fieldLabel = field.label || field.name || 'Ukjent felt';
                const isRequired = field.required || false;
                
                const inputType = field.type === 'textarea' ? 'textarea' : 'input';
                const inputHtml = inputType === 'textarea' ?
                    `<textarea id="comp-${fieldName}" class="large-textarea" placeholder="${fieldLabel}" rows="4"></textarea>` :
                    `<input type="text" id="comp-${fieldName}" placeholder="${fieldLabel}">`;
                
                return `
                    <div class="form-group">
                        <label for="comp-${fieldName}">${fieldLabel}${isRequired ? ' *' : ''}</label>
                        ${inputHtml}
                    </div>
                `;
            }).join('');
        
        formHTML = `<div class="component-grid">${fieldsHtml}</div>`;
    } else {
        console.log('No systemFields found, using fallback');
        // Minimal fallback
        formHTML = `
            <div class="form-group">
                <label>Beskrivelse</label>
                <textarea id="comp-beskrivelse" class="large-textarea" placeholder="Beskriv hva som er sjekket/gjort..." rows="4"></textarea>
            </div>
        `;
    }
    
    container.innerHTML = formHTML;
    console.log('Component details form rendered successfully');
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

    // Render avvik-bilder som finnes
    setTimeout(() => {
        renderAvvikImagesForChecklist();
    }, 100);

    // Initialize lucide icons BARE EN GANG
    setTimeout(() => {
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }, 150); // Litt lengre delay for å sikre alt er klart
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
        case 'dropdown_ok_avvik':
            return createDropdownOkAvvikItemHTML(item);
        case 'dropdown_ok_avvik_comment':
            return createDropdownOkAvvikCommentItemHTML(item);
        case 'temperature':
            return createTemperatureItemHTML(item);
        case 'virkningsgrad':
            return createVirkningsgradItemHTML(item);
        case 'tilstandsgrad_dropdown':
            return createTilstandsgradDropdownItemHTML(item);
        case 'konsekvensgrad_dropdown':
            return createKonsekvenssgradDropdownItemHTML(item);
        case 'timer':
            return createTimerItemHTML(item);
        case 'multi_checkbox':
            return createMultiCheckboxItemHTML(item);
        case 'rengjort_ikke_rengjort':
            return createRengjortIkkeRengjortItemHTML(item);
        case 'image_only':
            return createImageOnlyItemHTML(item);
        case 'dropdown':
            return createDropdownItemHTML(item);
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
            <div class="photo-dropdown-wrapper" style="position: relative; display: inline-block;">
                <button type="button" class="photo-btn" style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; background: linear-gradient(135deg, #4A90E2 0%, #357ABD 100%); color: white; border: none; border-radius: 6px; font-size: 13px; cursor: pointer;">
                    <i data-lucide="camera"></i>Ta bilde av avvik<i data-lucide="chevron-down" style="width: 12px; height: 12px; margin-left: 4px;"></i>
                </button>
                <div class="photo-dropdown" style="position: absolute; top: 100%; left: 0; background: white; border: 1px solid #ddd; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); z-index: 1000; opacity: 0; visibility: hidden; min-width: 180px;">
                    <button class="photo-option" data-action="camera" style="display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: none; background: none; width: 100%; text-align: left; font-size: 13px; cursor: pointer;"><i data-lucide="camera"></i>Ta bilde med kamera</button>
                    <button class="photo-option" data-action="upload" style="display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: none; background: none; width: 100%; text-align: left; font-size: 13px; cursor: pointer;"><i data-lucide="upload"></i>Last opp fil</button>
                </div>
            </div>
            <div id="avvik-images-container-${item.id}" class="avvik-images-container"></div>
        </div>
    `;
}

function createOkByttetAvvikItemHTML(item) {
    const buttonsHTML = `
        <button type="button" class="status-btn ok" data-status="ok">OK</button>
        <button type="button" class="status-btn byttet" data-status="byttet">Byttet</button>
        <button type="button" class="status-btn avvik" data-status="avvik">Avvik</button>
    `;
    
    return `
        <div class="checklist-item" data-item-id="${item.id}" data-item-type="ok_byttet_avvik">
            <span class="item-label">${item.label}</span>
            <div class="item-actions">${buttonsHTML}</div>
        </div>
        <div class="avvik-container" id="avvik-${item.id}">
            <textarea placeholder="Beskriv avvik..."></textarea>
            <div class="photo-dropdown-wrapper" style="position: relative; display: inline-block;">
                <button type="button" class="photo-btn" style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; background: linear-gradient(135deg, #4A90E2 0%, #357ABD 100%); color: white; border: none; border-radius: 6px; font-size: 13px; cursor: pointer;">
                    <i data-lucide="camera"></i>Ta bilde<i data-lucide="chevron-down" style="width: 12px; height: 12px; margin-left: 4px;"></i>
                </button>
                <div class="photo-dropdown" style="position: absolute; top: 100%; left: 0; background: white; border: 1px solid #ddd; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); z-index: 1000; opacity: 0; visibility: hidden; min-width: 180px;">
                    <button class="photo-option" data-action="camera" style="display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: none; background: none; width: 100%; text-align: left; font-size: 13px; cursor: pointer;"><i data-lucide="camera"></i>Ta bilde med kamera</button>
                    <button class="photo-option" data-action="upload" style="display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: none; background: none; width: 100%; text-align: left; font-size: 13px; cursor: pointer;"><i data-lucide="upload"></i>Last opp fil</button>
                </div>
            </div>
        </div>
        <div class="byttet-container" id="byttet-${item.id}">
            <textarea placeholder="Kommentar..."></textarea>
            <div class="photo-dropdown-wrapper" style="position: relative; display: inline-block;">
                <button type="button" class="photo-btn" style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; background: linear-gradient(135deg, #4A90E2 0%, #357ABD 100%); color: white; border: none; border-radius: 6px; font-size: 13px; cursor: pointer;">
                    <i data-lucide="camera"></i>Ta bilde<i data-lucide="chevron-down" style="width: 12px; height: 12px; margin-left: 4px;"></i>
                </button>
                <div class="photo-dropdown" style="position: absolute; top: 100%; left: 0; background: white; border: 1px solid #ddd; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); z-index: 1000; opacity: 0; visibility: hidden; min-width: 180px;">
                    <button class="photo-option" data-action="camera" style="display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: none; background: none; width: 100%; text-align: left; font-size: 13px; cursor: pointer;"><i data-lucide="camera"></i>Ta bilde med kamera</button>
                    <button class="photo-option" data-action="upload" style="display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: none; background: none; width: 100%; text-align: left; font-size: 13px; cursor: pointer;"><i data-lucide="upload"></i>Last opp fil</button>
                </div>
            <div id="avvik-images-container-${item.id}" class="avvik-images-container"></div>
        </div>
        <div class="byttet-container" id="byttet-${item.id}">
            <textarea placeholder="Kommentar..."></textarea>
            <div class="photo-dropdown-wrapper" style="position: relative; display: inline-block;">
                <button type="button" class="photo-btn" style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; background: linear-gradient(135deg, #4A90E2 0%, #357ABD 100%); color: white; border: none; border-radius: 6px; font-size: 13px; cursor: pointer;">
                    <i data-lucide="camera"></i>Ta bilde<i data-lucide="chevron-down" style="width: 12px; height: 12px; margin-left: 4px;"></i>
                </button>
                <div class="photo-dropdown" style="position: absolute; top: 100%; left: 0; background: white; border: 1px solid #ddd; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); z-index: 1000; opacity: 0; visibility: hidden; min-width: 180px;">
                    <button class="photo-option" data-action="camera" style="display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: none; background: none; width: 100%; text-align: left; font-size: 13px; cursor: pointer;"><i data-lucide="camera"></i>Ta bilde med kamera</button>
                    <button class="photo-option" data-action="upload" style="display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: none; background: none; width: 100%; text-align: left; font-size: 13px; cursor: pointer;"><i data-lucide="upload"></i>Last opp fil</button>
                </div>
            </div>
            <div id="byttet-images-container-${item.id}" class="avvik-images-container"></div>
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

function createDropdownOkAvvikItemHTML(item) {
    const options = item.dropdownOptions || [];
    const optionsHTML = options.map(opt => `<option value="${opt}">${opt}</option>`).join('');
    
    const buttonsHTML = `
        <button type="button" class="status-btn ok" data-status="ok">OK</button>
        <button type="button" class="status-btn avvik" data-status="avvik">Avvik</button>
    `;
    
    return `
        <div class="checklist-item" data-item-id="${item.id}" data-item-type="dropdown_ok_avvik">
            <span class="item-label">${item.label}</span>
            <div class="item-controls">
                <select class="checklist-dropdown">
                    <option value="">Velg...</option>
                    ${optionsHTML}
                </select>
                <div class="item-actions">${buttonsHTML}</div>
            </div>
        </div>
        <div class="avvik-container" id="avvik-${item.id}">
            <textarea placeholder="Beskriv avvik..."></textarea>
            <div class="photo-dropdown-wrapper" style="position: relative; display: inline-block;">
                <button type="button" class="photo-btn" style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; background: linear-gradient(135deg, #4A90E2 0%, #357ABD 100%); color: white; border: none; border-radius: 6px; font-size: 13px; cursor: pointer;">
                    <i data-lucide="camera"></i>Ta bilde av avvik<i data-lucide="chevron-down" style="width: 12px; height: 12px; margin-left: 4px;"></i>
                </button>
                <div class="photo-dropdown" style="position: absolute; top: 100%; left: 0; background: white; border: 1px solid #ddd; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); z-index: 1000; opacity: 0; visibility: hidden; min-width: 180px;">
                    <button class="photo-option" data-action="camera" style="display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: none; background: none; width: 100%; text-align: left; font-size: 13px; cursor: pointer;"><i data-lucide="camera"></i>Ta bilde med kamera</button>
                    <button class="photo-option" data-action="upload" style="display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: none; background: none; width: 100%; text-align: left; font-size: 13px; cursor: pointer;"><i data-lucide="upload"></i>Last opp fil</button>
                </div>
            </div>
            <div id="avvik-images-container-${item.id}" class="avvik-images-container"></div>
        </div>
    `;
}

function createDropdownOkAvvikCommentItemHTML(item) {
    const options = item.dropdownOptions || [];
    const optionsHTML = options.map(opt => `<option value="${opt}">${opt}</option>`).join('');
    
    const buttonsHTML = `
        <button type="button" class="status-btn ok" data-status="ok">OK</button>
        <button type="button" class="status-btn avvik" data-status="avvik">Avvik</button>
    `;
    
    return `
        <div class="checklist-item" data-item-id="${item.id}" data-item-type="dropdown_ok_avvik_comment">
            <span class="item-label">${item.label}</span>
            <div class="item-controls">
                <select class="checklist-dropdown">
                    <option value="">Velg...</option>
                    ${optionsHTML}
                </select>
                <div class="item-actions">${buttonsHTML}</div>
            </div>
            <div class="comment-section">
                <textarea id="comment-${item.id}" placeholder="Kommentar..." class="checklist-input-textarea"></textarea>
            </div>
        </div>
        <div class="avvik-container" id="avvik-${item.id}">
            <textarea placeholder="Beskriv avvik..."></textarea>
            <div class="photo-dropdown-wrapper" style="position: relative; display: inline-block;">
                <button type="button" class="photo-btn" style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; background: linear-gradient(135deg, #4A90E2 0%, #357ABD 100%); color: white; border: none; border-radius: 6px; font-size: 13px; cursor: pointer;">
                    <i data-lucide="camera"></i>Ta bilde av avvik<i data-lucide="chevron-down" style="width: 12px; height: 12px; margin-left: 4px;"></i>
                </button>
                <div class="photo-dropdown" style="position: absolute; top: 100%; left: 0; background: white; border: 1px solid #ddd; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); z-index: 1000; opacity: 0; visibility: hidden; min-width: 180px;">
                    <button class="photo-option" data-action="camera" style="display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: none; background: none; width: 100%; text-align: left; font-size: 13px; cursor: pointer;"><i data-lucide="camera"></i>Ta bilde med kamera</button>
                    <button class="photo-option" data-action="upload" style="display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: none; background: none; width: 100%; text-align: left; font-size: 13px; cursor: pointer;"><i data-lucide="upload"></i>Last opp fil</button>
                </div>
            </div>
            <div id="avvik-images-container-${item.id}" class="avvik-images-container"></div>
        </div>
    `;
}

function createTemperatureItemHTML(item) {
    const buttonsHTML = `
        <button type="button" class="status-btn ok" data-status="ok">OK</button>
        <button type="button" class="status-btn avvik" data-status="avvik">Avvik</button>
    `;
    
    return `
        <div class="checklist-item" data-item-id="${item.id}" data-item-type="temperature">
            <span class="item-label">${item.label}</span>
            <div class="item-controls">
                <div class="temperature-input">
                    <input type="number" id="temp-${item.id}" placeholder="0.0" step="0.1" class="checklist-input-number">
                    <span class="unit">°C</span>
                </div>
                <div class="item-actions">${buttonsHTML}</div>
            </div>
        </div>
        <div class="avvik-container" id="avvik-${item.id}">
            <textarea placeholder="Beskriv avvik..."></textarea>
            <div class="photo-dropdown-wrapper" style="position: relative; display: inline-block;">
                <button type="button" class="photo-btn" style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; background: linear-gradient(135deg, #4A90E2 0%, #357ABD 100%); color: white; border: none; border-radius: 6px; font-size: 13px; cursor: pointer;">
                    <i data-lucide="camera"></i>Ta bilde av avvik<i data-lucide="chevron-down" style="width: 12px; height: 12px; margin-left: 4px;"></i>
                </button>
                <div class="photo-dropdown" style="position: absolute; top: 100%; left: 0; background: white; border: 1px solid #ddd; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); z-index: 1000; opacity: 0; visibility: hidden; min-width: 180px;">
                    <button class="photo-option" data-action="camera" style="display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: none; background: none; width: 100%; text-align: left; font-size: 13px; cursor: pointer;"><i data-lucide="camera"></i>Ta bilde med kamera</button>
                    <button class="photo-option" data-action="upload" style="display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: none; background: none; width: 100%; text-align: left; font-size: 13px; cursor: pointer;"><i data-lucide="upload"></i>Last opp fil</button>
                </div>
            </div>
            <div id="avvik-images-container-${item.id}" class="avvik-images-container"></div>
        </div>
    `;
}

function createVirkningsgradItemHTML(item) {
    return `
        <div class="checklist-item-fullwidth" data-item-id="${item.id}" data-item-type="virkningsgrad">
            <span class="item-label">${item.label}</span>
            <div class="virkningsgrad-inputs">
                <div class="input-group">
                    <label>T2 (ute):</label>
                    <input type="number" id="t2-${item.id}" step="0.1" />
                </div>
                <div class="input-group">
                    <label>T3 (tilluft):</label>
                    <input type="number" id="t3-${item.id}" step="0.1" />
                </div>
                <div class="input-group">
                    <label>T7 (avtrekk):</label>
                    <input type="number" id="t7-${item.id}" step="0.1" />
                </div>
                <div class="result">
                    <span>Virkningsgrad: <strong id="result-${item.id}">--%</strong></span>
                </div>
            </div>
        </div>
    `;
}

function createTilstandsgradDropdownItemHTML(item) {
    const tgOptions = ['TG-0', 'TG-1', 'TG-2', 'TG-3', 'TG-4', 'TG-IU'];
    const optionsHTML = tgOptions.map(opt => `<option value="${opt}">${opt}</option>`).join('');
    
    return `
        <div class="checklist-item" data-item-id="${item.id}" data-item-type="tilstandsgrad_dropdown">
            <span class="item-label">${item.label}</span>
            <div class="item-controls">
                <select class="checklist-dropdown">
                    <option value="">Velg TG...</option>
                    ${optionsHTML}
                </select>
            </div>
        </div>
    `;
}

function createKonsekvenssgradDropdownItemHTML(item) {
    const kgOptions = ['KG-0', 'KG-1', 'KG-2', 'KG-3', 'KG-4', 'KG-IU'];
    const optionsHTML = kgOptions.map(opt => `<option value="${opt}">${opt}</option>`).join('');
    
    return `
        <div class="checklist-item" data-item-id="${item.id}" data-item-type="konsekvensgrad_dropdown">
            <span class="item-label">${item.label}</span>
            <div class="item-controls">
                <select class="checklist-dropdown">
                    <option value="">Velg KG...</option>
                    ${optionsHTML}
                </select>
            </div>
        </div>
    `;
}

// Timer inputType
function createTimerItemHTML(item) {
    return `
        <div class="checklist-item" data-item-id="${item.id}" data-item-type="timer">
            <span class="item-label">${item.label}</span>
            <div class="timer-controls">
                <button type="button" class="timer-btn start" data-action="start">Start</button>
                <button type="button" class="timer-btn stop" data-action="stop" disabled>Stopp</button>
                <span class="timer-display">00:00:00</span>
            </div>
        </div>
    `;
}

// Multi checkbox inputType
function createMultiCheckboxItemHTML(item) {
    const options = item.options || ['Valg 1', 'Valg 2', 'Valg 3'];
    return `
        <div class="checklist-item-fullwidth" data-item-id="${item.id}" data-item-type="multi_checkbox">
            <span class="item-label">${item.label}</span>
            <div class="multi-checkbox-group">
                ${options.map((option, index) => `
                    <div class="form-check">
                        <input type="checkbox" id="${item.id}_${index}" class="form-check-input" value="${option}">
                        <label for="${item.id}_${index}" class="form-check-label">${option}</label>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

// Rengjort/Ikke rengjort inputType
function createRengjortIkkeRengjortItemHTML(item) {
    return `
        <div class="checklist-item" data-item-id="${item.id}" data-item-type="rengjort_ikke_rengjort">
            <span class="item-label">${item.label}</span>
            <div class="item-actions">
                <button type="button" class="status-btn rengjort" data-status="rengjort">Rengjort</button>
                <button type="button" class="status-btn ikke-rengjort" data-status="ikke_rengjort">Ikke Rengjort</button>
            </div>
        </div>
    `;
}

// Image only inputType
function createImageOnlyItemHTML(item) {
    return `
        <div class="checklist-item-fullwidth" data-item-id="${item.id}" data-item-type="image_only">
            <span class="item-label">${item.label}</span>
            <div class="photo-dropdown-wrapper" style="position: relative; display: inline-block; margin-top: 10px;">
                <button type="button" class="photo-btn" style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; background: linear-gradient(135deg, #4A90E2 0%, #357ABD 100%); color: white; border: none; border-radius: 6px; font-size: 13px; cursor: pointer;">
                    <i data-lucide="camera"></i>Ta bilde<i data-lucide="chevron-down" style="width: 12px; height: 12px; margin-left: 4px;"></i>
                </button>
                <div class="photo-dropdown" style="position: absolute; top: 100%; left: 0; background: white; border: 1px solid #ddd; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); z-index: 1000; opacity: 0; visibility: hidden; min-width: 180px;">
                    <button class="photo-option" data-action="camera" style="display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: none; background: none; width: 100%; text-align: left; font-size: 13px; cursor: pointer;"><i data-lucide="camera"></i>Ta bilde med kamera</button>
                    <button class="photo-option" data-action="upload" style="display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: none; background: none; width: 100%; text-align: left; font-size: 13px; cursor: pointer;"><i data-lucide="upload"></i>Last opp fil</button>
                </div>
            </div>
            <div id="image-only-container-${item.id}" class="image-only-container"></div>
        </div>
    `;
}

function createVirkningsgradItemHTML(item) {
    return `
        <div class="checklist-item-fullwidth" data-item-id="${item.id}" data-item-type="virkningsgrad">
            <span class="item-label">${item.label}</span>
            <div class="virkningsgrad-inputs">
                <div class="input-group">
                    <label>T2:</label>
                    <input type="number" id="t2-${item.id}" step="0.1" />
                </div>
                <div class="input-group">
                    <label>T3:</label>
                    <input type="number" id="t3-${item.id}" step="0.1" />
                </div>
                <div class="input-group">
                    <label>T7:</label>
                    <input type="number" id="t7-${item.id}" step="0.1" />
                </div>
                <div class="result">
                    <span>Virkningsgrad: <strong id="result-${item.id}">--%</strong></span>
                </div>
            </div>
        </div>
    `;
}

// Dropdown inputType  
function createDropdownItemHTML(item) {
    const options = item.options || ['Valg 1', 'Valg 2', 'Valg 3'];
    return `
        <div class="checklist-item" data-item-id="${item.id}" data-item-type="dropdown">
            <label class="item-label" for="dropdown-${item.id}">${item.label}</label>
            <select id="dropdown-${item.id}" class="checklist-input-select">
                <option value="">Velg...</option>
                ${options.map(opt => `<option value="${opt}">${opt}</option>`).join('')}
            </select>
        </div>
    `;
}

function calculateVirkningsgrad(t2, t3, t7) {
    if (t2 === null || t3 === null || t7 === null) return null;
    if (t7 === t2) return 0;
    
    const virkningsgrad = ((t3 - t2) / (t7 - t2)) * 100;
    return Math.round(virkningsgrad * 10) / 10;
}

function setupVirkningsgradCalculation() {
    document.addEventListener('input', (e) => {
        if (e.target.matches('[id^="t2-"], [id^="t3-"], [id^="t7-"]')) {
            const itemId = e.target.id.split('-')[1];
            
            const t2Input = document.getElementById(`t2-${itemId}`);
            const t3Input = document.getElementById(`t3-${itemId}`);
            const t7Input = document.getElementById(`t7-${itemId}`);
            const resultSpan = document.getElementById(`result-${itemId}`);
            
            if (t2Input && t3Input && t7Input && resultSpan) {
                const t2 = parseFloat(t2Input.value);
                const t3 = parseFloat(t3Input.value);
                const t7 = parseFloat(t7Input.value);
                
                const virkningsgrad = calculateVirkningsgrad(t2, t3, t7);
                
                if (virkningsgrad !== null) {
                    resultSpan.textContent = `${virkningsgrad}%`;
                } else {
                    resultSpan.textContent = '--%';
                }
            }
        }
    });
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
        
        // VIKTIG: Sjekk at arrays eksisterer før .map()
        const days = config.days || ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];
        const fields = config.fields || ['Start', 'Stopp'];
        
        let tableRowsHTML = days.map(day => `
            <tr>
                <td>${day}</td>
                ${fields.map(field => `
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
                <h4 class="card-title">${config.title || 'Driftstider'}</h4>
                <div class="card-body">
                    <table class="drift-schedule-table">
                        <thead>
                            <tr>
                                <th>Dag</th>
                                ${fields.map(field => `<th>${field}</th>`).join('')}
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
                        
                        if (result.status === 'byttet' && result.comment) {
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

            case 'dropdown_ok_avvik':
                if (result.selectedOption) {
                    const dropdown = element.querySelector('.checklist-dropdown');
                    if (dropdown) dropdown.value = result.selectedOption;
                }
                if (result.status) {
                    const button = element.querySelector(`[data-status="${result.status}"]`);
                    if (button) button.classList.add('active');
                }
                if (result.avvikComment) {
                    const avvikContainer = element.nextElementSibling;
                    if (avvikContainer) {
                        avvikContainer.classList.add('show');
                        avvikContainer.querySelector('textarea').value = result.avvikComment;
                    }
                }
                break;
                
            case 'dropdown_ok_avvik_comment':
                if (result.selectedOption) {
                    const dropdown = element.querySelector('.checklist-dropdown');
                    if (dropdown) dropdown.value = result.selectedOption;
                }
                if (result.status) {
                    const button = element.querySelector(`[data-status="${result.status}"]`);
                    if (button) button.classList.add('active');
                }
                if (result.comment) {
                    const commentElement = element.querySelector(`#comment-${item.id}`);
                    if (commentElement) commentElement.value = result.comment;
                }
                if (result.avvikComment) {
                    const avvikContainer = element.nextElementSibling;
                    if (avvikContainer) {
                        avvikContainer.classList.add('show');
                        avvikContainer.querySelector('textarea').value = result.avvikComment;
                    }
                }
                break;
                
            case 'temperature':
                if (result.temperature !== null) {
                    const tempInput = element.querySelector(`#temp-${item.id}`);
                    if (tempInput) tempInput.value = result.temperature;
                }
                if (result.status) {
                    const button = element.querySelector(`[data-status="${result.status}"]`);
                    if (button) button.classList.add('active');
                }
                if (result.avvikComment) {
                    const avvikContainer = element.nextElementSibling;
                    if (avvikContainer) {
                        avvikContainer.classList.add('show');
                        avvikContainer.querySelector('textarea').value = result.avvikComment;
                    }
                }
                break;
                
            case 'virkningsgrad':
                if (result.t2 !== null) {
                    const t2Input = element.querySelector(`#t2-${item.id}`);
                    if (t2Input) t2Input.value = result.t2;
                }
                if (result.t3 !== null) {
                    const t3Input = element.querySelector(`#t3-${item.id}`);
                    if (t3Input) t3Input.value = result.t3;
                }
                if (result.t7 !== null) {
                    const t7Input = element.querySelector(`#t7-${item.id}`);
                    if (t7Input) t7Input.value = result.t7;
                }
                if (result.virkningsgrad !== null) {
                    const resultSpan = element.querySelector(`#result-${item.id}`);
                    if (resultSpan) resultSpan.textContent = result.virkningsgrad.toFixed(1);
                }
                if (result.status) {
                    const button = element.querySelector(`[data-status="${result.status}"]`);
                    if (button) button.classList.add('active');
                }
                if (result.avvikComment) {
                    const avvikContainer = element.nextElementSibling;
                    if (avvikContainer) {
                        avvikContainer.classList.add('show');
                        avvikContainer.querySelector('textarea').value = result.avvikComment;
                    }
                }
                break;
                
            case 'tilstandsgrad_dropdown':
            case 'konsekvensgrad_dropdown':
                const selectElement = element.querySelector(`#select-${item.id}`);
                if (selectElement && result) {
                    selectElement.value = result;
                }
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

    // Legg til virkningsgrad-beregning
    setupVirkningsgradCalculation();
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
            button.dataset.status === 'byttet' && button.classList.contains('active')
        );
    }
}

function handleComponentListClick(e) {
    const target = e.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;
    const index = parseInt(target.dataset.index, 10);

    if (action === 'edit-component') {
        if (changeTracker.hasUnsavedChanges && state.editingComponentIndex !== index) {
            showSavePrompt(); // Will save, but not navigate. User must click again.
            return;
        }
        state.editingComponentIndex = index;
        resetAndLoadForm(true);
        
        // Scroll to form
        document.getElementById('new-component-form')?.scrollIntoView({ behavior: 'smooth' });

    } else if (action === 'delete-checklist') {
        if (changeTracker.hasUnsavedChanges) {
            showSavePrompt(); // Will save, but not navigate. User must click again.
            return;
        }
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
        await api.put(`/reports/${state.serviceReport.reportId}`, {
            orderId: state.orderId,
            equipmentId: state.equipmentId,
            reportData: state.serviceReport.reportData
        });
        
        // DEBUGGING: Check component after save
        const savedComponents = state.serviceReport.reportData.components;
        const lastComponent = savedComponents[savedComponents.length - 1];
        
        console.log('🔍 COMPONENT AFTER SAVE:', {
            lastComponent,
            isComplete: isChecklistComplete(lastComponent),
            allComponents: savedComponents.map((comp, i) => ({
                index: i,
                isComplete: isChecklistComplete(comp),
                details: comp.details,
                checklist: comp.checklist
            }))
        });
        
        // Reset form and update UI
        state.editingComponentIndex = null;
        resetAndLoadForm();
        renderComponentList();
        updatePageFooterVisibility();
        updateFinalizeButtonState();
        showToast('Sjekkliste lagret!', 'success');
        markFormAsClean();

        // Mark form as clean after successful save
        markFormAsClean();
        
    } catch (error) {
        showToast(`Kunne ikke lagre: ${error.message}`, 'error');
    } finally {
        setLoading(false);
    }
}

function collectComponentData() {
    console.log('Collecting component data...');
    
    // Collect system field details
    const details = {};
    
    if (state.checklistTemplate?.systemFields) {
        state.checklistTemplate.systemFields.forEach(field => {
            const input = document.getElementById(`comp-${field.name}`);
            if (input) {
                details[field.name] = input.value;
                console.log(`Collected field ${field.name}:`, input.value);
            }
        });
    } else {
        // Fallback for beskrivelse
        const beskrivelse = document.getElementById('comp-beskrivelse');
        if (beskrivelse) {
            details.beskrivelse = beskrivelse.value;
        }
    }
    
    // Collect checklist responses
    const checklist = {};
    const checklistContainer = document.getElementById('checklist-items-container');
    if (checklistContainer && state.checklistTemplate?.checklistItems) {
        state.checklistTemplate.checklistItems.forEach(item => {
            const value = getChecklistItemValue(item.id);
            if (value !== null && value !== undefined) {
                checklist[item.id] = value;
            }
        });
    }
    
    // Collect products
    const products = [];
    const productContainer = document.getElementById('product-lines-container');
    if (productContainer) {
        productContainer.querySelectorAll('.product-item').forEach(item => {
            const name = item.querySelector('.product-name')?.value || '';
            const quantity = parseFloat(item.querySelector('.product-quantity')?.value) || 0;
            const price = parseFloat(item.querySelector('.product-price')?.value) || 0;
            
            if (name || quantity > 0 || price > 0) {
                products.push({ name, quantity, price });
            }
        });
    }
    
    // Collect additional work
    const additionalWork = [];
    const workContainer = document.getElementById('additional-work-lines-container');
    if (workContainer) {
        workContainer.querySelectorAll('.work-item').forEach(item => {
            const description = item.querySelector('.work-description')?.value || '';
            const hours = parseFloat(item.querySelector('.work-hours')?.value) || 0;
            const price = parseFloat(item.querySelector('.work-price')?.value) || 0;
            
            if (description || hours > 0 || price > 0) {
                additionalWork.push({ description, hours, price });
            }
        });
    }
    
    const componentData = {
        details,
        checklist,
        products,
        additionalWork
    };
    
    console.log('Collected component data:', componentData);
    return componentData;
}

function getChecklistItemValue(itemId) {
    // Finn sjekkliste-elementet i DOM
    const element = document.querySelector(`[data-item-id="${itemId}"]`);
    if (!element) {
        console.warn(`Element not found for item ID: ${itemId}`);
        return null;
    }
    
    const itemType = element.dataset.itemType;
    
    switch (itemType) {
        case 'ok_avvik':
        case 'ok_byttet_avvik': {
            // Sjekk hvilken status-knapp som er aktiv
            const activeButton = element.querySelector('.status-btn.active');
            if (!activeButton) return null;
            
            const status = activeButton.dataset.status;
            const result = { status };
            
            // Hvis avvik eller byttet, hent kommentar
            if (status === 'avvik') {
                const avvikContainer = document.getElementById(`avvik-${itemId}`);
                if (avvikContainer && avvikContainer.classList.contains('show')) {
                    const textarea = avvikContainer.querySelector('textarea');
                    result.avvikComment = textarea ? textarea.value : '';
                }
            } else if (status === 'byttet') {
                const byttetContainer = document.getElementById(`byttet-${itemId}`);
                if (byttetContainer && byttetContainer.classList.contains('show')) {
                    const textarea = byttetContainer.querySelector('textarea');
                    result.byttetComment = textarea ? textarea.value : '';
                }
            }
            
            return result;
        }
        
        case 'numeric': {
            const input = element.querySelector(`#number-${itemId}, input[type="number"]`);
            if (!input) return null;
            
            const numericValue = parseFloat(input.value);
            return isNaN(numericValue) ? null : numericValue;
        }
        
        case 'text': {
            const input = element.querySelector(`#text-${itemId}, input[type="text"]`);
            return input ? input.value : null;
        }
        
        case 'textarea':
        case 'comment': {
            const textarea = element.querySelector(`#comment-${itemId}, textarea`);
            return textarea ? textarea.value : null;
        }
        
        case 'checkbox': {
            const checkbox = element.querySelector(`#checkbox-${itemId}, input[type="checkbox"]`);
            return checkbox ? checkbox.checked : null;
        }
        
        case 'dropdown_ok_avvik': {
            const select = element.querySelector('.checklist-dropdown');
            const activeButton = element.querySelector('.status-btn.active');
            
            if (!activeButton) return null;
            
            const status = activeButton.dataset.status;
            const result = { 
                status,
                dropdownValue: select ? select.value : ''
            };
            
            // Hvis avvik, hent kommentar
            if (status === 'avvik') {
                const avvikContainer = document.getElementById(`avvik-${itemId}`);
                if (avvikContainer && avvikContainer.classList.contains('show')) {
                    const textarea = avvikContainer.querySelector('textarea');
                    result.avvikComment = textarea ? textarea.value : '';
                }
            }
            
            return result;
        }
        
        case 'dropdown_ok_avvik_comment': {
            const select = element.querySelector('.checklist-dropdown');
            const activeButton = element.querySelector('.status-btn.active');
            const commentTextarea = element.querySelector(`#comment-${itemId}`);
            
            if (!activeButton) return null;
            
            const status = activeButton.dataset.status;
            const result = { 
                status,
                dropdownValue: select ? select.value : '',
                comment: commentTextarea ? commentTextarea.value : ''
            };
            
            // Hvis avvik, hent avvik-kommentar
            if (status === 'avvik') {
                const avvikContainer = document.getElementById(`avvik-${itemId}`);
                if (avvikContainer && avvikContainer.classList.contains('show')) {
                    const textarea = avvikContainer.querySelector('textarea');
                    result.avvikComment = textarea ? textarea.value : '';
                }
            }
            
            return result;
        }
        
        case 'temperature': {
            const tempInput = element.querySelector(`#temp-${itemId}`);
            const activeButton = element.querySelector('.status-btn.active');
            
            const result = {
                temperature: tempInput ? parseFloat(tempInput.value) : null,
                status: activeButton ? activeButton.dataset.status : null
            };
            
            // Hvis avvik, hent kommentar
            if (result.status === 'avvik') {
                const avvikContainer = document.getElementById(`avvik-${itemId}`);
                if (avvikContainer && avvikContainer.classList.contains('show')) {
                    const textarea = avvikContainer.querySelector('textarea');
                    result.avvikComment = textarea ? textarea.value : '';
                }
            }
            
            return result;
        }
        
        case 'virkningsgrad': {
            const t2Input = element.querySelector(`#t2-${itemId}`);
            const t3Input = element.querySelector(`#t3-${itemId}`);
            const t7Input = element.querySelector(`#t7-${itemId}`);
            const t8Input = element.querySelector(`#t8-${itemId}`);
            const activeButton = element.querySelector('.status-btn.active');
            
            const t2 = t2Input ? parseFloat(t2Input.value) : 0;
            const t3 = t3Input ? parseFloat(t3Input.value) : 0;
            const t7 = t7Input ? parseFloat(t7Input.value) : 0;
            const t8 = t8Input ? parseFloat(t8Input.value) : 0;
            
            // Beregn virkningsgrad: ((T3-T2)/(T7-T8)) * 100
            let virkningsgrad = 0;
            if (t7 !== t8) {
                virkningsgrad = ((t3 - t2) / (t7 - t8)) * 100;
            }
            
            const result = {
                t2, t3, t7, t8,
                virkningsgrad,
                status: activeButton ? activeButton.dataset.status : null
            };
            
            // Hvis avvik, hent kommentar
            if (result.status === 'avvik') {
                const avvikContainer = document.getElementById(`avvik-${itemId}`);
                if (avvikContainer && avvikContainer.classList.contains('show')) {
                    const textarea = avvikContainer.querySelector('textarea');
                    result.avvikComment = textarea ? textarea.value : '';
                }
            }
            
            return result;
        }
        
        case 'tilstandsgrad_dropdown':
        case 'konsekvensgrad_dropdown': {
            const select = element.querySelector(`#select-${itemId}`);
            return select ? select.value : null;
        }
        
        case 'group_selection': {
            const checkedInputs = element.querySelectorAll('input[type="checkbox"]:checked');
            return Array.from(checkedInputs).map(input => input.value);
        }
        
        case 'switch_select': {
            const select = element.querySelector(`#select-${itemId}`);
            return select ? select.value : null;
        }
        
        default:
            console.warn(`Unknown input type: ${itemType} for item: ${itemId}`);
            return null;
    }
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
                    
                    if (activeBtn.dataset.status === 'byttet') {
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
                
            case 'switch_select':
                const select = document.getElementById(`select-${item.id}`);
                if (select) value = select.value;
                break;
            case 'timer':
                const timerDisplay = element.querySelector('.timer-display');
                const timerData = element.dataset.timerData;
                value = timerData ? JSON.parse(timerData) : { elapsed: 0 };
                break;

            case 'multi_checkbox':
                const checkedBoxes = element.querySelectorAll('input[type="checkbox"]:checked');
                value = Array.from(checkedBoxes).map(cb => cb.value);
                break;

            case 'rengjort_ikke_rengjort':
                const activeRengjortBtn = element.querySelector('.status-btn.active');
                value = activeRengjortBtn ? activeRengjortBtn.dataset.status : null;
                break;

            case 'image_only':
                // Images håndteres separat via bildeopplasting
                value = { hasImages: element.querySelector('.image-only-container img') ? true : false };
                break;

            case 'dropdown':
                const dropdownSelect = element.querySelector('select');
                value = dropdownSelect ? dropdownSelect.value : '';
                break;
            
            case 'virkningsgrad':
                const t2 = document.getElementById(`t2-${item.id}`);
                const t3 = document.getElementById(`t3-${item.id}`);
                const t7 = document.getElementById(`t7-${item.id}`);
                const result = document.getElementById(`result-${item.id}`);
                
                value = {
                    t2: t2 ? parseFloat(t2.value) || null : null,
                    t3: t3 ? parseFloat(t3.value) || null : null,
                    t7: t7 ? parseFloat(t7.value) || null : null,
                    virkningsgrad: result ? result.textContent.replace('%', '') : null
                };
                break;

            // NEW INPUT TYPES DATA COLLECTION:
        }
        
        if (value !== null) {
            data[item.id] = value;
        }
        
        // Handle subpoints recursively
        if (item.hasSubpoints && item.subpoints) {
            Object.assign(data, collectChecklistData(item.subpoints));
        }
    });
    
    return data;
}

function collectProductData() {
    const products = [];
    document.querySelectorAll('#product-lines-container .product-item').forEach(item => {
        const name = item.querySelector('.product-name').value;
        const quantity = item.querySelector('.product-quantity').value;
        const price = item.querySelector('.product-price').value;
        
        if (name && quantity) {
            products.push({ name, quantity, price });
        }
    });
    return products;
}

function collectAdditionalWorkData() {
    const work = [];
    document.querySelectorAll('#additional-work-lines-container .work-item').forEach(item => {
        const description = item.querySelector('.work-description').value;
        const hours = item.querySelector('.work-hours').value;
        const price = item.querySelector('.work-price').value;
        
        if (description && hours) {
            work.push({ description, hours, price });
        }
    });
    return work;
}

function collectDriftScheduleData() {
    const schedule = {};
    const table = document.querySelector('.drift-schedule-table');
    if (!table) return null;
    
    table.querySelectorAll('tbody tr').forEach(row => {
        const day = row.cells[0].textContent;
        const inputs = row.querySelectorAll('input');
        
        schedule[day] = {
            Start: inputs[0].value,
            Stopp: inputs[1].value
        };
    });
    
    return schedule;
}

async function deleteChecklist(index) {
    setLoading(true);
    
    // Remove from state
    state.serviceReport.reportData.components.splice(index, 1);
    
    try {
        // Save updated report to server
        await api.put(`/reports/${state.serviceReport.reportId}`, {
            orderId: state.orderId,
            equipmentId: state.equipmentId,
            reportData: state.serviceReport.reportData
        });
        
        // Update UI
        renderComponentList();
        updatePageFooterVisibility();
        updateFinalizeButtonState();
        showToast('Sjekkliste slettet!', 'success');
        
    } catch (error) {
        showToast(`Kunne ikke slette: ${error.message}`, 'error');
        // TODO: Revert state if save fails?
    } finally {
        setLoading(false);
    }
}

function addProductLine(product = {}) {
    const container = document.getElementById('product-lines-container');
    if (!container) return;
    
    const line = document.createElement('div');
    line.className = 'product-item';
    line.innerHTML = `
        <input type="text" class="product-name" placeholder="Produktnavn" value="${product.name || ''}">
        <input type="number" class="product-quantity" placeholder="Antall" value="${product.quantity || ''}">
        <input type="number" class="product-price" placeholder="Pris" value="${product.price || ''}">
        <button type="button" class="remove-line-btn" data-action="remove-line" title="Fjern produkt"></button>
    `;
    container.appendChild(line);
}


function addAdditionalWorkLine(work = {}) {
    const container = document.getElementById('additional-work-lines-container');
    if (!container) return;
    
    const line = document.createElement('div');
    line.className = 'work-item';
    line.innerHTML = `
        <input type="text" class="work-description" placeholder="Beskrivelse" value="${work.description || ''}">
        <div class="work-item-bottom">
            <input type="number" class="work-hours" placeholder="Timer" value="${work.hours || ''}">
            <input type="number" class="work-price" placeholder="Pris" value="${work.price || ''}">
            <button type="button" class="remove-line-btn" data-action="remove-line" title="Fjern arbeid"></button>
        </div>
    `;
    container.appendChild(line);
}

function isChecklistComplete(component) {
    console.log('🔍🔍🔍 === CHECKING COMPLETION FOR COMPONENT ===');
    console.log('Component received:', component);
    
    if (!component) {
        console.log('❌ No component provided');
        return false;
    }
    
    if (!component.checklist) {
        console.log('❌ No checklist in component');
        console.log('Component keys:', Object.keys(component));
        return false;
    }

    const checklist = component.checklist;
    console.log('🔍 Checklist object:', checklist);
    console.log('🔍 Checklist keys:', Object.keys(checklist));
    
    let allComplete = true;
    let completionDetails = {};

    // Check each item in the checklist
    Object.entries(checklist).forEach(([itemId, result]) => {
        console.log(`🔍 Item "${itemId}":`, {
            value: result,
            type: typeof result,
            isNull: result === null,
            isUndefined: result === undefined,
            isEmpty: result === '',
            isFalsy: !result
        });
        
        // Define what counts as "incomplete"
        const isIncomplete = (
            result === null || 
            result === undefined || 
            result === '' || 
            result === false
        );
        
        if (isIncomplete) {
            console.log(`❌ Item "${itemId}" is INCOMPLETE - value:`, result);
            allComplete = false;
            completionDetails[itemId] = { status: 'incomplete', value: result, reason: 'Empty or falsy value' };
        } else {
            console.log(`✅ Item "${itemId}" is COMPLETE - value:`, result);
            completionDetails[itemId] = { status: 'complete', value: result };
        }
    });

    console.log('🔍 === COMPLETION SUMMARY ===');
    console.log('All complete:', allComplete);
    console.log('Details:', completionDetails);
    console.log('Total items:', Object.keys(checklist).length);
    console.log('Completed items:', Object.values(completionDetails).filter(item => item.status === 'complete').length);
    console.log('=================================');

    return allComplete;
}

function updateFinalizeButtonState() {
    const btn = document.getElementById('finalize-report-btn');
    if (!btn) return;
    
    const allComponents = state.serviceReport.reportData.components;
    
    if (!allComponents || allComponents.length === 0) {
        btn.disabled = true;
        btn.title = 'Du må fullføre minst én sjekkliste før du kan ferdigstille.';
        return;
    }
    
    const allComplete = allComponents.every(isChecklistComplete);
    
    btn.disabled = !allComplete;
    btn.title = allComplete ? 'Ferdigstill og generer rapport' : 'Alle sjekklister må være komplett før ferdigstilling.';
}

async function finalizeAnlegg() {
    // Sjekk at minst en sjekkliste er lagret
    if (state.serviceReport.reportData.components.length === 0) {
        showToast("Du må lagre minst én sjekkliste før ferdigstilling.", 'error');
        return;
    }
    
    if (!confirm('Er du sikker på at du vil ferdigstille dette anlegget?\n\nDu kan ikke gjøre endringer etterpå.')) {
        return;
    }
    
    setLoading(true);
    
    try {
        // Lagre overall comment først
        const overallComment = document.getElementById('overall-comment')?.value || '';
        state.serviceReport.reportData.overallComment = overallComment;
        
        // Lagre endelig rapport
        await api.put(`/reports/${state.serviceReport.reportId}`, {
            orderId: state.orderId,
            equipmentId: state.equipmentId,
            reportData: state.serviceReport.reportData
        });
        
        // Oppdater equipment status til "completed"
        const equipmentResponse = await fetch(`/api/equipment/${state.equipmentId}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ 
                serviceStatus: 'completed' 
            })
        });
        
        if (!equipmentResponse.ok) {
            const errorData = await equipmentResponse.json();
            throw new Error(errorData.error || 'Kunne ikke oppdatere anlegg-status');
        }
        
        // Oppdater lokal state
        state.equipment.serviceStatus = 'completed';
        
        // Vis suksess-melding
        showToast('✅ Anlegg ferdigstilt!', 'success');
        
        // Kort pause så bruker ser meldingen
        setTimeout(() => {
            // Naviger tilbake til ordren
            window.location.href = `orders.html?id=${state.orderId}`;
        }, 1500);
        
    } catch (error) {
        console.error('Error finalizing equipment:', error);
        showToast(`❌ Kunne ikke ferdigstille: ${error.message}`, 'error');
        setLoading(false);
    }
}

function showFinalizeConfirmation(pdfUrl) {
    const modal = document.createElement('div');
    modal.className = 'finalize-modal';
    modal.innerHTML = `
        <div class="modal-content">
            <h3>Rapport ferdigstilt!</h3>
            <p>Servicerapporten er nå låst og PDF er generert.</p>
            <a href="${pdfUrl}" target="_blank" class="btn-primary">Åpne PDF</a>
            <button id="close-modal-btn" class="btn-secondary">Lukk</button>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    document.getElementById('close-modal-btn').addEventListener('click', () => {
        modal.remove();
        // Redirect back to order page
        window.location.href = `orders.html?id=${state.orderId}`;
    });
}

function setLoading(isLoading) {
    const loader = document.getElementById('loader');
    if (loader) {
        loader.style.display = isLoading ? 'flex' : 'none';
    }
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('show');
    }, 100);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            toast.remove();
        }, 500);
    }, 5000);
}

// Photo upload functionality
document.addEventListener('click', function(e) {
    // Fiks photo button clicks
    if (e.target.closest('.photo-option')) {
        e.preventDefault();
        e.stopPropagation();
        
        const option = e.target.closest('.photo-option');
        const action = option.dataset.action;
        
        // Find parent container to determine context
        const avvikContainer = option.closest('.avvik-container');
        const attachmentsSection = option.closest('#attachments-section');
        
        let photoContext = null;
        
        if (avvikContainer) {
            // Avvik context
            const avvikId = avvikContainer.id; // e.g., "avvik-item3"
            photoContext = {
                type: 'avvik',
                container: avvikContainer,
                avvikId: avvikId,
                itemId: avvikId.replace('avvik-', '') // e.g., "item3"
            };
        } else if (attachmentsSection) {
            // General context
            photoContext = {
                type: 'general',
                container: attachmentsSection
            };
        }
        
        if (photoContext) {
            currentPhotoContext = photoContext;
            console.log('📷 Photo context set:', photoContext);
            
            // Hide dropdown
            const dropdown = option.closest('.photo-dropdown');
            if (dropdown) {
                dropdown.style.opacity = '0';
                dropdown.style.visibility = 'hidden';
            }
            
            // Trigger photo action
            openPhotoOption(action);
        } else {
            console.error('Could not find parent container for photo option.');
        }
    }
});

document.addEventListener('click', function(e) {
    // Håndter photo button clicks for å vise/skjule dropdown
    if (e.target.closest('.photo-btn')) {
        e.preventDefault();
        e.stopPropagation();
        
        const btn = e.target.closest('.photo-btn');
        const dropdown = btn.nextElementSibling;
        
        if (dropdown && dropdown.classList.contains('photo-dropdown')) {
            // Toggle dropdown
            const isVisible = dropdown.style.visibility === 'visible';
            
            // Lukk alle andre dropdowns først
            document.querySelectorAll('.photo-dropdown').forEach(dd => {
                dd.style.opacity = '0';
                dd.style.visibility = 'hidden';
            });
            
            if (!isVisible) {
                dropdown.style.opacity = '1';
                dropdown.style.visibility = 'visible';
            }
        }
    }
});

// Lukk dropdowns når man klikker utenfor
document.addEventListener('click', function(e) {
    if (!e.target.closest('.photo-dropdown-wrapper')) {
        document.querySelectorAll('.photo-dropdown').forEach(dd => {
            dd.style.opacity = '0';
            dd.style.visibility = 'hidden';
        });
    }
});

// Upload image to server
async function uploadImageToServer(file, imageType) {
    console.log('📤 Uploading to server:', {
        filename: file.name,
        imageType: imageType,
        endpoint: imageType === 'avvik' ? '/api/images/avvik' : '/api/images/general'
    });

    const formData = new FormData();
    formData.append('image', file);
    formData.append('orderId', state.order.id);
    formData.append('equipmentId', state.equipment.id);
    formData.append('reportId', state.serviceReport.reportId);

    // For avvik-bilder, legg til avvikId
    if (imageType === 'avvik' && currentPhotoContext?.itemId) {
        formData.append('avvikId', currentPhotoContext.itemId);
        
        console.log('📷 Avvik detaljer:', {
            itemId: currentPhotoContext.itemId,
            context: currentPhotoContext
        });
    }

    const endpoint = imageType === 'avvik' ? '/api/images/avvik' : '/api/images/general';
    console.log('📤 Using endpoint:', endpoint);

    const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        body: formData
    });

    if (!response.ok) {
        const errorText = await response.text();
        let errorMessage;
        try {
            const errorData = JSON.parse(errorText);
            errorMessage = errorData.error || `HTTP ${response.status}`;
        } catch {
            errorMessage = `HTTP ${response.status}: ${errorText}`;
        }
        throw new Error(errorMessage);
    }

    
    const result = await response.json();
    console.log('📤 Upload result:', result);

    // Mark as having uploaded images (triggers navigation guard)
    changeTracker.hasUploadedImages = true;
    markFormAsDirty();

    return result;
}



// Separat funksjon for å håndtere foto-filer
async function handlePhotoFile(file) {
    console.log('📷 File selected:', file.name);
    console.log('📷 Current context:', currentPhotoContext);
    
    // Sjekk at vi har nødvendig data
    if (!state.order?.id || !state.equipment?.id || !state.serviceReport?.reportId) {
        showToast('❌ Feil: Mangler ordre- eller anleggsdata. Prøv å laste siden på nytt.', 'error');
        return;
    }
    
    // Bestem bildetype basert på lagret kontekst
    const imageType = currentPhotoContext?.type || 'general';
    
    console.log('📷 Image type determined:', imageType);
    
    try {
        // Vis loading melding
        showToast(`⏳ Laster opp ${imageType === 'avvik' ? 'avviksbilde' : 'bilde'}...`, 'info');
        
        // Last opp bildet
        const uploadResult = await uploadImageToServer(file, imageType);
        
        if (uploadResult.imageUrl) {
            // Vis bildet i UI
            if (imageType === 'avvik' && currentPhotoContext?.itemId) {
                await displayAvvikImage(currentPhotoContext.itemId, uploadResult.imageUrl);
            } else {
                await displayGeneralImage(uploadResult.imageUrl);
            }
            
            showToast('✅ Bilde lastet opp!', 'success');
        }
    } catch (error) {
        console.error('❌ Feil ved opplasting:', error);
        showToast('❌ Kunne ikke laste opp bilde: ' + error.message, 'error');
    }
}

async function openPhotoOption(type) {
    console.log('📷 Opening photo option:', type, 'Context:', currentPhotoContext);
    
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (type === 'camera') input.capture = 'environment';
    
    input.onchange = async (e) => {
        if (e.target.files[0]) {
            const file = e.target.files[0];
            console.log('📷 File selected:', file.name);
            console.log('📷 Current context:', currentPhotoContext);
            
            // Sjekk at vi har nødvendig data
            if (!state.order?.id || !state.equipment?.id || !state.serviceReport?.reportId) {
                showToast('❌ Feil: Mangler ordre- eller anleggsdata. Prøv å laste siden på nytt.', 'error');
                return;
            }
            
            // Bestem bildetype basert på lagret kontekst
            const imageType = currentPhotoContext?.type || 'general';
            
            console.log('📷 Image type determined:', imageType);
            
            try {
                // Vis loading melding
                showToast(`⏳ Laster opp ${imageType === 'avvik' ? 'avvik-' : ''}bilde...`, 'info');
                
                const result = await uploadImageToServer(file, imageType);
                
                if (result.success) {
                    if (imageType === 'avvik' && result.avvikNumber) {
                        showToast(`✅ Avvik #${result.formattedAvvikNumber} bilde lastet opp!`, 'success');
                        // Refresh avvik images
                        setTimeout(() => renderAvvikImagesForChecklist(), 1000);
                    } else {
                        showToast(`✅ Rapport-bilde lastet opp!`, 'success');
                        // Refresh general images  
                        setTimeout(() => {
                            // Reload general images directly
                            renderGeneralImages();
                        }, 1000);
                    }
                } else {
                    showToast(`❌ Opplasting feilet: ${result.error || 'Ukjent feil'}`, 'error');
                }
            } catch (error) {
                console.error('📷 Photo upload error:', error);
                showToast(`❌ Feil ved opplasting: ${error.message}`, 'error');
            }
        }
    };
    
    // Trigger file selection
    input.click();
}

function addImageToUIGallery(imageUrl, type, itemId) {
    let container;
    
    if (type === 'avvik') {
        container = document.getElementById(`avvik-images-container-${itemId}`);
    } else if (type === 'byttet') {
        container = document.getElementById(`byttet-images-container-${itemId}`);
    } else if (type === 'image_only') {
        container = document.getElementById(`image-only-container-${itemId}`);
    }
    
    if (!container) {
        console.error(`UI container not found for type ${type} and itemId ${itemId}`);
        return;
    }
    
    const imgElement = document.createElement('img');
    imgElement.src = imageUrl;
    imgElement.className = 'gallery-thumbnail';
    imgElement.onclick = () => showImageModal(imageUrl);
    
    container.appendChild(imgElement);
}

function showImageModal(imageUrl) {
    const modal = document.createElement('div');
    modal.className = 'image-modal';
    modal.innerHTML = `
        <div class="modal-content">
            <span class="close-modal">&times;</span>
            <img src="${imageUrl}" class="modal-image">
        </div>
    `;
    
    document.body.appendChild(modal);
    
    modal.querySelector('.close-modal').onclick = () => modal.remove();
    modal.onclick = (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    };
}

async function loadAndRenderImages() {
    if (!state.serviceReport || !state.serviceReport.reportId) {
        console.log("No report ID, skipping image load.");
        return;
    }
    
    try {
        const images = await api.get(`/images/report/${state.serviceReport.reportId}`);
        console.log('Loaded images:', images);
        
        // Clear existing images from UI
        document.querySelectorAll('.avvik-images-container, .image-only-container').forEach(c => c.innerHTML = '');
        
        // Render images
        images.forEach(img => {
            addImageToUIGallery(img.url, img.type, img.item_id);
        });
        
    } catch (error) {
        console.error("Could not load images for report:", error);
        // Don't show a toast for this, it's a background task
    }
}

async function renderAvvikImagesForChecklist() {
    console.log('🖼️ Rendering avvik images for checklist items');
    
    // Hent ALLE avvik-bilder for rapporten (ikke per item)
    try {
        const avvikImages = await api.get(`/images/avvik/${state.serviceReport.reportId}`);
        console.log('📸 All avvik images:', avvikImages);
        
        if (Array.isArray(avvikImages)) {
            // Group images by checklist_item_id
            const imagesByAvvik = {};
            avvikImages.forEach(img => {
                const itemId = img.checklist_item_id;
                if (itemId) {
                    if (!imagesByAvvik[itemId]) {
                        imagesByAvvik[itemId] = [];
                    }
                    imagesByAvvik[itemId].push(img);
                }
            });
            
            // Render images for each avvik container
            Object.entries(imagesByAvvik).forEach(([itemId, images]) => {
                const containerId = `avvik-images-container-${itemId}`;
                const container = document.getElementById(containerId);
                
                if (container && images.length > 0) {
                    container.innerHTML = images.map((img, index) => `
                        <div class="avvik-image-wrapper">
                            <img src="${img.image_url}" alt="Avvik ${img.avvik_number}" onclick="openImageModal('${img.image_url}', 'Avvik #${img.avvik_number}')">
                            <button class="image-remove-btn" onclick="removeAvvikImage('${itemId}', '${img.id}')" title="Fjern bilde">×</button>
                        </div>
                    `).join('');
                }
            });
        }
    } catch (error) {
        console.log('Error loading avvik images:', error.message);
    }
}

// Render general images
async function renderGeneralImages() {
    try {
        const generalResponse = await fetch(`/api/images/general/${state.serviceReport.reportId}`, {
            credentials: 'include'
        });
        
        if (generalResponse.ok) {
            const generalImages = await generalResponse.json();
            console.log('📸 Reloaded general images:', generalImages);
            
            // Clear and rebuild general gallery
            const container = document.getElementById('general-images-gallery');
            if (container && generalImages.length > 0) {
                container.innerHTML = generalImages.map((img, index) => `
                    <div class="image-thumbnail" onclick="openImageModal('${img.image_url}', 'Bilde ${index + 1}')">
                        <img src="${img.image_url}" alt="Bilde ${index + 1}" loading="lazy">
                        <div class="image-info">
                            <span class="image-title">Bilde ${index + 1}</span>
                        </div>
                    </div>
                `).join('');
                
                // Show attachments section
                const attachmentsSection = document.getElementById('attachments-section');
                if (attachmentsSection) {
                    attachmentsSection.style.display = 'block';
                }
            }
        }
    } catch (error) {
        console.log('Error reloading general images:', error.message);
    }
}

// Simple image modal
function openImageModal(imageUrl, imageTitle) {
    // Create modal if it doesn't exist
    let modal = document.getElementById('imageModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'imageModal';
        modal.innerHTML = `
            <div class="modal-overlay" onclick="closeImageModal()" style="
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0,0,0,0.8); display: flex; align-items: center;
                justify-content: center; z-index: 10000;">
                <div onclick="event.stopPropagation()" style="
                    position: relative; max-width: 90vw; max-height: 90vh;
                    background: white; border-radius: 8px; overflow: hidden;">
                    <span onclick="closeImageModal()" style="
                        position: absolute; top: 10px; right: 15px; color: white;
                        font-size: 24px; cursor: pointer; z-index: 1;
                        background: rgba(0,0,0,0.5); width: 30px; height: 30px;
                        border-radius: 50%; display: flex; align-items: center;
                        justify-content: center;">&times;</span>
                    <img id="modalImage" src="" style="width: 100%; height: auto; display: block;">
                    <div id="modalTitle" style="padding: 12px; background: #f8f9fa; text-align: center; font-weight: 500;"></div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    
    // Show image
    document.getElementById('modalImage').src = imageUrl;
    document.getElementById('modalTitle').textContent = imageTitle;
    modal.style.display = 'flex';
}

function closeImageModal() {
    const modal = document.getElementById('imageModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Initialize the page when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', initializePage);
