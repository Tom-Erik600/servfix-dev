let allCustomersForSearch = [];
let customerSearchTimeout = null;
let projectSearchTimeout = null;

// Last alle kunder for søk (kjøres parallelt med eksisterende loadData)
async function loadAllCustomersForSearch() {
    try {
        console.log('📋 Loading customers for search functionality...');
        
        const response = await fetch('/api/admin/customers', {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        allCustomersForSearch = await response.json();
        console.log(`✅ Loaded ${allCustomersForSearch.length} customers for search`);
        
    } catch (error) {
        console.error('❌ Error loading customers for search:', error);
    }
}

// Håndter søkeinput med debounce
function handleCustomerSearchInput(e) {
    if (document.getElementById('customers-tab-btn') && !document.getElementById('customers-tab-btn').classList.contains('active')) {
        return;
    }

    clearTimeout(customerSearchTimeout);
    
    const query = e.target.value.trim().toLowerCase();
    
    customerSearchTimeout = setTimeout(() => {
        filterCustomerCards(query);
    }, 300);
}

function getLocalDateString() {
    const now = new Date();
    const timezoneOffsetMs = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - timezoneOffsetMs).toISOString().split('T')[0];
}

// Filtrer kundekort basert på søk
function filterCustomerCards(query) {
    const customerCards = document.querySelectorAll('.project-card, .modern-customer-card');
    let visibleCount = 0;
    
    customerCards.forEach(card => {
        const customerName = card.dataset.customerName || 
                           card.querySelector('.customer-name, h3')?.textContent || '';
        const customerNumber = card.querySelector('.customer-number-badge')?.textContent || '';
        
        const nameMatch = customerName.toLowerCase().includes(query);
        const numberMatch = customerNumber.toLowerCase().includes(query);
        
        if (!query || nameMatch || numberMatch) {
            card.style.display = 'block';
            visibleCount++;
        } else {
            card.style.display = 'none';
        }
    });
    
    // Oppdater telleren
    const orderCountBadge = document.getElementById('order-count');
    if (orderCountBadge) {
        orderCountBadge.textContent = visibleCount;
    }
}

async function searchProjects(query) {
    const response = await fetch(`/api/admin/projects/search?q=${encodeURIComponent(query)}`, {
        credentials: 'include'
    });

    if (!response.ok) {
        throw new Error('Kunne ikke søke etter prosjekter');
    }

    return response.json();
}

function handleProjectSearchInput(e, onResults) {
    clearTimeout(projectSearchTimeout);

    const query = e.target.value.trim();

    projectSearchTimeout = setTimeout(async () => {
        if (!query) {
            onResults([]);
            return;
        }

        try {
            const results = await searchProjects(query);
            onResults(results);
        } catch (error) {
            console.error('❌ Error searching projects:', error);
            onResults([]);
        }
    }, 500);
}

document.addEventListener('DOMContentLoaded', async () => {
    const technicianList = document.getElementById('technician-list');
    console.log('technicianList element ved initialisering:', technicianList);
    const projectList = document.getElementById('project-list');
    console.log('projectList element ved initialisering:', projectList);
    const dateModal = document.getElementById('date-modal');
    console.log('dateModal element ved initialisering:', dateModal);
    const modalInfoText = document.getElementById('modal-info-text');
    console.log('modalInfoText element ved initialisering:', modalInfoText);
    const modalDateInput = document.getElementById('modal-date');
    console.log('modalDateInput element ved initialisering:', modalDateInput);
    const modalCancelBtn = document.getElementById('modal-cancel-btn');
    console.log('modalCancelBtn element ved initialisering:', modalCancelBtn);
    const modalSaveBtn = document.getElementById('modal-save-btn');
    console.log('modalSaveBtn element ved initialisering:', modalSaveBtn);

    const customerSearchInput = document.getElementById('customer-search-input');
    const projectSearchInput = document.getElementById('project-search-input');
    const customersTabBtn = document.getElementById('customers-tab-btn');
    const projectsTabBtn = document.getElementById('projects-tab-btn');
    const plannerListTitle = document.getElementById('planner-list-title');
    const plannerSearchLabel = document.getElementById('planner-search-label');

    let draggedTechnician = null;
    let targetCustomer = null;
    let allCustomers = [];
    let visibleCustomers = [];
    let currentTab = 'customers';
    let projectSearchResults = [];
    let showExpiredProjects = false;
    let tenantFlags = {};

    // Hent tenant-flags (modul-på/av). Ikke cachet — sessionStorage er per-tab og
    // vil bli stale når admin endrer flagg i en annen tab. Endpoint er billig.
    async function loadTenantFlags() {
        try {
            const res = await fetch('/api/tenant/flags', { credentials: 'include', cache: 'no-store' });
            if (res.ok) {
                const data = await res.json();
                tenantFlags = (data && typeof data === 'object') ? (data.flags || data) : {};
            } else {
                console.warn('GET /api/tenant/flags returnerte', res.status);
                tenantFlags = {};
            }
        } catch (err) {
            console.warn('Kunne ikke hente tenant-flags:', err);
            tenantFlags = {};
        }
        console.log('🚩 tenantFlags:', tenantFlags);
    }
    await loadTenantFlags();

    // ── Top-tab navigation (Enkel / Avansert / Periode) ──────────────────
    let currentTopTab = null;
    let enkelInitialized = false;

    function isTopTabActive(name) {
        if (name === 'avansert') return tenantFlags.show_avansert_tab !== false; // default true
        if (name === 'enkel')    return tenantFlags.show_enkel_tab === true;
        if (name === 'periode')  return tenantFlags.show_periode_tab === true;
        return false;
    }

    function setupTopTabs() {
        const tabNames = ['enkel', 'avansert', 'periode'];
        const activeTabs = tabNames.filter(isTopTabActive);

        tabNames.forEach(name => {
            const btn = document.getElementById(`${name}-top-tab-btn`);
            if (btn) {
                btn.style.display = isTopTabActive(name) ? 'inline-flex' : 'none';
                btn.addEventListener('click', () => setTopTab(name));
            }
        });

        const tabBar = document.getElementById('planner-top-tabs');
        if (tabBar) tabBar.style.display = activeTabs.length >= 2 ? 'flex' : 'none';

        const preferred = tenantFlags.default_tab || 'avansert';
        const startTab = isTopTabActive(preferred) ? preferred
                       : (activeTabs.length > 0 ? activeTabs[0] : 'avansert');
        setTopTab(startTab);
    }

    function setTopTab(name) {
        currentTopTab = name;
        ['enkel', 'avansert', 'periode'].forEach(n => {
            const btn = document.getElementById(`${n}-top-tab-btn`);
            if (btn) btn.classList.toggle('active', n === name);
            const div = document.getElementById(`${n}-content`);
            if (div) div.style.display = n === name ? 'block' : 'none';
        });
        if (name === 'enkel' && !enkelInitialized) {
            enkelInitialized = true;
            initEnkelFane();
        } else if (name === 'periode') {
            if (!periodeInitialized) {
                periodeInitialized = true;
                initPeriodeFane();
            } else {
                loadPeriodeRules();
                populatePeriodeCustomers();
            }
        }
    }

    function initEnkelFane() {
        const searchInput = document.getElementById('enkel-customer-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const q = e.target.value.trim().toLowerCase();
                const cards = document.querySelectorAll('#enkel-customer-list .modern-customer-card');
                let count = 0;
                cards.forEach(card => {
                    const name = (card.dataset.customerName || '').toLowerCase();
                    const num  = (card.querySelector('.customer-number-badge')?.textContent || '').toLowerCase();
                    const show = !q || name.includes(q) || num.includes(q);
                    card.style.display = show ? 'block' : 'none';
                    if (show) count++;
                });
                const badge = document.getElementById('enkel-order-count');
                if (badge) badge.textContent = count;
            });
        }
    }

    setupTopTabs();

    // Sett minimumdato til i dag
    const today = new Date().toISOString().split('T')[0];
    modalDateInput.setAttribute('min', today);
    modalDateInput.value = today;

    async function fetchData() {
        try {
            const [technicians, customersData, activeOrders] = await Promise.all([
                fetch('/api/admin/technicians', {
                    credentials: 'include'
                }).then(res => res.json()),
                fetch('/api/admin/customers', {
                    credentials: 'include'
                }).then(res => res.json()),
                fetch('/api/admin/orders?status=pending,scheduled,in_progress', {
                    credentials: 'include'
                }).then(res => res.json()),
            ]);

            // Håndter både ny struktur (med wrapper) og gammel struktur (direkte array)
            if (customersData.customers) {
                allCustomers = customersData.customers;
            } else if (Array.isArray(customersData)) {
                allCustomers = customersData;
            } else {
                console.error('Ugyldig dataformat fra API:', customersData);
                allCustomers = [];
            }
            console.log('allCustomers:', allCustomers);
            console.log('activeOrders raw:', activeOrders);
            
            // Finn kunder uten aktive oppdrag
            const activeCustomerIds = new Set(activeOrders.map(o => o.customer_id || o.customerId));
            console.log('activeCustomerIds:', activeCustomerIds);
            visibleCustomers = allCustomers.filter(c => !c.isInactive);

            renderTechnicians(technicians);
            renderEnkelTechnicians(technicians);
            renderCurrentTab();
            renderEnkelCustomers();
            
        } catch (error) {
            console.error('Error fetching data:', error);
            showToast('Kunne ikke laste data', 'error');
        }
    }

    function renderTechnicians(technicians) {
        technicianList.innerHTML = '';

        // ── Felles / pool-kort — kun hvis tenant har show_pool_technician = true ──
        if (tenantFlags.show_pool_technician === true) {
            const fellesCard = document.createElement('div');
            fellesCard.className = 'technician-card';
            fellesCard.style.cssText = 'background:#f9fafb;border:2px dashed #9ca3af;';
            fellesCard.draggable = true;
            fellesCard.dataset.technicianId = '__pool__';
            fellesCard.innerHTML = `
                <div class="technician-avatar" style="background-color:#9ca3af;">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                        <circle cx="9" cy="7" r="4"/>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                    </svg>
                </div>
                <div>
                    <strong>Felles</strong>
                    <div style="font-size:11px;color:#6b7280;font-weight:400;margin-top:2px;">Pool — alle kan plukke</div>
                </div>
            `;
            fellesCard.addEventListener('dragstart', handleDragStart);
            fellesCard.addEventListener('dragend', handleDragEnd);
            technicianList.appendChild(fellesCard);
        }

        if (technicians.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.innerHTML = '<p>Ingen teknikere funnet</p>';
            technicianList.appendChild(empty);
            return;
        }

        technicians.forEach(tech => {
            const techCard = document.createElement('div');
            techCard.className = 'technician-card';
            techCard.draggable = true;
            techCard.dataset.technicianId = tech.id;
            techCard.innerHTML = `
                <div class="technician-avatar">${tech.initials}</div>
                <div>
                    <strong>${tech.name}</strong>
                </div>
            `;
            
            techCard.addEventListener('dragstart', handleDragStart);
            techCard.addEventListener('dragend', handleDragEnd);
            
            technicianList.appendChild(techCard);
        });
    }

    // ── Enkel-fane: render teknikere til #enkel-technician-list ─────────
    function renderEnkelTechnicians(technicians) {
        const list = document.getElementById('enkel-technician-list');
        if (!list) return;
        list.innerHTML = '';

        if (tenantFlags.show_pool_technician === true) {
            const fellesCard = document.createElement('div');
            fellesCard.className = 'technician-card';
            fellesCard.style.cssText = 'background:#f9fafb;border:2px dashed #9ca3af;';
            fellesCard.draggable = true;
            fellesCard.dataset.technicianId = '__pool__';
            fellesCard.innerHTML = `
                <div class="technician-avatar" style="background-color:#9ca3af;">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                        <circle cx="9" cy="7" r="4"/>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                    </svg>
                </div>
                <div>
                    <strong>Felles</strong>
                    <div style="font-size:11px;color:#6b7280;font-weight:400;margin-top:2px;">Pool — alle kan plukke</div>
                </div>
            `;
            fellesCard.addEventListener('dragstart', handleDragStart);
            fellesCard.addEventListener('dragend', handleDragEnd);
            list.appendChild(fellesCard);
        }

        if (technicians.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.innerHTML = '<p>Ingen teknikere funnet</p>';
            list.appendChild(empty);
            return;
        }

        technicians.forEach(tech => {
            const techCard = document.createElement('div');
            techCard.className = 'technician-card';
            techCard.draggable = true;
            techCard.dataset.technicianId = tech.id;
            techCard.innerHTML = `
                <div class="technician-avatar">${tech.initials}</div>
                <div><strong>${tech.name}</strong></div>
            `;
            techCard.addEventListener('dragstart', handleDragStart);
            techCard.addEventListener('dragend', handleDragEnd);
            list.appendChild(techCard);
        });
    }

    // ── Enkel-fane: render kunder til #enkel-customer-list ──────────────
    function renderEnkelCustomers() {
        const list = document.getElementById('enkel-customer-list');
        if (!list) return;
        list.innerHTML = '';

        const customers = visibleCustomers;
        const badge = document.getElementById('enkel-order-count');
        if (badge) badge.textContent = customers.length;

        if (customers.length === 0) {
            list.innerHTML = '<div class="empty-state"><p>Ingen kunder funnet</p></div>';
            return;
        }

        customers.forEach(customer => {
            const card = document.createElement('div');
            card.className = 'modern-customer-card project-card';
            card.dataset.customerId = customer.id;
            card.dataset.customerName = customer.name;
            card.dataset.cardType = 'customer';
            card.innerHTML = `
                <div class="customer-card-header">
                    <span class="customer-name">${customer.name}</span>
                    ${customer.customerNumber ? `<span class="customer-number-badge">${customer.customerNumber}</span>` : ''}
                </div>
                ${customer.address ? `<div class="customer-address">${customer.address}</div>` : ''}
            `;
            card.addEventListener('dragover', handleDragOver);
            card.addEventListener('dragleave', handleDragLeave);
            card.addEventListener('drop', handleDrop);
            list.appendChild(card);
        });
    }

    function updateListHeader(title, count) {
        if (plannerListTitle) {
            plannerListTitle.textContent = title;
        }

        const orderCountBadge = document.getElementById('order-count');
        if (orderCountBadge) {
            orderCountBadge.textContent = count;
        }
    }

    function createDropCardListeners(card) {
        card.addEventListener('dragover', handleDragOver);
        card.addEventListener('dragleave', handleDragLeave);
        card.addEventListener('drop', handleDrop);
    }

    function setActiveTab(tabName) {
        currentTab = tabName;

        customersTabBtn?.classList.toggle('active', tabName === 'customers');
        projectsTabBtn?.classList.toggle('active', tabName === 'projects');
        document.getElementById('periode-tab-btn')?.classList.toggle('active', tabName === 'periode');

        // Avansert sub-tab: customers / projects only (#periode-content owned by setTopTab)
        if (projectList) projectList.style.display = 'block';

        if (customerSearchInput) {
            customerSearchInput.style.display = tabName === 'customers' ? 'block' : 'none';
        }

        if (projectSearchInput) {
            projectSearchInput.style.display = tabName === 'projects' ? 'block' : 'none';
        }

        if (plannerSearchLabel) {
            plannerSearchLabel.style.display = 'block';
            plannerSearchLabel.textContent = tabName === 'projects' ? 'Søk prosjekt' : 'Søk kunde';
        }

        renderCurrentTab();

        if (tabName === 'projects' && projectSearchInput) {
            window.requestAnimationFrame(() => projectSearchInput.focus());
        }

        if (tabName === 'customers' && customerSearchInput) {
            window.requestAnimationFrame(() => customerSearchInput.focus());
        }
    }

    function renderCurrentTab() {
        if (currentTab === 'projects') {
            renderProjects(projectSearchResults);
            return;
        }
        renderCustomers();
    }

    function renderCustomers() {
        projectList.innerHTML = '';

        const customersToShow = visibleCustomers;
        const headerText = 'Kunder';

        updateListHeader(headerText, customersToShow.length);

        if (customersToShow.length === 0) {
            projectList.innerHTML = '<div class="empty-state"><p>Ingen kunder funnet</p></div>';
            return;
        }

        customersToShow.forEach(customer => {
            console.log(`Setter dataset for ${customer.name}: ${customer.id}`);
            const customerCard = document.createElement('div');
            customerCard.className = 'modern-customer-card project-card';
            customerCard.dataset.customerId = customer.id;
            customerCard.dataset.customerName = customer.name;
            customerCard.dataset.cardType = 'customer';

            console.log(`Dataset ble satt til: ${customerCard.dataset.customerId}`);

            customerCard.innerHTML = `
    <div class="customer-card-header">
        <h3 class="customer-name">${escapeHtml(customer.name)}</h3>
        ${customer.customerNumber ? `<span class="customer-number-badge">Nr. ${customer.customerNumber}</span>` : ''}
    </div>

    <div class="customer-main-content">
        <div class="customer-left-section">
            <div class="customer-info-item">
                <span class="customer-info-label">Org.nr</span>
                <span class="customer-info-value ${!customer.organizationNumber ? 'empty' : ''}">
                    ${customer.organizationNumber || 'Ikke oppgitt'}
                </span>
            </div>

            <div class="customer-info-item">
                <span class="customer-info-label">Kontaktperson</span>
                <span class="customer-info-value ${!customer.contact ? 'empty' : ''}">
                    ${customer.contact || 'Ikke oppgitt'}
                </span>
            </div>
        </div>

        <div class="customer-right-section">
            <div class="customer-info-item">
                <span class="customer-info-label">Postadresse</span>
                <span class="customer-info-value ${!customer.postalAddress ? 'empty' : ''}">
                    ${customer.postalAddress || 'Ikke oppgitt'}
                </span>
            </div>

            <div class="customer-info-item">
                <span class="customer-info-label">Forretningsadr.</span>
                <span class="customer-info-value ${!customer.physicalAddress ? 'empty' : ''}">
                    ${customer.physicalAddress || 'Ikke oppgitt'}
                </span>
            </div>
        </div>
    </div>

    <div class="customer-contact-footer">
        <div class="customer-contact-item">
            <span class="contact-icon">📧</span>
            <span>${customer.email || 'Ingen e-post'}</span>
        </div>
        <div class="customer-contact-item">
            <span class="contact-icon">📞</span>
            <span>${customer.phone || 'Ingen telefon'}</span>
        </div>
    </div>
`;

            createDropCardListeners(customerCard);


            projectList.appendChild(customerCard);
        });
    }

    function renderProjects(projects) {
        projectList.innerHTML = '';

        const today = getLocalDateString();
        const visibleProjects = showExpiredProjects
            ? projects
            : projects.filter(p => !p.endDate || p.endDate >= today);

        const expiredCount = projects.filter(p => p.endDate && p.endDate < today).length;

        // Toggle-knapp øverst
        const toggleBar = document.createElement('div');
        toggleBar.className = 'project-filter-bar';
        toggleBar.innerHTML = `
            <label class="expired-toggle-label">
                <input type="checkbox" id="show-expired-toggle" ${showExpiredProjects ? 'checked' : ''}>
                Vis utgåtte prosjekter${expiredCount > 0 ? ` (${expiredCount})` : ''}
            </label>
        `;
        projectList.appendChild(toggleBar);

        document.getElementById('show-expired-toggle')?.addEventListener('change', (e) => {
            showExpiredProjects = e.target.checked;
            renderProjects(projectSearchResults);
        });

        updateListHeader('Prosjekter', visibleProjects.length);

        if (!visibleProjects.length) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.innerHTML = projects.length
                ? '<p>Ingen aktive prosjekter. Kryss av «Vis utgåtte» for å se alle.</p>'
                : '<p>Søk etter prosjekt for å se treff</p>';
            projectList.appendChild(empty);
            return;
        }

        visibleProjects.forEach(project => {
            const projectCard = document.createElement('div');
            projectCard.className = 'modern-customer-card project-card project-search-card';
            projectCard.dataset.cardType = 'project';
            projectCard.dataset.customerId = project.customer?.id || '';
            projectCard.dataset.customerName = project.customer?.name || '';
            projectCard.dataset.projectId = project.id;
            projectCard.dataset.projectName = project.displayName || project.name || '';

            projectCard.innerHTML = `
    <div class="customer-card-header">
        <h3 class="customer-name">${escapeHtml(project.displayName || project.name || 'Uten navn')}</h3>
        ${project.number ? `<span class="customer-number-badge">Prosj. ${escapeHtml(project.number)}</span>` : ''}
    </div>

    <div class="customer-main-content">
        <div class="customer-left-section">
            <div class="customer-info-item">
                <span class="customer-info-label">Kunde</span>
                <span class="customer-info-value ${!project.customer?.name ? 'empty' : ''}">
                    ${escapeHtml(project.customer?.name || 'Ingen kunde koblet')}
                </span>
            </div>
        </div>

        <div class="customer-right-section">
            <div class="customer-info-item">
                <span class="customer-info-label">Status</span>
                <span class="customer-info-value">${project.isClosed ? 'Lukket' : 'Aktivt'}</span>
            </div>
        </div>
    </div>
`;

            createDropCardListeners(projectCard);
            projectList.appendChild(projectCard);
        });
    }

