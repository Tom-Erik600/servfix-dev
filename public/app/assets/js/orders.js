// air-tech-app/assets/js/orders.js - Tekniker frontend

let pageState = { 
    order: null, 
    customer: null, 
    equipment: [], 
    technician: null,
    quotes: [],
    selectedEquipmentIds: [] // For equipment selection
};

async function checkAuth() {
    try {
        const response = await fetch('/api/auth/me');
        if (!response.ok) {
            console.error('Not authenticated, redirecting to login');
            window.location.href = 'login.html';
            return false;
        }
        const data = await response.json();
        console.log('Authenticated as:', data.technician);
        return true;
    } catch (error) {
        console.error('Auth check failed:', error);
        window.location.href = 'login.html';
        return false;
    }
}

document.addEventListener('DOMContentLoaded', async function() {
    // Sjekk autentisering først
    const isAuthenticated = await checkAuth();
    if (!isAuthenticated) return;
    
    // Fortsett med eksisterende kode...
    await initializePage();
});

// NYTT: Rydd opp alle bildecontainere
function clearAllImageContainers() {
    console.log('🧹 Clearing all image containers...');
    
    // Tøm ALLE bildecontainere eksplisitt
    const containerSelectors = [
        '#general-images-gallery',
        '[id^="avvik-images-container-"]',
        '[id^="byttet-images-container-"]',
        '.avvik-images-container',
        '.byttet-images-container'
    ];
    
    containerSelectors.forEach(selector => {
        const containers = document.querySelectorAll(selector);
        containers.forEach(container => {
            container.innerHTML = '';
            console.log(`   ✅ Cleared: ${selector}`);
        });
    });
    
    // Nullstill photo context
    if (window.currentPhotoContext) {
        window.currentPhotoContext = null;
    }
    
    console.log('✅ All image containers cleared');
}

async function initializePage() {
    setLoading(true);
    // NYTT: Rydd opp bilder fra forrige sjekkliste FØRST
    clearAllImageContainers();
    const orderId = new URLSearchParams(window.location.search).get('id');
    if (!orderId) {
        showToast('Mangler ordre-ID!', 'error');
        setLoading(false);
        return;
    }

    try {
        // Ett enkelt, optimalisert API-kall for å hente all data
        const response = await fetch(`/api/orders/${orderId}`);
        if (!response.ok) {
            throw new Error(`Server-feil: ${response.status}`);
        }
        const data = await response.json();

        // Debug logging
        console.log('Order data loaded:', {
            order: data.order,
            customerId: data.order?.customer_id,
            customer: data.customer,
            equipment: data.equipment,
            equipmentCount: data.equipment?.length
        });

        // Oppdater pageState DIREKTE uten å nullstille først
        pageState.order = data.order;
        pageState.customer = data.customer;
        pageState.technician = data.technician;
        pageState.quotes = data.quotes || [];
        
        // VIKTIG: Overskriver equipment arrayet helt for å unngå duplikater
        pageState.equipment = (data.equipment || []).map(eq => ({
            ...eq,
            serviceStatus: eq.serviceStatus || eq.serviceReportStatus || 'not_started',
            internalNotes: eq.internalNotes || eq.data?.internalNotes || ''
        }));

        // Sjekk for duplikater og fjern dem (backup sjekk)
        const uniqueEquipment = [];
        const seenIds = new Set();
        
        for (const eq of pageState.equipment) {
            if (!seenIds.has(eq.id)) {
                seenIds.add(eq.id);
                uniqueEquipment.push(eq);
            }
        }
        
        pageState.equipment = uniqueEquipment;
        
        // Håndter inkluderte anlegg
        if (pageState.order.included_equipment_ids && pageState.order.included_equipment_ids.length > 0) {
            pageState.selectedEquipmentIds = pageState.order.included_equipment_ids;
            console.log('Loaded selected equipment from order:', pageState.selectedEquipmentIds);
        } else {
            // Bakoverkompatibel: NULL eller tom = alle anlegg inkludert
            pageState.selectedEquipmentIds = pageState.equipment.map(eq => eq.id);
            console.log('No specific selection, including all equipment:', pageState.selectedEquipmentIds);
        }
        
        console.log('Equipment after update:', {
            count: pageState.equipment.length,
            ids: pageState.equipment.map(eq => eq.id)
        });

        // Verifiser at customerId faktisk er satt
        if (!pageState.order.customer_id) {
            console.error('WARNING: No customer_id in order data!');
        }

        renderPage();
        setupEventListeners();
    } catch (error) {
        console.error("Feil ved lasting av ordredata:", error);
        showToast("Kunne ikke laste ordredata.", 'error');
    } finally {
        setLoading(false);
    }
}

function renderPage() {
    renderHeader();
    renderCustomerInfo();
    renderEquipmentList();
    renderActionButtons();
}

function renderHeader() {
    const header = document.getElementById('app-header');
    const tech = pageState.technician;
    const today = new Date();
    const dateString = `${today.getDate()}. ${today.toLocaleString('no-NO', { month: 'short' })} ${today.getFullYear()}`;

    header.innerHTML = `
        <a href="index.html" class="header-nav-button" title="Tilbake til dashbord">‹</a>
        <div class="header-main-content">
            <div class="logo-circle">
                <svg width="24" height="24" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="16" cy="16" r="14" stroke="white" stroke-width="2" fill="none"/>
                    <circle cx="16" cy="16" r="8" stroke="white" stroke-width="2" fill="none"/>
                    <circle cx="16" cy="16" r="3" fill="white"/>
                    <path d="M16 2 L16 8" stroke="white" stroke-width="2"/>
                    <path d="M16 24 L16 30" stroke="white" stroke-width="2"/>
                    <path d="M30 16 L24 16" stroke="white" stroke-width="2"/>
                    <path d="M8 16 L2 16" stroke="white" stroke-width="2"/>
                </svg>
            </div>
            <div class="company-info">
                <h1>AIR-TECH AS</h1>
                <span class="app-subtitle">Ordredetaljer</span>
            </div>
        </div>
        <div class="header-user-info">
            ${tech ? `<div class="technician-avatar">${tech.initials}</div>` : ''}
            <span>${dateString}</span>
        </div>
    `;
}

