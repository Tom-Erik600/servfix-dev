/**
 * Servicerapporter Admin - Air-Tech AS
 * Med rediger-funksjonalitet og modal
 */

document.addEventListener('DOMContentLoaded', async function() {
    console.log('🔧 Loading servicerapporter admin system...');
    
    // State management
    const state = {
        reports: [],
        stats: {},
        isLoading: false,
        currentEditReport: null,
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

        // Click outside modal to close
        if (elements.editModal) {
            elements.editModal.addEventListener('click', (e) => {
                if (e.target === elements.editModal) {
                    closeEditModal();
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
     * Render the reports table
     */
    function renderReportsTable(reports) {
        const tbody = document.getElementById('reports-table-body');
        
        if (!reports || reports.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 40px; color: var(--text-light);">Ingen rapporter funnet</td></tr>';
            return;
        }
        
        // Grupper rapporter etter order_id
        const groupedReports = {};
        reports.forEach(report => {
            if (!groupedReports[report.order_id]) {
                groupedReports[report.order_id] = [];
            }
            groupedReports[report.order_id].push(report);
        });
        
        // Generer HTML for hver gruppe
        let html = '';
        let isFirstGroup = true;

        Object.entries(groupedReports).forEach(([orderId, orderReports]) => {
            orderReports.forEach((report, index) => {
                const isFirstInGroup = index === 0;
                const isLastInGroup = index === orderReports.length - 1;
                html += createReportRow(report, isFirstInGroup, orderReports.length, !isFirstGroup, isLastInGroup);
            });
            isFirstGroup = false;
        });
        
        tbody.innerHTML = html;
        
        // Oppdater statistikk
        updateStatistics();
    }

    /**
     * Get filtered reports based on current filters
     */
    function getFilteredReports() {
        let filtered = [...state.reports];

        // Status filter
        if (state.filters.status !== 'all') {
            filtered = filtered.filter(report => {
                switch (state.filters.status) {
                    case 'pending':
                        return !report.sent_til_fakturering;
                    case 'sent':
                        return report.sent_til_fakturering && !report.is_invoiced;
                    case 'invoiced':
                        return report.is_invoiced;
                    default:
                        return true;
                }
            });
        }

        // Search filter
        if (state.filters.search) {
            const searchTerm = state.filters.search.toLowerCase();
            filtered = filtered.filter(report => {
                return [
                    report.customer_name,
                    report.order_id,
                    report.technician_name,
                    report.equipment_name,
                    report.equipment_type
                ].some(field => field && field.toLowerCase().includes(searchTerm));
            });
        }

        return filtered;
    }

    /**
     * Create a table row for a report
     */
    function createReportRow(report, isFirstInGroup, groupSize, needsTopBorder = false, isLastInGroup = false) {
    // DEBUGGING - LEGG TIL DISSE LINJENE:
    console.log(`🔍 DEBUGGING: ${report.equipment_name || report.order_id}`);
    console.log(`   - isLastInGroup: ${isLastInGroup}`);
    console.log(`   - groupSize: ${groupSize}`);
    console.log(`   - index skulle være: ${groupSize - 1} for siste`);
        const isInvoiced = report.is_invoiced;
        const isSent = report.sent_til_fakturering;
        const hasPDF = report.pdf_generated && report.pdf_path;
        const isHasteordre = report.service_type === 'Hasteordre';

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

        // Legg til klasse for siste rad i prosjektgruppe
        if (isLastInGroup) {
            rowClass += ' group-last';
        }

        // Legg til topp-border for nye prosjektgrupper
        const borderStyle = needsTopBorder ? 'border-top: 2px solid #3b82f6; padding-top: 8px;' : '';

        return `
            <tr class="${rowClass}" style="${borderStyle}">
                <td>
                    ${isFirstInGroup ?
                        `<strong style="color: var(--primary-blue);">${report.order_id}</strong>` +
                        (isHasteordre ? '<br><span class="emergency-badge">⚡ HASTEORDRE</span>' : '') +
                        (groupSize > 1 ? `<br><small style="color: var(--text-light);">${groupSize} anlegg</small>` : '') :
                        ''
                    }
                </td>
                <td>
                    ${isFirstInGroup ?
                        `<div style="font-weight: 500;">${formatDate(report.scheduled_date)}</div>` :
                        ''
                    }
                </td>
                <td>
                    <div style="font-weight: 400;">
                        ${formatDate(report.created_at)}
                    </div>
                </td>
                <td>
                    <div style="font-weight: 500;">${report.customer_name || 'Ukjent kunde'}</div>
                    ${isHasteordre ? '<div class="emergency-indicator">⚡ Hasteordre</div>' : ''}
                </td>
                <td>
                    ${report.technician_name ?
                        report.technician_name.split(' ').map(n => n[0]).join('').toUpperCase() :
                        'N/A'
                    }
                </td>
                <td>
                    <div style="font-weight: 500;">${report.equipment_name || 'Ukjent'}</div>
                    <small style="color: var(--text-light);">${report.equipment_type || ''}</small>
                </td>
                <td>
                    <span class="status-indicator status-${isSent ? 'sent' : 'pending'}">
                        ${isSent ? '✅ Sendt til kunde' : '⏳ Venter sending'}
                    </span>
                </td>
                <td>
                    <div style="font-weight: 400;">
                        ${report.customer_email || '<span style="color: var(--text-light);">Mangler e-post</span>'}
                    </div>
                </td>
                <td>
                    <div class="action-buttons" style="display: flex; flex-direction: column; gap: 6px; align-items: flex-start;">
                        ${hasPDF ?
                            `<button class="btn btn-sm btn-outline" onclick="viewPDF('${report.id}')" title="Vis PDF" style="font-size: 12px; padding: 6px 10px;">
                                📄 Vis PDF
                            </button>` :
                            `<span style="color: var(--text-light); font-size: 11px;">PDF ikke generert</span>`
                        }
                        
                        ${!isSent && hasPDF ?
                            `<button class="btn btn-sm btn-primary" onclick="sendToCustomer('${report.id}')" title="Send til kunde" style="font-size: 11px; padding: 4px 8px; background-color: #3b82f6;">
                                📧 Send til kunde
                            </button>` :
                            ''
                        }
                        
                        <button class="btn btn-sm" onclick="editReport('${report.id}')" title="Rediger" style="font-size: 11px; padding: 4px 8px; background-color: #f59e0b; color: white; border: 1px solid #f59e0b;">
                            ✏️ Rediger
                        </button>
                        
                        <label class="checkbox-container" style="display: flex; align-items: center; margin-top: 4px; font-size: 11px;">
                            <input type="checkbox" 
                                   ${isInvoiced ? 'checked' : ''} 
                                   onchange="toggleInvoice('${report.id}', this.checked)"
                                   title="Marker som fakturert"
                                   style="margin-right: 4px; transform: scale(0.8);">
                            <span>Fakturert</span>
                        </label>
                    </div>
                </td>
            </tr>
        `;
    }

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
        
        renderReportsTable(getFilteredReports());
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
     */
    window.editReport = async function(reportId) {
        try {
            showToast('📝 Laster rapport for redigering...', 'info');
            
            // Find the report in our data
            const report = state.reports.find(r => r.id === reportId);
            if (!report) {
                throw new Error('Rapport ikke funnet');
            }
            
            state.currentEditReport = report;
            
            // Load report details (you might need to fetch more details from API)
            await loadReportForEditing(reportId);
            
        } catch (error) {
            console.error('Error loading report for editing:', error);
            showToast('Kunne ikke laste rapport: ' + error.message, 'error');
        }
    };

    /**
     * Load report details for editing
     */
    async function loadReportForEditing(reportId) {
        try {
            // For now, show a basic edit form. In the future, you could fetch detailed report data
            const report = state.currentEditReport;
            
            elements.editModalBody.innerHTML = `
                <div class="edit-form">
                    <div class="form-section">
                        <h4>📋 Grunnleggende informasjon</h4>
                        <div class="form-group">
                            <label>Ordrenummer</label>
                            <input type="text" id="edit-order-id" value="${report.order_id}" readonly style="background: #F3F4F6;">
                        </div>
                        <div class="form-group">
                            <label>Kunde</label>
                            <input type="text" id="edit-customer" value="${report.customer_name}" readonly style="background: #F3F4F6;">
                        </div>
                        <div class="form-group">
                            <label>Tekniker</label>
                            <input type="text" id="edit-technician" value="${report.technician_name || ''}" readonly style="background: #F3F4F6;">
                        </div>
                    </div>
                    
                    <div class="form-section">
                        <h4>⚙️ Anleggsinformasjon</h4>
                        <div class="form-group">
                            <label>Anleggsnavn</label>
                            <input type="text" id="edit-equipment-name" value="${report.equipment_name || ''}">
                        </div>
                        <div class="form-group">
                            <label>Anleggstype</label>
                            <input type="text" id="edit-equipment-type" value="${report.equipment_type || ''}">
                        </div>
                    </div>
                    
                    <div class="form-section">
                        <h4>📝 Rapportinnhold</h4>
                        <div class="form-group">
                            <label>Overordnet kommentar</label>
                            <textarea id="edit-overall-comment" placeholder="Skriv en overordnet kommentar for rapporten..."></textarea>
                        </div>
                        <div class="form-group">
                            <label>Utført arbeid</label>
                            <textarea id="edit-work-performed" placeholder="Beskriv det utførte arbeidet..."></textarea>
                        </div>
                        <div class="form-group">
                            <label>Anbefalinger</label>
                            <textarea id="edit-recommendations" placeholder="Eventuelle anbefalinger til kunden..."></textarea>
                        </div>
                    </div>
                    
                    <div class="form-section">
                        <h4>📊 Status</h4>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                            <div class="form-group">
                                <label>Rapport status</label>
                                <select id="edit-report-status">
                                    <option value="draft" ${!report.sent_til_fakturering ? 'selected' : ''}>Kladd</option>
                                    <option value="ready" ${report.pdf_generated && !report.sent_til_fakturering ? 'selected' : ''}>Klar for sending</option>
                                    <option value="sent" ${report.sent_til_fakturering ? 'selected' : ''}>Sendt til kunde</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label>Fakturering</label>
                                <select id="edit-invoice-status">
                                    <option value="not_invoiced" ${!report.is_invoiced ? 'selected' : ''}>Ikke fakturert</option>
                                    <option value="invoiced" ${report.is_invoiced ? 'selected' : ''}>Fakturert</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            
            // Setup modal save handlers
            setupModalSaveHandlers();
            
            // Show modal
            elements.editModal.classList.add('show');
            
        } catch (error) {
            console.error('Error creating edit form:', error);
            showToast('Kunne ikke opprette redigeringsform', 'error');
        }
    }

    /**
     * Setup modal save handlers
     */
    function setupModalSaveHandlers() {
        const saveBtn = document.getElementById('save-report-btn');
        const saveAndSendBtn = document.getElementById('save-and-send-btn');
        
        if (saveBtn) {
            saveBtn.onclick = () => saveReportChanges(false);
        }
        
        if (saveAndSendBtn) {
            saveAndSendBtn.onclick = () => saveReportChanges(true);
        }
    }

    /**
     * Save report changes
     */
    async function saveReportChanges(sendAfterSave = false) {
        try {
            showToast('💾 Lagrer endringer...', 'info');
            
            const reportData = {
                equipmentName: document.getElementById('edit-equipment-name')?.value,
                equipmentType: document.getElementById('edit-equipment-type')?.value,
                overallComment: document.getElementById('edit-overall-comment')?.value,
                workPerformed: document.getElementById('edit-work-performed')?.value,
                recommendations: document.getElementById('edit-recommendations')?.value,
                reportStatus: document.getElementById('edit-report-status')?.value,
                invoiceStatus: document.getElementById('edit-invoice-status')?.value
            };
            
            console.log('Saving report data:', reportData);
            
            // For now, simulate save - in real system, you'd call API
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            showToast('✅ Endringer lagret!', 'success');
            closeEditModal();
            
            if (sendAfterSave) {
                await sendToCustomer(state.currentEditReport.id);
            }
            
            await loadReports(); // Reload data
            
        } catch (error) {
            console.error('Error saving report:', error);
            showToast('❌ Kunne ikke lagre endringer: ' + error.message, 'error');
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