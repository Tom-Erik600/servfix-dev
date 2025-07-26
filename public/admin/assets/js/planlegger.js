// air-tech-adminweb/assets/js/planlegger.js - Enkel løsning som opprinnelig

document.addEventListener('DOMContentLoaded', async () => {
    const technicianList = document.getElementById('technician-list');
    const projectList = document.getElementById('project-list');
    const dateModal = document.getElementById('date-modal');
    const modalInfoText = document.getElementById('modal-info-text');
    const modalDateInput = document.getElementById('modal-date');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');
    const modalSaveBtn = document.getElementById('modal-save-btn');

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
            const [technicians, customers, activeOrders] = await Promise.all([
                fetch('/api/technicians').then(res => res.json()),
                fetch('/api/customers').then(res => res.json()),
                fetch('/api/orders?status=pending,scheduled,in_progress').then(res => res.json()),
            ]);

            allCustomers = customers;
            
            // Finn kunder uten aktive oppdrag
            const activeCustomerIds = new Set(activeOrders.map(o => o.customerId));
            availableCustomers = customers.filter(c => !activeCustomerIds.has(c.id) && !c.isInactive);

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
            const customerCard = document.createElement('div');
            customerCard.className = 'project-card';  // Gjenbruk samme styling
            customerCard.dataset.customerId = customer.id;
            
            customerCard.innerHTML = `
                <div class="project-customer">${customer.name}</div>
                <div class="project-name">${customer.contact} • ${customer.phone}</div>
                <div class="project-meta">
                    <span>Kunde-ID: ${customer.customerNumber}</span>
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
        
        if (!draggedTechnician) return;

        const technicianId = e.dataTransfer.getData('text/plain');
        const customerId = e.currentTarget.dataset.customerId;

        // Finn kunde og tekniker
        const customer = allCustomers.find(c => c.id === customerId);
        const technician = draggedTechnician.querySelector('strong').textContent;

        targetCustomer = { technicianId, customerId, customerName: customer.name };

        modalInfoText.textContent = `Opprett nytt serviceoppdrag for ${customer.name} med tekniker ${technician}.`;
        dateModal.style.display = 'flex';
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
            const response = await fetch('/api/orders', {
                method: 'POST',
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