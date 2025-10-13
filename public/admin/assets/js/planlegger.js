let allCustomersForSearch = [];
let customerSearchTimeout = null;

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
    clearTimeout(customerSearchTimeout);
    
    const query = e.target.value.trim().toLowerCase();
    
    customerSearchTimeout = setTimeout(() => {
        filterCustomerCards(query);
    }, 300);
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

    // Ny checkbox for å vise alle kunder
    const showAllCustomersCheckbox = document.getElementById('show-available-customers');
    const customerSearchInput = document.getElementById('customer-search-input');

    let draggedTechnician = null;
    let targetCustomer = null;
    let allCustomers = [];
    let availableCustomers = [];

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
            availableCustomers = allCustomers.filter(c => !activeCustomerIds.has(c.id) && !c.isInactive);

            renderTechnicians(technicians);
            renderCustomers();
            
        } catch (error) {
            console.error('Error fetching data:', error);
            showToast('Kunne ikke laste data', 'error');
        }
    }

    function renderTechnicians(technicians) {
        technicianList.innerHTML = '';
        
        if (technicians.length === 0) {
            technicianList.innerHTML = '<div class="empty-state"><p>Ingen teknikere funnet</p></div>';
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

    function renderCustomers() {
    projectList.innerHTML = '';
    
    // Velg hvilke kunder som skal vises
    const customersToShow = showAllCustomersCheckbox && showAllCustomersCheckbox.checked 
        ? allCustomers.filter(c => !c.isInactive)
        : availableCustomers;
    
    const headerText = showAllCustomersCheckbox && showAllCustomersCheckbox.checked 
        ? 'Alle Kunder' 
        : 'Kunder uten oppdrag';
    
    // Oppdater header
    const header = document.querySelector('#project-column h2');
    if (header) {
        header.innerHTML = `${headerText} <span class="order-count-badge" id="order-count">${customersToShow.length}</span>`;
    }
    
    if (customersToShow.length === 0) {
        projectList.innerHTML = '<div class="empty-state"><p>Ingen kunder funnet</p></div>';
        return;
    }
    
    customersToShow.forEach(customer => {
        console.log(`Setter dataset for ${customer.name}: ${customer.id}`);
        const customerCard = document.createElement('div');
        customerCard.className = 'modern-customer-card project-card';  // Bruker modern-customer-card class
        customerCard.dataset.customerId = customer.id;
        customerCard.dataset.customerName = customer.name;
        customerCard.draggable = true;
        
        console.log(`Dataset ble satt til: ${customerCard.dataset.customerId}`);
        
        // MODERNE TRIPLETEX-INSPIRERT DESIGN
        customerCard.innerHTML = `
    <div class="customer-card-header">
        <h3 class="customer-name">${escapeHtml(customer.name)}</h3>
        ${customer.customerNumber ? 
            `<span class="customer-number-badge">Nr. ${customer.customerNumber}</span>` : 
            ''
        }
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
        
        customerCard.addEventListener('dragover', handleDragOver);
        customerCard.addEventListener('dragleave', handleDragLeave);
        customerCard.addEventListener('drop', handleDrop);
        
        projectList.appendChild(customerCard);
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

    // Checkbox event
    if (showAllCustomersCheckbox) {
        showAllCustomersCheckbox.addEventListener('change', renderCustomers);
    }

    if (customerSearchInput) {
        customerSearchInput.addEventListener('input', handleCustomerSearchInput);
    }

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
        // FJERN parseInt() - behold customerId som string
        const customerId = customerCard.dataset.customerId;
        console.log('Leter etter customerId:', customerId);
        console.log('Type:', typeof customerId);

        if (!draggedTechnician) {
            console.error('❌ Ingen tekniker valgt!');
            return;
        }
        
        try {
            const technicianId = draggedTechnician.dataset.technicianId;
            console.log('🔍 1. technicianId:', technicianId);

            // Debug: Vis tilgjengelige kunder
            console.log('Søker i array:', showAllCustomersCheckbox?.checked ? 'allCustomers' : 'availableCustomers');
            const customersToSearch = showAllCustomersCheckbox?.checked ? allCustomers : availableCustomers;
            console.log('Array lengde:', customersToSearch.length);
            
            // Søk etter kunde - nå sammenligner vi streng med streng
            const customer = customersToSearch.find(c => {
                console.log(`Sammenligner: "${c.id}" === "${customerId}" (${c.id === customerId})`);
                return c.id === customerId; // Strengsammenligning
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
                technicianId, 
                customerId: customer.id,
                customerName: customer.name
            };
            
            console.log('✅ 5. targetCustomer satt:', targetCustomer);
            
            // OPPDATERT: Vis modal med equipment selection
            await showModalWithEquipment(customer, technician);
            
        } catch (error) {
            console.error('❌ FEIL I HANDLEDROP:', error);
            console.error('Stack trace:', error.stack);
        }
    }

    async function loadEquipmentForModal(customer) {
    try {
        const response = await fetch(`/api/admin/equipment?customerId=${customer.id}`, {
            credentials: 'include'
        });
        
        if (!response.ok) throw new Error('Kunne ikke laste anlegg');
        
        const equipment = await response.json();
        
        // Sorter etter ID (nyeste først)
        equipment.sort((a, b) => b.id - a.id);
        
        // Oppdater equipment-listen i modalen
        const equipmentList = document.querySelector('.equipment-list');
        if (equipmentList) {
            equipmentList.innerHTML = equipment.map(eq => `
                <div class="equipment-item" style="padding: 12px; border: 1px solid #e5e7eb; border-radius: 6px; margin-bottom: 8px;">
                    <label style="display: flex; align-items: start; cursor: pointer;">
                        <input type="checkbox" value="${eq.id}" class="equipment-checkbox" style="margin-right: 10px; margin-top: 3px;" checked>
                        <div>
                            <strong>${eq.systemnavn || eq.name}</strong>
                            <div style="font-size: 13px; color: #6b7280;">
                                ${eq.systemtype || eq.type} | ${eq.systemnummer || ''} | ${eq.plassering || eq.location}
                            </div>
                        </div>
                    </label>
                </div>
            `).join('');
        }
        
    } catch (error) {
        console.error('Error loading equipment:', error);
        showToast('Kunne ikke laste anlegg', 'error');
    }
}

    async function showModalWithEquipment(customer, technicianName) {
    try {
        // Definer today lokalt i funksjonen
        const today = new Date().toISOString().split('T')[0];
        
        // Bygg modal innhold med equipment selection OG description-felt
        const modalContent = document.querySelector('.modal-content');
        modalContent.innerHTML = `
            <div class="modal-header">
                <h3>Opprett serviceoppdrag</h3>
            </div>
            
            <div class="modal-body">
                <p class="modal-info-text">
                    Opprett nytt serviceoppdrag for <strong>${customer.name}</strong> 
                    med tekniker <strong>${technicianName}</strong>.
                </p>
                
                <div class="form-group">
                    <label for="modal-date">Velg dato:</label>
                    <input type="date" id="modal-date" value="${today}" min="${today}" required>
                </div>
                
                <div class="form-group">
                    <label for="modal-description">Beskrivelse:</label>
                    <input type="text" id="modal-description" value="Service hos ${customer.name}" 
                           placeholder="Skriv inn beskrivelse..." required>
                </div>
                
                <div class="equipment-selection-section">
                    <h4>Velg anlegg for service:</h4>
                    <div class="equipment-selection-help">
                        <small>Alle anlegg er valgt som standard. Fjern haken for anlegg som ikke skal inkluderes i dette oppdraget.</small>
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
            </div>
            
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" id="modal-cancel-btn">Avbryt</button>
                <button type="button" class="btn btn-primary" id="modal-save-btn">Opprett oppdrag</button>
            </div>
        `;

        // Last anlegg inn i den nye strukturen
        await loadEquipmentForModal(customer);
        
        // Vis modal
        dateModal.style.display = 'flex';
        dateModal.classList.add('show');
        
        // Re-attach event listeners til nye buttons
        document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);
        document.getElementById('modal-save-btn').addEventListener('click', saveOrderWithEquipment);
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
        
    } catch (error) {
        console.error('Error loading equipment:', error);
        // Vis standard modal hvis equipment loading feiler
        showStandardModal(customer, technicianName);
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
        
        equipmentModal.addEventListener('click', (e) => {
            if (e.target === equipmentModal) {
                document.body.removeChild(equipmentModal);
            }
        });
        
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
        <div class="modal-content" style="background: white; padding: 20px; border-radius: 8px; max-width: 500px; width: 90%;">
            <div class="modal-header">
                <h3>Legg til ${typeName}</h3>
                <button type="button" class="close-btn" style="float: right; background: none; border: none; font-size: 24px; cursor: pointer;">&times;</button>
            </div>
            
            <form id="equipment-form">
                <div class="modal-body">
                    ${formFields}
                </div>
                
                <div class="modal-footer" style="margin-top: 20px; display: flex; gap: 10px; justify-content: flex-end;">
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
    
    formModal.addEventListener('click', (e) => {
        if (e.target === formModal) {
            document.body.removeChild(formModal);
        }
    });
    
    // Form submit - inne i showAddEquipmentForm funksjonen
    formModal.querySelector('#equipment-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const equipmentData = {
            customerId: customer.id,
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

    // Oppdater også closeModal funksjonen hvis den ikke allerede finnes
    function closeModal() {
        const dateModal = document.getElementById('date-modal');
        dateModal.classList.remove('show');
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
    
    if (!scheduledDate) {
        showToast('Vennligst velg en dato', 'error');
        return;
    }
    
    if (!description) {
        showToast('Vennligst skriv inn en beskrivelse', 'error');
        return;
    }
    
    try {
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
                phone: targetCustomer.phone || null
            }        };
        
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

    // Modal håndtering
    modalCancelBtn.addEventListener('click', () => {
        closeModal();
    });

    function closeModal() {
        dateModal.style.display = 'none';
        dateModal.classList.remove('show');
        targetCustomer = null;
    }

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

    // Initialiser
    await fetchData();
    loadAllCustomersForSearch(); // Kjør parallelt med eksisterende loading
});