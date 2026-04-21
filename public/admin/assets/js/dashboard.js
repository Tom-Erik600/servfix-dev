// Fil: public/admin/assets/js/dashboard.js

document.addEventListener('DOMContentLoaded', loadDashboardData);

// Global ordre-data for modal-tilgang
let dashboardOrders = [];
let dashboardTechnicians = [];

async function loadDashboardData() {
    try {
        // Hent data fra API
        const [ordersResponse, customersResponse, techniciansResponse, reportsResponse, quotesResponse] = await Promise.all([
            fetch('/api/admin/orders', { credentials: 'include' }),
            fetch('/api/admin/customers', { credentials: 'include' }),
            fetch('/api/admin/technicians', { credentials: 'include' }),
            fetch('/api/admin/reports', { credentials: 'include' }),
            fetch('/api/quotes', { credentials: 'include' })
        ]);
        
        if (!ordersResponse.ok || !customersResponse.ok || !techniciansResponse.ok || !reportsResponse.ok) {
            throw new Error('Failed to fetch dashboard data');
        }
        
        const orders = await ordersResponse.json();
        const customers = await customersResponse.json();
        const technicians = await techniciansResponse.json();
        const reportsData = await reportsResponse.json();
        
        let quotes = [];
        if (quotesResponse.ok) {
            quotes = await quotesResponse.json();
        } else {
            console.error("Klarte ikke å hente tilbudsdata:", quotesResponse.statusText);
        }

        // Handle both array and object responses
        const ordersArray = Array.isArray(orders) ? orders : (orders.data || orders.orders || []);
        const customersArray = Array.isArray(customers) ? customers : (customers.data || customers.customers || []);
        const techniciansArray = Array.isArray(technicians) ? technicians : (technicians.data || technicians.technicians || []);
        
        // Extract reports array from response object
        const reportsArray = reportsData.reports || [];
        
        if (ordersArray.length === 0) {
            console.warn('⚠️ Ingen ordre funnet! Sjekk at det finnes ordre i databasen.');
        }
        
        populateDashboard(ordersArray, customersArray, techniciansArray, reportsArray, quotes);
    } catch (error) {
        console.error("Klarte ikke å laste data for dashbordet:", error);
        showErrorState();
    }
}

function populateDashboard(orders, customers, technicians, reports, quotes) {
    // Sjekk at vi har gyldige arrays
    orders = orders || [];
    customers = customers || [];
    technicians = technicians || [];
    reports = reports || [];
    quotes = quotes || [];
    
    // Lagre globalt for modal-tilgang
    dashboardOrders = orders;
    dashboardTechnicians = technicians;
    
    // Bygg customer map - sjekk både name og customer_name
    const customerMap = new Map();
    customers.forEach(c => {
        const name = c.name || c.customer_name;
        if (c.id && name) {
            customerMap.set(c.id, name);
        }
    });
    
    // Bygg technician map
    const technicianMap = new Map();
    technicians.forEach(t => {
        const name = t.name || t.technician_name;
        if (t.id && name) {
            technicianMap.set(t.id, name);
        }
    });

    populateKpiCards(orders, technicians, reports, quotes);
    populateTodaysTable(orders, customerMap, technicianMap);
    populateWeeklyTable(orders, customerMap, technicianMap);
    populateUnfinishedTable(orders, customerMap, technicianMap); // NY
    
    // Gjør KPI-kortene klikkbare
    makeKpiCardsClickable();
}

function getDeleteState(order) {
    const rawStatus = order.status;
    const hasServiceReports = order.has_service_reports === true || order.has_service_reports === 'true';
    const hasQuotes = order.has_quotes === true || order.has_quotes === 'true';

    if (!['pending', 'scheduled'].includes(rawStatus)) {
        return {
            canDelete: false,
            reason: 'Kun ventende og planlagte ordre kan slettes'
        };
    }

    if (hasServiceReports) {
        return {
            canDelete: false,
            reason: 'Kan ikke slettes fordi ordren har servicerapporter'
        };
    }

    if (hasQuotes) {
        return {
            canDelete: false,
            reason: 'Kan ikke slettes fordi ordren har tilbud'
        };
    }

    return {
        canDelete: true,
        reason: 'Slett ordre'
    };
}