// LEGG OGSÅ TIL denne escapeHtml funksjonen hvis den ikke finnes:
function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

    if (customerSearchInput) {
        customerSearchInput.addEventListener('input', handleCustomerSearchInput);
    }

    if (projectSearchInput) {
        projectSearchInput.addEventListener('input', (e) => handleProjectSearchInput(e, (results) => {
            projectSearchResults = results;
            if (currentTab === 'projects') {
                renderProjects(projectSearchResults);
            }
        }));
    }

    customersTabBtn?.addEventListener('click', () => setActiveTab('customers'));
    projectsTabBtn?.addEventListener('click', () => setActiveTab('projects'));
    document.getElementById('periode-tab-btn')?.addEventListener('click', () => setActiveTab('periode'));

    function handleDragStart(e) {
        draggedTechnician = e.target;
        e.dataTransfer.setData('text/plain', e.target.dataset.technicianId);
        e.target.classList.add('dragging');
    }

    function handleDragEnd(e) {
        e.target.classList.remove('dragging');
    }

    function handleDragOver(e) {
        e.preventDefault();
        e.currentTarget.classList.add('drag-over');
    }

    function handleDragLeave(e) {
        e.currentTarget.classList.remove('drag-over');
    }

    // OPPDATERT handleDrop MED EQUIPMENT SELECTION
    // Oppdater handleDrop funksjonen i planlegger.js

    async function handleDrop(e) {
        console.log('=== HANDLE DROP DEBUG ===');
        
        e.preventDefault();
        e.currentTarget.classList.remove('drag-over');
        
        const customerCard = e.currentTarget;
        const customerId = customerCard.dataset.customerId;
        const cardType = customerCard.dataset.cardType || 'customer';
        const suggestedDescription = customerCard.dataset.projectName || '';
        console.log('Leter etter customerId:', customerId);
        console.log('Type:', typeof customerId);

        if (!draggedTechnician) {
            console.error('❌ Ingen tekniker valgt!');
            return;
        }
        
        try {
            const technicianId = draggedTechnician.dataset.technicianId;
            const isPool = technicianId === '__pool__';
            console.log('🔍 1. technicianId:', technicianId, isPool ? '(pool)' : '');

            // Debug: Vis tilgjengelige kunder
            console.log('Søker i array: allCustomers');
            const customersToSearch = allCustomers;
            console.log('Array lengde:', customersToSearch.length);

            const customer = customersToSearch.find(c => {
                const localId = String(c.id || '');
                const externalId = String(c.externalId || '');
                const matches = localId === String(customerId) || externalId === String(customerId);
                console.log(`Sammenligner lokal/external: "${localId}" / "${externalId}" mot "${customerId}" (${matches})`);
                return matches;
            });
            
            console.log('🔍 2. Kunde funnet:', customer);

            if (!customer) {
                console.error(' ❌ Kunde ikke funnet!');
                console.log('Tilgjengelige kunde-IDer:', customersToSearch.map(c => c.id));
                return;
            }
            
            // Prøv å finne strong element
            const strongElement = draggedTechnician.querySelector('strong');
            console.log('🔍 3. strong element:', strongElement);
            
            if (!strongElement) {
                console.error('❌ Fant ikke strong element i draggedTechnician!');
                return;
            }
            
            const technician = strongElement.textContent;
            console.log('✅ 4. Tekniker navn:', technician);
            
            targetCustomer = {
                ...customer,
                technicianId: isPool ? null : technicianId,
                customerId: customer.id || customer.externalId || customer.customerId,
                customerName: customer.name,
                selectedProjectName: cardType === 'project' ? suggestedDescription : ''
            };
            
            console.log('✅ 5. targetCustomer satt:', targetCustomer);
            
            // OPPDATERT: Vis modal med equipment selection
            await showModalWithEquipment(customer, isPool ? null : technician, {
                suggestedDescription: cardType === 'project' ? suggestedDescription : '',
                simple: currentTopTab === 'enkel',
            });
            
        } catch (error) {
            console.error('❌ FEIL I HANDLEDROP:', error);
            console.error('Stack trace:', error.stack);
        }
    }

    function escapeAttribute(value) {
        return escapeHtml(value).replace(/"/g, '&quot;');
    }

    function buildEquipmentRow(eq, selectedIds = null) {
        const name = escapeHtml(eq.systemnavn || eq.name || 'Uten navn');
        const type = escapeHtml(eq.systemtype || eq.type || 'Ukjent type');
        const systemNumber = escapeHtml(eq.systemnummer || eq.systemNumber || '');
        const placement = escapeHtml(eq.plassering || eq.systemPlacement || eq.location || 'Uten plassering');
        const servedBy = escapeHtml(eq.betjener || '—');
        const isChecked = selectedIds ? selectedIds.has(String(eq.id)) : true;
        const removeClusterButton = eq.clusterId
            ? `<button type="button" class="equipment-remove-cluster-btn" data-equipment-id="${eq.id}" title="Ta ut av cluster">-</button>`
            : '';

        return `
            <label class="equipment-selection-item cluster-equipment-item">
                <input type="checkbox" value="${eq.id}" class="equipment-checkbox" data-cluster-id="${eq.clusterId || ''}" ${isChecked ? 'checked' : ''}>
                <div class="equipment-info">
                    <span class="equipment-name">${name}</span>
                    <div class="equipment-detail-inline">
                        <span class="equipment-detail-chip"><strong>Type:</strong> ${type}</span>
                        <span class="equipment-detail-chip"><strong>Nr:</strong> ${systemNumber || '—'}</span>
                        <span class="equipment-detail-chip equipment-detail-chip-wide"><strong>Plass:</strong> ${placement}</span>
                        <span class="equipment-detail-chip equipment-detail-chip-wide"><strong>Betjener:</strong> ${servedBy}</span>
                    </div>
                </div>
                ${removeClusterButton}
            </label>
        `;
    }

    function getCurrentSelectedEquipmentIds() {
        return new Set(Array.from(document.querySelectorAll('.equipment-checkbox:checked')).map(cb => String(cb.value)));
    }

    function renderEquipmentList(equipment, selectedIds = null) {
        const equipmentList = document.querySelector('.equipment-list');
        if (!equipmentList) return;

        if (!equipment.length) {
            equipmentList.innerHTML = '<div class="no-equipment-message">Ingen aktive anlegg funnet for kunden.</div>';
            return;
        }

        const groups = new Map();
        const ungroupedKey = '__ungrouped__';

        equipment.forEach(eq => {
            const key = eq.clusterId ? String(eq.clusterId) : ungroupedKey;
            if (!groups.has(key)) {
                groups.set(key, {
                    title: eq.clusterName || 'Ovrige anlegg',
                    items: []
                });
            }
            groups.get(key).items.push(eq);
        });

        const markup = Array.from(groups.entries()).map(([key, group]) => {
            const isGrouped = key !== ungroupedKey;
            const rows = group.items.map(item => buildEquipmentRow(item, selectedIds)).join('');

            return `
                <div class="equipment-cluster-group">
                    <div class="equipment-cluster-header">
                        <div class="equipment-cluster-heading">
                            ${isGrouped ? `
                                <label class="cluster-master-label">
                                    <input type="checkbox" class="cluster-master-checkbox" data-cluster-id="${escapeAttribute(key)}">
                                    <span class="cluster-master-custom"></span>
                                </label>
                            ` : '<span class="cluster-master-spacer"></span>'}
                            <div>
                            <div class="equipment-cluster-title">${escapeHtml(group.title)}</div>
                            <div class="equipment-cluster-meta">${group.items.length} anlegg</div>
                            </div>
                        </div>
                        ${isGrouped ? `<span class="equipment-cluster-hint">Velg cluster</span>` : ''}
                    </div>
                    <div class="equipment-selection-list">${rows}</div>
                </div>
            `;
        }).join('');

        equipmentList.innerHTML = markup;

        document.querySelectorAll('.cluster-master-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                setClusterSelection(checkbox.dataset.clusterId, checkbox.checked);
            });
        });

        document.querySelectorAll('.equipment-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                syncClusterCheckboxStates();
                updateEquipmentCounter();
            });
        });

        document.querySelectorAll('.equipment-remove-cluster-btn').forEach(button => {
            button.addEventListener('click', async (event) => {
                event.preventDefault();
                event.stopPropagation();

                const equipmentId = button.dataset.equipmentId;
                await removeEquipmentFromCluster(equipmentId);
            });
        });

        syncClusterCheckboxStates();
        updateEquipmentCounter();
    }

    // ── Enkel-modus: flat anleggsliste uten cluster-grupper ─────────────
    function renderEquipmentListSimple(equipment, selectedIds = null) {
        const equipmentList = document.querySelector('.equipment-list');
        if (!equipmentList) return;

        if (!equipment.length) {
            equipmentList.innerHTML = '<div class="no-equipment-message">Ingen aktive anlegg funnet for kunden.</div>';
            return;
        }

        const markup = equipment.map(eq => {
            const name = escapeHtml(eq.systemnavn || eq.name || 'Uten navn');
            const type = escapeHtml(eq.systemtype || eq.type || 'Ukjent type');
            const systemNumber = escapeHtml(eq.systemnummer || eq.systemNumber || '');
            const placement = escapeHtml(eq.plassering || eq.systemPlacement || eq.location || 'Uten plassering');
            const isChecked = selectedIds ? selectedIds.has(String(eq.id)) : true;
            return `
                <label class="equipment-selection-item">
                    <input type="checkbox" value="${eq.id}" class="equipment-checkbox" ${isChecked ? 'checked' : ''}>
                    <div class="equipment-info">
                        <span class="equipment-name">${name}</span>
                        <div class="equipment-detail-inline">
                            <span class="equipment-detail-chip"><strong>Type:</strong> ${type}</span>
                            ${systemNumber ? `<span class="equipment-detail-chip"><strong>Nr:</strong> ${systemNumber}</span>` : ''}
                            <span class="equipment-detail-chip equipment-detail-chip-wide"><strong>Plass:</strong> ${placement}</span>
                        </div>
                    </div>
                </label>
            `;
        }).join('');

        equipmentList.innerHTML = markup;

        document.querySelectorAll('.equipment-checkbox').forEach(cb => {
            cb.addEventListener('change', updateEquipmentCounter);
        });
        updateEquipmentCounter();
    }

    function selectAllEquipment() {
        document.querySelectorAll('.equipment-checkbox').forEach(cb => {
            cb.checked = true;
        });
        syncClusterCheckboxStates();
        updateEquipmentCounter();
    }

    function deselectAllEquipment() {
        document.querySelectorAll('.equipment-checkbox').forEach(cb => {
            cb.checked = false;
        });
        syncClusterCheckboxStates();
        updateEquipmentCounter();
    }

    function updateEquipmentCounter() {
        const counter = document.getElementById('equipment-counter');
        if (!counter) return;
        const all = document.querySelectorAll('.equipment-checkbox').length;
        const checked = document.querySelectorAll('.equipment-checkbox:checked').length;
        counter.textContent = `${checked} av ${all} anlegg merket`;
    }

    function setClusterSelection(clusterId, checked) {
        const checkboxes = Array.from(document.querySelectorAll(`.equipment-checkbox[data-cluster-id="${clusterId}"]`));
        checkboxes.forEach(cb => {
            cb.checked = checked;
        });

        syncClusterCheckboxStates();
    }

    function syncClusterCheckboxStates() {
        document.querySelectorAll('.cluster-master-checkbox').forEach(clusterCheckbox => {
            const clusterId = clusterCheckbox.dataset.clusterId;
            const items = Array.from(document.querySelectorAll(`.equipment-checkbox[data-cluster-id="${clusterId}"]`));
            const checkedCount = items.filter(item => item.checked).length;

            clusterCheckbox.checked = items.length > 0 && checkedCount === items.length;
            clusterCheckbox.indeterminate = checkedCount > 0 && checkedCount < items.length;
        });
    }

    function getSelectedEquipmentIds() {
        return Array.from(document.querySelectorAll('.equipment-checkbox:checked')).map(cb => cb.value);
    }

    async function fetchCustomerClusters(customer) {
        const customerId = customer.id || customer.customerId;
        const response = await fetch(`/api/admin/clusters?customerId=${customerId}`, {
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error('Kunne ikke hente cluster');
        }

        return response.json();
    }

    async function createClusterForCustomer(customer, name) {
        const customerId = customer.id || customer.customerId;
        const response = await fetch('/api/admin/clusters', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ customerId, name })
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Kunne ikke opprette cluster');
        }

        return data;
    }

    async function assignEquipmentToCluster(equipmentIds, clusterId) {
        const response = await fetch('/api/admin/equipment/assign-cluster', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ equipmentIds, clusterId })
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Kunne ikke oppdatere cluster for anlegg');
        }

        return data;
    }

    async function removeEquipmentFromCluster(equipmentId) {
        if (!targetCustomer) {
            showToast('Ingen kunde valgt', 'error');
            return;
        }

        try {
            const selectedIds = getCurrentSelectedEquipmentIds();
            selectedIds.delete(String(equipmentId));
            await assignEquipmentToCluster([equipmentId], null);
            await loadEquipmentForModal(targetCustomer, selectedIds);
            showToast('Anlegg tatt ut av cluster', 'success');
        } catch (error) {
            console.error('Remove equipment from cluster error:', error);
            showToast(error.message, 'error');
        }
    }

    function closeInlineClusterModal() {
        const existing = document.getElementById('inline-cluster-modal');
        if (existing) {
            existing.remove();
        }
    }

    function setInlineClusterModalLoading(isLoading, message = 'Jobber...') {
        const saveButton = document.getElementById('cluster-modal-save');
        const cancelButton = document.getElementById('cluster-modal-cancel');
        const modalBody = document.querySelector('#inline-cluster-modal .modal-body');

        if (saveButton) {
            saveButton.disabled = isLoading;
            saveButton.textContent = isLoading ? message : saveButton.dataset.defaultLabel;
        }

        if (cancelButton) {
            cancelButton.disabled = isLoading;
        }

        if (modalBody) {
            modalBody.style.opacity = isLoading ? '0.65' : '1';
            modalBody.style.pointerEvents = isLoading ? 'none' : 'auto';
        }
    }

    function showInlineClusterModal(customer, mode) {
        const selectedEquipmentIds = getSelectedEquipmentIds();
        if (mode !== 'create' && !selectedEquipmentIds.length) {
            showToast('Velg minst ett anlegg først', 'error');
            return;
        }

        closeInlineClusterModal();

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay show';
        overlay.id = 'inline-cluster-modal';

        const title = mode === 'create' ? 'Opprett nytt cluster' : 'Legg valgte anlegg i cluster';
        const submitLabel = mode === 'create' ? 'Opprett cluster' : 'Lagre';

        overlay.innerHTML = `
            <div class="modal-content cluster-modal-content">
                <div class="modal-header">
                    <h3>${title}</h3>
                </div>
                <div class="modal-body">
                    <p class="modal-info-text">${mode === 'create' ? 'Opprett et nytt cluster for kunden. Ingen anlegg flyttes automatisk.' : `${selectedEquipmentIds.length} valgte anlegg blir oppdatert.`}</p>
                    ${mode === 'assign' ? `
                        <div class="form-group">
                            <label for="cluster-select">Velg cluster</label>
                            <select id="cluster-select" class="cluster-modal-input">
                                <option value="">Laster cluster...</option>
                            </select>
                        </div>
                    ` : ''}
                    <div class="form-group">
                        <label for="cluster-name-input">${mode === 'create' ? 'Clusternavn' : 'Nytt clusternavn (valgfritt)'}</label>
                        <input type="text" id="cluster-name-input" class="cluster-modal-input" placeholder="F.eks. Industriveien 92 Eidsvoll">
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" id="cluster-modal-cancel">Avbryt</button>
                    <button type="button" class="btn btn-primary" id="cluster-modal-save">${submitLabel}</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        document.getElementById('cluster-modal-cancel')?.addEventListener('click', closeInlineClusterModal);
        const clusterSaveButton = document.getElementById('cluster-modal-save');
        if (clusterSaveButton) {
            clusterSaveButton.dataset.defaultLabel = submitLabel;
        }

        if (mode === 'assign') {
            fetchCustomerClusters(customer)
                .then(clusters => {
                    const select = document.getElementById('cluster-select');
                    if (!select) return;

                    select.innerHTML = `
                        <option value="">Velg cluster...</option>
                        ${clusters.map(cluster => `<option value="${cluster.id}">${escapeHtml(cluster.name)}</option>`).join('')}
                        <option value="__new__">Opprett nytt cluster...</option>
                    `;

                    select.addEventListener('change', () => {
                        const input = document.getElementById('cluster-name-input');
                        if (!input) return;
                        input.style.display = select.value === '__new__' ? 'block' : 'none';
                        if (select.value !== '__new__') {
                            input.value = '';
                        }
                    });

                    const input = document.getElementById('cluster-name-input');
                    if (input) {
                        input.style.display = 'none';
                    }
                })
                .catch(error => {
                    showToast(error.message, 'error');
                    closeInlineClusterModal();
                });
        }

        document.getElementById('cluster-modal-save')?.addEventListener('click', async () => {
            try {
                setInlineClusterModalLoading(true, mode === 'create' ? 'Oppretter...' : 'Lagrer...');
                const nameInput = document.getElementById('cluster-name-input');
                const select = document.getElementById('cluster-select');

                let clusterId = null;

                if (mode === 'create') {
                    const clusterName = nameInput?.value?.trim();
                    if (!clusterName) {
                        throw new Error('Skriv inn clusternavn');
                    }

                    const cluster = await createClusterForCustomer(customer, clusterName);
                    await loadEquipmentForModal(customer, getCurrentSelectedEquipmentIds());
                    closeInlineClusterModal();
                    showToast(`Cluster "${cluster.name}" opprettet`, 'success');
                    return;
                } else {
                    if (!select?.value) {
                        throw new Error('Velg cluster eller opprett nytt');
                    }

                    if (select.value === '__new__') {
                        const clusterName = nameInput?.value?.trim();
                        if (!clusterName) {
                            throw new Error('Skriv inn clusternavn');
                        }

                        const cluster = await createClusterForCustomer(customer, clusterName);
                        clusterId = cluster.id;
                    } else {
                        clusterId = select.value;
                    }
                }

                const selectedIds = getCurrentSelectedEquipmentIds();
                await assignEquipmentToCluster(selectedEquipmentIds, clusterId);
                await loadEquipmentForModal(customer, selectedIds);
                closeInlineClusterModal();
                showToast('Cluster oppdatert', 'success');
            } catch (error) {
                console.error('Cluster handling error:', error);
                showToast(error.message, 'error');
                setInlineClusterModalLoading(false, submitLabel);
            }
        });
    }

    async function loadEquipmentForModal(customer, selectedIds = null, simple = false) {
        try {
            const response = await fetch(`/api/admin/equipment?customerId=${customer.externalId || customer.id}`, {
                credentials: 'include'
            });

            if (!response.ok) throw new Error('Kunne ikke laste anlegg');

            const equipment = await response.json();
            equipment.sort((a, b) => (a.clusterName || 'zzz').localeCompare(b.clusterName || 'zzz') || (a.name || '').localeCompare(b.name || ''));

            if (simple) {
                renderEquipmentListSimple(equipment, selectedIds);
            } else {
                renderEquipmentList(equipment, selectedIds);
            }
        } catch (error) {
            console.error('Error loading equipment:', error);
            showToast('Kunne ikke laste anlegg', 'error');
        }
    }

    async function showModalWithEquipment(customer, technicianName, options = {}) {
    try {
        const today = getLocalDateString();
        const defaultDescription = options.suggestedDescription || `Service hos ${customer.name}`;
        const simple = !!options.simple;

        const modalContent = document.querySelector('.modal-content');

        if (simple) {
            // ── Enkel-modus: dato + beskrivelse + anlegg (ingen cluster) ──
            modalContent.innerHTML = `
                <div class="modal-header">
                    <h3>Opprett serviceoppdrag</h3>
                    <span style="font-size: 13px; color: #6b7280; font-weight: 400;">${escapeHtml(customer.name)} · ${technicianName ? escapeHtml(technicianName) : 'Uten tekniker (pool)'}</span>
                </div>

                <div class="modal-body">
                    <div class="form-group">
                        <label for="modal-date">Dato</label>
                        <input type="date" id="modal-date" value="${today}" min="${today}" required>
                    </div>

                    <div class="form-group">
                        <label for="modal-description">Beskrivelse</label>
                        <input type="text" id="modal-description"
                               value="${escapeAttribute(defaultDescription)}"
                               placeholder="Skriv inn beskrivelse..."
                               class="form-input"
                               required>
                    </div>

                    <div class="equipment-selection-section">
                        <h4>Velg anlegg for service:</h4>
                        <div class="equipment-selection-help">
                            <small>Alle anlegg er valgt som standard. Fjern haken for anlegg som ikke skal inkluderes.</small>
                        </div>
                        <div class="equipment-bulk-actions">
                            <button type="button" class="btn equipment-quick-btn equipment-quick-btn-add" id="equipment-select-all-btn">+ Marker alle</button>
                            <button type="button" class="btn equipment-quick-btn equipment-quick-btn-remove" id="equipment-deselect-all-btn">- Fjern markering alle</button>
                            <span id="equipment-counter" style="margin-left: 12px; font-size: 13px; color: #6b7280; align-self: center;"></span>
                        </div>
                        <div class="equipment-list"></div>
                    </div>
                </div>

                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" id="modal-cancel-btn">Avbryt</button>
                    <button type="button" class="btn btn-primary" id="modal-save-btn">Opprett oppdrag</button>
                </div>
            `;

            await loadEquipmentForModal(customer, null, true);

            dateModal.style.display = 'flex';
            dateModal.classList.add('show');

            document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);
            document.getElementById('modal-save-btn').addEventListener('click', saveOrderWithEquipment);
            document.getElementById('equipment-select-all-btn')?.addEventListener('click', selectAllEquipment);
            document.getElementById('equipment-deselect-all-btn')?.addEventListener('click', deselectAllEquipment);

        } else {
            // ── Avansert-modus: full modal med cluster, prosjekt-dropdown etc. ──
            modalContent.innerHTML = `
            <div class="modal-header">
                <h3>Opprett serviceoppdrag</h3>
                <span style="font-size: 13px; color: #6b7280; font-weight: 400;">${escapeHtml(customer.name)} · ${technicianName ? escapeHtml(technicianName) : 'Uten tekniker (pool)'}</span>
            </div>
            
            <div class="modal-body">
                <div class="form-group">
                    <label for="modal-date">Dato</label>
                    <input type="date" id="modal-date" value="${today}" min="${today}" required>
                </div>

                <div class="form-group">
                    <label for="modal-description">Prosjekt / Beskrivelse</label>
                    <div id="description-dropdown-wrapper">
                        <select id="modal-description-select" class="form-input">
                            <option value="">⏳ Laster prosjekter...</option>
                        </select>
                    </div>
                    <input type="text" id="modal-description"
                           value="${escapeAttribute(defaultDescription)}"
                           placeholder="Skriv inn beskrivelse..."
                           class="form-input"
                           style="display: none;"
                           required>
                </div>

                <div class="form-group">
                    <label for="modal-visit-number">Besøksnr <span style="font-weight: 400; color: #9ca3af;">(valgfri)</span></label>
                    <input type="text" id="modal-visit-number" placeholder="F.eks. 3" class="form-input">
                </div>

                <div class="form-group">
                    <label for="modal-service-address-street">Serviceadresse <span style="font-weight: 400; color: #9ca3af;">(valgfri)</span></label>
                    <input type="text" id="modal-service-address-street" placeholder="Gate/vei" class="form-input">
                    <div style="display: flex; gap: 8px; margin-top: 6px;">
                        <input type="text" id="modal-service-address-postal-code" placeholder="Postnr" class="form-input" style="flex: 0 0 100px;">
                        <input type="text" id="modal-service-address-city" placeholder="Poststed" class="form-input" style="flex: 1;">
                    </div>
                </div>

                <div class="equipment-selection-section">
                    <h4>Velg anlegg for service:</h4>
                    <div class="equipment-selection-help">
                        <small>Alle anlegg er valgt som standard. Fjern haken for anlegg som ikke skal inkluderes i dette oppdraget.</small>
                    </div>
                    <div class="equipment-manage-actions">
                        <button type="button" class="btn btn-secondary equipment-manage-btn" id="equipment-create-cluster-btn">+ Nytt cluster</button>
                        <button type="button" class="btn btn-secondary equipment-manage-btn" id="equipment-assign-cluster-btn">Flytt til cluster</button>
                    </div>
                    <div class="equipment-bulk-actions">
                        <button type="button" class="btn equipment-quick-btn equipment-quick-btn-add" id="equipment-select-all-btn">+ Marker alle</button>
                        <button type="button" class="btn equipment-quick-btn equipment-quick-btn-remove" id="equipment-deselect-all-btn">- Fjern markering alle</button>
                        <span id="equipment-counter" style="margin-left: 12px; font-size: 13px; color: #6b7280; align-self: center;"></span>
                    </div>
                    <div class="equipment-list">
                        <!-- Anleggslisten lastes her av loadEquipmentForModal -->
                    </div>
                </div>
                
                <div class="add-equipment-section" style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
                    <button type="button" class="btn btn-outline" id="modal-add-equipment-btn">
                        <span style="font-size: 16px;">➕</span> Opprett nytt anlegg
                    </button>
                </div>

                <div class="form-group" style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
                    <label for="modal-customer-notes">Kundenotat <span style="font-weight: 400; color: #9ca3af;">(vises ikke på rapport)</span></label>
                    <textarea id="modal-customer-notes" rows="3" placeholder="Interne notater om kunden..." class="form-input" style="resize: vertical;"></textarea>
                </div>
            </div>
            
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" id="modal-cancel-btn">Avbryt</button>
                <button type="button" class="btn btn-primary" id="modal-save-btn">Opprett oppdrag</button>
            </div>
        `;

        // Last anlegg inn i den nye strukturen
        await loadEquipmentForModal(customer);

        // Last kundenotat
        const notesField = document.getElementById('modal-customer-notes');
        if (notesField && customer.notes) {
            notesField.value = customer.notes;
        }

        // Vis modal
        dateModal.style.display = 'flex';
        dateModal.classList.add('show');
        loadProjectSuggestions(customer, defaultDescription);

        // Re-attach event listeners til nye buttons
        document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);
        document.getElementById('modal-save-btn').addEventListener('click', saveOrderWithEquipment);
        document.getElementById('equipment-select-all-btn')?.addEventListener('click', selectAllEquipment);
        document.getElementById('equipment-deselect-all-btn')?.addEventListener('click', deselectAllEquipment);
        document.getElementById('equipment-create-cluster-btn')?.addEventListener('click', () => showInlineClusterModal(customer, 'create'));
        document.getElementById('equipment-assign-cluster-btn')?.addEventListener('click', () => showInlineClusterModal(customer, 'assign'));
        const addEquipmentBtn = document.getElementById('modal-add-equipment-btn');
        console.log('Add equipment button:', addEquipmentBtn);
        if (addEquipmentBtn) {
            addEquipmentBtn.addEventListener('click', () => {
                console.log('Add equipment button clicked!');
                showAddEquipmentModal(customer);
            });
        } else {
            console.error('Could not find modal-add-equipment-btn!');
        }

        } // end else (avansert-modus)

    } catch (error) {
        console.error('Error loading equipment:', error);
        // Vis standard modal hvis equipment loading feiler
        showStandardModal(customer, technicianName);
    }
}

async function loadProjectSuggestions(customer, preferredDescription = '') {
    const select = document.getElementById('modal-description-select');
    const textInput = document.getElementById('modal-description');
    if (!select || !textInput) return;

    try {
        const response = await fetch(`/api/admin/customers/${customer.externalId || customer.id}/projects`, {
            credentials: 'include'
        });
        const projects = await response.json();

        select.innerHTML = '';

        if (projects.length === 0) {
            // Ingen prosjekter — gå rett til fritekst
            select.style.display = 'none';
            textInput.style.display = 'block';
            textInput.value = preferredDescription || `Service hos ${customer.name}`;
            return;
        }

        if (preferredDescription && !projects.some(p => p.displayName === preferredDescription)) {
            projects.unshift({ displayName: preferredDescription });
        }

        // Fyll inn prosjekter (nyeste øverst = allerede sortert fra backend)
        projects.forEach((p, i) => {
            const opt = document.createElement('option');
            opt.value = p.displayName;
            opt.textContent = p.displayName;
            if (p.number != null) opt.dataset.projectNumber = p.number;
            if ((preferredDescription && p.displayName === preferredDescription) || (!preferredDescription && i === 0)) {
                opt.selected = true;
            }
            select.appendChild(opt);
        });

        // Legg til manuelt-valg nederst
        const manualOpt = document.createElement('option');
        manualOpt.value = '__manual__';
        manualOpt.textContent = '✏️ Skriv inn manuelt...';
        select.appendChild(manualOpt);

        // Synk textInput med første valg (brukes av saveOrderWithEquipment)
        const selectedProject = projects.find(p => p.displayName === select.value) || projects[0];
        textInput.value = selectedProject.displayName;

        select.addEventListener('change', () => {
            if (select.value === '__manual__') {
                select.style.display = 'none';
                textInput.style.display = 'block';
                textInput.value = '';
                textInput.focus();
            } else {
                textInput.value = select.value;
            }
        });

    } catch (error) {
        console.error('Kunne ikke laste prosjekter:', error);
        select.style.display = 'none';
        textInput.style.display = 'block';
        textInput.value = preferredDescription || `Service hos ${customer.name}`;
    }
}

async function showAddEquipmentModal(customer) {
    try {
        console.log('showAddEquipmentModal started with customer:', customer);
        
        // Hent facility types fra checklist templates
        const response = await fetch('/api/admin/checklist-templates', {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error('Kunne ikke hente anleggstyper');
        }
        
        const data = await response.json();
        console.log('Checklist templates data:', data);
        
        // Sjekk at vi har facilityTypes
        if (!data.facilityTypes || !Array.isArray(data.facilityTypes)) {
            throw new Error('Ingen anleggstyper funnet');
        }
        
        // Opprett en overlay modal for anleggsoppretting - BRUK CSS-KLASSER
        const equipmentModal = document.createElement('div');
        equipmentModal.className = 'modal-overlay equipment-modal show';
        
        equipmentModal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Velg type anlegg</h3>
                    <button type="button" class="close-btn">&times;</button>
                </div>
                
                <div class="modal-body">
                    <div class="type-selection-grid">
                        ${data.facilityTypes.map(type => `
                            <button type="button" class="type-btn" data-type="${type.id}">
                                ${type.name}
                            </button>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(equipmentModal);
        console.log('Equipment modal added to DOM');
        
        // Event listeners
        equipmentModal.querySelector('.close-btn').addEventListener('click', () => {
            document.body.removeChild(equipmentModal);
        });
        
        // FIX: Fjernet klikk-utenfor-lukking — modal lukkes kun via knapper
        // for å unngå utilsiktet lukking midt i arbeidsflyten
        
        // Type selection - hover og klikk
        equipmentModal.querySelectorAll('.type-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                console.log('Type button clicked!');
                const selectedType = btn.dataset.type;
                console.log('Selected type:', selectedType);
                console.log('Customer:', customer);
                
                // Sjekk om funksjonen eksisterer
                if (typeof showEquipmentForm === 'function') {
                    document.body.removeChild(equipmentModal);
                    showEquipmentForm(customer, selectedType);
                } else {
                    console.error('showEquipmentForm function not found!');
                }
            });
        });
        
    } catch (error) {
        console.error('Error in showAddEquipmentModal:', error);
        showToast('Kunne ikke laste anleggstyper: ' + error.message, 'error');
    }
}

