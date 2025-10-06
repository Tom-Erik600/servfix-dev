/**
 * FELLES HEADER-FUNKSJON FOR HELE APPEN
 * Brukes av: index.html, orders.html, service.html
 */

async function renderAppHeader(options = {}) {
    const {
        backUrl = 'index.html',
        subtitle = 'Planlagte service',
        technician = null,
        showDate = true
    } = options;

    const header = document.getElementById('app-header');
    if (!header) {
        console.warn('⚠️ Header element (#app-header) ikke funnet');
        return;
    }

    // Hent bedriftsnavn fra innstillinger
    let companyName = 'AIR-TECH AS'; // Fallback
    try {
        const response = await fetch('/api/images/settings', { 
            credentials: 'include' 
        });
        if (response.ok) {
            const settings = await response.json();
            companyName = settings.companyInfo?.name || 'AIR-TECH AS';
        }
    } catch (error) {
        console.log('Bruker standard bedriftsnavn:', error.message);
    }

    // Formater norsk dato
    const today = new Date();
    const months = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 
                   'jul', 'aug', 'sep', 'okt', 'nov', 'des'];
    const dateString = `${today.getDate()}. ${months[today.getMonth()]}. ${today.getFullYear()}`;

    // Hent tekniker initialer (2-3 bokstaver)
    let techInitials = '';
    if (technician) {
        if (technician.initials) {
            techInitials = technician.initials.toUpperCase();
        } else if (technician.name) {
            techInitials = technician.name
                .split(' ')
                .map(n => n[0])
                .join('')
                .toUpperCase();
        }
    }

    // Bygg header HTML
    header.innerHTML = `
        ${backUrl ? `<a href="${backUrl}" class="header-nav-button" title="Tilbake">‹</a>` : ''}
        <div class="header-main-content">
            <div class="company-info">
                <h1>${companyName}</h1>
                <span class="app-subtitle">${subtitle}</span>
            </div>
        </div>
        <div class="header-user-info">
            ${technician ? `
                <div class="technician-avatar">${techInitials}</div>
                ${showDate ? `<span class="header-date">${dateString}</span>` : ''}
            ` : ''}
        </div>
    `;
}

// Gjør tilgjengelig globalt
if (typeof window !== 'undefined') {
    window.renderAppHeader = renderAppHeader;
}