function renderDeleteButton(order, orderNumber, customerName) {
    const deleteState = getDeleteState(order);

    if (deleteState.canDelete) {
        return `<button onclick="confirmDeleteOrder('${order.id}', '${orderNumber}', '${customerName.replace(/'/g, "\\'")}')" style="padding:4px 10px; background:none; border:1px solid #E5E7EB; color:#DC2626; border-radius:6px; cursor:pointer; font-size:12px;" title="Slett ordre">🗑️</button>`;
    }

    return '';
}

function populateKpiCards(orders, technicians, reports, quotes) {
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date();
    const startOfWeek = getStartOfWeek(now);
    
    // Sjekk at vi har data
    if (!Array.isArray(orders)) {
        console.error('Orders is not an array:', orders);
        orders = [];
    }
    
    if (!Array.isArray(reports)) {
        console.error('Reports is not an array:', reports);
        reports = [];
    }

    // Først sjekk om vi har noen ordre med norsk status
    const norwegianStatusOrders = orders.filter(o => 
        o.status === 'Fullført' || o.status === 'fullført'
    );
    
    const allCompletedOrders = orders.filter(o => o.status === 'completed');
    
    // Oppdrag i dag - ordre planlagt for i dag
    const todaysOrders = orders.filter(o => {
        const dateField = o.scheduledDate || o.scheduled_date;
        if (!dateField) return false;
        
        const orderDate = parseDate(dateField);
        if (!orderDate) return false;
        
        const orderDateString = formatDateShort(orderDate);
        const matches = orderDateString === today;
        
        return matches;
    });
    const oppdragIDag = todaysOrders.length;
    
    // Fullførte denne uken - ordre med status 'completed' denne uken
    // VIKTIG: For fullførte ordre, sjekk completed_at dato (når de faktisk ble fullført), 
    // ikke scheduled_date (når de var planlagt). Dette sikrer at ordre planlagt for 
    // andre uker men fullført denne uken blir telt med.
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);
    
    const fullfortUke = orders.filter(o => {
        // Må være fullført
        if (o.status !== 'completed') return false;
        
        // For fullførte ordre, bruk completed_at hvis tilgjengelig, ellers scheduled_date
        // Prioritet: completed_at > completedAt > updated_at > updatedAt > scheduled_date
        const dateToCheck = o.completed_at || 
                           o.completedAt || 
                           o.updated_at || 
                           o.updatedAt || 
                           o.scheduledDate || 
                           o.scheduled_date;
                           
        if (!dateToCheck) {
            return false;
        }
        
        const orderDate = parseDate(dateToCheck);
        if (!orderDate) return false;
        
        // Normaliser dato til start av dagen for sammenligning
        const orderDateNormalized = new Date(orderDate);
        orderDateNormalized.setHours(0, 0, 0, 0);
        
        // Sjekk om ordren ble fullført i denne uken
        const isInWeek = orderDateNormalized >= startOfWeek && orderDateNormalized <= endOfWeek;
        
        return isInWeek;
    }).length;

    const completedInTableView = orders.filter(o => {
        if (o.status !== 'completed') return false;
        const dateField = o.scheduledDate || o.scheduled_date;
        if (!dateField) return false;
        const orderDate = parseDate(dateField);
        if (!orderDate) return false;
        const orderDateNormalized = new Date(orderDate);
        orderDateNormalized.setHours(0, 0, 0, 0);
        return orderDateNormalized >= startOfWeek && orderDateNormalized <= endOfWeek;
    }).length;
    
    if (completedInTableView !== fullfortUke) {
        // KPI teller basert på completed_at, tabellen viser basert på scheduled_date
        // Forskjell er forventet når ordre fullføres i en annen uke enn planlagt
    }
    
    // Rapporter ikke sendt - rapporter som er klare men ikke sendt til kunde
    // Dette er rapporter som har pdf_generated=true men sent_til_fakturering=false
    const rapporterIkkeSendt = reports.filter(r => 
        r.pdf_generated && !r.sent_til_fakturering
    ).length;

    // Venter på fakturering - ALLE rapporter som ikke er fakturert
    // Dette inkluderer både sendte og ikke-sendte rapporter som har generert PDF
    const venterFakturering = reports.filter(r => 
        !r.is_invoiced && r.pdf_generated  // Må ha generert PDF for å kunne faktureres
    ).length;

    // Tilbud venter på godkjenning
    const tilbudVenter = Array.isArray(quotes) 
        ? quotes.filter(q => q.status === 'pending' || q.status === 'sent').length
        : 0;

    // Oppdater HTML-elementene
    updateKpiElement('kpi-oppdrag-idag', oppdragIDag);
    updateKpiElement('kpi-fullfort-uke', fullfortUke);
    updateKpiElement('kpi-rapporter-ikke-sendt', rapporterIkkeSendt);
    updateKpiElement('kpi-tilbud-venter', tilbudVenter);
    updateKpiElement('kpi-venter-fakturering', venterFakturering);
}

