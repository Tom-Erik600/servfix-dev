document.addEventListener('DOMContentLoaded', () => {
    // --- STATE MANAGEMENT ---
    const state = {
        orders: [],
        technicians: new Map(),
        customers: new Map(),
        currentTechnicianId: null,
        currentTechnicianName: null,
        filters: {
            technician: 'all_except_own',
            status: 'active',
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
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 9999;
                display: flex;
                flex-direction: column;
                gap: 8px;
            `;
            document.body.appendChild(container);
        }
        
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        toast.style.cssText = `
            padding: 12px 16px;
            border-radius: 6px;
            color: white;
            font-weight: 500;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            animation: slideIn 0.3s ease;
            background: ${type === 'error' ? '#ef4444' : type === 'warning' ? '#f59e0b' : '#10b981'};
        `;
        
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    };

    // --- API CALLS ---
    const fetchData = async (url, throwOnError = false) => {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                const error = new Error(`HTTP error! status: ${response.status}`);
                error.status = response.status;
                throw error;
            }
            return await response.json();
        } catch (error) {
            if (error.status === 401 && url.includes('/admin/')) {
                console.log(`🔒 Admin endpoint unauthorized (expected): ${url}`);
            } else {
                console.error(`Failed to fetch from ${url}:`, error);
            }
            
            if (throwOnError) {
                throw error;
            } else {
                showToast('Feil ved lasting av data.', 'error');
                return [];
            }
        }
    };

    const getCurrentTechnician = async () => {
        try {
            const response = await fetch('/api/auth/me');
            if (!response.ok) {
                throw new Error('Not authenticated');
            }
            const data = await response.json();
            return data.technician;
        } catch (error) {
            console.error('Failed to get current technician:', error);
            window.location.href = 'login.html';
            return null;
        }
    };

    const loadInitialData = async () => {
        showLoading(true);
        try {
            const currentTechnician = await getCurrentTechnician();
            if (!currentTechnician) return;

            state.currentTechnicianId = currentTechnician.id;
            state.currentTechnicianName = currentTechnician.name;

            let orders = [];
            
            try {
                console.log('🔍 Henter alle ordre for søk...');
                orders = await fetchData('/api/orders/all', true);
                console.log('✅ Alle ordre hentet successfully');
            } catch (error) {
                console.log('❌ Orders/all endpoint feilet:', error);
                orders = [];
                showToast('Kunne ikke laste ordre. Sjekk tilkobling.', 'error');
            }

            const [technicians, customers] = await Promise.all([
                fetchData('/api/technicians'),
                fetchData('/api/customers')
            ]);

            state.orders = orders;
            console.log('📋 Orders loaded:', orders.length);
            
            technicians.forEach(t => state.technicians.set(t.id, t));
            customers.forEach(c => {
                state.customers.set(String(c.id), c);
            });

            renderHeader();
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
    const renderHeader = () => {
        const header = document.getElementById('app-header');
        const today = new Date();
        const dateString = `${today.getDate()}. ${['Jan', 'Feb', 'Mar', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Des'][today.getMonth()]}. ${today.getFullYear()}`;
        
        // SAMME STRUKTUR SOM orders.js og service.js
        header.innerHTML = `
            <a href="home.html" class="header-nav-button" title="Tilbake">‹</a>
            <div class="header-main-content">
                <div class="logo-circle">
                    <svg width="24" height="24" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="16" cy="16" r="14" stroke="white" stroke-width="2" fill="none"/>
                        <circle cx="16" cy="16" r="8" stroke="white" stroke-width="2" fill="none"/>
                        <circle cx="16" cy="16" r="3" fill="white"/>
                        <path d="M16 2 L16 8" stroke="white" stroke-width="2"/>
                        <path d="M16 24 L16 30" stroke="white" stroke-width="2"/>
                        <path d="M30 16 L24 16" stroke="white" stroke-width="2"/>
                        <path d="M8 16 L2 16" stroke="white" stroke-width="2"/>
                    </svg>
                </div>
                <div class="company-info">
                    <h1>AIR-TECH AS</h1>
                    <span class="app-subtitle">Tekniker Portal</span>
                </div>
            </div>
            <div class="header-user-info">
                ${state.currentTechnicianName ? `<div class="technician-avatar">${state.currentTechnicianName.split(' ').map(n => n[0]).join('')}</div>` : ''}
                <span>${dateString}</span>
            </div>
        `;
    };

    const populateTechnicianFilter = () => {
        technicianFilter.innerHTML = '';

        const allExceptOwnOption = document.createElement('option');
        allExceptOwnOption.value = 'all_except_own';
        allExceptOwnOption.textContent = `Alle teknikere minus ${state.currentTechnicianName}`;
        allExceptOwnOption.selected = true;
        technicianFilter.appendChild(allExceptOwnOption);

        const allOption = document.createElement('option');
        allOption.value = 'all';
        allOption.textContent = 'Alle teknikere';
        technicianFilter.appendChild(allOption);

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
            orderListContainer.innerHTML = `
            <div style="text-align: center; padding: 60px 20px; background: white; border-radius: 12px; border: 2px dashed #e5e7eb; margin: 20px 0;">
                <div style="font-size: 48px; margin-bottom: 16px; opacity: 0.3;">🔍</div>
                <h3 style="font-size: 18px; font-weight: 600; color: #374151; margin: 0 0 8px 0;">Ingen ordre funnet</h3>
                <p style="color: #6b7280; font-size: 14px; margin: 0;">Ingen ordre matchet de valgte filtrene. Prøv å endre søkekriteriene.</p>
            </div>
        `;
            return;
        }

        filteredOrders.forEach(order => {
            const card = createOrderCard(order);
            orderListContainer.appendChild(card);
        });
    };

    const createOrderCard = (order) => {
        const technicianId = order.technicianId || order.technician_id;
        const customerId = order.customerId || order.customer_id;
        
        const customer = state.customers.get(String(customerId));
        const technician = technicianId ? state.technicians.get(technicianId) : null;
        const status = deriveOrderStatus(order);

        const card = document.createElement('div');
        card.className = `order-search-card status-${status}`;
        card.dataset.orderId = order.id;

        const isOwnOrder = technicianId === state.currentTechnicianId;

        // Hent adresse fra order.customer_data
        const address = order.customer_data?.physicalAddress || 
                       customer?.physicalAddress || 
                       '';

        card.innerHTML = `
            <div class="card-main-info">
                <div class="order-summary">
                    <h3 class="customer-name">${customer ? customer.name : 'Ukjent kunde'}</h3>
                    <p class="order-description">#${order.id.slice(-6)} - ${order.type || order.service_type || 'Service'}</p>
                    ${address ? `<p class="customer-address" style="font-size: 13px; color: #9ca3af; margin: 4px 0 0 0;">📍 ${address}</p>` : ''}
                </div>
                <div class="order-meta">
                    <span class="technician-name">Tildelt: ${technician ? technician.name : 'Ingen'}</span>
                    <span class="order-date">Planlagt: ${new Date(order.plannedDate || order.scheduled_date).toLocaleDateString('no-NO')}</span>
                </div>
            </div>
            <div class="card-actions">
                <button class="details-btn">Detaljer</button>
                ${!isOwnOrder ? `<button class="take-over-btn">Ta over</button>` : ''}
            </div>
        `;

        // Event listeners
        card.querySelector('.details-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            showOrderDetails(order.id);
        });

        const takeOverBtn = card.querySelector('.take-over-btn');
        if (takeOverBtn) {
            takeOverBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                takeOverOrder(order.id);
            });
        }

        return card;
    };

    const deriveOrderStatus = (order) => {
        if (order.status === 'completed') return 'completed';
        if (order.status === 'in_progress') return 'in_progress';
        if (order.technicianId || order.technician_id) return 'scheduled';
        return 'pending';
    };

    // --- FILTERING LOGIC ---
    const getFilteredOrders = () => {
        const { technician, status, searchTerm } = state.filters;
        const lowerCaseSearchTerm = searchTerm.toLowerCase();

        return state.orders.filter(order => {
            const customerId = order.customerId || order.customer_id;
            const technicianId = order.technicianId || order.technician_id;
            
            const customer = state.customers.get(String(customerId));
            const orderStatus = deriveOrderStatus(order);

            if (orderStatus === 'completed') {
                return false;
            }

            // Tekniker-filter
            let matchesTechnician = false;
            if (technician === 'all') {
                matchesTechnician = true;
            } else if (technician === 'all_except_own') {
                matchesTechnician = technicianId !== state.currentTechnicianId;
            } else {
                matchesTechnician = technicianId === technician;
            }

            // Status-filter
            let matchesStatus = false;
            if (status === 'all' || status === 'active') {
                matchesStatus = true;
            } else {
                matchesStatus = orderStatus === status;
            }

            // Søk-filter
            const matchesSearch = !lowerCaseSearchTerm ||
                                  (customer && customer.name.toLowerCase().includes(lowerCaseSearchTerm)) ||
                                  order.id.toString().includes(lowerCaseSearchTerm) ||
                                  (order.type && order.type.toLowerCase().includes(lowerCaseSearchTerm));

            return matchesTechnician && matchesStatus && matchesSearch;
        });
    };

    // --- ACTIONS ---
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

            showToast('Ordre overtatt! Navigerer til ordren...', 'success');
            
            setTimeout(() => {
                window.location.href = `/app/orders.html?id=${orderId}`;
            }, 1500);
            
        } catch (error) {
            console.error('Failed to take over order:', error);
            showToast(`Kunne ikke overta ordre: ${error.message}`, 'error');
            showLoading(false);
        }
    };

    const showOrderDetails = (orderId) => {
        const order = state.orders.find(o => o.id === orderId);
        if (!order) return;

        const customerId = order.customerId || order.customer_id;
        const technicianId = order.technicianId || order.technician_id;
        
        const customer = state.customers.get(String(customerId));
        const technician = technicianId ? state.technicians.get(technicianId) : null;
        const isOwnOrder = technicianId === state.currentTechnicianId;

        // VIKTIG: Hent adresse fra order.customer_data (som har riktig data fra databasen)
        const address = order.customer_data?.physicalAddress || 
                       customer?.physicalAddress || 
                       'Ikke registrert';
        
        const phone = order.customer_data?.phone || 
                     customer?.phone || 
                     'Ikke registrert';

        modalBody.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 12px;">
                <div style="display: grid; grid-template-columns: 140px 1fr; gap: 8px; align-items: start;">
                    <strong style="color: #6b7280; font-size: 13px;">Ordre ID:</strong>
                    <span style="font-family: monospace; font-size: 12px; color: #374151;">${order.id}</span>
                </div>
                
                <div style="display: grid; grid-template-columns: 140px 1fr; gap: 8px;">
                    <strong style="color: #6b7280; font-size: 13px;">Kunde:</strong>
                    <span style="color: #1f2937; font-weight: 600;">${customer ? customer.name : 'N/A'}</span>
                </div>
                
                <div style="display: grid; grid-template-columns: 140px 1fr; gap: 8px;">
                    <strong style="color: #6b7280; font-size: 13px;">Adresse:</strong>
                    <span style="color: #374151;">${address}</span>
                </div>
                
                <div style="display: grid; grid-template-columns: 140px 1fr; gap: 8px;">
                    <strong style="color: #6b7280; font-size: 13px;">Telefon:</strong>
                    <span style="color: #374151;">${phone}</span>
                </div>
                
                <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 8px 0;">
                
                <div style="display: grid; grid-template-columns: 140px 1fr; gap: 8px;">
                    <strong style="color: #6b7280; font-size: 13px;">Ordretype:</strong>
                    <span style="color: #374151;">${order.type || order.service_type || 'Service'}</span>
                </div>
                
                <div style="display: grid; grid-template-columns: 140px 1fr; gap: 8px;">
                    <strong style="color: #6b7280; font-size: 13px;">Planlagt dato:</strong>
                    <span style="color: #374151;">${new Date(order.plannedDate || order.scheduled_date).toLocaleString('no-NO')}</span>
                </div>
                
                <div style="display: grid; grid-template-columns: 140px 1fr; gap: 8px;">
                    <strong style="color: #6b7280; font-size: 13px;">Status:</strong>
                    <span style="color: #374151; text-transform: capitalize;">${deriveOrderStatus(order)}</span>
                </div>
                
                <div style="display: grid; grid-template-columns: 140px 1fr; gap: 8px;">
                    <strong style="color: #6b7280; font-size: 13px;">Nåværende tekniker:</strong>
                    <span style="color: #374151;">${technician ? technician.name : 'Ikke tildelt'}</span>
                </div>
                
                <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 8px 0;">
                
                <div>
                    <strong style="color: #6b7280; font-size: 13px; display: block; margin-bottom: 6px;">Beskrivelse:</strong>
                    <p style="color: #374151; margin: 0; line-height: 1.5;">${order.description || 'Ingen beskrivelse.'}</p>
                </div>
                
                <div style="display: flex; gap: 12px; margin-top: 16px; padding-top: 16px; border-top: 1px solid #e5e7eb; flex-direction: column;">
                    ${!isOwnOrder ? `
                        <button 
                            onclick="window.takeOverOrderFromModal('${orderId}')" 
                            style="width: 100%; padding: 14px 20px; border: none; background: #4A90E2; color: white; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 15px; transition: all 0.2s;">
                            ⚡ Ta over ordre
                        </button>
                    ` : ''}
                    <button 
                        onclick="document.getElementById('order-details-modal').style.display='none'" 
                        style="width: 100%; padding: 12px 20px; border: 1px solid #d1d5db; background: white; color: #374151; border-radius: 8px; cursor: pointer; font-weight: 600; transition: all 0.2s;">
                        Lukk
                    </button>
                </div>
            </div>
        `;
        modal.style.display = 'flex';
    };

    // Global funksjon for å ta over ordre fra modal
    window.takeOverOrderFromModal = (orderId) => {
        document.getElementById('order-details-modal').style.display = 'none';
        takeOverOrder(orderId);
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