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
            createClusterBtn: document.getElementById('createClusterBtn'),
            assignClusterBtn: document.getElementById('assignClusterBtn'),
            customerNotes: document.getElementById('customerNotes'),
            orderDescriptionSelect: document.getElementById('orderDescriptionSelect'),
            orderDescription: document.getElementById('orderDescription'),
            visitNumber: document.getElementById('visitNumber'),
            serviceAddressStreet: document.getElementById('serviceAddressStreet'),
            serviceAddressPostalCode: document.getElementById('serviceAddressPostalCode'),
            serviceAddressCity: document.getElementById('serviceAddressCity'),
            scheduledDate: document.getElementById('scheduledDate'),
            timeOptions: document.getElementById('timeOptions'),
            createBtn: document.getElementById('createPlannedOrderBtn'),
            equipmentModal: document.getElementById('equipmentModal'),
            clusterModal: document.getElementById('clusterModal'),
            clusterModalTitle: document.getElementById('clusterModalTitle'),
            clusterModalBody: document.getElementById('clusterModalBody'),
            clusterModalSave: document.getElementById('clusterModalSave'),
            clusterModalCancel: document.getElementById('clusterModalCancel'),
            clusterModalClose: document.getElementById('clusterModalClose'),
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

        // Description input (fritekst-fallback)
        elements.orderDescription?.addEventListener('input', validateForm);

        // Project select endring
        elements.orderDescriptionSelect?.addEventListener('change', () => {
            if (elements.orderDescriptionSelect.value === '__manual__') {
                elements.orderDescriptionSelect.style.display = 'none';
                elements.orderDescription.style.display = 'block';
                elements.orderDescription.value = '';
                elements.orderDescription.focus();
            } else {
                elements.orderDescription.value = elements.orderDescriptionSelect.value;
            }
            validateForm();
        });

        // Add equipment button
        elements.addEquipmentBtn?.addEventListener('click', () => {
            if (!state.selectedCustomer) {
                showToast('Velg kunde først', 'error');
                return;
            }
            showNewEquipmentModal();
        });

        // Cluster buttons
        elements.createClusterBtn?.addEventListener('click', () => {
            if (!state.selectedCustomer) {
                showToast('Velg kunde først', 'error');
                return;
            }
            showClusterModal('create');
        });

        elements.assignClusterBtn?.addEventListener('click', () => {
            if (!state.selectedCustomer) {
                showToast('Velg kunde først', 'error');
                return;
            }
            if (state.selectedEquipmentIds.length === 0) {
                showToast('Velg minst ett anlegg først', 'error');
                return;
            }
            showClusterModal('assign');
        });

        // Cluster modal close/cancel
        elements.clusterModalClose?.addEventListener('click', hideClusterModal);
        elements.clusterModalCancel?.addEventListener('click', hideClusterModal);
        elements.clusterModal?.addEventListener('click', (e) => {
            if (e.target === elements.clusterModal) hideClusterModal();
        });

        elements.selectAllEquipmentBtn?.addEventListener('click', selectAllEquipment);
        elements.deselectAllEquipmentBtn?.addEventListener('click', deselectAllEquipment);
    }

    // =====================
    // Project Suggestions (Tripletex)
    // =====================

    async function loadProjectSuggestions(customer) {
        const select = elements.orderDescriptionSelect;
        const textInput = elements.orderDescription;
        if (!select || !textInput) return;

        try {
            const customerId = customer.externalId || customer.id;
            const response = await fetch(`/api/customers/${customerId}/projects`, {
                credentials: 'include'
            });
            const projects = await response.json();

            select.innerHTML = '';

            if (projects.length === 0) {
                // Ingen prosjekter — gå rett til fritekst
                select.style.display = 'none';
                textInput.style.display = 'block';
                textInput.value = `Service hos ${customer.name}`;
                return;
            }

            // Fyll inn prosjekter (nyeste øverst = allerede sortert fra backend)
            projects.forEach((p, i) => {
                const opt = document.createElement('option');
                opt.value = p.displayName;
                opt.textContent = p.displayName;
                if (i === 0) opt.selected = true;
                select.appendChild(opt);
            });

            // Legg til manuelt-valg nederst
            const manualOpt = document.createElement('option');
            manualOpt.value = '__manual__';
            manualOpt.textContent = '✏️ Skriv inn manuelt...';
            select.appendChild(manualOpt);

            // Vis dropdown, skjul fritekst
            select.style.display = 'block';
            textInput.style.display = 'none';
            textInput.value = projects[0].displayName;

        } catch (error) {
            console.error('Kunne ikke laste prosjekter:', error);
            select.style.display = 'none';
            textInput.style.display = 'block';
            textInput.value = `Service hos ${customer.name}`;
        }
    }

    // =====================
    // Cluster Management
    // =====================

    function showClusterModal(mode) {
        const customer = state.selectedCustomer;
        if (!customer) return;

        const title = mode === 'create' ? 'Opprett nytt cluster' : 'Flytt valgte anlegg til cluster';
        elements.clusterModalTitle.textContent = title;

        if (mode === 'create') {
            elements.clusterModalBody.innerHTML = `
                <p style="font-size: 14px; color: #6b7280; margin-bottom: 16px;">Opprett et nytt cluster for kunden. Ingen anlegg flyttes automatisk.</p>
                <div class="form-group">
                    <label class="form-label">Clusternavn</label>
                    <input type="text" id="clusterNameInput" class="form-input" placeholder="F.eks. Industriveien 92 Eidsvoll">
                </div>
            `;
            elements.clusterModalSave.textContent = 'Opprett cluster';
        } else {
            elements.clusterModalBody.innerHTML = `
                <p style="font-size: 14px; color: #6b7280; margin-bottom: 16px;">${state.selectedEquipmentIds.length} valgte anlegg blir oppdatert.</p>
                <div class="form-group">
                    <label class="form-label">Velg cluster</label>
                    <select id="clusterSelect" class="form-input">
                        <option value="">Laster cluster...</option>
                    </select>
                </div>
                <div class="form-group" id="newClusterNameGroup" style="display: none;">
                    <label class="form-label">Nytt clusternavn</label>
                    <input type="text" id="clusterNameInput" class="form-input" placeholder="F.eks. Industriveien 92 Eidsvoll">
                </div>
            `;
            elements.clusterModalSave.textContent = 'Lagre';

            // Last eksisterende clusters
            loadClustersForSelect(customer);
        }

        // Sett opp save-handler
        elements.clusterModalSave.onclick = () => handleClusterModalSave(mode);

        elements.clusterModal.classList.add('active');
    }

    function hideClusterModal() {
        elements.clusterModal.classList.remove('active');
    }

    async function loadClustersForSelect(customer) {
        try {
            const customerId = customer.externalId || customer.id;
            const response = await fetch(`/api/clusters?customerId=${customerId}`, {
                credentials: 'include'
            });
            const clusters = await response.json();

            const select = document.getElementById('clusterSelect');
            if (!select) return;

            select.innerHTML = `
                <option value="">Velg cluster...</option>
                ${clusters.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
                <option value="__new__">+ Opprett nytt cluster...</option>
            `;

            select.addEventListener('change', () => {
                const newNameGroup = document.getElementById('newClusterNameGroup');
                if (newNameGroup) {
                    newNameGroup.style.display = select.value === '__new__' ? 'block' : 'none';
                }
            });
        } catch (error) {
            console.error('Feil ved lasting av clusters:', error);
            showToast('Kunne ikke laste clusters', 'error');
        }
    }

    async function handleClusterModalSave(mode) {
        const customer = state.selectedCustomer;
        if (!customer) return;

        const customerId = customer.externalId || customer.id;
        const nameInput = document.getElementById('clusterNameInput');
        const select = document.getElementById('clusterSelect');

        try {
            elements.clusterModalSave.disabled = true;
            elements.clusterModalSave.textContent = mode === 'create' ? 'Oppretter...' : 'Lagrer...';

            if (mode === 'create') {
                const clusterName = nameInput?.value?.trim();
                if (!clusterName) {
                    showToast('Skriv inn clusternavn', 'error');
                    return;
                }

                await createCluster(customerId, clusterName);
                await loadCustomerEquipment(customerId);
                hideClusterModal();
                showToast(`Cluster "${clusterName}" opprettet`, 'success');
            } else {
                if (!select?.value) {
                    showToast('Velg cluster eller opprett nytt', 'error');
                    return;
                }

                let clusterId;
                if (select.value === '__new__') {
                    const clusterName = nameInput?.value?.trim();
                    if (!clusterName) {
                        showToast('Skriv inn clusternavn', 'error');
                        return;
                    }
                    const cluster = await createCluster(customerId, clusterName);
                    clusterId = cluster.id;
                } else {
                    clusterId = select.value;
                }

                await assignEquipmentToCluster(state.selectedEquipmentIds, clusterId);
                await loadCustomerEquipment(customerId);
                hideClusterModal();
                showToast('Cluster oppdatert', 'success');
            }
        } catch (error) {
            console.error('Cluster feil:', error);
            showToast(error.message, 'error');
        } finally {
            elements.clusterModalSave.disabled = false;
            elements.clusterModalSave.textContent = mode === 'create' ? 'Opprett cluster' : 'Lagre';
        }
    }

    async function createCluster(customerId, name) {
        const response = await fetch('/api/clusters', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ customerId: parseInt(customerId), name })
        });

        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || 'Kunne ikke opprette cluster');
        }

        return response.json();
    }

    async function assignEquipmentToCluster(equipmentIds, clusterId) {
        const response = await fetch('/api/equipment/assign-cluster', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ equipmentIds, clusterId: parseInt(clusterId) })
        });

        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || 'Kunne ikke tildele cluster');
        }

        return response.json();
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

        // Last prosjekter fra Tripletex
        await loadProjectSuggestions(customer);

        // Fyll inn kundenotat
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
        const descriptionValue = elements.orderDescription.style.display !== 'none'
            ? elements.orderDescription.value.trim()
            : (elements.orderDescriptionSelect.value && elements.orderDescriptionSelect.value !== '__manual__'
                ? elements.orderDescriptionSelect.value
                : '');

        const isValid = state.selectedCustomer &&
                        state.scheduledDate &&
                        descriptionValue.length > 0;

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
            // Hent beskrivelse fra dropdown eller fritekst
            const description = elements.orderDescription.style.display !== 'none'
                ? elements.orderDescription.value.trim()
                : elements.orderDescriptionSelect.value;

            const visitNumber = elements.visitNumber?.value?.trim() || '';
            const serviceAddressStreet = elements.serviceAddressStreet?.value?.trim() || '';
            const serviceAddressPostalCode = elements.serviceAddressPostalCode?.value?.trim() || '';
            const serviceAddressCity = elements.serviceAddressCity?.value?.trim() || '';

            const orderData = {
                customerId: state.selectedCustomer.externalId || state.selectedCustomer.id,
                customerName: state.selectedCustomer.name,
                customerData: state.selectedCustomer,
                description: description,
                serviceType: 'Planlagt service',
                scheduledDate: state.scheduledDate
            };

            // Legg til besøksnr og serviceadresse i customerData
            if (visitNumber) {
                orderData.customerData = { ...orderData.customerData, visit_number: visitNumber };
            }
            if (serviceAddressStreet) {
                orderData.serviceAddressStreet = serviceAddressStreet;
            }
            if (serviceAddressPostalCode) {
                orderData.serviceAddressPostalCode = serviceAddressPostalCode;
            }
            if (serviceAddressCity) {
                orderData.serviceAddressCity = serviceAddressCity;
            }

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
        elements.orderDescription.style.display = 'none';
        elements.orderDescriptionSelect.innerHTML = '<option value="">⏳ Laster prosjekter...</option>';
        elements.orderDescriptionSelect.style.display = 'block';
        if (elements.visitNumber) elements.visitNumber.value = '';
        if (elements.serviceAddressStreet) elements.serviceAddressStreet.value = '';
        if (elements.serviceAddressPostalCode) elements.serviceAddressPostalCode.value = '';
        if (elements.serviceAddressCity) elements.serviceAddressCity.value = '';
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