function makeKpiCardsClickable() {
    // Gjør "Rapporter ikke sendt" klikkbar
    const rapporterKort = document.querySelector('#kpi-rapporter-ikke-sendt').closest('.kpi-card');
    if (rapporterKort) {
        rapporterKort.style.cursor = 'pointer';
        rapporterKort.classList.add('clickable');
        rapporterKort.addEventListener('click', () => {
            window.location.href = '/admin/rapporter.html';
        });
        // Legg til hover-effekt
        rapporterKort.addEventListener('mouseenter', () => {
            rapporterKort.style.backgroundColor = '#f8fafc';
        });
        rapporterKort.addEventListener('mouseleave', () => {
            rapporterKort.style.backgroundColor = '';
        });
    }
    
    // Gjør "Tilbud venter på godkjenning" klikkbar
    const tilbudKort = document.querySelector('#kpi-tilbud-venter').closest('.kpi-card');
    if (tilbudKort) {
        tilbudKort.style.cursor = 'pointer';
        tilbudKort.classList.add('clickable');
        tilbudKort.addEventListener('click', () => {
            window.location.href = '/admin/tilbud.html';
        });
        // Legg til hover-effekt
        tilbudKort.addEventListener('mouseenter', () => {
            tilbudKort.style.backgroundColor = '#f8fafc';
        });
        tilbudKort.addEventListener('mouseleave', () => {
            tilbudKort.style.backgroundColor = '';
        });
    }
    
    // Gjør "Venter på fakturering" klikkbar
    const faktureringKort = document.querySelector('#kpi-venter-fakturering').closest('.kpi-card');
    if (faktureringKort) {
        faktureringKort.style.cursor = 'pointer';
        faktureringKort.classList.add('clickable');
        faktureringKort.addEventListener('click', () => {
            window.location.href = '/admin/rapporter.html';
        });
        // Legg til hover-effekt
        faktureringKort.addEventListener('mouseenter', () => {
            faktureringKort.style.backgroundColor = '#f8fafc';
        });
        faktureringKort.addEventListener('mouseleave', () => {
            faktureringKort.style.backgroundColor = '';
        });
    }
}

function updateKpiElement(elementId, value) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = value;
        // Legg til animasjon når tallet oppdateres
        element.classList.add('updated');
        setTimeout(() => element.classList.remove('updated'), 300);
    }
}

