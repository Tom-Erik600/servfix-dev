// air-tech-app/assets/js/orders.js (v7.2 - Dynamic Facility Types)

let pageState = { 
    order: null, 
    customer: null, 
    equipment: [], 
    technician: null,
    quotes: []
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
            equipment: data.equipment
        });

        // Oppdater pageState med den nye, samlede dataen
        pageState = {
            order: data.order,
            customer: data.customer,
            equipment: data.equipment || [],
            technician: data.technician,
            quotes: data.quotes || [] // Sikrer at quotes alltid er et array
        };

        // Transformer equipment data for å sikre serviceStatus er tilgjengelig
        pageState.equipment = pageState.equipment.map(eq => ({
            ...eq,
            serviceStatus: eq.serviceStatus || eq.data?.serviceStatus || 'not_started',
            systemNumber: eq.systemNumber || eq.data?.systemNumber || '',
            systemType: eq.systemType || eq.data?.systemType || '',
            operator: eq.operator || eq.data?.operator || ''
        }));

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
                <svg width="24" height="24" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="14" stroke="white" stroke-width="2" fill="none"/><circle cx="16" cy="16" r="8" stroke="white" stroke-width="2" fill="none"/><circle cx="16" cy="16" r="3" fill="white"/><path d="M16 2 L16 8" stroke="white" stroke-width="2"/><path d="M16 24 L16 30" stroke="white" stroke-width="2"/><path d="M30 16 L24 16" stroke="white" stroke-width="2"/><path d="M8 16 L2 16" stroke="white" stroke-width="2"/></svg>
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

function renderActionButtons() { 
    // Strengere validering - ALLE anlegg må være completed
    const hasEquipment = pageState.equipment.length > 0;
    const allCompleted = hasEquipment && pageState.equipment.every(eq => {
        // Sjekk både serviceStatus og data.serviceStatus for å være sikker
        const status = eq.serviceStatus || eq.data?.serviceStatus || 'not_started';
        return status === 'completed';
    });
    
    // Ekstra logging for debugging
    console.log('Equipment validation:', {
        hasEquipment,
        equipmentCount: pageState.equipment.length,
        equipmentStatuses: pageState.equipment.map(eq => ({
            id: eq.id,
            serviceStatus: eq.serviceStatus,
            dataServiceStatus: eq.data?.serviceStatus
        })),
        allCompleted
    });
    
    document.querySelector('footer.action-buttons').innerHTML = `
        <button class="action-btn" data-action="complete-order" 
                ${!allCompleted ? 'disabled' : ''}
                style="width: 100%; padding: 16px 24px; font-size: 16px; 
                       font-weight: 600; background-color: ${allCompleted ? '#28a745' : '#6c757d'}; 
                       border-color: ${allCompleted ? '#28a745' : '#6c757d'}; color: white;
                       cursor: ${allCompleted ? 'pointer' : 'not-allowed'};">
            ✅ Ferdigstill ordre
        </button>
    `; 
}

function createEquipmentCardHTML(eq) {
    const statusMap = { 'not_started': 'Planlagt', 'in_progress': 'Under arbeid', 'completed': 'Fullført' };
    const statusText = statusMap[eq.serviceStatus] || 'Ukjent';
    const statusClass = eq.serviceStatus || 'not_started';

    return `
        <div class="system-item ${statusClass}" data-equipment-id="${eq.id}">
            <div class="system-content-wrapper">
                <div class="system-header"><span class="system-badge">ID: ${eq.id}</span><button class="delete-icon-btn" data-action="delete-start" title="Deaktiver anlegg">🗑️</button></div>
                <div class="system-info"><div class="system-name">${eq.name}</div><div class="system-details"><span>Systemtype: ${eq.type}</span><span>Betjener: ${eq.operator || 'Ikke angitt'}</span></div></div>
                <div class="system-status"><span class="status-text">${statusText}</span></div>
            </div>
            <div class="confirm-delete-container">
                <p>Sikker på at du vil deaktivere anlegget?</p>
                <div class="form-group"><label for="deactivation-reason-${eq.id}">Årsak til deaktivering (obligatorisk)</label><textarea id="deactivation-reason-${eq.id}" class="deactivation-reason" placeholder="F.eks. anlegget er fjernet..."></textarea></div>
                <div class="confirm-delete-actions"><button class="btn-cancel-delete" data-action="delete-cancel">Avbryt</button><button class="btn-delete-final" data-action="delete-confirm" disabled>Ja, deaktiver</button></div>
            </div>
        </div>`;
}

