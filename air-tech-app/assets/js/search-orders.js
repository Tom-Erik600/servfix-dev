document.addEventListener('DOMContentLoaded', () => {
    // --- STATE MANAGEMENT ---
    const state = {
        orders: [],
        technicians: new Map(),
        customers: new Map(),
        currentTechnicianId: localStorage.getItem('technicianId'),
        filters: {
            technician: 'all',
            status: 'all',
            searchTerm: ''
        }
    };

    // --- DOM ELEMENTS ---
    const technicianFilter = document.getElementById('technician-filter');
    const statusFilter = document.getElementById('status-filter');
    const searchInput = document.getElementById('search-input');
    const orderListContainer = document.getElementById('order-list-container');
    const loadingIndicator = document.getElementById('loading-indicator');
    const modal = document.getElementById('order-details-modal');
    const modalCloseBtn = document.getElementById('modal-close-btn');
    const modalBody = document.getElementById('modal-body');

    // --- UTILITY FUNCTIONS ---
    const showLoading = (show) => {
        loadingIndicator.style.display = show ? 'flex' : 'none';
    };

    const showToast = (message, type = 'success') => {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    };

    // --- API CALLS ---
    const fetchData = async (url) => {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error(`Failed to fetch from ${url}:`, error);
            showToast('Feil ved lasting av data.', 'error');
            return [];
        }
    };

    const loadInitialData = async () => {
        showLoading(true);
        try {
            const [orders, technicians, customers] = await Promise.all([
                fetchData('/api/orders'),
                fetchData('/api/technicians'),
                fetchData('/api/customers')
            ]);

            state.orders = orders;
            technicians.forEach(t => state.technicians.set(t.id, t));
            customers.forEach(c => state.customers.set(c.id, c));

            console.log('Customers loaded:', state.customers);

            populateTechnicianFilter();
            renderOrders();
        } catch (error) {
            console.error("Error during initial data load:", error);
            showToast('En feil oppstod under lasting av data.', 'error');
        } finally {
            showLoading(false);
        }
    };

    // --- RENDERING ---
    const populateTechnicianFilter = () => {
        const unassignedOption = document.createElement('option');
        unassignedOption.value = 'unassigned';
        unassignedOption.textContent = 'Ikke tildelt';
        technicianFilter.appendChild(unassignedOption);

        state.technicians.forEach(tech => {
            const option = document.createElement('option');
            option.value = tech.id;
            option.textContent = tech.name;
            technicianFilter.appendChild(option);
        });
    };

    const renderOrders = () => {
        orderListContainer.innerHTML = '';
        const filteredOrders = getFilteredOrders();

        if (filteredOrders.length === 0) {
            orderListContainer.innerHTML = `<div class="placeholder-text">Ingen ordre matchet filtrene.</div>`;
            return;
        }

        filteredOrders.forEach(order => {
            const card = createOrderCard(order);
            orderListContainer.appendChild(card);
        });
        lucide.createIcons();
    };

    const createOrderCard = (order) => {
        const customer = state.customers.get(order.customerId);
        const technician = order.technicianId ? state.technicians.get(order.technicianId) : null;
        const status = deriveOrderStatus(order);

        const card = document.createElement('div');
        card.className = `order-search-card status-${status}`;
        card.dataset.orderId = order.id;

        const isOwnOrder = order.technicianId === state.currentTechnicianId;

        card.innerHTML = `
            <div class="card-main-info">
                <div class="status-indicator"></div>
                <div class="order-summary">
                    <h3 class="customer-name">${customer ? customer.name : 'Ukjent kunde'}</h3>
                    <p class="order-description">#${order.id} - ${order.type || 'Service'}</p>
                    <p class="customer-address">${customer?.address?.street || ''}</p>
                </div>
                <div class="order-meta">
                     <span class="technician-name">Tildelt: ${technician ? technician.name : 'Ingen'}</span>
                     <span class="order-date">Planlagt: ${new Date(order.plannedDate).toLocaleDateString('no-NO')}</span>
                </div>
            </div>
            <div class="card-actions">
                <button class="details-btn">Detaljer</button>
                ${!isOwnOrder ? `<button class="take-over-btn">Ta over</button>` : ''}
            </div>
        `;

        card.querySelector('.details-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            showOrderDetails(order.id);
        });

        if (!isOwnOrder) {
            card.querySelector('.take-over-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                takeOverOrder(order.id);
            });
        }

        return card;
    };

    const deriveOrderStatus = (order) => {
        if (order.status === 'completed') return 'completed';
        if (order.status === 'in_progress' || (order.serviceReport && order.serviceReport.signature)) return 'in_progress';
        if (order.technicianId) return 'scheduled';
        return 'pending';
    };

    // --- FILTERING LOGIC ---
    const getFilteredOrders = () => {
        const { technician, status, searchTerm } = state.filters;
        const lowerCaseSearchTerm = searchTerm.toLowerCase();

        return state.orders.filter(order => {
            const customer = state.customers.get(order.customerId);
            const orderStatus = deriveOrderStatus(order);

            const matchesTechnician = technician === 'all' || 
                                      (technician === 'unassigned' && !order.technicianId) || 
                                      order.technicianId === technician;

            const matchesStatus = status === 'all' || orderStatus === status;

            const matchesSearch = !lowerCaseSearchTerm ||
                                  (customer && customer.name.toLowerCase().includes(lowerCaseSearchTerm)) ||
                                  (customer?.address?.street?.toLowerCase().includes(lowerCaseSearchTerm)) ||
                                  order.id.toString().includes(lowerCaseSearchTerm) ||
                                  (order.type && order.type.toLowerCase().includes(lowerCaseSearchTerm));

            return matchesTechnician && matchesStatus && matchesSearch;
        });
    };

    // --- ACTIONS & EVENT HANDLERS ---
    const takeOverOrder = async (orderId) => {
        if (!confirm('Er du sikker på at du vil overta denne ordren?')) return;

        showLoading(true);
        try {
            const response = await fetch(`/api/orders/${orderId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ technicianId: state.currentTechnicianId })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Ukjent feil');
            }

            showToast('Ordre overtatt!', 'success');
            await loadInitialData(); // Reload all data to reflect change
        } catch (error) {
            console.error('Failed to take over order:', error);
            showToast(`Kunne ikke overta ordre: ${error.message}`, 'error');
        } finally {
            showLoading(false);
        }
    };

    const showOrderDetails = (orderId) => {
        const order = state.orders.find(o => o.id === orderId);
        if (!order) return;

        const customer = state.customers.get(order.customerId);
        const technician = order.technicianId ? state.technicians.get(order.technicianId) : null;

        modalBody.innerHTML = `
            <p><strong>Ordre ID:</strong> ${order.id}</p>
            <p><strong>Kunde:</strong> ${customer ? customer.name : 'N/A'}</p>
            <p><strong>Adresse:</strong> ${customer?.address ? `${customer.address.street}, ${customer.address.postalCode} ${customer.address.city}` : 'N/A'}</p>
            <p><strong>Telefon:</strong> ${customer ? customer.phone : 'N/A'}</p>
            <hr>
            <p><strong>Ordretype:</strong> ${order.type || 'Service'}</p>
            <p><strong>Planlagt dato:</strong> ${new Date(order.plannedDate).toLocaleString('no-NO')}</p>
            <p><strong>Status:</strong> ${deriveOrderStatus(order)}</p>
            <p><strong>Nåværende tekniker:</strong> ${technician ? technician.name : 'Ikke tildelt'}</p>
            <hr>
            <p><strong>Beskrivelse:</strong></p>
            <p>${order.description || 'Ingen beskrivelse.'}</p>
        `;
        modal.style.display = 'flex';
    };

    const handleFilterChange = () => {
        state.filters.technician = technicianFilter.value;
        state.filters.status = statusFilter.value;
        state.filters.searchTerm = searchInput.value;
        renderOrders();
    };

    // --- INITIALIZATION ---
    technicianFilter.addEventListener('change', handleFilterChange);
    statusFilter.addEventListener('change', handleFilterChange);
    searchInput.addEventListener('input', handleFilterChange);
    modalCloseBtn.addEventListener('click', () => modal.style.display = 'none');
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });

    loadInitialData();
});