function populateTodaysTable(orders, customerMap, technicianMap) {
    const today = new Date().toISOString().slice(0, 10);
    const todaysOrders = orders.filter(o => {
        const dateField = o.scheduledDate || o.scheduled_date;
        if (!dateField) return false;
        
        const orderDate = parseDate(dateField);
        return orderDate && orderDate.toISOString().slice(0, 10) === today;
    });
    
    const tbody = document.getElementById('dagens-oppdrag-liste');
    if (!tbody) return;
    
    tbody.innerHTML = '';

    if (todaysOrders.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 40px; color: #9CA3AF;">
                    <div style="font-size: 48px; margin-bottom: 10px;">☀️</div>
                    <div style="font-weight: 500;">Ingen oppdrag planlagt for i dag</div>
                    <div style="font-size: 14px; margin-top: 8px;">Nyt dagen!</div>
                </td>
            </tr>`;
        return;
    }
    
    // Sorter etter tid, deretter etter status
    todaysOrders.sort((a, b) => {
        const timeA = a.scheduledTime || a.scheduled_time || '00:00';
        const timeB = b.scheduledTime || b.scheduled_time || '00:00';
        
        if (timeA !== timeB) {
            return timeA.localeCompare(timeB);
        }
        
        // Hvis samme tid, prioriter basert på status
        const statusPriority = {
            'in_progress': 1,
            'scheduled': 2,
            'pending': 3,
            'completed': 4,
            'cancelled': 5
        };
        
        return (statusPriority[a.status] || 999) - (statusPriority[b.status] || 999);
    });

    tbody.innerHTML = todaysOrders.map(order => {
        const isCompleted = order.status === 'completed';
        const rowStyle = isCompleted ? 'opacity: 0.7;' : '';
        const orderNumber = order.orderNumber || order.order_number || order.id;
        const customerId = order.customerId || order.customer_id;
        const technicianId = order.technicianId || order.technician_id;
        const serviceType = order.serviceType || order.service_type || 'Service';
        const scheduledDate = parseDate(order.scheduledDate || order.scheduled_date);
        const dateDisplay = scheduledDate ? formatDateNorwegian(scheduledDate) : 'Ikke satt';
        const customerName = customerMap.get(customerId) || order.customerName || order.customer_name || 'Ukjent kunde';
        const deleteBtn = renderDeleteButton(order, orderNumber, customerName);
        
        return `
        <tr style="${rowStyle}">
            <td><strong><a href="#" onclick="openOrderModal('${order.id}'); return false;" style="color:#3b82f6; text-decoration:none; cursor:pointer;">${orderNumber}</a></strong></td>
            <td>${technicianMap.get(technicianId) || '<span style="color: #EF4444;">Ikke tildelt</span>'}</td>
            <td>${customerName}</td>
            <td>${serviceType}</td>
            <td>${dateDisplay}</td>
            <td><span class="status-badge status-${deriveOrderStatus(order) || 'pending'}">${getStatusText(deriveOrderStatus(order))}</span></td>
            <td>${deleteBtn}</td>
        </tr>
    `}).join('');
}

function populateWeeklyTable(orders, customerMap, technicianMap) {
    // MERK: Tabellen viser ordre basert på scheduled_date (når de var planlagt),
    // mens KPI "Fullførte denne uken" teller basert på completed_at (når de ble fullført).
    // Dette betyr at en ordre planlagt neste uke men fullført denne uken vil:
    // - Telles i KPI "Fullførte denne uken" 
    // - IKKE vises i "Denne ukens oppdrag" tabellen
    
    const now = new Date();
    const startOfWeek = getStartOfWeek(now);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999); // Inkluder hele siste dag (søndag)

    const weeklyOrders = orders.filter(o => {
        const dateField = o.scheduledDate || o.scheduled_date;
        if (!dateField) return false;
        
        const orderDate = parseDate(dateField);
        if (!orderDate) return false;
        
        // Reset time for comparison
        const orderDateNormalized = new Date(orderDate);
        orderDateNormalized.setHours(0, 0, 0, 0);
        
        return orderDateNormalized >= startOfWeek && orderDateNormalized <= endOfWeek;
    });
    
    const tbody = document.getElementById('ukens-oppdrag-liste');
    if (!tbody) return;
    
    tbody.innerHTML = '';

    if (weeklyOrders.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 40px; color: #9CA3AF;">
                    <div style="font-size: 48px; margin-bottom: 10px;">📋</div>
                    <div style="font-weight: 500;">Ingen planlagte oppdrag denne uken</div>
                </td>
            </tr>`;
        return;
    }
    
    // Sorter etter dato, deretter etter status
    weeklyOrders.sort((a, b) => {
        const dateA = parseDate(a.scheduledDate || a.scheduled_date);
        const dateB = parseDate(b.scheduledDate || b.scheduled_date);
        
        if (!dateA || !dateB) return 0;
        
        if (dateA.getTime() !== dateB.getTime()) {
            return dateA.getTime() - dateB.getTime();
        }
        
        // Hvis samme dato, prioriter basert på status
        const statusPriority = {
            'in_progress': 1,
            'scheduled': 2,
            'pending': 3,
            'completed': 4,
            'cancelled': 5
        };
        
        return (statusPriority[a.status] || 999) - (statusPriority[b.status] || 999);
    });

    tbody.innerHTML = weeklyOrders.map(order => {
        const isCompleted = order.status === 'completed';
        const rowStyle = isCompleted ? 'opacity: 0.7;' : '';
        const orderNumber = order.orderNumber || order.order_number || order.id;
        const customerId = order.customerId || order.customer_id;
        const technicianId = order.technicianId || order.technician_id;
        const serviceType = order.serviceType || order.service_type || 'Service';
        const scheduledDate = parseDate(order.scheduledDate || order.scheduled_date);
        const dateDisplay = scheduledDate ? formatDateNorwegian(scheduledDate) : 'Ikke satt';
        const customerName = customerMap.get(customerId) || order.customerName || order.customer_name || 'Ukjent kunde';
        const deleteBtn = renderDeleteButton(order, orderNumber, customerName);
        
        return `
        <tr style="${rowStyle}">
            <td><strong><a href="#" onclick="openOrderModal('${order.id}'); return false;" style="color:#3b82f6; text-decoration:none; cursor:pointer;">${orderNumber}</a></strong></td>
            <td>${technicianMap.get(technicianId) || '<span style="color: #EF4444;">Ikke tildelt</span>'}</td>
            <td>${customerName}</td>
            <td>${serviceType}</td>
            <td>${dateDisplay}</td>
            <td><span class="status-badge status-${deriveOrderStatus(order) || 'pending'}">${getStatusText(deriveOrderStatus(order))}</span></td>
            <td>${deleteBtn}</td>
        </tr>
    `}).join('');
}