function setupEventListeners() {
    document.body.addEventListener('click', handleGlobalClick);
    document.body.addEventListener('input', handleGlobalInput);
    
    // Legg til event listener for quote form
    document.body.addEventListener('submit', (e) => {
        if (e.target.id === 'quote-form') {
            handleSaveQuote(e);
        }
    });
}

async function handleGlobalClick(e) {
    const actionTarget = e.target.closest('[data-action]');
    if (actionTarget) {
        e.preventDefault();
        const action = actionTarget.dataset.action;
        const equipmentCard = actionTarget.closest('.system-item');

        switch (action) {
            case 'delete-start': showDeleteConfirmation(equipmentCard); break;
            case 'delete-cancel': hideDeleteConfirmation(equipmentCard); break;
            case 'delete-confirm': deactivateEquipment(equipmentCard); break;
            case 'add-equipment': showSelectTypeDialog(); break;
            case 'create-quote': await handleCreateQuote(); break;
            case 'delete-quote': await handleDeleteQuote(actionTarget.dataset.quoteId); break;
            case 'complete-order': await completeOrder(); break;
        }
        return;
    }

    const cardTarget = e.target.closest('.system-item');
    if (cardTarget && !cardTarget.classList.contains('is-deleting')) {
        navigateToServicePage(cardTarget.dataset.equipmentId);
    }
}