function showEquipmentForm(customer, equipmentType) {
    const typeName = equipmentType.charAt(0).toUpperCase() + equipmentType.slice(1);
    
    let formFields = '';
    if (equipmentType === 'custom') {
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
                <label for="equipment-notes">Intern kommentar</label>
                <textarea id="equipment-notes" rows="3" placeholder="F.eks. Trenger gardintrapp"></textarea>
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
                <label for="equipment-notes">Intern kommentar</label>
                <textarea id="equipment-notes" rows="3" placeholder="F.eks. Vanskelig tilkomst, krever gardintrapp"></textarea>
            </div>
        `;
    }
    
    const formModal = document.createElement('div');
    formModal.className = 'modal-overlay equipment-form-modal show';
    formModal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 10000;';
    
    formModal.innerHTML = `
        <div class="modal-content" style="background: white; border-radius: 8px; max-width: 500px; width: 90%; max-height: 90vh; display: flex; flex-direction: column; overflow: hidden;">
            <div class="modal-header" style="padding: 20px 20px 16px; border-bottom: 1px solid #e5e7eb; flex-shrink: 0;">
                <h3 style="margin: 0;">Legg til ${typeName}</h3>
                <button type="button" class="close-btn" style="float: right; background: none; border: none; font-size: 24px; cursor: pointer; margin-top: -28px;">&times;</button>
            </div>

            <form id="equipment-form" style="display: flex; flex-direction: column; overflow: hidden; flex: 1;">
                <div class="modal-body" style="padding: 20px; overflow-y: auto; flex: 1;">
                    ${formFields}
                </div>

                <div class="modal-footer" style="padding: 16px 20px; display: flex; gap: 10px; justify-content: flex-end; border-top: 1px solid #e5e7eb; flex-shrink: 0; background: white;">
                    <button type="button" class="btn btn-secondary cancel-btn">Avbryt</button>
                    <button type="submit" class="btn btn-primary">Lagre anlegg</button>
                </div>
            </form>
        </div>
    `;
    
    document.body.appendChild(formModal);
    
    // Event listeners
    formModal.querySelector('.close-btn').addEventListener('click', () => {
        document.body.removeChild(formModal);
    });
    
    formModal.querySelector('.cancel-btn').addEventListener('click', () => {
        document.body.removeChild(formModal);
    });
    
    // FIX: Fjernet klikk-utenfor-lukking — modal lukkes kun via Avbryt/X-knapp
    // for å unngå tap av utfylt skjemadata
    
    // Form submit - inne i showAddEquipmentForm funksjonen
    formModal.querySelector('#equipment-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const equipmentData = {
            customerId: customer.externalId || customer.id || customer.customerId,
            systemtype: equipmentType,
            systemnummer: document.getElementById('systemnummer').value,
            systemnavn: document.getElementById('systemnavn').value,
            plassering: document.getElementById('plassering').value,
            betjener: document.getElementById('betjener')?.value || null,
            location: null,  // Brukes ikke - byggnavn hentes fra Tripletex
            notater: document.getElementById('equipment-notes')?.value || null,
            status: 'active'
        };
        
        try {
            const response = await fetch('/api/admin/equipment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(equipmentData)
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Kunne ikke opprette anlegg');
            }
            
            const newEquipment = await response.json();
            console.log('Equipment opprettet:', newEquipment);
            
            // Fjern modal
            document.body.removeChild(formModal);
            
            // Refresh equipment-listen i hovedmodalen
            await loadEquipmentForModal(customer);
            
            showToast('Anlegg opprettet!', 'success');
            
        } catch (error) {
            console.error('Error creating equipment:', error);
            showToast(error.message, 'error');
        }
    });
}

// Legg til denne funksjonen i planlegger.js
function showEquipmentSuccessModal(equipment, customer, previousModal) {
    // Fjern forrige modal
    if (previousModal && previousModal.parentNode) {
        document.body.removeChild(previousModal);
    }
    
    // Opprett ny modal med anleggsdetaljer
    const successModal = document.createElement('div');
    successModal.className = 'modal-overlay equipment-success-modal show';
    successModal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 9999;';
    
    successModal.innerHTML = `
        <div class="modal-content" style="background: white; padding: 30px; border-radius: 8px; max-width: 600px; width: 90%;">
            <div class="modal-header" style="margin-bottom: 20px;">
                <h3 style="color: #10b981; margin: 0;">✅ Anlegg opprettet!</h3>
            </div>
            
            <div class="modal-body" style="margin-bottom: 30px;">
                <div class="equipment-details" style="background: #f9fafb; padding: 20px; border-radius: 6px; border: 1px solid #e5e7eb;">
                    <h4 style="margin: 0 0 15px 0; color: #374151;">Anleggsdetaljer:</h4>
                    
                    <div style="display: grid; gap: 12px;">
                        <div style="display: flex; justify-content: space-between;">
                            <span style="font-weight: 600; color: #6b7280;">Type:</span>
                            <span style="color: #111827;">${equipment.systemtype || equipment.type}</span>
                        </div>
                        
                        <div style="display: flex; justify-content: space-between;">
                            <span style="font-weight: 600; color: #6b7280;">Systemnummer:</span>
                            <span style="color: #111827;">${equipment.systemnummer || 'N/A'}</span>
                        </div>
                        
                        <div style="display: flex; justify-content: space-between;">
                            <span style="font-weight: 600; color: #6b7280;">Systemnavn:</span>
                            <span style="color: #111827;">${equipment.systemnavn || equipment.name || 'N/A'}</span>
                        </div>
                        
                        <div style="display: flex; justify-content: space-between;">
                            <span style="font-weight: 600; color: #6b7280;">Plassering:</span>
                            <span style="color: #111827;">${equipment.plassering || 'N/A'}</span>
                        </div>
                        
                        ${equipment.betjener ? `
                        <div style="display: flex; justify-content: space-between;">
                            <span style="font-weight: 600; color: #6b7280;">Betjener:</span>
                            <span style="color: #111827;">${equipment.betjener}</span>
                        </div>
                        ` : ''}
                        
                        ${equipment.notater ? `
                        <div style="border-top: 1px solid #e5e7eb; padding-top: 12px; margin-top: 8px;">
                            <span style="font-weight: 600; color: #6b7280; display: block; margin-bottom: 8px;">Interne notater:</span>
                            <span style="color: #111827; display: block; white-space: pre-wrap;">${equipment.notater}</span>
                        </div>
                        ` : ''}
                    </div>
                </div>
                
                <div style="margin-top: 20px; padding: 15px; background: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 4px;">
                    <p style="margin: 0; color: #1e40af; font-size: 14px;">
                        <strong>Hva vil du gjøre nå?</strong><br>
                        Du kan opprette et oppdrag for dette anlegget eller lukke og opprette flere anlegg.
                    </p>
                </div>
            </div>
            
            <div class="modal-footer" style="display: flex; gap: 10px; justify-content: flex-end;">
                <button type="button" class="btn btn-secondary cancel-btn" style="padding: 10px 20px; border: 1px solid #d1d5db; background: white; border-radius: 6px; cursor: pointer;">
                    Lukk
                </button>
                <button type="button" class="btn btn-primary create-order-btn" style="padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">
                    Opprett oppdrag
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(successModal);
    
    // Lukk-knapp
    successModal.querySelector('.cancel-btn').addEventListener('click', () => {
        document.body.removeChild(successModal);
        fetchData(); // Refresh data
    });
    
    // Opprett oppdrag-knapp
    successModal.querySelector('.create-order-btn').addEventListener('click', () => {
        document.body.removeChild(successModal);
        // Vis ordreopprettingsmodal med dette anlegget forhåndsvalgt
        showOrderModalWithEquipment(customer, [equipment.id]);
    });
}

// Hjelpefunksjon for å vise ordre-modal med forhåndsvalgte anlegg
function showOrderModalWithEquipment(customer, equipmentIds) {
    // Åpne den vanlige ordre-modalen
    showStandardModal(customer, customer.technicianName);
    
    // Forhåndsvelg equipment
    setTimeout(() => {
        equipmentIds.forEach(id => {
            const checkbox = document.querySelector(`input[type="checkbox"][value="${id}"]`);
            if (checkbox) {
                checkbox.checked = true;
            }
        });
    }, 100);
}

    // Hjelpefunksjon for standard modal (fallback)
    function showStandardModal(customer, technicianName) {
        modalInfoText.textContent = `Opprett nytt serviceoppdrag for ${customer.name} med tekniker ${technicianName}.`;
        dateModal.style.display = 'flex';
        dateModal.classList.add('show');
        
        // Sørg for at standard event listeners er på plass
        modalCancelBtn.removeEventListener('click', closeModal);
        modalSaveBtn.removeEventListener('click', saveOrderWithEquipment);
        
        modalCancelBtn.addEventListener('click', closeModal);
        modalSaveBtn.addEventListener('click', saveOrderWithEquipment);
    }

    // Eneste closeModal — lukker date-modal og rydder opp
    function closeModal() {
        const dateModal = document.getElementById('date-modal');
        closeInlineClusterModal();
        hideModalLoadingState();
        dateModal.classList.remove('show');
        targetCustomer = null;
        setTimeout(() => {
            dateModal.style.display = 'none';
            // Reset modal content til original state
            const modalContent = document.querySelector('#date-modal .modal-content');
            modalContent.innerHTML = `
                <div class="modal-header">
                    <h3>Opprett serviceoppdrag</h3>
                </div>

                <div class="modal-body">
                    <p id="modal-info-text" class="modal-info-text"></p>

                    <div class="form-group">
                        <label for="modal-date">Velg dato:</label>
                        <input type="date" id="modal-date" required>
                    </div>
                </div>

                <div class="modal-footer">
                    <button type="button" id="modal-cancel-btn" class="btn btn-secondary">Avbryt</button>
                    <button type="button" id="modal-save-btn" class="btn btn-primary">Lagre Oppdrag</button>
                </div>
            `;
        }, 300);
    }

    function showModalLoadingState(message = 'Oppretter oppdrag...') {
        const modalContent = document.querySelector('#date-modal .modal-content');
        if (!modalContent) return;

        hideModalLoadingState();
        modalContent.style.position = 'relative';

        const overlay = document.createElement('div');
        overlay.className = 'modal-loading-overlay';
        overlay.id = 'modal-loading-overlay';
        overlay.innerHTML = `
            <div class="modal-loading-card">
                <div class="modal-loading-spinner"></div>
                <span>${message}</span>
            </div>
        `;

        modalContent.appendChild(overlay);
    }

    function hideModalLoadingState() {
        const existing = document.getElementById('modal-loading-overlay');
        if (existing) existing.remove();
    }

    // Fallback: Standard modal uten equipment
    function showStandardModal(customer, technicianName) {
        modalInfoText.textContent = `Opprett nytt serviceoppdrag for ${customer.name} med tekniker ${technicianName}.`;
        dateModal.style.display = 'flex';
        dateModal.classList.add('show');
    }

    // OPPDATERT: Lagre ordre med valgte anlegg
    // Finn og erstatt saveOrderWithEquipment funksjonen i planlegger.js med denne:

    async function fetchCompleteCustomerData(customerId) {
    console.log('📦 Fetching complete customer data for:', customerId);
    
    try {
        // Hent adresser
        const addressResponse = await fetch(`/api/admin/customers/${customerId}/addresses`, {
            credentials: 'include'
        });
        
        let addresses = {
            physicalAddress: null,
            postalAddress: null
        };
        
        if (addressResponse.ok) {
            addresses = await addressResponse.json();
            console.log('✅ Addresses fetched:', addresses);
        }
        
        // Hent servfixmail kontakt
        const contactResponse = await fetch(`/api/admin/customers/${customerId}/servfixmail`, {
            credentials: 'include'
        });
        
        let servfixEmail = null;
        if (contactResponse.ok) {
            const contactData = await contactResponse.json();
            servfixEmail = contactData.email;
            console.log('✅ Servfixmail contact found:', servfixEmail);
        }
        
        return {
            ...addresses,
            servfixEmail: servfixEmail
        };
        
    } catch (error) {
        console.error('❌ Error fetching complete customer data:', error);
        return {
            physicalAddress: null,
            postalAddress: null,
            servfixEmail: null
        };
    }
}

    async function saveOrderWithEquipment() {
    console.log('saveOrderWithEquipment called');
    
    if (!targetCustomer) {
        console.error('No target customer');
        showToast('Ingen kunde valgt', 'error');
        return;
    }
    
    const scheduledDate = document.getElementById('modal-date')?.value;
    const description = document.getElementById('modal-description')?.value;
    const customerNotes = document.getElementById('modal-customer-notes')?.value?.trim() ?? '';
    const visitNumber = document.getElementById('modal-visit-number')?.value?.trim() || null;
    const serviceAddressStreet = document.getElementById('modal-service-address-street')?.value?.trim() || null;
    const serviceAddressPostalCode = document.getElementById('modal-service-address-postal-code')?.value?.trim() || null;
    const serviceAddressCity = document.getElementById('modal-service-address-city')?.value?.trim() || null;

    // Les prosjektnummer fra valgt option (kun satt når et Tripletex-prosjekt er valgt)
    const descSelect = document.getElementById('modal-description-select');
    const selectedOption = descSelect?.options[descSelect.selectedIndex];
    const agreementNumber = selectedOption?.dataset?.projectNumber || null;
    
    if (!scheduledDate) {
        showToast('Vennligst velg en dato', 'error');
        return;
    }
    
    if (!description) {
        showToast('Vennligst skriv inn en beskrivelse', 'error');
        return;
    }

    const saveButton = document.getElementById('modal-save-btn');
    const cancelButton = document.getElementById('modal-cancel-btn');
    const originalSaveText = saveButton?.textContent || 'Lagre Oppdrag';
    
    try {
        if (saveButton) {
            saveButton.disabled = true;
            saveButton.textContent = 'Oppretter oppdrag...';
        }
        if (cancelButton) cancelButton.disabled = true;
        showModalLoadingState('Oppretter oppdrag...');

        // NYTT: Hent komplette kundedata først
        console.log('📡 Fetching complete customer data...');
        const completeData = await fetchCompleteCustomerData(targetCustomer.customerId);
        console.log('📦 Complete data received:', completeData);
        
        // Hent valgte anlegg
        const selectedCheckboxes = document.querySelectorAll('.equipment-checkbox:checked');
        const selectedEquipment = Array.from(selectedCheckboxes).map(cb => cb.value);
        
        console.log('Selected equipment IDs:', selectedEquipment);
        
        // Lagre customerName før modal lukkes
        const customerName = targetCustomer.customerName;
        
        const orderData = {
            customerId: targetCustomer.customerId,
            customerName: customerName,
            description: description,
            serviceType: 'Generell service',
            technicianId: targetCustomer.technicianId,
            scheduledDate: scheduledDate,
            // OPPDATERT: Bruk komplette data
            customerData: {
                id: targetCustomer.customerId,
                name: customerName,
                physicalAddress: completeData.physicalAddress || targetCustomer.physicalAddress || null,
                postalAddress: completeData.postalAddress || targetCustomer.postalAddress || null,
                email: completeData.servfixEmail || null,  // KUN servfixmail-epost, ALDRI fallback
                organizationNumber: targetCustomer.organizationNumber || null,
                contact: targetCustomer.contact || null,
                phone: targetCustomer.phone || null,
                ...(agreementNumber != null && { agreement_number: String(agreementNumber) }),
                ...(visitNumber != null && { visit_number: visitNumber })
            },
            serviceAddressStreet: serviceAddressStreet,
            serviceAddressPostalCode: serviceAddressPostalCode,
            serviceAddressCity: serviceAddressCity
        };
        
        // Legg til includedEquipmentIds hvis valgt
        if (selectedEquipment.length > 0) {
            orderData.includedEquipmentIds = selectedEquipment;
        }
        
        console.log('📦 Customer data being sent:', orderData.customerData);
        console.log('Sending order data:', orderData);
        
        const response = await fetch('/api/admin/orders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify(orderData)
        });
        
        if (response.ok) {
            const newOrder = await response.json();
            console.log('Ordre opprettet med valgte anlegg:', newOrder);

            // Lagre kundenotat hvis endret
            const localCustomerId = targetCustomer.id || targetCustomer.customerId;
            if (customerNotes !== (targetCustomer.notes || '')) {
                try {
                    await fetch(`/api/admin/customers/${localCustomerId}/notes`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ notes: customerNotes })
                    });
                } catch (e) {
                    console.error('Kunne ikke lagre kundenotat:', e);
                }
            }

            // Lukk modal FØRST
            closeModal();
            
            // DERETTER refresh data
            await fetchData();
            
            // Til slutt vis melding med lagret kundenavn
            showToast(`Ordre opprettet for ${customerName}`, 'success');
        } else {
            const errorData = await response.json();
            console.error('Feil fra server:', errorData);
            throw new Error(errorData.error || 'Failed to create order');
        }
    } catch (error) {
        console.error('Error creating order:', error);
        showToast(`Kunne ikke opprette ordre: ${error.message}`, 'error');
    } finally {
        hideModalLoadingState();
        if (saveButton) {
            saveButton.disabled = false;
            saveButton.textContent = originalSaveText;
        }
        if (cancelButton) cancelButton.disabled = false;
    }
}
    // Original modal save function (for fallback)
    modalSaveBtn.addEventListener('click', async () => {
        const scheduledDate = modalDateInput.value;
        if (!scheduledDate) {
            showToast('Vennligst velg en dato', 'error');
            return;
        }

        modalSaveBtn.disabled = true;
        modalSaveBtn.textContent = 'Oppretter...';

        try {
            // Finn komplett kundedata
            const customer = allCustomers.find(c => c.id == targetCustomer.customerId);
            
            if (!customer) {
                throw new Error('Kunne ikke finne kundedata');
            }
            
            // Lag customer_data snapshot
            const customerData = {
                id: customer.id,
                name: customer.name,
                customerNumber: customer.customerNumber,
                organizationNumber: customer.organizationNumber,
                contact: customer.contact,
                email: customer.email,
                phone: customer.phone,
                physicalAddress: customer.physicalAddress,
                postalAddress: customer.postalAddress,
                invoiceEmail: customer.invoiceEmail,
                snapshot_date: new Date().toISOString()
            };
            
            // Opprett nytt oppdrag
            const response = await fetch('/api/admin/orders', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    customerId: targetCustomer.customerId,
                    customerName: targetCustomer.customerName,
                    customerData: customerData,
                    description: `Serviceoppdrag for ${targetCustomer.customerName}`,
                    serviceType: 'Generell service',
                    technicianId: targetCustomer.technicianId,
                    scheduledDate: scheduledDate,
                    status: 'scheduled',
                }),
            });

            if (response.ok) {
                closeModal();
                showToast('Serviceoppdrag opprettet og planlagt!', 'success');
                await fetchData();
            } else {
                const error = await response.json();
                throw new Error(error.error || 'Kunne ikke opprette oppdrag');
            }
        } catch (error) {
            console.error('Error creating order:', error);
            showToast(error.message || 'Feil ved opprettelse av oppdrag', 'error');
        } finally {
            modalSaveBtn.disabled = false;
            modalSaveBtn.textContent = 'Opprett oppdrag';
        }
    });

    // Modal håndtering — bruker closeModal definert på linje ~830
    // (Fjernet duplikat closeModal som overskrev den riktige versjonen)

    function showToast(message, type = 'success') {
        const existingToast = document.querySelector('.toast');
        if (existingToast) {
            existingToast.remove();
        }
        
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 3000);
    }

    // ─────────────────────────────────────────────────────────────────
    // PERIODE-FANE
    // ─────────────────────────────────────────────────────────────────
    let periodeInitialized = false;
    let periodeState = {
        ruleId: null,
        savedRuleId: null,
        previewDone: false,
        previewCount: 0,
        rules: [],
    };

    function populatePeriodeCustomers() {
        const select = document.getElementById('periode-customer-select');
        if (!select) return;
        const current = select.value;
        select.innerHTML = '<option value="">Velg kunde...</option>';
        (allCustomersForSearch || []).forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = c.name + (c.customerNumber ? ` (${c.customerNumber})` : '');
            select.appendChild(opt);
        });
        if (current) select.value = current;
    }

    async function populatePeriodeTechnicians() {
        const select = document.getElementById('periode-technician-select');
        if (!select) return;
        try {
            const res = await fetch('/api/admin/technicians', { credentials: 'include' });
            if (!res.ok) return;
            const technicians = await res.json();
            select.innerHTML = '<option value="">Pool / ingen tekniker</option>';
            technicians.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.id;
                opt.textContent = t.name;
                select.appendChild(opt);
            });
        } catch (e) {
            console.warn('Kunne ikke hente teknikere for Periode-skjema:', e);
        }
    }

    async function loadPeriodeEquipment(customerId) {
        const container = document.getElementById('periode-equipment-list');
        if (!container) return;
        if (!customerId) {
            container.innerHTML = '<span class="periode-equipment-placeholder">Velg kunde for å laste anlegg</span>';
            return;
        }
        container.innerHTML = '<span class="periode-equipment-placeholder">Laster anlegg...</span>';
        try {
            const res = await fetch(`/api/admin/equipment?customerId=${customerId}`, { credentials: 'include' });
            if (!res.ok) throw new Error('Feil');
            const raw = await res.json();
            const list = Array.isArray(raw) ? raw : (raw.equipment || []);
            const active = list.filter(e => !e.status || e.status === 'active');
            if (active.length === 0) {
                container.innerHTML = '<span class="periode-equipment-placeholder">Ingen aktive anlegg</span>';
                return;
            }
            container.innerHTML = active.map(eq => `
                <label class="periode-equipment-item">
                    <input type="checkbox" class="periode-equipment-checkbox" value="${eq.id}" checked>
                    <span>${escapeHtml(eq.systemnavn || eq.name || 'Ukjent anlegg')}</span>
                    ${eq.systemtype ? `<span class="periode-equipment-type">${escapeHtml(eq.systemtype)}</span>` : ''}
                </label>`).join('');
        } catch (e) {
            container.innerHTML = '<span class="periode-equipment-placeholder" style="color:var(--danger-color,#dc2626);">Kunne ikke laste anlegg</span>';
        }
    }

    function getSelectedPeriodeEquipmentIds() {
        return Array.from(document.querySelectorAll('.periode-equipment-checkbox:checked')).map(cb => cb.value);
    }

    function handlePeriodeFreqChange() {
        const val = document.querySelector('input[name="periode-freq"]:checked')?.value;
        const xEl = document.getElementById('freq-every-x-container');
        const wdEl = document.getElementById('freq-weekdays-container');
        if (xEl) xEl.style.display = val === 'every_x_days' ? 'block' : 'none';
        if (wdEl) wdEl.style.display = val === 'weekdays' ? 'block' : 'none';
    }

    function hidePeriodePreview() {
        const el = document.getElementById('periode-preview');
        if (el) el.style.display = 'none';
    }

    function updatePeriodeGenerateBtn() {
        const btn = document.getElementById('periode-generate-btn');
        if (!btn) return;
        const rule = periodeState.rules.find(r => r.id === periodeState.savedRuleId);
        const alreadyGenerated = rule && rule.generated_count > 0;
        if (alreadyGenerated) {
            btn.disabled = true;
            btn.title = 'Allerede generert — opprett ny regel for ny periode';
        } else if (!periodeState.savedRuleId) {
            btn.disabled = true;
            btn.title = 'Lagre regel først';
        } else if (!periodeState.previewDone) {
            btn.disabled = true;
            btn.title = 'Kjør forhåndsvisning først';
        } else {
            btn.disabled = false;
            btn.title = '';
        }
    }

    async function loadPeriodeRules() {
        const container = document.getElementById('periode-rules-list');
        if (!container) return;
        try {
            const res = await fetch('/api/admin/recurring-orders', { credentials: 'include' });
            if (!res.ok) throw new Error('Feil');
            periodeState.rules = await res.json();
            renderPeriodeRules();
            updatePeriodeGenerateBtn();
        } catch (e) {
            console.error('Kunne ikke hente periodergler:', e);
        }
    }

    function renderPeriodeRules() {
        const container = document.getElementById('periode-rules-list');
        if (!container) return;
        if (periodeState.rules.length === 0) {
            container.innerHTML = '<span class="periode-rules-empty">Ingen regler opprettet ennå.</span>';
            return;
        }
        const freqLabels = {
            daily: 'Daglig', weekly: 'Ukentlig', monthly: 'Månedlig',
            yearly: 'Årlig', every_x_days: 'Hver X dag', weekdays: 'Valgte ukedager',
        };
        container.innerHTML = periodeState.rules.map(rule => {
            const freqLabel = rule.frequency_type === 'every_x_days'
                ? `Hver ${rule.frequency_value} dag`
                : (freqLabels[rule.frequency_type] || rule.frequency_type);
            const generated = rule.generated_count > 0;
            const badge = generated
                ? '<span class="periode-rule-badge periode-rule-badge--done">Generert</span>'
                : (rule.is_active
                    ? '<span class="periode-rule-badge periode-rule-badge--active">Aktiv</span>'
                    : '<span class="periode-rule-badge periode-rule-badge--inactive">Inaktiv</span>');
            return `
            <div class="periode-rule-card">
                <div class="periode-rule-header">
                    <div class="periode-rule-info">
                        <strong>${escapeHtml(rule.customer_name)}</strong>${badge}
                    </div>
                    <div class="periode-rule-actions">
                        <button class="btn btn-secondary btn-sm periode-copy-btn" data-rule-id="${rule.id}">Kopier</button>
                        <button class="btn btn-danger btn-sm periode-delete-btn" data-rule-id="${rule.id}">Slett</button>
                    </div>
                </div>
                <div class="periode-rule-meta">
                    <span>${escapeHtml(rule.start_date?.slice(0,10)||'')} → ${escapeHtml(rule.end_date?.slice(0,10)||'')}</span>
                    <span>${freqLabel}</span>
                    ${generated ? `<span>${rule.generated_count} ordrer opprettet</span>` : ''}
                </div>
            </div>`;
        }).join('');
        container.querySelectorAll('.periode-copy-btn').forEach(btn =>
            btn.addEventListener('click', () => copyPeriodeRule(parseInt(btn.dataset.ruleId))));
        container.querySelectorAll('.periode-delete-btn').forEach(btn =>
            btn.addEventListener('click', () => deletePeriodeRule(parseInt(btn.dataset.ruleId))));
    }

    async function copyPeriodeRule(ruleId) {
        try {
            const res = await fetch(`/api/admin/recurring-orders/${ruleId}`, { credentials: 'include' });
            if (!res.ok) throw new Error('Kunne ikke hente regel');
            const rule = await res.json();
            periodeState.ruleId = null;
            periodeState.savedRuleId = null;
            periodeState.previewDone = false;
            periodeState.previewCount = 0;
            document.getElementById('periode-form-title').textContent = 'Ny periodeplan (kopi)';
            document.getElementById('periode-customer-select').value = rule.customer_id;
            document.getElementById('periode-technician-select').value = rule.technician_id || '';
            document.getElementById('periode-service-type').value = rule.service_type || 'Generell service';
            document.getElementById('periode-description').value = rule.description || '';
            document.getElementById('periode-address-street').value = rule.service_address_street || '';
            document.getElementById('periode-address-postal').value = rule.service_address_postal_code || '';
            document.getElementById('periode-address-city').value = rule.service_address_city || '';
            const freqRadio = document.querySelector(`input[name="periode-freq"][value="${rule.frequency_type}"]`);
            if (freqRadio) freqRadio.checked = true;
            document.getElementById('periode-freq-x').value = rule.frequency_value || 14;
            if (Array.isArray(rule.weekdays)) {
                document.querySelectorAll('input[name="weekday"]').forEach(cb => {
                    cb.checked = rule.weekdays.includes(parseInt(cb.value));
                });
            }
            handlePeriodeFreqChange();
            const prevEnd = rule.end_date?.slice(0, 10);
            if (prevEnd) {
                const d = new Date(prevEnd);
                d.setDate(d.getDate() + 1);
                const pad = n => String(n).padStart(2, '0');
                document.getElementById('periode-start-date').value =
                    `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
            }
            document.getElementById('periode-end-date').value = '';
            document.getElementById('periode-scheduled-time').value = rule.scheduled_time || '';
            await loadPeriodeEquipment(rule.customer_id);
            if (Array.isArray(rule.equipment_ids)) {
                document.querySelectorAll('.periode-equipment-checkbox').forEach(cb => {
                    cb.checked = rule.equipment_ids.includes(cb.value);
                });
            }
            hidePeriodePreview();
            updatePeriodeGenerateBtn();
            document.getElementById('periode-form-card')?.scrollIntoView({ behavior: 'smooth' });
            showToast('Skjema forhåndsutfylt fra eksisterende regel', 'success');
        } catch (e) {
            console.error('copyPeriodeRule error:', e);
            showToast('Kunne ikke kopiere regel', 'error');
        }
    }

    async function deletePeriodeRule(ruleId) {
        if (!confirm('Slett regel? Allerede genererte ordrer beholdes.')) return;
        try {
            const res = await fetch(`/api/admin/recurring-orders/${ruleId}`, {
                method: 'DELETE', credentials: 'include',
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'Sletting feilet');
            }
            if (periodeState.savedRuleId === ruleId) {
                periodeState.savedRuleId = null;
                periodeState.ruleId = null;
            }
            showToast('Regel slettet. Genererte ordrer beholdes.', 'success');
            await loadPeriodeRules();
        } catch (e) {
            showToast(e.message || 'Kunne ikke slette regel', 'error');
        }
    }

    function buildPeriodeRequestBody() {
        const frequencyType = document.querySelector('input[name="periode-freq"]:checked')?.value;
        const weekdays = frequencyType === 'weekdays'
            ? Array.from(document.querySelectorAll('input[name="weekday"]:checked')).map(cb => parseInt(cb.value))
            : null;
        const customerSelect = document.getElementById('periode-customer-select');
        const customerId = customerSelect?.value;
        const customerName = customerSelect?.selectedOptions[0]?.text?.split(' (')[0] || '';
        return {
            customerId,
            customerName,
            technicianId: document.getElementById('periode-technician-select').value || null,
            equipmentIds: getSelectedPeriodeEquipmentIds(),
            description: document.getElementById('periode-description').value.trim() || null,
            serviceType: document.getElementById('periode-service-type').value.trim() || 'Generell service',
            serviceAddressStreet: document.getElementById('periode-address-street').value.trim() || null,
            serviceAddressPostalCode: document.getElementById('periode-address-postal').value.trim() || null,
            serviceAddressCity: document.getElementById('periode-address-city').value.trim() || null,
            startDate: document.getElementById('periode-start-date').value,
            endDate: document.getElementById('periode-end-date').value,
            frequencyType,
            frequencyValue: frequencyType === 'every_x_days'
                ? parseInt(document.getElementById('periode-freq-x').value) || 1
                : null,
            weekdays,
            scheduledTime: document.getElementById('periode-scheduled-time').value || null,
        };
    }

    function validatePeriodeForm(body) {
        if (!body.customerId) return 'Velg kunde';
        if (!body.startDate) return 'Velg startdato';
        if (!body.endDate) return 'Velg sluttdato';
        if (body.endDate < body.startDate) return 'Sluttdato må være lik eller etter startdato';
        if (!body.frequencyType) return 'Velg frekvens';
        if (body.frequencyType === 'weekdays' && (!body.weekdays || body.weekdays.length === 0))
            return 'Velg minst én ukedag';
        return null;
    }

    async function savePeriodeRule(body) {
        const isEdit = !!periodeState.savedRuleId;
        const url = isEdit
            ? `/api/admin/recurring-orders/${periodeState.savedRuleId}`
            : '/api/admin/recurring-orders';
        const res = await fetch(url, {
            method: isEdit ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Kunne ikke lagre regel');
        periodeState.savedRuleId = data.id;
        periodeState.ruleId = data.id;
        document.getElementById('periode-form-title').textContent = 'Rediger periodeplan';
        await loadPeriodeRules();
        return data;
    }

    document.getElementById('periode-preview-btn')?.addEventListener('click', async () => {
        const body = buildPeriodeRequestBody();
        const err = validatePeriodeForm(body);
        if (err) return showToast(err, 'error');

        const previewBtn = document.getElementById('periode-preview-btn');
        previewBtn.disabled = true;
        previewBtn.textContent = 'Lagrer...';
        try {
            const saved = await savePeriodeRule(body);
            previewBtn.textContent = 'Beregner...';
            const res = await fetch(`/api/admin/recurring-orders/${saved.id}/preview`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Forhåndsvisning feilet');
            periodeState.previewDone = true;
            periodeState.previewCount = data.count;
            const previewEl = document.getElementById('periode-preview');
            const previewBody = document.getElementById('periode-preview-body');
            previewEl.style.display = 'block';
            let html = `<p class="preview-count"><strong>${data.count} ordrer</strong> vil bli opprettet</p>`;
            if (data.first_dates?.length > 0) {
                html += `<ul class="preview-dates">${data.first_dates.map(d => `<li>${d}</li>`).join('')}</ul>`;
                if (data.count > data.first_dates.length)
                    html += `<p class="preview-more">… og ${data.count - data.first_dates.length} til</p>`;
                if (data.last_date)
                    html += `<p class="preview-last">Siste dato: <strong>${data.last_date}</strong></p>`;
            }
            if (data.warning_threshold_exceeded)
                html += `<p class="preview-warning">⚠️ Over 1000 ordrer — bekreftelse kreves ved generering</p>`;
            previewBody.innerHTML = html;
            updatePeriodeGenerateBtn();
            showToast('Forhåndsvisning klar', 'success');
        } catch (e) {
            showToast(e.message, 'error');
        } finally {
            previewBtn.disabled = false;
            previewBtn.textContent = 'Forhåndsvis';
        }
    });

    document.getElementById('periode-save-btn')?.addEventListener('click', async () => {
        const body = buildPeriodeRequestBody();
        const err = validatePeriodeForm(body);
        if (err) return showToast(err, 'error');
        const saveBtn = document.getElementById('periode-save-btn');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Lagrer...';
        try {
            await savePeriodeRule(body);
            showToast('Regel lagret', 'success');
        } catch (e) {
            showToast(e.message, 'error');
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Lagre regel';
        }
    });

    document.getElementById('periode-generate-btn')?.addEventListener('click', async () => {
        if (!periodeState.savedRuleId) return showToast('Ingen regel lagret', 'error');
        const count = periodeState.previewCount;
        const msg = count > 1000
            ? `Advarsel: Dette vil opprette ${count} ordrer (over 1000). Vil du fortsette?`
            : `Generer ${count} ordrer for denne perioden?`;
        if (!confirm(msg)) return;
        const btn = document.getElementById('periode-generate-btn');
        btn.disabled = true;
        btn.textContent = 'Genererer...';
        try {
            const res = await fetch(`/api/admin/recurring-orders/${periodeState.savedRuleId}/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ confirmed: true }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Generering feilet');
            showToast(`${data.created} ordrer opprettet`, 'success');
            periodeState.previewDone = false;
            hidePeriodePreview();
            await loadPeriodeRules();
            updatePeriodeGenerateBtn();
        } catch (e) {
            showToast(e.message, 'error');
            btn.disabled = false;
            btn.textContent = 'Generer ordrer';
        }
    });

    document.getElementById('periode-reset-btn')?.addEventListener('click', () => {
        if (confirm('Nullstille skjemaet? Ulagrede endringer går tapt.')) resetPeriodeForm();
    });

    document.getElementById('periode-customer-select')?.addEventListener('change', async (e) => {
        const customerId = e.target.value;
        periodeState.savedRuleId = null;
        periodeState.previewDone = false;
        hidePeriodePreview();
        updatePeriodeGenerateBtn();
        await loadPeriodeEquipment(customerId);
        if (customerId) {
            try {
                const res = await fetch(`/api/admin/customers/${customerId}/addresses`, { credentials: 'include' });
                if (res.ok) {
                    const addr = await res.json();
                    const phys = addr.physicalAddress;
                    if (phys) {
                        document.getElementById('periode-address-street').value = phys.street || '';
                        document.getElementById('periode-address-postal').value = phys.postalCode || phys.postal_code || '';
                        document.getElementById('periode-address-city').value = phys.city || '';
                    }
                }
            } catch (_) {}
        }
    });

    document.querySelectorAll('input[name="periode-freq"]').forEach(radio =>
        radio.addEventListener('change', handlePeriodeFreqChange));

    function resetPeriodeForm() {
        periodeState.ruleId = null;
        periodeState.savedRuleId = null;
        periodeState.previewDone = false;
        periodeState.previewCount = 0;
        document.getElementById('periode-form-title').textContent = 'Ny periodeplan';
        document.getElementById('periode-customer-select').value = '';
        document.getElementById('periode-technician-select').value = '';
        document.getElementById('periode-service-type').value = 'Generell service';
        document.getElementById('periode-description').value = '';
        document.getElementById('periode-address-street').value = '';
        document.getElementById('periode-address-postal').value = '';
        document.getElementById('periode-address-city').value = '';
        document.getElementById('periode-start-date').value = '';
        document.getElementById('periode-end-date').value = '';
        document.getElementById('periode-scheduled-time').value = '';
        const weeklyRadio = document.querySelector('input[name="periode-freq"][value="weekly"]');
        if (weeklyRadio) weeklyRadio.checked = true;
        document.getElementById('periode-freq-x').value = '14';
        document.querySelectorAll('input[name="weekday"]').forEach(cb => cb.checked = false);
        handlePeriodeFreqChange();
        hidePeriodePreview();
        updatePeriodeGenerateBtn();
        loadPeriodeEquipment('');
    }

    async function initPeriodeFane() {
        populatePeriodeCustomers();
        await populatePeriodeTechnicians();
        handlePeriodeFreqChange();
        const today = new Date();
        const pad = n => String(n).padStart(2, '0');
        const startEl = document.getElementById('periode-start-date');
        if (startEl && !startEl.value) {
            startEl.value = `${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`;
        }
        await loadPeriodeRules();
    }
    // ─── END PERIODE-FANE ─────────────────────────────────────────────

    // Initialiser
    await fetchData();
    loadAllCustomersForSearch(); // Kjør parallelt med eksisterende loading
});

