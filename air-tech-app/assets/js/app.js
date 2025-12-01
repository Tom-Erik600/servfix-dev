// air-tech-app/assets/js/app.js (v8.2 - Endelig)

const today = new Date();
const formatertDato = today.toLocaleDateString('nb-NO');

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
    currentTechnicianId: 'T-01',
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
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return await response.json();
        } catch (error) { console.error(`API request failed: ${endpoint}`, error); throw error; }
    },
    getOrders: () => AirTechAPI.request('/orders'),
    getCustomers: () => AirTechAPI.request('/customers'),
    getTechnicians: () => AirTechAPI.request('/technicians'),
    getEquipment: () => AirTechAPI.request('/equipment')
};

document.addEventListener('DOMContentLoaded', async () => {
    setLoadingState(true);
    try {
        const [orders, customers, technicians, equipment] = await Promise.all([
            AirTechAPI.getOrders(), AirTechAPI.getCustomers(), AirTechAPI.getTechnicians(), AirTechAPI.getEquipment()
        ]);
        appState.customers = new Map(customers.map(c => [c.id, c]));
        appState.technicians = new Map(technicians.map(t => [t.id, t]));
        appState.orders = orders;
        appState.equipment = equipment;
        appState.currentTechnician = appState.technicians.get(appState.currentTechnicianId);
        renderAll();
        setupEventListeners();
    } catch (error) {
        console.error('❌ Failed to initialize app:', error);
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

function deriveOrderStatus(order) {
    const relatedEquipment = appState.equipment.filter(eq => eq.customerId === order.customerId);
    if (relatedEquipment.length > 0 && relatedEquipment.every(eq => eq.serviceStatus === 'completed')) {
        return 'completed';
    }
    return order.status;
}

function updateStatusCards() {
    const technicianOrders = appState.orders.filter(o => o.technicianId === appState.currentTechnicianId);
    const selectedDateStr = toISODateString(appState.selectedDate);
    
    const ordersForDate = technicianOrders.filter(o => o.scheduledDate === selectedDateStr);
    document.getElementById('selected-date-header').textContent = `Ordre for ${norwegianDays[appState.selectedDate.getDay()]} ${appState.selectedDate.getDate()}.${appState.selectedDate.getMonth() + 1}`;
    updateCard('selected-date', ordersForDate);

    const todayStr = toISODateString(today);
    
    const endOfWeek = new Date(today);
    const dayIndex = today.getDay();
    const daysToAdd = dayIndex === 0 ? 0 : 7 - dayIndex;
    endOfWeek.setDate(today.getDate() + daysToAdd);
    const weekEndStr = toISODateString(endOfWeek);

    const upcomingOrders = technicianOrders.filter(o => {
        return o.scheduledDate >= todayStr && o.scheduledDate <= weekEndStr &&
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
    const placeholder = containerEl.querySelector('.placeholder-text') || {textContent: ''};
    containerEl.innerHTML = data.length > 0 ? data.map(order => createOrderCardHTML(order, type)).join('') : `<p class="placeholder-text">${placeholder.textContent}</p>`;
}

function createOrderCardHTML(order, listType) {
    const customer = appState.customers.get(order.customerId);
    const cardKey = `${listType}-${order.id}`;
    const isExpanded = appState.expandedCardKey === cardKey;
    const derivedStatus = deriveOrderStatus(order);
    const statusMap = {'scheduled': 'Planlagt', 'in_progress': 'Pågår', 'completed': 'Fullført'};
    const orderDate = new Date(order.scheduledDate + 'T12:00:00Z');
    const timeDisplay = `${orderDate.getDate()}.${orderDate.getMonth() + 1} - ${order.scheduledTime}`;

    return `<div class="order-card ${isExpanded ? 'expanded' : ''}" data-card-key="${cardKey}"><div class="order-card-header"><div class="order-status-indicator status-${derivedStatus}"></div><div class="order-info"><div class="order-customer">${customer?.name || 'Ukjent Kunde'}</div><div class="order-details"><span>${order.serviceType}</span> - <span>${statusMap[derivedStatus] || derivedStatus}</span></div></div><div class="order-meta"><div class="order-time">${timeDisplay}</div><div class="order-number">#${order.orderNumber.slice(-4)}</div></div></div>${isExpanded ? `<div class="order-expanded-content"><div class="customer-details"><div class="detail-row"><span class="detail-label">👤 Kontakt:</span><span class="detail-value">${customer?.contactPerson || 'Ikke angitt'}</span></div><div class="detail-row"><span class="detail-label">📍 Adresse:</span><span class="detail-value">${customer?.address || 'Ikke angitt'}</span></div><div class="detail-row"><span class="detail-label">📞 Telefon:</span><span class="detail-value">${customer?.phone || 'Ikke angitt'}</span></div><div class="detail-row"><span class="detail-label">📝 Beskrivelse:</span><span class="detail-value">${order.description}</span></div></div><div class="order-actions"><button class="action-btn" data-order-id="${order.id}">Åpne ordre</button></div></div>` : ''}</div>`;
}

function setupEventListeners() {
    document.querySelector('.calendar-controls').addEventListener('click', handleCalendarControls);
    document.getElementById('status-cards-container').addEventListener('click', handleCardClick);
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

// ... Resten av filen (kalender-funksjoner etc) er uendret ...
function createCalendarDay(date, isMonthView = false) {const technicianOrders = appState.orders.filter(o => o.technicianId === appState.currentTechnicianId);const dateStr = toISODateString(date);const todayStr = toISODateString(today);const selectedDateStr = toISODateString(appState.selectedDate);const baseClass = isMonthView ? 'month-day' : 'calendar-day';const classes = [baseClass];if (dateStr === todayStr) classes.push('is-today');if (dateStr === selectedDateStr) classes.push('selected');const ordersForDate = technicianOrders.filter(o => o.scheduledDate === dateStr);if (ordersForDate.length > 0) classes.push('has-orders');if (isMonthView && date.getMonth() !== appState.currentPeriod.getMonth()) {classes.push('other-month');}return `<div class="${classes.join(' ')}" data-date="${dateStr}"><span class="day-number">${date.getDate()}</span>${ordersForDate.length > 0 ? `<span class="service-indicator"></span>` : ''}</div>`;}
function renderWeekView() {const daysContainer = document.getElementById('calendar-days');if (!daysContainer) return;let current = new Date(appState.currentPeriod);let dayOfWeek = current.getDay();dayOfWeek = dayOfWeek === 0 ? 6 : dayOfWeek - 1;let weekStart = new Date(current.setDate(current.getDate() - dayOfWeek));let daysHTML = '';for (let i = 0; i < 7; i++) {const date = new Date(weekStart);date.setDate(weekStart.getDate() + i);daysHTML += createCalendarDay(date, false);}daysContainer.innerHTML = daysHTML;daysContainer.querySelectorAll('.calendar-day').forEach(day => day.addEventListener('click', (e) => selectDate(e.currentTarget.dataset.date)));}
function renderMonthView() {const monthDaysContainer = document.getElementById('month-days');if (!monthDaysContainer) return;const currentMonth = appState.currentPeriod.getMonth();const firstDayOfMonth = new Date(appState.currentPeriod.getFullYear(), currentMonth, 1);let dayOfWeek = firstDayOfMonth.getDay();dayOfWeek = dayOfWeek === 0 ? 6 : dayOfWeek - 1;let currentDate = new Date(firstDayOfMonth);currentDate.setDate(currentDate.getDate() - dayOfWeek);let daysHTML = '';for (let i = 0; i < 42; i++) {daysHTML += createCalendarDay(new Date(currentDate), true);currentDate.setDate(currentDate.getDate() + 1);}monthDaysContainer.innerHTML = daysHTML;monthDaysContainer.querySelectorAll('.month-day').forEach(day => day.addEventListener('click', (e) => selectDate(e.currentTarget.dataset.date)));}
function selectDate(dateStr) {const [year, month, day] = dateStr.split('-').map(Number);appState.selectedDate = new Date(year, month - 1, day, 12);renderAll();}
function renderHeader() {const header = document.querySelector('.app-header');if (!header) return;const tech = appState.currentTechnician;header.innerHTML = `<button class="header-nav-button hidden" title="Tilbake">‹</button><div class="header-main-content"><div class="logo-circle"><svg width="24" height="24" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="14" stroke="white" stroke-width="2" fill="none"/><circle cx="16" cy="16" r="8" stroke="white" stroke-width="2" fill="none"/><circle cx="16" cy="16" r="3" fill="white"/><path d="M16 2 L16 8" stroke="white" stroke-width="2"/><path d="M16 24 L16 30" stroke="white" stroke-width="2"/><path d="M30 16 L24 16" stroke="white" stroke-width="2"/><path d="M8 16 L2 16" stroke="white" stroke-width="2"/></svg></div><div class="company-info"><h1>AIR-TECH AS</h1><span class="app-subtitle">${tech ? tech.specialization : 'Servicetekniker'}</span></div></div><div class="header-user-info">${tech ? `<div class="technician-avatar">${tech.initials}</div>` : ''}<span>${tech ? tech.name.split(' ')[0] : '...'}</span></div>`;}
function updateCalendarTitle() {const titleElement = document.getElementById('calendar-title');if (!titleElement) return;if (appState.currentView === 'week') {let weekStart = new Date(appState.currentPeriod);let dayOfWeek = weekStart.getDay();dayOfWeek = dayOfWeek === 0 ? 6 : dayOfWeek - 1;weekStart.setDate(weekStart.getDate() - dayOfWeek);const getWeekNumber = d => {d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);}
titleElement.textContent = `Uke ${getWeekNumber(weekStart)}`;} else {const monthName = norwegianMonths[appState.currentPeriod.getMonth()];const year = appState.currentPeriod.getFullYear();titleElement.textContent = `${monthName.charAt(0).toUpperCase() + monthName.slice(1)} ${year}`;}}
function handleCalendarControls(event) {const target = event.target.closest('button');if (!target) return;const action = target.dataset.action;if (!action) return;switch (action) {case 'prev-period': navigatePeriod(-1); break;case 'next-period': navigatePeriod(1); break;case 'set-view': setView(target.dataset.view); break;}}
function navigatePeriod(direction) {const newPeriod = new Date(appState.currentPeriod);if (appState.currentView === 'week') {newPeriod.setDate(newPeriod.getDate() + (7 * direction));} else {newPeriod.setMonth(newPeriod.getMonth() + direction);}appState.currentPeriod = newPeriod;renderAll();}
function setView(view) {if (appState.currentView === view) return;appState.currentView = view;appState.currentPeriod = new Date(appState.selectedDate);document.getElementById('week-view-btn').classList.toggle('active', view === 'week');document.getElementById('month-view-btn').classList.toggle('active', view === 'month');document.getElementById('week-calendar').classList.toggle('hidden', view !== 'week');document.getElementById('month-calendar').classList.toggle('hidden', view !== 'month');renderAll();}
function setLoadingState(loading) {const loader = document.getElementById('loading-indicator');if (loader) loader.style.display = loading ? 'flex' : 'none';}
function showToast(message, type = 'info') {const container = document.getElementById('toast-container');if (!container) return;const toast = document.createElement('div');toast.className = `toast ${type}`;toast.textContent = message;container.appendChild(toast);setTimeout(() => toast.remove(), 3000);}