async function completeOrder() {
    setLoading(true);
    try {
        const response = await fetch(`/api/orders/${pageState.order.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'completed' })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Ukjent feil');
        }
        
        showToast('Ordre er fullført!', 'success');
        setTimeout(() => window.location.href = 'index.html', 1000);
    } catch (error) {
        console.error('Error completing order:', error);
        showToast(`Kunne ikke fullføre ordren: ${error.message}`, 'error');
        setLoading(false);
    }
}

function handleGlobalInput(e) {
    if (e.target.classList.contains('deactivation-reason')) {
        const card = e.target.closest('.system-item');
        const confirmButton = card.querySelector('.btn-delete-final');
        confirmButton.disabled = e.target.value.trim() === '';
    }
    
    // Handle input for quote modal
    if (e.target.matches('.product-price-input') || e.target.matches('#quote-price')) {
        updateQuoteTotals();
    }
}

function showDeleteConfirmation(cardElement) { cardElement.classList.add('is-deleting'); }
function hideDeleteConfirmation(cardElement) {
    cardElement.classList.remove('is-deleting');
    cardElement.querySelector('.deactivation-reason').value = '';
    cardElement.querySelector('.btn-delete-final').disabled = true;
}

async function deactivateEquipment(cardElement) {
    setLoading(true);
    const equipmentId = cardElement.dataset.equipmentId;
    const deactivationReason = cardElement.querySelector('.deactivation-reason').value.trim();
    
    // Valider at deaktiveringsgrunnen er fylt ut
    if (!deactivationReason) {
        showToast('Deaktiveringsgrunnen er påkrevd', 'error');
        setLoading(false);
        return;
    }
    
    try {
        const response = await fetch(`/api/equipment/${equipmentId}`, { 
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deactivationReason })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Deaktivering feilet');
        }
        
        // Beholder eksisterende animasjon og UI-oppdatering
        cardElement.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        cardElement.style.opacity = '0';
        cardElement.style.transform = 'scale(0.95)';
        setTimeout(() => {
            pageState.equipment = pageState.equipment.filter(eq => eq.id.toString() !== equipmentId.toString());
            renderEquipmentList();
            renderActionButtons();
            showToast('Anlegg deaktivert', 'success');
        }, 300);
    } catch (error) { 
        console.error('Deactivation error:', error);
        showToast(`Deaktivering feilet: ${error.message}`, 'error');
    } finally {
        setLoading(false);
    }
}

function navigateToServicePage(equipmentId) {
    window.location.href = `service.html?orderId=${pageState.order.id}&equipmentId=${equipmentId}`;
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
                    <div class="products-header">
                        <label class="form-label">Produkter/materialer</label>
                        <button type="button" class="add-product-btn-custom" onclick="addQuoteProduct()">
                            + Legg til produkt
                        </button>
                    </div>
                    <div id="quote-products-container" class="products-container">
                        <div class="product-row">
                            <div class="product-inputs">
                                <input type="text" placeholder="Produktnavn" class="product-name-input">
                                <input type="text" placeholder="0" class="product-price-input">
                            </div>
                            <button type="button" class="remove-product-btn" onclick="removeQuoteProduct(this)">
                                <span>×</span>
                            </button>
                        </div>
                    </div>
                </div>
                
                <div class="totals-section">
                    <div class="total-row">
                        <span>Produkter:</span>
                        <span id="quote-products-total">0 kr</span>
                    </div>
                    <div class="total-row">
                        <span>Arbeid:</span>
                        <span id="quote-work-total">0 kr</span>
                    </div>
                    <div class="total-row grand-total">
                        <span>Totalt:</span>
                        <span id="quote-grand-total">0 kr</span>
                    </div>
                </div>
            </div>
            
            <div class="modal-footer-custom">
                <button type="button" class="btn-secondary-custom" data-action="close-modal">Avbryt</button>
                <button type="button" class="btn-preview-custom" disabled title="Kommer snart">Forhåndsvisning</button>
                <button type="submit" class="btn-primary-custom">Send til admin</button>
            </div>
        </form>
    `;
    
    modal.style.display = 'flex';
    modal.addEventListener('click', handleQuoteModalClicks);
    
    // Initial totals update
    updateQuoteTotals();
}

function addQuoteProduct() {
    const container = document.getElementById('quote-products-container');
    const newRow = document.createElement('div');
    newRow.className = 'product-row';
    newRow.innerHTML = `
        <div class="product-inputs">
            <input type="text" placeholder="Produktnavn" class="product-name-input">
            <input type="text" placeholder="0" class="product-price-input">
        </div>
        <button type="button" class="remove-product-btn" onclick="removeQuoteProduct(this)">
            <span>×</span>
        </button>
    `;
    container.appendChild(newRow);
    updateQuoteTotals();
}

function removeQuoteProduct(button) {
    button.closest('.product-row').remove();
    updateQuoteTotals();
}

function updateQuoteTotals() {
    const productInputs = document.querySelectorAll('#quote-products-container .product-price-input');
    const workPriceInput = document.getElementById('quote-price');
    
    let productsTotal = 0;
    productInputs.forEach(input => {
        const price = parseFloat(input.value) || 0;
        productsTotal += price;
    });
    
    const workTotal = parseFloat(workPriceInput?.value) || 0;
    const grandTotal = productsTotal + workTotal;
    
    // Oppdater visning
    const productsSpan = document.getElementById('quote-products-total');
    const workSpan = document.getElementById('quote-work-total');
    const grandSpan = document.getElementById('quote-grand-total');
    
    if (productsSpan) productsSpan.textContent = `${productsTotal.toLocaleString('no-NO')} kr`;
    if (workSpan) workSpan.textContent = `${workTotal.toLocaleString('no-NO')} kr`;
    if (grandSpan) grandSpan.textContent = `${grandTotal.toLocaleString('no-NO')} kr`;
}

function handleQuoteModalClicks(e) {
    const target = e.target.closest('[data-action]');
    if (!target) { 
        if (e.target.classList.contains('modal-overlay')) hideModal(); 
        return; 
    }
    
    const action = target.dataset.action;
    if (action === 'close-modal') hideModal();
}

async function handleSaveQuote(event) {
    event.preventDefault();
    setLoading(true);
    
    const description = document.getElementById('quote-description').value;
    const hours = document.getElementById('quote-hours').value;
    const price = document.getElementById('quote-price').value;
    
    // Samle produkter
    const productRows = document.querySelectorAll('#quote-products-container .product-row');
    const products = Array.from(productRows).map(row => ({
        name: row.querySelector('.product-name-input').value,
        price: parseFloat(row.querySelector('.product-price-input').value) || 0
    })).filter(p => p.name.trim() !== '');
    
    const quoteData = {
        orderId: pageState.order.id,
        description,
        estimatedHours: parseFloat(hours) || 0,
        estimatedPrice: parseFloat(price) || 0,
        products
    };
    
    try {
        const savedQuote = await fetch('/api/quotes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(quoteData)
        }).then(res => {
            if (!res.ok) throw new Error('Lagring feilet');
            return res.json();
        });
        
        pageState.quotes.push(savedQuote);
        renderEquipmentList();
        hideModal();
        showToast('Tilbud sendt til admin', 'success');
    } catch (error) {
        showToast('Kunne ikke opprette tilbud', 'error');
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
    modal.querySelector('.modal-content').innerHTML = `<div class="modal-header"><h3>Velg Anleggstype</h3><button class="close-btn" data-action="close-modal">×</button></div><div class="modal-body"><p>Laster anleggstyper...</p></div>`;
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
            
            modal.querySelector('.modal-body').innerHTML = ''; // Clear loading text
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
    if (action === 'select-type') { pageState.selectedEquipmentType = target.dataset.type; showAddEquipmentForm(); }
    if (action === 'close-modal') { hideModal(); }
}

function showAddEquipmentForm() {
    const modalContent = document.querySelector('#add-equipment-modal .modal-content');
    const typeName = pageState.selectedEquipmentType.charAt(0).toUpperCase() + pageState.selectedEquipmentType.slice(1);
    
    let formFields = '';
    if (pageState.selectedEquipmentType === 'custom') {
        formFields = `<div class="form-group"><label for="plassering">Beskrivelse</label><input type="text" id="plassering" required placeholder="F.eks. Kontroll av taksluk, etc."></div>`;
    } else {
        formFields = `<div class="form-group"><label for="plassering">Plassering</label><input type="text" id="plassering" required placeholder="F.eks. Teknisk rom, Tak, etc."></div><div class="form-group"><label for="systemNumber">Systemnummer</label><input type="text" id="systemNumber" required placeholder="F.eks. VA-1001"></div><div class="form-group"><label for="systemType">Systemtype</label><input type="text" id="systemType" required placeholder="F.eks. Aggregat A, Sentralvifte"></div><div class="form-group"><label for="operator">Betjener</label><input type="text" id="operator" placeholder="F.eks. Kontorlokaler, Leilighet 404"></div>`;
    }

    modalContent.innerHTML = `<form id="equipment-form"><div class="modal-header"><h3>Legg til anlegg: ${typeName}</h3><button type="button" class="close-btn" data-action="close-modal">×</button></div><div class="modal-body">${formFields}</div><div class="modal-footer"><button type="button" class="btn-secondary" data-action="close-modal">Avbryt</button><button type="submit" class="btn-primary">Legg til anlegg</button></div></form>`;
    document.getElementById('equipment-form').addEventListener('submit', handleSaveEquipment);
}

async function handleSaveEquipment(event) {
    event.preventDefault(); 
    setLoading(true);
    
    const customerId = pageState.order.customer_id || pageState.order.customerId;
    
    if (!customerId) {
        showToast('Feil: Mangler kunde-ID for denne ordren', 'error');
        setLoading(false);
        return;
    }
    
    const newEquipmentData = {
        customerId: customerId, // Bruker variabelen
        customerId: customerId, // Bruker variabelen
        type: pageState.selectedEquipmentType,
        name: document.getElementById('plassering').value,
        systemNumber: document.getElementById('systemNumber')?.value || 'N/A',
        systemType: document.getElementById('systemType')?.value || 'N/A',
        operator: document.getElementById('operator')?.value || '',
        status: 'active',
        serviceStatus: 'not_started'
    };
    
    console.log('Sender equipment data:', newEquipmentData); // Debug logging
    
    try {
        const response = await fetch('/api/equipment', { 
            method: 'POST', 
            headers: { 
                'Content-Type': 'application/json',
                'X-Tenant-Id': 'airtech' // Legg til hvis nødvendig
            }, 
            body: JSON.stringify(newEquipmentData),
            credentials: 'include' // Sikrer at cookies sendes med
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            console.error('Server error:', errorData);
            throw new Error(errorData.error || 'Lagring feilet');
        }
        
        const savedEquipment = await response.json();
        console.log('Equipment saved:', savedEquipment); // Debug logging
        
        pageState.equipment.push(savedEquipment);
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

function hideModal() { 
    const modal = document.getElementById('add-equipment-modal');
    modal.style.display = 'none';
    modal.removeEventListener('click', handleModalClicks);
}

function setLoading(isLoading) { document.getElementById('loading-indicator').style.display = isLoading ? 'flex' : 'none'; }

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container') || document.body;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    Object.assign(toast.style, {
        position: 'fixed', top: '20px', right: '20px', padding: '1em',
        borderRadius: '8px', color: 'white', zIndex: '1001',
        background: type === 'error' ? '#d9534f' : type === 'success' ? '#5cb85c' : '#5bc0de',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    });

    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}