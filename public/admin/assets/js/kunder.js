// VERSION CHECK: 2026-02-16 15:35 - EQUIPMENT FEATURE ADDED
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Starter kundesystem (fullstendig versjon)...');
    console.log('🔧 VERSION: 2026-02-16 15:35 - Equipment feature included');
    
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
    const equipmentEditModal = document.getElementById('equipment-edit-modal');
    const equipmentConfirmModal = document.getElementById('equipment-confirm-modal');
    let currentCustomerEquipment = [];

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
 * Velger og viser en kunde - MED lazy loading av adresser
 */
window.selectCustomer = async function(customerId) {
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
    
    // Render med placeholder-adresser først
    currentCustomerEquipment = [];
    renderCustomerDetails(customer);
    renderEquipmentLoading();
    renderServiceHistory(customer);
    
    // NYTT: Hent adresser i bakgrunnen hvis de ikke allerede er hentet
    if (!customer.physicalAddress || !customer.postalAddress) {
        console.log(`📍 Henter adresser for ${customer.name}...`);
        try {
            const response = await fetch(`/api/admin/customers/${customerId}/addresses`, {
                credentials: 'include'
            });
            
            if (response.ok) {
                const addresses = await response.json();
                
                // Oppdater customer-objektet
                customer.physicalAddress = addresses.physicalAddress;
                customer.postalAddress = addresses.postalAddress;
                
                // Re-render kun kundedetaljer (ikke anlegg — de lastes separat)
                renderCustomerDetails(customer);
                console.log('✅ Adresser hentet og oppdatert');
            } else {
                console.error('Feil ved henting av adresser:', response.status);
            }
        } catch (error) {
            console.error('Feil ved henting av adresser:', error);
        }
    }

    // Hent kontaktperson fra /contact endpoint (Tripletex har ikke pålitelig
    // primærkontakt på Customer — vi henter alltid fra /contact API)
    if (!customer._contactFetched) {
        console.log(`👤 Henter kontaktperson for ${customer.name}...`);
        try {
            const contactResponse = await fetch(`/api/admin/customers/${customerId}/contact`, {
                credentials: 'include'
            });

            if (contactResponse.ok) {
                const contactData = await contactResponse.json();
                customer._contactFetched = true;
                if (contactData.contact) {
                    customer.contact = contactData.contact;
                }
                if (contactData.email && !customer.email) {
                    customer.email = contactData.email;
                }
                renderCustomerDetails(customer);
                console.log('✅ Kontaktperson hentet:', customer.contact || '(ingen funnet)');
            }
        } catch (error) {
            console.error('Feil ved henting av kontaktperson:', error);
        }
    }

    // Hent rapport-epost (servfixmail) i bakgrunnen
    if (!customer.reportEmail) {
        console.log(`📧 Henter rapport-epost for ${customer.name}...`);
        try {
            const reportResponse = await fetch(`/api/admin/customers/${customerId}/servfixmail`, {
                credentials: 'include'
            });
            
            if (reportResponse.ok) {
                const reportData = await reportResponse.json();
                
                // Oppdater customer-objektet
                customer.reportEmail = reportData.email || null;
                
                // Re-render kun kundedetaljer (ikke anlegg — de lastes separat)
                renderCustomerDetails(customer);
                console.log('✅ Rapport-epost hentet:', customer.reportEmail || 'Ikke funnet');
            } else {
                console.error('Feil ved henting av rapport-epost:', reportResponse.status);
            }
        } catch (error) {
            console.error('Feil ved henting av rapport-epost:', error);
        }
    }

    // Hent anlegg for kunden
    console.log(`🏢 Henter anlegg for ${customer.name}...`);
    try {
        const equipmentResponse = await fetch(`/api/admin/equipment?customerId=${customerId}`, {
            credentials: 'include'
        });

        if (equipmentResponse.ok) {
            currentCustomerEquipment = await equipmentResponse.json();
            renderEquipmentList(currentCustomerEquipment);
            console.log(`✅ Hentet ${currentCustomerEquipment.length} anlegg`);
        } else {
            console.error('Feil ved henting av anlegg:', equipmentResponse.status);
            currentCustomerEquipment = [];
            renderEquipmentList([]);
        }
    } catch (error) {
        console.error('Feil ved henting av anlegg:', error);
        currentCustomerEquipment = [];
        renderEquipmentList([]);
    }
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
                    <div class="modern-info-label">Rapport epost</div>
                    <div class="modern-info-value ${customer.reportEmail ? 'highlight' : 'empty'}">
                        ${customer.reportEmail || 'Ikke registrert'}
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

        <!-- ANLEGG-SEKSJON (fylles av renderEquipmentList) -->
        <div id="equipment-list-section"></div>
    `;

    detailsPlaceholder.style.display = 'none';
    detailsContent.style.display = 'block';

    console.log('✅ Moderne kundedetaljer rendret');
}

    /**
     * Viser laste-indikator for anlegg
     */
    function renderEquipmentLoading() {
        const container = document.getElementById('equipment-list-section');
        if (!container) return;

        container.innerHTML = `
            <div class="modern-equipment-section">
                <h3 class="modern-section-title">Anlegg</h3>
                <div class="equipment-empty-state" style="font-style: normal;">
                    Laster anlegg...
                </div>
            </div>
        `;
    }

    /**
     * Rendrer anleggsliste under kundedetaljer
     */
    function renderEquipmentList(equipment) {
        const container = document.getElementById('equipment-list-section');
        if (!container) return;

        if (!equipment || equipment.length === 0) {
            container.innerHTML = `
                <div class="modern-equipment-section">
                    <h3 class="modern-section-title">Anlegg</h3>
                    <div class="equipment-empty-state">
                        Ingen anlegg registrert for denne kunden
                    </div>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <div class="modern-equipment-section">
                <h3 class="modern-section-title">Anlegg (${equipment.length})</h3>
                <div class="equipment-card-grid">
                    ${equipment.map(eq => `
                        <div class="equipment-list-card" onclick="openEquipmentEditModal('${eq.id}')" title="Klikk for å redigere">
                            <div class="equipment-card-name">${eq.name || 'Uten navn'}</div>
                            <div class="equipment-card-details">
                                <span class="equipment-card-type">${eq.type || '-'}</span>
                                ${eq.systemNumber ? `<span class="equipment-card-number">#${eq.systemNumber}</span>` : ''}
                            </div>
                            ${eq.systemPlacement ? `<div class="equipment-card-placement">${eq.systemPlacement}</div>` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
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
                <p>Ingen service funnet</p>
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
                
                // Finn tekniker - viser navn hvis tilgjengelig
                const technician = order.technician_name || order.technicianName || 'Ikke tildelt';
                
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
    window.showOrderDetails = async function(orderId) {
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

    // === HENT ANLEGG FRA RAPPORT-API ===
    let equipmentList = [];
    let reportId = null;

    try {
        console.log('📡 Henter anlegg for ordre:', order.id);
        
        const reportResponse = await fetch(`/api/admin/reports?orderId=${order.id}`, {
            credentials: 'include'
        });
        
        if (reportResponse.ok) {
            const reportData = await reportResponse.json();
            console.log('📊 Rapport-data:', reportData);
            
            if (reportData.reports && reportData.reports.length > 0) {
                const orderReport = reportData.reports[0];
                
                // Hent rapport-ID for PDF
                if (orderReport.report_ids && orderReport.report_ids.length > 0) {
                    reportId = orderReport.report_ids[0];
                }
                
                // Parse anlegg (kan være flere, komma-separert)
                if (orderReport.equipment_names) {
                    const names = orderReport.equipment_names.split(', ');
                    const types = (orderReport.equipment_types || '').split(', ');
                    
                    equipmentList = names.map((name, index) => ({
                        name: name.trim(),
                        type: types[index] ? types[index].trim() : 'Ikke spesifisert'
                    }));
                    
                    console.log('🏢 Anlegg funnet:', equipmentList.length);
                }
            }
        }
    } catch (error) {
        console.error('❌ Feil ved henting av anlegg:', error);
    }
    
    const modalBody = document.getElementById('order-modal-body');
    modalBody.innerHTML = `
    <div class="simple-order-modal">
        <!-- Header med kundenavn og dato -->
        <div style="margin-bottom: 4px;">
            <div style="font-size: 16px; font-weight: 600; color: #1e293b;">
                Service — ${currentSelectedCustomer ? currentSelectedCustomer.name : (order.customer_name || order.customerName || '')}
            </div>
            <div style="font-size: 13px; color: #64748b; margin-top: 2px;">${planlagtDateTime}</div>
        </div>
        <div class="modal-simple-header">
            <div class="order-number-black">#${orderNumber}</div>
            <div class="status-badge-blue">${getStatusText(order.status || 'scheduled')}</div>
        </div>

        <!-- Info-liste -->
        <div class="modal-info-rows">
            <div class="info-row">
                <span class="label">🔧 Servicetype</span>
                <span class="value">${serviceType}</span>
            </div>
            <div class="info-row">
                <span class="label">📅 Planlagt</span>
                <span class="value">${planlagtDateTime}</span>
            </div>
            <div class="info-row">
                <span class="label">👨‍🔧 Tekniker</span>
                <span class="value">${technicianInfo}</span>
            </div>
        </div>

        <!-- Anlegg som tabell med kolonner -->
        ${equipmentList && equipmentList.length > 0 ? `
        <div class="equipment-section">
            <div class="equipment-header">🏢 Anlegg</div>
            <table class="equipment-table">
                <thead>
                    <tr>
                        <th>Systemnavn</th>
                        <th>Systemtype</th>
                    </tr>
                </thead>
                <tbody>
                    ${equipmentList.map(eq => `
                        <tr>
                            <td>${eq.name}</td>
                            <td>${eq.type}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        ` : ''}
    </div>
`;

    // Oppdater "Vis PDF" knapp
    const viewPdfBtn = document.getElementById('view-pdf-btn');
    if (viewPdfBtn && reportId) {
        viewPdfBtn.onclick = function() {
            window.open(`/api/admin/reports/${reportId}/pdf`, '_blank');
        };
    } else if (viewPdfBtn) {
        viewPdfBtn.disabled = true;
        viewPdfBtn.textContent = '📄 PDF ikke tilgjengelig';
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
     * Åpner redigering av anlegg
     */
    window.openEquipmentEditModal = function(equipmentId) {
        const eq = currentCustomerEquipment.find(e => String(e.id) === String(equipmentId));
        if (!eq) {
            console.error('Anlegg ikke funnet:', equipmentId);
            return;
        }

        document.getElementById('edit-equipment-id').value = eq.id;
        document.getElementById('edit-systemnavn').value = eq.name || '';
        document.getElementById('edit-systemtype').value = eq.type || '';
        document.getElementById('edit-systemnummer').value = eq.systemNumber || '';
        document.getElementById('edit-plassering').value = eq.systemPlacement || '';
        document.getElementById('edit-betjener').value = eq.betjener || '';
        document.getElementById('edit-location').value = eq.location || '';
        document.getElementById('edit-notater').value = eq.internalNotes || '';

        // Dynamisk tittel: Rediger Anlegg — Kundenavn — Anleggsnavn
        const customerName = currentSelectedCustomer ? currentSelectedCustomer.name : '';
        const equipmentName = eq.name || 'Uten navn';
        document.getElementById('equipment-edit-title').textContent =
            `Rediger Anlegg — ${customerName} — ${equipmentName}`;

        equipmentEditModal.classList.add('show');
    };

    /**
     * Lukker redigeringsmodal
     */
    window.closeEquipmentEditModal = function() {
        equipmentEditModal.classList.remove('show');
    };

    /**
     * Viser bekreftelsesdialog før lagring
     */
    window.confirmSaveEquipment = function() {
        equipmentConfirmModal.classList.add('show');
    };

    /**
     * Avbryter lagring (lukker bekreftelsesdialog)
     */
    window.cancelSaveEquipment = function() {
        equipmentConfirmModal.classList.remove('show');
    };

    /**
     * Utfører lagring av anleggsendringer
     */
    window.executeSaveEquipment = async function() {
        const equipmentId = document.getElementById('edit-equipment-id').value;

        const body = {
            systemnavn: document.getElementById('edit-systemnavn').value,
            systemtype: document.getElementById('edit-systemtype').value,
            systemnummer: document.getElementById('edit-systemnummer').value,
            plassering: document.getElementById('edit-plassering').value,
            betjener: document.getElementById('edit-betjener').value,
            location: document.getElementById('edit-location').value,
            notater: document.getElementById('edit-notater').value
        };

        try {
            const response = await fetch(`/api/admin/equipment/${equipmentId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(body)
            });

            if (response.ok) {
                console.log('✅ Anlegg oppdatert');

                // Lukk begge modaler
                equipmentConfirmModal.classList.remove('show');
                equipmentEditModal.classList.remove('show');

                // Re-hent anleggsliste
                if (currentSelectedCustomer) {
                    const eqResponse = await fetch(`/api/admin/equipment?customerId=${currentSelectedCustomer.id}`, {
                        credentials: 'include'
                    });
                    if (eqResponse.ok) {
                        currentCustomerEquipment = await eqResponse.json();
                        renderEquipmentList(currentCustomerEquipment);
                    }
                }
            } else {
                const errorData = await response.json();
                alert('Feil ved lagring: ' + (errorData.error || 'Ukjent feil'));
            }
        } catch (error) {
            console.error('Feil ved lagring av anlegg:', error);
            alert('Nettverksfeil ved lagring av anlegg');
        }
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

    if (equipmentEditModal) {
        equipmentEditModal.addEventListener('click', function(e) {
            if (e.target === equipmentEditModal) {
                closeEquipmentEditModal();
            }
        });
    }

    if (equipmentConfirmModal) {
        equipmentConfirmModal.addEventListener('click', function(e) {
            if (e.target === equipmentConfirmModal) {
                cancelSaveEquipment();
            }
        });
    }

    /**
     * Lukker modal med ESC-tasten
     */
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            if (equipmentConfirmModal.classList.contains('show')) {
                cancelSaveEquipment();
            } else if (equipmentEditModal.classList.contains('show')) {
                closeEquipmentEditModal();
            } else if (orderModal.classList.contains('show')) {
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