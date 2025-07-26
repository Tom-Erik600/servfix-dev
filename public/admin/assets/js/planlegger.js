// air-tech-adminweb/assets/js/planlegger.js - Enkel løsning som opprinnelig

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
                    credentials: 'include'  // Inkluder cookies/session
                }).then(res => res.json()),
                fetch('/api/admin/customers', {
                    credentials: 'include'  // Inkluder cookies/session
                }).then(res => res.json()),
                fetch('/api/admin/orders?status=pending,scheduled,in_progress', {
                    credentials: 'include'  // Inkluder cookies/session
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
            console.log('allCustomers:', allCustomers); // Added this line
            
            // Finn kunder uten aktive oppdrag
            const activeCustomerIds = new Set(activeOrders.map(o => o.customerId));
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
            ? allCustomers.filter(c => !c.isInactive)  // Alle aktive kunder
            : availableCustomers;  // Kun kunder uten oppdrag
        
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
            // Debug: Logg hva vi setter
            console.log(`Setter dataset for ${customer.name}: ${customer.id}`);
            const customerCard = document.createElement('div');
            customerCard.className = 'project-card';
            customerCard.dataset.customerId = customer.id;
            
            // Debug: Sjekk hva som faktisk ble satt
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

    function handleDrop(e) {
        e.preventDefault();
        e.currentTarget.classList.remove('drag-over');
        
        try {
            if (!draggedTechnician) {
                console.error('draggedTechnician er null');
                return;
            }

            const technicianId = e.dataTransfer.getData('text/plain');
            const customerId = parseInt(e.currentTarget.dataset.customerId, 10); // Konverter til tall

            console.log('=== HANDLE DROP DEBUG ===');
            console.log('Leter etter customerId:', customerId);
            console.log('Type:', typeof customerId);
            
            // Bruk samme array som renderCustomers bruker
            const showAllCustomersCheckbox = document.getElementById('show-available-customers');
            const customersToSearch = showAllCustomersCheckbox && showAllCustomersCheckbox.checked 
                ? allCustomers.filter(c => !c.isInactive)
                : availableCustomers;
            
            console.log('Søker i array:', showAllCustomersCheckbox.checked ? 'allCustomers' : 'availableCustomers');
            console.log('Array lengde:', customersToSearch.length);
            
            // Sjekk om customersToSearch faktisk har data
            if (!customersToSearch || customersToSearch.length === 0) {
                console.error('customersToSearch er tom eller undefined!');
                showToast('Kundedata ikke lastet. Prøv å laste siden på nytt.', 'error');
                return;
            }

            // Finn kunde
            const customer = customersToSearch.find(c => c.id == customerId);
            
            if (!customer) {
                console.error('Kunde ikke funnet med ID:', customerId);
                showToast('Kunne ikke finne kunde', 'error');
                return;
            }
            
            console.log('✅ 1. Kunde funnet:', customer.name);
            
            // Test om draggedTechnician har querySelector
            console.log('🔍 2. draggedTechnician:', draggedTechnician);
            console.log('draggedTechnician type:', typeof draggedTechnician);
            
            if (!draggedTechnician) {
                console.error('❌ draggedTechnician er null!');
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
            console.log('modalInfoText:', modalInfoText);
            console.log('dateModal:', dateModal);
            
            modalInfoText.textContent = `Opprett nytt serviceoppdrag for ${customer.name} med tekniker ${technician}.`;
            dateModal.style.display = 'flex';
            dateModal.classList.add('show'); // Legg til show-klassen
            
            console.log('✅ 9. display satt til flex');
            console.log('🔍 10. Modal synlig?', dateModal.offsetParent !== null);
            
        } catch (error) {
            console.error('❌ FEIL I HANDLEDROP:', error);
            console.error('Stack trace:', error.stack);
        }
    }

    // Modal håndtering
    modalCancelBtn.addEventListener('click', () => {
        closeModal();
    });

    modalSaveBtn.addEventListener('click', async () => {
        const scheduledDate = modalDateInput.value;
        if (!scheduledDate) {
            showToast('Vennligst velg en dato', 'error');
            return;
        }

        modalSaveBtn.disabled = true;
        modalSaveBtn.textContent = 'Oppretter...';

        try {
            // Opprett nytt oppdrag
            const response = await fetch('/api/admin/orders', {
                method: 'POST',
                credentials: 'include',  // Legg til denne linjen
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    customerId: targetCustomer.customerId,
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
                await fetchData(); // Oppdater visning
            } else {
                const error = await response.json();
                throw new Error(error.error || 'Kunne ikke opprette oppdrag');
            }
        } catch (error) {
            console.error('Error creating order:', error);
            showToast(error.message, 'error');
        } finally {
            modalSaveBtn.disabled = false;
            modalSaveBtn.textContent = 'Lagre Oppdrag';
        }
    });

    function closeModal() {
        dateModal.style.display = 'none';
        dateModal.classList.remove('show'); // Fjern show-klassen
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