function populateUnfinishedTable(orders, customerMap, technicianMap) {
    const today = new Date().toISOString().slice(0, 10);
    
    const unfinishedOrders = orders.filter(o => {
        // Skip fullførte ordre
        if (o.status === 'completed') return false;
        
        const dateField = o.scheduledDate || o.scheduled_date;
        const orderDate = parseDate(dateField);
        
        // Sjekk at vi har en gyldig dato
        if (!orderDate) return false;
        
        const orderDateString = orderDate.toISOString().slice(0, 10);
        
        // Inkluder bare ordre som har dato før i dag (i går og tidligere)
        if (orderDateString < today) {
            // Ordre fra i går eller tidligere som ikke er fullført
            const derivedStatus = deriveOrderStatus(o);
            return derivedStatus === 'in_progress' || derivedStatus === 'scheduled' || derivedStatus === 'pending';
        }
        
        return false;
    });

    const tbody = document.getElementById('uferdige-oppdrag-liste');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (unfinishedOrders.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 40px; color: #9CA3AF;">
                    <div style="font-size: 48px; margin-bottom: 10px;">🎉</div>
                    <div style="font-weight: 500;">Ingen uferdige oppdrag</div>
                    <div style="font-size: 14px; margin-top: 8px;">Alt er på stell!</div>
                </td>
            </tr>`;
        return;
    }

    // Sorter etter dato (eldste først)
    unfinishedOrders.sort((a, b) => {
        const dateA = parseDate(a.scheduledDate || a.scheduled_date) || new Date(0);
        const dateB = parseDate(b.scheduledDate || b.scheduled_date) || new Date(0);
        return dateA.getTime() - dateB.getTime();
    });

    tbody.innerHTML = unfinishedOrders.map(order => {
        const orderNumber = order.orderNumber || order.order_number || order.id;
        const customerId = order.customerId || order.customer_id;
        const technicianId = order.technicianId || order.technician_id;
        const serviceType = order.serviceType || order.service_type || 'Service';
        const scheduledDate = parseDate(order.scheduledDate || order.scheduled_date);
        const dateDisplay = scheduledDate ? formatDateNorwegian(scheduledDate) : 'Ikke satt';
        const customerName = customerMap.get(customerId) || order.customerName || order.customer_name || 'Ukjent kunde';
        const deleteBtn = renderDeleteButton(order, orderNumber, customerName);
        
        return `
        <tr>
            <td><strong><a href="#" onclick="openOrderModal('${order.id}'); return false;" style="color:#3b82f6; text-decoration:none; cursor:pointer;">${orderNumber}</a></strong></td>
            <td>${technicianMap.get(technicianId) || '<span style="color: #EF4444;">Ikke tildelt</span>'}</td>
            <td>${customerName}</td>
            <td>${serviceType}</td>
            <td>${dateDisplay}</td>
            <td><span class="status-badge status-${deriveOrderStatus(order) || 'pending'}">${getStatusText(deriveOrderStatus(order))}</span></td>
            <td>${deleteBtn}</td>
        </tr>
    `}).join('');
}


// Hjelpefunksjon for å parse datoer robust
function parseDate(dateValue) {
    if (!dateValue) return null;
    
    // Hvis det allerede er et Date objekt
    if (dateValue instanceof Date) {
        return dateValue;
    }
    
    // Prøv å parse string
    let date;
    
    // Hvis datoen er i ISO format (YYYY-MM-DD), legg til tid for å unngå tidssone-problemer
    if (typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
        date = new Date(dateValue + 'T12:00:00');
    } else {
        date = new Date(dateValue);
    }
    
    // Sjekk om datoen er gyldig
    if (isNaN(date.getTime())) {
        console.error('Invalid date:', dateValue);
        return null;
    }
    
    return date;
}

// Hjelpefunksjon for konsistent datoformatering til YYYY-MM-DD
function formatDateShort(date) {
    if (!date) return '';
    return date.toISOString().slice(0, 10);
}

// Hjelpefunksjoner
function getStartOfWeek(date) {
    const d = new Date(date);
    const day = d.getDay();
    
    // Beregn hvor mange dager tilbake til mandag
    // Søndag = 0, så vi må gå 6 dager tilbake til forrige mandag
    // Mandag = 1, så vi må gå 0 dager tilbake (vi er allerede på mandag)
    // Tirsdag = 2, så vi må gå 1 dag tilbake til mandag
    // ... og så videre
    const daysToMonday = day === 0 ? 6 : day - 1;
    
    // Gå tilbake til mandag
    d.setDate(d.getDate() - daysToMonday);
    d.setHours(0, 0, 0, 0);
    
    return d;
}

function formatDateNorwegian(date) {
    const days = ['Søn', 'Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør'];
    const dayName = days[date.getDay()];
    return `${dayName} ${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}`;
}

function getStatusText(status) {
    const statusMap = {
        'pending': 'Venter',
        'scheduled': 'Planlagt',
        'in_progress': 'Pågår',
        'completed': 'Fullført',
        'cancelled': 'Avbrutt',
        // Legg til alternative mappinger
        'Fullført': 'Fullført',
        'fullført': 'Fullført'
    };
    return statusMap[status] || status || 'Ukjent';
}

// === AVLED ORDRE-STATUS BASERT PÅ ANLEGG-AKTIVITET ===
function deriveOrderStatus(order) {
    // Hvis ordre allerede er eksplisitt markert som completed, returner det
    if (order.status === 'completed') return 'completed';
    
    // Sjekk equipment og service_reports status
    if (order.equipment && order.equipment.length > 0) {
        const anyServiceStarted = order.equipment.some(eq => 
            eq.serviceReportStatus === 'in_progress' || 
            eq.serviceReportStatus === 'completed'
        );
        
        if (anyServiceStarted) return 'in_progress';
    }
    
    return order.status || 'scheduled';
}

function showErrorState() {
    // Vis feilmelding i alle KPI-kort
    ['kpi-oppdrag-idag', 'kpi-fullfort-uke', 'kpi-rapporter-ikke-sendt', 
     'kpi-tilbud-venter', 'kpi-venter-fakturering'].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.textContent = '-';
    });
    
    // Vis feilmelding i tabeller
    const errorMessage = `
        <tr>
            <td colspan="7" style="text-align: center; padding: 20px; color: #EF4444;">
                <div style="font-size: 24px; margin-bottom: 10px;">⚠️</div>
                <div>Kunne ikke laste data. Prøv å oppdatere siden.</div>
            </td>
        </tr>`;
    
    const dagensListe = document.getElementById('dagens-oppdrag-liste');
    const ukensListe = document.getElementById('ukens-oppdrag-liste');
    const uferdigeListe = document.getElementById('uferdige-oppdrag-liste');

    if (dagensListe) dagensListe.innerHTML = errorMessage;
    if (ukensListe) ukensListe.innerHTML = errorMessage;
    if (uferdigeListe) uferdigeListe.innerHTML = errorMessage;
}

// Auto-refresh hver 5. minutt
setInterval(loadDashboardData, 5 * 60 * 1000);

// Global refresh function
window.reloadDashboard = loadDashboardData;

// === ORDREDETALJ-MODAL ===
function openOrderModal(orderId) {
    const order = dashboardOrders.find(o => o.id === orderId);
    if (!order) return;

    const orderNumber = order.orderNumber || order.order_number || order.id;
    const customerName = order.customer_name || order.customerName || 'Ukjent kunde';
    const technicianName = order.technician_name || order.technicianName || 'Ikke tildelt';
    const serviceType = order.service_type || order.serviceType || 'Service';
    const description = order.description || '';
    const scheduledDate = parseDate(order.scheduled_date || order.scheduledDate);
    const scheduledTime = order.scheduled_time || order.scheduledTime || '';
    const status = deriveOrderStatus(order);
    const contactName = order.contact_name || '';
    const contactPhone = order.contact_phone || '';
    const contactEmail = order.contact_email || '';
    const deliveryAddress = order.delivery_address || '';

    const dateDisplay = scheduledDate ? formatDateNorwegian(scheduledDate) : 'Ikke satt';
    const timeDisplay = scheduledTime ? scheduledTime.slice(0, 5) : '';
    const dateTimeDisplay = timeDisplay ? `${dateDisplay} kl. ${timeDisplay}` : dateDisplay;

    // Bygg kontaktperson-tekst
    let contactDisplay = contactName || 'Ingen kontaktperson';
    const contactDetails = [contactPhone, contactEmail].filter(Boolean);
    if (contactDetails.length > 0) {
        contactDisplay += ` (${contactDetails.join(', ')})`;
    }

    // Bygg anlegg-liste
    const equipment = order.equipment || [];
    let equipmentHtml = '';
    if (equipment.length > 0) {
        equipmentHtml = equipment.map(eq => {
            const name = eq.name || 'Ukjent system';
            const type = eq.type ? ` — ${eq.type}` : '';
            const statusIcon = eq.serviceStatus === 'completed' ? '✅' : eq.serviceStatus === 'in_progress' ? '🔧' : '⏳';
            return `<div style="display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid #F3F4F6;">
                <span>${statusIcon}</span>
                <span style="font-size:13px;">${name}${type}</span>
            </div>`;
        }).join('');
    } else {
        equipmentHtml = '<span style="color:#9CA3AF; font-size:13px;">Ingen anlegg knyttet</span>';
    }

    const labelStyle = 'font-size:12px; color:#6B7280; font-weight:500; text-transform:uppercase; letter-spacing:0.5px;';
    const valueStyle = 'font-size:14px; color:#111827; margin-top:2px;';

    document.getElementById('order-detail-title').textContent = orderNumber;
    document.getElementById('order-detail-body').innerHTML = `
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
            <div>
                <div style="${labelStyle}">Status</div>
                <div style="margin-top:4px;"><span class="status-badge status-${status}">${getStatusText(status)}</span></div>
            </div>
            <div>
                <div style="${labelStyle}">Type</div>
                <div style="${valueStyle}">${serviceType}</div>
            </div>
            <div>
                <div style="${labelStyle}">Dato</div>
                <div style="${valueStyle}">${dateTimeDisplay}</div>
            </div>
            <div>
                <div style="${labelStyle}">Tekniker</div>
                <div style="${valueStyle}">${technicianName}</div>
            </div>
        </div>
        ${description ? `<div>
            <div style="${labelStyle}">Prosjekt / Beskrivelse</div>
            <div style="${valueStyle}">${description}</div>
        </div>` : ''}
        <div>
            <div style="${labelStyle}">Kunde</div>
            <div style="${valueStyle}">${customerName}</div>
        </div>
        <div>
            <div style="${labelStyle}">Kontaktperson</div>
            <div style="${valueStyle}">${contactDisplay}</div>
        </div>
        ${deliveryAddress ? `<div>
            <div style="${labelStyle}">Adresse</div>
            <div style="${valueStyle}">${deliveryAddress}</div>
        </div>` : ''}
        <div>
            <div style="${labelStyle}">Anlegg (${equipment.length})</div>
            <div style="margin-top:4px;">${equipmentHtml}</div>
        </div>
        ${status !== 'completed' ? `
        <hr style="border:none;border-top:1px solid #E5E7EB;margin:4px 0;">
        <div>
            <div style="${labelStyle};margin-bottom:10px;">Rediger oppdrag</div>
            <div style="display:grid;gap:10px;">
                <label style="font-size:13px;color:#374151;">
                    Dato
                    <input type="date" id="edit-scheduled-date"
                        value="${order.scheduled_date ? order.scheduled_date.split('T')[0] : ''}"
                        style="display:block;width:100%;box-sizing:border-box;margin-top:3px;padding:7px 10px;border:1px solid #D1D5DB;border-radius:6px;font-size:13px;">
                </label>
                <label style="font-size:13px;color:#374151;">
                    Tid
                    <input type="time" id="edit-scheduled-time"
                        value="${scheduledTime}"
                        style="display:block;width:100%;box-sizing:border-box;margin-top:3px;padding:7px 10px;border:1px solid #D1D5DB;border-radius:6px;font-size:13px;">
                </label>
                <label style="font-size:13px;color:#374151;">
                    Tekniker
                    <select id="edit-technician-id"
                        style="display:block;width:100%;box-sizing:border-box;margin-top:3px;padding:7px 10px;border:1px solid #D1D5DB;border-radius:6px;font-size:13px;">
                        <option value="">— Ingen tekniker —</option>
                        ${dashboardTechnicians.map(t => `<option value="${t.id}" ${t.id == order.technician_id ? 'selected' : ''}>${t.name || ''}</option>`).join('')}
                    </select>
                </label>
                <div id="edit-order-error" style="color:#DC2626;font-size:12px;display:none;"></div>
                <button onclick="saveOrderEdit('${orderId}')"
                    style="padding:8px 16px;border:none;border-radius:6px;background:#2563EB;color:#fff;cursor:pointer;font-weight:600;font-size:13px;align-self:flex-start;">
                    Lagre endringer
                </button>
            </div>
        </div>` : ''}
    `;

    document.getElementById('order-detail-modal').style.display = 'flex';
}

async function saveOrderEdit(orderId) {
    const date = document.getElementById('edit-scheduled-date')?.value;
    const time = document.getElementById('edit-scheduled-time')?.value;
    const technicianId = document.getElementById('edit-technician-id')?.value;
    const errorEl = document.getElementById('edit-order-error');

    const body = {};
    if (date) body.scheduledDate = date;
    if (time !== undefined) body.scheduledTime = time;
    if (technicianId !== undefined) body.technicianId = technicianId || null;

    try {
        const res = await fetch(`/api/admin/orders/${orderId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(body)
        });

        if (res.status === 409) {
            errorEl.textContent = 'Kan ikke endre en fullført ordre.';
            errorEl.style.display = 'block';
            return;
        }
        if (!res.ok) {
            const err = await res.json();
            errorEl.textContent = err.error || 'Kunne ikke lagre endringer.';
            errorEl.style.display = 'block';
            return;
        }

        closeOrderModal();
        loadDashboardData();
    } catch (e) {
        errorEl.textContent = 'Nettverksfeil. Prøv igjen.';
        errorEl.style.display = 'block';
    }
}

