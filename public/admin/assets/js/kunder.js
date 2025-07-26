/**
 * Kunder.js - Air-Tech AdminWeb
 * FULLSTENDIG implementasjon med detaljert visning
 */

document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Starter kundesystem (fullstendig versjon)...');
    
    let allCustomers = [];
    let currentSelectedCustomer = null;
    let customerHistory = [];

    // DOM-elementer
    const searchInput = document.getElementById('customer-search');
    const customerTableBody = document.getElementById('customer-table-body');
    const detailsPlaceholder = document.getElementById('customer-details-placeholder');
    const detailsContent = document.getElementById('customer-details-content');
    const serviceHistoryContent = document.getElementById('service-history-content');
    const orderModal = document.getElementById('order-modal');

    /**
     * Laster inn alle data
     */
    async function loadData() {
        try {
            showLoadingState();
            
            // Last inn kunder fra Tripletex
            console.log('📡 Laster kunder fra API...');
            const customersResponse = await fetch('/api/admin/customers');
            if (!customersResponse.ok) {
                const errorText = await customersResponse.text();
                console.error('API-feil:', customersResponse.status, errorText);
                throw new Error(`API-feil ${customersResponse.status}: ${errorText}`);
            }
            
            const customersData = await customersResponse.json();
            console.log('✅ Mottatt kundedata:', customersData);
            
            // Håndter både ny struktur (med wrapper) og gammel struktur (direkte array)
            if (customersData.customers) {
                allCustomers = customersData.customers;
            } else if (Array.isArray(customersData)) {
                allCustomers = customersData;
            } else {
                throw new Error('Ugyldig dataformat fra API');
            }
            
            // Last inn servicehistorikk (lokalt)
            try {
                console.log('📡 Laster servicehistorikk...');
                const historyResponse = await fetch('/api/admin/orders');
                if (historyResponse.ok) {
                    customerHistory = await historyResponse.json();
                    console.log(`✅ Lastet ${customerHistory.length} ordre`);
                } else {
                    console.warn('Kunne ikke laste servicehistorikk:', historyResponse.status);
                }
            } catch (historyError) {
                console.warn('Kunne ikke laste servicehistorikk:', historyError);
                customerHistory = [];
            }

            console.log(`✅ Lastet ${allCustomers.length} kunder totalt`);
            
            // Vis kundene
            renderCustomerList(allCustomers);
            hideLoadingState();
            
        } catch (error) {
            console.error('❌ Feil ved lasting av data:', error);
            showErrorState(`Kunne ikke laste kundedata: ${error.message}`);
        }
    }

    /**
     * Viser loading-tilstand
     */
    function showLoadingState() {
        customerTableBody.innerHTML = `
            <tr>
                <td colspan="3" style="text-align: center; padding: 40px; color: var(--text-light);">
                    <div style="display: flex; align-items: center; justify-content: center; gap: 10px;">
                        <div style="width: 20px; height: 20px; border: 2px solid var(--primary-color); border-top: 2px solid transparent; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                        Laster kunder...
                    </div>
                </td>
            </tr>
        `;
    }

    /**
     * Skjuler loading-tilstand
     */
    function hideLoadingState() {
        // Fjernes når data er lastet
    }

    /**
     * Viser feilmelding
     */
    function showErrorState(message) {
        customerTableBody.innerHTML = `
            <tr>
                <td colspan="3" style="text-align: center; padding: 40px; color: #ef4444;">
                    <strong>Feil:</strong> ${message}
                    <br><br>
                    <button onclick="window.location.reload()" style="padding: 8px 16px; background: var(--primary-color); color: white; border: none; border-radius: 4px; cursor: pointer;">
                        Prøv igjen
                    </button>
                </td>
            </tr>
        `;
    }

    /**
     * Rendrer kundelisten
     */
    function renderCustomerList(customers) {
        if (!customers || customers.length === 0) {
            customerTableBody.innerHTML = `
                <tr>
                    <td colspan="3" style="text-align: center; padding: 40px; color: var(--text-light);">
                        Ingen kunder funnet.
                    </td>
                </tr>
            `;
            return;
        }

        customerTableBody.innerHTML = customers.map(customer => `
            <tr data-customer-id="${customer.id}" onclick="selectCustomer('${customer.id}')" style="cursor: pointer;">
                <td>
                    <div style="font-weight: 500;">${customer.name}</div>
                </td>
                <td>
                    <div style="font-size: 14px;">${customer.contact}</div>
                </td>
                <td>
                    <div class="customer-number">${customer.customerNumber || '-'}</div>
                </td>
            </tr>
        `).join('');
    }

    /**
     * Velger og viser en kunde
     */
    window.selectCustomer = function(customerId) {
        const customer = allCustomers.find(c => c.id === customerId);
        if (!customer) {
            console.error('Kunde ikke funnet:', customerId);
            return;
        }

        console.log('🎯 Valgte kunde:', customer);

        // Oppdater valgt kunde i listen
        const rows = customerTableBody.querySelectorAll('tr');
        rows.forEach(row => row.classList.remove('selected'));
        const selectedRow = customerTableBody.querySelector(`[data-customer-id="${customerId}"]`);
        if (selectedRow) {
            selectedRow.classList.add('selected');
        }

        currentSelectedCustomer = customer;
        renderCustomerDetails(customer);
        renderServiceHistory(customer);
    };

    /**
     * Rendrer detaljert kundeinfo (uten servicehistorikk)
     */
    function renderCustomerDetails(customer) {
        console.log('📋 Rendrer kundedetaljer for:', customer.name);

        detailsContent.innerHTML = `
            <div class="customer-header">
                <h2>${customer.name}</h2>
                <span class="customer-number-badge">Nr. ${customer.customerNumber || 'Ikke angitt'}</span>
            </div>

            <!-- Kunde-/leverandørdetaljer -->
            <div class="info-section">
                <h3 class="section-title">Kunde-/leverandørdetaljer</h3>
                <div class="detail-grid">
                    <div class="detail-group">
                        <div class="detail-label">Type</div>
                        <div class="detail-value">${customer.customerType || 'Kunde'}</div>
                    </div>
                    <div class="detail-group">
                        <div class="detail-label">Språk</div>
                        <div class="detail-value">${customer.language || 'Norsk'}</div>
                    </div>
                    <div class="detail-group">
                        <div class="detail-label">Valuta</div>
                        <div class="detail-value">${customer.currency || 'NOK'}</div>
                    </div>
                    <div class="detail-group">
                        <div class="detail-label">Bedrift/Privatperson</div>
                        <div class="detail-value">${customer.isPrivate ? 'Privatperson' : 'Bedrift'}</div>
                    </div>
                    <div class="detail-group">
                        <div class="detail-label">Organisasjonsnummer</div>
                        <div class="detail-value ${customer.organizationNumber ? '' : 'missing'}">
                            ${customer.organizationNumber || 'Ikke angitt'}
                        </div>
                    </div>
                    <div class="detail-group">
                        <div class="detail-label">Kundeansvarlig</div>
                        <div class="detail-value">${customer.customerAccountManager || 'Ikke tildelt'}</div>
                    </div>
                </div>
            </div>

            <!-- Kontaktinformasjon -->
            <div class="info-section">
                <h3 class="section-title">Kontaktinformasjon</h3>
                <div class="detail-grid">
                    <div class="detail-group">
                        <div class="detail-label">Kontaktperson</div>
                        <div class="detail-value">${customer.contact}</div>
                    </div>
                    <div class="detail-group">
                        <div class="detail-label">E-post</div>
                        <div class="detail-value ${customer.email ? 'highlight' : 'missing'}">
                            ${customer.email || 'Mangler e-post'}
                        </div>
                    </div>
                    <div class="detail-group">
                        <div class="detail-label">Telefon</div>
                        <div class="detail-value">${customer.phone}</div>
                    </div>
                    <div class="detail-group">
                        <div class="detail-label">Mobil</div>
                        <div class="detail-value">${customer.mobile || 'Ikke angitt'}</div>
                    </div>
                    <div class="detail-group">
                        <div class="detail-label">Nettside</div>
                        <div class="detail-value">
                            ${customer.website ? 
                                `<a href="${customer.website}" target="_blank" style="color: var(--primary-color);">${customer.website}</a>` : 
                                'Ikke angitt'
                            }
                        </div>
                    </div>
                </div>
            </div>

            <!-- Adresser i 2-kolonne grid -->
            <div class="info-section">
                <h3 class="section-title">Adresser</h3>
                <div class="address-grid">
                    <div class="address-section">
                        <div class="section-title">Postadresse</div>
                        <div class="address-content">${customer.postalAddress}</div>
                    </div>
                    <div class="address-section">
                        <div class="section-title">Forretningsadresse</div>
                        <div class="address-content">${customer.physicalAddress}</div>
                    </div>
                </div>
                ${customer.deliveryAddress ? `
                    <div style="margin-top: 16px;">
                        <div class="address-section">
                            <div class="section-title">Leveringsadresse</div>
                            <div class="address-content">${customer.deliveryAddress}</div>
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
        
        detailsPlaceholder.style.display = 'none';
        detailsContent.style.display = 'block';
        
        console.log('✅ Kundedetaljer rendret');
    }

    /**
     * Rendrer servicehistorikk i høyre sidebar
     */
    function renderServiceHistory(customer) {
        console.log('📊 Rendrer servicehistorikk for:', customer.name);
        
        // Finn servicehistorikk for denne kunden
        const customerServiceHistory = customerHistory.filter(order => 
            order.customerId === customer.id || 
            order.customerName === customer.name
        );

        if (customerServiceHistory.length === 0) {
            serviceHistoryContent.innerHTML = `
                <div class="empty-history">
                    <p>Ingen servicehistorikk funnet for ${customer.name}</p>
                </div>
            `;
            return;
        }

        const historyHTML = customerServiceHistory.map(order => `
            <li class="service-history-item" onclick="showOrderDetails('${order.id}')" style="cursor: pointer;">
                <div class="order-info">
                    <div class="order-number">${order.orderNumber || order.id}</div>
                    <div class="order-description">${order.description || order.serviceType || 'Serviceoppdrag'}</div>
                    <div style="font-size: 12px; color: var(--text-light); margin-top: 4px;">
                        ${order.scheduledDate ? formatDate(order.scheduledDate) : 'Ikke planlagt'}
                    </div>
                </div>
                <span class="status-badge status-${order.status || 'scheduled'}">${getStatusText(order.status)}</span>
            </li>
        `).join('');

        serviceHistoryContent.innerHTML = `
            <ul class="service-history-list-sidebar">${historyHTML}</ul>
        `;
        
        console.log(`✅ Viser ${customerServiceHistory.length} serviceordre i sidebar`);
    }

    /**
     * Viser detaljer for en serviceordre i modal
     */
    window.showOrderDetails = function(orderId) {
        console.log('🔍 Viser detaljer for ordre:', orderId);
        
        const order = customerHistory.find(o => o.id === orderId);
        if (!order) {
            console.error('Ordre ikke funnet:', orderId);
            return;
        }

        const customer = allCustomers.find(c => 
            c.id === order.customerId || 
            c.name === order.customerName
        );

        const modalBody = document.getElementById('order-modal-body');
        modalBody.innerHTML = `
            <div class="report-section">
                <h4>Grunnleggende informasjon</h4>
                <div class="detail-grid">
                    <div class="detail-group">
                        <div class="detail-label">Ordrenummer</div>
                        <div class="detail-value">${order.orderNumber || order.id}</div>
                    </div>
                    <div class="detail-group">
                        <div class="detail-label">Status</div>
                        <div class="detail-value">
                            <span class="status-badge status-${order.status || 'scheduled'}">${getStatusText(order.status)}</span>
                        </div>
                    </div>
                    <div class="detail-group">
                        <div class="detail-label">Kunde</div>
                        <div class="detail-value">${customer ? customer.name : order.customerName || 'Ukjent kunde'}</div>
                    </div>
                    <div class="detail-group">
                        <div class="detail-label">Servicetype</div>
                        <div class="detail-value">${order.serviceType || 'Ikke angitt'}</div>
                    </div>
                    <div class="detail-group">
                        <div class="detail-label">Planlagt dato</div>
                        <div class="detail-value">${order.scheduledDate ? formatDate(order.scheduledDate) : 'Ikke planlagt'}</div>
                    </div>
                    <div class="detail-group">
                        <div class="detail-label">Tekniker</div>
                        <div class="detail-value">${order.technicianId || 'Ikke tildelt'}</div>
                    </div>
                </div>
            </div>

            <div class="report-section">
                <h4>Beskrivelse</h4>
                <p>${order.description || 'Ingen beskrivelse tilgjengelig'}</p>
            </div>

            ${customer ? `
                <div class="report-section">
                    <h4>Kundeinformasjon</h4>
                    <div class="detail-grid">
                        <div class="detail-group">
                            <div class="detail-label">Kontaktperson</div>
                            <div class="detail-value">${customer.contact}</div>
                        </div>
                        <div class="detail-group">
                            <div class="detail-label">Telefon</div>
                            <div class="detail-value">${customer.phone}</div>
                        </div>
                        <div class="detail-group">
                            <div class="detail-label">E-post</div>
                            <div class="detail-value">${customer.email || 'Ikke angitt'}</div>
                        </div>
                        <div class="detail-group">
                            <div class="detail-label">Adresse</div>
                            <div class="detail-value">${customer.physicalAddress}</div>
                        </div>
                    </div>
                </div>
            ` : ''}
        `;

        // Oppdater knapp for å se full ordre
        const viewOrderBtn = document.getElementById('view-order-details-btn');
        viewOrderBtn.onclick = () => {
            window.open(`/admin/servicedetaljer.html?id=${orderId}`, '_blank');
        };

        orderModal.classList.add('show');
    };

    /**
     * Lukker ordre-modal
     */
    window.closeOrderModal = function() {
        orderModal.classList.remove('show');
    };

    /**
     * Formaterer dato for visning
     */
    function formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString('no-NO', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    }

    /**
     * Søkefunksjonalitet
     */
    searchInput.addEventListener('input', function(e) {
        const searchTerm = e.target.value.toLowerCase();
        
        if (!searchTerm) {
            renderCustomerList(allCustomers);
            return;
        }

        console.log('🔍 Søker etter:', searchTerm);
        const filteredCustomers = allCustomers.filter(customer => 
            customer.name.toLowerCase().includes(searchTerm) ||
            (customer.customerNumber && customer.customerNumber.toString().includes(searchTerm)) ||
            (customer.contact && customer.contact.toLowerCase().includes(searchTerm)) ||
            (customer.organizationNumber && customer.organizationNumber.includes(searchTerm))
        );
        
        console.log(`Fant ${filteredCustomers.length} kunder som matcher søket`);
        renderCustomerList(filteredCustomers);
        
        // Tøm servicehistorikk når søket endres
        if (filteredCustomers.length === 0 || !currentSelectedCustomer) {
            serviceHistoryContent.innerHTML = `
                <div class="empty-history">
                    <p>Velg en kunde for å se servicehistorikk</p>
                </div>
            `;
        }
    });

    /**
     * Konverterer status til norsk tekst
     */
    function getStatusText(status) {
        const statusMap = {
            'scheduled': 'Planlagt',
            'completed': 'Fullført', 
            'cancelled': 'Avbrutt',
            'in-progress': 'Pågår',
            'pending': 'Venter'
        };
        return statusMap[status] || status || 'Planlagt';
    }

    /**
     * Lukker modal når man klikker utenfor
     */
    orderModal.addEventListener('click', function(e) {
        if (e.target === orderModal) {
            closeOrderModal();
        }
    });

    /**
     * Lukker modal med ESC-tasten
     */
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            if (orderModal.classList.contains('show')) {
                closeOrderModal();
            } else {
                searchInput.value = '';
                renderCustomerList(allCustomers);
                searchInput.focus();
            }
        }
    });

    // Last inn data ved oppstart
    loadData();
    
    console.log('✅ Kundesystem initialisert (fullstendig versjon)');
});