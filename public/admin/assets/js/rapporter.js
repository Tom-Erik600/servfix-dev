/**
 * Servicerapporter Admin - Air-Tech AS (Forbedret versjon)
 * Profesjonell implementering med moderne design og UX
 */

document.addEventListener('DOMContentLoaded', async function() {
    console.log('🎨 Loading enhanced servicerapporter admin system...');
    
    // State management
    const state = {
        reports: [],
        stats: {},
        isLoading: false,
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
        autoSendToggle: document.getElementById('auto-send-toggle'),
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
            addEnhancedInteractions();
            console.log('✅ Enhanced servicerapporter system initialized successfully');
        } catch (error) {
            console.error('❌ Failed to initialize system:', error);
            showError('Kunne ikke initialisere rapportsystemet');
        }
    }

    /**
     * Setup all event listeners
     */
    function setupEventListeners() {
        // Search input with enhanced debouncing
        if (elements.searchInput) {
            elements.searchInput.addEventListener('input', debounce(handleFilters, 200));
            elements.searchInput.addEventListener('focus', () => {
                elements.searchInput.parentElement.style.transform = 'scale(1.02)';
            });
            elements.searchInput.addEventListener('blur', () => {
                elements.searchInput.parentElement.style.transform = 'scale(1)';
            });
        }

        // Status filter with animation
        if (elements.statusFilter) {
            elements.statusFilter.addEventListener('change', handleFilters);
        }

        // Auto-send toggle with enhanced feedback
        if (elements.autoSendToggle) {
            elements.autoSendToggle.addEventListener('change', handleAutoSendToggle);
            
            // Load saved setting
            const savedSetting = localStorage.getItem('autoSendReports');
            if (savedSetting !== null) {
                elements.autoSendToggle.checked = savedSetting === 'true';
            }
        }
    }

    /**
     * Add enhanced interactions
     */
    function addEnhancedInteractions() {
        // Add keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                switch (e.key) {
                    case 'r':
                        e.preventDefault();
                        loadReports();
                        showToast('🔄 Oppdaterer rapporter...', 'info');
                        break;
                    case 'f':
                        e.preventDefault();
                        elements.searchInput?.focus();
                        break;
                }
            }
        });

        // Add smooth scroll for better UX
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', function (e) {
                e.preventDefault();
                const target = document.querySelector(this.getAttribute('href'));
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth' });
                }
            });
        });
    }

    /**
     * Load reports from the admin API with enhanced error handling
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

            renderTable();
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
     * Show enhanced loading state
     */
    function showLoadingState() {
        if (elements.tableBody) {
            elements.tableBody.innerHTML = `
                <tr>
                    <td colspan="7" class="loading-cell loading-shimmer">
                        <div style="display: flex; align-items: center; justify-content: center; gap: 12px;">
                            <div style="width: 20px; height: 20px; border: 2px solid #E5E7EB; border-top: 2px solid var(--primary-blue); border-radius: 50%; animation: spin 1s linear infinite;"></div>
                            <span>Laster rapporter...</span>
                        </div>
                    </td>
                </tr>
            `;
        }
    }

    /**
     * Show enhanced error message
     */
    function showError(message) {
        if (elements.tableBody) {
            elements.tableBody.innerHTML = `
                <tr>
                    <td colspan="7" class="loading-cell" style="color: #DC2626; background: linear-gradient(135deg, #FEF2F2 0%, #FEE2E2 100%);">
                        <div style="display: flex; align-items: center; justify-content: center; gap: 12px;">
                            <span style="font-size: 24px;">⚠️</span>
                            <span>${message}</span>
                        </div>
                    </td>
                </tr>
            `;
        }
    }

    /**
     * Render the enhanced reports table
     */
    function renderTable() {
        if (!elements.tableBody) return;

        const filteredReports = getFilteredReports();

        if (filteredReports.length === 0) {
            elements.tableBody.innerHTML = `
                <tr>
                    <td colspan="7" class="loading-cell">
                        <div style="display: flex; flex-direction: column; align-items: center; gap: 16px;">
                            <span style="font-size: 48px; opacity: 0.5;">📋</span>
                            <span style="font-size: 16px; font-weight: 600;">Ingen rapporter funnet</span>
                            <span style="font-size: 14px; color: var(--text-light);">Prøv å endre filtrene eller søkekriteriene</span>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        const tableHTML = filteredReports.map(report => createEnhancedReportRow(report)).join('');
        elements.tableBody.innerHTML = tableHTML;
        
        console.log(`✅ Rendered ${filteredReports.length} enhanced report rows`);
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
     * Create an enhanced table row for a report
     */
    function createEnhancedReportRow(report) {
        const isInvoiced = report.is_invoiced;
        const isSent = report.sent_til_fakturering;
        const hasPDF = report.pdf_generated && report.pdf_path;
        
        // Determine row class
        let rowClass = '';
        if (isInvoiced) rowClass = 'row-invoiced';
        else if (isSent) rowClass = 'row-sent';
        else rowClass = 'row-pending';

        return `
            <tr class="${rowClass}">
                <td>
                    <div class="date-info">
                        <div class="date-main">${formatDate(report.scheduled_date || report.created_at)}</div>
                        ${report.created_at ? `<div class="date-sub">Opprettet: ${formatDate(report.created_at)}</div>` : ''}
                    </div>
                </td>
                <td>
                    <a href="#" class="order-id" onclick="viewOrderDetails('${report.order_id}'); return false;">
                        ${report.order_id}
                    </a>
                </td>
                <td>
                    <div style="font-weight: 600; color: var(--text-primary);">
                        ${report.customer_name || 'Ukjent kunde'}
                    </div>
                </td>
                <td>
                    <div style="font-weight: 500; color: var(--text-secondary);">
                        ${report.technician_name || 'Ikke tildelt'}
                    </div>
                </td>
                <td>
                    <div class="equipment-info">
                        <div class="equipment-name">${report.equipment_name || 'Ukjent'}</div>
                        <div class="equipment-type">${report.equipment_type || ''}</div>
                    </div>
                </td>
                <td>
                    <div style="margin-bottom: 6px;">
                        <span class="status-indicator status-${isSent ? 'sent' : 'pending'}">
                            ${isSent ? '✅ Sendt til kunde' : '⏳ Venter sending'}
                        </span>
                    </div>
                    ${report.pdf_sent_timestamp ? `<div class="date-sub">Sendt: ${formatDate(report.pdf_sent_timestamp)}</div>` : ''}
                </td>
                <td>
                    <div class="action-column">
                        <!-- PDF Action -->
                        <div class="action-row">
                            ${hasPDF ? 
                                `<button onclick="viewPDF('${report.id}')" class="action-btn btn-primary" title="Vis PDF">
                                    📄 Vis PDF
                                </button>` : 
                                `<span class="pdf-indicator">📄 PDF ikke generert</span>`
                            }
                        </div>
                        
                        <!-- Send Action -->
                        <div class="action-row">
                            ${!isSent ? 
                                `<button onclick="sendToCustomer('${report.id}')" class="action-btn btn-success" title="Send til kunde">
                                    ✉️ Send til kunde
                                </button>` : 
                                `<span class="sent-indicator">✅ Sendt</span>`
                            }
                        </div>
                        
                        <!-- Invoice Checkbox -->
                        <div class="action-row">
                            <label class="invoice-checkbox">
                                <input type="checkbox" 
                                       ${isInvoiced ? 'checked' : ''} 
                                       onchange="toggleInvoice('${report.id}', this.checked)">
                                <span style="color: ${isInvoiced ? 'var(--status-sent)' : 'var(--text-secondary)'};">
                                    ${isInvoiced ? '💰 Fakturert' : '💰 Fakturer'}
                                </span>
                            </label>
                        </div>
                        
                        ${isInvoiced && report.invoice_comment ? 
                            `<div class="invoice-comment">💬 ${report.invoice_comment}</div>` : ''
                        }
                    </div>
                </td>
            </tr>
        `;
    }

    /**
     * Update statistics with enhanced animations
     */
    function updateStatistics() {
        const stats = [
            { element: elements.stats.total, value: state.stats.total || 0 },
            { element: elements.stats.sent, value: state.stats.sent || 0 },
            { element: elements.stats.pending, value: state.stats.pending || 0 },
            { element: elements.stats.invoiced, value: state.stats.invoiced || 0 }
        ];

        stats.forEach(({ element, value }) => {
            if (element) {
                // Animate number change
                const currentValue = parseInt(element.textContent) || 0;
                if (currentValue !== value) {
                    animateNumber(element, currentValue, value, 800);
                }
            }
        });
        
        console.log('📊 Enhanced statistics updated:', state.stats);
    }

    /**
     * Animate number changes in statistics
     */
    function animateNumber(element, start, end, duration) {
        const startTime = performance.now();
        
        function updateNumber(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // Easing function for smooth animation
            const easedProgress = 1 - Math.pow(1 - progress, 3);
            const currentValue = Math.round(start + (end - start) * easedProgress);
            
            element.textContent = currentValue;
            
            if (progress < 1) {
                requestAnimationFrame(updateNumber);
            }
        }
        
        requestAnimationFrame(updateNumber);
    }

    /**
     * Handle filter changes with enhanced feedback
     */
    function handleFilters() {
        const oldSearch = state.filters.search;
        const oldStatus = state.filters.status;
        
        state.filters.search = elements.searchInput?.value || '';
        state.filters.status = elements.statusFilter?.value || 'all';
        
        // Show filter feedback
        if (oldSearch !== state.filters.search || oldStatus !== state.filters.status) {
            const filteredCount = getFilteredReports().length;
            showToast(`🔍 Viser ${filteredCount} av ${state.reports.length} rapporter`, 'info');
        }
        
        renderTable();
    }

    /**
     * Handle auto-send toggle with enhanced feedback
     */
    function handleAutoSendToggle(event) {
        const enabled = event.target.checked;
        localStorage.setItem('autoSendReports', enabled.toString());
        console.log('Auto-send setting saved:', enabled);
        
        // Enhanced feedback with icon
        showToast(
            `${enabled ? '🔄' : '⏸️'} Automatisk sending ${enabled ? 'aktivert' : 'deaktivert'}`, 
            enabled ? 'success' : 'info'
        );
    }

    /**
     * View PDF function with enhanced feedback
     */
    window.viewPDF = async function(reportId) {
        try {
            showToast('📄 Åpner PDF...', 'info');
            
            const pdfUrl = `/api/admin/reports/${reportId}/pdf`;
            const pdfWindow = window.open(pdfUrl, '_blank');
            
            // Check if popup was blocked
            if (!pdfWindow || pdfWindow.closed || typeof pdfWindow.closed == 'undefined') {
                throw new Error('Popup ble blokkert. Vennligst tillat popup for denne siden.');
            }
            
            console.log(`📄 Opening PDF for report ${reportId}`);
        } catch (error) {
            console.error('Error viewing PDF:', error);
            showToast('❌ Kunne ikke åpne PDF: ' + error.message, 'error');
        }
    };

    /**
     * Send to customer with enhanced UX
     */
    window.sendToCustomer = async function(reportId) {
        // Enhanced confirmation dialog
        const confirmed = await showEnhancedConfirm(
            'Send rapport til kunde',
            'Er du sikker på at du vil sende denne rapporten til kunden? Kunden vil motta en e-post med PDF-rapporten.',
            'Send rapport',
            'Avbryt'
        );
        
        if (!confirmed) return;

        try {
            showToast('✉️ Sender rapport...', 'info');
            
            const response = await fetch(`/api/admin/reports/${reportId}/send`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const result = await response.json();

            if (response.ok) {
                showToast(`✅ Rapport sendt til ${result.sentTo || 'kunde'}`, 'success');
                await loadReports(); // Reload data
            } else {
                throw new Error(result.error || 'Ukjent feil');
            }
        } catch (error) {
            console.error('Error sending report:', error);
            showToast('❌ Feil ved sending: ' + error.message, 'error');
        }
    };

    /**
     * Toggle invoice status with enhanced UX
     */
    window.toggleInvoice = async function(reportId, isInvoiced) {
        let comment = null;
        
        if (isInvoiced) {
            comment = await showEnhancedPrompt(
                'Fakturering kommentar',
                'Legg til en valgfri kommentar til faktureringen:',
                'Kommentar (valgfritt)'
            );
            
            if (comment === null) {
                // User cancelled - revert checkbox
                event.target.checked = false;
                return;
            }
        }

        try {
            showToast(`💰 ${isInvoiced ? 'Markerer som fakturert' : 'Fjerner fakturering'}...`, 'info');
            
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
                await loadReports(); // Reload data
            } else {
                throw new Error(result.error || 'Ukjent feil');
            }
        } catch (error) {
            console.error('Error toggling invoice:', error);
            showToast('❌ Feil: ' + error.message, 'error');
            // Revert checkbox state
            event.target.checked = !isInvoiced;
        }
    };

    /**
     * View order details (placeholder for future functionality)
     */
    window.viewOrderDetails = function(orderId) {
        showToast(`🔍 Viser detaljer for ordre ${orderId}`, 'info');
        // Future: Open order details modal or navigate to order page
    };

    /**
     * Enhanced confirmation dialog
     */
    function showEnhancedConfirm(title, message, confirmText, cancelText) {
        return new Promise(resolve => {
            const confirmed = confirm(`${title}\n\n${message}`);
            resolve(confirmed);
        });
    }

    /**
     * Enhanced prompt dialog
     */
    function showEnhancedPrompt(title, message, placeholder) {
        return new Promise(resolve => {
            const result = prompt(`${title}\n\n${message}`, '');
            resolve(result);
        });
    }

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
     * Enhanced debounce utility
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
        // Create toast container if it doesn't exist
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

        // Create enhanced toast element
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
            border-radius: 12px;
            margin-bottom: 12px;
            box-shadow: 0 8px 25px rgba(0,0,0,0.15);
            border-left: 4px solid ${config.border};
            pointer-events: auto;
            opacity: 0;
            transform: translateX(120%) scale(0.8);
            transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            font-weight: 600;
            font-size: 14px;
            line-height: 1.4;
            backdrop-filter: blur(10px);
        `;
        
        toast.innerHTML = message;
        container.appendChild(toast);

        // Animate in with bounce effect
        setTimeout(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(0) scale(1)';
        }, 10);

        // Remove after delay with fade out
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(120%) scale(0.8)';
            setTimeout(() => toast.remove(), 400);
        }, 4500);
    }

    /**
     * Expose reload function globally for debugging
     */
    window.reloadReports = loadReports;
    
    // Add CSS for spin animation
    const style = document.createElement('style');
    style.textContent = `
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);
    
    console.log('✅ Enhanced servicerapporter JavaScript fully loaded with modern UX');
});