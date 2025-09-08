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
            customerTableBody.innerHTML = `<tr><td colspan="2">Ingen kunder funnet.</td></tr>`;
            return;
        }

        customerTableBody.innerHTML = customers.map(customer => `
            <tr data-customer-id="${customer.id}" onclick="selectCustomer('${customer.id}')" style="cursor: pointer;">
                <td>
                    <div style="font-weight: 500;">${customer.name || 'Ukjent navn'}</div>
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
        // Konverter til string for sikker sammenligning
        const customerIdStr = String(customerId);
        
        const customer = allCustomers.find(c => String(c.id) === customerIdStr);
        
        if (!customer) {
            console.error('Kunde ikke funnet:', customerIdStr);
            return;
        }

        // Oppdater valgt rad
        const rows = customerTableBody.querySelectorAll('tr');
        rows.forEach(row => row.classList.remove('selected'));
        
        const selectedRow = customerTableBody.querySelector(`[data-customer-id="${customerIdStr}"]`);
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
        <!-- MODERNE KUNDEKORT HEADER -->
        <div class="modern-customer-header">
            <div class="customer-title-section">
                <h2 class="modern-customer-name">${customer.name}</h2>
                ${customer.customerNumber ? 
                    `<span class="modern-customer-number">Nr. ${customer.customerNumber}</span>` : 
                    ''
                }
            </div>
        </div>

        <!-- HOVEDINNHOLD I TO KOLONNER -->
        <div class="modern-customer-content">
            <!-- VENSTRE KOLONNE -->
            <div class="customer-left-section">
                <div class="modern-info-group">
                    <div class="modern-info-label">Organisasjonsnummer</div>
                    <div class="modern-info-value ${customer.organizationNumber ? '' : 'empty'}">
                        ${customer.organizationNumber || 'Ikke angitt'}
                    </div>
                </div>
                
                <div class="modern-info-group">
                    <div class="modern-info-label">Kundeansvarlig</div>
                    <div class="modern-info-value">${customer.customerAccountManager || 'Ikke tildelt'}</div>
                </div>
                
                <div class="modern-info-group">
                    <div class="modern-info-label">Kontaktperson</div>
                    <div class="modern-info-value">${customer.contact || 'Ikke angitt'}</div>
                </div>
            </div>

            <!-- HØYRE KOLONNE -->
            <div class="customer-right-section">
                <div class="modern-info-group">
                    <div class="modern-info-label">E-post</div>
                    <div class="modern-info-value ${customer.email ? 'highlight' : 'empty'}">
                        ${customer.email || 'Mangler e-post'}
                    </div>
                </div>
                
                <div class="modern-info-group">
                    <div class="modern-info-label">Telefon</div>
                    <div class="modern-info-value">${customer.phone || 'Ikke angitt'}</div>
                </div>
                
                <div class="modern-info-group">
                    <div class="modern-info-label">Mobil</div>
                    <div class="modern-info-value">${customer.mobile || 'Ikke angitt'}</div>
                </div>
            </div>
        </div>

        <!-- ADRESSE-SEKSJON -->
        <div class="modern-address-section">
            <h3 class="modern-section-title">📍 Adresser</h3>
            <div class="modern-address-grid">
                <div class="modern-address-card">
                    <div class="address-card-title">Postadresse</div>
                    <div class="address-card-content">
                        ${customer.postalAddress || 'Ikke registrert'}
                    </div>
                </div>
                <div class="modern-address-card">
                    <div class="address-card-title">Forretningsadresse</div>
                    <div class="address-card-content">
                        ${customer.physicalAddress || 'Ikke registrert'}
                    </div>
                </div>
            </div>
        </div>
    `;
    
    detailsPlaceholder.style.display = 'none';
    detailsContent.style.display = 'block';
    
    console.log('✅ Moderne kundedetaljer rendret');
}

    function renderServiceHistory(customer) {
    console.log('📊 Rendrer servicehistorikk for:', customer.name);
    console.log('🔍 Customer object:', customer);
    console.log('🔍 Total orders i systemet:', customerHistory.length);
    
    // FORBEDRET MATCHING - prøv alle mulige ID-kombinasjoner
    const customerServiceHistory = customerHistory.filter(order => {
        // Debug hver ordre
        const matches = [
            // Direkte ID matching  
            order.customerId === customer.id,
            order.customer_id === customer.id,
            
            // String vs Number konvertering
            String(order.customerId) === String(customer.id),
            String(order.customer_id) === String(customer.id),
            Number(order.customerId) === Number(customer.id),
            Number(order.customer_id) === Number(customer.id),
            
            // Customer number matching
            order.customerNumber === customer.customerNumber,
            String(order.customerNumber) === String(customer.customerNumber),
            
            // Name matching (backup)
            order.customerName === customer.name,
            order.customer_name === customer.name
        ];
        
        const matchFound = matches.some(match => match === true);
        
        if (matchFound) {
            console.log('✅ MATCH:', {
                orderId: order.id,
                orderCustomerId: order.customer_id || order.customerId,
                customerName: order.customer_name || order.customerName,
                selectedCustomerId: customer.id,
                selectedCustomerName: customer.name
            });
        }
        
        return matchFound;
    });

    console.log(`🎯 Funnet ${customerServiceHistory.length} ordre for ${customer.name}`);

    if (customerServiceHistory.length === 0) {
        serviceHistoryContent.innerHTML = `
            <div class="empty-history">
                <p>Ingen servicehistorikk funnet for ${customer.name}</p>
                <div class="debug-info">
                    <small>Debug: Kunde-ID = "${customer.id}" | Total ordre = ${customerHistory.length}</small>
                    ${customerHistory.length > 0 ? `<small>Første ordre kunde-ID = "${customerHistory[0].customer_id || customerHistory[0].customerId}"</small>` : ''}
                </div>
            </div>
        `;
        return;
    }

    // SORTER ORDRE ETTER DATO (nyeste først)
    const sortedHistory = customerServiceHistory.sort((a, b) => {
        const dateA = new Date(a.scheduled_date || a.scheduledDate || a.created_at || 0);
        const dateB = new Date(b.scheduled_date || b.scheduledDate || b.created_at || 0);
        return dateB - dateA; // Nyeste først
    });

    // NYTT FORMAT: Ordre-ID, dato, tekniker per linje
    const historyHTML = `
        <div class="service-history-list-modern">
            ${sortedHistory.map(order => {
                // Formater ordre-ID
                const orderNumber = order.orderNumber || `SO-${order.id.split('-')[1]}-${order.id.split('-')[2]?.slice(-6)}` || order.id;
                
                // Formater dato
                const orderDate = order.scheduled_date || order.scheduledDate || order.created_at;
                const formattedDate = orderDate ? formatDate(orderDate) : 'Ikke planlagt';
                
                // Finn tekniker
                const technician = order.technician_name || order.technicianName || 
                               (order.technicianId ? 'Tekniker tildelt' : 'Ikke tildelt');
                
                return `
                    <div class="service-history-order" onclick="showOrderDetails('${order.id}')">
                        <div class="order-id">#${orderNumber}</div>
                        <div class="order-date">${formattedDate}</div>
                        <div class="order-technician">${technician}</div>
                    </div>
                `;
            }).join('')}
        </div>
    `;

    serviceHistoryContent.innerHTML = historyHTML;
    console.log('✅ Servicehistorikk rendret med', sortedHistory.length, 'ordre');
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

    console.log('📋 Ordre data:', order);

    // Formater ordre-nummer
    const orderNumber = order.orderNumber || `SO-${order.id.split('-')[1]}-${order.id.split('-')[2]?.slice(-6)}` || order.id;
    
    // Hent tekniker-informasjon
    let technicianInfo = 'Ikke tildelt';
    if (order.technician_name || order.technicianName) {
        technicianInfo = order.technician_name || order.technicianName;
    } else if (order.technician_id || order.technicianId) {
        technicianInfo = `Tekniker ID: ${order.technician_id || order.technicianId}`;
    }
    
    // Formater planlagt dato og tid
    let planlagtDateTime = 'Ikke planlagt';
    if (order.scheduled_date || order.scheduledDate) {
        const dateStr = order.scheduled_date || order.scheduledDate;
        const timeStr = order.scheduled_time || order.scheduledTime;
        
        try {
            const date = new Date(dateStr);
            planlagtDateTime = date.toLocaleDateString('no-NO', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            });
            
            if (timeStr) {
                planlagtDateTime += ` kl. ${timeStr}`;
            }
        } catch (e) {
            planlagtDateTime = dateStr;
        }
    }
    
    // Bestem service type / anleggstype
    let serviceType = 'Ikke spesifisert';
    if (order.service_type || order.serviceType) {
        serviceType = order.service_type || order.serviceType;
    }
    
    // Vis utstyr hvis tilgjengelig
    let equipmentInfo = '';
    if (order.included_equipment_ids && Array.isArray(order.included_equipment_ids) && order.included_equipment_ids.length > 0) {
        equipmentInfo = `
            <div class="report-section">
                <h4>📱 Inkludert utstyr</h4>
                <div class="equipment-list">
                    ${order.included_equipment_ids.map(eqId => `
                        <div class="equipment-item">ID: ${eqId}</div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    const modalBody = document.getElementById('order-modal-body');
    modalBody.innerHTML = `
        <div class="modern-order-modal">
            <!-- Ordre-header -->
            <div class="order-modal-header">
                <div class="order-number-section">
                    <span class="order-number-label">Ordrenummer</span>
                    <span class="order-number-value">#${orderNumber}</span>
                </div>
                <div class="order-status-section">
                    <span class="status-badge status-${order.status || 'scheduled'}">
                        ${getStatusText(order.status || 'scheduled')}
                    </span>
                </div>
            </div>

            <!-- Hovedinformasjon -->
            <div class="order-details-grid">
                <div class="detail-card">
                    <div class="detail-icon">🔧</div>
                    <div class="detail-content">
                        <div class="detail-label">Servicetype / Anleggstype</div>
                        <div class="detail-value">${serviceType}</div>
                    </div>
                </div>

                <div class="detail-card">
                    <div class="detail-icon">📅</div>
                    <div class="detail-content">
                        <div class="detail-label">Planlagt tidspunkt</div>
                        <div class="detail-value">${planlagtDateTime}</div>
                    </div>
                </div>

                <div class="detail-card">
                    <div class="detail-icon">👨‍🔧</div>
                    <div class="detail-content">
                        <div class="detail-label">Tekniker</div>
                        <div class="detail-value">${technicianInfo}</div>
                    </div>
                </div>

                <div class="detail-card">
                    <div class="detail-icon">📝</div>
                    <div class="detail-content">
                        <div class="detail-label">Beskrivelse</div>
                        <div class="detail-value">${order.description || 'Ingen beskrivelse angitt'}</div>
                    </div>
                </div>
            </div>

            ${equipmentInfo}

            <!-- Opprettelsesinfo -->
            <div class="order-meta-info">
                <div class="meta-item">
                    <span class="meta-label">Opprettet:</span>
                    <span class="meta-value">${order.created_at ? formatDate(order.created_at) : 'Ukjent'}</span>
                </div>
                ${order.updated_at ? `
                    <div class="meta-item">
                        <span class="meta-label">Sist oppdatert:</span>
                        <span class="meta-value">${formatDate(order.updated_at)}</span>
                    </div>
                ` : ''}
            </div>
        </div>
    `;

    // Oppdater "Se full ordre" knapp
    const viewOrderBtn = document.getElementById('view-order-details-btn');
    if (viewOrderBtn) {
        viewOrderBtn.onclick = function() {
            window.open(`/app/orders.html?id=${order.id}`, '_blank');
        };
    }

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