function renderCustomerInfo() {
    const customerHTML = `
        <div class="section-header"><h3>👤 Kundeinformasjon</h3></div>
        <div class="customer-card-grid">
            <div class="info-row"><span class="label">Kundenavn</span> <span class="value">${pageState.customer.name}</span></div>
            <div class="info-row"><span class="label">Kundenummer</span> <span class="value">${pageState.customer.id}</span></div>
            <div class="info-row"><span class="label">Ordrenummer</span> <span class="value">${pageState.order.orderNumber}</span></div>
            <div class="info-row"><span class="label">Avtalenummer</span> <span class="value">${pageState.customer.agreementNumber || 'Ikke satt'}</span></div>
        </div>`;
    document.getElementById('customer-info').innerHTML = customerHTML;
}

function renderQuotesList() {
    if (!pageState.quotes || pageState.quotes.length === 0) return '';
    
    return `
        <div class="quotes-section">
            <h4 style="color: #495057; font-size: 14px; margin-bottom: 8px;">📋 Tilbud</h4>
            ${pageState.quotes.map(quote => `
                <div class="quote-item" data-quote-id="${quote.id}">
                    <div class="quote-header">
                        <span class="quote-title">${quote.description.substring(0, 40)}${quote.description.length > 40 ? '...' : ''}</span>
                        <div class="quote-actions">
                            <span class="quote-status status-${quote.status}">${getStatusText(quote.status)}</span>
                            <button class="delete-quote-btn" data-action="delete-quote" data-quote-id="${quote.id}" title="Slett tilbud">🗑️</button>
                        </div>
                    </div>
                    <div class="quote-details">
                        <span class="quote-price">Estimat: ${quote.estimatedPrice} kr</span>
                        <span class="quote-hours">${quote.estimatedHours} timer</span>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

function getStatusText(status) {
    const statusMap = {
        'pending': 'Venter',
        'sent': 'Sendt',
        'rejected': 'Avvist'
    };
    return statusMap[status] || status;
}

function renderEquipmentList() {
    const container = document.getElementById('equipment-list');
    let equipmentHTML = `<button class="add-system-btn" data-action="add-equipment">+ Legg til Anlegg</button>`;
    
    if (pageState.equipment.length > 0) {
        equipmentHTML += pageState.equipment.map(createEquipmentCardHTML).join('');
    } else {
        equipmentHTML += `<p class="placeholder-text">Ingen anlegg funnet på kunde.</p>`;
    }
    
    // Legg til tilbud-seksjonen
    equipmentHTML += renderQuotesList();
    
    // Legg til "Opprett tilbud" knapp
    equipmentHTML += `<button class="create-quote-btn" data-action="create-quote">+ Opprett tilbud</button>`;
    
    container.innerHTML = `<div class="section-header"><h3>🏭 Anlegg for service</h3></div>` + equipmentHTML;
}

function createEquipmentCardHTML(eq) {
    const statusMap = { 
        'not_started': 'Planlagt', 
        'in_progress': 'Under arbeid', 
        'completed': 'Fullført' 
    };
    const statusText = statusMap[eq.serviceStatus || 'not_started'] || 'Planlagt';
    const statusClass = eq.serviceStatus || 'not_started';
    const isSelected = pageState.selectedEquipmentIds.includes(eq.id);

    return `
        <div class="system-item ${statusClass} ${!isSelected ? 'not-selected' : ''}" data-equipment-id="${eq.id}">
            <!-- Checkbox område - IKKE klikkbart -->
            <div class="equipment-selection-bar">
                <label class="equipment-checkbox">
                    <input type="checkbox" 
                           class="equipment-select-checkbox" 
                           data-equipment-id="${eq.id}" 
                           ${isSelected ? 'checked' : ''}>
                    <span class="checkbox-custom"></span>
                    <span class="checkbox-label">Inkluder i rapport</span>
                </label>
            </div>
            
            <!-- Klikkbart område for å navigere til service -->
            <div class="system-content-wrapper" data-action="navigate-to-service" data-equipment-id="${eq.id}">
                <div class="system-header">
                    <span class="system-badge">ID: ${eq.id}</span>
                    <button class="delete-icon-btn" data-action="delete-start" title="Deaktiver anlegg">🗑️</button>
                </div>
                <div class="system-info">
                    <div class="system-name">${eq.name || 'Ikke navngitt'}</div>
                    <div class="system-details">
                        <span>Type: ${eq.type || 'Ukjent'}</span>
                        ${eq.location ? `<span>Plassering: ${eq.location}</span>` : ''}
                        ${eq.internalNotes ? `<span class="internal-notes">💡 ${eq.internalNotes}</span>` : ''}
                    </div>
                </div>
                <div class="system-status">
                    <span class="status-text">${statusText}</span>
                </div>
            </div>
            
            <!-- Delete confirmation (skjult som standard) -->
            <div class="confirm-delete-container" style="display: none;">
                <p>Sikker på at du vil deaktivere anlegget?</p>
                <div class="form-group">
                    <label for="deactivation-reason-${eq.id}">Årsak til deaktivering (obligatorisk)</label>
                    <textarea id="deactivation-reason-${eq.id}" class="deactivation-reason" placeholder="F.eks. anlegg byttet ut, ikke lenger i bruk"></textarea>
                </div>
                <div class="delete-actions">
                    <button class="btn btn-secondary" data-action="delete-cancel">Avbryt</button>
                    <button class="btn btn-danger" data-action="delete-confirm" data-equipment-id="${eq.id}">Bekreft deaktivering</button>
                </div>
            </div>
        </div>
    `;
}

    function renderActionButtons() {
    const footer = document.querySelector('.action-buttons');
    if (!footer || !pageState.order) return;
    
    // Finn kun valgte anlegg (de som har checkbox avkrysset)
    const selectedEquipment = pageState.equipment.filter(eq => 
        pageState.selectedEquipmentIds.includes(eq.id)
    );
    
    // Sjekk om alle VALGTE anlegg er ferdigstilt
    const allSelectedCompleted = selectedEquipment.length > 0 && 
        selectedEquipment.every(eq => eq.serviceStatus === 'completed');
    
    // Sjekk om ordren allerede er ferdigstilt
    const isOrderCompleted = pageState.order.status === 'completed';
    
    console.log('Action button status:', {
        totalEquipment: pageState.equipment.length,
        selectedCount: selectedEquipment.length,
        allSelectedCompleted,
        isOrderCompleted,
        selectedIds: pageState.selectedEquipmentIds
    });
    
    // Hvis ordre er ferdigstilt, vis kun klikbar status for rapport-regenerering
    if (isOrderCompleted) {
        footer.innerHTML = `
            <button class="order-completed-button" onclick="handleRegenerateReport()">
                <div class="order-completed-message">
                    <i data-lucide="check-circle" style="color: #10b981;"></i>
                    <span>Ordre er fullført</span>
                </div>
            </button>
        `;
    } else {
        // Ordre ikke ferdigstilt - vis ferdigstill-knappen
        let buttonClass = 'btn-disabled';
        let buttonText = 'Fullfør alle valgte anlegg først';
        let disabled = true;
        
        if (selectedEquipment.length === 0) {
            // Ingen anlegg valgt
            buttonText = 'Velg anlegg som skal inkluderes i rapporten';
        } else if (allSelectedCompleted) {
            // Alle valgte anlegg er ferdigstilt
            buttonClass = 'btn-success';
            buttonText = `Ferdigstill ordre (${selectedEquipment.length} anlegg)`;
            disabled = false;
        } else {
            // Noen valgte anlegg er ikke ferdigstilt ennå
            const notCompleted = selectedEquipment.filter(eq => eq.serviceStatus !== 'completed').length;
            buttonText = `${notCompleted} av ${selectedEquipment.length} valgte anlegg ikke ferdig`;
        }
        
        footer.innerHTML = `
            <button 
                class="btn ${buttonClass}" 
                onclick="handleCompleteOrder()"
                ${disabled ? 'disabled' : ''}
            >
                <i data-lucide="check-circle"></i>
                ${buttonText}
            </button>
        `;
    }
    
    // Re-initialize lucide icons
    if (window.lucide) {
        lucide.createIcons();
    }
}

function setupEventListeners() {
    // Eksisterende kode...
    
    document.addEventListener('click', async (event) => {
        const target = event.target.closest('[data-action]');
        if (!target) return;
        
        const action = target.dataset.action;
        
        // Håndter navigering til service separat
        if (action === 'navigate-to-service') {
            event.preventDefault();
            event.stopPropagation();
            const equipmentId = target.dataset.equipmentId;
            navigateToServicePage(equipmentId);
            return;
        }
        
        // Resten av eksisterende actions...
        switch(action) {
            case 'add-equipment': showSelectTypeDialog(); break;
            case 'delete-start': 
                event.preventDefault();
                event.stopPropagation();
                startDeleteProcess(target);
                break;
            case 'delete-cancel': 
                event.preventDefault();
                cancelDeleteProcess(target);
                break;
            case 'delete-confirm': 
                event.preventDefault();
                const equipmentId = target.closest('.system-item').dataset.equipmentId;
                confirmDeleteEquipment(equipmentId);
                break;
            case 'complete-order': handleCompleteOrder(); break;
            case 'create-quote': handleCreateQuote(); break;
            // ... andre cases
        }
    });
    
    // Håndter checkbox endringer - VIKTIG: Stopp propagation
    document.addEventListener('change', async (e) => {
        if (e.target.matches('.equipment-checkbox-input')) {
            const equipmentId = e.target.dataset.equipmentId;
            const isChecked = e.target.checked;
            await handleEquipmentSelectionChange(equipmentId, isChecked);
        }
    });
    
    // Stopp propagation på checkbox label clicks også
    document.addEventListener('click', (e) => {
        if (e.target.closest('.equipment-checkbox')) {
            e.stopPropagation();
        }
    });
}

// Håndter checkbox endringer for anleggsvalg
async function handleEquipmentSelectionChange(equipmentId, isChecked) {
    console.log('Equipment selection changed:', equipmentId, '=', isChecked);
    
    if (isChecked && !pageState.selectedEquipmentIds.includes(equipmentId)) {
        // Legg til i valgte anlegg
        pageState.selectedEquipmentIds.push(equipmentId);
    } else if (!isChecked) {
        // Fjern fra valgte anlegg
        pageState.selectedEquipmentIds = pageState.selectedEquipmentIds.filter(id => id !== equipmentId);
    }
    
    console.log('Updated selectedEquipmentIds:', pageState.selectedEquipmentIds);
    
    // Lagre valget til backend
    await saveSelectedEquipment();
    
    // Oppdater visning av equipment cards
    updateEquipmentCardStyles();
    
    // Oppdater action buttons (ferdigstill-knappen)
    renderActionButtons();
}

// Oppdater visuell stil på equipment cards basert på valg
function updateEquipmentCardStyles() {
    pageState.equipment.forEach(eq => {
        const card = document.querySelector(`[data-equipment-id="${eq.id}"]`);
        if (card) {
            if (pageState.selectedEquipmentIds.includes(eq.id)) {
                card.classList.remove('not-selected');
            } else {
                card.classList.add('not-selected');
            }
        }
    });
}
// Lagre valgte anlegg til database
async function saveSelectedEquipment() {
    try {
        console.log('Saving selected equipment:', pageState.selectedEquipmentIds);
        
        const response = await fetch(`/api/orders/${pageState.order.id}/equipment`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({
                includedEquipmentIds: pageState.selectedEquipmentIds
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Kunne ikke oppdatere anleggsvalg');
        }
        
        const result = await response.json();
        console.log('Selected equipment saved successfully:', result);
        
    } catch (error) {
        console.error('Error saving selected equipment:', error);
        showToast('Kunne ikke lagre anleggsvalg', 'error');
        // Ikke kast feilen videre, la UI fortsette å fungere
    }
}

function startDeleteProcess(button) {
    const systemItem = button.closest('.system-item');
    const confirmContainer = systemItem.querySelector('.confirm-delete-container');
    confirmContainer.style.display = 'block';
    systemItem.classList.add('deleting');
}

function cancelDeleteProcess(button) {
    const systemItem = button.closest('.system-item');
    const confirmContainer = systemItem.querySelector('.confirm-delete-container');
    confirmContainer.style.display = 'none';
    systemItem.classList.remove('deleting');
}

async function confirmDeleteEquipment(equipmentId) {
    const reasonTextarea = document.getElementById(`deactivation-reason-${equipmentId}`);
    const reason = reasonTextarea.value.trim();
    
    if (!reason) {
        showToast('Du må oppgi en årsak for deaktivering', 'error');
        reasonTextarea.focus();
        return;
    }
    
    setLoading(true);
    try {
        const response = await fetch(`/api/equipment/${equipmentId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deactivationReason: reason })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Deaktivering feilet');
        }
        
        const systemItem = document.querySelector(`[data-equipment-id="${equipmentId}"]`);
        systemItem.classList.add('fade-out');
        
        setTimeout(async () => {
            // Fjern fra equipment array
            pageState.equipment = pageState.equipment.filter(eq => eq.id.toString() !== equipmentId.toString());
            
            // Fjern fra selectedEquipmentIds og oppdater backend
            const wasSelected = pageState.selectedEquipmentIds.includes(equipmentId);
            pageState.selectedEquipmentIds = pageState.selectedEquipmentIds.filter(id => id !== equipmentId);
            
            if (wasSelected) {
                await saveSelectedEquipment();
            }
            
            // Oppdater visningen
            renderEquipmentList();
            renderActionButtons();
            showToast('Anlegg deaktivert', 'success');
        }, 300);
    } catch (error) { 
        console.error('Deactivation error:', error);
        showToast(`Deaktivering feilet: ${error.message}`, 'error'); 
    } 
    finally { 
        setLoading(false); 
    }
}

async function handleCompleteOrder() {
    // Dobbeltsjekk at alle valgte anlegg er ferdigstilt
    const selectedEquipment = pageState.equipment.filter(eq => 
        pageState.selectedEquipmentIds.includes(eq.id)
    );
    
    const allSelectedCompleted = selectedEquipment.length > 0 && 
        selectedEquipment.every(eq => eq.serviceStatus === 'completed');
    
    if (!allSelectedCompleted) {
        showToast('Alle valgte anlegg må være ferdigstilt før ordre kan ferdigstilles', 'error');
        return;
    }
    
    // Bekreft med bruker og vis hvilke anlegg som inkluderes
    const confirmMessage = `Er du sikker på at du vil ferdigstille denne ordren?

${selectedEquipment.length} anlegg vil inkluderes i rapporten:
${selectedEquipment.map(eq => `• ${eq.name || eq.type}`).join('\n')}

${pageState.equipment.length - selectedEquipment.length > 0 ? `
${pageState.equipment.length - selectedEquipment.length} anlegg er ikke valgt og vil ikke inkluderes.` : ''}`;
    
    if (!confirm(confirmMessage)) {
        return;
    }
    
    setLoading(true, 'Ferdigstiller ordre og genererer rapporter...');
    try {
        const response = await fetch(`/api/orders/${pageState.order.id}/complete`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({
                includedEquipmentIds: pageState.selectedEquipmentIds
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Kunne ikke ferdigstille ordre');
        }
        
        const result = await response.json();
        console.log('Order completed:', result);
        
        // Oppdater lokal state
        pageState.order.status = 'completed';
        
        // Re-render action buttons
        renderActionButtons();
        
        // Vis suksessmelding med rapport-info
        const reportCount = result.generatedPDFs ? result.generatedPDFs.length : selectedEquipment.length;
        showToast(`Ordre ferdigstilt! ${reportCount} servicerapporter generert.`, 'success');
        
    } catch (error) {
        console.error('Error completing order:', error);
        showToast(`Feil ved ferdigstilling: ${error.message}`, 'error');
    } finally {
        setLoading(false);
    }
}

async function handleDeleteQuote(quoteId) {
    if (!confirm('Er du sikker på at du vil slette dette tilbudet?')) return;
    
    setLoading(true);
    try {
        await fetch(`/api/quotes/${quoteId}`, { method: 'DELETE' });
        pageState.quotes = pageState.quotes.filter(q => q.id !== quoteId);
        renderEquipmentList();
        showToast('Tilbud slettet', 'success');
    } catch (error) {
        showToast('Kunne ikke slette tilbud', 'error');
    } finally {
        setLoading(false);
    }
}

function showSelectTypeDialog() {
    const modal = document.getElementById('add-equipment-modal');
    modal.querySelector('.modal-content').innerHTML = `
        <div class="modal-header">
            <h3>Velg Anleggstype</h3>
            <button class="close-btn" data-action="close-modal">×</button>
        </div>
        <div class="modal-body">
            <p>Laster anleggstyper...</p>
        </div>
    `;
    modal.style.display = 'flex';
    modal.addEventListener('click', handleModalClicks);

    fetch('/api/checklist-templates')
        .then(response => {
            if (!response.ok) {
                throw new Error('Kunne ikke hente anleggstyper.');
            }
            return response.json();
        })
        .then(data => {
            const typeSelectionGrid = document.createElement('div');
            typeSelectionGrid.className = 'type-selection-grid';
            
            data.facilityTypes.forEach(type => {
                const button = document.createElement('button');
                button.dataset.action = 'select-type';
                button.dataset.type = type.id;
                button.textContent = type.name;
                typeSelectionGrid.appendChild(button);
            });
            
            modal.querySelector('.modal-body').innerHTML = '';
            modal.querySelector('.modal-body').appendChild(typeSelectionGrid);
        })
        .catch(error => {
            console.error('Feil ved lasting av anleggstyper:', error);
            modal.querySelector('.modal-body').innerHTML = `<p style="color: red;">Feil: ${error.message}</p>`;
        });
}

function handleModalClicks(e) {
    const target = e.target.closest('[data-action]');
    if (!target) { 
        if (e.target.classList.contains('modal-overlay')) hideModal(); 
        return; 
    }
    const action = target.dataset.action;
    if (action === 'select-type') { 
        pageState.selectedEquipmentType = target.dataset.type; 
        showAddEquipmentForm(); 
    }
    if (action === 'close-modal') { 
        hideModal(); 
    }
}

function showAddEquipmentForm() {
    const modalContent = document.querySelector('#add-equipment-modal .modal-content');
    const typeName = pageState.selectedEquipmentType.charAt(0).toUpperCase() + pageState.selectedEquipmentType.slice(1);
    
    let formFields = '';
    if (pageState.selectedEquipmentType === 'custom') {
        formFields = `
            <div class="form-group">
                <label for="plassering">Beskrivelse</label>
                <input type="text" id="plassering" required placeholder="F.eks. Kontroll av taksluk, etc.">
            </div>
        `;
    } else {
        formFields = `
            <div class="form-group">
                <label for="plassering">Plassering</label>
                <input type="text" id="plassering" required placeholder="F.eks. Teknisk rom 1. etasje, Tak aggregat A">
            </div>
            <div class="form-group">
                <label for="internalNotes">Intern kommentar <span style="color: #6c757d; font-weight: normal;">(valgfritt)</span></label>
                <textarea id="internalNotes" rows="3" placeholder="F.eks. Trenger stige for adgang, nøkkel hos vaktmester, kun originale deler..." style="width: 100%; padding: 10px; border: 1px solid #ced4da; border-radius: 6px; font-family: inherit; font-size: 14px; resize: vertical; box-sizing: border-box;"></textarea>
            </div>
        `;
    }

    modalContent.innerHTML = `
        <form id="equipment-form">
            <div class="modal-header">
                <h3>Legg til anlegg: ${typeName}</h3>
                <button type="button" class="close-btn" data-action="close-modal">×</button>
            </div>
            <div class="modal-body">${formFields}</div>
            <div class="modal-footer">
                <button type="button" class="btn-secondary" data-action="close-modal">Avbryt</button>
                <button type="submit" class="btn-primary">Legg til anlegg</button>
            </div>
        </form>
    `;
    document.getElementById('equipment-form').addEventListener('submit', handleSaveEquipment);
}

async function handleSaveEquipment(event) {
    event.preventDefault(); 
    setLoading(true);
    
    const orderId = pageState.order?.id || new URLSearchParams(window.location.search).get('id');
    const customerId = pageState.order?.customer_id || pageState.order?.customerId || pageState.customer?.id;
    
    if (!customerId) {
        showToast('Feil: Mangler kunde-ID for denne ordren', 'error');
        setLoading(false);
        return;
    }
    
    const newEquipmentData = {
        customerId: customerId,
        type: pageState.selectedEquipmentType,
        name: document.getElementById('plassering').value,
        internalNotes: document.getElementById('internalNotes')?.value || '',
        status: 'active'
    };
    
    console.log('Sender equipment data:', newEquipmentData);
    console.log('Current orderId:', orderId);
    
    try {
        const response = await fetch('/api/equipment', { 
            method: 'POST', 
            headers: { 
                'Content-Type': 'application/json'
            }, 
            body: JSON.stringify(newEquipmentData),
            credentials: 'include'
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            console.error('Server error:', errorData);
            throw new Error(errorData.error || 'Lagring feilet');
        }
        
        const savedEquipment = await response.json();
        console.log('Equipment saved:', savedEquipment);
        
        savedEquipment.serviceStatus = savedEquipment.serviceStatus || 'not_started';
        savedEquipment.internalNotes = savedEquipment.internalNotes || savedEquipment.data?.internalNotes || '';
        
        pageState.equipment.push(savedEquipment);
        
        // Legg til i selectedEquipmentIds automatisk
        pageState.selectedEquipmentIds.push(savedEquipment.id);
        await saveSelectedEquipment();
        
        renderEquipmentList();
        renderActionButtons();
        hideModal();
        showToast('Anlegg lagt til', 'success');
    } catch (error) { 
        console.error('Error saving equipment:', error);
        showToast(`Feil: ${error.message}`, 'error'); 
    } 
    finally { 
        setLoading(false); 
    }
}

async function handleCreateQuote() {
    showCreateQuoteDialog();
}

function showCreateQuoteDialog() {
    const modal = document.getElementById('add-equipment-modal');
    modal.querySelector('.modal-content').innerHTML = `
        <div class="modal-header">
            <h3>Opprett tilbud</h3>
            <button class="close-btn" data-action="close-modal">×</button>
        </div>
        <form id="quote-form" class="quote-form">
            <div class="modal-body">
                <div class="form-section">
                    <div class="form-group">
                        <label class="form-label">Beskrivelse av arbeid</label>
                        <textarea id="quote-description" class="form-input" rows="4" 
                                placeholder="Her trenger man å lage et tilbud" required></textarea>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Estimerte timer</label>
                        <input type="number" id="quote-hours" class="form-input" 
                               step="0.5" min="0" value="0" placeholder="0">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Totalpris for arbeid (kr)</label>
                        <input type="number" id="quote-price" class="form-input" 
                               step="0.01" min="0" value="0" placeholder="0">
                    </div>
                </div>
                
                <div class="form-section">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                        <label class="form-label" style="margin-bottom: 0;">Produkter/deler <span class="optional">(valgfritt)</span></label>
                        <button type="button" class="add-item-btn" onclick="addQuoteItem()" style="background: #4A90E2; color: white; border: none; padding: 6px 12px; border-radius: 6px; font-size: 12px;">+ Legg til produkt</button>
                    </div>
                    <div id="quote-items-container" class="quote-items-container">
                        <!-- Produkter vil bli lagt til her -->
                    </div>
                </div>
            </div>
            
            <div class="modal-footer-custom">
                <button type="button" class="btn-secondary-custom" data-action="close-modal">Avbryt</button>
                <button type="submit" class="btn-primary-custom">Opprett tilbud</button>
            </div>
        </form>
    `;
    
    modal.style.display = 'flex';
    document.getElementById('quote-form').addEventListener('submit', handleSaveQuote);
}

async function handleSaveQuote(event) {
    event.preventDefault();
    setLoading(true);
    
    try {
        const quoteData = {
            orderId: pageState.order.id,
            description: document.getElementById('quote-description').value,
            estimatedHours: parseFloat(document.getElementById('quote-hours').value) || 0,
            estimatedPrice: parseFloat(document.getElementById('quote-price').value) || 0,
            items: gatherQuoteItems(),
            status: 'pending'
        };
        
        const response = await fetch('/api/quotes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(quoteData)
        });
        
        if (!response.ok) throw new Error('Kunne ikke opprette tilbud');
        
        const savedQuote = await response.json();
        pageState.quotes.push(savedQuote);
        renderEquipmentList();
        hideModal();
        showToast('Tilbud opprettet', 'success');
        
    } catch (error) {
        showToast('Kunne ikke opprette tilbud', 'error');
    } finally {
        setLoading(false);
    }
}

function gatherQuoteItems() {
    const items = [];
    const itemElements = document.querySelectorAll('.product-item');
    
    itemElements.forEach(row => {
        const name = row.querySelector('.product-name')?.value?.trim();
        const quantity = parseInt(row.querySelector('.product-quantity')?.value) || 1;
        const price = parseFloat(row.querySelector('.product-price')?.value) || 0;
        
        if (name) {
            items.push({ name, quantity, price });
        }
    });
    
    return items;
}

window.addQuoteItem = function() {
    const container = document.getElementById('quote-items-container');
    const itemRow = document.createElement('div');
    itemRow.className = 'product-item';
    itemRow.innerHTML = `
        <input type="text" placeholder="Produktnavn" class="product-name">
        <input type="number" placeholder="Antall" class="product-quantity" min="1" value="1">
        <input type="number" placeholder="Pris" class="product-price" min="0" step="0.01">
        <button type="button" class="remove-line-btn" onclick="removeQuoteItem(this)"></button>
    `;
    container.appendChild(itemRow);
};

window.removeQuoteItem = function(button) {
    button.closest('.quote-item-row').remove();
};

function navigateToServicePage(equipmentId) {
    const orderId = pageState.order?.id || new URLSearchParams(window.location.search).get('id');
    
    if (!orderId) {
        showToast('Mangler ordre-ID', 'error');
        return;
    }
    
    window.location.href = `service.html?orderId=${orderId}&equipmentId=${equipmentId}`;
}

function hideModal() {
    const modal = document.getElementById('add-equipment-modal');
    modal.style.display = 'none';
    modal.removeEventListener('click', handleModalClicks);
}

function setLoading(isLoading, customMessage = null) {
    const loadingEl = document.getElementById('loading-indicator');
    if (!loadingEl) return;
    
    if (isLoading) {
        // Oppdater melding hvis spesifisert
        const messageEl = loadingEl.querySelector('.loading-spinner p');
        if (messageEl && customMessage) {
            messageEl.textContent = customMessage;
        } else if (messageEl) {
            messageEl.textContent = 'Laster...';
        }
        
        loadingEl.style.display = 'flex';
        document.body.style.overflow = 'hidden'; // Forhindre scrolling
    } else {
        loadingEl.style.display = 'none';
        document.body.style.overflow = ''; // Gjenopprett scrolling
        
        // Reset til standard melding
        const messageEl = loadingEl.querySelector('.loading-spinner p');
        if (messageEl) {
            messageEl.textContent = 'Laster ordre...';
        }
    }
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container') || document.body;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    Object.assign(toast.style, {
        position: 'fixed', 
        top: '20px', 
        right: '20px', 
        padding: '1em',
        borderRadius: '8px', 
        color: 'white', 
        zIndex: '1001',
        background: type === 'error' ? '#d9534f' : type === 'success' ? '#5cb85c' : '#5bc0de',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    });

    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}

// CSS som matcher service.html produkter nøyaktig
const quoteModalStyles = `
<style>
/* Tilbud modal stiler som matcher service.html */
.quote-form .form-section {
    margin-bottom: 20px;
    border-bottom: 1px solid #e9ecef;
    padding-bottom: 20px;
}

.quote-form .form-section:last-child {
    border-bottom: none;
}

/* Container for produkter - matcher service.html */
.quote-items-container {
    border: 1px solid #e9ecef;
    border-radius: 12px;
    background-color: #f8f9fa;
    padding: 12px;
    min-height: 60px;
    max-height: 300px;
    overflow-y: auto;
    margin-bottom: 12px;
}

/* Produkt-rad som matcher service.html styling NØYAKTIG */
.quote-item-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: white;
    border: 1px solid #e9ecef;
    border-radius: 12px;
    margin-bottom: 8px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}

.quote-item-row:last-child {
    margin-bottom: 0;
}

/* Produktnavn input - største felt (som i service.html) */
.item-description {
    flex: 2;
    padding: 8px 12px;
    border: 1px solid #ced4da;
    border-radius: 8px;
    font-size: 14px;
    transition: border-color 0.2s ease;
    background: white;
}

.item-description:focus {
    outline: none;
    border-color: #4A90E2;
    box-shadow: 0 0 0 2px rgba(74, 144, 226, 0.1);
}

/* Antall input - liten og sentrert (som i service.html) */
.item-quantity {
    flex: 0 0 45px;
    width: 45px;
    max-width: 45px;
    padding: 8px 4px;
    border: 1px solid #ced4da;
    border-radius: 8px;
    text-align: center;
    font-size: 14px;
    transition: border-color 0.2s ease;
    background: white;
}

.item-quantity:focus {
    outline: none;
    border-color: #4A90E2;
    box-shadow: 0 0 0 2px rgba(74, 144, 226, 0.1);
}

/* Pris input - høyrejustert (som i service.html) */
.item-price {
    flex: 0 0 70px;
    width: 70px;
    max-width: 70px;
    padding: 8px 6px;
    border: 1px solid #ced4da;
    border-radius: 8px;
    text-align: right;
    font-size: 14px;
    transition: border-color 0.2s ease;
    background: white;
}

.item-price:focus {
    outline: none;
    border-color: #4A90E2;
    box-shadow: 0 0 0 2px rgba(74, 144, 226, 0.1);
}

/* Legg til produkt knapp */
.add-item-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    border: none;
    border-radius: 8px;
    background: #4A90E2;
    color: white;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    transition: all 0.2s ease;
    margin-bottom: 8px;
}

.add-item-btn:hover {
    background: #357ABD;
    transform: translateY(-1px);
}

/* Fjern produkt knapp - rød sirkel med X (NØYAKTIG som service.html) */
.remove-item-btn {
    width: 24px;
    height: 24px;
    padding: 0;
    border: 1px solid #fecaca;
    background: #fef2f2;
    color: #dc2626;
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    font-weight: bold;
    transition: all 0.2s ease;
    text-decoration: none;
    overflow: hidden;
    flex: 0 0 auto;
    position: relative;
}

.remove-item-btn:hover {
    background: #dc2626;
    color: white;
    border-color: #dc2626;
    transform: scale(1.1);
}

/* Optional tekst styling */
.optional {
    color: #6c757d;
    font-weight: normal;
    font-size: 12px;
}

/* Form grupper og labels */
.form-group {
    margin-bottom: 16px;
}

.form-label {
    display: block;
    font-size: 14px;
    font-weight: 600;
    color: #374151;
    margin-bottom: 6px;
}

.form-input {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    font-size: 14px;
    transition: border-color 0.2s ease;
    background: white;
}

.form-input:focus {
    outline: none;
    border-color: #4A90E2;
    box-shadow: 0 0 0 2px rgba(74, 144, 226, 0.1);
}

/* Responsive design */
@media (max-width: 768px) {
    .quote-item-row {
        flex-direction: column;
        align-items: stretch;
        gap: 8px;
    }
    
    .item-description,
    .item-quantity,
    .item-price {
        flex: 1;
        width: 100%;
        max-width: none;
    }
    
    .item-quantity,
    .item-price {
        text-align: left;
    }
    
    .remove-item-btn {
        align-self: flex-end;
        margin-top: 4px;
    }
}

/* Empty state */
.quote-items-container:empty::before {
    content: "Klikk 'Legg til produkt' for å legge til produkter/deler";
    color: #6c757d;
    font-style: italic;
    font-size: 13px;
    display: block;
    text-align: center;
    padding: 20px;
}
</style>
`;

// Legg til stilene i dokumentet
if (!document.getElementById('quote-modal-styles')) {
    const styleElement = document.createElement('div');
    styleElement.id = 'quote-modal-styles';
    styleElement.innerHTML = quoteModalStyles;
    document.head.appendChild(styleElement);
}

// CSS kopierat exakt från service.html
const serviceCSS = `
<style>
/* PRODUKTER - Exakt från service.html */
.product-item { 
    display: flex; 
    gap: 8px; 
    align-items: center; 
    width: 100%;
    margin-bottom: 8px;
    padding: 8px 12px;
    background: white;
    border: 1px solid #e9ecef;
    border-radius: 12px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}

.product-item .product-name,
.product-item input[placeholder="Produktnavn"] { 
    flex: 1 1 auto; 
    min-width: 120px;
    padding: 8px 12px;
    border: 1px solid #ced4da;
    border-radius: 8px;
    font-size: 14px;
    transition: border-color 0.2s ease;
    background: white;
}

.product-item input[placeholder="Produktnavn"]:focus { 
    outline: none;
    border-color: #4A90E2;
    box-shadow: 0 0 0 2px rgba(74, 144, 226, 0.1);
}

.product-item .product-quantity,
.product-item input[placeholder="Antall"] { 
    flex: 0 0 45px;
    width: 45px;
    max-width: 45px;
    padding: 8px 4px;
    border: 1px solid #ced4da;
    border-radius: 8px;
    text-align: center;
    font-size: 14px;
    transition: border-color 0.2s ease;
    background: white;
}

.product-item input[placeholder="Antall"]:focus { 
    outline: none;
    border-color: #4A90E2;
    box-shadow: 0 0 0 2px rgba(74, 144, 226, 0.1);
}

.product-item .product-price,
.product-item input[placeholder="Pris"] { 
    flex: 0 0 70px;
    width: 70px;
    max-width: 70px;
    padding: 8px 6px;
    border: 1px solid #ced4da;
    border-radius: 8px;
    text-align: right;
    font-size: 14px;
    transition: border-color 0.2s ease;
    background: white;
}

.product-item input[placeholder="Pris"]:focus { 
    outline: none;
    border-color: #4A90E2;
    box-shadow: 0 0 0 2px rgba(74, 144, 226, 0.1);
}

/* PRODUKTER FJERN-KNAPP - RØDT X */
.product-item .remove-line-btn { 
    width: 24px;
    height: 24px;
    padding: 0;
    border: 1px solid #fecaca;
    background: #fef2f2;
    color: #dc2626;
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: bold;
    transition: all 0.2s ease;
    text-decoration: none;
    text-indent: -9999px;
    overflow: hidden;
    flex: 0 0 auto;
    position: relative;
}

.product-item .remove-line-btn:hover { 
    background: #dc2626;
    color: white;
    border-color: #dc2626;
    transform: scale(1.1);
}

.product-item .remove-line-btn::before {
    content: "×";
    font-size: 16px;
    line-height: 1;
    text-indent: 0;
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
}

/* Container styling */
.quote-items-container {
    border: 1px solid #e9ecef;
    border-radius: 12px;
    background-color: #f8f9fa;
    padding: 12px;
    min-height: 60px;
    max-height: 300px;
    overflow-y: auto;
    margin-bottom: 12px;
}
</style>
`;

// Lägg till CSS
if (!document.getElementById('service-css-styles')) {
    const styleElement = document.createElement('div');
    styleElement.id = 'service-css-styles';
    styleElement.innerHTML = serviceCSS;
    document.head.appendChild(styleElement);
}

// Ny funksjon for rapport-regenerering
async function handleRegenerateReport() {
    // Finn anlegg som er inkludert i ordren (de som har rapporter)
    const selectedEquipment = pageState.equipment.filter(eq => 
        pageState.selectedEquipmentIds.includes(eq.id) && eq.serviceStatus === 'completed'
    );
    
    if (selectedEquipment.length === 0) {
        showToast('Ingen ferdigstilte anlegg å generere rapport for', 'error');
        return;
    }
    
    // Vis bekreftelses-dialog
    showRegenerateConfirmation(selectedEquipment);
}

function showRegenerateConfirmation(selectedEquipment) {
    // Fjern eksisterende modal hvis den finnes
    const existingModal = document.querySelector('.simple-confirm-modal');
    if (existingModal) {
        existingModal.remove();
    }
    
    const equipmentNames = selectedEquipment.map(eq => eq.name || eq.type).join(', ');
    
    // Opprett enkel modal
    const modal = document.createElement('div');
    modal.className = 'simple-confirm-modal';
    modal.innerHTML = `
        <div class="simple-confirm-content">
            <p>Er du sikker på at du vil generere rapport på nytt?</p>
            <p><strong>${selectedEquipment.length} anlegg:</strong> ${equipmentNames}</p>
            <p>Dette vil erstatte den eksisterende PDF-rapporten.</p>
            <div class="simple-confirm-buttons">
                <button class="simple-btn simple-btn-cancel" onclick="closeSimpleModal()">Nei</button>
                <button class="simple-btn simple-btn-confirm" onclick="confirmAndCloseModal()">Ja</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Lukk ved klikk utenfor
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeSimpleModal();
        }
    });
}

function closeSimpleModal() {
    const modal = document.querySelector('.simple-confirm-modal');
    if (modal) {
        modal.remove();
    }
}

function confirmAndCloseModal() {
    closeSimpleModal();
    confirmRegenerateReport();
}



// Funksjon for å bekrefte rapport-regenerering
async function confirmRegenerateReport() {
    
    setLoading(true, 'Regenererer servicerapporter...');
    try {
        const response = await fetch(`/api/orders/${pageState.order.id}/regenerate-reports`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({
                includedEquipmentIds: pageState.selectedEquipmentIds
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Kunne ikke regenerere rapporter');
        }
        
        const result = await response.json();
        console.log('Reports regenerated:', result);
        
        // Vis suksessmelding
        const reportCount = result.generatedPDFs ? result.generatedPDFs.length : pageState.selectedEquipmentIds.length;
        showToast(`${reportCount} servicerapporter regenerert!`, 'success');

        // Naviger tilbake til hovedsiden etter 1.5 sekunder
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 1500);
        
    } catch (error) {
        console.error('Error regenerating reports:', error);
        showToast(`Feil ved regenerering: ${error.message}`, 'error');
    } finally {
        setLoading(false);
    }
}