function closeOrderModal() {
    document.getElementById('order-detail-modal').style.display = 'none';
}

// Lukk modal ved klikk utenfor
document.addEventListener('click', function(e) {
    const orderModal = document.getElementById('order-detail-modal');
    if (e.target === orderModal) {
        closeOrderModal();
    }
    const deleteModal = document.getElementById('delete-order-modal');
    if (e.target === deleteModal) {
        closeDeleteModal();
    }
});

// Lukk modal med Escape
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        closeOrderModal();
        closeDeleteModal();
    }
});

// === SLETT ORDRE FUNKSJONALITET ===
let pendingDeleteOrderId = null;

function confirmDeleteOrder(orderId, orderNumber, customerName) {
    pendingDeleteOrderId = orderId;
    const modal = document.getElementById('delete-order-modal');
    const message = document.getElementById('delete-order-message');
    const confirmBtn = document.getElementById('delete-order-confirm-btn');
    
    message.textContent = `Er du sikker på at du vil slette ordre ${orderNumber} for ${customerName}? Denne handlingen kan ikke angres.`;
    
    // Reset knappen til ren tilstand
    const newBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);
    newBtn.id = 'delete-order-confirm-btn';
    newBtn.textContent = 'SLETT';
    newBtn.disabled = false;
    newBtn.previousElementSibling.disabled = false;
    newBtn.addEventListener('click', executeDeleteOrder);
    
    modal.style.display = 'flex';
}

function closeDeleteModal() {
    const modal = document.getElementById('delete-order-modal');
    modal.style.display = 'none';
    pendingDeleteOrderId = null;
}

async function executeDeleteOrder() {
    if (!pendingDeleteOrderId) return;
    
    const confirmBtn = document.getElementById('delete-order-confirm-btn');
    const cancelBtn = confirmBtn.previousElementSibling;
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    confirmBtn.textContent = 'Sletter...';
    
    try {
        const response = await fetch(`/api/admin/orders/${pendingDeleteOrderId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        
        if (!response.ok) {
            let errorMsg = 'Kunne ikke slette ordre';
            try {
                const error = await response.json();
                errorMsg = error.error || errorMsg;
            } catch (_) {}
            throw new Error(errorMsg);
        }
        
        closeDeleteModal();
        loadDashboardData();
        
    } catch (error) {
        alert(error.message);
        confirmBtn.textContent = 'SLETT';
        confirmBtn.disabled = false;
        cancelBtn.disabled = false;
    }
}
