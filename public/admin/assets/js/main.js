// Fil: air-tech-adminweb/assets/js/main.js

document.addEventListener("DOMContentLoaded", async function() {
    // Finner header-elementet på siden
    const headerPlaceholder = document.querySelector("header.app-header");
    if (!headerPlaceholder) return;

    // Hent bedriftsnavn fra innstillinger
    let companyName = 'selskapsnavn ikke funnet'; // Fallback
    
    try {
        const response = await fetch('/api/images/settings', { 
            credentials: 'include' 
        });
        if (response.ok) {
            const settings = await response.json();
            companyName = settings.companyInfo?.name || 'AIR-TECH AS';
            console.log('✅ Bedriftsnavn hentet:', companyName);
        }
    } catch (error) {
        console.log('⚠️ Bruker standard bedriftsnavn:', error.message);
    }

    // Henter innholdet fra den delte header-filen
    fetch('/admin/shared/header.html')
        .then(response => {
            if (!response.ok) {
                throw new Error('Nettverksrespons var ikke ok');
            }
            return response.text();
        })
        .then(data => {
            // KRITISK FIX: Erstatt hardkodet bedriftsnavn med dynamisk verdi
            data = data.replace('AIR-TECH AS', companyName);
            
            // Setter det hentede HTML-innholdet inn i header-elementet
            headerPlaceholder.innerHTML = data;

            // Finner den aktive siden og markerer den i menyen
            const navLinks = headerPlaceholder.querySelectorAll('.main-nav a');
            const currentPage = window.location.pathname;

            // Fjern alle aktive klasser først
            navLinks.forEach(link => {
                link.classList.remove('active');
            });

            // Finn og marker den aktive siden
            navLinks.forEach(link => {
                const linkPath = link.getAttribute('href');
                
                // Sjekk om linkens href matcher den nåværende siden
                if (linkPath === currentPage) {
                    link.classList.add('active');
                } else if (currentPage.endsWith('/admin/') && linkPath === '/admin/dashboard.html') {
                    // Spesiell behandling for /admin/ som skal peke til dashboard
                    link.classList.add('active');
                }
            });

            
        })
        .catch(error => {
            console.error('Feil med henting av header:', error);
            headerPlaceholder.innerHTML = "<p>Kunne ikke laste header.</p>";
        });
});



// Function to toggle the admin dropdown menu
function toggleAdminDropdown() {
    const dropdownMenu = document.getElementById('adminDropdownMenu');
    if (dropdownMenu) {
        dropdownMenu.classList.toggle('show');
    }
}

// Function to navigate to a given URL
function navigateTo(url) {
    window.location.href = url;
}

// Close the dropdown if the user clicks outside of it
window.onclick = function(event) {
    if (!event.target.matches('.user-menu') && !event.target.closest('.user-menu')) {
        const dropdowns = document.getElementsByClassName('dropdown-menu');
        for (let i = 0; i < dropdowns.length; i++) {
            const openDropdown = dropdowns[i];
            if (openDropdown.classList.contains('show')) {
                openDropdown.classList.remove('show');
            }
        }
    }
}
