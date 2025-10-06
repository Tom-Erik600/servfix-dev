// air-tech-app/assets/js/app.js - Hovedapplikasjon for tekniker-app
(function() {
    // STOPP app.js fra å kjøre på andre sider enn index.html
    if (window.location.pathname.includes('service.html') || 
        window.location.pathname.includes('orders.html') ||
        window.location.pathname.includes('home.html')) {
        console.log('app.js: Ikke på index.html, avbryter');
        // Eksporter bare nødvendige funksjoner for andre sider
        window.openOrder = (orderId) => {
            window.location.href = `orders.html?id=${orderId}`;
        };
        return; // Nå er return lovlig inne i funksjonen
    }

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
    if (!date) return null;
    
    let d;
    if (typeof date === 'string') {
        // Håndter ISO strings (2025-07-30T22:00:00.000Z)
        d = new Date(date);
    } else {
        d = new Date(date);
    }
    
    // Sjekk om dato er gyldig
    if (isNaN(d.getTime())) {
        console.warn('Ugyldig dato til toISODateString:', date);
        return null;
    }
    
    // Bruk lokal tid (ikke UTC) for konsistens
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`;
};

const AirTechAPI = {
    baseUrl: '/api',
    async request(endpoint, options = {}) {
        try {
            const response = await fetch(`${this.baseUrl}${endpoint}`, {
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                ...options
            });
            
            if (!response.ok) {
                // Bare logg ut hvis det faktisk er autentiseringsfeil
                if (response.status === 401) {
                    console.error('Authentication failed, redirecting to login');
                    window.location.href = 'login.html';
                    return;
                }
                
                // For andre feil, kast error men ikke logg ut
                const error = await response.json().catch(() => ({}));
                throw new Error(error.error || `HTTP error! status: ${response.status}`);
            }
            
            const text = await response.text();
            return text ? JSON.parse(text) : {};
        } catch (error) {
            console.error(`API Error: ${error.message}`);
            throw error;
        }
    },
    getOrders: () => AirTechAPI.request('/orders'),
    getCustomers: () => AirTechAPI.request('/customers'),
    getTechnicians: () => AirTechAPI.request('/technicians'),
    getEquipment: () => AirTechAPI.request('/equipment')
};

document.addEventListener('DOMContentLoaded', async () => {
    // SJEKK 1: Er vi på riktig side?
    const currentPath = window.location.pathname;
    const isIndexPage = currentPath.endsWith('index.html') || 
                       currentPath === '/' || 
                       currentPath.endsWith('/app/');
    
    if (!isIndexPage) {
        console.log('app.js skal kun kjøre på index.html');
        return;
    }
    
    // SJEKK 2: Finnes de nødvendige elementene?
    const requiredElements = [
        'calendar-days',
        'week-calendar', 
        'month-calendar'
    ];
    
    const hasRequiredElements = requiredElements.some(id => 
        document.getElementById(id) !== null
    );
    
    if (!hasRequiredElements) {
        console.error('Mangler nødvendige kalender-elementer på siden');
        return;
    }
    
    // START NORMAL INITIALISERING
    setLoadingState(true);
    
    try {
        // Vent på autentisering
        await window.authManager.waitForInitialization();

        if (!window.authManager.isLoggedIn()) {
            console.log("Ikke pålogget, stopper app initialisering");
            setLoadingState(false);
            return;
        }

        // Hent brukerdata
        const user = window.authManager.getCurrentUser();
        appState.currentTechnicianId = user.technician.id;
        appState.currentTechnician = user.technician;
        
        // LEGG TIL DENNE LINJEN:
        updateHeaderInfo();

        // Hent ordre
        const [orders] = await Promise.all([
            AirTechAPI.getOrders()
        ]);
        
        // Konverter og lagre ordre
        appState.orders = orders.map(order => {
            // Normaliser dato
            const normalizeDate = (dateValue) => {
                if (!dateValue) return null;
                return toISODateString(dateValue);
            };
            
            return {
                ...order,
                id: order.id,
                scheduledDate: normalizeDate(order.scheduled_date || order.scheduledDate),
                scheduledTime: order.scheduled_time || order.scheduledTime || null,
                serviceType: order.service_type || order.serviceType || 'Service',
                customerId: order.customer_id || order.customerId || null,
                customerName: order.customer_name || order.customerName || 'Ukjent Kunde',
                customerData: order.customer_data || order.customerData || null, // LEGG TIL DENNE
                technicianId: order.technician_id || order.technicianId || null,
                orderNumber: order.order_number || order.orderNumber || order.id,
                status: order.status || 'scheduled',
                description: order.description || null
            };
        });

        // Oppdater UI
        renderAll();
        setupEventListeners();
        
        // Initialiser lucide ikoner
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
        
    } catch (error) {
        console.error('Feil ved initialisering av app:', error);
        showToast('Kunne ikke laste applikasjonen', 'error');
    } finally {
        setLoadingState(false);
    }
});

// Sjekk om siden ble lastet med reload parameter (fra ordre-ferdigstilling)
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has('reload')) {
    console.log('🔄 Forced reload detected, cleaning URL...');
    // Fjern reload parameter fra URL uten å reloade siden
    const cleanUrl = window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);
}

// Refresh data når brukeren kommer tilbake til siden
window.addEventListener('pageshow', async (event) => {
    // Kun reload hvis det er bfcache (back-forward cache) navigering
    if (event.persisted || performance.getEntriesByType('navigation')[0]?.type === 'back_forward') {
        console.log('🔄 Page returned from cache, reloading orders...');
        
        // Sjekk at vi er på index.html
        const currentPath = window.location.pathname;
        const isIndexPage = currentPath.endsWith('index.html') || 
                           currentPath === '/' || 
                           currentPath.endsWith('/app/');
        
        if (!isIndexPage) return;
        
        // Reload ordre
        try {
            const orders = await AirTechAPI.getOrders();
            
            // Oppdater state med nye ordre
            appState.orders = orders.map(order => {
                const normalizeDate = (dateValue) => {
                    if (!dateValue) return null;
                    return toISODateString(dateValue);
                };
                
                return {
                    ...order,
                    id: order.id,
                    scheduledDate: normalizeDate(order.scheduled_date || order.scheduledDate),
                    scheduledTime: order.scheduled_time || order.scheduledTime || null,
                    serviceType: order.service_type || order.serviceType || 'Service',
                    customerId: order.customer_id || order.customerId || null,
                    customerName: order.customer_name || order.customerName || 'Ukjent Kunde',
                    customerData: order.customer_data || order.customerData || null,
                    technicianId: order.technician_id || order.technicianId || null,
                    orderNumber: order.order_number || order.orderNumber || order.id,
                    status: order.status || 'scheduled',
                    description: order.description || null
                };
            });
            
            // Re-render UI
            renderAll();
            console.log('✅ Orders reloaded successfully');
        } catch (error) {
            console.error('❌ Failed to reload orders:', error);
        }
    }
});

function renderAll() {
    // Ekstra sikkerhet - sjekk at elementene finnes
    if (!document.getElementById('calendar-days')) {
        console.warn('renderAll kallt uten kalender-elementer');
        return;
    }
    
    renderCalendar();
    updateStatusCards();
    updateNavigationText();
    updateHeaderInfo(); // <-- LEGG TIL DENNE LINJEN
}




function deriveOrderStatus(order) {
    // Hvis ordre allerede er eksplisitt markert som completed, returner det
    if (order.status === 'completed') return 'completed';
    
    // Sjekk service_reports status i stedet for equipment serviceStatus
    if (order.equipment && order.equipment.length > 0) {
        const anyServiceStarted = order.equipment.some(eq => 
            eq.serviceReportStatus === 'in_progress' || 
            eq.serviceReportStatus === 'completed'
        );
        
        if (anyServiceStarted) return 'in_progress';
    }
    
    return order.status || 'scheduled';
}

function updateStatusCards() {
    // Oppdater ordre for valgt dato
    const selectedDateStr = toISODateString(appState.selectedDate);
    const ordersForSelectedDate = appState.orders.filter(order => 
        order.scheduledDate === selectedDateStr
    );
    updateCard('selected-date', ordersForSelectedDate);
    
    // Oppdater kommende ordre denne uken
    const weekStart = new Date(appState.currentPeriod);
    let dayOfWeek = weekStart.getDay();
    dayOfWeek = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    weekStart.setDate(weekStart.getDate() - dayOfWeek);
    
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    
    const upcomingOrders = appState.orders.filter(order => {
        if (!order.scheduledDate) return false;
        const orderDate = new Date(order.scheduledDate + 'T12:00:00');
        const orderDateStr = toISODateString(orderDate);
        const todayStr = toISODateString(new Date());
        return orderDate >= new Date(todayStr) && 
               orderDate <= weekEnd && 
               deriveOrderStatus(order) !== 'completed';
    });
    updateCard('upcoming', upcomingOrders);
    
    // Oppdater uferdige ordre - ordre som er påbegynt men ikke ferdigstilt
    const unfinishedOrders = appState.orders.filter(order => {
        const derivedStatus = deriveOrderStatus(order);
        // Vis kun ordre som er under arbeid (in_progress) - ikke scheduled eller completed
        return derivedStatus === 'in_progress';
    });
    updateCard('unfinished', unfinishedOrders);
}

function updateCard(type, orders) {
    const countEl = document.getElementById(`${type}-count`);
    const containerEl = document.getElementById(`${type}-orders`);
    
    if (!countEl || !containerEl) return;
    
    countEl.textContent = orders.length;
    
    if (orders.length > 0) {
        containerEl.innerHTML = orders.map(order => createOrderCardHTML(order, type)).join('');
        
        // FJERN gammel event listener først hvis den finnes
        const oldHandler = containerEl._clickHandler;
        if (oldHandler) {
            containerEl.removeEventListener('click', oldHandler);
        }
        
        // Definer ny handler
        const clickHandler = (e) => {
            // Håndter ordre-kort klikk
            const card = e.target.closest('.order-card');
            if (card && !e.target.closest('.open-order-btn')) {
                const cardKey = card.dataset.cardKey;
                if (cardKey) toggleOrderCard(cardKey);
            }
            
            // Håndter åpne ordre knapp
            const openBtn = e.target.closest('.open-order-btn');
            if (openBtn) {
                e.stopPropagation(); // Forhindre kort-toggle
                const orderId = openBtn.dataset.orderId;
                window.location.href = `orders.html?id=${orderId}`;
            }
        };
        
        // Lagre referanse til handler og legg til
        containerEl._clickHandler = clickHandler;
        containerEl.addEventListener('click', clickHandler);
    } else {
        const placeholderTexts = {
            'selected-date': 'Ingen ordre for valgt dag',
            'upcoming': 'Ingen kommende ordre',
            'unfinished': 'Ingen uferdige ordre'
        };
        containerEl.innerHTML = `<div class="placeholder-text">${placeholderTexts[type] || 'Ingen ordre'}</div>`;
    }
}

function createOrderCardHTML(order, listType) {
    const customer = { name: order.customerName || 'Ukjent kunde' };
    const cardKey = `${listType}-${order.id}`;
    const isExpanded = appState.expandedCardKey === cardKey;
    const derivedStatus = deriveOrderStatus(order);
    const statusMap = {
        'scheduled': 'Planlagt', 
        'in_progress': 'Pågår', 
        'completed': 'Fullført',
        'pending': 'Venter'
    };
    
    let timeDisplay = 'Ikke planlagt';
    if (order.scheduledDate) {
        const orderDate = new Date(order.scheduledDate + 'T12:00:00');
        timeDisplay = orderDate.toLocaleDateString('no-NO', {
            day: 'numeric',
            month: 'short'
        });
        if (order.scheduledTime) {
            timeDisplay += ` kl. ${order.scheduledTime}`;
        }
    }

    return `
        <div class="order-card ${isExpanded ? 'expanded' : ''} status-${derivedStatus}" data-card-key="${cardKey}">
            <div class="order-card-header">
                <div class="order-status-indicator status-${derivedStatus}"></div>
                <div class="order-info">
                    <div class="order-customer">${customer.name}</div>
                    <div class="order-details">
                        <span>${order.serviceType || 'Service'}</span> • 
                        <span>${statusMap[derivedStatus] || derivedStatus}</span>
                    </div>
                </div>
                <div class="order-meta">
                    <div class="order-time">${timeDisplay}</div>
                    <div class="order-number">#${(order.orderNumber || order.id).slice(-6)}</div>
                </div>
            </div>
            ${isExpanded ? `
                <div class="order-card-details">
                    <div class="customer-info-section">
                        <div class="customer-info-grid">
                            <div class="info-item">
                                <span class="info-label">Kontaktperson:</span>
                                <span class="info-value">${order.customerData?.contact || '(Mangler)'}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Telefon:</span>
                                <span class="info-value">${order.customerData?.phone || '(Mangler)'}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">E-post:</span>
                                <span class="info-value">${order.customerData?.email || '(Mangler)'}</span>
                            </div>
                            <div class="info-item full-width">
                                <span class="info-label">Besøksadresse:</span>
                                <span class="info-value">${order.customerData?.physicalAddress || '(Mangler)'}</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="detail-item">
                        <span class="detail-label">Beskrivelse:</span>
                        <span>${order.description || 'Ingen beskrivelse'}</span>
                    </div>
                    
                    <button class="action-btn primary open-order-btn" data-order-id="${order.id}">
                        Åpne ordre →
                    </button>
                </div>
            ` : ''}
        </div>
    `;
}

function updateNavigationText() {
    // Oppdater tekster basert på valgt dato
    const selectedDateEl = document.getElementById('selected-date-header');
    if (selectedDateEl && appState.selectedDate) {
        const dateStr = appState.selectedDate.toLocaleDateString('no-NO', {
            weekday: 'long',
            day: 'numeric',
            month: 'long'
        });
        selectedDateEl.textContent = `Ordre for ${dateStr}`;
    }
}

function setupEventListeners() {
    // Kalender kontroller
    const calendarControls = document.querySelector('.calendar-controls');
    if (calendarControls) {
        calendarControls.addEventListener('click', handleCalendarControls);
    }
    
    // Lucide ikoner
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
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

// ERSTATT funksjonen createCalendarDay i public/app/assets/js/app.js

function createCalendarDay(date, isMonthView = false) {
    const technicianOrders = appState.orders; // Already filtered by the backend
    
    const dateStr = toISODateString(date);
    const todayStr = toISODateString(today);
    const selectedDateStr = toISODateString(appState.selectedDate);
    
    const baseClass = isMonthView ? 'month-day' : 'calendar-day';
    const classes = [baseClass];
    
    if (dateStr === todayStr) classes.push('is-today');
    if (dateStr === selectedDateStr) classes.push('selected');
    
    // Finn alle ordre for denne datoen
    const allOrdersForDate = technicianOrders.filter(o => o.scheduledDate === dateStr);
    
    // Bestem prikk-type basert på status
    let indicatorClass = '';
    if (allOrdersForDate.length > 0) {
        const statuses = allOrdersForDate.map(o => deriveOrderStatus(o));
        const hasInProgress = statuses.some(s => s === 'in_progress');
        const allCompleted = statuses.every(s => s === 'completed');
        
        if (allCompleted) {
            // Alle ordre fullført - grønn prikk
            classes.push('all-completed');
            indicatorClass = 'completed';
        } else if (hasInProgress) {
            // Minst én ordre pågår - gul prikk
            classes.push('has-in-progress');
            indicatorClass = 'in-progress';
        } else {
            // Bare planlagte ordre - grå prikk
            classes.push('has-scheduled');
            indicatorClass = 'scheduled';
        }
    }
    
    if (isMonthView && date.getMonth() !== appState.currentPeriod.getMonth()) {
        classes.push('other-month');
    }
    
    return `<div class="${classes.join(' ')}" data-date="${dateStr}">
        <span class="day-number">${date.getDate()}</span>
        ${indicatorClass ? `<span class="service-indicator ${indicatorClass}"></span>` : ''}
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

function renderCalendar() {
    if (appState.currentView === 'week') {
        renderWeekView();
    } else {
        renderMonthView();
    }
    updateCalendarTitle();
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

function setLoadingState(isLoading) {
    const loader = document.getElementById('loading-indicator');
    if (loader) {
        loader.style.display = isLoading ? 'flex' : 'none';
    }
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

// Oppdater header med initialer og dato
function updateHeaderInfo() {
    if (!appState.currentTechnician) {
        console.warn('Ingen tekniker-info tilgjengelig for header');
        return;
    }

    // Async funksjon for header-rendering, kjøres uten await for ikke å blokkere UI-tråden
    renderAppHeader({
        backUrl: 'home.html',
        subtitle: 'Planlagte service',
        technician: appState.currentTechnician,
        showDate: true
    });
}
})();