// ===== SERVICE-OVERSIKT MODAL =====

// State for oversikt-modal
const MONTHLY_CAPACITY = 30; // TODO: flytt til tenant-settings i iterasjon 2
const overviewState = {
    currentStartMonth: new Date(),
    orders: [],
    technicians: [],
    currentView: 'load' // 'load', 'calendar' eller 'technician'
};

// Norske månedsnavn
const monthNames = [
    'Januar', 'Februar', 'Mars', 'April', 'Mai', 'Juni',
    'Juli', 'August', 'September', 'Oktober', 'November', 'Desember'
];

// Initialiser oversikt-modal
function initOverviewModal() {
    const openBtn = document.getElementById('open-overview-btn');
    const closeBtn = document.getElementById('close-overview-btn');
    const modal = document.getElementById('overview-modal');
    const prevBtn = document.getElementById('prev-period-btn');
    const nextBtn = document.getElementById('next-period-btn');
    const calendarViewBtn = document.getElementById('btn-calendar-view');
    const technicianViewBtn = document.getElementById('btn-technician-view');

    if (!openBtn || !modal) {
        console.warn('Overview modal elements not found');
        return;
    }

    // Åpne modal
    openBtn.addEventListener('click', () => {
        openOverviewModal();
    });

    // Lukk modal
    closeBtn.addEventListener('click', () => {
        closeOverviewModal();
    });

    // Lukk ved klikk utenfor
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeOverviewModal();
        }
    });

    // Periode-navigasjon
    prevBtn.addEventListener('click', () => {
        if (overviewState.currentView === 'load') {
            const y = overviewState.currentStartMonth.getFullYear();
            overviewState.currentStartMonth = new Date(y - 1, 0, 1);
        } else {
            overviewState.currentStartMonth = new Date(overviewState.currentStartMonth);
            overviewState.currentStartMonth.setMonth(overviewState.currentStartMonth.getMonth() - 6);
        }
        loadOverviewData();
    });

    nextBtn.addEventListener('click', () => {
        if (overviewState.currentView === 'load') {
            const y = overviewState.currentStartMonth.getFullYear();
            overviewState.currentStartMonth = new Date(y + 1, 0, 1);
        } else {
            overviewState.currentStartMonth = new Date(overviewState.currentStartMonth);
            overviewState.currentStartMonth.setMonth(overviewState.currentStartMonth.getMonth() + 6);
        }
        loadOverviewData();
    });

    // Visningsbytte
    document.getElementById('btn-load-view').addEventListener('click', () => switchOverviewView('load'));
    calendarViewBtn.addEventListener('click', () => switchOverviewView('calendar'));
    technicianViewBtn.addEventListener('click', () => switchOverviewView('technician'));

    // ESC for å lukke
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('show')) {
            closeOverviewModal();
        }
    });

    console.log('✅ Service-oversikt modal initialisert');
}

