// Global state for change tracking
const changeTracker = {
    hasUnsavedChanges: false
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
async function saveAndContinue(targetUrl) {
    console.log('🔄 saveAndContinue kallt med targetUrl:', targetUrl);
    
    try {
        // 1. Lagre komponenten hvis vi er i redigeringsmodus
        if (state.editingComponentIndex !== null) {
            console.log('💾 Lagrer eksisterende komponent...');
            const componentData = collectComponentData();
            state.serviceReport.reportData.components[state.editingComponentIndex] = componentData;
            
            const updateData = {
                components: state.serviceReport.reportData.components,
                overallComment: state.serviceReport.reportData.overallComment || ''
            };
            
            await api.put(`/reports/${state.serviceReport.reportId}`, {
                orderId: state.orderId,
                equipmentId: state.equipmentId,
                reportData: updateData
            });
        }
        
        // 2. Lagre overall comment hvis den finnes
        const overallComment = document.getElementById('overall-comment')?.value || '';
        if (overallComment.trim() !== '') {
            state.serviceReport.reportData.overallComment = overallComment;
            
            const updateData = {
                components: state.serviceReport.reportData.components,
                overallComment: overallComment
            };
            
            await api.put(`/reports/${state.serviceReport.reportId}`, {
                orderId: state.orderId,
                equipmentId: state.equipmentId,
                reportData: updateData
            });
            
            console.log('💬 Overall comment saved');
        }
        
        // 3. Merk som clean og naviger
        markFormAsClean();
        
        // NYTT: Eksplisitt nullstill changeTracker for å unngå beforeunload warning
        changeTracker.hasUnsavedChanges = false;
        changeTracker.uploadedImages = [];
        
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

//Oppdater også saveComponent funksjonen
async function saveComponent() {
    const componentData = collectComponentData();
    
    // Add or update component
    if (state.editingComponentIndex === null) {
        state.serviceReport.reportData.components.push(componentData);
    } else {
        state.serviceReport.reportData.components[state.editingComponentIndex] = componentData;
    }
    
    try {
        // VIKTIG: Ikke send photos med i PUT request for komponenter
        const updateData = {
            components: state.serviceReport.reportData.components,
            overallComment: state.serviceReport.reportData.overallComment || ''
        };
        
        await api.put(`/reports/${state.serviceReport.reportId}`, {
            orderId: state.orderId,
            equipmentId: state.equipmentId,
            reportData: updateData  // Send kun components og overallComment
        });

        // Oppdater lokal equipment status hvis første sjekkliste
        if (state.serviceReport.reportData.components.length === 1 && 
            (!state.equipment.serviceStatus || state.equipment.serviceStatus === 'not_started')) {
            state.equipment.serviceStatus = 'in_progress';
            renderAnleggInfo(); // Re-render anleggsinfo for å vise ny status
        }
        
        // Update UI
        renderComponentList();
        resetForm();
        showToast('Sjekkliste lagret', 'success');
        
        // Mark form as clean
        markFormAsClean();
        
    } catch (error) {
        console.error('Error saving component:', error);
        showToast(`Kunne ikke lagre: ${error.message}`, 'error');
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
    const isValid = validateRequiredFields();
    
    if (!isValid) {
        showToast('❌ Fyll ut alle obligatoriske felter før lagring', 'error');
        return;
    }
    
    try {
        // Auto-lagre alt
        await autoSaveEverything();
        
        // Lukk modal og naviger
        closeSavePrompt();
        
        showToast('✅ Alt er lagret!', 'success');
        
        if (targetUrl && targetUrl !== 'null' && targetUrl !== '') {
            setTimeout(() => {
                window.location.href = targetUrl;
            }, 500);
        }
        
    } catch (error) {
        console.error('Error in saveAndContinue:', error);
        showToast('❌ Kunne ikke lagre: ' + error.message, 'error');
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

// Global variabel for å holde styr på hvilken knapp som ble klikket
let currentPhotoContext = null;

// Global variabel for bildegallerier
const imageGallery = {
    general: [],
    avvik: []
};


// Navigation guard - prevent accidental navigation
window.addEventListener('beforeunload', function(e) {
    // Sjekk om vi faktisk har ulagrede endringer
    if (changeTracker.hasUnsavedChanges || (changeTracker.uploadedImages && changeTracker.uploadedImages.length > 0)) {
        e.preventDefault();
        e.returnValue = 'Du har ulagrede endringer. Er du sikker på at du vil forlate siden?';
        return e.returnValue;
    }
    // Hvis ingen endringer, la navigasjon skje uten advarsel
});

// Custom navigation guard for internal links
function confirmNavigation(targetUrl) {
    if (!changeTracker.hasUnsavedChanges && !changeTracker.hasUploadedImages) {
        window.location.href = targetUrl;
        return;
    }
    
    showSavePrompt(targetUrl);
}

document.addEventListener('click', function(e) {
    // Håndter photo-option clicks
    if (e.target.closest('.photo-option')) {
        e.preventDefault();
        e.stopPropagation();
        
        const option = e.target.closest('.photo-option');
        const action = option.dataset.action;
        
        // Start fra photo-dropdown-wrapper som er nærmeste forelder
        const photoWrapper = option.closest('.photo-dropdown-wrapper');
        
        let photoContext = null;
        
        if (photoWrapper) {
            // Sjekk om wrapper er inne i avvik-container
            const avvikContainer = photoWrapper.closest('.avvik-container');
            const byttetContainer = photoWrapper.closest('.byttet-container');
            if (byttetContainer) {
                const byttetId = byttetContainer.id; // e.g., "byttet-item3"
                photoContext = {
                    type: 'avvik',  // ← ENDRET FRA 'byttet' TIL 'avvik'
                    container: byttetContainer,
                    byttetId: byttetId,
                    itemId: byttetId.replace('byttet-', '')
                };
                console.log('📷 Byttet photo context (using avvik type):', photoContext);
            }
            if (avvikContainer) {
                const avvikId = avvikContainer.id; // e.g., "avvik-item3"
                photoContext = {
                    type: 'avvik',
                    container: avvikContainer,
                    avvikId: avvikId,
                    itemId: avvikId.replace('avvik-', '')
                };
                console.log('📷 Avvik photo context:', photoContext);
            }
        }
        
        // Hvis vi IKKE er i avvik, sjekk om det er generelle bilder
        if (!photoContext) {
            const attachmentsSection = option.closest('#attachments-section');
            if (attachmentsSection) {
                photoContext = {
                    type: 'general',
                    container: attachmentsSection
                };
                console.log('📷 General photo context:', photoContext);
            }
        }
        
        if (photoContext) {
            currentPhotoContext = photoContext;
            
            // Skjul dropdown
            const dropdown = option.closest('.photo-dropdown');
            if (dropdown) {
                dropdown.style.opacity = '0';
                dropdown.style.visibility = 'hidden';
            }
            
            // Trigger photo action
            openPhotoOption(action);
        } else {
            console.error('Could not find parent container for photo option.');
            console.error('Debug info:', {
                photoWrapper: photoWrapper,
                closestAvvik: photoWrapper?.closest('.avvik-container'),
                closestAttachments: option.closest('#attachments-section')
            });
            showToast('Kunne ikke finne bildecontainer. Prøv igjen.', 'error');
        }
    }
});

// Lukk dropdowns når man klikker utenfor - BEHOLD DENNE
document.addEventListener('click', function(e) {
    if (!e.target.closest('.photo-dropdown-wrapper')) {
        document.querySelectorAll('.photo-dropdown').forEach(dd => {
            dd.style.opacity = '0';
            dd.style.visibility = 'hidden';
        });
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
    changeTracker.uploadedImages = [];
    
    // Fjern eventuelle advarsler i UI
    const saveBtn = document.getElementById('save-component-btn');
    if (saveBtn) {
        saveBtn.style.background = '#28a745'; // Grønn for lagret
        saveBtn.textContent = '💾 Lagre sjekkliste';
    }
    
    console.log('📝 Form marked as clean');
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
    request: async (endpoint, options = {}) => {
        try {
            const response = await fetch(`/api${endpoint}`, {
                ...options,
                credentials: 'include', // KRITISK: Inkluder cookies/session
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                },
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

// Auto-save state
let autoSaveTimeout = null;
const AUTO_SAVE_DELAY = 3000; // 3 sekunder

// Debounced auto-save funksjon
function triggerAutoSave() {
    if (autoSaveTimeout) {
        clearTimeout(autoSaveTimeout);
    }
    
    autoSaveTimeout = setTimeout(async () => {
        console.log('🔄 Auto-saving checklist...');
        try {
            await saveChecklist(false); // false = ikke vis toast
            console.log('✅ Auto-save successful');
        } catch (error) {
            console.error('❌ Auto-save failed:', error);
        }
    }, AUTO_SAVE_DELAY);
}

// Setup auto-save listeners
function setupAutoSaveListeners() {
    // Lytt til endringer i alle input-felter
    document.addEventListener('input', (e) => {
        if (e.target.matches('input, textarea, select')) {
            triggerAutoSave();
        }
    });
    
    // Lytt til checkbox endringer
    document.addEventListener('change', (e) => {
        if (e.target.matches('input[type="checkbox"], input[type="radio"]')) {
            triggerAutoSave();
        }
    });
}

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
// Main initialization function
async function initializePage() {
    try {
        clearAllImageContainers();
        
        const urlParams = new URLSearchParams(window.location.search);
        const rawOrderId = urlParams.get('orderId');
        const rawEquipmentId = urlParams.get('equipmentId');
        
        state.orderId = rawOrderId;
        state.equipmentId = rawEquipmentId ? parseInt(rawEquipmentId) : null;
        
        console.log('Raw URL params:', { rawOrderId, rawEquipmentId });
        console.log('Parsed params:', { orderId: state.orderId, equipmentId: state.equipmentId });
        
        if (!state.orderId) {
            throw new Error('Mangler ordre-ID i URL. Bruk: service.html?orderId=XXX&equipmentId=YYY');
        }
        
        if (!state.equipmentId || isNaN(state.equipmentId)) {
            throw new Error('Mangler eller ugyldig anlegg-ID i URL. Bruk: service.html?orderId=XXX&equipmentId=YYY');
        }
        
        console.log('Initializing with:', { orderId: state.orderId, equipmentId: state.equipmentId });
        
        state.order = {
            id: state.orderId,
            orderNumber: state.orderId,
            customer: {
                name: 'Laster...' // Will be updated in loadEquipmentData
            }
        };

        // Load all necessary data in parallel
        const [equipment, technician] = await Promise.all([
            loadEquipmentData(state.equipmentId),
            loadTechnician()
        ]);
        
        state.equipment = equipment;
        state.technician = technician;
        
        // FLYTT renderHeader HIT - ETTER at state.equipment er satt
        renderHeader();
        
        // Load or create service report
        await loadServiceReport();
        
        // Setup event listeners
        setupEventListeners();
        
        // Render everything
        renderAll();
        
        // Setup auto-save listeners
        setupAutoSaveListeners();
        
    } catch (error) {
        console.error('Initialization error:', error);
        showToast(error.message || 'Kunne ikke laste siden', 'error');
        setLoading(false);
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
        const response = await api.get(`/equipment/${equipmentId}`);
        console.log('Equipment API response:', response);
        
        // MIDLERTIDIG FIX: Hvis tom array, prøv alternativ endpoint
        if (Array.isArray(response) && response.length === 0) {
            console.warn('Got empty array, trying to load from order data...');
            // Returner dummy data for testing
            return {
                id: equipmentId,
                systemtype: 'ventilasjonsaggregat', // HARDKODET FOR TEST
                systemnummer: 'N/A',
                systemnavn: 'N/A',
                plassering: 'N/A'
            };
        }
        
        // Hvis array med data, ta første
        const equipment = Array.isArray(response) ? response[0] : response;
        
        if (!equipment) {
            throw new Error('Equipment ikke funnet');
        }
        
        return equipment;
    } catch (error) {
        console.error('Error loading equipment:', error);
        throw error;
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
            
            // ✅ FIX: Backend returnerer data DIREKTE i reportData-nøkkelen
            const backendReportData = reportResponse.reportData || reportResponse.report_data || {};
            
            console.log('📊 Backend reportData keys:', Object.keys(backendReportData));
            console.log('📊 Backend reportData content:', backendReportData);
            
            state.serviceReport = {
                id: reportResponse.id,
                reportId: reportResponse.id,
                orderId: reportResponse.order_id || reportResponse.orderId,
                equipmentId: reportResponse.equipment_id || reportResponse.equipmentId,
                technicianId: reportResponse.technician_id,
                reportData: backendReportData,  // ← VIKTIG: Bruk den parsed dataen
                status: reportResponse.status,
                createdAt: reportResponse.created_at || reportResponse.createdAt,
                updatedAt: reportResponse.updated_at || reportResponse.updatedAt
            };
            
            // VIKTIG: Sørg for at avvikNumbers eksisterer i reportData
            if (!state.serviceReport.reportData.avvikNumbers) {
                state.serviceReport.reportData.avvikNumbers = {};
            }
            
            console.log('✅ Loaded existing report with reportId:', state.serviceReport.reportId);
            console.log('✅ Report data structure:', {
                hasChecklist: !!state.serviceReport.reportData.checklist,
                hasSystemData: !!state.serviceReport.reportData.systemData,
                checklistKeys: state.serviceReport.reportData.checklist ? Object.keys(state.serviceReport.reportData.checklist) : []
            });
            
        } else {
            // Create new report
            const newReportId = `RPT-${state.orderId}-${state.equipmentId}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            
            try {
                const createResponse = await api.post('/reports', {
                    reportId: newReportId,
                    orderId: state.orderId,
                    equipmentId: state.equipmentId,
                    reportData: {
                        checklist: {},
                        systemData: {},
                        systemFields: {},
                        products: [],
                        additionalWork: [],
                        overallComment: '',
                        avvikNumbers: {}
                    }
                });
                
                state.serviceReport = {
                    id: createResponse.id,
                    reportId: createResponse.id,
                    orderId: state.orderId,
                    equipmentId: state.equipmentId,
                    reportData: createResponse.reportData || createResponse.report_data || {
                        checklist: {},
                        systemData: {},
                        systemFields: {},
                        products: [],
                        additionalWork: [],
                        overallComment: '',
                        avvikNumbers: {}
                    },
                    status: 'draft'
                };
                
                console.log('Created new report with ID:', state.serviceReport.reportId);
                
            } catch (error) {
                console.error('Failed to create new report:', error);
                showToast('Kunne ikke opprette ny rapport. Prøv igjen.', 'error');
                throw error;
            }
        }
        
        // DEBUGGING: Verifiser at reportId er satt
        console.log('🔍 FINAL SERVICE REPORT STATE:', {
            hasReportId: !!state.serviceReport.reportId,
            reportId: state.serviceReport.reportId,
            hasChecklist: !!state.serviceReport.reportData?.checklist,
            checklistKeys: state.serviceReport.reportData?.checklist ? Object.keys(state.serviceReport.reportData.checklist) : []
        });

        // Last checklist template basert på equipment type
if (state.equipment?.systemtype) {
    try {
        console.log('🔧 Loading checklist template for type:', state.equipment.systemtype);
        const response = await api.get('/checklist-templates');
        
        // HÅNDTER BEGGE FORMATER
        let templates = [];
        if (Array.isArray(response)) {
            templates = response;
        } else if (response.facilityTypes && Array.isArray(response.facilityTypes)) {
            // Gammel format - konverter
            templates = response.facilityTypes.map(ft => ({
                name: ft.name,
                equipment_type: ft.id,
                template_data: ft
            }));
        }
        
        console.log('📋 Available templates:', templates.map(t => t.equipment_type));
        
        const template = templates.find(t => 
            t.equipment_type === state.equipment.systemtype
        );
        
        if (template) {
            state.checklistTemplate = template.template_data || template;
            console.log('✅ Loaded template:', state.checklistTemplate);
        } else {
            console.error('❌ No template found for type:', state.equipment.systemtype);
            console.log('Available types:', templates.map(t => t.equipment_type));
        }
    } catch (error) {
        console.error('Error loading checklist template:', error);
    }
} else {
    console.error('❌ No equipment systemtype available');
}
        
    } catch (error) {
        console.error('Error loading service report:', error);
        throw error;
    }
}

function renderAll() {
    console.log("Rendering all components...");
    // clearAllImageContainers(); // Ikke nødvendig - cleares allerede i initialize()
    
    try { renderHeader(); } catch (e) { console.error('Error in renderHeader:', e); }
    try { renderAnleggInfo(); } catch (e) { console.error('Error in renderAnleggInfo:', e); }
    try { renderComponentList(); } catch (e) { console.error('Error in renderComponentList:', e); }
    try { renderComponentDetailsForm(); } catch (e) { console.error('Error in renderComponentDetailsForm:', e); }
    try { renderChecklist(); } catch (e) { console.error('Error in renderChecklist:', e); }
    try { renderSectionVisibility(); } catch (e) { console.error('Error in renderSectionVisibility:', e); }
    try { renderDriftScheduleSection(); } catch (e) { console.error('Error in renderDriftScheduleSection:', e); }
    try { resetAndLoadForm(); } catch (e) { console.error('Error in resetAndLoadForm:', e); }
    try { setupOverallCommentDetection(); } catch (e) { console.error('Error in setupOverallCommentDetection:', e); }
    
    // NYTT: Last inn eksisterende data ETTER at alt er rendret
    try { 
        // Vent litt slik at DOM er fullstendig rendret
        setTimeout(() => {
            loadExistingReportData();
        }, 100);
    } catch (e) { console.error('Error in loadExistingReportData:', e); }
    
    // Set overall comment if exists
    try {
        const overallCommentEl = document.getElementById('overall-comment');
        if (overallCommentEl) {
            overallCommentEl.value = state.serviceReport.reportData.overallComment || '';
        }
    } catch (e) { console.error('Error setting overall comment:', e); }
    
    // VIS ALLTID attachments og overall comment sections
    try {
        const attachmentsSection = document.getElementById('attachments-section');
        const overallCommentSection = document.getElementById('overall-comment-section');
        
        if (attachmentsSection) {
            attachmentsSection.style.display = 'block';
            console.log('✅ Attachments section made visible');
        }
        
        if (overallCommentSection) {
            overallCommentSection.style.display = 'block';
            console.log('✅ Overall comment section made visible');
        }
    } catch (e) { console.error('Error showing sections:', e); }
    
    try { updateFinalizeButtonState(); } catch (e) { console.error('Error in updateFinalizeButtonState:', e); }
    try { updatePageFooterVisibility(); } catch (e) { console.error('Error in updatePageFooterVisibility:', e); }
    try { renderGeneralImages(); } catch (e) { console.error('Error in renderGeneralImages:', e); }
    
    // NYTT: Last også avvik-bilder for eksisterende sjekklister
    setTimeout(() => {
        try { 
            renderAvvikImagesForChecklist(); 
            console.log('✅ Avvik images rendered for existing checklist');
        } catch (e) { 
            console.error('Error in renderAvvikImagesForChecklist:', e); 
        }
    }, 500);
}

async function renderHeader() {
    const anleggsnavn = state.equipment?.systemnavn || 'Anlegg';
    await renderAppHeader({
        backUrl: `orders.html?id=${state.orderId}`,
        subtitle: `Service - ${anleggsnavn}`,
        technician: state.technician,
        showDate: true
    });
}

function navigateBack() {
    const orderId = state.orderId;
    if (!orderId) {
        console.error('Missing orderId for navigation');
        return;
    }
    console.log('Navigating back to order:', orderId);
    window.location.href = `/app/orders.html?id=${orderId}`;
}

function renderAnleggInfo() {
    const container = document.getElementById('anlegg-info');
    if (!container) return;

    // Status badge mapping
    const getStatusBadge = (status) => {
        const statusMap = {
            'not_started': { text: 'IKKE STARTET', class: 'status-not-started' },
            'draft': { text: 'UNDER ARBEID', class: 'status-in-progress' },
            'in_progress': { text: 'UNDER ARBEID', class: 'status-in-progress' },
            'completed': { text: 'FERDIG', class: 'status-completed' }
        };
        const info = statusMap[status] || statusMap['not_started'];
        return `<span class="status-badge ${info.class}">${info.text}</span>`;
    };

    const statusBadge = state.serviceReport?.status ? 
        getStatusBadge(state.serviceReport.status) : 
        getStatusBadge('not_started');

    // Hent kundeinfo fra order
    const customerName = state.order?.customer_name || state.order?.customer?.name || 'Laster...';
    const visitAddress = state.order?.customer_data?.physicalAddress || 
                        state.order?.customer_data?.address || 
                        state.order?.visit_address || 
                        'Ikke registrert';

    // Helper for escaping HTML
    const escapeHTML = (str) => {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    };

    container.innerHTML = `
        <!-- Ordrenummer øverst i liten skrift -->
        <div style="font-size: 11px; color: #6b7280; margin-bottom: 8px;">
            Ordrenummer: ${escapeHTML(state.orderId || 'N/A')}
        </div>
        
        <!-- Header med tittel og status badge -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <h3 style="margin: 0; font-size: 18px; font-weight: 600; color: #1f2937;">Anleggsinformasjon</h3>
            ${statusBadge}
        </div>
        
        <!-- Kunde og besøksadresse (full bredde) -->
        <div style="margin-bottom: 16px;">
            <div style="margin-bottom: 12px;">
                <div style="font-size: 11px; color: #6b7280; margin-bottom: 2px;">Kunde</div>
                <div style="font-size: 14px; font-weight: 500; color: #111827;">${escapeHTML(customerName)}</div>
            </div>
            <div>
                <div style="font-size: 11px; color: #6b7280; margin-bottom: 2px;">Besøksadresse</div>
                <div style="font-size: 14px; color: #374151;">${escapeHTML(visitAddress)}</div>
            </div>
        </div>
        
        <!-- Anleggsinfo i to kolonner -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px 16px; margin-bottom: 16px;">
            <!-- Anleggstype -->
            <div>
                <div style="font-size: 11px; color: #6b7280; margin-bottom: 2px;">Anleggstype</div>
                <div style="font-size: 14px; font-weight: 500; color: #111827;">${escapeHTML(state.equipment?.systemtype || 'N/A')}</div>
            </div>
            
            <!-- Systemnummer -->
            <div>
                <div style="font-size: 11px; color: #6b7280; margin-bottom: 2px;">Systemnummer</div>
                <div style="font-size: 14px; color: #374151;">${escapeHTML(state.equipment?.systemnummer || 'N/A')}</div>
            </div>
            
            <!-- Systemnavn -->
            <div>
                <div style="font-size: 11px; color: #6b7280; margin-bottom: 2px;">Systemnavn</div>
                <div style="font-size: 14px; color: #374151;">${escapeHTML(state.equipment?.systemnavn || 'N/A')}</div>
            </div>
            
            <!-- Plassering -->
            <div>
                <div style="font-size: 11px; color: #6b7280; margin-bottom: 2px;">Plassering</div>
                <div style="font-size: 14px; color: #374151;">${escapeHTML(state.equipment?.plassering || 'N/A')}</div>
            </div>
        </div>
        
        <!-- Betjener (hvis finnes) -->
        ${state.equipment?.betjener ? `
        <div style="margin-bottom: 16px;">
            <div style="font-size: 11px; color: #6b7280; margin-bottom: 2px;">Betjener</div>
            <div style="font-size: 14px; color: #374151;">${escapeHTML(state.equipment.betjener)}</div>
        </div>
        ` : ''}
        
        <!-- Intern kommentar (hvis finnes) -->
        ${state.equipment?.notater ? `
        <div style="padding: 12px; background-color: #fffbeb; border-radius: 6px; border: 1px solid #fef3c7;">
            <div style="display: flex; align-items: center; gap: 4px; margin-bottom: 4px;">
                <span style="color: #f59e0b;">⚠️</span>
                <span style="font-size: 12px; font-weight: 600; color: #92400e;">Intern kommentar</span>
            </div>
            <div style="font-size: 13px; color: #78350f; line-height: 1.4;">${escapeHTML(state.equipment.notater)}</div>
        </div>
        ` : ''}
    `;
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
    console.log('Rendering component details form...');
    const container = document.getElementById('component-details-form');
    if (!container) {
        console.error('Component details form container not found');
        return;
    }

    // NULL-SJEKK HER
    if (!state.checklistTemplate) {
        console.warn('No checklist template loaded yet');
        container.innerHTML = '<p>Laster sjekkliste...</p>';
        return;
    }

    // Generer HTML for dynamiske systemFields
    const systemFieldsHTML = state.checklistTemplate.systemFields
        .sort((a, b) => a.order - b.order)
        .map(field => {
            const value = state.serviceReport?.reportData?.systemData?.[field.name] || '';
            const inputHtml = field.inputType === 'textarea' 
                ? `<textarea 
                    id="system-${field.name}" 
                    class="form-control" 
                    rows="3" 
                    ${field.required ? 'required' : ''}
                >${value}</textarea>`
                : `<input 
                    type="text" 
                    id="system-${field.name}" 
                    class="form-control" 
                    value="${value}" 
                    ${field.required ? 'required' : ''}
                />`;

            return `
                <div class="form-group">
                    <label for="system-${field.name}">
                        ${field.label}
                        ${field.required ? '<span class="required">*</span>' : ''}
                    </label>
                    ${inputHtml}
                </div>
            `;
        })
        .join('');

    // Kun vis Aggregat type hvis relevant
    const aggregatTypeHTML = state.equipment?.systemtype === 'ventilasjonsaggregat' 
        ? `<div class="form-group">
            <label for="aggregat-type">Aggregat type</label>
            <input type="text" id="aggregat-type" class="form-control" 
                   value="${state.equipment?.systemtype || ''}" readonly />
           </div>`
        : '';

    container.innerHTML = `
        <div class="system-details-section">
            <h3>Anleggsinformasjon</h3>
            ${aggregatTypeHTML}
            ${systemFieldsHTML}
        </div>
    `;

    console.log('Component details form rendered successfully');
}

function renderChecklist() {
    const container = document.getElementById('checklist-items-container');
    if (!container) {
        console.error("Checklist container not found");
        return;
    }
    
    // Check if there are checklist items in the template
    const hasChecklistItems = state.checklistTemplate?.checklistItems && 
                             state.checklistTemplate.checklistItems.length > 0;
    
    // clearAllImageContainers(); // Ikke nødvendig ved hver re-render
    
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

    // Chain initialization med riktig timing
    // Chain initialization med riktig timing
    setTimeout(() => {
        console.log('🎨 Step 1: Creating Lucide icons...');
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
        
        setTimeout(() => {
            console.log('📸 Step 2: Re-initializing photo handlers...');
            reinitializePhotoHandlers();
            
            // FJERNET: Automatisk bilderedering som forårsaket problemet
            console.log('✅ Checklist rendered without automatic image loading');
        }, 100);
    }, 100);
}

// Også oppdater reinitializePhotoHandlers for bedre logging
function reinitializePhotoHandlers() {
    console.log('🔄 Re-initializing photo handlers...');
    
    // Fjern gamle handlers
    if (window._photoClickHandler) {
        document.removeEventListener('click', window._photoClickHandler, true);
        console.log('✅ Old handlers removed');
    }
    
    // Setup nye handlers
    setupPhotoDropdownHandlers();
    
    // Re-create lucide icons for nye elementer
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
        console.log('✅ Lucide icons recreated');
    }
    
    // Verifiser at alt fungerer
    const photoButtons = document.querySelectorAll('.photo-btn');
    console.log(`✅ Found ${photoButtons.length} photo buttons after re-init`);
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
            return createKonsekvensgradDropdownItemHTML(item);
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
                <button type="button" class="photo-btn" style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; background: linear-gradient(135deg, #dc3545 0%, #c82333 100%); color: white; border: none; border-radius: 6px; font-size: 13px; cursor: pointer;">
                    <i data-lucide="camera"></i>Ta bilde av avvik<i data-lucide="chevron-down" style="width: 12px; height: 12px; margin-left: 4px;"></i>
                </button>
                <div class="photo-dropdown" style="position: absolute; top: 100%; left: 0; background: white; border: 1px solid #ddd; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); z-index: 1000; opacity: 0; visibility: hidden; min-width: 180px;">
                    <button class="photo-option" data-action="camera" style="display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: none; background: none; width: 100%; text-align: left; font-size: 13px; cursor: pointer;"><i data-lucide="camera"></i>Ta bilde med kamera</button>
                    <button class="photo-option" data-action="upload" style="display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: none; background: none; width: 100%; text-align: left; font-size: 13px; cursor: pointer;"><i data-lucide="upload"></i>Last opp fil</button>
                </div>
            </div>
            <div id="avvik-images-container-${item.id}" class="avvik-images-container"></div>
        </div>
        <div class="byttet-container" id="byttet-${item.id}">
            <textarea placeholder="Kommentar om filterbytte (f.eks. dato, filtertype, etc.)..."></textarea>
            <div class="photo-dropdown-wrapper" style="position: relative; display: inline-block;">
                <button type="button" class="photo-btn" style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; background: linear-gradient(135deg, #ffc107 0%, #e0a800 100%); color: #212529; border: none; border-radius: 6px; font-size: 13px; cursor: pointer;">
                    <i data-lucide="camera"></i>Ta bilde av bytte<i data-lucide="chevron-down" style="width: 12px; height: 12px; margin-left: 4px;"></i>
                </button>
                <div class="photo-dropdown" style="position: absolute; top: 100%; left: 0; background: white; border: 1px solid #ddd; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); z-index: 1000; opacity: 0; visibility: hidden; min-width: 180px;">
                    <button class="photo-option" data-action="camera" style="display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: none; background: none; width: 100%; text-align: left; font-size: 13px; cursor: pointer;"><i data-lucide="camera"></i>Ta bilde med kamera</button>
                    <button class="photo-option" data-action="upload" style="display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: none; background: none; width: 100%; text-align: left; font-size: 13px; cursor: pointer;"><i data-lucide="upload"></i>Last opp fil</button>
                </div>
            </div>
            <div id="byttet-images-container-${item.id}" class="byttet-images-container"></div>
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
        </div>
        <div class="comment-section" style="margin-top: 10px;">
            <textarea id="comment-${item.id}" placeholder="Kommentar..." class="checklist-input-textarea"></textarea>
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
            <div class="virkningsgrad-wrapper">
                <div class="virkningsgrad-inputs">
                    <div class="input-group">
                        <label>T2 (ute):</label>
                        <input type="number" id="t2-${item.id}" step="0.1" placeholder="°C" />
                    </div>
                    <div class="input-group">
                        <label>T3 (tilluft):</label>
                        <input type="number" id="t3-${item.id}" step="0.1" placeholder="°C" />
                    </div>
                    <div class="input-group">
                        <label>T7 (avtrekk):</label>
                        <input type="number" id="t7-${item.id}" step="0.1" placeholder="°C" />
                    </div>
                    <div class="result">
                        <span>Virkningsgrad: <strong id="result-${item.id}">--%</strong></span>
                    </div>
                </div>
                <div class="item-actions">
                    <button type="button" class="status-btn ok" data-status="ok">OK</button>
                    <button type="button" class="status-btn avvik" data-status="avvik">Avvik</button>
                </div>
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

function createTilstandsgradDropdownItemHTML(item) {
    return `
        <div class="form-group">
            <label>${item.label}</label>
            <select id="select-${item.id}" class="form-control checklist-dropdown">
                <option value="">Velg tilstandsgrad</option>
                <option value="0">TG0 - Ingen symptomer</option>
                <option value="1">TG1 - Svake symptomer</option>
                <option value="2">TG2 - Middels kraftige symptomer</option>
                <option value="3">TG3 - Kraftige symptomer</option>
            </select>
        </div>
    `;
}

function createKonsekvensgradDropdownItemHTML(item) {
    return `
        <div class="form-group">
            <label>${item.label}</label>
            <select id="select-${item.id}" class="form-control checklist-dropdown">
                <option value="">Velg konsekvensgrad</option>
                <option value="0">KG0 - Ingen konsekvens</option>
                <option value="1">KG1 - Liten konsekvens</option>
                <option value="2">KG2 - Middels konsekvens</option>
                <option value="3">KG3 - Stor konsekvens</option>
            </select>
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

// NYTT: Rydd opp alle bildecontainere
function clearAllImageContainers() {
    console.log('🧹 Clearing all image containers...');
    
    // Tøm ALLE bildecontainere eksplisitt
    const containerSelectors = [
        '#general-images-gallery',
        '[id^="avvik-images-container-"]',
        '[id^="byttet-images-container-"]',
        '[id^="image-only-container-"]',
        '.avvik-images-container',
        '.byttet-images-container',
        '.image-only-container'
    ];
    
    containerSelectors.forEach(selector => {
        const containers = document.querySelectorAll(selector);
        containers.forEach(container => {
            container.innerHTML = '';
            console.log(`   ✅ Cleared: ${selector}`);
        });
    });
    
    // NYTT: Nullstill photo context eksplisitt
    if (window.currentPhotoContext) {
        window.currentPhotoContext = null;
        console.log('   ✅ Photo context cleared');
    }
    
    // NYTT: Force garbage collection på img elements
    const allImages = document.querySelectorAll('img[src*="storage.googleapis.com"]');
    allImages.forEach(img => {
        img.src = '';
        img.remove();
    });
    
    console.log('✅ All image containers and cached images cleared');
}

function resetAndLoadForm(isEditing = false) {
    console.log('🔄 Resetting form...');
    
    // clearAllImageContainers(); // Ikke nødvendig - bilder cleares kun ved behov

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
    
    // Reset checklist buttons og containere - OPPDATERT KODE
    const checklistContainer = document.getElementById('checklist-items-container');
    if (checklistContainer) {
        // Fjern active klasse fra alle status-knapper
        checklistContainer.querySelectorAll('.status-btn.active').forEach(btn => {
            btn.classList.remove('active');
        });
        
        // Reset avvik-containere fullstendig
        checklistContainer.querySelectorAll('.avvik-container, .byttet-container').forEach(container => {
            container.classList.remove('show');
            container.style.display = 'none'; // VIKTIG: Eksplisitt skjul
            
            // Tøm også textarea verdiene
            const textarea = container.querySelector('textarea');
            if (textarea) {
                textarea.value = '';
            }
        });
        
        // Reset andre input-felter i sjekklisten
        checklistContainer.querySelectorAll('input[type="text"], input[type="number"], textarea:not(.avvik-container textarea):not(.byttet-container textarea), select').forEach(input => {
            if (input.type === 'checkbox') {
                input.checked = false;
            } else {
                input.value = '';
            }
        });
        
        // Reset dropdown-verdier til default
        checklistContainer.querySelectorAll('.checklist-dropdown').forEach(dropdown => {
            dropdown.selectedIndex = 0;
        });
    }
    
    // Load data if editing
    if (state.editingComponentIndex !== null) {
        loadChecklistForEditing(state.editingComponentIndex);
    }
} 
function loadExistingReportData() {
    console.log('📥 Loading existing report data into form...');
    
    if (!state.serviceReport?.reportData) {
        console.log('⚠️ No existing report data to load');
        return;
    }
    
    const reportData = state.serviceReport.reportData;
    console.log('📊 Report data structure:', {
        hasChecklist: !!reportData.checklist,
        hasSystemFields: !!(reportData.systemFields || reportData.systemData),
        systemFieldsContent: reportData.systemFields || reportData.systemData || {},
        hasProducts: !!reportData.products,
        hasAdditionalWork: !!reportData.additionalWork,
        checklistKeys: reportData.checklist ? Object.keys(reportData.checklist) : []
    });
    
    // 1. LAST INN SYSTEM FIELDS
    if ((reportData.systemFields || reportData.systemData) && state.checklistTemplate?.systemFields) {
        console.log('📝 Loading systemFields:', reportData.systemFields || reportData.systemData);
        
        state.checklistTemplate.systemFields.forEach(field => {
            const input = document.getElementById(`system-${field.name}`);
            // VIKTIG: Sjekk systemFields FØRST, deretter systemData
            const value = reportData.systemFields?.[field.name] || reportData.systemData?.[field.name];
            
            console.log(`Looking for field ${field.name}: found value "${value}", input exists: ${!!input}`);
            
            if (input && value !== undefined && value !== null && value !== '') {
                input.value = value;
                console.log(`✅ Set ${field.name} = ${value}`);
            } else if (!input) {
                console.warn(`❌ No input found for ${field.name}`);
            }
        });
    } else {
        console.log('⚠️ No systemFields/systemData to load or no template');
    }    
    // 2. LAST INN CHECKLIST DATA
    if (reportData.checklist && state.checklistTemplate?.checklistItems) {
        console.log('📋 Loading checklist items...');
        populateChecklistItems(state.checklistTemplate.checklistItems, reportData.checklist);
    } else {
        console.log('⚠️ Missing checklist data or template');
    }
    
    // 3. LAST INN PRODUKTER
    if (reportData.products && Array.isArray(reportData.products) && reportData.products.length > 0) {
        console.log(`📦 Loading ${reportData.products.length} products...`);
        // Clear existing products first
        const container = document.getElementById('product-lines-container');
        if (container) container.innerHTML = '';
        reportData.products.forEach(product => {
            if (product && product.name) { // Validate product data
                addProductLine(product);
            }
        });
    } else {
        console.log('⚠️ No products to load');
    }
    
    // 4. LAST INN TILLEGGSARBEID
    if (reportData.additionalWork && Array.isArray(reportData.additionalWork) && reportData.additionalWork.length > 0) {
        console.log(`🔧 Loading ${reportData.additionalWork.length} additional work items...`);
        // Clear existing work items first
        const container = document.getElementById('additional-work-lines-container');
        if (container) container.innerHTML = '';
        reportData.additionalWork.forEach(work => {
            if (work && work.description) { // Validate work data
                addAdditionalWorkLine(work);
            }
        });
    } else {
        console.log('⚠️ No additional work to load');
    }
    
    // 5. LAST INN OVERALL COMMENT
    const overallCommentEl = document.getElementById('overall-comment');
    if (overallCommentEl && reportData.overallComment) {
        overallCommentEl.value = reportData.overallComment;
        console.log('💬 Loaded overall comment');
    }
    
    console.log('✅ Existing report data loaded successfully!');
}

function loadChecklistForEditing(index) {
    const component = state.serviceReport.reportData.components[index];
    if (!component) return;
    
    // Load system fields - sjekk først ny struktur, deretter gammel
    if (component.detailsWithLabels) {
        // Ny struktur med labels
        Object.entries(component.detailsWithLabels).forEach(([fieldName, fieldData]) => {
            const input = document.getElementById(`comp-${fieldName}`);
            if (input) {
                input.value = fieldData.value || '';
            }
        });
    } else if (component.details) {
        // Gammel struktur (bakoverkompatibilitet for eksisterende data)
        Object.entries(component.details).forEach(([key, value]) => {
            const input = document.getElementById(`comp-${key}`);
            if (input) input.value = value;
        });
    }
    
    // Resten forblir uendret
    if (component.checklist && state.checklistTemplate?.checklistItems) {
        populateChecklistItems(state.checklistTemplate.checklistItems, component.checklist);
        
        // NYTT: Hent bilder etter at sjekkliste er populert
        setTimeout(() => {
            try {
                renderAvvikImagesForChecklist();
                renderGeneralImages();
                console.log('✅ Bilder hentet for eksisterende sjekkliste');
            } catch (error) {
                console.error('Feil ved bildehenting:', error);
            }
        }, 200);
    }
    
    if (component.products?.length > 0) {
        component.products.forEach(product => addProductLine(product));
    }
    
    if (component.additionalWork?.length > 0) {
        component.additionalWork.forEach(work => addAdditionalWorkLine(work));
    }
    
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
    console.log('🔄 Populating checklist items...', {
        itemsCount: items.length,
        checklistDataKeys: Object.keys(checklistData)
    });
    
    items.forEach(item => {
        // Generate the same key as when saving
        const key = (item.label || '').trim().toLowerCase()
            .replace(/\s+/g, '_')
            .replace(/[^\w_æøå]/g, '');
            
        const result = checklistData[key] || checklistData[item.id];
        
        if (!result) {
            console.log(`⚠️ No data found for item: ${item.label} (id: ${item.id})`);
            return;
        }
        
        console.log(`✅ Found data for ${item.label}:`, result);
        
        const element = document.querySelector(`[data-item-id="${item.id}"]`);
        if (!element) {
            console.warn(`⚠️ No DOM element found for item: ${item.id}`);
            return;
        }
        
        switch (item.inputType) {
            case 'ok_avvik':
            case 'ok_byttet_avvik':
                if (result.status) {
                    const statusButton = element.querySelector(`[data-status="${result.status}"]`);
                    if (statusButton) {
                        statusButton.click();
                        console.log(`  ✅ Set status: ${result.status}`);
                        
                        if (result.status === 'avvik' && result.comment) {
                            const avvikContainer = element.nextElementSibling;
                            if (avvikContainer && avvikContainer.classList.contains('avvik-container')) {
                                const textarea = avvikContainer.querySelector('textarea');
                                if (textarea) {
                                    textarea.value = result.comment;
                                    console.log(`  ✅ Set avvik comment`);
                                }
                            }
                        }
                        
                        if (result.status === 'byttet' && result.comment) {
                            const byttetContainer = document.getElementById(`byttet-${item.id}`);
                            if (byttetContainer) {
                                const textarea = byttetContainer.querySelector('textarea');
                                if (textarea) {
                                    textarea.value = result.comment;
                                    console.log(`  ✅ Set byttet comment`);
                                }
                            }
                        }
                    }
                }
                break;
                
            case 'numeric':
            case 'text':
            case 'textarea':
                const input = document.getElementById(`input-${item.id}`);
                if (input) {
                    input.value = result;
                    console.log(`  ✅ Set value: ${result}`);
                }
                break;
                
            case 'comment':
                const commentInput = document.getElementById(`comment-${item.id}`);
                if (commentInput) {
                    commentInput.value = result;
                    console.log(`  ✅ Set comment: ${result}`);
                }
                break;
                
            case 'checkbox':
                const checkbox = document.getElementById(item.id);
                if (checkbox) {
                    checkbox.checked = !!result;
                    console.log(`  ✅ Set checkbox: ${result}`);
                }
                break;
                
            case 'dropdown':
            case 'switch_select':
                const select = document.getElementById(`select-${item.id}`);
                if (select) {
                    select.value = result;
                    console.log(`  ✅ Set dropdown: ${result}`);
                }
                break;
                
            case 'rengjort_ikke_rengjort':
                if (result) {
                    const statusButton = element.querySelector(`[data-status="${result}"]`);
                    if (statusButton) {
                        statusButton.click();
                        console.log(`  ✅ Set rengjort status: ${result}`);
                    }
                }
                break;
                
            case 'timer':
                const timerDisplay = element.querySelector('.timer-display');
                if (timerDisplay && result) {
                    timerDisplay.textContent = result;
                    console.log(`  ✅ Set timer: ${result}`);
                }
                break;
                
            default:
                console.log(`  ⚠️ Unknown input type: ${item.inputType}`);
        }
        
        // Handle subpoints recursively
        if (item.hasSubpoints && item.subpoints) {
            populateChecklistItems(item.subpoints, checklistData);
        }
    });
    
    console.log('✅ Checklist population complete');
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

    setupPhotoDropdownHandlers();

    // Legg til virkningsgrad-beregning
    setupVirkningsgradCalculation();

    setupAutoOkFunctionality();
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
    
    // Handle both avvik and byttet containers
    const avvikContainer = document.getElementById(`avvik-${itemId}`);
    const byttetContainer = document.getElementById(`byttet-${itemId}`);
    
    // Hide both containers first
    if (avvikContainer) {
        avvikContainer.classList.remove('show');
        avvikContainer.style.display = 'none';
    }
    if (byttetContainer) {
        byttetContainer.classList.remove('show');
        byttetContainer.style.display = 'none';
    }
    
    // Show correct container based on selected status
    if (button.classList.contains('active')) {
        if (button.dataset.status === 'avvik' && avvikContainer) {
            avvikContainer.classList.add('show');
            avvikContainer.style.display = 'block';
        } else if (button.dataset.status === 'byttet' && byttetContainer) {
            byttetContainer.classList.add('show');
            byttetContainer.style.display = 'block';
            syncByttetImages(itemId);
        }
    }
    
    console.log(`Status ${button.dataset.status} for item ${itemId} is now ${button.classList.contains('active') ? 'active' : 'inactive'}`);
}

// Debug: Sjekk status på alle avvik-containers
function debugAvvikContainers() {
    console.log('=== DEBUG AVVIK CONTAINERS ===');
    const avvikContainers = document.querySelectorAll('.avvik-container');
    avvikContainers.forEach((container, index) => {
        console.log(`Avvik container ${index}:`, {
            id: container.id,
            display: container.style.display,
            hasShowClass: container.classList.contains('show'),
            visible: container.offsetParent !== null,
            innerHTML: container.innerHTML.substring(0, 100) + '...'
        });
    });
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


function setupAutoOkFunctionality() {
    console.log('Setting up auto-OK functionality...');
    
    const checklistContainer = document.getElementById('checklist-items-container');
    if (!checklistContainer) return;
    
    // For dropdown endringer
    checklistContainer.addEventListener('change', (e) => {
        const target = e.target;
        const checklistItem = target.closest('.checklist-item, .checklist-item-fullwidth');
        if (!checklistItem) return;
        
        const itemType = checklistItem.dataset.itemType;
        
        // For dropdown_ok_avvik og dropdown_ok_avvik_comment
        if ((itemType === 'dropdown_ok_avvik' || itemType === 'dropdown_ok_avvik_comment') && 
            target.classList.contains('checklist-dropdown')) {
            
            if (target.value && target.value !== '') {
                autoSetOkStatus(checklistItem);
            }
        }
    });
    
    // For numeriske inputs (temperatur og virkningsgrad)
    checklistContainer.addEventListener('input', (e) => {
        const target = e.target;
        if (target.type !== 'number') return;
        
        const checklistItem = target.closest('.checklist-item, .checklist-item-fullwidth');
        if (!checklistItem) return;
        
        const itemType = checklistItem.dataset.itemType;
        const itemId = checklistItem.dataset.itemId;
        
        // For temperature type
        if (itemType === 'temperature' && target.id === `temp-${itemId}`) {
            if (target.value && target.value !== '') {
                autoSetOkStatus(checklistItem);
            }
        }
        
        // For virkningsgrad type
        if (itemType === 'virkningsgrad' && 
            (target.id === `t2-${itemId}` || target.id === `t3-${itemId}` || target.id === `t7-${itemId}`)) {
            
            const t2Input = document.getElementById(`t2-${itemId}`);
            const t3Input = document.getElementById(`t3-${itemId}`);
            const t7Input = document.getElementById(`t7-${itemId}`);
            
            // Hvis minst én temperatur er fylt ut, sett OK
            if ((t2Input?.value && t2Input.value !== '') ||
                (t3Input?.value && t3Input.value !== '') ||
                (t7Input?.value && t7Input.value !== '')) {
                autoSetOkStatus(checklistItem);
            }
        }
    });
}

// Hjelpefunksjon for å sette OK-status
function autoSetOkStatus(checklistItem) {
    const okButton = checklistItem.querySelector('.status-btn.ok');
    const hasActiveStatus = checklistItem.querySelector('.status-btn.active');
    
    // Sett kun OK hvis ingen status allerede er valgt
    if (okButton && !hasActiveStatus) {
        okButton.classList.add('active');
        console.log(`Auto-set OK for item ${checklistItem.dataset.itemId} (type: ${checklistItem.dataset.itemType})`);
        
        // Skjul avvik-container hvis den er åpen
        const itemId = checklistItem.dataset.itemId;
        const avvikContainer = document.getElementById(`avvik-${itemId}`);
        if (avvikContainer) {
            avvikContainer.classList.remove('show');
            avvikContainer.style.display = 'none';
        }
    }
}

// Bonus: Legg til visuell indikator når auto-OK aktiveres
function addAutoOkVisualFeedback(checklistItem) {
    // Legg til en subtil animasjon når OK settes automatisk
    const okButton = checklistItem.querySelector('.status-btn.ok.active');
    if (okButton) {
        okButton.style.transition = 'all 0.3s ease';
        okButton.style.transform = 'scale(1.1)';
        setTimeout(() => {
            okButton.style.transform = 'scale(1)';
        }, 300);
    }
}
async function saveChecklist(event, showToastMessage = true) {
    if (event && typeof event.preventDefault === 'function') {
        event.preventDefault();
    } else if (typeof event === 'boolean') {
        showToastMessage = event;
    }

    console.log('Saving checklist...');

    // Validate system fields
    const hasSystemFields = state.checklistTemplate?.systemFields && 
                           state.checklistTemplate.systemFields.length > 0;
    
    if (hasSystemFields) {
        for (const field of state.checklistTemplate.systemFields) {
            if (field.required) {
                const input = document.getElementById(`system-${field.name}`);  // ← ENDRE HER
                if (!input || input.value.trim() === '') {
                    if (showToastMessage) {
                        showToast(`${field.label} må fylles ut før du kan lagre.`, 'error');
                    }
                    return;
                }
            }
        }
    }

    setLoading(true);
    
    try {
        const componentData = collectComponentData();
        
        // VIKTIG: Behold eksisterende reportData
        if (!state.serviceReport.reportData) {
            state.serviceReport.reportData = {};
        }
        
        // Oppdater kun checklist-data uten å ødelegge resten
        state.serviceReport.reportData.systemFields = componentData.systemFields;
        state.serviceReport.reportData.systemData = componentData.systemData || componentData.systemFields;
        state.serviceReport.reportData.checklist = componentData.checklist;
        state.serviceReport.reportData.products = componentData.products;
        state.serviceReport.reportData.additionalWork = componentData.additionalWork;        
        // Lagre til backend
        const response = await api.put(`/reports/${state.serviceReport.reportId}`, {
            orderId: state.orderId,
            equipmentId: state.equipmentId,
            reportData: state.serviceReport.reportData
        });
        
        if (showToastMessage) {
            showToast('Sjekkliste lagret!', 'success');
        }
        
        // IKKE reset form - data skal forbli synlig!
        
    } catch (error) {
        console.error('Save error:', error);
        if (showToastMessage) {
            showToast(`Kunne ikke lagre: ${error.message}`, 'error');
        }
    } finally {
        setLoading(false);
    }
}

// 2. FIKS: Legg til resetForm funksjon som mangler
function resetForm() {
    resetAndLoadForm(false);
}

function resetForm() {
    resetAndLoadForm(false);
}

function collectComponentData() {
    console.log('Collecting component data...');

    // Samle systemFields
    const systemFieldsData = {};
    if (state.checklistTemplate?.systemFields) {
        state.checklistTemplate.systemFields.forEach(field => {
            const input = document.getElementById(`system-${field.name}`);
            if (input && input.value) {
                systemFieldsData[field.name] = input.value;
            }
        });
    }

    const checklist = collectChecklistData();

    // Collect products
    const products = [];
    const productContainer = document.getElementById('product-lines-container');
    if (productContainer) {
        productContainer.querySelectorAll('.product-item').forEach((item, index) => {
            const name = item.querySelector('.product-name')?.value || '';
            const quantity = parseFloat(item.querySelector('.product-quantity')?.value) || 0;
            const price = parseFloat(item.querySelector('.product-price')?.value) || 0;
            
            if (name || quantity > 0 || price > 0) {
                products.push({
                    id: `product_${Date.now()}_${index}`,
                    name, 
                    quantity, 
                    price,
                    total: quantity * price
                });
            }
        });
    }
    
    // Collect additional work
    const additionalWork = [];
    const workContainer = document.getElementById('additional-work-lines-container');
    if (workContainer) {
        workContainer.querySelectorAll('.work-item').forEach((item, index) => {
            const description = item.querySelector('.work-description')?.value || '';
            const hours = parseFloat(item.querySelector('.work-hours')?.value) || 0;
            const price = parseFloat(item.querySelector('.work-price')?.value) || 0;
            
            if (description || hours > 0 || price > 0) {
                additionalWork.push({
                    id: `work_${Date.now()}_${index}`,
                    description, 
                    hours, 
                    price,
                    total: hours * price
                });
            }
        });
    }
    
    // Collect drift schedule hvis aktuelt
    const driftSchedule = {};
    if (state.checklistTemplate?.hasDriftSchedule) {
        document.querySelectorAll('.drift-time-input').forEach(input => {
            const day = input.dataset.day;
            const field = input.dataset.field;
            
            if (!driftSchedule[day]) {
                driftSchedule[day] = {};
            }
            driftSchedule[day][field] = input.value;
        });
    }

    return {
        id: state.editingComponentIndex !== null ? 
            state.serviceReport.reportData.components[state.editingComponentIndex].id : 
            `comp_${Date.now()}`,
        timestamp: new Date().toISOString(),
        templateInfo: {
            id: state.checklistTemplate.id,
            name: state.checklistTemplate.name,
            version: state.checklistTemplate.version || '1.0'
        },
        systemData: systemFieldsData,
        systemFields: systemFieldsData,
        checklist: checklist,             // Med faktiske navn som keys
        products: products,
        additionalWork: additionalWork,
        driftSchedule: driftSchedule
    };
}

function collectChecklistData() {
    console.log('📋 Collecting checklist data...');
    const checklistData = {};
    const checklistContainer = document.getElementById('checklist-items-container');

    if (!checklistContainer) {
        console.warn('⚠️ No checklist container found');
        return checklistData;
    }

    const checklistItems = checklistContainer.querySelectorAll('.checklist-item, .checklist-item-fullwidth');

    checklistItems.forEach(item => {
        const itemId = item.dataset.itemId;
        if (!itemId) return;

        const data = getChecklistItemValue(itemId);

        if (data !== null && data !== undefined) {
            // Lag lesbar nøkkel fra label
            const label = item.querySelector('.item-label')?.textContent || itemId;
            const key = label.trim().toLowerCase()
                .replace(/\s+/g, '_')
                .replace(/[^\w_æøå]/g, '');
            
            checklistData[key] = data;
        }
    });

    console.log('✅ Checklist data collected:', checklistData);
    return checklistData;
}

function getChecklistItemValue(itemId) {
    const element = document.querySelector(`[data-item-id="${itemId}"]`);
    if (!element) {
        console.warn(`Element not found for item ID: ${itemId}`);
        return null;
    }
    
    const itemType = element.dataset.itemType;
    let value = null;
    
    switch (itemType) {
        case 'ok_avvik':
        case 'ok_byttet_avvik': {
            const activeButton = element.querySelector('.status-btn.active');
            if (!activeButton) return null;
            
            const status = activeButton.dataset.status;
            const result = { status };
            
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
            
            if (!activeButton) return null;
            
            const status = activeButton.dataset.status;
            const result = { 
                status,
                dropdownValue: select ? select.value : ''
            };
            
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
            const activeButton = element.querySelector('.status-btn.active');
            
            const result = {
                t2: t2Input ? parseFloat(t2Input.value) : null,
                t3: t3Input ? parseFloat(t3Input.value) : null,
                t7: t7Input ? parseFloat(t7Input.value) : null,
                status: activeButton ? activeButton.dataset.status : null
            };
            
            if (result.t2 !== null && result.t3 !== null && result.t7 !== null) {
                result.virkningsgrad = calculateVirkningsgrad(result.t2, result.t3, result.t7);
            }
            
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
            const dropdown = element.querySelector(`#select-${itemId}`);
            return dropdown ? dropdown.value : null;
        }
        
        case 'group_selection': {
            const checkedInputs = element.querySelectorAll('input[type="radio"]:checked');
            return Array.from(checkedInputs).map(input => input.value);
        }
        
        case 'switch_select': {
            const select = element.querySelector(`#select-${itemId}`);
            return select ? select.value : null;
        }
        
        case 'dropdown': {
            const select = element.querySelector(`#dropdown-${itemId}`) || 
                          element.querySelector('.checklist-dropdown');
            return select ? select.value : null;
        }
        
        case 'multi_checkbox': {
            const checkedBoxes = element.querySelectorAll('input[type="checkbox"]:checked');
            return Array.from(checkedBoxes).map(box => box.value);
        }
        
        case 'timer': {
            const display = element.querySelector('.timer-display');
            return display ? display.textContent : '00:00:00';
        }
        
        case 'rengjort_ikke_rengjort': {
            const activeButton = element.querySelector('.status-btn.active');
            return activeButton ? activeButton.dataset.status : null;
        }
        
        case 'image_only': {
            const images = element.querySelectorAll('.uploaded-image');
            return images.length > 0;
        }
        
        default:
            console.warn(`Unknown input type: ${itemType} for item: ${itemId}`);
            return null;
    }
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
        const descriptionInput = item.querySelector('.work-description');
        const hoursInput = item.querySelector('.work-hours');
        const priceInput = item.querySelector('.work-price');
        
        const description = descriptionInput?.value?.trim();
        const hours = hoursInput?.value?.trim();
        const price = priceInput?.value?.trim();
        
        // Valider at vi har minst beskrivelse og timer
        if (description && hours && !isNaN(hours) && parseFloat(hours) > 0) {
            work.push({ 
                description, 
                hours: parseFloat(hours), 
                price: price ? parseFloat(price) : 0 
            });
        } else if (description || hours) {
            // Warn hvis delvis utfylt
            console.warn('Delvis utfylt tilleggsarbeid ignorert:', { description, hours, price });
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
    
    // Bare sjekk om rapport eksisterer
    const hasReport = !!state.serviceReport?.reportId;
    
    btn.disabled = !hasReport;
    btn.textContent = hasReport ? 'Ferdigstill anlegg' : 'Lagre først';
}

async function finalizeAnlegg() {
    console.log('🏁 Starting finalize process...');
    
    // Vis bekreftelsesmodal
    const confirmed = await showFinalizeConfirmationModal();
    
    if (!confirmed) {
        console.log('❌ Finalize cancelled by user');
        return;
    }
    
    setLoading(true);
    
    try {
        // Lagre sjekkliste først
        await saveChecklist(null, false); // Ikke vis toast
        
        // Ferdigstill anlegget
        const response = await api.post(`/reports/${state.serviceReport.reportId}/complete`, {
            signature: null // Kan legge til signatur senere
        });
        
        showToast('Anlegg ferdigstilt!', 'success');
        
        // Naviger tilbake til ordre
        setTimeout(() => {
            window.location.href = `/app/orders.html?id=${state.orderId}`;
        }, 1500);
        
    } catch (error) {
        console.error('❌ Finalize error:', error);
        showToast(`Kunne ikke ferdigstille: ${error.message}`, 'error');
    } finally {
        setLoading(false);
    }
}

function setLoading(isLoading) {
    const loader = document.getElementById('loader');
    if (loader) {
        loader.style.display = isLoading ? 'flex' : 'none';
    }
}

// Upload image to server
// Upload image to server
async function uploadImageToServer(file, imageType) {
    console.log('📤 Uploading to server:', {
        filename: file.name,
        imageType: imageType,
        endpoint: imageType === 'avvik' ? '/api/images/avvik' : '/api/images/general'
    });
    
    const formData = new FormData();
    // ENDRET: Fra 'file' til 'image' for å matche backend
    formData.append('image', file);  // ← DETTE ER ENDRINGEN
    formData.append('reportId', state.serviceReport.reportId);
    formData.append('orderId', state.order.id);
    formData.append('equipmentId', state.equipment.id);
    
    if (imageType === 'avvik' && currentPhotoContext?.itemId) {
        console.log('📷 Avvik detaljer:', {
            itemId: currentPhotoContext.itemId,
            context: currentPhotoContext
        });
        
        // FIKSET: Send den korrekte checklist item ID
        const checklistItem = document.querySelector(`[data-item-id="${currentPhotoContext.itemId}"]`);
        
        if (checklistItem) {
            const actualItemId = checklistItem.dataset.itemId;
            console.log('📷 Found actual checklist item ID:', actualItemId);
            formData.append('avvikId', actualItemId);
        } else {
            console.warn('⚠️ Could not find checklist item for ID:', currentPhotoContext.itemId);
            formData.append('avvikId', currentPhotoContext.itemId);
        }
    }
    
    const endpoint = imageType === 'avvik' ? '/api/images/avvik' : '/api/images/general';
    console.log('📤 Using endpoint:', endpoint);
    
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            body: formData,
            credentials: 'include'
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Upload error response:', errorText);
            
            try {
                const errorData = JSON.parse(errorText);
                throw new Error(errorData.error || `Server error: ${response.status}`);
            } catch {
                throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
            }
        }
        
        const result = await response.json();
        console.log('📷 Upload successful:', result);
        
        // Returner hele result objektet, ikke bare URL
        return result;
        
    } catch (error) {
        console.error('📷 Upload error:', error);
        throw new Error(
            imageType === 'avvik' 
                ? `Kunne ikke laste opp avvik-bilde: ${error.message}` 
                : `Kunne ikke laste opp rapport-bilde: ${error.message}`
        );
    }
}



// Separat funksjon for å håndtere foto-filer
async function handlePhotoFile(file) {
    console.log('📷 File selected:', file.name, 'Size:', Math.round(file.size/1024) + 'KB');
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
        showToast(`⏳ Optimaliserer og laster opp ${imageType === 'avvik' ? 'avviksbilde' : 'bilde'}...`, 'info');
        
        // NYTT: Resize bilde før opplasting
        let fileToUpload = file;
        if (file.type.startsWith('image/')) {
            try {
                fileToUpload = await resizeImageBeforeUpload(file);
            } catch (resizeError) {
                console.warn('Kunne ikke optimalisere bilde, bruker original:', resizeError);
                // Fortsett med original fil hvis resize feiler
            }
        }
        
        // Last opp bildet
        const uploadResult = await uploadImageToServer(fileToUpload, imageType);
        
        if (uploadResult.url) {
            // Vis bildet i UI
            if (imageType === 'avvik' && currentPhotoContext?.itemId) {
                await displayAvvikImage(currentPhotoContext.itemId, uploadResult.url);
            } else {
                await displayGeneralImage(uploadResult.url);
            }
            
            showToast('✅ Bilde lastet opp!', 'success');
        }
    } catch (error) {
        console.error('❌ Feil ved opplasting:', error);
        showToast('❌ Kunne ikke laste opp bilde: ' + error.message, 'error');
    }
}

// 2. LEGG TIL disse manglende funksjonene:
// Display general image after upload
async function displayGeneralImage(imageUrl) {
    console.log('📸 Displaying general image:', imageUrl);
    
    // NYTT: Valider state
    if (!state.serviceReport || !state.serviceReport.reportId) {
        console.log('⚠️  No valid state for displaying general image');
        return;
    }
    
    const expectedPrefix = `RPT-${state.orderId}-${state.equipmentId}`;
    if (!state.serviceReport.reportId.startsWith(expectedPrefix)) {
        console.log('⚠️  State mismatch, not reloading general images');
        return;
    }
    
    // Reload general images to show the new one
    await renderGeneralImages();
}

async function displayAvvikImage(itemId, imageUrl) {
    console.log('📸 Displaying avvik image for item:', itemId, imageUrl);
    
    // NYTT: Valider at vi har riktig state før reloading
    if (!state.serviceReport || !state.serviceReport.reportId) {
        console.log('⚠️  No valid state for displaying avvik image');
        return;
    }
    
    // NYTT: Smartere validering for display funksjoner
    const currentReportId = state.serviceReport.reportId;
    const expectedPrefix = `RPT-${state.orderId}-${state.equipmentId}`;
    const isNewFormat = currentReportId.startsWith(expectedPrefix);
    const isValidExisting = currentReportId && currentReportId.length > 5;

    if (!isNewFormat && !isValidExisting) {
        console.log('⚠️  Invalid reportId, not reloading images:', {
            reportId: currentReportId,
            isNewFormat,
            isValidExisting
        });
        return;
    }

    // NYTT: Kun sjekk ordre/anlegg for nye rapporter
    if (isNewFormat && state.orderId && state.equipmentId) {
        if (!currentReportId.includes(state.orderId) || !currentReportId.includes(state.equipmentId)) {
            console.log('⚠️  ReportId ikke for denne kombinasjonen, not reloading images');
            return;
        }
    }

    console.log('✅ Display validering OK, reloading images');
    
    // Reload avvik images to show the new one
    await renderAvvikImagesForChecklist();
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
            console.log('📷 File selected:', file.name, 'Size:', Math.round(file.size/1024) + 'KB');
            // NYTT: Clear gamle bilder fra UI før opplasting
            if (currentPhotoContext?.type === 'avvik' && currentPhotoContext?.itemId) {
                console.log('🧹 Clearing old images before new upload');
                clearAllImageContainers();
                // Kort pause for å sikre clearing
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            // Sjekk at vi har nødvendig data
            if (!state.order?.id || !state.equipment?.id || !state.serviceReport?.reportId) {
                console.error('❌ Missing data:', {
                    orderId: state.order?.id,
                    equipmentId: state.equipment?.id,
                    reportId: state.serviceReport?.reportId
                });
                showToast('❌ Feil: Mangler ordre- eller anleggsdata. Prøv å laste siden på nytt.', 'error');
                return;
            }
            
            // Bestem bildetype basert på lagret kontekst
            const imageType = currentPhotoContext?.type || 'general';
            
            console.log('📷 Image type determined:', imageType);
            
            try {
                // Vis loading melding
                showToast(`⏳ Optimaliserer og laster opp ${imageType === 'avvik' ? 'avvik-' : ''}bilde...`, 'info');
                
                // NYTT: Resize bilde før opplasting
                let fileToUpload = file;
                if (file.type.startsWith('image/')) {
                    try {
                        fileToUpload = await resizeImageBeforeUpload(file);
                        console.log('✅ Image resized successfully');
                    } catch (resizeError) {
                        console.warn('Kunne ikke optimalisere bilde, bruker original:', resizeError);
                    }
                }
                
                const result = await uploadImageToServer(fileToUpload, imageType);
                console.log('📷 Upload result:', result);
                
                if (result.success || result.url) {
                    if (imageType === 'avvik' && result.avvikNumber) {
                        // Sjekk om det egentlig er byttet basert på context
                        const isByttet = currentPhotoContext?.byttetId ? true : false;
                        const message = isByttet 
                            ? `✅ Byttet filter #${result.formattedAvvikNumber} bilde lastet opp!`
                            : `✅ Avvik #${result.formattedAvvikNumber} bilde lastet opp!`;
                        
                        showToast(message, 'success');
                        
                        // Vent litt før rendering
                        setTimeout(() => {
                            console.log('🔄 Rendering avvik images...');
                            renderAvvikImagesForChecklist();
                            
                            // Hvis det var byttet, synkroniser også byttet-bildene
                            if (isByttet) {
                                const itemId = currentPhotoContext.itemId;
                                syncByttetImages(itemId);
                            }
                        }, 500);
                    } else {
                        showToast(`✅ Rapport-bilde lastet opp!`, 'success');
                        // Vent litt før rendering for å sikre at backend har lagret bildet
                        setTimeout(() => {
                            console.log('🔄 Rendering general images...');
                            renderGeneralImages();
                        }, 500);
                    }
                } else {
                    console.error('❌ Upload failed:', result);
                    showToast(`❌ Opplasting feilet: ${result.error || 'Ukjent feil'}`, 'error');
                }
            } catch (error) {
                console.error('📷 Photo upload error:', error);
                showToast(`❌ Feil ved opplasting: ${error.message}`, 'error');
            }
        }
    };
    
    // Trigger file selection
    console.log('📷 Triggering file input click...');
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

async function renderAvvikImagesForChecklist(currentReportId) {
    console.log('🖼️ Rendering avvik images for checklist items');
    
    // clearAllImageContainers(); // ← KOMMENTER UT - ikke nødvendig her
    
    // NYTT: Kort pause for å sikre clearing er fullført
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // NYTT: Bruk reportId fra state hvis ikke eksplisitt sendt
    const reportIdToUse = currentReportId || state.serviceReport?.reportId;
    
    // NYTT: Valider state før bilderedering
    if (!reportIdToUse || !state.serviceReport || !state.serviceReport.reportId) {
        console.log('⚠️  No valid reportId, clearing containers and skipping');
        clearAllImageContainers();
        return;
    }
    
    // NYTT: Valider at reportId matcher current ordre/anlegg
    const expectedPrefix = `RPT-${state.orderId}-${state.equipmentId}`;
    
    if (!reportIdToUse.startsWith(expectedPrefix)) {
        console.log('⚠️  ReportId mismatch, clearing containers:', {
            current: reportIdToUse,
            expected: expectedPrefix
        });
        clearAllImageContainers();
        return;
    }
    
    // Hent ALLE avvik-bilder for rapporten
    try {
        const avvikImages = await api.get(`/images/avvik/${reportIdToUse}`);
        console.log('📸 All avvik images:', avvikImages);
        
        if (Array.isArray(avvikImages)) {
            // NYTT: Tøm alle containere først
            document.querySelectorAll('[id^="avvik-images-container-"]').forEach(container => {
                container.innerHTML = '';
            });
            
            // Group images by checklist_item_id
            const imagesByAvvik = {};
            const orphanedImages = []; // Bilder uten checklist_item_id

            avvikImages.forEach(img => {
                const itemId = img.checklist_item_id;
                
                // DEBUG: Log hver bilde
                console.log('📸 Processing image:', {
                    id: img.id,
                    avvik_number: img.avvik_number,
                    checklist_item_id: img.checklist_item_id,
                    has_item_id: !!itemId
                });
                
                if (itemId) {
                    if (!imagesByAvvik[itemId]) {
                        imagesByAvvik[itemId] = [];
                    }
                    imagesByAvvik[itemId].push(img);
                    console.log(`✅ Image ${img.avvik_number} assigned to item ${itemId}`);
                } else {
                    orphanedImages.push(img);
                    console.warn(`⚠️ ORPHANED IMAGE: Avvik ${img.avvik_number} has no checklist_item_id`);
                }
            });

            // DEBUG: Log resultat
            console.log('📊 Filtering results:', {
                totalImages: avvikImages.length,
                imagesWithItemId: Object.values(imagesByAvvik).flat().length,
                orphanedImages: orphanedImages.length,
                itemsWithImages: Object.keys(imagesByAvvik)
            });

            // DEBUG: Vis orphaned images
            if (orphanedImages.length > 0) {
                console.log('🚨 ORPHANED IMAGES DETECTED:', orphanedImages.map(img => ({
                    avvik_number: img.avvik_number,
                    id: img.id,
                    uploaded_at: img.uploaded_at
                })));
            }
            
            // Render images for each avvik container
            Object.entries(imagesByAvvik).forEach(([itemId, images]) => {
                const container = document.getElementById(`avvik-images-container-${itemId}`);
                if (container) {
                    container.innerHTML = images.map(img => `
                        <div class="avvik-image-wrapper">
                            <img src="${img.image_url}" alt="Avvik ${img.avvik_number}" onclick="openImageModal('${img.image_url}', 'Avvik #${img.avvik_number}')">
                            <button type="button" class="image-remove-btn" onclick="removeAvvikImage('${itemId}', '${img.id}')" title="Fjern bilde">×</button>
                        </div>
                    `).join('');
                }
            });
        }
    } catch (error) {
        console.log('Error loading avvik images:', error.message);
        // Ikke vis feilmelding til bruker for bilderedering
    }

    // Synkroniser byttet-bilder (eksisterende kode)
    document.querySelectorAll('.status-btn.byttet.active').forEach(btn => {
        const checklistItem = btn.closest('.checklist-item');
        if (checklistItem) {
            const itemId = checklistItem.dataset.itemId;
            syncByttetImages(itemId);
        }
    });
}

// MANGLENDE FUNKSJON: Slett avvik-bilde
async function removeAvvikImage(itemId, imageId) {
    console.log('🗑️ Removing avvik image:', { itemId, imageId });
    
    try {
        // Bekreft sletting
        if (!confirm('Er du sikker på at du vil slette dette bildet?')) {
            return;
        }
        
        showToast('🗑️ Sletter bilde...', 'info');
        
        // Slett fra backend
        const response = await fetch(`/api/images/avvik/${imageId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error('Kunne ikke slette bilde');
        }
        
        showToast('✅ Bilde slettet!', 'success');
        
        // Oppdater UI
        setTimeout(() => {
            renderAvvikImagesForChecklist();
            
            // Hvis det var byttet-bilde, synkroniser også
            const byttetContainer = document.getElementById(`byttet-images-container-${itemId}`);
            if (byttetContainer && byttetContainer.innerHTML.trim()) {
                syncByttetImages(itemId);
            }
        }, 200);
        
    } catch (error) {
        console.error('Feil ved sletting av bilde:', error);
        showToast(`❌ Kunne ikke slette bilde: ${error.message}`, 'error');
    }
}

// Synkroniser byttet-bilder med avvik-bilder
function syncByttetImages(itemId) {
    console.log('🔄 Syncing byttet images for item:', itemId);
    
    // Finn avvik-bilder for dette elementet
    const avvikContainer = document.getElementById(`avvik-images-container-${itemId}`);
    const byttetContainer = document.getElementById(`byttet-images-container-${itemId}`);
    
    if (!avvikContainer || !byttetContainer) return;
    
    // Kopier bildene fra avvik til byttet, men endre tekst
    byttetContainer.innerHTML = '';
    
    const avvikImages = avvikContainer.querySelectorAll('.avvik-image-wrapper');
    avvikImages.forEach((wrapper, index) => {
        const img = wrapper.querySelector('img');
        if (img) {
            const byttetWrapper = document.createElement('div');
            byttetWrapper.className = 'byttet-image-wrapper';
            byttetWrapper.innerHTML = `
                <img src="${img.src}" 
                     alt="Byttet bilde" 
                     onclick="openImageModal('${img.src}', 'Byttet filter bilde')">
            `;
            byttetContainer.appendChild(byttetWrapper);
        }
    });
}

async function renderGeneralImages() {
    // NYTT: Valider state først
    if (!state.serviceReport || !state.serviceReport.reportId) {
        console.log('⚠️  No valid reportId for general images, clearing container');
        const container = document.getElementById('general-images-gallery');
        if (container) container.innerHTML = '';
        return;
    }
    
    // NYTT: Valider reportId matcher current ordre/anlegg
    const currentReportId = state.serviceReport.reportId;
    const expectedPrefix = `RPT-${state.orderId}-${state.equipmentId}`;
    
    if (!currentReportId.startsWith(expectedPrefix)) {
        console.log('⚠️  ReportId mismatch for general images, clearing container:', {
            current: currentReportId,
            expected: expectedPrefix
        });
        const container = document.getElementById('general-images-gallery');
        if (container) container.innerHTML = '';
        return;
    }
    
    try {
        const generalResponse = await fetch(`/api/images/general/${currentReportId}`, {
            credentials: 'include'
        });
        
        if (generalResponse.ok) {
            const generalImages = await generalResponse.json();
            console.log('📸 Reloaded general images:', generalImages);
            
            const container = document.getElementById('general-images-gallery');
            if (container) {
                // NYTT: Tøm container først
                container.innerHTML = '';
                
                if (generalImages.length > 0) {
                    container.innerHTML = generalImages.map((img, index) => `
                        <div class="image-thumbnail" data-index="${index}">
                            <div class="image-loading-placeholder"></div>
                            <div class="image-info">
                                <span class="image-title">Bilde ${index + 1}</span>
                            </div>
                        </div>
                    `).join('');
                    
                    // Last inn bilder ett om gangen for bedre ytelse på mobil
                    loadImagesProgressively(generalImages);
                    
                    // Vis attachments section
                    const attachmentsSection = document.getElementById('attachments-section');
                    if (attachmentsSection) {
                        attachmentsSection.style.display = 'block';
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error loading general images:', error);
        // Tøm container ved feil
        const container = document.getElementById('general-images-gallery');
        if (container) container.innerHTML = '';
    }
}

// Progressiv bildelasting optimalisert for mobil
function loadImagesProgressively(images) {
    images.forEach((img, index) => {
        // Øk delay mellom bilder for å ikke overbelaste mobil
        setTimeout(() => {
            const thumbnail = document.querySelector(`.image-thumbnail[data-index="${index}"]`);
            if (thumbnail) {
                const imgElement = new Image();
                
                imgElement.onload = function() {
                    thumbnail.innerHTML = `
                        <img src="${img.image_url}" alt="Bilde ${index + 1}">
                        <div class="image-info">
                            <span class="image-title">Bilde ${index + 1}</span>
                        </div>
                    `;
                    thumbnail.onclick = () => openImageModal(img.image_url, `Bilde ${index + 1}`);
                    thumbnail.classList.add('loaded');
                };
                
                imgElement.onerror = function() {
                    thumbnail.innerHTML = `
                        <div class="image-error">⚠️</div>
                        <div class="image-info">
                            <span class="image-title">Kunne ikke laste</span>
                        </div>
                    `;
                };
                
                imgElement.src = img.image_url;
            }
        }, index * 300); // 300ms mellom hver - bedre for mobil
    });
}
// Legg også til en funksjon for å sjekke om bildene faktisk er lagret i databasen
async function debugCheckPhotosInDB() {
    try {
        const response = await fetch(`/api/reports/equipment/${state.equipmentId}?orderId=${state.orderId}`);
        const report = await response.json();
        console.log('📸 Photos in database:', report.photos);
        console.log('📸 Report data:', report);
    } catch (error) {
        console.error('Debug check failed:', error);
    }
}

function reinitializePhotoHandlers() {
    // Fjern gamle handlers
    if (window._photoClickHandler) {
        document.removeEventListener('click', window._photoClickHandler, true);
    }
    
    // Setup nye handlers
    setupPhotoDropdownHandlers();
    
    // Re-create lucide icons for nye elementer
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}



// Simple image modal
function openImageModal(imageUrl, imageTitle) {
    // Prevent scrolling on body when modal is open
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    
    let modal = document.getElementById('imageModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'imageModal';
        modal.innerHTML = `
            <div class="image-modal-overlay" onclick="closeImageModal()">
                <div class="image-modal-container" onclick="event.stopPropagation()">
                    <div class="image-modal-header">
                        <span class="image-modal-title">${imageTitle}</span>
                        <button class="image-modal-close" onclick="closeImageModal()">✕</button>
                    </div>
                    <div class="image-modal-body">
                        <img id="modalImage" src="${imageUrl}" alt="${imageTitle}">
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        // Legg til swipe-down for å lukke
        addSwipeToClose(modal);
    } else {
        document.getElementById('modalImage').src = imageUrl;
        modal.querySelector('.image-modal-title').textContent = imageTitle;
    }
    
    modal.classList.add('show');
}

function setupPhotoDropdownHandlers() {
    console.log('🔧 Setting up photo dropdown handlers...');
    
    // Fjern eksisterende handlers først
    if (window._photoClickHandler) {
        document.removeEventListener('click', window._photoClickHandler, true);
    }
    
    // Ny handler som bruker event delegation
    window._photoClickHandler = function(e) {
        // Sjekk om vi klikket på photo-btn
        const photoBtn = e.target.closest('.photo-btn');
        
        if (photoBtn) {
            e.preventDefault();
            e.stopPropagation();
            
            const wrapper = photoBtn.closest('.photo-dropdown-wrapper');
            const dropdown = wrapper?.querySelector('.photo-dropdown');
            
            if (dropdown) {
                const isOpen = dropdown.classList.contains('show');
                
                // Lukk alle andre dropdowns
                document.querySelectorAll('.photo-dropdown.show').forEach(dd => {
                    if (dd !== dropdown) {
                        dd.classList.remove('show');
                        dd.style.opacity = '0';
                        dd.style.visibility = 'hidden';
                    }
                });
                
                // Toggle denne dropdown
                if (!isOpen) {
                    dropdown.classList.add('show');
                    dropdown.style.opacity = '1';
                    dropdown.style.visibility = 'visible';
                    console.log('📷 Dropdown opened');
                } else {
                    dropdown.classList.remove('show');
                    dropdown.style.opacity = '0';
                    dropdown.style.visibility = 'hidden';
                    console.log('📷 Dropdown closed');
                }
            }
            return;
        }
        
        // Sjekk om vi klikket på photo-option
        const photoOption = e.target.closest('.photo-option');
        if (photoOption) {
            e.preventDefault();
            e.stopPropagation();
            
            const action = photoOption.dataset.action;
            const wrapper = photoOption.closest('.photo-dropdown-wrapper');
            
            // Finn kontekst
            let photoContext = null;
            const avvikContainer = wrapper?.closest('.avvik-container');
            const byttetContainer = wrapper?.closest('.byttet-container');

            // Sjekk byttet først (siden byttet også skal bruke avvik-type)
            if (byttetContainer) {
                photoContext = {
                    type: 'avvik',  // Bruk avvik-type også for byttet
                    container: byttetContainer,
                    byttetId: byttetContainer.id,
                    itemId: byttetContainer.id.replace('byttet-', '')
                };
                console.log('📷 Byttet photo context (using avvik type):', photoContext);
            } else if (avvikContainer) {
                photoContext = {
                    type: 'avvik',
                    container: avvikContainer,
                    avvikId: avvikContainer.id,
                    itemId: avvikContainer.id.replace('avvik-', '')
                };
            } else {
                const attachmentsSection = wrapper?.closest('#attachments-section');
                if (attachmentsSection) {
                    photoContext = {
                        type: 'general',
                        container: attachmentsSection
                    };
                }
            }
            
            if (photoContext) {
                currentPhotoContext = photoContext;
                
                // Lukk dropdown
                const dropdown = wrapper?.querySelector('.photo-dropdown');
                if (dropdown) {
                    dropdown.classList.remove('show');
                    dropdown.style.opacity = '0';
                    dropdown.style.visibility = 'hidden';
                }
                
                // Åpne foto-valg
                openPhotoOption(action);
            } else {
                console.error('Could not find photo context');
                showToast('Kunne ikke finne bildecontainer', 'error');
            }
            return;
        }
        
        // Klikk utenfor - lukk alle dropdowns
        if (!e.target.closest('.photo-dropdown-wrapper')) {
            document.querySelectorAll('.photo-dropdown.show').forEach(dropdown => {
                dropdown.classList.remove('show');
                dropdown.style.opacity = '0';
                dropdown.style.visibility = 'hidden';
            });
        }
    };
    
    // Legg til handler med capture
    document.addEventListener('click', window._photoClickHandler, true);
    
    console.log('✅ Photo dropdown handlers setup complete');
}

// 1. Resize-funksjonen
async function resizeImageBeforeUpload(file, maxWidth = 800, maxHeight = 600) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = (e) => {
            const img = new Image();
            
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                
                console.log(`📐 Original størrelse: ${width}x${height}`);
                
                // Beregn nye dimensjoner
                if (width > height) {
                    if (width > maxWidth) {
                        height = Math.round(height * (maxWidth / width));
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width = Math.round(width * (maxHeight / height));
                        height = maxHeight;
                    }
                }
                
                console.log(`📐 Ny størrelse: ${width}x${height}`);
                
                // Sett canvas størrelse
                canvas.width = width;
                canvas.height = height;
                
                // Tegn resized bilde
                const ctx = canvas.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, width, height);
                
                // Konverter til blob
                canvas.toBlob((blob) => {
                    if (blob) {
                        const resizedFile = new File([blob], file.name, { 
                            type: 'image/jpeg',
                            lastModified: Date.now()
                        });
                        console.log(`✅ Bilde optimalisert: ${Math.round(file.size/1024)}KB → ${Math.round(blob.size/1024)}KB`);
                        resolve(resizedFile);
                    } else {
                        reject(new Error('Kunne ikke konvertere bilde'));
                    }
                }, 'image/jpeg', 0.85); // 85% kvalitet
            };
            
            img.onerror = () => {
                reject(new Error('Kunne ikke laste bilde'));
            };
            
            img.src = e.target.result;
        };
        
        reader.onerror = () => {
            reject(new Error('Kunne ikke lese fil'));
        };
        
        reader.readAsDataURL(file);
    });
}
function closeImageModal() {
    const modal = document.getElementById('imageModal');
    if (modal) {
        modal.classList.remove('show');
        
        // Restore body scroll
        document.body.style.overflow = '';
        document.body.style.position = '';
        document.body.style.width = '';
        
        // Fjern modal etter animasjon
        setTimeout(() => {
            modal.remove();
        }, 300);
    }
}

// Lag denne som global funksjon
window.closeImageModal = closeImageModal;

function addSwipeToClose(modal) {
    let startY = 0;
    let currentY = 0;
    let modalContainer = modal.querySelector('.image-modal-container');
    
    modalContainer.addEventListener('touchstart', (e) => {
        startY = e.touches[0].clientY;
    }, { passive: true });
    
    modalContainer.addEventListener('touchmove', (e) => {
        currentY = e.touches[0].clientY;
        let deltaY = currentY - startY;
        
        if (deltaY > 0) { // Only allow swipe down
            modalContainer.style.transform = `translateY(${deltaY}px)`;
            modalContainer.style.opacity = 1 - (deltaY / 300);
        }
    }, { passive: true });
    
    modalContainer.addEventListener('touchend', (e) => {
        let deltaY = currentY - startY;
        
        if (deltaY > 100) { // Threshold for closing
            closeImageModal();
        } else {
            // Snap back
            modalContainer.style.transform = '';
            modalContainer.style.opacity = '';
        }
    }, { passive: true });
}

async function autoSaveBeforeNavigation() {
    try {
        const overallComment = document.getElementById('overall-comment')?.value || '';
        
        if (overallComment.trim() !== '') {
            console.log('💾 Auto-saving comment before navigation...');
            
            state.serviceReport.reportData.overallComment = overallComment;
            
            const updateData = {
                ...state.serviceReport.reportData
            };
            delete updateData.photos;
            
            await api.put(`/reports/${state.serviceReport.reportId}`, {
                orderId: state.orderId,
                equipmentId: state.equipmentId,
                reportData: updateData
            });
            
            console.log('✅ Comment auto-saved');
        }
        
        markFormAsClean();
        
    } catch (error) {
        console.error('Error auto-saving:', error);
    }
}

// NY FUNKSJON 2
async function autoSaveEverything() {
    try {
        console.log('🔄 Auto-saving everything before navigation...');
        
        const hasActiveComponent = state.editingComponentIndex !== null || 
                                 document.querySelector('#component-form [name="etasje"]')?.value;
        
        if (hasActiveComponent) {
            await saveComponent();
        }
        
        await autoSaveBeforeNavigation();
        
        console.log('✅ Everything auto-saved successfully');
        
    } catch (error) {
        console.error('Error in autoSaveEverything:', error);
        throw error;
    }
}

// NY VARIABEL OG FUNKSJON 3
let autoSaveInterval;

function startAutoSave() {
    if (autoSaveInterval) {
        clearInterval(autoSaveInterval);
    }
    
    autoSaveInterval = setInterval(async () => {
        if (changeTracker.hasUnsavedChanges) {
            console.log('⏰ Auto-saving changes...');
            try {
                await autoSaveEverything();
                showToast('💾 Endringer auto-lagret', 'info');
            } catch (error) {
                console.error('Auto-save failed:', error);
            }
        }
    }, 60000);
}

document.addEventListener('DOMContentLoaded', function() {
    // Initialize page
    initializePage();
    
    // Sett opp tilbake-knapp event listener ETTER at header er rendret
    setTimeout(() => {
        const backButton = document.querySelector('.header-nav-button');
        if (backButton) {
            backButton.addEventListener('click', async function(e) {
                e.preventDefault();
                console.log('Back button clicked, navigating to:', `/app/orders.html?id=${state.orderId}`);
                
                // Prøv å lagre før navigering
                try {
                    if (typeof autoSaveEverything === 'function') {
                        await autoSaveEverything();
                    }
                } catch (error) {
                    console.error('Error during auto-save:', error);
                }
                
                // Naviger uansett
                window.location.href = `/app/orders.html?id=${state.orderId}`;
            });
        }
    }, 500); // Vent litt for at header skal være rendret
});

// NY: Cleanup ved window unload
window.addEventListener('beforeunload', function() {
    if (autoSaveInterval) {
        clearInterval(autoSaveInterval);
    }
});

// DEBUG: Funksjon for å verifisere checklist item IDs
function debugChecklistItemIds() {
    console.log('🔍 DEBUG: Current checklist item IDs:');
    
    const checklistItems = document.querySelectorAll('[data-item-id]');
    checklistItems.forEach((item, index) => {
        const itemId = item.dataset.itemId;
        const container = document.getElementById(`avvik-images-container-${itemId}`);
        const hasImages = container ? container.children.length : 0;
        
        console.log(`   ${index + 1}. Item ID: "${itemId}", Images: ${hasImages}`);
    });
    
    console.log('   Current photo context:', window.currentPhotoContext);
}

function showFinalizeConfirmationModal() {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'finalize-confirm-modal';
        modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 10000;';
        
        modal.innerHTML = `
            <div style="background: white; border-radius: 16px; max-width: 400px; width: 90%; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.3);">
                <div style="padding: 24px 24px 16px; border-bottom: 1px solid #E5E7EB;">
                    <h3 style="margin: 0; font-size: 20px; font-weight: 600; color: #111827;">Ferdigstill anlegg?</h3>
                </div>
                
                <div style="padding: 20px 24px;">
                    <p style="margin: 0 0 12px 0; color: #374151; font-size: 15px; line-height: 1.6;">
                        Er du sikker på at du vil ferdigstille anlegget?
                    </p>
                    <p style="margin: 0; color: #DC2626; font-weight: 500; font-size: 14px; line-height: 1.5;">
                        Du kan ikke endre anlegget igjen etter ferdigstilling.
                    </p>
                </div>
                
                <div style="padding: 16px 24px; background: #F9FAFB; border-top: 1px solid #E5E7EB; display: flex; gap: 12px;">
                    <button id="cancel-finalize" style="flex: 1; padding: 12px; border-radius: 10px; font-weight: 600; font-size: 15px; border: 1px solid #D1D5DB; background: white; color: #374151; cursor: pointer;">
                        Avbryt
                    </button>
                    <button id="confirm-finalize" style="flex: 1; padding: 12px; border-radius: 10px; font-weight: 600; font-size: 15px; border: none; background: linear-gradient(135deg, #4A90E2 0%, #357ABD 100%); color: white; cursor: pointer; box-shadow: 0 2px 8px rgba(74, 144, 226, 0.3);">
                        OK
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        document.getElementById('confirm-finalize').onclick = () => {
            modal.remove();
            resolve(true);
        };
        
        document.getElementById('cancel-finalize').onclick = () => {
            modal.remove();
            resolve(false);
        };
        
        modal.onclick = (e) => {
            if (e.target === modal) {
                modal.remove();
                resolve(false);
            }
        };
    });
}
function updateStatusDisplay() {
    const statusBadge = document.querySelector('.status-badge');
    if (!statusBadge) return;
    
    const status = state.serviceReport?.status || 'not_started';
    
    // Map status til norsk tekst og CSS-klasser
    const statusMap = {
        'not_started': { text: 'Ikke startet', class: 'status-not-started' },
        'in_progress': { text: 'Under arbeid', class: 'status-in-progress' },
        'completed': { text: 'Ferdig', class: 'status-completed' }
    };
    
    const statusInfo = statusMap[status] || statusMap['not_started'];
    
    // Oppdater tekst og klasser
    statusBadge.textContent = statusInfo.text;
    statusBadge.className = `status-badge ${statusInfo.class}`;
}