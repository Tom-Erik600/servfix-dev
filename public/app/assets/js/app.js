// air-tech-app/assets/js/app.js - Hovedapplikasjon for tekniker-app
(function() {
    function isDashboardPage(pathname = window.location.pathname) {
        return pathname.endsWith('index.html') ||
               pathname.endsWith('index2.html') ||
               pathname === '/' ||
               pathname.endsWith('/app/');
    }

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
    // allAvailableOrders: alle pool-oppdrag for inneværende måned (brukes til kalender-prikker)
    // Strategi: henter alltid ?range=month fra backend og filtrerer klient-side.
    // Dette gir én API-kall og forenkler logikken.
    allAvailableOrders: [],
    // availableOrders: filtrert subset basert på valgt pool_filter_range (brukes til liste-visning)
    availableOrders: [],
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
    getAvailable: (range = 'today') => AirTechAPI.request('/orders/available?range=' + encodeURIComponent(range)),
    claimOrder: (id) => AirTechAPI.request(`/orders/${id}/claim`, { method: 'POST' }),
    getCustomers: () => AirTechAPI.request('/customers'),
    getTechnicians: () => AirTechAPI.request('/technicians'),
    getEquipment: () => AirTechAPI.request('/equipment')
};

// ── Pool-filter helpers ───────────────────────────────────────────
const POOL_RANGES = ['today', 'tomorrow', 'week', 'month'];

function getPoolFilterRange() {
    const stored = sessionStorage.getItem('pool_filter_range');
    return POOL_RANGES.includes(stored) ? stored : 'today';
}

function setPoolFilterRange(range) {
    if (!POOL_RANGES.includes(range)) range = 'today';
    sessionStorage.setItem('pool_filter_range', range);
}

/**
 * Filtrerer pool-oppdrag klient-side basert på valgt range.
 * Pool-oppdrag uten scheduled_date (NULL) vises alltid uansett range.
 * Bruker ISO-datostreng-sammenligning (YYYY-MM-DD) for å unngå tidssone-problemer
 * og feil ved midnatt vs. noon-timestamp-sammenligning.
 */
function filterPoolOrders(allOrders, range) {
    const addDays = (date, days) => {
        const d = new Date(date);
        d.setDate(d.getDate() + days);
        return toISODateString(d);
    };

    const todayStr = toISODateString(new Date());
    const cutoffStr = {
        today:    todayStr,
        tomorrow: addDays(new Date(), 1),
        week:     addDays(new Date(), 7),
        month:    toISODateString(new Date(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate())),
    }[range] || todayStr;

    return allOrders.filter(o => {
        if (!o.scheduled_date) return true; // Alltid vis oppdrag uten dato
        // String-sammenligning fungerer korrekt for YYYY-MM-DD format
        return o.scheduled_date <= cutoffStr;
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    // SJEKK 1: Er vi på riktig side?
    const currentPath = window.location.pathname;
    const isIndexPage = isDashboardPage(currentPath);
    
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

        // Hent ordre og ledige oppdrag (alltid month for å ha full data til kalender-prikker)
        const [orders, allAvailableOrders] = await Promise.all([
            AirTechAPI.getOrders(),
            AirTechAPI.getAvailable('month')
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

        appState.allAvailableOrders = allAvailableOrders || [];
        appState.availableOrders = filterPoolOrders(appState.allAvailableOrders, getPoolFilterRange());

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
        const isIndexPage = isDashboardPage(currentPath);
        
        if (!isIndexPage) return;
        
        // Reload ordre og ledige oppdrag (alltid month for kalender-prikker)
        try {
            const [orders, allAvailableOrders] = await Promise.all([
                AirTechAPI.getOrders(),
                AirTechAPI.getAvailable('month')
            ]);
            
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
            appState.allAvailableOrders = allAvailableOrders || [];
            appState.availableOrders = filterPoolOrders(appState.allAvailableOrders, getPoolFilterRange());
            
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
    updateAvailableCard();
    updateNavigationText();
    updateHeaderInfo(); // <-- LEGG TIL DENNE LINJEN
    updateSectionVisibility();
}

function updateSectionVisibility() {
    // Vanlige seksjoner: skjul hvis tom
    const otherSections = [
        { card: document.querySelector('.orders-card'),   countId: 'selected-date-count' },
        { card: document.querySelector('.upcoming-card'), countId: 'upcoming-count' },
        { card: document.querySelector('.ongoing-card'),  countId: 'unfinished-count' },
    ];

    let allEmpty = true;
    otherSections.forEach(({ card, countId }) => {
        if (!card) return;
        const count = parseInt(document.getElementById(countId)?.textContent || '0', 10);
        card.style.display = count === 0 ? 'none' : '';
        if (count > 0) allEmpty = false;
    });

    // Available-card: skjul kun hvis det overhodet ikke finnes pool-oppdrag (på tvers av alle perioder).
    // Hvis filteret returnerte 0 men allAvailableOrders har noe, vises seksjonen med hjelpemelding.
    const availableCard = document.querySelector('.available-card');
    if (availableCard) {
        const hasAnyPoolOrders = (appState.allAvailableOrders || []).length > 0;
        availableCard.style.display = hasAnyPoolOrders ? '' : 'none';
        if (hasAnyPoolOrders) allEmpty = false;
    }

    const container = document.getElementById('status-cards-container');
    if (!container) return;

    let emptyMsg = document.getElementById('no-orders-message');
    if (allEmpty) {
        if (!emptyMsg) {
            emptyMsg = document.createElement('div');
            emptyMsg.id = 'no-orders-message';
            emptyMsg.innerHTML = '<div class="placeholder-text" style="text-align:center;padding:32px 16px;"><strong>Ingen oppdrag akkurat nå</strong><br><span style="font-size:13px;color:#9ca3af;margin-top:4px;display:block;">Du er oppdatert. Sjekk tilbake senere.</span></div>';
            container.appendChild(emptyMsg);
        } else {
            emptyMsg.style.display = '';
        }
    } else if (emptyMsg) {
        emptyMsg.style.display = 'none';
    }
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

function updateAvailableCard() {
    const countEl = document.getElementById('available-count');
    const containerEl = document.getElementById('available-orders');
    if (!countEl || !containerEl) return;

    const orders = appState.availableOrders || [];
    countEl.textContent = orders.length;

    // Synkroniser aktiv filter-knapp med sessionStorage
    const currentRange = getPoolFilterRange();
    document.querySelectorAll('.pool-filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.range === currentRange);
    });

    if (orders.length === 0) {
        const allEmpty = (appState.allAvailableOrders || []).length === 0;
        if (allEmpty) {
            containerEl.innerHTML = '<div class="placeholder-text">Ingen ledige oppdrag akkurat nå</div>';
        } else {
            // Det finnes oppdrag i en bredere periode — hjelp brukeren
            containerEl.innerHTML = '<div class="placeholder-text">Ingen ledige oppdrag i denne perioden — prøv +1 uke eller +1 mnd</div>';
        }
        return;
    }

    containerEl.innerHTML = orders.map(order => {
        const _d = order.scheduled_date ? new Date(order.scheduled_date + 'T12:00:00') : null;
        const dato = (_d && !isNaN(_d))
            ? _d.toLocaleDateString('no-NO', { day: 'numeric', month: 'short' })
            : null;

        // Tittel og undertekst
        const title = order.description || order.service_type || 'Service';
        const subtitle = order.customer_name || 'Ukjent kunde';

        // Kort ordrenummer (siste 6 tegn av ID-segmentet)
        const parts = (order.id || '').split('-');
        const shortId = parts.length >= 3 ? parts[2].slice(-6) : (order.id || '').slice(-6);

        return `
        <div class="order-card status-pending">
            <div class="order-card-header" style="cursor:default;">
                <div class="order-status-indicator" style="background:#9ca3af;"></div>
                <div class="order-info">
                    <div class="order-title">${title}</div>
                    <div class="order-subtitle">${subtitle}</div>
                </div>
                <div class="order-meta">
                    ${dato ? `<div class="order-time">${dato}</div>` : ''}
                    <div class="order-number">#${shortId}</div>
                </div>
            </div>
            <div class="pool-claim-row">
                <button class="action-btn primary claim-order-btn" data-order-id="${order.id}"
                    style="width:100%;padding:8px;font-size:13px;">
                    Ta oppdraget
                </button>
            </div>
        </div>`;
    }).join('');

    // Event-delegering for claim-knapp (fjern gammel handler først)
    if (containerEl._claimHandler) {
        containerEl.removeEventListener('click', containerEl._claimHandler);
    }

    const claimHandler = async (e) => {
        const btn = e.target.closest('.claim-order-btn');
        if (!btn) return;
        const orderId = btn.dataset.orderId;
        btn.disabled = true;
        btn.textContent = 'Plukker...';
        try {
            await AirTechAPI.claimOrder(orderId);
            // Refresh begge lister — hent alltid med month
            const [orders, allAvailableOrders] = await Promise.all([
                AirTechAPI.getOrders(),
                AirTechAPI.getAvailable('month')
            ]);
            appState.orders = orders.map(order => ({
                ...order,
                scheduledDate: toISODateString(order.scheduled_date || order.scheduledDate),
                scheduledTime: order.scheduled_time || order.scheduledTime || null,
                serviceType: order.service_type || order.serviceType || 'Service',
                customerId: order.customer_id || order.customerId || null,
                customerName: order.customer_name || order.customerName || 'Ukjent Kunde',
                customerData: order.customer_data || order.customerData || null,
                technicianId: order.technician_id || order.technicianId || null,
                orderNumber: order.order_number || order.orderNumber || order.id,
                status: order.status || 'scheduled',
                description: order.description || null
            }));
            appState.allAvailableOrders = allAvailableOrders || [];
            appState.availableOrders = filterPoolOrders(appState.allAvailableOrders, getPoolFilterRange());
            renderAll();
            showToast('Oppdrag plukket!', 'success');
        } catch (error) {
            if (error.message && (error.message.includes('409') || error.message === 'Oppdrag allerede tatt')) {
                showToast('Oppdraget er allerede tatt', 'error');
            } else {
                showToast('Kunne ikke plukke oppdrag', 'error');
            }
            // Refresh available-listen uansett
            try {
                appState.allAvailableOrders = await AirTechAPI.getAvailable('month');
                appState.availableOrders = filterPoolOrders(appState.allAvailableOrders, getPoolFilterRange());
                updateAvailableCard();
                updateSectionVisibility();
            } catch (_) {}
        }
    };

    containerEl._claimHandler = claimHandler;
    containerEl.addEventListener('click', claimHandler);
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
            'unfinished': 'Ingen uferdige ordre',
            'available': 'Ingen ledige oppdrag'
        };
        containerEl.innerHTML = `<div class="placeholder-text">${placeholderTexts[type] || 'Ingen ordre'}</div>`;
    }
}

function createOrderCardHTML(order, listType) {
    const customerName = order.customerName || 'Ukjent kunde';
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

    const description = order.description || 'Ingen beskrivelse';
    const address = order.customerData?.physicalAddress || '';
    const contactName = order.customerData?.contact || '';
    const contactPhone = order.customerData?.contactPhone || order.customerData?.phone || '';
    const contactEmail = order.customerData?.contactEmail || order.customerData?.email || '';
    const hasAnyFilters = Array.isArray(order.equipment) && order.equipment.some(eq => eq.hasFilters || eq.has_filters);

    return `
        <div class="order-card ${isExpanded ? 'expanded' : ''} status-${derivedStatus}" data-card-key="${cardKey}">
            <div class="order-card-header">
                <div class="order-status-indicator status-${derivedStatus}"></div>
                <div class="order-info">
                    <div class="order-title">${description}</div>
                    <div class="order-subtitle">${statusMap[derivedStatus] || derivedStatus}</div>
                </div>
                <div class="order-meta">
                    <div class="order-time">${timeDisplay}</div>
                    <div class="order-number">#${(order.orderNumber || order.id).slice(-6)}</div>
                </div>
                ${hasAnyFilters ? `<button class="filter-info-btn" onclick="event.stopPropagation(); showFilterModal(${JSON.stringify(order.equipment).replace(/"/g, '&quot;')})" title="Vis filterliste" style="background:none;border:none;cursor:pointer;padding:4px 6px;color:#92400e;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg></button>` : ''}
            </div>
            ${isExpanded ? `
                <div class="order-card-details">
                    <div class="customer-info-section">
                        <div class="customer-info-grid">
                            <div class="info-item full-width">
                                <span class="info-label">Kunde</span>
                                <span class="info-value">${customerName}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Kontaktperson</span>
                                <span class="info-value">${contactName || '–'}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Telefon</span>
                                <span class="info-value">${contactPhone ? `<a href="tel:${contactPhone}" class="info-link">${contactPhone}</a>` : '–'}</span>
                            </div>
                            <div class="info-item full-width">
                                <span class="info-label">E-post</span>
                                <span class="info-value">${contactEmail ? `<a href="mailto:${contactEmail}" class="info-link">${contactEmail}</a>` : '–'}</span>
                            </div>
                            <div class="info-item full-width">
                                <span class="info-label">Besøksadresse</span>
                                <span class="info-value">${address || '–'}</span>
                            </div>
                        </div>
                    </div>

                    <button class="action-btn primary open-order-btn" data-order-id="${order.id}">
                        Åpne ordre →
                    </button>
                </div>
            ` : ''}
        </div>
    `;
}

function showFilterModal(equipment) {
    const filterLines = equipment.filter(eq => eq.hasFilters || eq.has_filters).map(eq => {
        const filters = [
            (eq.filterSupply || eq.filter_supply)               ? 'Tilluftsfilter'          + ((eq.filterSupplyText        || eq.filter_supply_text)        ? `: ${eq.filterSupplyText        || eq.filter_supply_text}`        : '') : null,
            (eq.filterExhaust || eq.filter_exhaust)             ? 'Avtrekksfilter'          + ((eq.filterExhaustText       || eq.filter_exhaust_text)       ? `: ${eq.filterExhaustText       || eq.filter_exhaust_text}`       : '') : null,
            (eq.filterDriveSupply || eq.filter_drive_supply)    ? 'Drivreim tilluftsvifte'  + ((eq.filterDriveSupplyText   || eq.filter_drive_supply_text)   ? `: ${eq.filterDriveSupplyText   || eq.filter_drive_supply_text}`   : '') : null,
            (eq.filterDriveExhaust || eq.filter_drive_exhaust)  ? 'Drivrem avtrekksvifte'   + ((eq.filterDriveExhaustText  || eq.filter_drive_exhaust_text)  ? `: ${eq.filterDriveExhaustText  || eq.filter_drive_exhaust_text}`  : '') : null
        ].filter(Boolean);
        return `<div style="margin-bottom:12px;"><strong>${eq.systemnavn || 'Anlegg'}</strong><ul style="margin:4px 0 0 16px;padding:0;">${filters.map(f => `<li style="margin:2px 0;">${f}</li>`).join('')}</ul></div>`;
    }).join('');

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `<div style="background:#fff;border-radius:12px;padding:24px;max-width:400px;width:90%;max-height:80vh;overflow-y:auto;"><h3 style="margin:0 0 16px;">Filterliste</h3>${filterLines}<button onclick="this.closest('[style*=fixed]').remove()" style="margin-top:16px;padding:8px 20px;background:#1d4ed8;color:#fff;border:none;border-radius:8px;cursor:pointer;width:100%;">Lukk</button></div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
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

    // Pool-filter-knapper
    const filterBar = document.getElementById('pool-filter-bar');
    if (filterBar) {
        filterBar.addEventListener('click', async (e) => {
            const btn = e.target.closest('.pool-filter-btn');
            if (!btn) return;
            const newRange = btn.dataset.range;
            if (!POOL_RANGES.includes(newRange)) return;

            setPoolFilterRange(newRange);
            appState.availableOrders = filterPoolOrders(appState.allAvailableOrders, newRange);
            updateAvailableCard();
            updateSectionVisibility();
        });
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

    // Pool-oppdrag på denne datoen (grå prikk) — bruker allAvailableOrders (full måneds-data)
    // slik at kalender-prikker ikke påvirkes av valgt filter (kjent begrensning: kun innenfor 1 mnd)
    const hasPoolOrders = (appState.allAvailableOrders || []).some(o => o.scheduled_date === dateStr);

    // Posisjonér to prikker side ved side hvis begge finnes
    const ownIndicatorStyle = (hasPoolOrders && indicatorClass) ? 'left:3px;right:auto;' : '';
    const poolIndicatorStyle = (hasPoolOrders && indicatorClass) ? 'right:3px;left:auto;background-color:#9ca3af;' : 'background-color:#9ca3af;';

    return `<div class="${classes.join(' ')}" data-date="${dateStr}">
        <span class="day-number">${date.getDate()}</span>
        ${indicatorClass ? `<span class="service-indicator ${indicatorClass}"${ownIndicatorStyle ? ` style="${ownIndicatorStyle}"` : ''}></span>` : ''}
        ${hasPoolOrders ? `<span class="service-indicator" style="${poolIndicatorStyle}"></span>` : ''}
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
