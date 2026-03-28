// Air-Tech AS - Planlegg Oppdrag JavaScript
// Håndterer opprettelse av planlagte serviceoppdrag for teknikere

(function() {
    'use strict';

    // State management
    const state = {
        allCustomers: [],
        selectedCustomer: null,
        customerEquipment: [],
        selectedEquipmentIds: [],
        scheduledDate: null,
        searchTimeout: null,
        isLoading: false
    };

    // DOM Elements
    let elements = {};

    // Initialize when DOM is ready
    document.addEventListener('DOMContentLoaded', async () => {
        // Vent på autentisering først
        if (window.authManager) {
            await window.authManager.waitForInitialization();
        }

        // Sjekk om bruker er logget inn
        if (!window.authManager?.isLoggedIn()) {
            console.log('Not authenticated, redirecting...');
            return; // auth-check.js vil håndtere redirect
        }

        initialize();
    });

    function initialize() {
        console.log('📅 Initializing Planlegg Oppdrag page...');

        // Cache DOM elements
        elements = {
            searchInput: document.getElementById('customerSearch'),
            searchResults: document.getElementById('searchResults'),
            customerInfo: document.getElementById('customerInfo'),
            customerNumber: document.getElementById('customerNumber'),
            customerName: document.getElementById('customerName'),
            customerAddress: document.getElementById('customerAddress'),
            customerPhone: document.getElementById('customerPhone'),
            customerContact: document.getElementById('customerContact'),
            customerEmail: document.getElementById('customerEmail'),
            orderDetailsSection: document.getElementById('orderDetailsSection'),
            equipmentList: document.getElementById('equipmentList'),
            equipmentCount: document.getElementById('equipmentCount'),
            selectAllEquipmentBtn: document.getElementById('selectAllEquipmentBtn'),
            deselectAllEquipmentBtn: document.getElementById('deselectAllEquipmentBtn'),
            addEquipmentBtn: document.getElementById('addEquipmentBtn'),
            customerNotes: document.getElementById('customerNotes'),
            orderDescription: document.getElementById('orderDescription'),
            scheduledDate: document.getElementById('scheduledDate'),
            timeOptions: document.getElementById('timeOptions'),
            createBtn: document.getElementById('createPlannedOrderBtn'),
            equipmentModal: document.getElementById('equipmentModal'),
            confirmModal: document.getElementById('confirmModal'),
            confirmMessage: document.getElementById('confirmMessage'),
            confirmYes: document.getElementById('confirmYes'),
            confirmNo: document.getElementById('confirmNo'),
            createOrderLoadingOverlay: document.getElementById('createOrderLoadingOverlay')
        };

        // Populate header with user info
        populateHeader();

        // Setup event listeners
        setupEventListeners();

        // Load initial data
        loadCustomers();

        // Set min-dato til i dag
        const today = getLocalDateString();
        elements.scheduledDate.min = today;
    }

    function getLocalDateString() {
        const now = new Date();
        const timezoneOffsetMs = now.getTimezoneOffset() * 60000;
        return new Date(now.getTime() - timezoneOffsetMs).toISOString().split('T')[0];
    }

    function populateHeader() {
        try {
            const currentUser = window.authManager?.getCurrentUser();
            const technician = currentUser?.technician;
            const isAdmin = currentUser?.isAdmin;

            const techInitialsEl = document.getElementById('technician-initials');
            if (techInitialsEl) {
                let initials = '??';

                if (technician) {
                    initials = technician.initials ||
                              technician.name.split(' ').map(n => n[0]).join('').substring(0, 2);
                } else if (isAdmin && currentUser.adminEmail) {
                    const emailParts = currentUser.adminEmail.split('@')[0];
                    initials = emailParts.substring(0, 2).toUpperCase();
                }

                techInitialsEl.textContent = initials;
            }

            const currentDateEl = document.getElementById('current-date');
            if (currentDateEl) {
                const today = new Date();
                const dateString = `${today.getDate()}. ${today.toLocaleString('no-NO', { month: 'short' })} ${today.getFullYear()}`;
                currentDateEl.textContent = dateString;
            }
        } catch (error) {
            console.error('Error populating header:', error);
        }
    }

    function setupEventListeners() {
        // Search input
        elements.searchInput?.addEventListener('input', handleSearchInput);

        // Click outside to close search results
        document.addEventListener('click', handleClickOutside);

        // Create order button
        elements.createBtn?.addEventListener('click', handleCreatePlannedOrder);

        // Time option buttons
        document.querySelectorAll('.time-option-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.time-option-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const days = parseInt(btn.dataset.days);
                const date = new Date();
                date.setDate(date.getDate() + days);

                state.scheduledDate = date.toISOString().split('T')[0];
                elements.scheduledDate.value = state.scheduledDate;

                validateForm();
            });
        });

        // Dato-input endring
        elements.scheduledDate?.addEventListener('change', (e) => {
            state.scheduledDate = e.target.value;
            document.querySelectorAll('.time-option-btn').forEach(b => b.classList.remove('active'));
            validateForm();
        });

        // Description input
        elements.orderDescription?.addEventListener('input', validateForm);

        // Add equipment button
        elements.addEquipmentBtn?.addEventListener('click', () => {
            if (!state.selectedCustomer) {
                showToast('Velg kunde først', 'error');
                return;
            }
            showNewEquipmentModal();
        });

        elements.selectAllEquipmentBtn?.addEventListener('click', selectAllEquipment);
        elements.deselectAllEquipmentBtn?.addEventListener('click', deselectAllEquipment);
    }

    // =====================
    // Customer Search (same as hasteordre.js)
    // =====================

    async function loadCustomers() {
        try {
            console.log('📋 Loading customers from Tripletex...');

            const response = await fetch('/api/customers', {
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            state.allCustomers = Array.isArray(data) ? data : (data.customers || []);
            console.log(`✅ Loaded ${state.allCustomers.length} customers from Tripletex`);

        } catch (error) {
            console.error('❌ Error loading customers from Tripletex:', error);
            showToast('Kunne ikke laste kunder fra Tripletex', 'error');
        }
    }

    function handleSearchInput(e) {
        clearTimeout(state.searchTimeout);

        const query = e.target.value.trim();

        if (query.length < 2) {
            elements.searchResults.classList.remove('active');
            return;
        }

        state.searchTimeout = setTimeout(() => {
            searchCustomers(query);
        }, 300);
    }

    function searchCustomers(query) {
        const lowerQuery = query.toLowerCase();

        const matches = state.allCustomers.filter(customer =>
            customer.name.toLowerCase().includes(lowerQuery) ||
            (customer.customerNumber && customer.customerNumber.toString().includes(query))
        ).slice(0, 10);

        displaySearchResults(matches);
    }

    function displaySearchResults(customers) {
        if (customers.length === 0) {
            elements.searchResults.innerHTML = '<div class="no-results">Ingen kunder funnet</div>';
            elements.searchResults.classList.add('active');
            return;
        }

        elements.searchResults.innerHTML = customers.map(customer => `
            <div class="search-result-item" data-id="${customer.id}">
                <div>
                    <strong>${escapeHtml(customer.name)}</strong>
                    ${customer.customerNumber ? `<div style="color: #6b7280; font-size: 12px; margin-top: 2px;">Kundenr: ${customer.customerNumber}</div>` : ''}
                </div>
                <div style="color: #4A90E2; font-weight: 600;">\u2192</div>
            </div>
        `).join('');

        elements.searchResults.classList.add('active');

        elements.searchResults.querySelectorAll('.search-result-item').forEach(item => {
            item.addEventListener('click', () => {
                const customerId = item.dataset.id;
                const customer = state.allCustomers.find(c => c.id == customerId);
                selectCustomer(customer);
            });
        });
    }

    async function selectCustomer(customer) {
        console.log('👤 Selected customer:', customer.name);

        state.selectedCustomer = customer;
        state.selectedEquipmentIds = [];
        elements.searchInput.value = customer.name;
        elements.searchResults.classList.remove('active');

        // Update customer info display
        elements.customerNumber.textContent = customer.customerNumber || '-';
        elements.customerName.textContent = customer.name;
        elements.customerAddress.textContent = customer.physicalAddress || customer.address || '-';
        elements.customerPhone.textContent = customer.phone || '-';
        elements.customerContact.textContent = customer.contact || customer.contactPerson || '-';
        elements.customerEmail.textContent = customer.email || '-';

        elements.customerInfo.classList.add('active');

        // Vis oppdragsdetaljer-seksjonen
        elements.orderDetailsSection.style.display = 'block';

        // Fyll inn beskrivelse og kundenotat
        if (elements.orderDescription) {
            elements.orderDescription.value = `Service hos ${customer.name}`;
        }
        if (elements.customerNotes) {
            elements.customerNotes.value = customer.notes || '';
        }

        // Last inn anlegg for denne kunden
        await loadCustomerEquipment(customer.externalId || customer.id);

        validateForm();
    }

    function handleClickOutside(e) {
        if (!elements.searchInput?.contains(e.target) &&
            !elements.searchResults?.contains(e.target)) {
            elements.searchResults?.classList.remove('active');
        }
    }

    // =====================
    // Equipment Loading & Checkbox List
    // =====================

    async function loadCustomerEquipment(customerId) {
        try {
            const response = await fetch(`/api/equipment?customerId=${customerId}`, {
                credentials: 'include'
            });

            if (!response.ok) throw new Error('Kunne ikke hente anlegg');

            const equipment = await response.json();
            state.customerEquipment = Array.isArray(equipment) ? equipment : [];

            renderEquipmentList();

        } catch (error) {
            console.error('Error loading equipment:', error);
            state.customerEquipment = [];
            renderEquipmentList();
        }
    }

    function renderEquipmentList() {
        const activeEquipment = state.customerEquipment.filter(eq => eq.status === 'active' || !eq.status);

        if (activeEquipment.length === 0) {
            elements.equipmentList.innerHTML = '<div class="equipment-list-empty">Ingen anlegg registrert for denne kunden</div>';
            elements.equipmentCount.textContent = 'Ingen anlegg';
            return;
        }

        updateEquipmentCount(activeEquipment.length);

        const groups = new Map();
        const ungroupedKey = '__ungrouped__';

        activeEquipment.forEach(eq => {
            const key = eq.clusterId ? String(eq.clusterId) : ungroupedKey;
            if (!groups.has(key)) {
                groups.set(key, {
                    title: eq.clusterName || 'Ovrige anlegg',
                    items: []
                });
            }
            groups.get(key).items.push(eq);
        });

        elements.equipmentList.innerHTML = Array.from(groups.entries()).map(([key, group]) => {
            const rows = group.items.map(eq => {
                const name = eq.name || eq.systemnavn || eq.type || eq.systemtype || 'Ukjent';
                const placement = eq.systemPlacement || eq.plassering || '';
                const sysNum = eq.systemNumber || eq.systemnummer || '';
                const type = eq.type || eq.systemtype || 'Ukjent type';
                const servedBy = eq.betjener || '—';
                const checked = state.selectedEquipmentIds.includes(eq.id) ? 'checked' : '';

                return `
                    <label class="equipment-checkbox-item">
                        <input type="checkbox" value="${eq.id}" data-cluster-id="${eq.clusterId || ''}" ${checked}>
                        <div>
                            <div class="equipment-checkbox-label">${escapeHtml(name)}</div>
                            <div class="equipment-checkbox-detail-inline">
                                <span class="equipment-checkbox-detail-chip"><strong>Type:</strong> ${escapeHtml(type)}</span>
                                <span class="equipment-checkbox-detail-chip"><strong>Nr:</strong> ${escapeHtml(sysNum || '—')}</span>
                                <span class="equipment-checkbox-detail-chip equipment-checkbox-detail-chip-wide"><strong>Plass:</strong> ${escapeHtml(placement || '—')}</span>
                                <span class="equipment-checkbox-detail-chip equipment-checkbox-detail-chip-wide"><strong>Betjener:</strong> ${escapeHtml(servedBy)}</span>
                            </div>
                        </div>
                    </label>
                `;
            }).join('');

            if (key === ungroupedKey) {
                return `
                    <div class="equipment-cluster-group">
                        <div class="equipment-cluster-header">
                            <div class="equipment-cluster-left">
                                <span style="width: 18px;"></span>
                                <div>
                                    <div class="equipment-cluster-title">${escapeHtml(group.title)}</div>
                                    <div class="equipment-cluster-meta">${group.items.length} anlegg</div>
                                </div>
                            </div>
                        </div>
                        ${rows}
                    </div>
                `;
            }

            const checkedCount = group.items.filter(item => state.selectedEquipmentIds.includes(item.id)).length;
            const allChecked = checkedCount === group.items.length && group.items.length > 0;

            return `
                <div class="equipment-cluster-group">
                    <div class="equipment-cluster-header">
                        <div class="equipment-cluster-left">
                            <input type="checkbox" class="cluster-select-checkbox" data-cluster-id="${escapeHtml(key)}" ${allChecked ? 'checked' : ''}>
                            <div>
                                <div class="equipment-cluster-title">${escapeHtml(group.title)}</div>
                                <div class="equipment-cluster-meta">${group.items.length} anlegg</div>
                            </div>
                        </div>
                        <span class="equipment-cluster-hint">Velg cluster</span>
                    </div>
                    ${rows}
                </div>
            `;
        }).join('');

        elements.equipmentList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            if (cb.classList.contains('cluster-select-checkbox')) {
                cb.addEventListener('change', (e) => {
                    setClusterSelection(e.target.dataset.clusterId, e.target.checked);
                });
                return;
            }

            cb.addEventListener('change', (e) => {
                const eqId = parseInt(e.target.value);
                if (e.target.checked) {
                    if (!state.selectedEquipmentIds.includes(eqId)) {
                        state.selectedEquipmentIds.push(eqId);
                    }
                } else {
                    state.selectedEquipmentIds = state.selectedEquipmentIds.filter(id => id !== eqId);
                }

                updateEquipmentCount(activeEquipment.length);
                syncClusterCheckboxStates();
            });
        });

        syncClusterCheckboxStates();
    }

    function updateEquipmentCount(total) {
        const selectedText = state.selectedEquipmentIds.length > 0
            ? `${state.selectedEquipmentIds.length} valgt av ${total}`
            : `${total} anlegg`;
        elements.equipmentCount.textContent = selectedText;
    }

    function setClusterSelection(clusterId, checked) {
        const clusterEquipment = state.customerEquipment
            .filter(eq => (eq.status === 'active' || !eq.status) && String(eq.clusterId || '') === String(clusterId));

        const clusterIds = clusterEquipment.map(eq => eq.id);

        if (checked) {
            clusterIds.forEach(id => {
                if (!state.selectedEquipmentIds.includes(id)) {
                    state.selectedEquipmentIds.push(id);
                }
            });
        } else {
            state.selectedEquipmentIds = state.selectedEquipmentIds.filter(id => !clusterIds.includes(id));
        }

        renderEquipmentList();
    }

    function syncClusterCheckboxStates() {
        elements.equipmentList.querySelectorAll('.cluster-select-checkbox').forEach(cb => {
            const clusterId = cb.dataset.clusterId;
            const clusterEquipment = state.customerEquipment.filter(eq =>
                (eq.status === 'active' || !eq.status) && String(eq.clusterId || '') === String(clusterId)
            );
            const checkedCount = clusterEquipment.filter(eq => state.selectedEquipmentIds.includes(eq.id)).length;

            cb.checked = clusterEquipment.length > 0 && checkedCount === clusterEquipment.length;
            cb.indeterminate = checkedCount > 0 && checkedCount < clusterEquipment.length;
        });
    }

    function selectAllEquipment() {
        state.selectedEquipmentIds = state.customerEquipment
            .filter(eq => eq.status === 'active' || !eq.status)
            .map(eq => eq.id);
        renderEquipmentList();
    }

    function deselectAllEquipment() {
        state.selectedEquipmentIds = [];
        renderEquipmentList();
    }

    // =====================
    // New Equipment Modal
    // =====================

    function showNewEquipmentModal() {
        const modal = elements.equipmentModal;
        const modalContent = modal.querySelector('.modal-content');

        modalContent.innerHTML = `
            <div class="modal-header">
                <h3>Velg anleggstype</h3>
                <button class="close-btn" data-action="close-modal">&times;</button>
            </div>
            <div class="modal-body">
                <p>Laster anleggstyper...</p>
            </div>
        `;
        modal.classList.add('active');

        modal.addEventListener('click', handleModalOutsideClick);

        // Close button
        modalContent.querySelector('[data-action="close-modal"]').addEventListener('click', hideEquipmentModal);

        fetch('/api/checklist-templates', { credentials: 'include' })
            .then(response => {
                if (!response.ok) throw new Error('Kunne ikke hente anleggstyper');
                return response.json();
            })
            .then(data => {
                const typeGrid = document.createElement('div');
                typeGrid.className = 'type-selection-grid';

                data.facilityTypes.forEach(type => {
                    const button = document.createElement('button');
                    button.dataset.type = type.id;
                    button.textContent = type.name;
                    typeGrid.appendChild(button);
                });

                const modalBody = modal.querySelector('.modal-body');
                modalBody.innerHTML = '';
                modalBody.appendChild(typeGrid);

                typeGrid.querySelectorAll('button').forEach(btn => {
                    btn.addEventListener('click', () => {
                        showEquipmentForm(btn.dataset.type);
                    });
                });
            })
            .catch(error => {
                console.error('Error loading facility types:', error);
                modal.querySelector('.modal-body').innerHTML = `<p style="color: red;">Feil: ${error.message}</p>`;
            });
    }

    function showEquipmentForm(selectedType) {
        const modal = elements.equipmentModal;
        const modalContent = modal.querySelector('.modal-content');
        const typeName = selectedType.charAt(0).toUpperCase() + selectedType.slice(1);

        modalContent.innerHTML = `
            <form id="equipment-form">
                <div class="modal-header">
                    <h3>Legg til anlegg: ${escapeHtml(typeName)}</h3>
                    <button type="button" class="close-btn" data-action="close-modal">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label class="form-label">Systemnummer *</label>
                        <input type="text" id="eq-systemnummer" class="form-input" required
                               placeholder="F.eks. V-001, BA-12, KA-03">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Systemnavn *</label>
                        <input type="text" id="eq-systemnavn" class="form-input" required
                               placeholder="F.eks. Boligventilasjon Leil 201">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Systemplassering *</label>
                        <input type="text" id="eq-plassering" class="form-input" required
                               placeholder="F.eks. Teknisk rom 2.etg vest">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Betjener (valgfritt)</label>
                        <input type="text" id="eq-betjener" class="form-input"
                               placeholder="F.eks. Kontorlokaler 1.etg">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Intern kommentar (valgfritt)</label>
                        <textarea id="eq-notater" class="form-input" rows="2"
                                  placeholder="F.eks. Trenger stige, nøkkel hos vaktmester"></textarea>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn-secondary" data-action="close-modal">Avbryt</button>
                    <button type="submit" class="btn-primary">Legg til anlegg</button>
                </div>
            </form>
        `;

        modalContent.querySelectorAll('[data-action="close-modal"]').forEach(btn => {
            btn.addEventListener('click', hideEquipmentModal);
        });

        document.getElementById('equipment-form').addEventListener('submit', (e) => {
            e.preventDefault();
            handleSaveEquipment(selectedType);
        });
    }

    async function handleSaveEquipment(selectedType) {
        const customerId = state.selectedCustomer?.externalId || state.selectedCustomer?.id;
        if (!customerId) {
            showToast('Feil: Mangler kunde-ID', 'error');
            return;
        }

        const newEquipmentData = {
            customerId: customerId,
            systemtype: selectedType,
            systemnummer: document.getElementById('eq-systemnummer').value.trim(),
            systemnavn: document.getElementById('eq-systemnavn').value.trim(),
            plassering: document.getElementById('eq-plassering').value.trim(),
            betjener: document.getElementById('eq-betjener')?.value.trim() || null,
            location: null,
            notater: document.getElementById('eq-notater')?.value.trim() || '',
            status: 'active'
        };

        if (!newEquipmentData.systemnummer || !newEquipmentData.systemnavn || !newEquipmentData.plassering) {
            showToast('Fyll ut alle påkrevde felter', 'error');
            return;
        }

        try {
            const response = await fetch('/api/equipment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(newEquipmentData)
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || 'Kunne ikke opprette anlegg');
            }

            const createdEquipment = await response.json();
            console.log('✅ Equipment opprettet:', createdEquipment);

            hideEquipmentModal();

            // Refresh utstyrsliste og auto-velg det nye anlegget
            await loadCustomerEquipment(state.selectedCustomer.externalId || state.selectedCustomer.id);
            const newId = parseInt(createdEquipment.id);
            if (!state.selectedEquipmentIds.includes(newId)) {
                state.selectedEquipmentIds.push(newId);
            }
            renderEquipmentList();

            showToast('Anlegg opprettet!', 'success');

        } catch (error) {
            console.error('Feil ved opprettelse av anlegg:', error);
            showToast(`Feil: ${error.message}`, 'error');
        }
    }

    function handleModalOutsideClick(e) {
        if (e.target === elements.equipmentModal) {
            hideEquipmentModal();
        }
    }

    function hideEquipmentModal() {
        elements.equipmentModal.classList.remove('active');
        elements.equipmentModal.removeEventListener('click', handleModalOutsideClick);
    }

    // =====================
    // Custom Confirm Dialog (Ja/Nei)
    // =====================

    function showConfirm(message) {
        return new Promise((resolve) => {
            elements.confirmMessage.textContent = message;
            elements.confirmModal.classList.add('active');

            function handleYes() {
                cleanup();
                resolve(true);
            }

            function handleNo() {
                cleanup();
                resolve(false);
            }

            function handleOutside(e) {
                if (e.target === elements.confirmModal) {
                    cleanup();
                    resolve(false);
                }
            }

            function cleanup() {
                elements.confirmModal.classList.remove('active');
                elements.confirmYes.removeEventListener('click', handleYes);
                elements.confirmNo.removeEventListener('click', handleNo);
                elements.confirmModal.removeEventListener('click', handleOutside);
            }

            elements.confirmYes.addEventListener('click', handleYes);
            elements.confirmNo.addEventListener('click', handleNo);
            elements.confirmModal.addEventListener('click', handleOutside);
        });
    }

    // =====================
    // Form Validation
    // =====================

    function validateForm() {
        const isValid = state.selectedCustomer &&
                        state.scheduledDate &&
                        elements.orderDescription.value.trim().length > 0;

        elements.createBtn.disabled = !isValid;
    }

    function showCreateOrderLoading() {
        elements.createOrderLoadingOverlay?.classList.add('active');
    }

    function hideCreateOrderLoading() {
        elements.createOrderLoadingOverlay?.classList.remove('active');
    }

    // =====================
    // Create Planned Order
    // =====================

    async function handleCreatePlannedOrder() {
        if (!state.selectedCustomer || !state.scheduledDate || state.isLoading) return;

        state.isLoading = true;
        elements.createBtn.disabled = true;
        elements.createBtn.innerHTML = '<span class="loading"></span> Oppretter oppdrag...';
        showCreateOrderLoading();

        try {
            const orderData = {
                customerId: state.selectedCustomer.externalId || state.selectedCustomer.id,
                customerName: state.selectedCustomer.name,
                customerData: state.selectedCustomer,
                description: elements.orderDescription.value.trim(),
                serviceType: 'Planlagt service',
                scheduledDate: state.scheduledDate
            };

            // Legg til anlegg hvis valgt
            if (state.selectedEquipmentIds.length > 0) {
                orderData.includedEquipmentIds = state.selectedEquipmentIds;
            }

            console.log('📅 Creating planned order:', orderData);

            const response = await fetch('/api/orders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(orderData)
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `Server error: ${response.status}`);
            }

            const order = await response.json();
            console.log('✅ Planned order created:', order);

            // Lagre kundenotat hvis endret
            const notesValue = elements.customerNotes?.value?.trim() ?? '';
            if (notesValue !== (state.selectedCustomer.notes || '')) {
                try {
                    await fetch(`/api/customers/${state.selectedCustomer.id}/notes`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ notes: notesValue })
                    });
                } catch (e) {
                    console.error('Kunne ikke lagre kundenotat:', e);
                }
            }

            showToast('Oppdrag planlagt!', 'success');

            // Spør om bruker vil planlegge flere (Ja/Nei)
            setTimeout(async () => {
                const planMore = await showConfirm('Oppdrag opprettet! Vil du planlegge flere oppdrag?');
                if (planMore) {
                    resetForm();
                } else {
                    window.location.href = 'index.html';
                }
            }, 500);

        } catch (error) {
            console.error('Error creating planned order:', error);
            showToast(error.message || 'Kunne ikke opprette oppdrag', 'error');
        } finally {
            state.isLoading = false;
            elements.createBtn.disabled = false;
            elements.createBtn.innerHTML = '\ud83d\udcc5 Planlegg oppdrag';
            hideCreateOrderLoading();
        }
    }

    // =====================
    // Reset Form
    // =====================

    function resetForm() {
        state.selectedCustomer = null;
        state.customerEquipment = [];
        state.selectedEquipmentIds = [];
        state.scheduledDate = null;

        elements.searchInput.value = '';
        elements.customerInfo.classList.remove('active');
        elements.orderDetailsSection.style.display = 'none';
        elements.orderDescription.value = '';
        if (elements.customerNotes) elements.customerNotes.value = '';
        elements.scheduledDate.value = '';
        elements.createBtn.disabled = true;
        elements.equipmentList.innerHTML = '<div class="equipment-list-empty">Velg en kunde for å se anlegg</div>';
        elements.equipmentCount.textContent = 'Ingen anlegg lastet';

        document.querySelectorAll('.time-option-btn').forEach(b => b.classList.remove('active'));
    }

    // =====================
    // Utility Functions
    // =====================

    function showToast(message, type = 'info') {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('show');
        }, 10);

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

})();
