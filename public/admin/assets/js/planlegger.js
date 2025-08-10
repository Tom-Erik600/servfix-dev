// air-tech-adminweb/assets/js/planlegger.js - Med equipment selection

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
            header.innerHTML = `${headerText} <span class="order-count-badge">${customersToShow.length}</span>`;
        }
        
        if (customersToShow.length === 0) {
            projectList.innerHTML = '<div class="empty-state"><p>Ingen kunder funnet</p></div>';
            return;
        }
        
        customersToShow.forEach(customer => {
            console.log(`Setter dataset for ${customer.name}: ${customer.id}`);
            const customerCard = document.createElement('div');
            customerCard.className = 'project-card';
            customerCard.dataset.customerId = customer.id;
            
            console.log(`Dataset ble satt til: ${customerCard.dataset.customerId}`);
            
            customerCard.innerHTML = `
                <div class="project-customer">${customer.name}</div>
                <div class="project-name">${customer.contact} • ${customer.phone}</div>
                <div class="project-meta">
                    <span>Tripletex ID: ${customer.id} | Nr: ${customer.customerNumber || '-'}</span>
                </div>
            `;
            
            customerCard.addEventListener('dragover', handleDragOver);
            customerCard.addEventListener('dragleave', handleDragLeave);
            customerCard.addEventListener('drop', handleDrop);
            
            projectList.appendChild(customerCard);
        });
    }

    // Checkbox event
    if (showAllCustomersCheckbox) {
        showAllCustomersCheckbox.addEventListener('change', renderCustomers);
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

    // NY FUNKSJON: Vis modal med equipment selection
    // Oppdater showModalWithEquipment for korrekt customerId håndtering

    // Oppdatert showModalWithEquipment funksjon for planlegger.js
    // Oppdatert showModalWithEquipment med today variabel fix
    async function showModalWithEquipment(customer, technicianName) {
        try {
            // Definer today lokalt i funksjonen
            const today = new Date().toISOString().split('T')[0];
            
            // VIKTIG: Behold customerId som string (konverteres til integer i backend)
            const customerId = customer.id;
            console.log('Henter anlegg for customerId:', customerId, 'type:', typeof customerId);
            
            // Hent anlegg for kunden
            const response = await fetch(`/api/admin/equipment?customerId=${customerId}`, {
                credentials: 'include'
            });
            
            let equipment = [];
            if (response.ok) {
                equipment = await response.json();
                console.log('Equipment hentet:', equipment);
            } else {
                console.error('Kunne ikke hente equipment:', response.status, response.statusText);
            }
            
            // Bygg modal innhold med equipment selection
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
                    
                    ${equipment.length > 0 ? `
                        <div class="equipment-selection-section">
                            <h4>Velg anlegg for service:</h4>
                            <div class="equipment-selection-help">
                                <small>Alle anlegg er valgt som standard. Fjern haken for anlegg som ikke skal inkluderes i dette oppdraget.</small>
                            </div>
                            <div class="equipment-selection-list">
                                ${equipment.map(eq => `
                                    <label class="equipment-selection-item">
                                        <input type="checkbox" 
                                            class="equipment-checkbox" 
                                            value="${eq.id}" 
                                            checked>
                                        <div class="equipment-info">
                                            <span class="equipment-name">${eq.name || 'Uten navn'}</span>
                                            <span class="equipment-type">${eq.type || 'Ukjent type'}</span>
                                            ${eq.location ? `<span class="equipment-location">📍 ${eq.location}</span>` : ''}
                                        </div>
                                    </label>
                                `).join('')}
                            </div>
                        </div>
                    ` : '<p class="no-equipment-message">Ingen anlegg funnet for denne kunden</p>'}
                </div>
                
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" id="modal-cancel-btn">Avbryt</button>
                    <button type="button" class="btn btn-primary" id="modal-save-btn">Opprett oppdrag</button>
                </div>
            `;
            
            // Vis modal
            dateModal.style.display = 'flex';
            dateModal.classList.add('show');
            
            // Re-attach event listeners til nye buttons
            document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);
            document.getElementById('modal-save-btn').addEventListener('click', saveOrderWithEquipment);
            
        } catch (error) {
            console.error('Error loading equipment:', error);
            // Vis standard modal hvis equipment loading feiler
            showStandardModal(customer, technicianName);
        }
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

    // Oppdatert saveOrderWithEquipment funksjon i planlegger.js
    async function saveOrderWithEquipment() {
        console.log('Lagrer ordre med equipment selection...');
        
        const scheduledDate = document.getElementById('modal-date').value;
        
        if (!targetCustomer || !scheduledDate) {
            alert('Vennligst fyll ut alle felt');
            return;
        }
        
        // Lagre kundenavn før vi nullstiller targetCustomer
        const customerName = targetCustomer.customerName;
        
        // Hent valgte anlegg
        const selectedEquipment = [];
        const checkboxes = document.querySelectorAll('.equipment-checkbox:checked');
        checkboxes.forEach(checkbox => {
            selectedEquipment.push(checkbox.value);
        });
        
        console.log('Valgte anlegg:', selectedEquipment);
        
        try {
            // Find full customer data
            const customer = allCustomers.find(c => c.id === targetCustomer.customerId);
            
            if (!customer) {
                throw new Error('Kunne ikke finne kundedata');
            }
            
            // Lag customer_data snapshot
            const customerData = {
                id: customer.id,
                name: customer.name,
                customerNumber: customer.customerNumber,
                organizationNumber: customer.organizationNumber,
                contact: customer.contact || '',
                email: customer.email || '',
                phone: customer.phone || '',
                physicalAddress: customer.physicalAddress || '',
                postalAddress: customer.postalAddress || '',
                invoiceEmail: customer.invoiceEmail || ''
            };
            
            // Opprett ordre MED valgte anlegg
            const orderData = {
                customerId: targetCustomer.customerId,
                customerName: targetCustomer.customerName,
                customerData: customerData,
                description: 'Service',
                serviceType: 'Generell service',
                technicianId: targetCustomer.technicianId,
                scheduledDate: scheduledDate
            };
            
            // Legg til includedEquipmentIds BARE hvis det er valgte anlegg
            if (selectedEquipment.length > 0) {
                orderData.includedEquipmentIds = selectedEquipment;
            }
            
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
});