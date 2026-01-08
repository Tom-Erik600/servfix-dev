/**
 * Servicerapporter Admin - Air-Tech AS
 * Med rediger-funksjonalitet og modal
 */

document.addEventListener('DOMContentLoaded', async function() {
    console.log('🔧 Loading servicerapporter admin system...');

    let allReports = [];
    let currentInvoiceOrderId = null;

    window.openInvoiceModal = function(orderId, customerName) {
        currentInvoiceOrderId = orderId;
        document.getElementById('invoice-order-id').textContent = orderId;
        document.getElementById('invoice-customer-name').textContent = customerName;
        document.getElementById('invoice-number-input').value = '';
        document.getElementById('invoice-comment-input').value = '';
        document.getElementById('invoice-modal').classList.add('show');
    };

    window.closeInvoiceModal = function() {
        document.getElementById('invoice-modal').classList.remove('show');
        currentInvoiceOrderId = null;
    };

    window.saveInvoice = async function() {
        const invoiceNumber = document.getElementById('invoice-number-input').value.trim();
        const comment = document.getElementById('invoice-comment-input').value.trim();
        
        if (!invoiceNumber) {
            showToast('❌ Fakturanummer er påkrevd', 'error');
            return;
        }
        
        try {
            showToast('💾 Lagrer faktura...', 'info');
            
            const response = await fetch(`/api/admin/reports/order/${currentInvoiceOrderId}/invoice`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ 
                    invoiced: true,
                    invoiceNumber: invoiceNumber,
                    comment: comment
                })
            });
            
            const result = await response.json();
            
            if (response.ok) {
                showToast(`✅ ${result.message}`, 'success');
                closeInvoiceModal();
                await loadReports();
            } else {
                throw new Error(result.error || 'Ukjent feil');
            }
        } catch (error) {
            console.error('Error:', error);
            showToast('❌ Feil: ' + error.message, 'error');
        }
    };
    
    // State management
    const state = {
        reports: [],
        stats: {},
        isLoading: false,
        currentEditReport: null,
        currentEditReportId: null,
        filters: {
            status: 'all',
            search: ''
        }
    };

    // DOM elements
    const elements = {
        tableBody: document.getElementById('reports-table-body'),
        searchInput: document.getElementById('search-input'),
        statusFilter: document.getElementById('status-filter'),
        editModal: document.getElementById('edit-report-modal'),
        editModalBody: document.getElementById('edit-modal-body'),
        stats: {
            total: document.getElementById('total-reports'),
            sent: document.getElementById('sent-reports'),
            pending: document.getElementById('pending-reports'),
            invoiced: document.getElementById('invoiced-reports')
        }
    };

    // Initialize system
    await initializeSystem();

    /**
     * Initialize the admin reports system
     */
    async function initializeSystem() {
        try {
            setupEventListeners();
            await loadReports();
            console.log('✅ Servicerapporter system initialized successfully');
        } catch (error) {
            console.error('❌ Failed to initialize system:', error);
            showError('Kunne ikke initialisere rapportsystemet');
        }
    }

    /**
     * Setup all event listeners
     */
    function setupEventListeners() {
        // Search input with debouncing
        if (elements.searchInput) {
            elements.searchInput.addEventListener('input', debounce(handleFilters, 300));
        }

        // Status filter
        if (elements.statusFilter) {
            elements.statusFilter.addEventListener('change', handleFilters);
        }

        // Modal close handlers
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeEditModal();
            }
        });

        // ✅ FIX: Click outside modal to close - track mousedown to prevent closing during text selection
        if (elements.editModal) {
            let mouseDownTarget = null;

            elements.editModal.addEventListener('mousedown', (e) => {
                mouseDownTarget = e.target;
            });

            elements.editModal.addEventListener('click', (e) => {
                // Only close if BOTH mousedown AND click happened on the overlay
                if (e.target.classList.contains('modal-overlay') &&
                    mouseDownTarget && mouseDownTarget.classList.contains('modal-overlay')) {
                    closeEditModal();
                }
                mouseDownTarget = null;
            });
        }

        // ✅ FIX: Same for invoice modal
        const invoiceModal = document.getElementById('invoice-modal');
        if (invoiceModal) {
            let invoiceMouseDownTarget = null;

            invoiceModal.addEventListener('mousedown', (e) => {
                invoiceMouseDownTarget = e.target;
            });

            invoiceModal.addEventListener('click', (e) => {
                if (e.target.classList.contains('modal-overlay') &&
                    invoiceMouseDownTarget && invoiceMouseDownTarget.classList.contains('modal-overlay')) {
                    closeInvoiceModal();
                }
                invoiceMouseDownTarget = null;
            });

            // ESC key to close invoice modal
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && invoiceModal.classList.contains('show')) {
                    closeInvoiceModal();
                }
            });
        }
    }

    /**
     * Load reports from the admin API
     */
    async function loadReports() {
        if (state.isLoading) return;
        
        state.isLoading = true;
        showLoadingState();

        try {
            const response = await fetch('/api/admin/reports', {
                method: 'GET',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            console.log('📊 Reports data received:', data);

            state.reports = data.reports || [];
            state.stats = data.stats || {};

            renderReportsTable(state.reports);
            updateStatistics();
            
            console.log(`✅ Successfully loaded ${state.reports.length} reports`);

        } catch (error) {
            console.error('❌ Error loading reports:', error);
            showError('Feil ved lasting av rapporter: ' + error.message);
        } finally {
            state.isLoading = false;
        }
    }

    /**
     * Show loading state
     */
    function showLoadingState() {
        if (elements.tableBody) {
            elements.tableBody.innerHTML = `
                <tr>
                    <td colspan="9" class="loading-cell">
                        Laster rapporter...
                    </td>
                </tr>
            `;
        }
    }

    /**
     * Show error message
     */
    function showError(message) {
        if (elements.tableBody) {
            elements.tableBody.innerHTML = `
                <tr>
                    <td colspan="9" class="loading-cell" style="color: #DC2626;">
                        ❌ ${message}
                    </td>
                </tr>
            `;
        }
    }

/**
 * Render the reports table - NY VERSJON FOR ORDRE-GRUPPERING
 */
function renderReportsTable(reports) {
    const tbody = document.getElementById('reports-table-body');
    
    if (!reports || reports.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 40px; color: var(--text-light);">Ingen rapporter funnet</td></tr>';
        return;
    }
    
    // Generer HTML - nå er hver report allerede én ordre
    let html = '';
    reports.forEach((orderReport) => {
        html += createOrderReportRow(orderReport);
    });
    
    tbody.innerHTML = html;
    
    // Oppdater statistikk
    updateStatistics();
}

/**
 * Create a table row for an order (with all equipment on one line)
 */
function createOrderReportRow(order) {
    const isInvoiced = order.is_invoiced;
    const isSent = order.sent_til_fakturering;
    const hasPDF = order.pdf_generated;
    const isHasteordre = order.service_type === 'Hasteordre';

    let rowClass = '';
    if (isHasteordre) {
        rowClass = 'row-emergency';
    } else if (isInvoiced) {
        rowClass = 'row-invoiced';
    } else if (isSent) {
        rowClass = 'row-sent';
    } else {
        rowClass = 'row-pending';
    }

    return `
        <tr class="${rowClass}">
            <td>
                <strong style="color: var(--primary-blue);">${order.order_id}</strong>
                ${isHasteordre ? '<br><span class="emergency-badge">⚡ HASTEORDRE</span>' : ''}
            </td>
            <td>
                <div style="font-weight: 500;">${formatDate(order.order_date)}</div>
            </td>
            <td>
                <div style="font-weight: 400;">
                    ${formatDate(order.last_service_date)}
                </div>
            </td>
            <td>
                <div style="font-weight: 500;">${order.customer_name || 'Ukjent kunde'}</div>
                ${isHasteordre ? '<div class="emergency-indicator">⚡ Hasteordre</div>' : ''}
            </td>
            <td>
                ${order.technician_name ?
                    order.technician_name.split(' ').map(n => n[0]).join('').toUpperCase() :
                    'N/A'
                }
            </td>
            <td>
                <div style="font-weight: 500;">
                    ${order.equipment_names || 'Ukjent'}
                </div>
                ${order.equipment_count > 1 ? 
                    `<small style="color: var(--text-light);">${order.equipment_count} anlegg</small>` :
                    `<small style="color: var(--text-light);">${order.equipment_types || ''}</small>`
                }
            </td>
            <td>
                <span class="status-indicator status-${isSent ? 'sent' : 'pending'}">
                    ${isSent ? '✅ Sendt til kunde' : '⏳ Venter sending'}
                </span>
            </td>
            <td>
                ${isInvoiced ? `
                    <div class="invoice-status invoiced">
                        <span class="invoice-badge">✓ Fakturert</span>
                        <div class="invoice-number">${order.invoice_number || 'Mangler nr'}</div>
                    </div>
                ` : `
                    <button class="btn btn-sm btn-invoice" 
                            onclick="openInvoiceModal('${order.order_id}', '${order.customer_name}')">
                        📄 Fakturer
                    </button>
                `}
            </td>
            <td>
                <div style="font-weight: 400;">
                    ${order.customer_email || '<span style="color: var(--text-light);">Mangler e-post</span>'}
                </div>
            </td>
            <td>
                <div class="action-buttons">
                    ${hasPDF ?
                        `<button class="btn btn-sm btn-outline action-btn" onclick="viewOrderPDFs('${order.order_id}', ${JSON.stringify(order.report_ids).replace(/"/g, '&quot;')})" title="Vis rapport">
                            📄 Vis rapport
                        </button>` :
                        `<span class="no-pdf-text">PDF ikke generert</span>`
                    }

                    ${hasPDF ?
                        `<button class="btn btn-sm btn-edit action-btn" onclick="editReport('${order.order_id}', ${JSON.stringify(order.report_ids).replace(/"/g, '&quot;')})" title="Rediger rapport">
                            ✏️ Rediger
                        </button>` :
                        ''
                    }

                    ${!isSent && hasPDF && order.customer_email ?
                        `<button class="btn btn-sm btn-success action-btn" onclick="sendOrderToCustomer('${order.order_id}')" title="Send til kunde">
                            📧 Send til kunde
                        </button>` :
                        ''
                    }

                    ${!isSent && hasPDF && !order.customer_email ?
                        `<span class="no-email-warning">⚠️ Mangler e-post</span>` :
                        ''
                    }
                </div>
            </td>
        </tr>
    `;
}