// Åpne modal
function openOverviewModal() {
    const modal = document.getElementById('overview-modal');

    // Reset til nåværende måned
    overviewState.currentStartMonth = new Date();
    overviewState.currentStartMonth.setDate(1);
    overviewState.currentView = 'load';

    // Reset view buttons
    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('btn-load-view').classList.add('active');
    document.getElementById('load-grid-view').style.display = 'block';
    document.getElementById('calendar-grid-view').style.display = 'none';
    document.getElementById('technician-list-view').style.display = 'none';
    document.getElementById('technician-legend').style.display = 'none';

    modal.classList.add('show');
    document.body.style.overflow = 'hidden';

    loadOverviewData();
}

// Lukk modal
function closeOverviewModal() {
    const modal = document.getElementById('overview-modal');
    modal.classList.remove('show');
    document.body.style.overflow = '';
}

// Last data for oversikten
async function loadOverviewData() {
    try {
        // Beregn datoområde
        let dateFrom, dateTo;
        if (overviewState.currentView === 'load') {
            const year = overviewState.currentStartMonth.getFullYear();
            dateFrom = `${year}-01-01`;
            dateTo = `${year}-12-31`;
        } else {
            const startDate = new Date(overviewState.currentStartMonth);
            const endDate = new Date(startDate);
            endDate.setMonth(endDate.getMonth() + 6);
            endDate.setDate(0); // Siste dag i måneden
            dateFrom = startDate.toISOString().split('T')[0];
            dateTo = endDate.toISOString().split('T')[0];
        }

        // Hent data parallelt
        const [ordersResponse, techniciansResponse] = await Promise.all([
            fetch(`/api/admin/orders?dateFrom=${dateFrom}&dateTo=${dateTo}`, {
                credentials: 'include'
            }),
            fetch('/api/admin/technicians', {
                credentials: 'include'
            })
        ]);

        if (!ordersResponse.ok || !techniciansResponse.ok) {
            throw new Error('Kunne ikke hente data');
        }

        overviewState.orders = await ordersResponse.json();
        overviewState.technicians = await techniciansResponse.json();

        // Oppdater UI
        updatePeriodIndicator();
        updateOverviewStatistics();
        renderTechnicianLegend();
        if (overviewState.currentView === 'load') {
            document.getElementById('technician-legend').style.display = 'none';
            renderLoadView();
        } else {
            renderCurrentView();
        }

    } catch (error) {
        console.error('Feil ved lasting av oversiktsdata:', error);
        showToast('Kunne ikke laste data', 'error');
    }
}

