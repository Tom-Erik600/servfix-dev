document.addEventListener('DOMContentLoaded', () => {
    console.log("Admin Dashboard lastet. Henter data...");
    loadDashboardData();
});

/**
 * Henter all nødvendig data fra API-et og starter prosessen med å fylle ut dashbordet.
 */
async function loadDashboardData() {
    try {
        // Henter all data parallelt for best ytelse
        const [orders, customers, technicians] = await Promise.all([
            fetch('/api/orders').then(res => res.json()),
            fetch('/api/customers').then(res => res.json()),
            fetch('/api/technicians').then(res => res.json())
        ]);

        console.log("Data hentet fra API-et:", { orders, customers, technicians });

        // Sender dataen videre for å fylle ut siden
        populateDashboard(orders, customers, technicians);

    } catch (error) {
        console.error("Klarte ikke å laste data for dashbordet:", error);
        const oppdragsliste = document.getElementById('dagens-oppdrag-liste');
        if (oppdragsliste) {
            oppdragsliste.innerHTML = `<tr><td colspan="6" style="color: red; text-align: center;">Klarte ikke å laste data. Sjekk at serveren kjører.</td></tr>`;
        }
    }
}

/**
 * Hovedfunksjon for å distribuere data til de ulike delene av dashbordet.
 * @param {Array} orders - Listen over alle ordre
 * @param {Array} customers - Listen over alle kunder
 * @param {Array} technicians - Listen over alle teknikere
 */
function populateDashboard(orders, customers, technicians) {
    // Lager "oppslagsverk" for rask tilgang til navn, som er mye mer effektivt.
    const customerMap = new Map(customers.map(c => [c.id, c.name]));
    const technicianMap = new Map(technicians.map(t => [t.id, t.name]));

    populateKpiCards(orders, technicians);
    populateTodaysTable(orders, customerMap, technicianMap);
    populateRecentActivity(orders, customerMap);
}

/**
 * Fyller ut de 5 KPI-kortene på toppen av siden.
 */
function populateKpiCards(orders, technicians) {
    const today = new Date().toISOString().slice(0, 10);
    const startOfWeek = getStartOfWeek(new Date());

    const oppdragIDag = orders.filter(o => o.scheduledDate === today).length;
    const aktiveTeknikere = technicians.length;
    const fullfortUke = orders.filter(o => {
        const orderDate = new Date(o.scheduledDate);
        return o.status === 'completed' && orderDate >= startOfWeek;
    }).length;
    
    // Forenkling: Teller alle fullførte ordre som ikke er fakturert ennå.
    const venterFakturering = orders.filter(o => o.status === 'completed').length; 

    // Oppdaterer HTML-elementene med de kalkulerte verdiene
    document.getElementById('kpi-oppdrag-idag').textContent = oppdragIDag;
    document.getElementById('kpi-aktive-teknikere').textContent = aktiveTeknikere;
    document.getElementById('kpi-fullfort-uke').textContent = fullfortUke;
    document.getElementById('kpi-venter-fakturering').textContent = venterFakturering;
    document.getElementById('kpi-tilbud-handling').textContent = '0'; // Statisk verdi foreløpig
}

/**
 * Fyller ut tabellen med dagens oppdrag.
 */
function populateTodaysTable(orders, customerMap, technicianMap) {
    const today = new Date().toISOString().slice(0, 10);
    const todaysOrders = orders.filter(o => o.scheduledDate === today);
    const tbody = document.getElementById('dagens-oppdrag-liste');

    if (todaysOrders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 20px;">Ingen planlagte oppdrag i dag.</td></tr>`;
        return;
    }

    // Bygger en HTML-rad for hver av dagens ordre
    tbody.innerHTML = todaysOrders.map(order => `
        <tr>
            <td>${order.orderNumber}</td>
            <td>${technicianMap.get(order.technicianId) || 'Ikke tildelt'}</td>
            <td>${customerMap.get(order.customerId) || 'Ukjent kunde'}</td>
            <td>${order.serviceType}</td>
            <td>${order.scheduledTime}</td>
            <td><span class="status-badge status-${order.status}">${order.status.replace('_', ' ')}</span></td>
        </tr>
    `).join('');
}

/**
 * Fyller ut listen med nylig aktivitet.
 */
function populateRecentActivity(orders, customerMap) {
    const list = document.getElementById('nylig-aktivitet-liste');
    // Sorterer ordre for å få de nyeste først (basert på ID som en proxy)
    const recentOrders = [...orders].sort((a, b) => b.id.localeCompare(a.id)).slice(0, 5);

    if (recentOrders.length === 0) {
        list.innerHTML = '<li>Ingen nylig aktivitet.</li>';
        return;
    }

    list.innerHTML = recentOrders.map(order => {
        const customerName = customerMap.get(order.customerId) || 'Ukjent';
        return `<li><strong>${order.orderNumber}</strong> for ${customerName} ble oppdatert.</li>`;
    }).join('');
}


/**
 * Hjelpefunksjon for å finne starten av uken (mandag).
 * @param {Date} date - datoen man vil finne ukesstart for.
 * @returns {Date} - Dato-objekt for mandagen i den uken.
 */
function getStartOfWeek(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // juster til mandag
    d.setDate(diff);
    d.setHours(0, 0, 0, 0); // Nullstill klokkeslett
    return d;
}