/**
 * View PDF for an order - Opens the PDF directly using reportId
 */
window.viewOrderPDFs = function(orderId, reportIds) {
    if (!reportIds || reportIds.length === 0) {
        showToast('❌ Ingen PDF funnet for denne ordren', 'error');
        return;
    }
    
    // Siden 1-1 forhold mellom ordre og rapport: Bruk første rapport-ID
    const reportId = reportIds[0];
    const pdfUrl = `/api/admin/reports/${reportId}/pdf`;
    window.open(pdfUrl, '_blank');
    
    console.log(`📄 Opening PDF for report ${reportId} from order ${orderId}`);
};

/**
 * Send entire order (all reports) to customer
 */
window.sendOrderToCustomer = async function(orderId) {
    try {
        showToast('🔍 Forbereder sending av ordre...', 'info');
        
        // Send alle rapporter for denne ordren
        const response = await fetch(`/api/admin/reports/order/${orderId}/send`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Kunne ikke sende rapporter');
        }

        showToast(`✅ ${result.message || 'Rapporter sendt til kunde'}`, 'success');
        await loadReports(); // Reload
        
    } catch (error) {
        console.error('Error sending order:', error);
        showToast(`❌ ${error.message}`, 'error');
    }
};

    /**
     * Update statistics display
     */
    function updateStatistics() {
        if (elements.stats.total) elements.stats.total.textContent = state.stats.total || 0;
        if (elements.stats.sent) elements.stats.sent.textContent = state.stats.sent || 0;
        if (elements.stats.pending) elements.stats.pending.textContent = state.stats.pending || 0;
        if (elements.stats.invoiced) elements.stats.invoiced.textContent = state.stats.invoiced || 0;
        
        console.log('📊 Statistics updated:', state.stats);
    }

    /**
     * Handle filter changes
     */
    function handleFilters() {
        state.filters.search = elements.searchInput?.value || '';
        state.filters.status = elements.statusFilter?.value || 'all';
        
        let filtered = [...state.reports];

        // Status filter
        if (state.filters.status !== 'all') {
            filtered = filtered.filter(order => {
                switch (state.filters.status) {
                    case 'pending':
                        return !order.sent_til_fakturering;
                    case 'sent':
                        return order.sent_til_fakturering && !order.is_invoiced;
                    case 'invoiced':
                        return order.is_invoiced;
                    default:
                        return true;
                }
            });
        }

        // Search filter
        if (state.filters.search) {
            const searchTerm = state.filters.search.toLowerCase();
            filtered = filtered.filter(order => {
                return [
                    order.customer_name,
                    order.order_id,
                    order.technician_name,
                    order.equipment_names,
                    order.equipment_types
                ].some(field => field && field.toString().toLowerCase().includes(searchTerm));
            });
        }

        renderReportsTable(filtered);
    }

    /**
     * View PDF function
     */
    window.viewPDF = async function(reportId) {
        try {
            const pdfUrl = `/api/admin/reports/${reportId}/pdf`;
            window.open(pdfUrl, '_blank');
            console.log(`📄 Opening PDF for report ${reportId}`);
        } catch (error) {
            console.error('Error viewing PDF:', error);
            showToast('Kunne ikke åpne PDF: ' + error.message, 'error');
        }
    };

    /**
     * Edit report function - opens modal
     * @param {string} orderId - Order ID
     * @param {Array} reportIds - Array of report IDs (uses first one due to 1-1 relationship)
     */
    window.editReport = async function(orderId, reportIds) {
        try {
            showToast('📝 Laster rapport for redigering...', 'info');

            // Use first reportId (1-1 relationship between order and report)
            const reportId = Array.isArray(reportIds) ? reportIds[0] : reportIds;

            if (!reportId) {
                throw new Error('Ingen rapport-ID funnet');
            }

            console.log(`📝 Opening edit modal for report: ${reportId} (order: ${orderId})`);

            // Load report details from API
            await loadReportForEditing(reportId);

        } catch (error) {
            console.error('Error loading report for editing:', error);
            showToast('Kunne ikke laste rapport: ' + error.message, 'error');
        }
    };

    /**
     * Load report details for editing from API
     */
    async function loadReportForEditing(reportId) {
        try {
            // Fetch report data from API
            const response = await fetch(`/api/admin/reports/${reportId}/edit-data`, {
                method: 'GET',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            console.log('📊 Edit data received:', data);

            // Store current report data
            state.currentEditReport = data;
            state.currentEditReportId = reportId;

            // Populate modal with full report view
            populateEditModal(data);

            // Setup add buttons
            setupAddButtons();

            // Setup modal save handlers
            setupModalSaveHandlers();

            // Show modal
            elements.editModal.classList.add('show');

            console.log('✅ Edit modal populated and shown');

        } catch (error) {
            console.error('Error loading report for editing:', error);
            showToast('Kunne ikke laste rapport: ' + error.message, 'error');
        }
    }

    /**
     * Populate edit modal with full report view (like technician view)
     */
    function populateEditModal(data) {
        const modalBody = document.getElementById('edit-modal-body');
        if (!modalBody) return;

        // Extract customer data
        const customerData = data.customer_data || {};
        const checklistItems = data.checklist_items || [];

        // Hent metadata og forbered visningsdata
        const reportDate = data.completedAt || data.createdAt;
        const reportYear = reportDate ? new Date(reportDate).getFullYear() : new Date().getFullYear();
        const formattedReportDate = reportDate ? new Date(reportDate).toLocaleDateString('nb-NO') : 'N/A';

        let html = `
            <div class="edit-form">
                <!-- Header med kunde og anlegg info -->
                <div class="edit-header">
                    <h3>Servicerapport: ${escapeHtml(data.customerName || 'Ukjent kunde')}</h3>
                    <p class="order-info">Ordre ${escapeHtml(data.orderId || 'N/A')} • ${formattedReportDate}</p>
                    <p><strong>Anlegg:</strong> ${escapeHtml(data.equipmentName || 'N/A')} (${escapeHtml(data.equipmentType || 'N/A')})</p>
                </div>

                <!-- METADATA SECTION - TABELL LAYOUT SOM PDF -->
                <div class="edit-section">
                    <h4>📋 Rapportinformasjon</h4>
                    <p class="section-description">Grønne felt kan redigeres, grå felt er låst</p>

                    <table class="metadata-table">
                        <tbody>
                            <tr>
                                <td>
                                    <div class="metadata-cell">
                                        <label>AVTALENUMMER</label>
                                        <input type="text"
                                               id="edit-agreement-number"
                                               class="editable-field"
                                               value="${escapeHtml(customerData.agreement_number || '')}"
                                               placeholder="N/A">
                                    </div>
                                </td>
                                <td>
                                    <div class="metadata-cell">
                                        <label>BESØK NR</label>
                                        <input type="text"
                                               id="edit-visit-number"
                                               class="editable-field"
                                               value="${escapeHtml(customerData.visit_number || '')}"
                                               placeholder="N/A">
                                    </div>
                                </td>
                                <td>
                                    <div class="metadata-cell">
                                        <label>ÅRSTALL</label>
                                        <div class="readonly-field">${reportYear}</div>
                                    </div>
                                </td>
                            </tr>
                            <tr>
                                <td>
                                    <div class="metadata-cell">
                                        <label>KUNDENUMMER</label>
                                        <div class="readonly-field">${escapeHtml(customerData.id || 'N/A')}</div>
                                    </div>
                                </td>
                                <td>
                                    <div class="metadata-cell">
                                        <label>KUNDENAVN</label>
                                        <div class="readonly-field">${escapeHtml(data.customerName || 'N/A')}</div>
                                    </div>
                                </td>
                                <td>
                                    <div class="metadata-cell">
                                        <label>MOTTAKER AV RAPPORT</label>
                                        <div class="readonly-field">${escapeHtml(customerData.recipient || 'N/A')}</div>
                                    </div>
                                </td>
                            </tr>
                            <tr>
                                <td>
                                    <div class="metadata-cell">
                                        <label>BYGGNAVN</label>
                                        <div class="readonly-field">${escapeHtml(data.equipmentLocation || 'Ikke spesifisert')}</div>
                                    </div>
                                </td>
                                <td>
                                    <div class="metadata-cell">
                                        <label>ADRESSE</label>
                                        <div class="readonly-field">${escapeHtml(customerData.address || 'Ikke spesifisert')}</div>
                                    </div>
                                </td>
                                <td>
                                    <div class="metadata-cell">
                                        <label>POST NR. / POSTSTED</label>
                                        <div class="readonly-field">${escapeHtml(customerData.postalCode || 'Ikke spesifisert')}</div>
                                    </div>
                                </td>
                            </tr>
                            <tr>
                                <td>
                                    <div class="metadata-cell">
                                        <label>RAPPORT DATO</label>
                                        <div class="readonly-field">${formattedReportDate}</div>
                                    </div>
                                </td>
                                <td>
                                    <div class="metadata-cell">
                                        <label>UTFØRT AV</label>
                                        <div class="readonly-field">${escapeHtml(data.technicianName || 'N/A')}</div>
                                    </div>
                                </td>
                                <td>
                                    <div class="metadata-cell">
                                        <label>VÅR KONTAKTPERSON</label>
                                        <input type="text"
                                               id="edit-contact-person"
                                               class="editable-field"
                                               value="${escapeHtml(customerData.contact_person || '')}"
                                               placeholder="${escapeHtml(data.technicianName || 'N/A')}">
                                    </div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <!-- SJEKKPUNKTER SECTION -->
                <div class="edit-section">
                    <h4>✅ Sjekkpunkter - ${escapeHtml(data.equipmentType || 'Ukjent type')}</h4>
                    <p class="section-description">Viser kun kontrollerte sjekkpunkter. Status er låst, kun kommentarer kan redigeres.</p>
                    <div id="checklist-comments-container">
        `;

        // Render checklist items
        if (checklistItems.length > 0) {
            checklistItems.forEach(item => {
                const statusIcon = item.status === 'OK' || item.status === 'ok' ? '🟢' :
                                  item.status === 'Avvik' || item.status === 'avvik' ? '🔴' :
                                  item.status === 'Byttet' || item.status === 'byttet' ? '🔵' : '⚪';
                const statusClass = (item.status || '').toLowerCase().replace(/\s+/g, '-');

                html += `
                    <div class="checklist-item-card">
                        <div class="checklist-item-header">
                            <span class="item-name">${statusIcon} ${escapeHtml(item.displayName)}</span>
                            <span class="status-badge status-${statusClass}">${escapeHtml(item.status)}</span>
                        </div>

                        ${item.hasCommentField ? `
                            <div class="item-content">
                                <label>Kommentar (kan redigeres)</label>
                                <textarea
                                    class="checklist-comment-input"
                                    data-item-id="${escapeHtml(item.id)}"
                                    rows="2"
                                    placeholder="Legg til kommentar...">${escapeHtml(item.comment || '')}</textarea>

                                ${item.images && item.images.length > 0 ? `
                                    <div class="item-images">
                                        ${item.images.map(img => `
                                            <img src="${escapeHtml(img)}" alt="Bilde" class="checklist-image" onclick="window.open('${escapeHtml(img)}', '_blank')">
                                        `).join('')}
                                    </div>
                                ` : ''}
                            </div>
                        ` : `
                            ${item.images && item.images.length > 0 ? `
                                <div class="item-content">
                                    <div class="item-images">
                                        ${item.images.map(img => `
                                            <img src="${escapeHtml(img)}" alt="Bilde" class="checklist-image" onclick="window.open('${escapeHtml(img)}', '_blank')">
                                        `).join('')}
                                    </div>
                                </div>
                            ` : ''}
                        `}
                    </div>
                `;
            });
        } else {
            html += '<p class="placeholder-text">Ingen sjekkpunkter registrert</p>';
        }

        html += `
                    </div>
                </div>

                <!-- PRODUKTER BRUKT SECTION -->
                <div class="edit-section">
                    <h4>📦 Produkter brukt</h4>
                    <div id="products-container">
        `;

        // Render products
        const products = data.products_used || [];
        if (products.length > 0) {
            products.forEach((product, index) => {
                html += createProductRowHtml(product, index);
            });
        }

        html += `
                    </div>
                    <button type="button" class="btn btn-sm btn-outline" id="add-product-btn">+ Legg til produkt</button>
                </div>

                <!-- TILLEGGSARBEID SECTION -->
                <div class="edit-section">
                    <h4>🔧 Tilleggsarbeid</h4>
                    <div id="work-container">
        `;

        // Render additional work
        const work = data.additional_work || [];
        if (work.length > 0) {
            work.forEach((item, index) => {
                html += createWorkRowHtml(item, index);
            });
        }

        html += `
                    </div>
                    <button type="button" class="btn btn-sm btn-outline" id="add-work-btn">+ Legg til arbeid</button>
                </div>

                <!-- OPPSUMMERING SECTION -->
                <div class="edit-section">
                    <h4>📝 Oppsummering og utførte arbeider</h4>
                    <textarea
                        id="overall-comment"
                        rows="4"
                        placeholder="F.eks: Alt fungerer som det skal">${escapeHtml(data.overall_comment || '')}</textarea>
                </div>
            </div>
        `;

        modalBody.innerHTML = html;
    }

    /**
     * Create product row HTML
     */
    function createProductRowHtml(product, index) {
        return `
            <div class="product-row" data-index="${index}">
                <input type="text" class="product-name" placeholder="Produktnavn" value="${escapeHtml(product.name || product.product || '')}">
                <input type="number" class="quantity-input product-quantity" placeholder="Antall" value="${product.quantity || 1}" min="1">
                <button type="button" class="btn-remove-row" onclick="this.parentElement.remove()">✕</button>
            </div>
        `;
    }

    /**
     * Create work row HTML
     */
    function createWorkRowHtml(work, index) {
        return `
            <div class="work-row" data-index="${index}">
                <input type="text" class="work-description" placeholder="Beskrivelse av arbeid" value="${escapeHtml(work.description || work.work || '')}">
                <input type="text" class="work-hours" placeholder="Timer" value="${escapeHtml(work.hours || '')}" style="max-width: 80px;">
                <button type="button" class="btn-remove-row" onclick="this.parentElement.remove()">✕</button>
            </div>
        `;
    }

    /**
     * Add a product row to the container
     */
    function addProductRow(name = '', quantity = 1) {
        const container = document.getElementById('products-container');
        if (!container) return;

        const index = container.querySelectorAll('.product-row').length;
        const product = { name, quantity };
        container.insertAdjacentHTML('beforeend', createProductRowHtml(product, index));
    }

    /**
     * Add a work row to the container
     */
    function addWorkRow(description = '', hours = '') {
        const container = document.getElementById('work-container');
        if (!container) return;

        const index = container.querySelectorAll('.work-row').length;
        const work = { description, hours };
        container.insertAdjacentHTML('beforeend', createWorkRowHtml(work, index));
    }

    /**
     * Setup add buttons for products and work
     */
    function setupAddButtons() {
        const addProductBtn = document.getElementById('add-product-btn');
        const addWorkBtn = document.getElementById('add-work-btn');

        if (addProductBtn) {
            addProductBtn.onclick = () => addProductRow();
        }

        if (addWorkBtn) {
            addWorkBtn.onclick = () => addWorkRow();
        }
    }

    /**
     * Escape HTML to prevent XSS
     */
    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /**
     * Setup modal save handlers
     */
    function setupModalSaveHandlers() {
        const saveBtn = document.getElementById('save-report-btn');

        if (saveBtn) {
            saveBtn.onclick = () => saveReportChanges();
        }
    }

    /**
     * Collect form data from modal
     */
    function collectFormData() {
        // Collect metadata
        const metadata = {
            agreement_number: document.getElementById('edit-agreement-number')?.value?.trim() || '',
            visit_number: document.getElementById('edit-visit-number')?.value?.trim() || '',
            contact_person: document.getElementById('edit-contact-person')?.value?.trim() || ''
        };

        // Collect checklist comments
        const checklistComments = {};
        document.querySelectorAll('.checklist-comment-input').forEach(textarea => {
            const itemId = textarea.dataset.itemId;
            if (itemId) {
                checklistComments[itemId] = textarea.value?.trim() || '';
            }
        });

        // Collect products
        const products_used = [];
        document.querySelectorAll('.product-row').forEach(row => {
            const name = row.querySelector('.product-name')?.value?.trim();
            const quantity = parseInt(row.querySelector('.product-quantity')?.value) || 1;
            if (name) {
                products_used.push({ name, quantity });
            }
        });

        // Collect additional work
        const additional_work = [];
        document.querySelectorAll('.work-row').forEach(row => {
            const description = row.querySelector('.work-description')?.value?.trim();
            const hours = row.querySelector('.work-hours')?.value?.trim();
            if (description) {
                additional_work.push({ description, hours });
            }
        });

        // ✅ Collect overall comment / oppsummering
        const overall_comment = document.getElementById('overall-comment')?.value?.trim() || '';

        return { metadata, checklistComments, products_used, additional_work, overall_comment };
    }

    /**
     * Save report changes and regenerate PDF
     * Always regenerates PDF to ensure consistency between database and PDF
     */
    async function saveReportChanges() {
        try {
            if (!state.currentEditReportId) {
                throw new Error('Ingen rapport valgt for redigering');
            }

            // ✅ Disable save button and show loading state
            const saveBtn = document.getElementById('save-report-btn');
            const originalBtnText = saveBtn ? saveBtn.innerHTML : '';
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.innerHTML = '⏳ Genererer rapport...';
                saveBtn.style.opacity = '0.7';
                saveBtn.style.cursor = 'not-allowed';
            }

            showToast('💾 Lagrer endringer...', 'info');

            const formData = collectFormData();
            console.log('📤 Sending update data:', formData);

            const response = await fetch(`/api/admin/reports/${state.currentEditReportId}/update-content`, {
                method: 'PUT',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData)
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Kunne ikke lagre endringer');
            }

            console.log('✅ Save result:', result);

            if (result.pdfRegenerated) {
                showToast('✅ Rapport lagret og PDF oppdatert!', 'success');
            } else {
                showToast('⚠️ Rapport lagret, men PDF-generering feilet', 'warning');
            }

            closeEditModal();
            await loadReports(); // Reload data

        } catch (error) {
            console.error('Error saving report:', error);
            showToast('❌ Kunne ikke lagre: ' + error.message, 'error');

            // ✅ Re-enable button on error
            const saveBtn = document.getElementById('save-report-btn');
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '💾 Lagre og regenerer PDF';
                saveBtn.style.opacity = '1';
                saveBtn.style.cursor = 'pointer';
            }
        }
    }

    /**
     * Close edit modal
     */
    window.closeEditModal = function() {
        elements.editModal.classList.remove('show');
        state.currentEditReport = null;
    };

    /**
     * Send to customer function with email confirmation
     */
    window.sendToCustomer = async function(reportId) {
        try {
            showToast('🔍 Sjekker kundens e-postadresse...', 'info');
            
            // Først, hent e-postadresse for bekreftelse
            const response = await fetch(`/api/admin/reports/${reportId}/send`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ confirmed: false })
            });

            const result = await response.json();

            if (result.requiresConfirmation) {
                // Vis bekreftelse med faktisk e-postadresse
                const confirmMessage = `Er du sikker på at du vil sende rapporten til:\n\n📧 ${result.customerEmail}\n\nKunde: ${result.customerName}`;
                
                if (!confirm(confirmMessage)) {
                    return;
                }
                
                // Send med bekreftelse
                showToast('✉️ Sender rapport...', 'info');
                
                const sendResponse = await fetch(`/api/admin/reports/${reportId}/send`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ confirmed: true })
                });

                const sendResult = await sendResponse.json();

                if (sendResponse.ok) {
                    showToast(`✅ Rapport sendt til ${sendResult.sentTo}`, 'success');
                    await loadReports();
                } else {
                    throw new Error(sendResult.error || 'Ukjent feil');
                }
            } else {
                throw new Error(result.error || 'Kunne ikke hente e-postadresse');
            }
            
        } catch (error) {
            console.error('Error sending report:', error);
            showToast('❌ Feil ved sending: ' + error.message, 'error');
        }
    };

    /**
     * Toggle invoice status
     */
    window.toggleInvoice = async function(reportId, isInvoiced) {
        let comment = null;
        
        if (isInvoiced) {
            comment = prompt('Kommentar til fakturering (valgfritt):');
            if (comment === null) {
                event.target.checked = false;
                return;
            }
        }

        try {
            const response = await fetch(`/api/admin/reports/${reportId}/invoice`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ 
                    invoiced: isInvoiced, 
                    comment: comment 
                })
            });

            const result = await response.json();

            if (response.ok) {
                showToast(`✅ ${result.message}`, 'success');
                await loadReports();
            } else {
                throw new Error(result.error || 'Ukjent feil');
            }
        } catch (error) {
            console.error('Error toggling invoice:', error);
            showToast('❌ Feil: ' + error.message, 'error');
            event.target.checked = !isInvoiced;
        }
    };

    /**
     * Utility function to format dates
     */
    function formatDate(dateString) {
        if (!dateString) return 'Ikke satt';
        
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString('no-NO', {
                year: 'numeric',
                month: '2-digit', 
                day: '2-digit'
            });
        } catch (error) {
            console.warn('Invalid date:', dateString);
            return 'Ugyldig dato';
        }
    }

    /**
     * Debounce utility
     */
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    /**
     * Enhanced toast notification system
     */
    function showToast(message, type = 'info') {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.style.cssText = `
                position: fixed;
                top: 24px;
                right: 24px;
                z-index: 10000;
                pointer-events: none;
                max-width: 400px;
            `;
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        const typeConfig = {
            success: { bg: '#DCFCE7', color: '#166534', border: '#16A34A' },
            error: { bg: '#FEE2E2', color: '#991B1B', border: '#DC2626' },
            info: { bg: '#E0F2FE', color: '#0C4A6E', border: '#0284C7' },
            warning: { bg: '#FEF3C7', color: '#92400E', border: '#F59E0B' }
        };
        
        const config = typeConfig[type] || typeConfig.info;
        
        toast.style.cssText = `
            background: ${config.bg};
            color: ${config.color};
            padding: 16px 20px;
            border-radius: 8px;
            margin-bottom: 12px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            border-left: 4px solid ${config.border};
            pointer-events: auto;
            opacity: 0;
            transform: translateX(120%);
            transition: all 0.3s ease;
            font-weight: 600;
            font-size: 14px;
        `;
        
        toast.innerHTML = message;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(0)';
        }, 10);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(120%)';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    /**
     * Expose reload function globally
     */
    window.reloadReports = loadReports;
    
    console.log('✅ Enhanced servicerapporter JavaScript fully loaded');
});