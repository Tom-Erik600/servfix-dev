// VERSION CHECK: 2026-02-16 15:35 - EQUIPMENT FEATURE ADDED
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Starter kundesystem (fullstendig versjon)...');
    console.log('🔧 VERSION: 2026-02-16 15:35 - Equipment feature included');
    
    let allCustomers = [];
    let currentSelectedCustomer = null;
    let customerHistory = [];
    let currentCustomerClusters = [];
    let selectedEquipmentIdsForCluster = [];
    let equipmentClusterCollapseState = {};
    let equipmentTypeOptions = [];

    // DOM-elementer
    const searchInput = document.getElementById('customer-search');
    const customerTableBody = document.getElementById('customer-table-body');
    const detailsPlaceholder = document.getElementById('customer-details-placeholder');
    const detailsContent = document.getElementById('customer-details-content');
    const serviceHistoryContent = document.getElementById('service-history-content');
    const orderModal = document.getElementById('order-modal');
    const equipmentEditModal = document.getElementById('equipment-edit-modal');
    const equipmentConfirmModal = document.getElementById('equipment-confirm-modal');
    const clusterActionModal = document.getElementById('cluster-action-modal');
    let currentCustomerEquipment = [];
    let currentClusterActionMode = null;

    // Optional deep-linking from other admin pages
    const urlParams = new URLSearchParams(window.location.search);
    const preselectCustomerId = urlParams.get('customerId');
    const prefillQuery = urlParams.get('q');
    let didInitialDeepLink = false;
    let resolvedDeepLinkCustomerId = null;

    /**
     * Laster inn alle data
     */
    async function loadData() {
        try {
            showLoadingState();

            // Deep-link fast-path: show the target customer ASAP (before loading full list)
            if (preselectCustomerId && !didInitialDeepLink) {
                try {
                    console.log(`⚡ Deep-link: henter kunde ${preselectCustomerId}...`);
                    const singleResponse = await fetch(`/api/admin/customers/${encodeURIComponent(preselectCustomerId)}`);
                    if (singleResponse.ok) {
                        const singleCustomer = await singleResponse.json();
                        resolvedDeepLinkCustomerId = singleCustomer?.id || null;
                        allCustomers = [singleCustomer];
                        renderCustomerList(allCustomers);
                        hideLoadingState();

                        didInitialDeepLink = true;
                        if (searchInput) searchInput.value = '';
                        const idToSelect = resolvedDeepLinkCustomerId || preselectCustomerId;
                        Promise.resolve(window.selectCustomer(idToSelect)).then(() => {
                            const row = customerTableBody.querySelector(`[data-customer-id="${String(idToSelect)}"]`);
                            if (row && typeof row.scrollIntoView === 'function') {
                                row.scrollIntoView({ block: 'center' });
                            }
                        });
                    }
                } catch (e) {
                    console.warn('Deep-link single customer fetch failed:', e);
                }
            }

            // Load full customer list
            console.log('📡 Laster kunder fra API...');
            const customersResponse = await fetch('/api/admin/customers');
            if (!customersResponse.ok) {
                const errorText = await customersResponse.text();
                console.error('API-feil:', customersResponse.status, errorText);
                throw new Error(`API-feil ${customersResponse.status}: ${errorText}`);
            }

            const customersData = await customersResponse.json();
            console.log('✅ Mottatt kundedata:', customersData);

            if (customersData.customers) {
                allCustomers = customersData.customers;
            } else if (Array.isArray(customersData)) {
                allCustomers = customersData;
            } else {
                throw new Error('Ugyldig dataformat fra API');
            }

            console.log(`✅ Lastet ${allCustomers.length} kunder totalt`);
            renderCustomerList(allCustomers);
            hideLoadingState();

            // Deep-link: preselect customer or prefill search
            if (!didInitialDeepLink) {
                didInitialDeepLink = true;
                if (preselectCustomerId) {
                    if (searchInput) searchInput.value = '';
                    const match = allCustomers.find(c => String(c.id) === String(preselectCustomerId) || String(c.externalId) === String(preselectCustomerId));
                    const idToSelect = match?.id || resolvedDeepLinkCustomerId || preselectCustomerId;
                    Promise.resolve(window.selectCustomer(idToSelect)).then(() => {
                        const row = customerTableBody.querySelector(`[data-customer-id="${String(idToSelect)}"]`);
                        if (row && typeof row.scrollIntoView === 'function') {
                            row.scrollIntoView({ block: 'center' });
                        }
                    });
                } else if (prefillQuery && searchInput) {
                    searchInput.value = prefillQuery;
                    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                }
            } else if (preselectCustomerId) {
                // Ensure selection persists after list refresh
                const match = allCustomers.find(c => String(c.id) === String(preselectCustomerId) || String(c.externalId) === String(preselectCustomerId));
                const idToSelect = match?.id || resolvedDeepLinkCustomerId || preselectCustomerId;
                Promise.resolve(window.selectCustomer(idToSelect));
            }

            // Load service history in the background (can be slow)
            try {
                console.log('📡 Laster servicehistorikk...');
                fetch('/api/admin/orders')
                    .then((historyResponse) => historyResponse.ok ? historyResponse.json() : [])
                    .then((history) => {
                        customerHistory = Array.isArray(history) ? history : [];
                        console.log(`✅ Lastet ${customerHistory.length} ordre`);
                        if (currentSelectedCustomer) {
                            renderServiceHistory(currentSelectedCustomer);
                        }
                    })
                    .catch((historyError) => {
                        console.warn('Kunne ikke laste servicehistorikk:', historyError);
                        customerHistory = [];
                    });
            } catch (historyError) {
                console.warn('Kunne ikke starte lasting av servicehistorikk:', historyError);
                customerHistory = [];
            }
            
        } catch (error) {
            console.error('❌ Feil ved lasting av data:', error);
            showErrorState(`Kunne ikke laste kundedata: ${error.message}`);
        }
    }

    /**
     * Viser loading-tilstand
     */
    function showLoadingState() {
        customerTableBody.innerHTML = `
            <tr>
                <td colspan="3" style="text-align: center; padding: 40px; color: var(--text-light);">
                    <div style="display: flex; align-items: center; justify-content: center; gap: 10px;">
                        <div style="width: 20px; height: 20px; border: 2px solid var(--primary-color); border-top: 2px solid transparent; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                        Laster kunder...
                    </div>
                </td>
            </tr>
        `;
    }

    /**
     * Skjuler loading-tilstand
     */
    function hideLoadingState() {
        // Fjernes når data er lastet
    }

    /**
     * Viser feilmelding
     */
    function showErrorState(message) {
        customerTableBody.innerHTML = `
            <tr>
                <td colspan="3" style="text-align: center; padding: 40px; color: #ef4444;">
                    <strong>Feil:</strong> ${message}
                    <br><br>
                    <button onclick="window.location.reload()" style="padding: 8px 16px; background: var(--primary-color); color: white; border: none; border-radius: 4px; cursor: pointer;">
                        Prøv igjen
                    </button>
                </td>
            </tr>
        `;
    }

    /**
     * Rendrer kundelisten
     */
    function renderCustomerList(customers) {
        if (!customers || customers.length === 0) {
            customerTableBody.innerHTML = `<tr><td colspan="2">Ingen kunder funnet.</td></tr>`;
            return;
        }

        customerTableBody.innerHTML = customers.map(customer => `
            <tr data-customer-id="${customer.id}" onclick="selectCustomer('${customer.id}')" style="cursor: pointer;">
                <td>
                    <div style="font-weight: 500;">${customer.name || 'Ukjent navn'}</div>
                </td>
                <td>
                    <div class="customer-number">${customer.customerNumber || '-'}</div>
                </td>
            </tr>
        `).join('');
    }

/**
 * Velger og viser en kunde - MED lazy loading av adresser
 */
