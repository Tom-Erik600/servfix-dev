// air-tech-app/assets/js/app.js - Hovedapplikasjon for tekniker-app

const today = new Date();

let appState = {
    loading: false,
    currentView: 'week',
    selectedDate: new Date(today),
    currentPeriod: new Date(today),
    expandedCardKey: null,
    orders: [],
    equipment: [],
    customers: new Map(),
    technicians: new Map(),
    currentTechnicianId: null, // Set by auth
    currentTechnician: null,
};

const norwegianMonths = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember'];
const norwegianDays = ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'];

const toISODateString = (date) => {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const AirTechAPI = {
    baseUrl: '/api',
    async request(endpoint) {
        try {
            const response = await fetch(`${this.baseUrl}${endpoint}`);
            if (!response.ok) {
                if (response.status === 401) {
                    // auth-check.js will handle the redirect
                    console.warn('Unauthorized request. Redirecting to login.');
                }
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return await response.json();
        } catch (error) { 
            console.error(`API request failed: ${endpoint}`, error); 
            throw error; 
        }
    },
    getOrders: () => AirTechAPI.request('/orders'),
    getCustomers: () => AirTechAPI.request('/customers'),
    getTechnicians: () => AirTechAPI.request('/technicians'),
    getEquipment: () => AirTechAPI.request('/equipment')
};

document.addEventListener('DOMContentLoaded', async () => {
    setLoadingState(true);
    await window.authManager.waitForInitialization();

    if (!window.authManager.isLoggedIn()) {
        console.log("Not logged in, stopping app initialization.");
        setLoadingState(false);
        return; // auth-check.js handles redirect
    }

    try {
        const user = window.authManager.getCurrentUser();
        appState.currentTechnicianId = user.technician.id;

        const [orders, customers, technicians, equipment] = await Promise.all([
            AirTechAPI.getOrders(), AirTechAPI.getCustomers(), AirTechAPI.getTechnicians(), AirTechAPI.getEquipment()
        ]);
        
        appState.customers = new Map(customers.map(c => [c.id, c]));
        appState.technicians = new Map(technicians.map(t => [t.id, t]));
        appState.orders = orders;
        appState.equipment = equipment;
        appState.currentTechnician = appState.technicians.get(appState.currentTechnicianId);
        
        if (!appState.currentTechnician) {
            throw new Error(`Technician with ID ${appState.currentTechnicianId} not found.`);
        }
        
        console.log('📊 Data loaded:', {
            orders: appState.orders.length,
            customers: appState.customers.size,
            technicians: appState.technicians.size,
            equipment: appState.equipment.length
        });
        
        renderAll();
        setupEventListeners();
        lucide.createIcons(); // Refresh icons after potential changes
    } catch (error) {
        console.error('❌ Failed to initialize app:', error);
        showToast('Kunne ikke laste app-data. Prøver å logge ut.', 'error');
        setTimeout(() => window.authManager.logout(), 2000);
    } finally {
        setLoadingState(false);
    }
});

function renderAll() {
    renderHeader();
    if (appState.currentView === 'week') renderWeekView();
    else renderMonthView();
    updateCalendarTitle();
    updateStatusCards();
}

function renderHeader() {
    const techNameEl = document.getElementById('technician-name');
    const techInitialsEl = document.getElementById('technician-initials');

    if (appState.currentTechnician) {
        if (techNameEl) {
            techNameEl.textContent = appState.currentTechnician.name;
        }
        if (techInitialsEl) {
            const initials = appState.currentTechnician.initials || (appState.currentTechnician.name ? appState.currentTechnician.name.split(' ').map(n => n[0]).join('') : '');
            techInitialsEl.textContent = initials;
        }
    } else {
        if (techNameEl) techNameEl.textContent = 'Logget ut';
        if (techInitialsEl) techInitialsEl.textContent = '...';
    }
}


function deriveOrderStatus(order) {
    return order.status || 'scheduled';
}

function updateStatusCards() {
    const technicianOrders = appState.orders; // Already filtered by the backend
    
    const selectedDateStr = toISODateString(appState.selectedDate);
    
    const ordersForDate = technicianOrders.filter(o => 
        o.scheduledDate === selectedDateStr && deriveOrderStatus(o) !== 'completed'
    );
    document.getElementById('selected-date-header').textContent = `Ordre for ${norwegianDays[appState.selectedDate.getDay()]} ${appState.selectedDate.getDate()}.${appState.selectedDate.getMonth() + 1}`;
    updateCard('selected-date', ordersForDate);

    const todayStr = toISODateString(today);
    
    const endOfWeek = new Date(today);
    const dayIndex = today.getDay();
    const daysToAdd = dayIndex === 0 ? 0 : 7 - dayIndex;
    endOfWeek.setDate(today.getDate() + daysToAdd);
    const weekEndStr = toISODateString(endOfWeek);

    const upcomingOrders = technicianOrders.filter(o => {
        return o.scheduledDate && o.scheduledDate >= todayStr && o.scheduledDate <= weekEndStr &&
               deriveOrderStatus(o) !== 'completed';
    });
    updateCard('upcoming', upcomingOrders);

    const unfinishedOrders = technicianOrders.filter(o => deriveOrderStatus(o) === 'in_progress');
    updateCard('unfinished', unfinishedOrders);
}

function updateCard(type, data) {
    const countEl = document.getElementById(`${type}-count`);
    const containerEl = document.getElementById(`${type}-orders`);
    if(!countEl || !containerEl) return;
    
    countEl.textContent = data.length;
    
    if (data.length > 0) {
        containerEl.innerHTML = data.map(order => createOrderCardHTML(order, type)).join('');
    } else {
        const placeholderTexts = {
            'selected-date': 'Ingen ordre for valgt dag',
            'upcoming': 'Ingen kommende ordre',
            'unfinished': 'Ingen uferdige ordre'
        };
        containerEl.innerHTML = `<div class="placeholder-text">${placeholderTexts[type]}</div>`;
    }
}

function createOrderCardHTML(order, listType) {
    const customer = appState.customers.get(order.customerId);
    const cardKey = `${listType}-${order.id}`;
    const isExpanded = appState.expandedCardKey === cardKey;
    const derivedStatus = deriveOrderStatus(order);
    const statusMap = {'scheduled': 'Planlagt', 'in_progress': 'Pågår', 'completed': 'Fullført'};
    
    let timeDisplay = 'Ikke planlagt';
    if (order.scheduledDate) {
        const orderDate = new Date(order.scheduledDate + 'T12:00:00');
        timeDisplay = `${orderDate.getDate()}.${orderDate.getMonth() + 1}`;
        if (order.scheduledTime) {
            timeDisplay += ` - ${order.scheduledTime}`;
        }
    }

    return `<div class="order-card ${isExpanded ? 'expanded' : ''}" data-card-key="${cardKey}">
        <div class="order-card-header">
            <div class="order-status-indicator status-${derivedStatus}"></div>
            <div class="order-info">
                <div class="order-customer">${customer?.name || 'Ukjent Kunde'}</div>
                <div class="order-details">
                    <span>${order.serviceType || 'Service'}</span> - <span>${statusMap[derivedStatus] || derivedStatus}</span>
                </div>
            </div>
            <div class="order-meta">
                <div class="order-time">${timeDisplay}</div>
                <div class="order-number">#${(order.orderNumber || order.id).slice(-4)}</div>
            </div>
        </div>
        ${isExpanded ? `<div class="order-expanded-content">
            <div class="customer-details">
                <div class="detail-row">
                    <span class="detail-label">👤 Kontakt:</span>
                    <span class="detail-value">${customer?.contactPerson || 'Ikke angitt'}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">📍 Adresse:</span>
                    <span class="detail-value">${customer?.invoiceAddress?.addressLine1 || 'Ikke angitt'}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">📞 Telefon:</span>
                    <span class="detail-value">${customer?.phone || 'Ikke angitt'}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">📝 Beskrivelse:</span>
                    <span class="detail-value">${order.description || 'Ingen beskrivelse'}</span>
                </div>
            </div>
            <div class="order-actions">
                <button class="action-btn" data-order-id="${order.id}">Åpne ordre</button>
            </div>
        </div>` : ''}
    </div>`;
}

function setupEventListeners() {
    document.querySelector('.calendar-controls')?.addEventListener('click', handleCalendarControls);
    document.getElementById('status-cards-container')?.addEventListener('click', handleCardClick);
    
    const logoutButton = document.getElementById('logout-button');
    if (logoutButton) {
        logoutButton.addEventListener('click', () => {
            window.authManager.logout();
        });
    }
    
    const monthBtn = document.getElementById('month-view-btn');
    const weekBtn = document.getElementById('week-view-btn');
    
    if (monthBtn) {
        monthBtn.addEventListener('click', (e) => {
            e.preventDefault();
            setView('month');
        });
    }
    
    if (weekBtn) {
        weekBtn.addEventListener('click', (e) => {
            e.preventDefault();
            setView('week');
        });
    }
}

function handleCardClick(event) {
    const card = event.target.closest('.order-card');
    if (!card) return;
    
    const orderId = event.target.closest('[data-order-id]')?.dataset.orderId;
    if (orderId) {
        event.stopPropagation();
        openOrder(orderId);
    } else {
        toggleOrderCard(card.dataset.cardKey);
    }
}

function toggleOrderCard(cardKey) {
    appState.expandedCardKey = appState.expandedCardKey === cardKey ? null : cardKey;
    updateStatusCards();
}

function openOrder(orderId) {
    window.location.href = `orders.html?id=${orderId}`;
}

function createCalendarDay(date, isMonthView = false) {
    const technicianOrders = appState.orders; // Already filtered by the backend
    
    const dateStr = toISODateString(date);
    const todayStr = toISODateString(today);
    const selectedDateStr = toISODateString(appState.selectedDate);
    
    const baseClass = isMonthView ? 'month-day' : 'calendar-day';
    const classes = [baseClass];
    
    if (dateStr === todayStr) classes.push('is-today');
    if (dateStr === selectedDateStr) classes.push('selected');
    
    const ordersForDate = technicianOrders.filter(o => 
        o.scheduledDate === dateStr && deriveOrderStatus(o) !== 'completed'
    );
    if (ordersForDate.length > 0) classes.push('has-orders');
    
    if (isMonthView && date.getMonth() !== appState.currentPeriod.getMonth()) {
        classes.push('other-month');
    }
    
    return `<div class="${classes.join(' ')}" data-date="${dateStr}">
        <span class="day-number">${date.getDate()}</span>
        ${ordersForDate.length > 0 ? `<span class="service-indicator"></span>` : ''}
    </div>`;
}

function renderWeekView() {
    const daysContainer = document.getElementById('calendar-days');
    if (!daysContainer) return;
    
    let current = new Date(appState.currentPeriod);
    let dayOfWeek = current.getDay();
    dayOfWeek = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    let weekStart = new Date(current.setDate(current.getDate() - dayOfWeek));
    
    let daysHTML = '';
    for (let i = 0; i < 7; i++) {
        const date = new Date(weekStart);
        date.setDate(weekStart.getDate() + i);
        daysHTML += createCalendarDay(date, false);
    }
    
    daysContainer.innerHTML = daysHTML;
    daysContainer.querySelectorAll('.calendar-day').forEach(day => 
        day.addEventListener('click', (e) => selectDate(e.currentTarget.dataset.date))
    );
}

function renderMonthView() {
    const monthDaysContainer = document.getElementById('month-days');
    if (!monthDaysContainer) return;
    
    const currentMonth = appState.currentPeriod.getMonth();
    const firstDayOfMonth = new Date(appState.currentPeriod.getFullYear(), currentMonth, 1);
    
    let dayOfWeek = firstDayOfMonth.getDay();
    dayOfWeek = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    
    let currentDate = new Date(firstDayOfMonth);
    currentDate.setDate(currentDate.getDate() - dayOfWeek);
    
    let daysHTML = '';
    for (let i = 0; i < 42; i++) {
        daysHTML += createCalendarDay(new Date(currentDate), true);
        currentDate.setDate(currentDate.getDate() + 1);
    }
    
    monthDaysContainer.innerHTML = daysHTML;
    monthDaysContainer.querySelectorAll('.month-day').forEach(day => 
        day.addEventListener('click', (e) => selectDate(e.currentTarget.dataset.date))
    );
}

function selectDate(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    appState.selectedDate = new Date(year, month - 1, day, 12);
    renderAll();
}

function updateCalendarTitle() {
    const titleElement = document.getElementById('calendar-title');
    if (!titleElement) return;
    
    if (appState.currentView === 'week') {
        let weekStart = new Date(appState.currentPeriod);
        let dayOfWeek = weekStart.getDay();
        dayOfWeek = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        weekStart.setDate(weekStart.getDate() - dayOfWeek);
        
        const getWeekNumber = d => {
            d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
            d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
            var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
            return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
        }
        
        titleElement.textContent = `Uke ${getWeekNumber(weekStart)}`;
    } else {
        const monthName = norwegianMonths[appState.currentPeriod.getMonth()];
        const year = appState.currentPeriod.getFullYear();
        titleElement.textContent = `${monthName.charAt(0).toUpperCase() + monthName.slice(1)} ${year}`;
    }
}

function handleCalendarControls(event) {
    const target = event.target.closest('button');
    if (!target) return;
    
    const action = target.dataset.action;
    if (!action) return;
    
    switch (action) {
        case 'prev-period': navigatePeriod(-1); break;
        case 'next-period': navigatePeriod(1); break;
        case 'set-view': setView(target.dataset.view); break;
    }
}

function navigatePeriod(direction) {
    const newPeriod = new Date(appState.currentPeriod);
    if (appState.currentView === 'week') {
        newPeriod.setDate(newPeriod.getDate() + (7 * direction));
    } else {
        newPeriod.setMonth(newPeriod.getMonth() + direction);
    }
    appState.currentPeriod = newPeriod;
    renderAll();
}

function setView(view) {
    if (appState.currentView === view) return;
    
    appState.currentView = view;
    appState.currentPeriod = new Date(appState.selectedDate);
    
    const weekBtn = document.getElementById('week-view-btn');
    const monthBtn = document.getElementById('month-view-btn');
    
    if (weekBtn) weekBtn.classList.toggle('active', view === 'week');
    if (monthBtn) monthBtn.classList.toggle('active', view === 'month');
    
    const weekCal = document.getElementById('week-calendar');
    const monthCal = document.getElementById('month-calendar');
    
    if (weekCal) weekCal.classList.toggle('hidden', view !== 'week');
    if (monthCal) monthCal.classList.toggle('hidden', view !== 'month');
    
    renderAll();
}

function setLoadingState(loading) {
    const loader = document.getElementById('loading-indicator');
    if (loader) loader.style.display = loading ? 'flex' : 'none';
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 16px;
        border-radius: 6px;
        color: white;
        font-weight: 500;
        z-index: 1000;
        background-color: ${type === 'error' ? '#dc3545' : '#28a745'};
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        animation: slideIn 0.3s ease-out;
    `;
    
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}
