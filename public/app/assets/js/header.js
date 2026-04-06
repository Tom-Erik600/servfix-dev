/**
 * FELLES HEADER-FUNKSJON FOR HELE APPEN
 * Brukes av: index.html, orders.html, service.html
 */

async function renderAppHeader(options = {}) {
    const {
        backUrl = 'index.html',
        subtitle = 'Planlagte service',
        technician = null,
        showDate = true,
        settings = null
    } = options;

    const header = document.getElementById('app-header');
    if (!header) {
        console.warn('⚠️ Header element (#app-header) ikke funnet');
        return;
    }

    // Bruk medsendt settings eller hent fra API
    let resolvedSettings = settings;
    let companyName = resolvedSettings?.companyInfo?.name || null;
    if (!companyName) {
        try {
            const response = await fetch('/api/images/branding');
            if (response.ok) {
                const branding = await response.json();
                companyName = branding.companyName || null;
            }
        } catch (error) {
            console.log('Bruker standard bedriftsnavn:', error.message);
        }
    }
    companyName = companyName || 'AIR-TECH AS';

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