window.selectCustomer = async function(customerId) {
    const customerIdStr = String(customerId);
    
    const customer = allCustomers.find(c => String(c.id) === customerIdStr);
    
    if (!customer) {
        console.error('Kunde ikke funnet:', customerIdStr);
        return;
    }

    // Oppdater valgt rad
    const rows = customerTableBody.querySelectorAll('tr');
    rows.forEach(row => row.classList.remove('selected'));
    
    const selectedRow = customerTableBody.querySelector(`[data-customer-id="${customerIdStr}"]`);
    if (selectedRow) {
        selectedRow.classList.add('selected');
    }

    currentSelectedCustomer = customer;
    await loadCustomerClusters(customer);
    selectedEquipmentIdsForCluster = [];
    equipmentClusterCollapseState = {};
    
    // Render med placeholder-adresser først
    currentCustomerEquipment = [];
    renderCustomerDetails(customer);
    renderEquipmentLoading();
    renderServiceHistory(customer);
    
    // NYTT: Hent adresser i bakgrunnen hvis de ikke allerede er hentet
    if (!customer.physicalAddress || !customer.postalAddress) {
        console.log(`📍 Henter adresser for ${customer.name}...`);
        try {
            const response = await fetch(`/api/admin/customers/${customerId}/addresses`, {
                credentials: 'include'
            });
            
            if (response.ok) {
                const addresses = await response.json();
                
                // Oppdater customer-objektet
                customer.physicalAddress = addresses.physicalAddress;
                customer.postalAddress = addresses.postalAddress;
                
                // Re-render kun kundedetaljer (ikke anlegg — de lastes separat)
                renderCustomerDetails(customer);
                console.log('✅ Adresser hentet og oppdatert');
            } else {
                console.error('Feil ved henting av adresser:', response.status);
            }
        } catch (error) {
            console.error('Feil ved henting av adresser:', error);
        }
    }

    // Hent kontaktperson fra /contact endpoint (Tripletex har ikke pålitelig
    // primærkontakt på Customer — vi henter alltid fra /contact API)
    if (!customer._contactFetched) {
        console.log(`👤 Henter kontaktperson for ${customer.name}...`);
        try {
            const contactResponse = await fetch(`/api/admin/customers/${customerId}/contact`, {
                credentials: 'include'
            });

            if (contactResponse.ok) {
                const contactData = await contactResponse.json();
                customer._contactFetched = true;
                if (contactData.contact) {
                    customer.contact = contactData.contact;
                }
                if (contactData.email && !customer.email) {
                    customer.email = contactData.email;
                }
                renderCustomerDetails(customer);
                console.log('✅ Kontaktperson hentet:', customer.contact || '(ingen funnet)');
            }
        } catch (error) {
            console.error('Feil ved henting av kontaktperson:', error);
        }
    }

    // Hent rapport-epost (servfixmail) i bakgrunnen
    if (!customer.reportEmail) {
        console.log(`📧 Henter rapport-epost for ${customer.name}...`);
        try {
            const reportResponse = await fetch(`/api/admin/customers/${customerId}/servfixmail`, {
                credentials: 'include'
            });
            
            if (reportResponse.ok) {
                const reportData = await reportResponse.json();
                
                // Oppdater customer-objektet
                customer.reportEmail = reportData.email || null;
                
                // Re-render kun kundedetaljer (ikke anlegg — de lastes separat)
                renderCustomerDetails(customer);
                console.log('✅ Rapport-epost hentet:', customer.reportEmail || 'Ikke funnet');
            } else {
                console.error('Feil ved henting av rapport-epost:', reportResponse.status);
            }
        } catch (error) {
            console.error('Feil ved henting av rapport-epost:', error);
        }
    }

    // Hent anlegg for kunden (bruk externalId for å matche equipment-tabellen)
    const equipmentCustomerId = customer.externalId || customerId;
    console.log(`🏢 Henter anlegg for ${customer.name} (equipmentId: ${equipmentCustomerId})...`);
    try {
        const equipmentResponse = await fetch(`/api/admin/equipment?customerId=${equipmentCustomerId}`, {
            credentials: 'include'
        });

        if (equipmentResponse.ok) {
            currentCustomerEquipment = await equipmentResponse.json();
            renderEquipmentList(currentCustomerEquipment);
            console.log(`✅ Hentet ${currentCustomerEquipment.length} anlegg`);
        } else {
            console.error('Feil ved henting av anlegg:', equipmentResponse.status);
            currentCustomerEquipment = [];
            renderEquipmentList([]);
        }
    } catch (error) {
        console.error('Feil ved henting av anlegg:', error);
        currentCustomerEquipment = [];
        renderEquipmentList([]);
    }

    // Hent kontaktpersoner
    loadAndRenderContacts(customerId);
};

    /**
     * Rendrer detaljert kundeinfo (uten servicehistorikk)
     */
    function renderCustomerDetails(customer) {
    console.log('📋 Rendrer kundedetaljer for:', customer.name);
    
    detailsContent.innerHTML = `
        <!-- MODERNE KUNDEKORT HEADER -->
        <div class="modern-customer-header">
            <div class="customer-title-section">
                <h2 class="modern-customer-name">${customer.name}</h2>
                ${customer.customerNumber ? 
                    `<span class="modern-customer-number">Nr. ${customer.customerNumber}</span>` : 
                    ''
                }
            </div>
        </div>

        <!-- HOVEDINNHOLD I TO KOLONNER -->
        <div class="modern-customer-content">
            <!-- VENSTRE KOLONNE -->
            <div class="customer-left-section">
                <div class="modern-info-group">
                    <div class="modern-info-label">Organisasjonsnummer</div>
                    <div class="modern-info-value ${customer.organizationNumber ? '' : 'empty'}">
                        ${customer.organizationNumber || 'Ikke angitt'}
                    </div>
                </div>
                
                <div class="modern-info-group">
                    <div class="modern-info-label">Kundeansvarlig</div>
                    <div class="modern-info-value">${customer.customerAccountManager || 'Ikke tildelt'}</div>
                </div>
                
                <div class="modern-info-group">
                    <div class="modern-info-label">Kontaktperson</div>
                    <div class="modern-info-value">${customer.contact || 'Ikke angitt'}</div>
                </div>
            </div>

            <!-- HØYRE KOLONNE -->
            <div class="customer-right-section">
                <div class="modern-info-group">
                    <div class="modern-info-label">E-post</div>
                    <div class="modern-info-value ${customer.email ? 'highlight' : 'empty'}">
                        ${customer.email || 'Mangler e-post'}
                    </div>
                </div>

                <div class="modern-info-group">
                    <div class="modern-info-label">Rapport epost</div>
                    <div class="modern-info-value ${customer.reportEmail ? 'highlight' : 'empty'}">
                        ${customer.reportEmail || 'Ikke registrert'}
                    </div>
                </div>
                
                <div class="modern-info-group">
                    <div class="modern-info-label">Telefon</div>
                    <div class="modern-info-value">${customer.phone || 'Ikke angitt'}</div>
                </div>
                
                <div class="modern-info-group">
                    <div class="modern-info-label">Mobil</div>
                    <div class="modern-info-value">${customer.mobile || 'Ikke angitt'}</div>
                </div>
            </div>
        </div>

        <!-- ADRESSE-SEKSJON -->
        <div class="modern-address-section">
            <h3 class="modern-section-title">📍 Adresser</h3>
            <div class="modern-address-grid">
                <div class="modern-address-card">
                    <div class="address-card-title">Postadresse</div>
                    <div class="address-card-content">
                        ${customer.postalAddress || 'Ikke registrert'}
                    </div>
                </div>
                <div class="modern-address-card">
                    <div class="address-card-title">Forretningsadresse</div>
                    <div class="address-card-content">
                        ${customer.physicalAddress || 'Ikke registrert'}
                    </div>
                </div>
            </div>
        </div>

        <!-- KONTAKTPERSONER -->
        <div id="contacts-section"></div>

        <!-- ANLEGG-SEKSJON (fylles av renderEquipmentList) -->
        <div id="equipment-list-section"></div>
    `;

    detailsPlaceholder.style.display = 'none';
    detailsContent.style.display = 'block';

    console.log('✅ Moderne kundedetaljer rendret');
}

    /**
     * Viser laste-indikator for anlegg
     */
    function renderEquipmentLoading() {
        const container = document.getElementById('equipment-list-section');
        if (!container) return;

        container.innerHTML = `
            <div class="modern-equipment-section">
                <h3 class="modern-section-title">Anlegg</h3>
                <div class="equipment-empty-state" style="font-style: normal;">
                    Laster anlegg...
                </div>
            </div>
        `;
    }

    /**
     * Rendrer anleggsliste under kundedetaljer
     */
    function renderEquipmentList(equipment) {
        const container = document.getElementById('equipment-list-section');
        if (!container) return;

        if (!equipment || equipment.length === 0) {
            container.innerHTML = `
                <div class="modern-equipment-section">
                    <h3 class="modern-section-title">Anlegg</h3>
                    <div class="equipment-empty-state">
                        Ingen anlegg registrert for denne kunden
                    </div>
                </div>
            `;
            return;
        }

        const buildEquipmentCardMarkup = (eq) => `
            <div class="equipment-list-card" onclick="openEquipmentEditModal('${eq.id}')" title="Klikk for å redigere">
                <label class="equipment-select-checkbox" onclick="event.stopPropagation()">
                    <input type="checkbox" data-equipment-id="${eq.id}" ${selectedEquipmentIdsForCluster.includes(eq.id) ? 'checked' : ''}>
                </label>
                <div class="equipment-card-name">${eq.name || 'Uten navn'}</div>
                <div class="equipment-card-detail-inline">
                    <span class="equipment-card-detail-chip"><strong>Type:</strong> ${eq.type || '-'}</span>
                    <span class="equipment-card-detail-chip"><strong>Nr:</strong> ${eq.systemNumber || '-'}</span>
                    <span class="equipment-card-detail-chip equipment-card-detail-chip-wide"><strong>Plass:</strong> ${eq.systemPlacement || '-'}</span>
                    <span class="equipment-card-detail-chip equipment-card-detail-chip-wide"><strong>Betjener:</strong> ${eq.betjener || '-'}</span>
                </div>
            </div>
        `;

        const hasClusters = currentCustomerClusters.length > 0 || equipment.some(eq => eq.clusterId);

        let contentMarkup = '';

        if (!hasClusters) {
            contentMarkup = `
                <div class="equipment-card-grid">
                    ${equipment.map(buildEquipmentCardMarkup).join('')}
                </div>
            `;
        } else {
            const groups = new Map();
            const ungroupedKey = '__ungrouped__';

            currentCustomerClusters.forEach(cluster => {
                const key = String(cluster.id);
                groups.set(key, {
                    key,
                    title: cluster.name,
                    items: []
                });

                if (typeof equipmentClusterCollapseState[key] === 'undefined') {
                    equipmentClusterCollapseState[key] = true;
                }
            });

            equipment.forEach(eq => {
                const key = eq.clusterId ? String(eq.clusterId) : ungroupedKey;
                if (!groups.has(key)) {
                    groups.set(key, {
                        key,
                        title: eq.clusterName || 'Øvrige',
                        items: []
                    });

                    if (typeof equipmentClusterCollapseState[key] === 'undefined') {
                        equipmentClusterCollapseState[key] = true;
                    }
                }
                groups.get(key).items.push(eq);
            });

            if (!groups.has(ungroupedKey)) {
                groups.set(ungroupedKey, {
                    key: ungroupedKey,
                    title: 'Øvrige',
                    items: []
                });
                if (typeof equipmentClusterCollapseState[ungroupedKey] === 'undefined') {
                    equipmentClusterCollapseState[ungroupedKey] = true;
                }
            }

            contentMarkup = Array.from(groups.values()).map(group => {
                const groupKey = group.key;
                const isCollapsed = equipmentClusterCollapseState[groupKey] !== false;
                const isEmpty = group.items.length === 0;
                const canDelete = groupKey !== '__ungrouped__' && isEmpty;

                return `
                    <div class="equipment-cluster-block ${isCollapsed ? 'collapsed' : ''}">
                        <div class="equipment-cluster-block-header-wrap">
                            <button type="button" class="equipment-cluster-block-header equipment-cluster-toggle" onclick="toggleEquipmentClusterSection('${groupKey}')">
                                <div>
                                    <div class="equipment-cluster-block-title">${group.title}</div>
                                    <div class="equipment-cluster-block-meta">${group.items.length} anlegg</div>
                                </div>
                                <span class="equipment-cluster-chevron">${isCollapsed ? '▸' : '▾'}</span>
                            </button>
                            ${canDelete ? `<button type="button" class="equipment-cluster-delete-btn" onclick="event.stopPropagation(); deleteEmptyClusterFromCustomerPage('${groupKey}', '${(group.title || '').replace(/'/g, "\\'")}')">Slett</button>` : ''}
                        </div>
                        <div class="equipment-cluster-block-body ${isCollapsed ? 'hidden' : ''}">
                            ${isEmpty ? `<div class="equipment-empty-state">Ingen anlegg i dette clusteret</div>` : `
                                <div class="equipment-card-grid">
                                    ${group.items.map(buildEquipmentCardMarkup).join('')}
                                </div>
                            `}
                        </div>
                    </div>
                `;
            }).join('');
        }

        container.innerHTML = `
            <div class="modern-equipment-section">
                <div class="modern-section-header">
                    <h3 class="modern-section-title">Anlegg (${equipment.length})</h3>
                    <div class="equipment-cluster-toolbar">
                        <button type="button" class="btn btn-primary equipment-inline-cluster-btn" onclick="openNewEquipmentModal()">+ Nytt anlegg</button>
                        <button type="button" class="btn btn-secondary equipment-inline-cluster-btn" onclick="createClusterFromCustomerPage()">+ Nytt cluster</button>
                        <button type="button" class="btn btn-secondary equipment-inline-cluster-btn" onclick="assignSelectedEquipmentToClusterFromCustomerPage()">Flytt valgte til cluster</button>
                    </div>
                </div>
                <div class="equipment-selection-toolbar">
                    <button type="button" class="btn equipment-selection-btn" onclick="selectAllEquipmentForCluster()">+ Marker alle</button>
                    <button type="button" class="btn equipment-selection-btn secondary" onclick="clearEquipmentSelectionForCluster()">- Fjern markering alle</button>
                </div>
                ${contentMarkup}
            </div>
        `;

        container.querySelectorAll('.equipment-select-checkbox input').forEach(checkbox => {
            checkbox.addEventListener('change', (event) => {
                const equipmentId = parseInt(event.target.dataset.equipmentId, 10);
                if (event.target.checked) {
                    if (!selectedEquipmentIdsForCluster.includes(equipmentId)) {
                        selectedEquipmentIdsForCluster.push(equipmentId);
                    }
                } else {
                    selectedEquipmentIdsForCluster = selectedEquipmentIdsForCluster.filter(id => id !== equipmentId);
                }
            });
        });
    }

    async function loadCustomerClusters(customer) {
        const customerId = customer.id;
        try {
            const response = await fetch(`/api/admin/clusters?customerId=${customerId}`, {
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error('Kunne ikke hente cluster');
            }

            currentCustomerClusters = await response.json();
        } catch (error) {
            console.error('Feil ved henting av cluster:', error);
            currentCustomerClusters = [];
        }
    }

    function populateClusterSelect(selectedClusterId = null) {
        const select = document.getElementById('edit-cluster-id');
        if (!select) return;

        select.innerHTML = `
            <option value="">Ingen cluster</option>
            ${currentCustomerClusters.map(cluster => `<option value="${cluster.id}">${cluster.name}</option>`).join('')}
        `;

        select.value = selectedClusterId ? String(selectedClusterId) : '';
    }

    async function loadEquipmentTypeOptions() {
        if (equipmentTypeOptions.length > 0) {
            return equipmentTypeOptions;
        }

        const response = await fetch('/api/admin/checklist-templates', {
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error('Kunne ikke hente anleggstyper');
        }

        const data = await response.json();
        equipmentTypeOptions = Array.isArray(data.facilityTypes) ? data.facilityTypes : [];
        return equipmentTypeOptions;
    }

    function populateEquipmentTypeSelect(selectedType = '', readonly = false) {
        const select = document.getElementById('edit-systemtype');
        if (!select) return;

        const options = equipmentTypeOptions.length > 0
            ? equipmentTypeOptions.map(type => `<option value="${type.id}">${type.name}</option>`).join('')
            : (selectedType ? `<option value="${selectedType}">${selectedType}</option>` : '<option value="">Velg type</option>');

        select.innerHTML = options;
        select.value = selectedType || select.value || '';
        select.disabled = readonly;
        select.style.backgroundColor = readonly ? '#f0f0f0' : '';
        select.style.cursor = readonly ? 'not-allowed' : '';
        select.title = readonly ? 'Systemtype kan ikke endres her' : '';
    }

    function setCustomerEquipmentActionLoading(isLoading, buttonLabel = '') {
        const buttons = document.querySelectorAll('.equipment-inline-cluster-btn, .equipment-selection-btn');
        buttons.forEach(button => {
            if (isLoading) {
                if (!button.dataset.originalText) {
                    button.dataset.originalText = button.textContent;
                }
                button.disabled = true;
                if (buttonLabel && button.classList.contains('equipment-inline-cluster-btn')) {
                    button.textContent = buttonLabel;
                }
            } else {
                button.disabled = false;
                if (button.dataset.originalText) {
                    button.textContent = button.dataset.originalText;
                }
            }
        });

        const section = document.getElementById('equipment-list-section');
        if (section) {
            section.style.opacity = isLoading ? '0.7' : '1';
            section.style.pointerEvents = isLoading ? 'none' : 'auto';
        }
    }

    function openClusterActionModal(mode) {
        currentClusterActionMode = mode;

        const title = document.getElementById('cluster-action-title');
        const description = document.getElementById('cluster-action-description');
        const selectGroup = document.getElementById('cluster-action-select-group');
        const select = document.getElementById('cluster-action-select');
        const nameInput = document.getElementById('cluster-action-name');
        const saveBtn = document.getElementById('cluster-action-save-btn');

        if (!title || !description || !selectGroup || !select || !nameInput || !saveBtn) return;

        title.textContent = mode === 'create' ? 'Opprett nytt cluster' : 'Flytt valgte anlegg til cluster';
        description.textContent = mode === 'create'
            ? 'Opprett et nytt tomt cluster for kunden. Ingen anlegg flyttes automatisk.'
            : `Flytt ${selectedEquipmentIdsForCluster.length} valgte anlegg til et eksisterende eller nytt cluster.`;

        selectGroup.style.display = mode === 'assign' ? 'block' : 'none';
        select.innerHTML = `
            <option value="">Velg cluster...</option>
            ${currentCustomerClusters.map(cluster => `<option value="${cluster.id}">${cluster.name}</option>`).join('')}
            ${mode === 'assign' ? '<option value="__new__">Opprett nytt cluster...</option>' : ''}
        `;
        nameInput.value = '';
        nameInput.style.display = mode === 'create' ? 'block' : 'none';
        saveBtn.textContent = mode === 'create' ? 'Opprett cluster' : 'Lagre';
        saveBtn.disabled = false;

        if (mode === 'assign') {
            select.onchange = () => {
                nameInput.style.display = select.value === '__new__' ? 'block' : 'none';
                if (select.value !== '__new__') {
                    nameInput.value = '';
                }
            };
        } else {
            select.onchange = null;
        }

        clusterActionModal?.classList.add('show');
        window.requestAnimationFrame(() => nameInput.focus());
    }

    window.closeClusterActionModal = function() {
        currentClusterActionMode = null;
        clusterActionModal?.classList.remove('show');
    };

    async function handleClusterActionSave() {
        if (!currentSelectedCustomer || !currentClusterActionMode) {
            return;
        }

        const select = document.getElementById('cluster-action-select');
        const nameInput = document.getElementById('cluster-action-name');
        const saveBtn = document.getElementById('cluster-action-save-btn');

        const clusterName = nameInput?.value?.trim();
        let clusterId = null;

        try {
            setCustomerEquipmentActionLoading(true, currentClusterActionMode === 'create' ? 'Oppretter...' : 'Flytter...');
            if (saveBtn) saveBtn.disabled = true;

            if (currentClusterActionMode === 'create') {
                if (!clusterName) {
                    throw new Error('Skriv inn clusternavn');
                }

                const response = await fetch('/api/admin/clusters', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        customerId: currentSelectedCustomer.id,
                        name: clusterName
                    })
                });

                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error || 'Kunne ikke opprette cluster');
                }

                await loadCustomerClusters(currentSelectedCustomer);
                if (currentCustomerEquipment.length > 0) {
                    renderEquipmentList(currentCustomerEquipment);
                }
                closeClusterActionModal();
                return;
            }

            if (!selectedEquipmentIdsForCluster.length) {
                throw new Error('Marker minst ett anlegg først');
            }

            const selectedClusterId = select?.value;
            if (selectedClusterId && selectedClusterId !== '__new__') {
                clusterId = selectedClusterId;
            } else {
                if (!clusterName) {
                    throw new Error('Velg cluster eller skriv nytt clusternavn');
                }

                const createResponse = await fetch('/api/admin/clusters', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        customerId: currentSelectedCustomer.id,
                        name: clusterName
                    })
                });

                const createData = await createResponse.json();
                if (!createResponse.ok) {
                    throw new Error(createData.error || 'Kunne ikke opprette cluster');
                }

                clusterId = createData.id;
            }

            const assignResponse = await fetch('/api/admin/equipment/assign-cluster', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    equipmentIds: selectedEquipmentIdsForCluster,
                    clusterId
                })
            });

            const assignData = await assignResponse.json();
            if (!assignResponse.ok) {
                throw new Error(assignData.error || 'Kunne ikke flytte anlegg til cluster');
            }

            selectedEquipmentIdsForCluster = [];
            await loadCustomerClusters(currentSelectedCustomer);

            const eqResponse = await fetch(`/api/admin/equipment?customerId=${currentSelectedCustomer.externalId || currentSelectedCustomer.id}`, {
                credentials: 'include'
            });

            if (eqResponse.ok) {
                currentCustomerEquipment = await eqResponse.json();
                renderEquipmentList(currentCustomerEquipment);
            }

            closeClusterActionModal();
        } catch (error) {
            console.error('Cluster action error:', error);
            alert(error.message || 'Kunne ikke lagre cluster-endring');
            if (saveBtn) saveBtn.disabled = false;
        } finally {
            setCustomerEquipmentActionLoading(false);
        }
    }

    function renderServiceHistory(customer) {
    console.log('📊 Rendrer servicehistorikk for:', customer.name);
    console.log('🔍 Customer object:', customer);
    console.log('🔍 Total orders i systemet:', customerHistory.length);
    
    // FORBEDRET MATCHING - prøv alle mulige ID-kombinasjoner
    const customerServiceHistory = customerHistory.filter(order => {
        const matches = [
            // Direkte ID matching (lokal DB ID)
            order.customerId === customer.id,
            order.customer_id === customer.id,
            String(order.customerId) === String(customer.id),
            String(order.customer_id) === String(customer.id),

            // Tripletex external ID matching (gamle ordrer)
            customer.externalId && order.customerId === customer.externalId,
            customer.externalId && order.customer_id === customer.externalId,
            customer.externalId && String(order.customerId) === String(customer.externalId),
            customer.externalId && String(order.customer_id) === String(customer.externalId),
            customer.externalId && Number(order.customerId) === Number(customer.externalId),
            customer.externalId && Number(order.customer_id) === Number(customer.externalId),

            // Customer number matching
            order.customerNumber === customer.customerNumber,
            String(order.customerNumber) === String(customer.customerNumber),

            // Name matching (backup)
            order.customerName === customer.name,
            order.customer_name === customer.name
        ];
        
        const matchFound = matches.some(match => match === true);
        
        if (matchFound) {
            console.log('✅ MATCH:', {
                orderId: order.id,
                orderCustomerId: order.customer_id || order.customerId,
                customerName: order.customer_name || order.customerName,
                selectedCustomerId: customer.id,
                selectedCustomerName: customer.name
            });
        }
        
        return matchFound;
    });

    console.log(`🎯 Funnet ${customerServiceHistory.length} ordre for ${customer.name}`);

    if (customerServiceHistory.length === 0) {
        serviceHistoryContent.innerHTML = `
            <div class="empty-history">
                <p>Ingen service funnet</p>
            </div>
        `;
        return;
    }

    // SORTER ORDRE ETTER DATO (nyeste først)
    const sortedHistory = customerServiceHistory.sort((a, b) => {
        const dateA = new Date(a.scheduled_date || a.scheduledDate || a.created_at || 0);
        const dateB = new Date(b.scheduled_date || b.scheduledDate || b.created_at || 0);
        return dateB - dateA; // Nyeste først
    });

    // NYTT FORMAT: Ordre-ID, dato, tekniker per linje
    const historyHTML = `
        <div class="service-history-list-modern">
            ${sortedHistory.map(order => {
                // Formater ordre-ID
                const orderNumber = order.orderNumber || `SO-${order.id.split('-')[1]}-${order.id.split('-')[2]?.slice(-6)}` || order.id;
                
                // Formater dato
                const orderDate = order.scheduled_date || order.scheduledDate || order.created_at;
                const formattedDate = orderDate ? formatDate(orderDate) : 'Ikke planlagt';
                
                // Finn tekniker - viser navn hvis tilgjengelig
                const technician = order.technician_name || order.technicianName || 'Ikke tildelt';
                
                return `
                    <div class="service-history-order" onclick="showOrderDetails('${order.id}')">
                        <div class="order-id">#${orderNumber}</div>
                        <div class="order-date">${formattedDate}</div>
                        <div class="order-technician">${technician}</div>
                    </div>
                `;
            }).join('')}
        </div>
    `;

    serviceHistoryContent.innerHTML = historyHTML;
    console.log('✅ Servicehistorikk rendret med', sortedHistory.length, 'ordre');
}

    /**
     * Viser detaljer for en serviceordre i modal
     */
    window.showOrderDetails = async function(orderId) {
    console.log('🔍 Viser detaljer for ordre:', orderId);
    
    const order = customerHistory.find(o => o.id === orderId);
    if (!order) {
        console.error('Ordre ikke funnet:', orderId);
        return;
    }

    console.log('📋 Ordre data:', order);

    // Formater ordre-nummer
    const orderNumber = order.orderNumber || `SO-${order.id.split('-')[1]}-${order.id.split('-')[2]?.slice(-6)}` || order.id;
    
    // Hent tekniker-informasjon
    let technicianInfo = 'Ikke tildelt';
    if (order.technician_name || order.technicianName) {
        technicianInfo = order.technician_name || order.technicianName;
    } else if (order.technician_id || order.technicianId) {
        technicianInfo = `Tekniker ID: ${order.technician_id || order.technicianId}`;
    }
    
    // Formater planlagt dato og tid
    let planlagtDateTime = 'Ikke planlagt';
    if (order.scheduled_date || order.scheduledDate) {
        const dateStr = order.scheduled_date || order.scheduledDate;
        const timeStr = order.scheduled_time || order.scheduledTime;
        
        try {
            const date = new Date(dateStr);
            planlagtDateTime = date.toLocaleDateString('no-NO', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            });
            
            if (timeStr) {
                planlagtDateTime += ` kl. ${timeStr}`;
            }
        } catch (e) {
            planlagtDateTime = dateStr;
        }
    }
    
    // Bestem service type / anleggstype
    let serviceType = 'Ikke spesifisert';
    if (order.service_type || order.serviceType) {
        serviceType = order.service_type || order.serviceType;
    }

    // === HENT ANLEGG FRA RAPPORT-API ===
    let equipmentList = [];
    let reportId = null;

    try {
        console.log('📡 Henter anlegg for ordre:', order.id);
        
        const reportResponse = await fetch(`/api/admin/reports?orderId=${order.id}`, {
            credentials: 'include'
        });
        
        if (reportResponse.ok) {
            const reportData = await reportResponse.json();
            console.log('📊 Rapport-data:', reportData);
            
            if (reportData.reports && reportData.reports.length > 0) {
                const orderReport = reportData.reports[0];
                
                // Hent rapport-ID for PDF
                if (orderReport.report_ids && orderReport.report_ids.length > 0) {
                    reportId = orderReport.report_ids[0];
                }
                
                // Parse anlegg robust:
                // 1) Foretrekk equipment_items (name/type-par fra backend)
                // 2) Fallback til legacy comma-separerte felter
                if (Array.isArray(orderReport.equipment_items) && orderReport.equipment_items.length > 0) {
                    equipmentList = orderReport.equipment_items
                        .filter(item => item && (item.name || item.type))
                        .map(item => ({
                            name: (item.name || '').toString().trim() || 'Ukjent anlegg',
                            type: (item.type || '').toString().trim() || 'Ikke spesifisert'
                        }));
                    console.log('🏢 Anlegg funnet (equipment_items):', equipmentList.length);
                } else if (orderReport.equipment_names) {
                    const names = orderReport.equipment_names.split(', ');
                    const types = (orderReport.equipment_types || '').split(', ');

                    equipmentList = names.map((name, index) => ({
                        name: name.trim(),
                        type: types[index] ? types[index].trim() : 'Ikke spesifisert'
                    }));
                    console.log('🏢 Anlegg funnet (legacy):', equipmentList.length);
                }
            }
        }
    } catch (error) {
        console.error('❌ Feil ved henting av anlegg:', error);
    }
    
    const modalBody = document.getElementById('order-modal-body');
    modalBody.innerHTML = `
    <div class="simple-order-modal">
        <!-- Header med kundenavn og dato -->
        <div style="margin-bottom: 4px;">
            <div style="font-size: 16px; font-weight: 600; color: #1e293b;">
                Service — ${currentSelectedCustomer ? currentSelectedCustomer.name : (order.customer_name || order.customerName || '')}
            </div>
            <div style="font-size: 13px; color: #64748b; margin-top: 2px;">${planlagtDateTime}</div>
        </div>
        <div class="modal-simple-header">
            <div class="order-number-black">#${orderNumber}</div>
            <div class="status-badge-blue">${getStatusText(order.status || 'scheduled')}</div>
        </div>

        <!-- Info-liste -->
        <div class="modal-info-rows">
            <div class="info-row">
                <span class="label">🔧 Servicetype</span>
                <span class="value">${serviceType}</span>
            </div>
            <div class="info-row">
                <span class="label">📅 Planlagt</span>
                <span class="value">${planlagtDateTime}</span>
            </div>
            <div class="info-row">
                <span class="label">👨‍🔧 Tekniker</span>
                <span class="value">${technicianInfo}</span>
            </div>
        </div>

        <!-- Anlegg som tabell med kolonner -->
        ${equipmentList && equipmentList.length > 0 ? `
        <div class="equipment-section">
            <div class="equipment-header">🏢 Anlegg</div>
            <table class="equipment-table">
                <thead>
                    <tr>
                        <th>Systemnavn</th>
                        <th>Systemtype</th>
                    </tr>
                </thead>
                <tbody>
                    ${equipmentList.map(eq => `
                        <tr>
                            <td>${eq.name}</td>
                            <td>${eq.type}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        ` : ''}
    </div>
`;

    // Oppdater "Vis PDF" knapp
    const viewPdfBtn = document.getElementById('view-pdf-btn');
    if (viewPdfBtn && reportId) {
        viewPdfBtn.onclick = function() {
            window.open(`/api/admin/reports/${reportId}/pdf`, '_blank');
        };
    } else if (viewPdfBtn) {
        viewPdfBtn.disabled = true;
        viewPdfBtn.textContent = '📄 PDF ikke tilgjengelig';
    }

    orderModal.classList.add('show');
};

    /**
     * Lukker ordre-modal
     */
    window.closeOrderModal = function() {
        orderModal.classList.remove('show');
    };

    /**
     * Åpner redigering av anlegg
     */
    window.openEquipmentEditModal = async function(equipmentId) {
        const eq = currentCustomerEquipment.find(e => String(e.id) === String(equipmentId));
        if (!eq) {
            console.error('Anlegg ikke funnet:', equipmentId);
            return;
        }

        if (currentSelectedCustomer) {
            await loadCustomerClusters(currentSelectedCustomer);
        }
        await loadEquipmentTypeOptions();

        document.getElementById('edit-equipment-mode').value = 'edit';
        document.getElementById('edit-equipment-id').value = eq.id;
        document.getElementById('edit-systemnavn').value = eq.name || '';
        populateEquipmentTypeSelect(eq.type || '', true);
        document.getElementById('edit-systemnummer').value = eq.systemNumber || '';
        document.getElementById('edit-plassering').value = eq.systemPlacement || '';
        document.getElementById('edit-betjener').value = eq.betjener || '';
        document.getElementById('edit-location').value = eq.location || '';
        document.getElementById('edit-notater').value = eq.internalNotes || '';
        populateClusterSelect(eq.clusterId || null);

        // Filter-felt
        const hasFilters = !!eq.hasFilters;
        document.getElementById('edit-has-filters').checked = hasFilters;
        document.getElementById('edit-filter-supply').checked = !!eq.filterSupply;
        document.getElementById('edit-filter-exhaust').checked = !!eq.filterExhaust;
        document.getElementById('edit-filter-drive-supply').checked = !!eq.filterDriveSupply;
        document.getElementById('edit-filter-drive-exhaust').checked = !!eq.filterDriveExhaust;
        document.getElementById('edit-filter-types').style.display = hasFilters ? 'flex' : 'none';
        document.getElementById('edit-filter-supply-text').value = eq.filterSupplyText || '';
        document.getElementById('edit-filter-exhaust-text').value = eq.filterExhaustText || '';
        document.getElementById('edit-filter-drive-supply-text').value = eq.filterDriveSupplyText || '';
        document.getElementById('edit-filter-drive-exhaust-text').value = eq.filterDriveExhaustText || '';
        document.getElementById('edit-filter-supply-text').style.display = (hasFilters && !!eq.filterSupply) ? 'block' : 'none';
        document.getElementById('edit-filter-exhaust-text').style.display = (hasFilters && !!eq.filterExhaust) ? 'block' : 'none';
        document.getElementById('edit-filter-drive-supply-text').style.display = (hasFilters && !!eq.filterDriveSupply) ? 'block' : 'none';
        document.getElementById('edit-filter-drive-exhaust-text').style.display = (hasFilters && !!eq.filterDriveExhaust) ? 'block' : 'none';

        // Dynamisk tittel: Rediger Anlegg — Kundenavn — Anleggsnavn
        const customerName = currentSelectedCustomer ? currentSelectedCustomer.name : '';
        const equipmentName = eq.name || 'Uten navn';
        document.getElementById('equipment-edit-title').textContent =
            `Rediger Anlegg — ${customerName} — ${equipmentName}`;
        document.getElementById('equipment-save-btn').textContent = 'Lagre';

        equipmentEditModal.classList.add('show');
    };

    window.openNewEquipmentModal = async function() {
        if (!currentSelectedCustomer) {
            alert('Velg en kunde først');
            return;
        }

        await loadCustomerClusters(currentSelectedCustomer);
        await loadEquipmentTypeOptions();

        document.getElementById('edit-equipment-mode').value = 'create';
        document.getElementById('edit-equipment-id').value = '';
        document.getElementById('edit-systemnavn').value = '';
        populateEquipmentTypeSelect('', false);
        document.getElementById('edit-systemnummer').value = '';
        document.getElementById('edit-plassering').value = '';
        document.getElementById('edit-betjener').value = '';
        document.getElementById('edit-location').value = '';
        document.getElementById('edit-notater').value = '';
        populateClusterSelect(null);

        // Filter-felt — nullstill
        document.getElementById('edit-has-filters').checked = false;
        document.getElementById('edit-filter-supply').checked = false;
        document.getElementById('edit-filter-exhaust').checked = false;
        document.getElementById('edit-filter-drive-supply').checked = false;
        document.getElementById('edit-filter-drive-exhaust').checked = false;
        document.getElementById('edit-filter-types').style.display = 'none';
        document.getElementById('edit-filter-supply-text').value = '';
        document.getElementById('edit-filter-exhaust-text').value = '';
        document.getElementById('edit-filter-drive-supply-text').value = '';
        document.getElementById('edit-filter-drive-exhaust-text').value = '';
        document.getElementById('edit-filter-supply-text').style.display = 'none';
        document.getElementById('edit-filter-exhaust-text').style.display = 'none';
        document.getElementById('edit-filter-drive-supply-text').style.display = 'none';
        document.getElementById('edit-filter-drive-exhaust-text').style.display = 'none';

        document.getElementById('equipment-edit-title').textContent =
            `Nytt Anlegg — ${currentSelectedCustomer.name}`;
        document.getElementById('equipment-save-btn').textContent = 'Opprett anlegg';

        equipmentEditModal.classList.add('show');
    };

    /**
     * Lukker redigeringsmodal
     */
    window.closeEquipmentEditModal = function() {
        equipmentEditModal.classList.remove('show');
    };

    window.createClusterFromCustomerPage = async function() {
        if (!currentSelectedCustomer) {
            alert('Velg en kunde først');
            return;
        }
        openClusterActionModal('create');
    };

    window.selectAllEquipmentForCluster = function() {
        selectedEquipmentIdsForCluster = currentCustomerEquipment.map(eq => eq.id);
        renderEquipmentList(currentCustomerEquipment);
    };

    window.toggleEquipmentClusterSection = function(groupKey) {
        equipmentClusterCollapseState[groupKey] = !equipmentClusterCollapseState[groupKey];
        renderEquipmentList(currentCustomerEquipment);
    };

    window.clearEquipmentSelectionForCluster = function() {
        selectedEquipmentIdsForCluster = [];
        renderEquipmentList(currentCustomerEquipment);
    };

    window.assignSelectedEquipmentToClusterFromCustomerPage = async function() {
        if (!currentSelectedCustomer) {
            alert('Velg en kunde først');
            return;
        }

        if (!selectedEquipmentIdsForCluster.length) {
            alert('Marker minst ett anlegg først');
            return;
        }
        openClusterActionModal('assign');
    };

    window.deleteEmptyClusterFromCustomerPage = async function(clusterId, clusterName) {
        if (!currentSelectedCustomer) {
            alert('Velg en kunde først');
            return;
        }

        const confirmed = window.confirm(`Er du sikker på at du vil slette clusteret "${clusterName}"?`);
        if (!confirmed) {
            return;
        }

        try {
            setCustomerEquipmentActionLoading(true, 'Sletter...');
            const response = await fetch(`/api/admin/clusters/${clusterId}`, {
                method: 'DELETE',
                credentials: 'include'
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || 'Kunne ikke slette cluster');
            }

            delete equipmentClusterCollapseState[String(clusterId)];
            await loadCustomerClusters(currentSelectedCustomer);
            renderEquipmentList(currentCustomerEquipment);
        } catch (error) {
            console.error('Feil ved sletting av cluster:', error);
            alert(error.message || 'Kunne ikke slette cluster');
        } finally {
            setCustomerEquipmentActionLoading(false);
        }
    };

    /**
     * Viser bekreftelsesdialog før lagring
     */
    window.confirmSaveEquipment = function() {
        const mode = document.getElementById('edit-equipment-mode').value;
        if (mode === 'create') {
            executeSaveEquipment();
            return;
        }
        equipmentConfirmModal.classList.add('show');
    };

    /**
     * Avbryter lagring (lukker bekreftelsesdialog)
     */
    window.cancelSaveEquipment = function() {
        equipmentConfirmModal.classList.remove('show');
    };

    /**
     * Utfører lagring av anleggsendringer
     */
    window.executeSaveEquipment = async function() {
        const equipmentId = document.getElementById('edit-equipment-id').value;
        const mode = document.getElementById('edit-equipment-mode').value;

        const body = {
            systemnavn: document.getElementById('edit-systemnavn').value,
            systemtype: document.getElementById('edit-systemtype').value,
            systemnummer: document.getElementById('edit-systemnummer').value,
            plassering: document.getElementById('edit-plassering').value,
            betjener: document.getElementById('edit-betjener').value,
            location: document.getElementById('edit-location').value,
            notater: document.getElementById('edit-notater').value,
            clusterId: document.getElementById('edit-cluster-id').value || null,
            hasFilters: document.getElementById('edit-has-filters').checked,
            filterSupply: document.getElementById('edit-filter-supply').checked,
            filterExhaust: document.getElementById('edit-filter-exhaust').checked,
            filterDriveSupply: document.getElementById('edit-filter-drive-supply').checked,
            filterDriveExhaust: document.getElementById('edit-filter-drive-exhaust').checked,
            filterSupplyText: document.getElementById('edit-filter-supply-text').value.trim() || null,
            filterExhaustText: document.getElementById('edit-filter-exhaust-text').value.trim() || null,
            filterDriveSupplyText: document.getElementById('edit-filter-drive-supply-text').value.trim() || null,
            filterDriveExhaustText: document.getElementById('edit-filter-drive-exhaust-text').value.trim() || null
        };

        try {
            const response = await fetch(mode === 'create' ? '/api/admin/equipment' : `/api/admin/equipment/${equipmentId}`, {
                method: mode === 'create' ? 'POST' : 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    ...body,
                    customerId: currentSelectedCustomer.externalId || currentSelectedCustomer.id
                })
            });

            if (response.ok) {
                console.log(mode === 'create' ? '✅ Anlegg opprettet' : '✅ Anlegg oppdatert');

                // Lukk begge modaler
                equipmentConfirmModal.classList.remove('show');
                equipmentEditModal.classList.remove('show');

                // Re-hent anleggsliste
                if (currentSelectedCustomer) {
                    await loadCustomerClusters(currentSelectedCustomer);
                    const eqResponse = await fetch(`/api/admin/equipment?customerId=${currentSelectedCustomer.externalId || currentSelectedCustomer.id}`, {
                        credentials: 'include'
                    });
                    if (eqResponse.ok) {
                        currentCustomerEquipment = await eqResponse.json();
                        renderEquipmentList(currentCustomerEquipment);
                    }
                }
            } else {
                const errorData = await response.json();
                alert('Feil ved lagring: ' + (errorData.error || 'Ukjent feil'));
            }
        } catch (error) {
            console.error('Feil ved lagring av anlegg:', error);
            alert('Nettverksfeil ved lagring av anlegg');
        }
    };

    /**
     * Formaterer dato for visning
     */
    function formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString('no-NO', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    }

    /**
     * Søkefunksjonalitet
     */
    searchInput.addEventListener('input', function(e) {
        const searchTerm = e.target.value.toLowerCase();
        
        if (!searchTerm) {
            renderCustomerList(allCustomers);
            return;
        }

        console.log('🔍 Søker etter:', searchTerm);
        const filteredCustomers = allCustomers.filter(customer => 
            customer.name.toLowerCase().includes(searchTerm) ||
            (customer.customerNumber && customer.customerNumber.toString().includes(searchTerm)) ||
            (customer.contact && customer.contact.toLowerCase().includes(searchTerm)) ||
            (customer.organizationNumber && customer.organizationNumber.includes(searchTerm))
        );
        
        console.log(`Fant ${filteredCustomers.length} kunder som matcher søket`);
        renderCustomerList(filteredCustomers);
        
        // Tøm servicehistorikk når søket endres
        if (filteredCustomers.length === 0 || !currentSelectedCustomer) {
            serviceHistoryContent.innerHTML = `
                <div class="empty-history">
                    <p>Velg en kunde for å se servicehistorikk</p>
                </div>
            `;
        }
    });

    /**
     * Konverterer status til norsk tekst
     */
    function getStatusText(status) {
        const statusMap = {
            'scheduled': 'Planlagt',
            'completed': 'Fullført', 
            'cancelled': 'Avbrutt',
            'in-progress': 'Pågår',
            'pending': 'Venter'
        };
        return statusMap[status] || status || 'Planlagt';
    }

    // ============================================================
    // KONTAKTPERSONER — CRUD
    // ============================================================

    const contactEditModal = document.getElementById('contact-edit-modal');
    let currentCustomerContacts = [];

    async function loadAndRenderContacts(customerId) {
        const container = document.getElementById('contacts-section');
        if (!container) return;

        container.innerHTML = `
            <div class="modern-equipment-section">
                <h3 class="modern-section-title">Kontaktpersoner</h3>
                <div class="equipment-empty-state" style="font-style: normal;">Laster kontakter...</div>
            </div>`;

        try {
            const response = await fetch(`/api/admin/customers/${customerId}/contacts`, {
                credentials: 'include'
            });
            if (response.ok) {
                currentCustomerContacts = await response.json();
                renderContacts(customerId, currentCustomerContacts);
            } else {
                container.innerHTML = '';
            }
        } catch (error) {
            console.error('Feil ved henting av kontakter:', error);
            container.innerHTML = '';
        }
    }

    function renderContacts(customerId, contacts) {
        const container = document.getElementById('contacts-section');
        if (!container) return;

        container.innerHTML = `
            <div class="modern-equipment-section">
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
                    <h3 class="modern-section-title">Kontaktpersoner (${contacts.length})</h3>
                    <div style="display: flex; gap: 6px;">
                        <button type="button" class="btn btn-secondary" id="import-contacts-btn"
                                onclick="importContactsFromTripletex('${customerId}')"
                                style="font-size: 11px; padding: 4px 10px;">Importer fra Tripletex</button>
                        <button type="button" class="btn btn-primary" onclick="openNewContactModal('${customerId}')"
                                style="font-size: 11px; padding: 4px 10px;">+ Ny kontakt</button>
                    </div>
                </div>
                ${contacts.length === 0 ? `
                    <div class="equipment-empty-state">
                        Ingen kontaktpersoner registrert
                    </div>
                ` : `
                    <div class="equipment-card-grid">
                        ${contacts.map(c => `
                            <div class="equipment-list-card" onclick="openEditContactModal('${c.id}')" title="Klikk for å redigere"
                                 style="position: relative;">
                                <div class="equipment-card-name">${c.name || 'Uten navn'}</div>
                                <div class="equipment-card-details">
                                    <span class="equipment-card-type">${c.email || 'Ingen epost'}</span>
                                </div>
                                ${c.phone ? `<div class="equipment-card-placement">${c.phone}</div>` : ''}
                                ${c.role ? `<div class="equipment-card-placement" style="color: #6b7280;">${c.role}</div>` : ''}
                                ${c.is_report_recipient ? `
                                    <span style="position: absolute; top: 8px; right: 8px; background: #1d4ed8;
                                          color: #ffffff; padding: 3px 8px; border-radius: 10px;
                                          font-size: 11px; font-weight: 700; letter-spacing: 0.3px;
                                          box-shadow: 0 1px 3px rgba(29,78,216,0.4);">📧 Rapport</span>
                                ` : ''}
                            </div>
                        `).join('')}
                    </div>
                `}
            </div>
        `;
    }

    window.openNewContactModal = function(customerId) {
        document.getElementById('contact-edit-id').value = '';
        document.getElementById('contact-edit-customer-id').value = customerId;
        document.getElementById('contact-edit-name').value = '';
        document.getElementById('contact-edit-email').value = '';
        document.getElementById('contact-edit-phone').value = '';
        document.getElementById('contact-edit-role').value = '';
        document.getElementById('contact-edit-report-recipient').checked = false;
        document.getElementById('contact-edit-title').textContent = 'Ny kontaktperson';
        document.getElementById('contact-delete-btn').style.display = 'none';
        contactEditModal.classList.add('show');
    };

    window.openEditContactModal = function(contactId) {
        const c = currentCustomerContacts.find(x => String(x.id) === String(contactId));
        if (!c) return;

        document.getElementById('contact-edit-id').value = c.id;
        document.getElementById('contact-edit-customer-id').value = c.customer_id;
        document.getElementById('contact-edit-name').value = c.name || '';
        document.getElementById('contact-edit-email').value = c.email || '';
        document.getElementById('contact-edit-phone').value = c.phone || '';
        document.getElementById('contact-edit-role').value = c.role || '';
        document.getElementById('contact-edit-report-recipient').checked = c.is_report_recipient || false;
        document.getElementById('contact-edit-title').textContent = 'Rediger kontaktperson';
        document.getElementById('contact-delete-btn').style.display = '';
        contactEditModal.classList.add('show');
    };

    window.closeContactModal = function() {
        contactEditModal.classList.remove('show');
    };

    window.saveContact = async function() {
        const contactId = document.getElementById('contact-edit-id').value;
        const customerId = document.getElementById('contact-edit-customer-id').value;
        const data = {
            name: document.getElementById('contact-edit-name').value.trim(),
            email: document.getElementById('contact-edit-email').value.trim(),
            phone: document.getElementById('contact-edit-phone').value.trim(),
            role: document.getElementById('contact-edit-role').value.trim(),
            is_report_recipient: document.getElementById('contact-edit-report-recipient').checked
        };

        if (!data.name && !data.email) {
            alert('Fyll inn minst navn eller e-post.');
            return;
        }

        try {
            let response;
            if (contactId) {
                // Oppdater
                response = await fetch(`/api/admin/customers/contacts/${contactId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify(data)
                });
            } else {
                // Opprett
                response = await fetch(`/api/admin/customers/${customerId}/contacts`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify(data)
                });
            }

            if (response.ok) {
                closeContactModal();
                loadAndRenderContacts(customerId);
                // Oppdater rapport-epost i kundekortet hvis relevant
                if (data.is_report_recipient && currentSelectedCustomer) {
                    currentSelectedCustomer.reportEmail = data.email;
                    renderCustomerDetails(currentSelectedCustomer);
                    renderEquipmentList(currentCustomerEquipment);
                }
            } else {
                const err = await response.json().catch(() => ({}));
                alert('Feil: ' + (err.error || 'Kunne ikke lagre kontakt'));
            }
        } catch (error) {
            console.error('Feil ved lagring av kontakt:', error);
            alert('Nettverksfeil ved lagring av kontakt');
        }
    };

    window.deleteContact = async function(contactId) {
        if (!confirm('Er du sikker på at du vil slette denne kontaktpersonen?')) return;

        const customerId = currentSelectedCustomer?.id;
        try {
            const response = await fetch(`/api/admin/customers/contacts/${contactId}`, {
                method: 'DELETE',
                credentials: 'include'
            });

            if (response.ok) {
                if (customerId) loadAndRenderContacts(customerId);
            } else {
                alert('Kunne ikke slette kontakt');
            }
        } catch (error) {
            console.error('Feil ved sletting av kontakt:', error);
        }
    };

    window.importContactsFromTripletex = async function(customerId) {
        const btn = document.getElementById('import-contacts-btn');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Importerer...';
        }

        try {
            const response = await fetch(`/api/admin/customers/${customerId}/contacts/import-from-tripletex`, {
                method: 'POST',
                credentials: 'include'
            });

            const data = await response.json();

            if (!response.ok) {
                alert('Feil: ' + (data.error || 'Kunne ikke importere kontakter'));
                return;
            }

            const msg = `Import fullført: ${data.imported} kontakter lagt til${data.skipped > 0 ? `, ${data.skipped} hoppet over` : ''}.${data.errors && data.errors.length > 0 ? '\n\nFeil:\n' + data.errors.join('\n') : ''}`;
            alert(msg);
            loadAndRenderContacts(customerId);
        } catch (error) {
            console.error('Feil ved import av kontakter:', error);
            alert('Nettverksfeil ved import av kontakter');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Importer fra Tripletex';
            }
        }
    };

    // ============================================================
    // IMPORT FRA TRIPLETEX — Preview + selektiv import
    // ============================================================

    const importPreviewModal = document.getElementById('import-preview-modal');
    let importPreviewData = null;

    window.openImportPreview = async function() {
        importPreviewModal.classList.add('show');
        const modalBody = document.getElementById('import-modal-body');
        const applyBtn = document.getElementById('import-apply-btn');
        applyBtn.style.display = 'none';

        modalBody.innerHTML = `
            <div style="text-align: center; padding: 60px 20px;">
                <div style="width: 40px; height: 40px; border: 3px solid var(--primary-color);
                     border-top: 3px solid transparent; border-radius: 50%;
                     animation: spin 1s linear infinite; margin: 0 auto 16px;"></div>
                <p style="font-size: 15px; color: #374151; font-weight: 500;">
                    Henter kunder fra Tripletex...
                </p>
                <p style="font-size: 13px; color: #64748b;">
                    Dette kan ta opptil 30 sekunder
                </p>
            </div>
        `;

        try {
            const response = await fetch('/api/admin/customers/import/preview', {
                method: 'POST',
                credentials: 'include'
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.details || errData.error || `HTTP ${response.status}`);
            }
            importPreviewData = await response.json();
            renderImportPreview(importPreviewData);
        } catch (error) {
            modalBody.innerHTML = `
                <div style="text-align: center; padding: 40px; color: #ef4444;">
                    <p><strong>Feil:</strong> ${error.message}</p>
                    <button class="btn btn-primary" onclick="openImportPreview()"
                            style="margin-top: 16px;">Pr\u00f8v igjen</button>
                </div>
            `;
        }
    };

    function renderImportPreview(data) {
        const modalBody = document.getElementById('import-modal-body');
        const applyBtn = document.getElementById('import-apply-btn');

        const hasChanges = data.new.length > 0 || data.updated.length > 0;
        applyBtn.style.display = hasChanges ? 'inline-block' : 'none';

        // Sammendragskort
        let html = `
            <div style="display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap;">
                <div style="flex: 1; min-width: 110px; padding: 14px; background: #dcfce7;
                     border-radius: 8px; text-align: center;">
                    <div style="font-size: 24px; font-weight: 700; color: #166534;">${data.new.length}</div>
                    <div style="font-size: 12px; color: #166534; font-weight: 500;">Nye</div>
                </div>
                <div style="flex: 1; min-width: 110px; padding: 14px; background: #fef3c7;
                     border-radius: 8px; text-align: center;">
                    <div style="font-size: 24px; font-weight: 700; color: #92400e;">${data.updated.length}</div>
                    <div style="font-size: 12px; color: #92400e; font-weight: 500;">Endret</div>
                </div>
                <div style="flex: 1; min-width: 110px; padding: 14px; background: #f3f4f6;
                     border-radius: 8px; text-align: center;">
                    <div style="font-size: 24px; font-weight: 700; color: #374151;">${data.unchanged}</div>
                    <div style="font-size: 12px; color: #6b7280; font-weight: 500;">Uendret</div>
                </div>
                <div style="flex: 1; min-width: 110px; padding: 14px; background: #eff6ff;
                     border-radius: 8px; text-align: center;">
                    <div style="font-size: 24px; font-weight: 700; color: #1d4ed8;">${data.total}</div>
                    <div style="font-size: 12px; color: #1d4ed8; font-weight: 500;">Totalt</div>
                </div>
            </div>
        `;

        // Nye kunder
        if (data.new.length > 0) {
            html += `
                <div style="margin-bottom: 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <h4 style="margin: 0; color: #166534;">Nye kunder (${data.new.length})</h4>
                        <label style="font-size: 12px; color: #6b7280; cursor: pointer;">
                            <input type="checkbox" id="select-all-new" checked
                                   onchange="toggleAllImport('new', this.checked)"> Velg alle
                        </label>
                    </div>
                    <div style="max-height: 220px; overflow-y: auto; border: 1px solid #e5e7eb; border-radius: 8px;">
                        ${data.new.map(c => `
                            <div style="display: flex; align-items: center; gap: 12px; padding: 10px 14px;
                                 border-bottom: 1px solid #f3f4f6;">
                                <input type="checkbox" class="import-cb import-cb-new"
                                       value="${c.tripletexId}" checked>
                                <div style="flex: 1; min-width: 0;">
                                    <div style="font-weight: 600; font-size: 13px; color: #1e293b;">
                                        ${c.name}
                                    </div>
                                    <div style="font-size: 11px; color: #6b7280; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                        Nr. ${c.customerNumber || '-'} | ${c.email || 'Ingen epost'} | ${c.phone || 'Ingen tlf'}
                                    </div>
                                </div>
                                <span style="background: #dcfce7; color: #166534; padding: 2px 8px;
                                      border-radius: 10px; font-size: 11px; font-weight: 600; white-space: nowrap;">NY</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        // Endrede kunder
        if (data.updated.length > 0) {
            html += `
                <div style="margin-bottom: 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <h4 style="margin: 0; color: #92400e;">Endrede kunder (${data.updated.length})</h4>
                        <label style="font-size: 12px; color: #6b7280; cursor: pointer;">
                            <input type="checkbox" id="select-all-updated" checked
                                   onchange="toggleAllImport('updated', this.checked)"> Velg alle
                        </label>
                    </div>
                    <div style="max-height: 350px; overflow-y: auto; border: 1px solid #e5e7eb; border-radius: 8px;">
                        ${data.updated.map(c => `
                            <div style="padding: 12px 14px; border-bottom: 1px solid #f3f4f6;">
                                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 6px;">
                                    <input type="checkbox" class="import-cb import-cb-updated"
                                           value="${c.tripletexId}" ${c.locallyModified ? '' : 'checked'}>
                                    <div style="flex: 1; min-width: 0;">
                                        <span style="font-weight: 600; font-size: 13px; color: #1e293b;">
                                            ${c.name}
                                        </span>
                                        <span style="font-size: 11px; color: #6b7280; margin-left: 8px;">
                                            Nr. ${c.customerNumber || '-'}
                                        </span>
                                    </div>
                                    ${c.locallyModified ? `
                                        <span style="background: #fee2e2; color: #dc2626; padding: 2px 8px;
                                              border-radius: 10px; font-size: 10px; font-weight: 600; white-space: nowrap;">
                                            LOKALT ENDRET
                                        </span>
                                    ` : ''}
                                    <span style="background: #fef3c7; color: #92400e; padding: 2px 8px;
                                          border-radius: 10px; font-size: 11px; font-weight: 600; white-space: nowrap;">ENDRET</span>
                                </div>
                                <div style="margin-left: 30px;">
                                    ${renderFieldChanges(c.changes)}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        // Ingen endringer
        if (!hasChanges) {
            html += `
                <div style="text-align: center; padding: 40px; color: #6b7280;">
                    <p style="font-size: 16px; font-weight: 500;">Ingen endringer funnet</p>
                    <p style="font-size: 13px;">Alle ${data.unchanged} kunder er allerede oppdatert.</p>
                </div>
            `;
        }

        // Feil
        if (data.errors && data.errors.length > 0) {
            html += `
                <div style="margin-top: 16px; padding: 12px; background: #fee2e2;
                     border-radius: 8px; font-size: 12px; color: #dc2626;">
                    <strong>Feil under sammenligning:</strong><br>
                    ${data.errors.join('<br>')}
                </div>
            `;
        }

        modalBody.innerHTML = html;
    }

    const fieldLabels = {
        name: 'Navn',
        organization_number: 'Org.nr',
        customer_number: 'Kundenr',
        phone: 'Telefon',
        email: 'E-post',
        invoice_email: 'Faktura e-post'
    };

    function renderFieldChanges(changes) {
        return Object.entries(changes).map(([field, val]) => `
            <div style="display: flex; gap: 8px; font-size: 12px; padding: 2px 0; align-items: center;">
                <span style="color: #6b7280; min-width: 100px; font-weight: 500;">
                    ${fieldLabels[field] || field}:
                </span>
                <span style="color: #dc2626; text-decoration: line-through;">
                    ${val.old || '(tom)'}
                </span>
                <span style="color: #6b7280;">\u2192</span>
                <span style="color: #166534; font-weight: 600;">
                    ${val.new || '(tom)'}
                </span>
            </div>
        `).join('');
    }

    window.toggleAllImport = function(type, checked) {
        document.querySelectorAll(`.import-cb-${type}`).forEach(cb => cb.checked = checked);
    };

    window.applySelectedImport = async function() {
        const newCbs = document.querySelectorAll('.import-cb-new:checked');
        const updatedCbs = document.querySelectorAll('.import-cb-updated:checked');

        const newCustomerIds = Array.from(newCbs).map(cb => cb.value);
        const updatedCustomerIds = Array.from(updatedCbs).map(cb => cb.value);

        if (newCustomerIds.length === 0 && updatedCustomerIds.length === 0) {
            alert('Ingen kunder valgt for import.');
            return;
        }

        const modalBody = document.getElementById('import-modal-body');
        const applyBtn = document.getElementById('import-apply-btn');
        applyBtn.disabled = true;
        applyBtn.textContent = 'Importerer...';

        modalBody.innerHTML = `
            <div style="text-align: center; padding: 60px 20px;">
                <div style="width: 40px; height: 40px; border: 3px solid var(--primary-color);
                     border-top: 3px solid transparent; border-radius: 50%;
                     animation: spin 1s linear infinite; margin: 0 auto 16px;"></div>
                <p style="font-size: 15px; color: #374151; font-weight: 500;">
                    Importerer ${newCustomerIds.length + updatedCustomerIds.length} kunder...
                </p>
                <p style="font-size: 13px; color: #64748b;">
                    Henter adresser og oppdaterer database
                </p>
            </div>
        `;

        try {
            const response = await fetch('/api/admin/customers/import/apply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ newCustomerIds, updatedCustomerIds })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.details || errData.error || `HTTP ${response.status}`);
            }
            const stats = await response.json();

            applyBtn.style.display = 'none';
            modalBody.innerHTML = `
                <div style="text-align: center; padding: 40px 20px;">
                    <div style="font-size: 48px; margin-bottom: 16px;">&#10003;</div>
                    <h3 style="color: #166534; margin-bottom: 16px;">Import fullf\u00f8rt</h3>
                    <div style="display: flex; gap: 16px; justify-content: center; flex-wrap: wrap;">
                        <div style="padding: 12px 20px; background: #dcfce7; border-radius: 8px;">
                            <strong>${stats.imported}</strong> nye
                        </div>
                        <div style="padding: 12px 20px; background: #fef3c7; border-radius: 8px;">
                            <strong>${stats.updated}</strong> oppdatert
                        </div>
                        <div style="padding: 12px 20px; background: #eff6ff; border-radius: 8px;">
                            <strong>${stats.contacts_created}</strong> kontakter
                        </div>
                    </div>
                    ${stats.errors && stats.errors.length > 0 ? `
                        <div style="margin-top: 16px; padding: 12px; background: #fee2e2;
                             border-radius: 8px; font-size: 12px; color: #dc2626; text-align: left;">
                            <strong>Feil:</strong><br>${stats.errors.join('<br>')}
                        </div>
                    ` : ''}
                </div>
            `;
        } catch (error) {
            modalBody.innerHTML = `
                <div style="text-align: center; padding: 40px; color: #ef4444;">
                    <p><strong>Feil ved import:</strong> ${error.message}</p>
                </div>
            `;
            applyBtn.disabled = false;
            applyBtn.textContent = 'Importer valgte';
        }
    };

    window.closeImportModal = function() {
        importPreviewModal.classList.remove('show');
        importPreviewData = null;
    };

    // ============================================================
    // MODAL EVENT HANDLERS
    // ============================================================

    /**
     * Lukker modal n\u00e5r man klikker utenfor
     */
    orderModal.addEventListener('click', function(e) {
        if (e.target === orderModal) {
            closeOrderModal();
        }
    });

    // Ikke lukk anleggsmodal ved klikk utenfor.
    // Den inneholder mange felt og cluster-valg, og utilsiktet lukking er dyrt for brukeren.

    // Toggle filter-type-checkboxer ved "Har filtre"-endring
    const hasFiltersCheckbox = document.getElementById('edit-has-filters');
    if (hasFiltersCheckbox) {
        hasFiltersCheckbox.addEventListener('change', function() {
            document.getElementById('edit-filter-types').style.display = this.checked ? 'flex' : 'none';
            if (!this.checked) {
                ['edit-filter-supply', 'edit-filter-exhaust', 'edit-filter-drive-supply', 'edit-filter-drive-exhaust']
                    .forEach(id => { document.getElementById(id).checked = false; });
                ['edit-filter-supply-text', 'edit-filter-exhaust-text', 'edit-filter-drive-supply-text', 'edit-filter-drive-exhaust-text']
                    .forEach(id => { document.getElementById(id).style.display = 'none'; });
            }
        });
    }

    // Toggle tekst-input ved endring av filter-sub-checkboxer
    [
        ['edit-filter-supply', 'edit-filter-supply-text'],
        ['edit-filter-exhaust', 'edit-filter-exhaust-text'],
        ['edit-filter-drive-supply', 'edit-filter-drive-supply-text'],
        ['edit-filter-drive-exhaust', 'edit-filter-drive-exhaust-text']
    ].forEach(([checkboxId, textId]) => {
        const cb = document.getElementById(checkboxId);
        if (cb) {
            cb.addEventListener('change', function() {
                document.getElementById(textId).style.display = this.checked ? 'block' : 'none';
            });
        }
    });

    if (equipmentConfirmModal) {
        equipmentConfirmModal.addEventListener('click', function(e) {
            if (e.target === equipmentConfirmModal) {
                cancelSaveEquipment();
            }
        });
    }

    if (clusterActionModal) {
        clusterActionModal.addEventListener('click', function(e) {
            if (e.target === clusterActionModal) {
                closeClusterActionModal();
            }
        });
    }

    if (importPreviewModal) {
        importPreviewModal.addEventListener('click', function(e) {
            if (e.target === importPreviewModal) {
                closeImportModal();
            }
        });
    }

    if (contactEditModal) {
        contactEditModal.addEventListener('click', function(e) {
            if (e.target === contactEditModal) {
                closeContactModal();
            }
        });
    }

    /**
     * Lukker modal med ESC-tasten
     */
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            if (contactEditModal && contactEditModal.classList.contains('show')) {
                closeContactModal();
            } else if (importPreviewModal.classList.contains('show')) {
                closeImportModal();
            } else if (equipmentConfirmModal.classList.contains('show')) {
                cancelSaveEquipment();
            } else if (clusterActionModal && clusterActionModal.classList.contains('show')) {
                closeClusterActionModal();
            } else if (equipmentEditModal.classList.contains('show')) {
                closeEquipmentEditModal();
            } else if (orderModal.classList.contains('show')) {
                closeOrderModal();
            } else {
                searchInput.value = '';
                renderCustomerList(allCustomers);
                searchInput.focus();
            }
        }
    });

    document.getElementById('cluster-action-save-btn')?.addEventListener('click', handleClusterActionSave);

    // Last inn data ved oppstart
    loadData();
    
    console.log('✅ Kundesystem initialisert (fullstendig versjon)');
});