// Oppdater periode-indikator
function updatePeriodIndicator() {
    const prevBtn = document.getElementById('prev-period-btn');
    const nextBtn = document.getElementById('next-period-btn');
    const subtitleEl = document.getElementById('period-subtitle');
    if (overviewState.currentView === 'load') {
        const year = overviewState.currentStartMonth.getFullYear();
        document.getElementById('period-title').textContent = year.toString();
        if (subtitleEl) subtitleEl.textContent = 'Hele året';
        prevBtn.textContent = `← ${year - 1}`;
        nextBtn.textContent = `${year + 1} →`;
        prevBtn.disabled = false;
        return;
    }
    const titleEl = document.getElementById('period-title');
    const startMonth = overviewState.currentStartMonth;
    const endMonth = new Date(startMonth);
    endMonth.setMonth(endMonth.getMonth() + 5);

    const startText = `${monthNames[startMonth.getMonth()]} ${startMonth.getFullYear()}`;
    const endText = `${monthNames[endMonth.getMonth()]} ${endMonth.getFullYear()}`;

    titleEl.textContent = `${startText} - ${endText}`;
    if (subtitleEl) subtitleEl.textContent = 'Viser 6 måneder';

    // Deaktiver "Forrige" hvis vi er på nåværende måned eller før
    const now = new Date();
    now.setDate(1);
    now.setHours(0,0,0,0);

    const compareDate = new Date(startMonth);
    compareDate.setHours(0,0,0,0);

    prevBtn.disabled = compareDate <= now;
}

