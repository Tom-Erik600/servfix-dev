
document.addEventListener('DOMContentLoaded', async () => {
    const technicianList = document.getElementById('technician-list');
    const projectList = document.getElementById('project-list');
    const dateModal = document.getElementById('date-modal');
    const modalInfoText = document.getElementById('modal-info-text');
    const modalDateInput = document.getElementById('modal-date');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');
    const modalSaveBtn = document.getElementById('modal-save-btn');

    let draggedTechnician = null;
    let targetOrder = null;

    async function fetchData() {
        try {
            const [technicians, customers, orders] = await Promise.all([
                fetch('/api/technicians').then(res => res.json()),
                fetch('/api/customers').then(res => res.json()),
                fetch('/api/orders').then(res => res.json()),
            ]);

            renderTechnicians(technicians);
            renderUnscheduledOrders(orders, customers);
        } catch (error) {
            console.error('Error fetching data:', error);
        }
    }

    function renderTechnicians(technicians) {
        technicianList.innerHTML = '';
        technicians.forEach(tech => {
            const techCard = document.createElement('div');
            techCard.className = 'technician-card';
            techCard.draggable = true;
            techCard.dataset.technicianId = tech.id;
            techCard.innerHTML = `<strong>${tech.name}</strong> (${tech.initials})`;
            techCard.addEventListener('dragstart', handleDragStart);
            technicianList.appendChild(techCard);
        });
    }

    function renderUnscheduledOrders(orders, customers) {
        projectList.innerHTML = '';
        const unscheduledOrders = orders.filter(order => !order.technicianId);

        unscheduledOrders.forEach(order => {
            const customer = customers.find(c => c.id === order.customerId);
            const orderCard = document.createElement('div');
            orderCard.className = 'project-card';
            orderCard.dataset.orderId = order.id;
            orderCard.innerHTML = `
                <div class="project-customer">${customer ? customer.name : 'Ukjent Kunde'}</div>
                <div class="project-name">${order.description || 'Ingen beskrivelse'}</div>
            `;
            orderCard.addEventListener('dragover', handleDragOver);
            orderCard.addEventListener('dragleave', handleDragLeave);
            orderCard.addEventListener('drop', handleDrop);
            projectList.appendChild(orderCard);
        });
    }

    function handleDragStart(e) {
        draggedTechnician = e.target;
        e.dataTransfer.setData('text/plain', e.target.dataset.technicianId);
        e.target.classList.add('dragging');
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
        draggedTechnician.classList.remove('dragging');

        const technicianId = e.dataTransfer.getData('text/plain');
        const orderId = e.currentTarget.dataset.orderId;

        targetOrder = { technicianId, orderId };

        const technicianName = draggedTechnician.textContent;
        const customerName = e.currentTarget.querySelector('.project-customer').textContent;

        modalInfoText.textContent = `Planlegg oppdrag for ${customerName} med tekniker ${technicianName}.`;
        dateModal.style.display = 'flex';
    }

    modalCancelBtn.addEventListener('click', () => {
        dateModal.style.display = 'none';
    });

    modalSaveBtn.addEventListener('click', async () => {
        const scheduledDate = modalDateInput.value;
        if (!scheduledDate) {
            alert('Vennligst velg en dato.');
            return;
        }

        try {
            const response = await fetch(`/api/orders/${targetOrder.orderId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    technicianId: targetOrder.technicianId,
                    scheduledDate: scheduledDate,
                    status: 'scheduled',
                }),
            });

            if (response.ok) {
                dateModal.style.display = 'none';
                showToast('Oppdrag planlagt!');
                fetchData(); // Refresh data
            } else {
                const errorData = await response.json();
                console.error('Error updating order:', errorData);
                alert('Kunne ikke lagre oppdraget.');
            }
        } catch (error) {
            console.error('Error saving order:', error);
            alert('En feil oppstod under lagring.');
        }
    });

    function showToast(message) {
        const toast = document.createElement('div');
        toast.className = 'toast show';
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.remove();
        }, 3000);
    }

    fetchData();
});
