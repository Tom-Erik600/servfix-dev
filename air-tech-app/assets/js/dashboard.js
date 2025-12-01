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
            techNameEl.textContent = currentUser.name;
        }
        if (techInitialsEl) {
            const initials = currentUser.initials || currentUser.name.split(' ').map(n => n[0]).join('');
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
