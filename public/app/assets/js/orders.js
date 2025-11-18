// air-tech-app/assets/js/orders.js - Tekniker frontend

let pageState = { 
    order: null, 
    customer: null, 
    equipment: [], 
    technician: null,
    quotes: [],
    selectedEquipmentIds: [] // For equipment selection
};

/**
 * Nullstiller pageState eksplisitt for å unngå at gammel state vises
 * Dette er kritisk for å forhindre race conditions ved navigering
 */
function resetPageState() {
    console.log('🔄 Resetting page state completely...');
    pageState = { 
        order: null, 
        customer: null, 
        equipment: [],  // TØM array
        technician: null,
        quotes: [],
        selectedEquipmentIds: []
    };
}

/**
 * Escapes HTML special characters in a string to prevent XSS.
 * @param {string | null | undefined} str The string to escape.
 * @returns {string} The escaped string.
 */
function escapeHTML(str) {
    if (str === null || str === undefined) {
        return '';
    }
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

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
    
    // VIKTIG: Nullstill state FØRST for å unngå gammel cached data
    resetPageState();
    
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
        const orderData = data.order || data;

        // Debug logging
        console.log('Order data loaded:', {
            orderData: orderData,
            customerId: orderData?.customer_id,
            customer: data.customer,
            equipment: data.equipment,
            equipmentCount: data.equipment?.length
        });

        // Oppdater pageState DIREKTE uten å nullstille først
        pageState.order = orderData;
        pageState.customer = orderData.customer_data || {};
        pageState.technician = data.technician || {};
        pageState.quotes = data.quotes || [];
        
        // ✅ KRITISK: Filtrer ut inaktive anlegg EKSPLISITT
        const activeEquipment = (data.equipment || []).filter(eq => {
            // Sjekk både equipment_status OG status feltet
            const status = eq.equipment_status || eq.status;
            const isActive = !status || status === 'active';
            
            if (!isActive) {
                console.warn(`⚠️ Filtering out inactive equipment: ${eq.id} (status: ${status})`);
            }
            
            return isActive;
        });

        console.log(`✅ Filtered equipment: ${data.equipment?.length || 0} -> ${activeEquipment.length} active`);

        // Map equipment med korrekt struktur
        pageState.equipment = activeEquipment.map(eq => ({
            ...eq,
            id: parseInt(eq.id),
            serviceStatus: eq.serviceStatus || eq.serviceReportStatus || 'not_started',
            internalNotes: eq.internalNotes || eq.notater || ''
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
        if (!pageState.order) {
            throw new Error('Order data mangler i API response');
        }
        if (pageState.order.included_equipment_ids && pageState.order.included_equipment_ids.length > 0) {
            // Konverter til integers for sammenligning
            pageState.selectedEquipmentIds = pageState.order.included_equipment_ids.map(id => parseInt(id));
            console.log('Loaded selected equipment from order:', pageState.selectedEquipmentIds);
        } else {
            // Bakoverkompatibel: NULL eller tom = alle anlegg inkludert
            pageState.selectedEquipmentIds = pageState.equipment.map(eq => parseInt(eq.id));
            console.log('No specific selection, including all equipment:', pageState.selectedEquipmentIds);
        }
        
        // VIKTIG: Konverter equipment IDs til integers for konsistens
        pageState.equipment = pageState.equipment.map(eq => ({
            ...eq,
            id: parseInt(eq.id)
        }));        
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

async function renderHeader() {
    await renderAppHeader({
        backUrl: 'index.html',
        subtitle: 'Ordredetaljer',
        technician: pageState.technician,
        showDate: true
    });
}

function renderCustomerInfo() {
    // Hent besøksadresse fra customer_data (fysisk adresse)
    const visitAddress = pageState.customer.physicalAddress || 
                        pageState.order.customer_data?.physicalAddress || 
                        'Ikke registrert';
    
    // Avtalenummer - sjekk flere mulige kilder
    const agreementNumber = pageState.order.agreement_number || 
                           pageState.order.customer_data?.agreementNumber || 
                           pageState.customer.agreementNumber || 
                           'Ikke satt';
    
    // Service type og beskrivelse fra ordre
    const serviceType = pageState.order.service_type || 'Generell service';
    const description = pageState.order.description || 'Ingen beskrivelse';
    
    const customerHTML = `
        <div class="section-header"><h3>👤 Kundeinformasjon</h3></div>
        <div class="customer-card-grid">
            <div class="info-row">
                <span class="label">Kundenavn</span> 
                <span class="value">${escapeHTML(pageState.customer.name)}</span>
            </div>
            <div class="info-row">
                <span class="label">Besøksadresse</span> 
                <span class="value">${escapeHTML(visitAddress)}</span>
            </div>
            <div class="info-row">
                <span class="label">Ordrenummer</span> 
                <span class="value">${escapeHTML(pageState.order.orderNumber)}</span>
            </div>
            <div class="info-row">
                <span class="label">Avtalenummer</span> 
                <span class="value">${escapeHTML(agreementNumber)}</span>
            </div>
            <div class="info-row">
                <span class="label">Servicetype</span> 
                <span class="value">${escapeHTML(serviceType)}</span>
            </div>
            <div class="info-row full-width">
                <span class="label">Beskrivelse</span> 
                <span class="value">${escapeHTML(description)}</span>
            </div>
        </div>`;
    document.getElementById('customer-info').innerHTML = customerHTML;
}

function renderQuotesList() {
    if (!pageState.quotes || pageState.quotes.length === 0) return '';
    
    return `
        <div class="quotes-section">
            <h4 style="color: #495057; font-size: 14px; margin-bottom: 8px;">📋 Tilbud</h4>
            ${pageState.quotes.map(quote => {
                const description = quote.description;
                const shortDescription = escapeHTML(description.substring(0, 40)) + (description.length > 40 ? '...' : '');
                const quoteId = escapeHTML(quote.id);
                const status = escapeHTML(quote.status);
                const estimatedPrice = escapeHTML(quote.estimatedPrice);
                const estimatedHours = escapeHTML(quote.estimatedHours);

                return `
                <div class="quote-item" data-quote-id="${quoteId}">
                    <div class="quote-header">
                        <span class="quote-title">${shortDescription}</span>
                        <div class="quote-actions">
                            <span class="quote-status status-${status}">${getStatusText(quote.status)}</span>
                            <button class="delete-quote-btn" data-action="delete-quote" data-quote-id="${quoteId}" title="Slett tilbud">🗑️</button>
                        </div>
                    </div>
                    <div class="quote-details">
                        <span class="quote-price">Estimat: ${estimatedPrice} kr</span>
                        <span class="quote-hours">${estimatedHours} timer</span>
                    </div>
                </div>
            `}).join('')}
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
    
    // ✅ EKSTRA SIKKERHET: Filtrer ut inaktive anlegg her også (dobbeltsjekk)
    const activeEquipment = pageState.equipment.filter(eq => {
        const status = eq.equipment_status || eq.status;
        return !status || status === 'active';
    });
    
    if (activeEquipment.length !== pageState.equipment.length) {
        console.warn(`⚠️ renderEquipmentList: Filtered ${pageState.equipment.length - activeEquipment.length} inactive items`);
        pageState.equipment = activeEquipment;
    }
    
    let equipmentHTML = `<button class="add-system-btn" data-action="add-equipment">+ Legg til Anlegg</button>`;
    
    if (pageState.equipment.length > 0) {
        equipmentHTML += pageState.equipment.map(createEquipmentCard).join('');
    } else {
        equipmentHTML += `<p class="placeholder-text">Ingen aktive anlegg funnet på kunde.</p>`;
    }
    
    // Legg til tilbud-seksjonen
    equipmentHTML += renderQuotesList();
    
    // Legg til "Opprett tilbud" knapp
    equipmentHTML += `<button class="create-quote-btn" data-action="create-quote">+ Opprett tilbud</button>`;
    
    container.innerHTML = `<div class="section-header"><h3>🏭 Anlegg for service</h3></div>` + equipmentHTML;
}

function createEquipmentCard(eq) {
    const isSelected = pageState.selectedEquipmentIds.includes(eq.id);
    
    // Map status correctly
    const statusMap = {
        'not_started': { text: 'Ikke startet', class: 'status-not-started' },
        'in_progress': { text: 'Under arbeid', class: 'status-in-progress' }, 
        'completed': { text: 'Ferdig', class: 'status-completed' }
    };
    
    const serviceStatus = eq.serviceStatus || eq.serviceReportStatus || 'not_started';
    const status = statusMap[serviceStatus] || statusMap['not_started'];
    const statusClass = status.class;
    const statusText = status.text;
    
    return `
        <article class="system-item ${serviceStatus} ${!isSelected ? 'not-selected' : ''}" 
                 data-equipment-id="${eq.id}">
            <div class="kort-topp" onclick="event.stopPropagation();">
                <label class="checkbox-wrapper">
                    <input type="checkbox"
                           class="equipment-select-checkbox"
                           data-equipment-id="${eq.id}"
                           ${isSelected ? 'checked' : ''}>
                    <span>Inkluder</span>
                </label>
                <span class="status-badge ${statusClass}">${statusText}</span>
            </div>

            <div class="kort-innhold" onclick="navigateToServicePage(${eq.id})">
                <div class="kolonne-venstre">
                    <div class="tittel-gruppe">
                        <h3 class="anlegg-tittel">${eq.systemnavn || 'Ikke navngitt'}</h3>
                        <span class="id-merke">ID: ${eq.id}</span>
                    </div>
                    <span class="type-tag">${eq.systemtype || 'ukjent'}</span>
                    <div class="info-blokk">
                        <div class="info-linje"><strong>Systemnr:</strong> ${eq.systemnummer || '-'}</div>
                        <div class="info-linje"><strong>Plassering:</strong> ${eq.plassering || '-'}</div>
                        ${eq.betjener ? `<div class="info-linje"><strong>Betjener:</strong> ${eq.betjener}</div>` : ''}
                    </div>
                </div>

                <div class="kolonne-hoyre">
                    ${eq.notater ? `
                    <div class="kommentar-boks">
                        <strong>Kommentar:</strong>
                        <p>${eq.notater}</p>
                    </div>
                    ` : '<div class="kommentar-boks tom">Ingen kommentar</div>'}
                    
                    <button class="slett-knapp" onclick="event.stopPropagation(); startDeleteProcess(this);">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>
            </div>
            
            <div class="confirm-delete-container" style="display: none;" onclick="event.stopPropagation();">
                <p class="confirm-delete-text">Er du sikker på at du vil deaktivere dette anlegget?</p>
                <div class="form-group">
                    <label>Årsak for deaktivering:</label>
                    <textarea 
                        id="deactivation-reason-${eq.id}"
                        class="deactivation-reason" 
                        placeholder="Oppgi årsak..."
                        rows="2"
                        onclick="event.stopPropagation();"
                    ></textarea>
                </div>
                <div class="confirm-delete-actions">
                    <button class="btn-cancel-delete" onclick="event.stopPropagation(); cancelDeleteProcess(this);">
                        Avbryt
                    </button>
                    <button class="btn-delete-final" onclick="event.stopPropagation(); confirmDeleteEquipment(${eq.id});">
                        Deaktiver anlegg
                    </button>
                </div>
            </div>
        </article>
    `;
}


function renderActionButtons() {
    const footer = document.querySelector('.action-buttons');
    if (!footer || !pageState.order) return;
    
    // Finn alle INKLUDERTE (checked) anlegg
    const selectedEquipment = pageState.equipment.filter(eq => 
        pageState.selectedEquipmentIds.includes(eq.id)
    );
    
    console.log('Selected equipment:', selectedEquipment.length);
    console.log('Selected IDs:', pageState.selectedEquipmentIds);
    
    // Sjekk om alle INKLUDERTE anlegg er ferdigstilt
    const allSelectedCompleted = selectedEquipment.length > 0 && 
        selectedEquipment.every(eq => {
            const isCompleted = eq.serviceStatus === 'completed' || 
                               eq.serviceReportStatus === 'completed';
            console.log(`Equipment ${eq.id}: status=${eq.serviceStatus}, reportStatus=${eq.serviceReportStatus}, completed=${isCompleted}`);
            return isCompleted;
        });
    
    console.log('All selected completed:', allSelectedCompleted);
    
    // Sjekk om ordren allerede er ferdigstilt
    const orderCompleted = pageState.order.status === 'completed';
    
    if (orderCompleted) {
        // Ordren er allerede ferdigstilt - vis grønn melding
        footer.innerHTML = `
            <div class="order-completed-container">
                <div class="order-completed-button">
                    <span style="font-size: 18px;">✓</span>
                    Ordre er fullført
                </div>
            </div>
        `;
    } else {
        // Ordren er ikke ferdigstilt - vis knapp
        const canComplete = allSelectedCompleted && selectedEquipment.length > 0;
        
        // Tekst avhengig av om knappen er klar eller ikke
        const buttonText = canComplete 
            ? 'Ferdigstill ordre' 
            : 'Alle inkluderte anlegg må ferdigstilles først';
        
        // Legg til "ready" class hvis alle er ferdige (gjør knappen grønn)
        const readyClass = canComplete ? 'ready' : '';
        
        footer.innerHTML = `
            <button class="btn-complete-order ${readyClass}" 
                    onclick="handleCompleteOrder()" 
                    ${!canComplete ? 'disabled' : ''}>
                ${canComplete ? '<span style="font-size: 18px;">✓</span>' : ''}
                ${buttonText}
            </button>
        `;
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
        if (e.target.matches('.equipment-select-checkbox')) {
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
    // VIKTIG: Konverter equipmentId til integer for konsistent sammenligning
    const equipmentIdInt = parseInt(equipmentId);
    
    console.log('Equipment selection changed:', equipmentIdInt, '=', isChecked);
    console.log('Current selected IDs:', pageState.selectedEquipmentIds);
    
    if (isChecked && !pageState.selectedEquipmentIds.includes(equipmentIdInt)) {
        // Legg til i valgte anlegg
        pageState.selectedEquipmentIds.push(equipmentIdInt);
        console.log('✅ Added equipment to selection');
    } else if (!isChecked) {
        // Fjern fra valgte anlegg - sammenlign både string og int for sikkerhet
        pageState.selectedEquipmentIds = pageState.selectedEquipmentIds.filter(id => 
            id !== equipmentIdInt && id !== equipmentId
        );
        console.log('❌ Removed equipment from selection');
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
            const checkbox = card.querySelector('.equipment-select-checkbox');
            
            // Dobbeltsjekk: oppdater checkbox state først
            if (checkbox) {
                const shouldBeChecked = pageState.selectedEquipmentIds.includes(parseInt(eq.id));
                if (checkbox.checked !== shouldBeChecked) {
                    checkbox.checked = shouldBeChecked;
                    console.log(`Synced checkbox for equipment ${eq.id} to ${shouldBeChecked}`);
                }
            }
            
            // Oppdater visuell stil
            if (pageState.selectedEquipmentIds.includes(parseInt(eq.id))) {
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
            // ✅ VIKTIG: Fjern fra ALLE state-arrays med konsistent ID-håndtering
            const equipmentIdInt = parseInt(equipmentId);
            
            // Fjern fra equipment array
            pageState.equipment = pageState.equipment.filter(eq => 
                parseInt(eq.id) !== equipmentIdInt
            );
            
            // Fjern fra selectedEquipmentIds
            const wasSelected = pageState.selectedEquipmentIds.includes(equipmentIdInt);
            pageState.selectedEquipmentIds = pageState.selectedEquipmentIds.filter(id => 
                parseInt(id) !== equipmentIdInt
            );
            
            console.log(`✅ Removed from state. Remaining: ${pageState.equipment.length} equipment`);
            
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
    // Finn alle INKLUDERTE (checked) anlegg
    const selectedEquipment = pageState.equipment.filter(eq => 
        pageState.selectedEquipmentIds.includes(eq.id)
    );
    
    // Dobbeltsjekk at alle inkluderte anlegg er ferdigstilt
    const allSelectedCompleted = selectedEquipment.length > 0 && 
        selectedEquipment.every(eq => 
            eq.serviceStatus === 'completed' || 
            eq.serviceReportStatus === 'completed'
        );
    
    if (!allSelectedCompleted) {
        showToast('Alle inkluderte anlegg må være ferdigstilt før ordre kan ferdigstilles', 'error');
        return;
    }
    
    // Tell ikke-inkluderte anlegg
    const notIncludedCount = pageState.equipment.length - selectedEquipment.length;
    
    // Bekreft med bruker og vis hvilke anlegg som inkluderes
    const confirmMessage = `Er du sikker på at du vil ferdigstille denne ordren?\n\n${selectedEquipment.length} anlegg vil inkluderes i rapporten:\n${selectedEquipment.map(eq => `• ${eq.systemnavn || eq.systemtype || 'Ukjent anlegg'}`).join('\n')}\n${notIncludedCount > 0 ? `\n${notIncludedCount} anlegg er ikke inkludert og vil ikke være med i rapporten.` : ''}`;
    
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
        
        // Re-render action buttons for å vise "Ordre er fullført"
        renderActionButtons();
        
        // Vis suksessmelding
        const reportCount = result.generatedPDFs ? result.generatedPDFs.length : selectedEquipment.length;
        showToast(`Ordre ferdigstilt! ${reportCount} ${reportCount === 1 ? 'rapport' : 'rapporter'} generert.`, 'success');
        
        // Vent litt før navigering slik at bruker ser suksessmeldingen
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 2000);
        
    } catch (error) {
        console.error('Complete order error:', error);
        showToast(`Kunne ikke ferdigstille ordre: ${error.message}`, 'error');
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
                <label for="systemnummer">Systemnummer *</label>
                <input type="text" id="systemnummer" required placeholder="F.eks. CUSTOM-001">
            </div>
            <div class="form-group">
                <label for="systemnavn">Beskrivelse *</label>
                <input type="text" id="systemnavn" required placeholder="F.eks. Kontroll av taksluk">
            </div>
            <div class="form-group">
                <label for="plassering">Plassering *</label>
                <input type="text" id="plassering" required placeholder="F.eks. Tak, seksjon B">
            </div>
            <div class="form-group">
                <label for="internalNotes">Intern kommentar</label>
                <textarea id="internalNotes" rows="3" placeholder="F.eks. Trenger stige"></textarea>
            </div>
        `;
    } else {
        formFields = `
            <div class="form-group">
                <label for="systemnummer">Systemnummer *</label>
                <input type="text" id="systemnummer" required placeholder="F.eks. V-001, BA-12, KA-03">
            </div>
            <div class="form-group">
                <label for="systemnavn">Systemnavn *</label>
                <input type="text" id="systemnavn" required placeholder="F.eks. Boligventilasjon Leil 201">
            </div>
            <div class="form-group">
                <label for="plassering">Systemplassering *</label>
                <input type="text" id="plassering" required placeholder="F.eks. Teknisk rom 2.etg vest">
            </div>
            <div class="form-group">
                <label for="betjener">Betjener (valgfritt)</label>
                <input type="text" id="betjener" placeholder="F.eks. Kontorlokaler 1.etg">
            </div>
            <div class="form-group">
                <label for="internalNotes">Intern kommentar</label>
                <textarea id="internalNotes" rows="3" placeholder="F.eks. Trenger stige, nøkkel hos vaktmester" style="width: 100%; box-sizing: border-box;"></textarea>
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
        showToast('Feil: Mangler kunde-ID', 'error');
        setLoading(false);
        return;
    }
    
    const newEquipmentData = {
        customerId: customerId,
        systemtype: pageState.selectedEquipmentType,
        systemnummer: document.getElementById('systemnummer').value || `${pageState.selectedEquipmentType.slice(0,2).toUpperCase()}-${Date.now().toString().slice(-3)}`,
        systemnavn: document.getElementById('systemnavn').value,
        plassering: document.getElementById('plassering').value,
        betjener: document.getElementById('betjener')?.value || null,
        location: null, // ALLTID null - vi bruker ikke dette feltet
        notater: document.getElementById('internalNotes')?.value || '',
        status: 'active'
    };
    
    console.log('Sender equipment data:', newEquipmentData);
    
    try {
        const response = await fetch('/api/equipment', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(newEquipmentData)
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Kunne ikke opprette anlegg');
        }
        
        const createdEquipment = await response.json();
console.log('Equipment opprettet:', createdEquipment);

// VIKTIG: Legg det nye anlegget til i pageState
const newEquipment = {
    id: parseInt(createdEquipment.id),
    customer_id: parseInt(createdEquipment.customer_id),
    systemtype: createdEquipment.systemtype,
    systemnummer: createdEquipment.systemnummer,
    systemnavn: createdEquipment.systemnavn,
    plassering: createdEquipment.plassering,
    betjener: createdEquipment.betjener,
    notater: createdEquipment.notater,
    serviceStatus: 'not_started',
    internalNotes: createdEquipment.notater || ''
};

// Legg til i equipment array
pageState.equipment.push(newEquipment);

// VIKTIG: Legg til i selectedEquipmentIds (automatisk checked)
pageState.selectedEquipmentIds.push(newEquipment.id);

// Lagre valget til backend
await saveSelectedEquipment();

// Lukk modal
hideModal();

// Re-render listen
renderEquipmentList();
renderActionButtons();

showToast('Anlegg opprettet og lagt til i ordren!', 'success');
        
    } catch (error) {
        console.error('Feil ved opprettelse av anlegg:', error);
        showToast(`Feil: ${error.message}`, 'error');
    } finally {
        setLoading(false);
    }
}

async function loadEquipmentData(customerId) {
    try {
        const response = await fetch(`/api/equipment/${customerId}`);
        if (!response.ok) throw new Error('Kunne ikke laste anlegg');
        
        const equipment = await response.json();
        
        // Sorter nyeste først
        equipment.sort((a, b) => b.id - a.id);
        
        pageState.equipment = equipment;
        
        // Refresh visningen
        renderEquipmentList();
        
    } catch (error) {
        console.error('Error loading equipment:', error);
        showToast('Kunne ikke laste anlegg', 'error');
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
        </div>
        <form id="quote-form" class="quote-form">
            <div class="modal-body">
                <div class="form-section">
                    <div class="form-group">
                        <label class="form-label">Beskrivelse av arbeid</label>
                        <textarea id="quote-description" class="form-input" rows="4" 
                                placeholder="Beskriv arbeidet som skal utføres" required></textarea>
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
            
            <div class="modal-footer">
                <button type="button" class="btn-secondary" data-action="close-modal">Avbryt</button>
                <button type="submit" class="btn-primary">Opprett tilbud</button>
            </div>
        </form>
    `;
    
    modal.style.display = 'flex';
    modal.addEventListener('click', handleModalClicks);
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
    
    // VIKTIG: Konverter equipmentId til integer for konsistens
    const eqId = parseInt(equipmentId);
    
    if (!eqId || isNaN(eqId)) {
        showToast('Ugyldig anlegg-ID', 'error');
        console.error('Invalid equipmentId:', equipmentId);
        return;
    }
    
    console.log('Navigating to service page:', { orderId, equipmentId: eqId });
    window.location.href = `service.html?orderId=${orderId}&equipmentId=${eqId}`;
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
        pageState.selectedEquipmentIds.includes(parseInt(eq.id)) ||
        pageState.selectedEquipmentIds.includes(eq.id.toString())
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