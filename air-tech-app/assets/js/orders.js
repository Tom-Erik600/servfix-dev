// air-tech-app/assets/js/orders.js (v5.9 - Stabil)

let pageState = { order: null, customer: null, equipment: [], technician: null };

document.addEventListener('DOMContentLoaded', initializePage);

async function initializePage() {
    setLoading(true);
    const orderId = new URLSearchParams(window.location.search).get('id');
    if (!orderId) { 
        showToast('Mangler ordre-ID!', 'error'); 
        setLoading(false); 
        return; 
    }
    try {
        const orderPromise = fetch(`/api/orders/${orderId}`).then(res => res.json());
        const equipmentPromise = fetch('/api/equipment').then(res => res.json());
        const techniciansPromise = fetch('/api/technicians').then(res => res.json());

        const [order, allEquipment, technicians] = await Promise.all([orderPromise, equipmentPromise, techniciansPromise]);
        
        const customer = await fetch(`/api/customers/${order.customerId}`).then(res => res.json());
        const equipment = allEquipment.filter(eq => eq.customerId === order.customerId && eq.status !== 'inactive');
        const technician = technicians.find(t => t.id === order.technicianId);

        pageState = { order, customer, equipment, technician };
        
        renderPage();
        setupEventListeners();
    } catch (error) { 
        console.error("Feil ved lasting av ordredata:", error); 
        showToast("Kunne ikke laste ordredata.", 'error'); 
    } 
    finally { 
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

function renderEquipmentList() {
    const container = document.getElementById('equipment-list');
    let equipmentHTML = `<button class="add-system-btn" data-action="add-equipment">+ Legg til Anlegg</button>`;
    if (pageState.equipment.length > 0) {
        equipmentHTML += pageState.equipment.map(createEquipmentCardHTML).join('');
    } else {
        equipmentHTML += `<p class="placeholder-text">Ingen anlegg funnet på kunde.</p>`;
    }
    container.innerHTML = `<div class="section-header"><h3>🏭 Anlegg for service</h3></div>` + equipmentHTML;
}

function renderActionButtons() { 
    const allCompleted = pageState.equipment.length > 0 && pageState.equipment.every(eq => eq.serviceStatus === 'completed');
    document.querySelector('footer.action-buttons').innerHTML = `
        <button class="action-btn" data-action="complete-order" ${!allCompleted ? 'disabled' : ''}>✅ Ferdigstill ordre</button>
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
        await fetch(`/api/orders/${pageState.order.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'completed' })
        });
        showToast('Ordre er fullført!', 'success');
        setTimeout(() => window.location.href = 'index.html', 1000);
    } catch (error) {
        showToast('Kunne ikke fullføre ordren.', 'error');
        setLoading(false);
    }
}

function handleGlobalInput(e) {
    if (e.target.classList.contains('deactivation-reason')) {
        const card = e.target.closest('.system-item');
        const confirmButton = card.querySelector('.btn-delete-final');
        confirmButton.disabled = e.target.value.trim() === '';
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
    try {
        await fetch(`/api/equipment/${equipmentId}`, { method: 'DELETE' });
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
        showToast('Deaktivering feilet.', 'error'); 
    } 
    finally { setLoading(false); }
}

function navigateToServicePage(equipmentId) {
    window.location.href = `service.html?orderId=${pageState.order.id}&equipmentId=${equipmentId}`;
}

function showSelectTypeDialog() {
    const modal = document.getElementById('add-equipment-modal');
    modal.querySelector('.modal-content').innerHTML = `<div class="modal-header"><h3>Velg Anleggstype</h3><button class="close-btn" data-action="close-modal">×</button></div><div class="modal-body"><div class="type-selection-grid"><button data-action="select-type" data-type="boligventilasjon">Boligventilasjon</button><button data-action="select-type" data-type="ventilasjon">Ventilasjon</button><button data-action="select-type" data-type="vifter">Vifter</button><button data-action="select-type" data-type="custom">Custom</button></div></div>`;
    modal.style.display = 'flex';
    modal.addEventListener('click', handleModalClicks);
}

function handleModalClicks(e) {
    const target = e.target.closest('[data-action]');
    if (!target) { if (e.target.classList.contains('modal-overlay')) hideModal(); return; }
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
    event.preventDefault(); setLoading(true);
    const newEquipmentData = {
        customerId: pageState.order.customerId,
        type: pageState.selectedEquipmentType,
        name: document.getElementById('plassering').value,
        systemNumber: document.getElementById('systemNumber')?.value || 'N/A',
        systemType: document.getElementById('systemType')?.value || 'N/A',
        operator: document.getElementById('operator')?.value || '',
        status: 'active',
        serviceStatus: 'not_started'
    };
    try {
        const savedEquipment = await fetch('/api/equipment', { 
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newEquipmentData) 
        }).then(res => { if (!res.ok) throw new Error('Lagring feilet'); return res.json(); });
        pageState.equipment.push(savedEquipment);
        renderEquipmentList();
        renderActionButtons();
        hideModal();
        showToast('Anlegg lagt til', 'success');
    } catch (error) { 
        showToast(error.message, 'error'); 
    } 
    finally { setLoading(false); }
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