// Oppdater statistikk
function updateOverviewStatistics() {
    const orders = overviewState.orders;

    // Tell unike kunder
    const uniqueCustomers = new Set(orders.map(o => o.customer_id)).size;

    // Tell unike teknikere med oppdrag
    const uniqueTechnicians = new Set(orders.filter(o => o.technician_id).map(o => o.technician_id)).size;

    document.getElementById('stat-total-orders').textContent = orders.length;
    document.getElementById('stat-total-customers').textContent = uniqueCustomers;
    document.getElementById('stat-total-technicians').textContent = uniqueTechnicians;
}

// Bytt visning
function switchOverviewView(view) {
    overviewState.currentView = view;

    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`btn-${view}-view`).classList.add('active');

    document.getElementById('load-grid-view').style.display = 'none';
    document.getElementById('calendar-grid-view').style.display = 'none';
    document.getElementById('technician-list-view').style.display = 'none';

    if (view === 'load') {
        document.getElementById('load-grid-view').style.display = 'block';
    } else if (view === 'calendar') {
        document.getElementById('calendar-grid-view').style.display = 'grid';
    } else if (view === 'technician') {
        document.getElementById('technician-list-view').style.display = 'flex';
    }

    loadOverviewData();
}

// Render gjeldende visning
function renderCurrentView() {
    if (overviewState.currentView === 'calendar') {
        renderCalendarView();
    } else {
        renderTechnicianView();
    }
}

