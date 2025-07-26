document.addEventListener('DOMContentLoaded', () => {
    loadDashboardData();
});

async function loadDashboardData() {
    try {
        const [orders, customers, technicians] = await Promise.all([
            fetch('/api/admin/orders').then(res => res.json()),
            fetch('/api/admin/customers').then(res => res.json()),
            fetch('/api/admin/technicians').then(res => res.json())
        ]);
        populateDashboard(orders, customers, technicians);
    } catch (error) {
        console.error("Klarte ikke å laste data for dashbordet:", error);
    }
}

function populateDashboard(orders, customers, technicians) {
    const customerMap = new Map(customers.map(c => [c.id, c.name]));
    const technicianMap = new Map(technicians.map(t => [t.id, t.name]));

    populateKpiCards(orders, technicians);
    populateTodaysTable(orders, customerMap, technicianMap);
    populateWeeklyTable(orders, customerMap, technicianMap);
    populateUnassignedTable(orders, customerMap);
}

function populateKpiCards(orders, technicians) {
    const today = new Date().toISOString().slice(0, 10);
    const startOfWeek = getStartOfWeek(new Date());

    // Oppdrag i dag
    const oppdragIDag = orders.filter(o => o.scheduledDate === today).length;
    
    // Fullførte denne uken
    const fullfortUke = orders.filter(o => {
        const orderDate = new Date(o.scheduledDate);
        return o.status === 'completed' && orderDate >= startOfWeek;
    }).length;
    
    // Rapporter ikke sendt (ordre som er 'completed')
    const rapporterIkkeSendt = orders.filter(o => o.status === 'completed').length; 

    // Venter på fakturering (kan være en plassholder)
    const venterFakturering = 0; // Dette kan implementeres senere

    // Oppdater HTML-elementene med de kalkulerte verdiene
    document.getElementById('kpi-oppdrag-idag').textContent = oppdragIDag;
    document.getElementById('kpi-fullfort-uke').textContent = fullfortUke;
    document.getElementById('kpi-rapporter-ikke-sendt').textContent = rapporterIkkeSendt;
    document.getElementById('kpi-venter-fakturering').textContent = venterFakturering;
}

function populateTodaysTable(orders, customerMap, technicianMap) {
    const today = new Date().toISOString().slice(0, 10);
    const todaysOrders = orders.filter(o => o.scheduledDate === today);
    const tbody = document.getElementById('dagens-oppdrag-liste');
    tbody.innerHTML = '';

    if (todaysOrders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 20px;">Ingen planlagte oppdrag i dag.</td></tr>`;
        return;
    }
    tbody.innerHTML = todaysOrders.map(order => `
        <tr>
            <td>${order.orderNumber}</td>
            <td>${technicianMap.get(order.technicianId) || 'Ikke tildelt'}</td>
            <td>${customerMap.get(order.customerId) || 'Ukjent kunde'}</td>
            <td>${order.serviceType || ''}</td>
            <td>${order.scheduledTime || ''}</td>
            <td><span class="status-badge status-${order.status}">${order.status}</span></td>
        </tr>
    `).join('');
}

function populateWeeklyTable(orders, customerMap, technicianMap) {
    const startOfWeek = getStartOfWeek(new Date());
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);

    const weeklyOrders = orders.filter(o => o.scheduledDate && new Date(o.scheduledDate) >= startOfWeek && new Date(o.scheduledDate) <= endOfWeek);
    const tbody = document.getElementById('ukens-oppdrag-liste');
    tbody.innerHTML = '';

    if (weeklyOrders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 20px;">Ingen planlagte oppdrag denne uken.</td></tr>`;
        return;
    }
    weeklyOrders.sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate));
    tbody.innerHTML = weeklyOrders.map(order => `
        <tr>
            <td>${order.orderNumber}</td>
            <td>${technicianMap.get(order.technicianId) || 'Ikke tildelt'}</td>
            <td>${customerMap.get(order.customerId) || 'Ukjent kunde'}</td>
            <td>${new Date(order.scheduledDate).toLocaleDateString('no-NO', {weekday: 'short', day: '2-digit', month: '2-digit'})}</td>
            <td><span class="status-badge status-${order.status}">${order.status}</span></td>
        </tr>
    `).join('');
}

function populateUnassignedTable(orders, customerMap) {
    // Vis ordre som IKKE har scheduledDate eller technicianId
    const unassignedOrders = orders.filter(o => !o.scheduledDate || !o.technicianId);
    const tbody = document.getElementById('utildelte-oppdrag-liste');
    tbody.innerHTML = '';

    if (unassignedOrders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; padding: 20px;">Ingen uplanlagte oppdrag.</td></tr>`;
        return;
    }
    
    tbody.innerHTML = unassignedOrders.map(order => `
        <tr>
            <td>${order.orderNumber}</td>
            <td>${customerMap.get(order.customerId) || 'Ukjent kunde'}</td>
            <td>${order.description || 'Ingen beskrivelse'}</td>
        </tr>
    `).join('');
}

function getStartOfWeek(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setHours(0, 0, 0, 0);
    d.setDate(diff);
    return d;
}