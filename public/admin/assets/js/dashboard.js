// Fil: public/admin/assets/js/dashboard.js

document.addEventListener('DOMContentLoaded', loadDashboardData);

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
        
        console.log('=== Dashboard Data Loaded ===');
        console.log('Orders count:', ordersArray.length);
        if (ordersArray.length === 0) {
            console.warn('⚠️ Ingen ordre funnet! Sjekk at det finnes ordre i databasen.');
        } else {
            console.log('First few orders:', ordersArray.slice(0, 3));
        }
        console.log('Customers count:', customersArray.length);
        console.log('Technicians count:', techniciansArray.length);
        console.log('Reports count:', reportsArray.length);
        console.log('Quotes count:', quotes.length);
        
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

    // Debug logging
    console.log('=== Datoberegninger ===');
    console.log('Today:', today);
    console.log('Now:', formatDateShort(now));
    console.log('Start of week:', formatDateShort(startOfWeek));
    
    // Vis ukens datoer
    const weekDates = [];
    const dayNames = ['Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør', 'Søn'];
    for (let i = 0; i < 7; i++) {
        const date = new Date(startOfWeek);
        date.setDate(startOfWeek.getDate() + i);
        const dateStr = formatDateShort(date);
        const dayName = dayNames[i];
        weekDates.push(`${dayName} ${dateStr}`);
    }
    console.log('Ukens datoer:', weekDates.join(', '));
    
    // Først sjekk om vi har noen ordre med norsk status
    const norwegianStatusOrders = orders.filter(o => 
        o.status === 'Fullført' || o.status === 'fullført'
    );
    
    if (norwegianStatusOrders.length > 0) {
        console.warn('⚠️ FANT ORDRE MED NORSK STATUS:', norwegianStatusOrders.length);
        norwegianStatusOrders.forEach(o => {
            console.log('Ordre med norsk status:', {
                id: o.id || o.orderNumber || o.order_number,
                status: o.status,
                date: o.scheduledDate || o.scheduled_date
            });
        });
    }
    
    // List ALLE ordre først for debugging
    console.log('=== ALLE ORDRE ===');
    orders.forEach(o => {
        console.log('Ordre:', {
            id: o.id || o.orderNumber || o.order_number,
            date: o.scheduledDate || o.scheduled_date,
            status: o.status,
            statusType: typeof o.status,
            statusLength: o.status ? o.status.length : 0,
            exactStatus: `"${o.status}"`
        });
    });
    
    // List alle fullførte ordre for debugging
    const allCompletedOrders = orders.filter(o => o.status === 'completed');
    console.log(`Total orders with status === 'completed': ${allCompletedOrders.length}`);
    
    // Sjekk hvilke datofelter som finnes på fullførte ordre
    if (allCompletedOrders.length > 0) {
        const sampleOrder = allCompletedOrders[0];
        console.log('Eksempel fullført ordre:', {
            id: sampleOrder.id || sampleOrder.orderNumber || sampleOrder.order_number,
            scheduled_date: sampleOrder.scheduledDate || sampleOrder.scheduled_date,
            completed_at: sampleOrder.completed_at || sampleOrder.completedAt || 'MANGLER',
            updated_at: sampleOrder.updated_at || sampleOrder.updatedAt || 'N/A',
            alleNøkler: Object.keys(sampleOrder).join(', ')
        });
    }
    
    const endOfWeekForLogging = new Date(startOfWeek);
    endOfWeekForLogging.setDate(startOfWeek.getDate() + 6);
    endOfWeekForLogging.setHours(23, 59, 59, 999);
    
    console.log('Week period:', {
        start: formatDateShort(startOfWeek),
        end: formatDateShort(endOfWeekForLogging)
    });
    
    allCompletedOrders.forEach(o => {
        const dateField = o.scheduledDate || o.scheduled_date;
        const orderDate = parseDate(dateField);
        console.log('Completed order:', {
            id: o.id || o.orderNumber || o.order_number,
            date: dateField,
            parsedDate: orderDate ? formatDateShort(orderDate) : 'Invalid date',
            isThisWeek: orderDate && orderDate >= startOfWeek && orderDate <= endOfWeekForLogging
        });
    });
    
    // Sjekk feltnavn på første ordre
    if (orders.length > 0) {
        console.log('First order fields:', Object.keys(orders[0]));
        console.log('First order example:', orders[0]);
    }
    
    // Oppdrag i dag - ordre planlagt for i dag
    const todaysOrders = orders.filter(o => {
        const dateField = o.scheduledDate || o.scheduled_date;
        if (!dateField) return false;
        
        const orderDate = parseDate(dateField);
        if (!orderDate) return false;
        
        const orderDateString = formatDateShort(orderDate);
        const matches = orderDateString === today;
        
        if (matches) {
            console.log('Order matches today:', o.id || o.orderNumber || o.order_number, orderDateString);
        }
        
        return matches;
    });
    const oppdragIDag = todaysOrders.length;
    
    console.log(`Oppdrag i dag (${today}):`, oppdragIDag);
    
    // Fullførte denne uken - ordre med status 'completed' denne uken
    // VIKTIG: For fullførte ordre, sjekk completed_at dato (når de faktisk ble fullført), 
    // ikke scheduled_date (når de var planlagt). Dette sikrer at ordre planlagt for 
    // andre uker men fullført denne uken blir telt med.
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);
    
    console.log('Calculating completed orders for full week:', {
        startOfWeek: formatDateShort(startOfWeek) + ' (Monday)',
        endOfWeek: formatDateShort(endOfWeek) + ' (Sunday)'
    });
    
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
            console.warn('Fullført ordre uten dato:', o.id || o.orderNumber || o.order_number);
            return false;
        }
        
        const orderDate = parseDate(dateToCheck);
        if (!orderDate) return false;
        
        // Normaliser dato til start av dagen for sammenligning
        const orderDateNormalized = new Date(orderDate);
        orderDateNormalized.setHours(0, 0, 0, 0);
        
        // Sjekk om ordren ble fullført i denne uken
        const isInWeek = orderDateNormalized >= startOfWeek && orderDateNormalized <= endOfWeek;
        
        if (isInWeek) {
            console.log('Completed order in week:', {
                id: o.id || o.orderNumber || o.order_number,
                scheduledDate: o.scheduledDate || o.scheduled_date,
                completedAt: o.completed_at || o.completedAt || 'N/A',
                updatedAt: o.updated_at || o.updatedAt || 'N/A',
                dateUsed: dateToCheck,
                dateUsedType: o.completed_at ? 'completed_at' : 
                             o.completedAt ? 'completedAt' :
                             o.updated_at ? 'updated_at' :
                             o.updatedAt ? 'updatedAt' : 'scheduled_date'
            });
        }
        
        return isInWeek;
    }).length;
    
    console.log('Fullført denne uken count:', fullfortUke);
    
    // Debug: Vis alle fullførte ordre med deres datoer
    const allCompletedWithDates = orders.filter(o => o.status === 'completed').map(o => ({
        id: o.id || o.orderNumber || o.order_number,
        scheduledDate: o.scheduledDate || o.scheduled_date,
        completedAt: o.completed_at || o.completedAt || 'N/A',
        updatedAt: o.updated_at || o.updatedAt || 'N/A',
        dateUsedForKPI: o.completed_at || o.completedAt || o.updated_at || o.updatedAt || o.scheduledDate || o.scheduled_date
    }));
    
    console.log('Alle fullførte ordre med datoer:', allCompletedWithDates);
    
    // Forklar forskjellen hvis det er en
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
        console.log(`📊 KPI viser ${fullfortUke} fullførte (basert på når de ble fullført)`);
        console.log(`📅 Tabellen viser ${completedInTableView} fullførte (basert på når de var planlagt)`);
        console.log('Dette er fordi ordre kan være planlagt for en uke men fullført i en annen uke.');
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

    // Debug-logging for alle KPI-verdier
    console.log('=== KPI Beregninger ===');
    console.log('Oppdrag i dag:', oppdragIDag);
    console.log('Fullførte denne uken:', fullfortUke, '(basert på completed/updated dato)');
    console.log('Rapporter ikke sendt:', rapporterIkkeSendt);
    console.log('Venter på fakturering (alle ikke-fakturerte):', venterFakturering);
    console.log('Tilbud venter:', tilbudVenter);

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
                <td colspan="6" style="text-align: center; padding: 40px; color: #9CA3AF;">
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
        
        return `
        <tr style="${rowStyle}">
            <td><strong>${orderNumber}</strong></td>
            <td>${technicianMap.get(technicianId) || '<span style="color: #EF4444;">Ikke tildelt</span>'}</td>
            <td>${customerMap.get(customerId) || order.customerName || order.customer_name || 'Ukjent kunde'}</td>
            <td>${serviceType}</td>
            <td>${dateDisplay}</td>
            <td><span class="status-badge status-${deriveOrderStatus(order) || 'pending'}">${getStatusText(deriveOrderStatus(order))}</span></td>
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

    console.log('Week range for table:', {
        start: formatDateShort(startOfWeek),
        startDay: ['Søn', 'Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør'][startOfWeek.getDay()],
        end: formatDateShort(endOfWeek),
        endDay: ['Søn', 'Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør'][endOfWeek.getDay()]
    });

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
    
    console.log(`Found ${weeklyOrders.length} orders for this week`);
    
    // Debug: vis status for hver ordre
    const statusCount = {};
    weeklyOrders.forEach(o => {
        const status = o.status || 'no-status';
        statusCount[status] = (statusCount[status] || 0) + 1;
        console.log('Weekly order:', {
            id: o.id || o.orderNumber || o.order_number,
            date: o.scheduledDate || o.scheduled_date,
            status: o.status,
            displayStatus: getStatusText(o.status)
        });
    });
    
    console.log('Status count in weekly orders:', statusCount);
    
    const tbody = document.getElementById('ukens-oppdrag-liste');
    if (!tbody) return;
    
    tbody.innerHTML = '';

    if (weeklyOrders.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 40px; color: #9CA3AF;">
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
        
        return `
        <tr style="${rowStyle}">
            <td><strong>${orderNumber}</strong></td>
            <td>${technicianMap.get(technicianId) || '<span style="color: #EF4444;">Ikke tildelt</span>'}</td>
            <td>${customerMap.get(customerId) || order.customerName || order.customer_name || 'Ukjent kunde'}</td>
            <td>${serviceType}</td>
            <td>${dateDisplay}</td>
            <td><span class="status-badge status-${deriveOrderStatus(order) || 'pending'}">${getStatusText(deriveOrderStatus(order))}</span></td>
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
                <td colspan="6" style="text-align: center; padding: 40px; color: #9CA3AF;">
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
        
        return `
        <tr>
            <td><strong>${orderNumber}</strong></td>
            <td>${technicianMap.get(technicianId) || '<span style="color: #EF4444;">Ikke tildelt</span>'}</td>
            <td>${customerMap.get(customerId) || order.customerName || order.customer_name || 'Ukjent kunde'}</td>
            <td>${serviceType}</td>
            <td>${dateDisplay}</td>
            <td><span class="status-badge status-${deriveOrderStatus(order) || 'pending'}">${getStatusText(deriveOrderStatus(order))}</span></td>
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
    
    console.log('Start of week calculated:', {
        inputDate: formatDateShort(date),
        inputDayOfWeek: day,
        inputDayName: ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'][day],
        daysBackToMonday: daysToMonday,
        resultDate: formatDateShort(d),
        resultDayName: ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'][d.getDay()]
    });
    
    return d;
}

function formatDateNorwegian(date) {
    const days = ['Søn', 'Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør'];
    const dayName = days[date.getDay()];
    return `${dayName} ${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}`;
}

function getStatusText(status) {
    // Log alle status-verdier som ikke er standard
    if (status && !['pending', 'scheduled', 'in_progress', 'completed', 'cancelled'].includes(status)) {
        console.warn('Non-standard status value:', status);
    }
    
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
            <td colspan="6" style="text-align: center; padding: 20px; color: #EF4444;">
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

// Dashboard er klar - all logging er aktivert for debugging