// Render belastnings-visning
function renderLoadView() {
    const year = overviewState.currentStartMonth.getFullYear();
    const orders = overviewState.orders;
    const techs = overviewState.technicians;

    // Tell ordrer per måned (0 = januar)
    const counts = new Array(12).fill(0);
    orders.forEach(order => {
        if (!order.scheduled_date) return;
        const d = new Date(order.scheduled_date);
        if (d.getFullYear() === year) counts[d.getMonth()]++;
    });

    // Tell unike kunder
    const customerSet = new Set();
    orders.forEach(order => {
        if (order.customer_id) customerSet.add(order.customer_id);
    });
    const statKunder = document.getElementById('stat-kunder');
    if (statKunder) statKunder.textContent = customerSet.size;

    // Bygg månedskort
    let cardsHTML = '';
    const peakMonthData = [];

    counts.forEach((count, i) => {
        const pct = MONTHLY_CAPACITY > 0 ? Math.round((count / MONTHLY_CAPACITY) * 100) : 0;
        let cls = 'low';
        if (pct >= 95) cls = 'high';
        else if (pct >= 70) cls = 'medium';
        const isPeak = pct >= 95;
        const barWidth = Math.min(pct, 100);

        cardsHTML += `<div class="load-month-card ${cls}${isPeak ? ' peak' : ''}">
            <div class="load-month-name">${escapeHtmlOverview(monthNames[i])}</div>
            <div class="load-month-count-row">
                <span class="load-month-count">${count}</span>
                <span class="load-month-pct">${pct}%</span>
            </div>
            <div class="load-month-bar">
                <div class="load-month-bar-fill" style="width:${barWidth}%"></div>
            </div>
        </div>`;

        if (isPeak) peakMonthData.push({ name: monthNames[i], index: i, count, pct });
    });

    // Bygg peak-panel for ALLE måneder over 95%
    let peakPanelsHTML = '';
    peakMonthData.forEach(pm => {
        const pmCustomers = new Set();
        const techCounts = {};
        techs.forEach(t => { techCounts[t.id] = 0; });

        orders.forEach(order => {
            if (!order.scheduled_date) return;
            const d = new Date(order.scheduled_date);
            if (d.getFullYear() === year && d.getMonth() === pm.index) {
                if (order.customer_id) pmCustomers.add(order.customer_id);
                if (order.technician_id != null && techCounts[order.technician_id] !== undefined) {
                    techCounts[order.technician_id]++;
                }
            }
        });

        const techItems = techs
            .filter(t => techCounts[t.id] > 0)
            .sort((a, b) => techCounts[b.id] - techCounts[a.id])
            .map(t => `<div class="load-peak-tech">
                <span class="load-peak-tech-name">${escapeHtmlOverview(t.name)}</span>
                <span class="load-peak-tech-count">${techCounts[t.id]} oppdrag</span>
            </div>`).join('');

        peakPanelsHTML += `<div class="load-peak-panel">
            <h4>⚠ ${escapeHtmlOverview(pm.name)} — overbelastet (${pm.pct}%)</h4>
            <div class="load-peak-meta">${pm.count} oppdrag · ${pmCustomers.size} kunder</div>
            <div class="load-peak-grid">${techItems}</div>
        </div>`;
    });

    // Legg alt inn i containeren
    document.getElementById('load-grid-view').innerHTML = `
        <div class="load-section-header">
            <span>Belastning per måned</span>
            <div class="load-legend">
                <span class="load-legend-item low">under 70 %</span>
                <span class="load-legend-item medium">70–95 %</span>
                <span class="load-legend-item high">over 95 %</span>
            </div>
        </div>
        <div class="load-cards-grid">${cardsHTML}</div>
        ${peakPanelsHTML}
    `;

    // Oppdater snitt-utnyttelse
    const totalOrders = counts.reduce((a, b) => a + b, 0);
    const avgPct = Math.round((totalOrders / (MONTHLY_CAPACITY * 12)) * 100);
    const statEl = document.getElementById('stat-utilization');
    if (statEl) statEl.textContent = avgPct + ' %';
}

// Render kalender-visning
function renderCalendarView() {
    const container = document.getElementById('calendar-grid-view');
    const startMonth = new Date(overviewState.currentStartMonth);

    let html = '';

    for (let i = 0; i < 6; i++) {
        const currentMonth = new Date(startMonth);
        currentMonth.setMonth(currentMonth.getMonth() + i);

        const monthOrders = getOrdersForMonth(currentMonth);

        html += `
            <div class="month-card">
                <div class="month-card-header">
                    <span class="month-name">${monthNames[currentMonth.getMonth()]} ${currentMonth.getFullYear()}</span>
                    <span class="month-count">${monthOrders.length} oppdrag</span>
                </div>
                <div class="month-card-content">
                    ${monthOrders.length > 0 ? renderMonthOrders(monthOrders) : '<div class="empty-month-message">Ingen planlagte oppdrag</div>'}
                </div>
            </div>
        `;
    }

    container.innerHTML = html;
}

// Hent ordrer for en måned
function getOrdersForMonth(month) {
    return overviewState.orders.filter(order => {
        const orderDate = new Date(order.scheduled_date);
        return orderDate.getMonth() === month.getMonth() &&
               orderDate.getFullYear() === month.getFullYear();
    }).sort((a, b) => new Date(a.scheduled_date) - new Date(b.scheduled_date));
}

// Render ordrer for en måned
function renderMonthOrders(orders) {
    return orders.map(order => {
        const date = new Date(order.scheduled_date);
        const day = date.getDate();
        const techIndex = getTechnicianColorIndex(order.technician_id);
        const techInitials = getTechnicianInitials(order.technician_id);

        return `
            <div class="overview-service-item" data-order-id="${order.id}">
                <span class="service-date-badge">${day < 10 ? '0' + day : day}</span>
                <div class="service-info-block">
                    <div class="service-customer-name">${escapeHtmlOverview(order.customer_name || 'Ukjent kunde')}</div>
                    <div class="service-address-text">📍 ${escapeHtmlOverview(order.delivery_address || 'Ingen adresse')}</div>
                </div>
                <div class="tech-badge tech-color-${techIndex}" title="${getTechnicianName(order.technician_id)}">
                    ${techInitials}
                </div>
            </div>
        `;
    }).join('');
}

// Render tekniker-visning
function renderTechnicianView() {
    const container = document.getElementById('technician-list-view');

    // Grupper ordrer per tekniker
    const ordersByTechnician = {};

    overviewState.orders.forEach(order => {
        const techId = order.technician_id || 'unassigned';
        if (!ordersByTechnician[techId]) {
            ordersByTechnician[techId] = [];
        }
        ordersByTechnician[techId].push(order);
    });

    let html = '';

    // Sorter teknikere etter antall oppdrag (mest først)
    const sortedTechIds = Object.keys(ordersByTechnician).sort((a, b) => {
        return ordersByTechnician[b].length - ordersByTechnician[a].length;
    });

    sortedTechIds.forEach(techId => {
        const orders = ordersByTechnician[techId].sort((a, b) =>
            new Date(a.scheduled_date) - new Date(b.scheduled_date)
        );

        const techIndex = getTechnicianColorIndex(techId);
        const techName = techId === 'unassigned' ? 'Ikke tildelt' : getTechnicianName(techId);
        const techInitials = techId === 'unassigned' ? '?' : getTechnicianInitials(techId);

        html += `
            <div class="tech-section">
                <div class="tech-section-header">
                    <div class="tech-avatar tech-color-${techIndex}">${techInitials}</div>
                    <div class="tech-info">
                        <h4>${escapeHtmlOverview(techName)}</h4>
                        <span>Servicetekniker</span>
                    </div>
                    <span class="tech-order-count">${orders.length} oppdrag</span>
                </div>
                <div class="tech-orders-container">
                    ${orders.map(order => renderTechnicianOrderRow(order)).join('')}
                </div>
            </div>
        `;
    });

    if (html === '') {
        html = '<div class="empty-month-message">Ingen planlagte oppdrag i denne perioden</div>';
    }

    container.innerHTML = html;
}

// Render enkelt ordre-rad i tekniker-visning
function renderTechnicianOrderRow(order) {
    const date = new Date(order.scheduled_date);
    const day = date.getDate();
    const monthShort = monthNames[date.getMonth()].substring(0, 3);
    const year = date.getFullYear().toString().substring(2);

    const statusClass = order.status === 'in_progress' ? 'in-progress' : 'scheduled';
    const statusText = order.status === 'in_progress' ? 'I arbeid' : 'Planlagt';

    return `
        <div class="tech-order-row" data-order-id="${order.id}">
            <div class="order-date-box">
                <div class="day">${day < 10 ? '0' + day : day}</div>
                <div class="month-year">${monthShort} ${year}</div>
            </div>
            <div class="order-details">
                <div class="order-customer">${escapeHtmlOverview(order.customer_name || 'Ukjent kunde')}</div>
                <div class="order-address">📍 ${escapeHtmlOverview(order.delivery_address || 'Ingen adresse')}</div>
            </div>
            <span class="order-status-badge ${statusClass}">${statusText}</span>
        </div>
    `;
}

// Render tekniker-legend
function renderTechnicianLegend() {
    const container = document.getElementById('technician-legend');

    // Finn unike teknikere fra ordrer
    const techIds = [...new Set(overviewState.orders.filter(o => o.technician_id).map(o => o.technician_id))];

    const html = techIds.map(techId => {
        const techIndex = getTechnicianColorIndex(techId);
        const techName = getTechnicianName(techId);
        const techInitials = getTechnicianInitials(techId);

        return `
            <div class="legend-item">
                <div class="legend-badge tech-color-${techIndex}">${techInitials}</div>
                <span>${escapeHtmlOverview(techName)}</span>
            </div>
        `;
    }).join('');

    container.innerHTML = html || '<span style="color: var(--text-light);">Ingen teknikere tildelt</span>';
}

// Hjelpefunksjoner for teknikere
function getTechnicianColorIndex(techId) {
    if (!techId) return 0;
    const index = overviewState.technicians.findIndex(t => t.id == techId);
    return index >= 0 ? index % 8 : 0;
}

function getTechnicianName(techId) {
    const tech = overviewState.technicians.find(t => t.id == techId);
    return tech ? tech.name : 'Ukjent';
}

function getTechnicianInitials(techId) {
    const tech = overviewState.technicians.find(t => t.id == techId);
    if (tech && tech.initials) return tech.initials;

    const name = getTechnicianName(techId);
    if (name === 'Ukjent') return '?';

    const parts = name.split(' ');
    if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
}

// Escape HTML for sikkerhet (egen funksjon for å unngå navnekonflikt)
function escapeHtmlOverview(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Initialiser oversikt-modal når DOM er klar
document.addEventListener('DOMContentLoaded', () => {
    // Vent litt for å sikre at andre elementer er lastet
    setTimeout(() => {
        initOverviewModal();
    }, 100);
});
