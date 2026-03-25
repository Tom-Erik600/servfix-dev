(function() {
    if (!window.location.pathname.endsWith('index2.html')) {
        return;
    }

    const today = new Date();

    const appState = {
        loading: false,
        currentView: 'week',
        selectedDate: new Date(today),
        currentPeriod: new Date(today),
        expandedCardKey: null,
        orders: [],
        calendarSummary: {},
        currentTechnician: null,
        headerSubtitle: 'Planlagte service',
        headerRendered: false
    };

    const norwegianMonths = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember'];

    function toISODateString(date) {
        if (!date) return null;

        if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return date;
        }

        const parsed = typeof date === 'string' ? new Date(date) : new Date(date);
        if (Number.isNaN(parsed.getTime())) return null;

        const year = parsed.getFullYear();
        const month = String(parsed.getMonth() + 1).padStart(2, '0');
        const day = String(parsed.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    const DashboardAPI = {
        async getDashboard() {
            const params = new URLSearchParams({
                date: toISODateString(appState.selectedDate),
                view: appState.currentView,
                period: toISODateString(appState.currentPeriod)
            });

            const response = await fetch(`/api/dashboard-v2?${params.toString()}`, {
                credentials: 'include'
            });

            if (!response.ok) {
                if (response.status === 401) {
                    window.location.href = 'login.html';
                    return null;
                }

                let errorMessage = `HTTP error! status: ${response.status}`;
                try {
                    const error = await response.json();
                    errorMessage = error.error || errorMessage;
                } catch (parseError) {
                    // Ignore parse errors and keep fallback message.
                }
                throw new Error(errorMessage);
            }

            return response.json();
        }
    };

    document.addEventListener('DOMContentLoaded', async () => {
        setLoadingState(true);

        try {
            await window.authManager.waitForInitialization();

            if (!window.authManager.isLoggedIn()) {
                setLoadingState(false);
                return;
            }

            const user = window.authManager.getCurrentUser();
            appState.currentTechnician = user.technician;

            setupEventListeners();
            await refreshDashboardData();
        } catch (error) {
            console.error('Feil ved initialisering av dashboard v2:', error);
            showToast('Kunne ikke laste dashboard', 'error');
        } finally {
            setLoadingState(false);
        }
    });

    window.addEventListener('pageshow', async (event) => {
        if (!window.location.pathname.endsWith('index2.html')) return;

        const navigationEntry = performance.getEntriesByType('navigation')[0];
        if (event.persisted || navigationEntry?.type === 'back_forward') {
            try {
                await refreshDashboardData(false);
            } catch (error) {
                console.error('Kunne ikke oppdatere dashboard v2:', error);
            }
        }
    });

    async function refreshDashboardData(showLoader = true) {
        if (showLoader) {
            setLoadingState(true);
        }

        try {
            const payload = await DashboardAPI.getDashboard();
            if (!payload) return;

            appState.orders = Array.isArray(payload.orders) ? payload.orders : [];
            appState.calendarSummary = payload.calendarSummary || {};
            appState.headerSubtitle = payload.header?.subtitle || 'Planlagte service';

            renderAll();
        } finally {
            if (showLoader) {
                setLoadingState(false);
            }
        }
    }

    function renderAll() {
        renderCalendar();
        updateStatusCards();
        updateNavigationText();
        updateHeaderInfo();
    }

    function deriveOrderStatus(order) {
        return order.derivedStatus || order.status || 'scheduled';
    }

    function updateStatusCards() {
        const selectedDateStr = toISODateString(appState.selectedDate);
        const ordersForSelectedDate = appState.orders.filter((order) => order.scheduledDate === selectedDateStr);
        updateCard('selected-date', ordersForSelectedDate);

        const weekStart = new Date(appState.currentPeriod);
        let dayOfWeek = weekStart.getDay();
        dayOfWeek = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        weekStart.setDate(weekStart.getDate() - dayOfWeek);

        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);

        const todayStr = toISODateString(new Date());
        const upcomingOrders = appState.orders.filter((order) => {
            if (!order.scheduledDate) return false;
            if (deriveOrderStatus(order) === 'completed') return false;

            const orderDate = new Date(`${order.scheduledDate}T12:00:00`);
            return order.scheduledDate >= todayStr && orderDate <= weekEnd;
        });
        updateCard('upcoming', upcomingOrders);

        const unfinishedOrders = appState.orders.filter((order) => deriveOrderStatus(order) === 'in_progress');
        updateCard('unfinished', unfinishedOrders);
    }

    function updateCard(type, orders) {
        const countEl = document.getElementById(`${type}-count`);
        const containerEl = document.getElementById(`${type}-orders`);

        if (!countEl || !containerEl) return;

        countEl.textContent = orders.length;

        if (orders.length > 0) {
            containerEl.innerHTML = orders.map((order) => createOrderCardHTML(order, type)).join('');

            const oldHandler = containerEl._clickHandler;
            if (oldHandler) {
                containerEl.removeEventListener('click', oldHandler);
            }

            const clickHandler = (event) => {
                const card = event.target.closest('.order-card');
                if (card && !event.target.closest('.open-order-btn')) {
                    const cardKey = card.dataset.cardKey;
                    if (cardKey) toggleOrderCard(cardKey);
                }

                const openBtn = event.target.closest('.open-order-btn');
                if (openBtn) {
                    event.stopPropagation();
                    const orderId = openBtn.dataset.orderId;
                    window.location.href = `orders.html?id=${orderId}`;
                }
            };

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
        const customerName = order.customerName || 'Ukjent kunde';
        const cardKey = `${listType}-${order.id}`;
        const isExpanded = appState.expandedCardKey === cardKey;
        const derivedStatus = deriveOrderStatus(order);
        const statusMap = {
            scheduled: 'Planlagt',
            in_progress: 'Pågår',
            completed: 'Fullført',
            pending: 'Venter'
        };

        let timeDisplay = 'Ikke planlagt';
        if (order.scheduledDate) {
            const orderDate = new Date(`${order.scheduledDate}T12:00:00`);
            timeDisplay = orderDate.toLocaleDateString('no-NO', {
                day: 'numeric',
                month: 'short'
            });
            if (order.scheduledTime) {
                timeDisplay += ` kl. ${order.scheduledTime}`;
            }
        }

        const address = order.customerData?.physicalAddress || '';
        const contactName = order.customerData?.contact || '';
        const contactPhone = order.customerData?.contactPhone || order.customerData?.phone || '';
        const contactEmail = order.customerData?.contactEmail || order.customerData?.email || '';

        return `
            <div class="order-card ${isExpanded ? 'expanded' : ''} status-${derivedStatus}" data-card-key="${cardKey}">
                <div class="order-card-header">
                    <div class="order-status-indicator status-${derivedStatus}"></div>
                    <div class="order-info">
                        <div class="order-title">${order.description || 'Ingen beskrivelse'}</div>
                        <div class="order-subtitle">${statusMap[derivedStatus] || derivedStatus}</div>
                    </div>
                    <div class="order-meta">
                        <div class="order-time">${timeDisplay}</div>
                        <div class="order-number">#${String(order.orderNumber || order.id).slice(-6)}</div>
                    </div>
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

    function updateNavigationText() {
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
        const calendarControls = document.querySelector('.calendar-controls');
        if (calendarControls) {
            calendarControls.addEventListener('click', handleCalendarControls);
        }
    }

    function toggleOrderCard(cardKey) {
        appState.expandedCardKey = appState.expandedCardKey === cardKey ? null : cardKey;
        updateStatusCards();
    }

    function createCalendarDay(date, isMonthView = false) {
        const dateStr = toISODateString(date);
        const todayStr = toISODateString(today);
        const selectedDateStr = toISODateString(appState.selectedDate);
        const baseClass = isMonthView ? 'month-day' : 'calendar-day';
        const classes = [baseClass];

        if (dateStr === todayStr) classes.push('is-today');
        if (dateStr === selectedDateStr) classes.push('selected');

        const daySummary = appState.calendarSummary[dateStr];
        let indicatorClass = '';

        if (daySummary) {
            if (daySummary.status === 'completed') {
                classes.push('all-completed');
                indicatorClass = 'completed';
            } else if (daySummary.status === 'in_progress') {
                indicatorClass = 'in-progress';
            } else {
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

        const current = new Date(appState.currentPeriod);
        let dayOfWeek = current.getDay();
        dayOfWeek = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        const weekStart = new Date(current.setDate(current.getDate() - dayOfWeek));

        let daysHTML = '';
        for (let i = 0; i < 7; i += 1) {
            const date = new Date(weekStart);
            date.setDate(weekStart.getDate() + i);
            daysHTML += createCalendarDay(date, false);
        }

        daysContainer.innerHTML = daysHTML;
        daysContainer.querySelectorAll('.calendar-day').forEach((day) => {
            day.addEventListener('click', (event) => selectDate(event.currentTarget.dataset.date));
        });
    }

    function renderMonthView() {
        const monthDaysContainer = document.getElementById('month-days');
        if (!monthDaysContainer) return;

        const currentMonth = appState.currentPeriod.getMonth();
        const firstDayOfMonth = new Date(appState.currentPeriod.getFullYear(), currentMonth, 1);

        let dayOfWeek = firstDayOfMonth.getDay();
        dayOfWeek = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

        const currentDate = new Date(firstDayOfMonth);
        currentDate.setDate(currentDate.getDate() - dayOfWeek);

        let daysHTML = '';
        for (let i = 0; i < 42; i += 1) {
            daysHTML += createCalendarDay(new Date(currentDate), true);
            currentDate.setDate(currentDate.getDate() + 1);
        }

        monthDaysContainer.innerHTML = daysHTML;
        monthDaysContainer.querySelectorAll('.month-day').forEach((day) => {
            day.addEventListener('click', (event) => selectDate(event.currentTarget.dataset.date));
        });
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
            const weekStart = new Date(appState.currentPeriod);
            let dayOfWeek = weekStart.getDay();
            dayOfWeek = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
            weekStart.setDate(weekStart.getDate() - dayOfWeek);

            const getWeekNumber = (date) => {
                const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
                utcDate.setUTCDate(utcDate.getUTCDate() + 4 - (utcDate.getUTCDay() || 7));
                const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
                return Math.ceil((((utcDate - yearStart) / 86400000) + 1) / 7);
            };

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

        switch (target.dataset.action) {
            case 'prev-period':
                navigatePeriod(-1);
                break;
            case 'next-period':
                navigatePeriod(1);
                break;
            case 'set-view':
                setView(target.dataset.view);
                break;
            default:
                break;
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
        const weekCal = document.getElementById('week-calendar');
        const monthCal = document.getElementById('month-calendar');

        if (weekBtn) weekBtn.classList.toggle('active', view === 'week');
        if (monthBtn) monthBtn.classList.toggle('active', view === 'month');
        if (weekCal) weekCal.classList.toggle('hidden', view !== 'week');
        if (monthCal) monthCal.classList.toggle('hidden', view !== 'month');

        renderAll();
    }

    function selectDate(dateStr) {
        const [year, month, day] = dateStr.split('-').map(Number);
        appState.selectedDate = new Date(year, month - 1, day, 12);
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
        container.appendChild(toast);

        requestAnimationFrame(() => toast.classList.add('show'));
        setTimeout(() => toast.remove(), 3000);
    }

    function updateHeaderInfo() {
        if (!appState.currentTechnician || typeof renderAppHeader !== 'function') {
            return;
        }

        if (appState.headerRendered) {
            return;
        }

        renderAppHeader({
            backUrl: 'home.html',
            subtitle: appState.headerSubtitle,
            technician: appState.currentTechnician,
            showDate: true
        });

        appState.headerRendered = true;
    }
})();
