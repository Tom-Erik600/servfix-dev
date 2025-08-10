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

async function initializePage() {
    setLoading(true);
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
    const statusText = statusMap[eq.serviceStatus] || 'Ukjent';
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
        
        // Hvis ordre er ferdigstilt, vis kun status med knapp tilbake
        if (isOrderCompleted) {
            footer.innerHTML = `
                <div class="order-completed-message">
                    <i data-lucide="check-circle" style="color: #10b981;"></i>
                    <span>Ordre er fullført</span>
                </div>
                <button class="btn btn-secondary" onclick="window.location.href='index.html'">
                    <i data-lucide="list"></i> Tilbake til oversikt
                </button>
            `;
        } else {
            // Ordre ikke ferdigstilt - vis ferdigstill-knappen
            let buttonClass = 'btn-disabled';
            let buttonText = 'Fullfør alle valgte anlegg først';
            let disabled = true;
            
            if (selectedEquipment.length === 0) {
                // Ingen anlegg valgt
                buttonText = 'Ingen anlegg valgt for ferdigstilling';
            } else if (allSelectedCompleted) {
                // Alle valgte anlegg er ferdigstilt
                buttonClass = 'btn-success';
                buttonText = 'Ferdigstill ordre';
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
                    ${disabled ? 'disabled' : ''}>
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
            case 'delete-start': handleDeleteStart(event); break;
            case 'delete-cancel': handleDeleteCancel(event); break;
            case 'delete-confirm': handleDeleteConfirm(event); break;
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
        const response = await fetch(`/api/equipment/${equipmentId}/deactivate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Deaktivering feilet');
        }
        
        const systemItem = document.querySelector(`[data-equipment-id="${equipmentId}"]`);
        systemItem.classList.add('fade-out');
        
        setTimeout(() => {
            pageState.equipment = pageState.equipment.filter(eq => eq.id.toString() !== equipmentId.toString());
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
    
    // Bekreft med bruker
    const confirmMessage = `Er du sikker på at du vil ferdigstille denne ordren?\n\n` +
        `${selectedEquipment.length} anlegg vil inkluderes i rapporten.\n` +
        `${pageState.equipment.length - selectedEquipment.length} anlegg er ikke valgt og vil ikke inkluderes.`;
    
    if (!confirm(confirmMessage)) {
        return;
    }
    
    setLoading(true);
    try {
        const response = await fetch(`/api/orders/${pageState.order.id}/complete`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include'
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
        
        showToast('Ordre ferdigstilt!', 'success');
        
        // Vent litt før redirect slik at bruker ser meldingen
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 1500);
        
    } catch (error) {
        console.error('Complete order error:', error);
        showToast(error.message, 'error');
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
    showQuoteModal();
}

function showQuoteModal() {
    const modal = document.getElementById('add-equipment-modal');
    modal.querySelector('.modal-content').innerHTML = `
        <div class="modal-header-custom">
            <h3>Opprett tilbud</h3>
            <button type="button" class="close-btn-custom" data-action="close-modal">×</button>
        </div>
        
        <form id="quote-form">
            <div class="modal-body-custom">
                <div class="form-section">
                    <label class="form-label">Beskrivelse av arbeid</label>
                    <textarea id="quote-description" class="form-textarea" required placeholder="Beskriv arbeidsoppgaven som trenger tilbud..." rows="4"></textarea>
                </div>
                
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">Estimerte timer</label>
                        <input type="text" id="quote-hours" class="form-input" placeholder="0">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Totalpris for arbeid (kr)</label>
                        <input type="text" id="quote-price" class="form-input" placeholder="0">
                    </div>
                </div>
                
                <div class="form-section">
                    <label class="form-label">Produkter/deler <span class="optional">(valgfritt)</span></label>
                    <div id="quote-items-container" class="quote-items-container">
                        <button type="button" class="add-item-btn" onclick="addQuoteItem()">+ Legg til produkt</button>
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
    const itemElements = document.querySelectorAll('.quote-item-row');
    
    itemElements.forEach(row => {
        const description = row.querySelector('.item-description')?.value;
        const quantity = parseFloat(row.querySelector('.item-quantity')?.value) || 0;
        const price = parseFloat(row.querySelector('.item-price')?.value) || 0;
        
        if (description && quantity && price) {
            items.push({ description, quantity, price });
        }
    });
    
    return items;
}

window.addQuoteItem = function() {
    const container = document.getElementById('quote-items-container');
    const itemRow = document.createElement('div');
    itemRow.className = 'quote-item-row';
    itemRow.innerHTML = `
        <input type="text" class="item-description" placeholder="Beskrivelse">
        <input type="number" class="item-quantity" placeholder="Antall" min="1" value="1">
        <input type="number" class="item-price" placeholder="Pris" min="0">
        <button type="button" class="remove-item-btn" onclick="removeQuoteItem(this)">×</button>
    `;
    container.insertBefore(itemRow, container.querySelector('.add-item-btn'));
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

function setLoading(isLoading) { 
    document.getElementById('loading-indicator').style.display = isLoading ? 'flex' : 'none'; 
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