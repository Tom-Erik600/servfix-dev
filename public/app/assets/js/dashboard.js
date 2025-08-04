// air-tech-app/assets/js/dashboard.js

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Vente på at window.authManager er initialisert
    await window.authManager.waitForInitialization();

    // 2. Sjekke om bruker er pålogget, redirect til login hvis ikke
    if (!window.authManager.isLoggedIn()) {
        console.log("Not logged in, redirecting to login.");
        window.location.href = '/login.html';
        return;
    }

    // 3. Hente pålogget brukers info fra authManager
    const currentUser = window.authManager.getCurrentUser();
    console.log("Current user:", currentUser);

    // 4. Oppdatere header med brukerens navn og initialer
    const techNameEl = document.getElementById('technician-name');
    const techInitialsEl = document.getElementById('technician-initials');

    if (currentUser) {
        if (techNameEl) {
            techNameEl.textContent = currentUser.technician.name;
        }
        if (techInitialsEl) {
            const initials = currentUser.initials || (currentUser.technician && currentUser.technician.name ? currentUser.technician.name.split(' ').map(n => n[0]).join('') : '');
            techInitialsEl.textContent = initials;
        }
    }

    // 5. Hente ordre fra /api/orders (backend filtrerer automatisk basert på session)
    try {
        const response = await fetch('/api/orders');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const orders = await response.json();
        console.log("Fetched orders:", orders);
        
        // 6. Rendre ordre i dashboard-visningen (forenklet eksempel)
        const ordersContainer = document.getElementById('orders-container'); // Antar dette elementet finnes i index.html
        if (ordersContainer) {
            if (orders.length > 0) {
                ordersContainer.innerHTML = orders.map(order => `
                    <div class="order-item">
                        <h3>${order.description}</h3>
                        <p>Kunde: ${order.customerId}</p>
                        <p>Status: ${order.status}</p>
                        <p>Dato: ${order.scheduledDate || 'Ikke satt'}</p>
                    </div>
                `).join('');
            } else {
                ordersContainer.innerHTML = '<p>Ingen ordre å vise.</p>';
            }
        }

    } catch (error) {
        console.error('Failed to fetch orders:', error);
        // showToast('Kunne ikke laste ordre. Prøv igjen senere.', 'error'); // Hvis toast-funksjon er tilgjengelig
    }

    // 7. Setup logout-funksjonalitet
    const logoutButton = document.getElementById('logout-button');
    if (logoutButton) {
        logoutButton.addEventListener('click', () => {
            window.authManager.logout();
        });
    }

    // Initialiser lucide ikoner hvis de brukes
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    // Sjekk at vi er på riktig side
    if (!window.location.pathname.includes('/admin/dashboard')) {
        return;
    }

    // Hent elementer med null checks
    const ordersCount = document.getElementById('orders-count');
    const customersCount = document.getElementById('customers-count');
    const techniciansCount = document.getElementById('technicians-count');
    const loadDashboardData = document.getElementById('load-dashboard-data');

    // Funksjon for å oppdatere tall med null check
    function updateCount(element, value) {
        if (element) {
            element.textContent = value;
        } else {
            console.warn('Element not found for count update');
        }
    }

    async function loadDashboard() {
        try {
            // Hent data fra API
            const [ordersRes, customersRes, techniciansRes] = await Promise.all([
                fetch('/api/admin/orders', { credentials: 'include' }),
                fetch('/api/admin/customers', { credentials: 'include' }),
                fetch('/api/admin/technicians', { credentials: 'include' })
            ]);

            // Sjekk responses
            if (!ordersRes.ok || !customersRes.ok || !techniciansRes.ok) {
                throw new Error('Failed to fetch dashboard data');
            }

            const orders = await ordersRes.json();
            const customers = await customersRes.json();
            const technicians = await techniciansRes.json();

            // Oppdater counts med null checks
            updateCount(ordersCount, orders.length || 0);
            updateCount(customersCount, customers.length || 0);
            updateCount(techniciansCount, technicians.length || 0);

        } catch (error) {
            console.error('Error loading dashboard:', error);
            // Vis feilmelding til bruker
            updateCount(ordersCount, '?');
            updateCount(customersCount, '?');
            updateCount(techniciansCount, '?');
        }
    }

    // Load dashboard data
    loadDashboard();

    // Refresh knapp hvis den finnes
    if (loadDashboardData) {
        loadDashboardData.addEventListener('click', loadDashboard);
    }
});
