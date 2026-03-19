/**
 * Servicerapporter v2 (Admin) - work queue view
 * Uses same backend endpoints as original, but different rendering.
 */

document.addEventListener('DOMContentLoaded', async function() {
    console.log('🧭 Loading servicerapporter v2...');

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

    const state = {
        reports: [],
        stats: {},
        isLoading: false,
        currentEditReport: null,
        currentEditReportId: null,
        filters: {
            queue: 'need_action',
            search: ''
        }
    };

    const elements = {
        tableBody: document.getElementById('reports-table-body'),
        searchInput: document.getElementById('search-input'),
        tabs: Array.from(document.querySelectorAll('.r2-tab')),
        counts: {
            tabNeedAction: document.getElementById('tab-need-action'),
            tabReadySend: document.getElementById('tab-ready-send'),
            tabSentNotInvoiced: document.getElementById('tab-sent-not-invoiced'),
            tabDone: document.getElementById('tab-done'),
            tabAll: document.getElementById('tab-all')
        },
        stats: {
            missingEmail: document.getElementById('stat-missing-email'),
            readySend: document.getElementById('stat-ready-send'),
            sentNotInvoiced: document.getElementById('stat-sent-not-invoiced'),
            total: document.getElementById('stat-total')
        },
        editModal: document.getElementById('edit-report-modal')
    };

    await initializeSystem();

    async function initializeSystem() {
        try {
            setupEventListeners();
            await loadReports();
            console.log('✅ Servicerapporter v2 initialized');
        } catch (error) {
            console.error('❌ Failed to initialize v2:', error);
            showError('Kunne ikke initialisere rapportsystemet');
        }
    }

    function setupEventListeners() {
        if (elements.searchInput) {
            elements.searchInput.addEventListener('input', debounce(handleFilters, 250));

            // Small quality-of-life: press / to focus search
            document.addEventListener('keydown', (e) => {
                if (e.key === '/' && document.activeElement !== elements.searchInput) {
                    e.preventDefault();
                    elements.searchInput.focus();
                }
            });
        }

        elements.tabs.forEach((btn) => {
            btn.addEventListener('click', () => {
                setActiveQueue(btn.dataset.queue || 'need_action');
            });
        });

        if (elements.tableBody) {
            elements.tableBody.addEventListener('click', (e) => {
                const target = e.target.closest('[data-action]');
                if (!target) return;
                if (target.disabled || target.getAttribute('aria-disabled') === 'true') return;

                const action = target.dataset.action;
                const orderId = target.dataset.orderId;
                if (!action || !orderId) return;

                const order = state.reports.find((o) => String(o.order_id) === String(orderId));
                if (!order) return;

                handleChipAction(action, order);
            });
        }

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeEditModal();
                if (document.getElementById('invoice-modal')?.classList.contains('show')) {
                    closeInvoiceModal();
                }
            }
        });

        // Click outside modal to close (same fix as original)
        if (elements.editModal) {
            let mouseDownTarget = null;
            elements.editModal.addEventListener('mousedown', (e) => { mouseDownTarget = e.target; });
            elements.editModal.addEventListener('click', (e) => {
                if (e.target.classList.contains('modal-overlay') &&
                    mouseDownTarget && mouseDownTarget.classList.contains('modal-overlay')) {
                    closeEditModal();
                }
                mouseDownTarget = null;
            });
        }

        const invoiceModal = document.getElementById('invoice-modal');
        if (invoiceModal) {
            let invoiceMouseDownTarget = null;
            invoiceModal.addEventListener('mousedown', (e) => { invoiceMouseDownTarget = e.target; });
            invoiceModal.addEventListener('click', (e) => {
                if (e.target.classList.contains('modal-overlay') &&
                    invoiceMouseDownTarget && invoiceMouseDownTarget.classList.contains('modal-overlay')) {
                    closeInvoiceModal();
                }
                invoiceMouseDownTarget = null;
            });
        }
    }

    function handleChipAction(action, order) {
        switch (action) {
            case 'pdf':
                if (!hasPdf(order)) return;
                viewOrderPDFs(order.order_id, order.report_ids);
                return;

            case 'email':
                openCustomerForOrder(order);
                return;

            case 'send':
                confirmAndSend(order);
                return;

            case 'invoice':
                if (isInvoiced(order)) return;
                openInvoiceModal(order.order_id, order.customer_name || '');
                return;

            default:
                return;
        }
    }

    function openCustomerForOrder(order) {
        const customerId = order.customer_id || order.customerId || order.customerID;
        if (customerId) {
            window.location.href = `/admin/kunder.html?customerId=${encodeURIComponent(customerId)}`;
            return;
        }

        const q = order.customer_name || '';
        window.location.href = `/admin/kunder.html?q=${encodeURIComponent(q)}`;
    }

    function confirmAndSend(order) {
        if (!hasPdf(order)) {
            showToast('❌ PDF mangler', 'error');
            return;
        }

        if (!order.customer_email) {
            openCustomerForOrder(order);
            return;
        }

        if (isSent(order)) {
            showToast('ℹ️ Rapport er allerede sendt', 'info');
            return;
        }

        const customer = order.customer_name || 'kunde';
        const email = order.customer_email;
        const ok = confirm(
            `Er du sikker på at du vil sende rapporten til:\n\n📧 ${email}\n\nKunde: ${customer}\nOrdre: ${order.order_id}`
        );
        if (!ok) return;

        sendOrderToCustomer(order.order_id);
    }

    function setActiveQueue(queue) {
        state.filters.queue = queue;
        elements.tabs.forEach((btn) => {
            const isActive = (btn.dataset.queue || '') === queue;
            btn.classList.toggle('is-active', isActive);
            btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        handleFilters();
    }

    async function loadReports() {
        if (state.isLoading) return;

        state.isLoading = true;
        showLoadingState();

        try {
            const response = await fetch('/api/admin/reports', {
                method: 'GET',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            state.reports = data.reports || [];
            state.stats = data.stats || {};

            updateDerivedCounts(state.reports);
            handleFilters();
        } catch (error) {
            console.error('❌ Error loading reports:', error);
            showError('Feil ved lasting av rapporter: ' + error.message);
        } finally {
            state.isLoading = false;
        }
    }

    function updateDerivedCounts(reports) {
        const total = reports.length;
        const done = reports.filter(isDone).length;
        const readySend = reports.filter(isReadyToSend).length;
        const sentNotInvoiced = reports.filter((o) => isSent(o) && !isInvoiced(o)).length;
        const missingEmail = reports.filter((o) => !isSent(o) && hasPdf(o) && !o.customer_email).length;
        const needAction = reports.filter(isNeedAction).length;

        if (elements.counts.tabNeedAction) elements.counts.tabNeedAction.textContent = needAction;
        if (elements.counts.tabReadySend) elements.counts.tabReadySend.textContent = readySend;
        if (elements.counts.tabSentNotInvoiced) elements.counts.tabSentNotInvoiced.textContent = sentNotInvoiced;
        if (elements.counts.tabDone) elements.counts.tabDone.textContent = done;
        if (elements.counts.tabAll) elements.counts.tabAll.textContent = total;

        if (elements.stats.missingEmail) elements.stats.missingEmail.textContent = missingEmail;
        if (elements.stats.readySend) elements.stats.readySend.textContent = readySend;
        if (elements.stats.sentNotInvoiced) elements.stats.sentNotInvoiced.textContent = sentNotInvoiced;
        if (elements.stats.total) elements.stats.total.textContent = total;
    }

    function isNeedAction(order) {
        if (isDone(order)) return false;
        if (!hasPdf(order)) return false;
        if (!isSent(order) && !order.customer_email) return true;
        if (isReadyToSend(order)) return true;
        if (isSent(order) && !isInvoiced(order)) return true;
        return false;
    }

    function showLoadingState() {
        if (!elements.tableBody) return;
        elements.tableBody.innerHTML = `
            <tr>
                <td colspan="5" class="r2-loading">Laster rapporter...</td>
            </tr>
        `;
    }

    function showError(message) {
        if (!elements.tableBody) return;
        elements.tableBody.innerHTML = `
            <tr>
                <td colspan="5" class="r2-loading" style="color: #DC2626;">❌ ${escapeHtml(message)}</td>
            </tr>
        `;
    }

    function handleFilters() {
        state.filters.search = elements.searchInput?.value || '';

        let filtered = [...state.reports];

        // Queue filter
        filtered = applyQueueFilter(filtered, state.filters.queue);

        // Search filter
        if (state.filters.search) {
            const searchTerm = state.filters.search.toLowerCase();
            filtered = filtered.filter((order) => {
                return [
                    order.customer_name,
                    order.order_id,
                    order.technician_name,
                    order.equipment_names,
                    order.equipment_types,
                    order.customer_email
                ].some((field) => field && field.toString().toLowerCase().includes(searchTerm));
            });
        }

        // Sort: blocked first, then oldest service date
        filtered.sort((a, b) => {
            const pa = getPriorityRank(a);
            const pb = getPriorityRank(b);
            if (pa !== pb) return pa - pb;

            const da = toDate(a.last_service_date) || toDate(a.order_date) || new Date(0);
            const db = toDate(b.last_service_date) || toDate(b.order_date) || new Date(0);
            return da - db;
        });

        renderReportsTable(filtered);
    }

    function applyQueueFilter(reports, queue) {
        switch (queue) {
            case 'need_action':
                return reports.filter(isNeedAction);
            case 'ready_send':
                return reports.filter(isReadyToSend);
            case 'sent_not_invoiced':
                return reports.filter((o) => isSent(o) && !isInvoiced(o));
            case 'done':
                return reports.filter(isDone);
            case 'all':
            default:
                return reports;
        }
    }

    function renderReportsTable(reports) {
        const tbody = elements.tableBody;
        if (!tbody) return;

        if (!reports || reports.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="r2-loading">Ingen rapporter funnet</td>
                </tr>
            `;
            return;
        }

        let html = '';
        reports.forEach((orderReport) => {
            html += createOrderRow(orderReport);
        });

        tbody.innerHTML = html;
    }

    function createOrderRow(order) {
        const hasPDF = hasPdf(order);
        const hasEmail = !!order.customer_email;
        const sent = isSent(order);
        const invoiced = isInvoiced(order);
        const isHasteordre = order.service_type === 'Hasteordre';

        const priorityClass = getPriorityClass(order);
        const serviceDate = formatDate(order.last_service_date);
        const ageText = formatAge(order.last_service_date || order.order_date);

        const technician = order.technician_name
            ? order.technician_name.split(' ').map((n) => n[0]).join('').toUpperCase()
            : 'N/A';

        const equipmentLine = order.equipment_names || 'Ukjent anlegg';
        const equipMeta = order.equipment_count > 1
            ? `${order.equipment_count} anlegg`
            : (order.equipment_types || '');

        const customer = order.customer_name || 'Ukjent kunde';

        const reportIdsJson = JSON.stringify(order.report_ids || []).replace(/"/g, '&quot;');

        const invoiceTitle = invoiced
            ? `Fakturert${order.invoice_number ? `: ${order.invoice_number}` : ''}`
            : 'Registrer faktura';

        return `
            <tr class="r2-row ${priorityClass}">
                <td>
                    <div class="r2-main">
                        <div class="title">${escapeHtml(customer)}</div>
                        <div class="meta">${escapeHtml(equipmentLine)}${equipMeta ? ` · ${escapeHtml(equipMeta)}` : ''}</div>
                        <div class="meta">Ordre ${escapeHtml(order.order_id || 'N/A')}${isHasteordre ? ' · Hasteordre' : ''}</div>
                        ${isHasteordre ? `<div class="r2-badges"><span class="r2-badge neutral">⚡ HASTEORDRE</span></div>` : ''}
                    </div>
                </td>

                <td>
                    <div class="r2-main">
                        <div class="title">${serviceDate}</div>
                        <div class="meta">${escapeHtml(ageText)}</div>
                    </div>
                </td>

                <td>
                    <div class="r2-main">
                        <div class="title">${escapeHtml(technician)}</div>
                        <div class="meta">${escapeHtml(order.technician_name || '')}</div>
                    </div>
                </td>

                <td>
                    <div class="r2-chiprow">
                        <button class="r2-chip ${hasPDF ? 'ok' : 'bad'}" type="button" data-action="pdf" data-order-id="${escapeHtml(order.order_id)}" ${hasPDF ? '' : 'disabled'}>
                            ${hasPDF ? 'PDF: OK' : 'PDF: Mangler'}
                        </button>
                        ${hasEmail ? `
                            <span class="r2-chip ok" aria-disabled="true">E-post: OK</span>
                        ` : `
                            <button class="r2-chip bad" type="button" data-action="email" data-order-id="${escapeHtml(order.order_id)}">
                                E-post: Mangler
                            </button>
                        `}
                        <button class="r2-chip ${sent ? 'ok' : 'warn'}" type="button" data-action="send" data-order-id="${escapeHtml(order.order_id)}" ${(!sent && hasPDF && hasEmail) ? '' : 'aria-disabled="true"'}>
                            ${sent ? 'Sendt: Ja' : 'Sendt: Nei'}
                        </button>
                        <button class="r2-chip ${invoiced ? 'ok' : (sent ? 'warn' : 'neutral')}" type="button" data-action="invoice" data-order-id="${escapeHtml(order.order_id)}" title="${escapeHtml(invoiceTitle)}" ${invoiced ? 'aria-disabled="true"' : ''}>
                            ${invoiced ? 'Faktura: Ja' : 'Faktura: Nei'}
                        </button>
                    </div>
                </td>

                <td>
                    <div class="r2-actions">
                        ${hasPDF ? `
                            <button class="r2-action" type="button" onclick="editReport('${escapeJs(order.order_id)}', ${reportIdsJson})" title="Rediger PDF Rapport">
                                Rediger PDF Rapport
                            </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
    }

    function getPriorityRank(order) {
        const hasPDF = hasPdf(order);
        const hasEmail = !!order.customer_email;
        const sent = isSent(order);
        const invoiced = isInvoiced(order);

        if (!hasPDF) return 0;
        if (!sent && !hasEmail) return 1;
        if (!sent) return 2;
        if (sent && !invoiced) return 3;
        return 4;
    }

    function getPriorityClass(order) {
        const rank = getPriorityRank(order);
        if (rank <= 1) return 'priority-blocked';
        if (rank === 2) return 'priority-send';
        if (rank === 3) return 'priority-invoice';
        return 'priority-done';
    }

    function isSent(order) {
        return !!order.sent_til_fakturering;
    }

    function isInvoiced(order) {
        return !!order.is_invoiced;
    }

    function isDone(order) {
        return isSent(order) && isInvoiced(order);
    }

    function isReadyToSend(order) {
        return !isSent(order) && !isInvoiced(order) && hasPdf(order) && !!order.customer_email;
    }

    function hasPdf(order) {
        return !!order.pdf_generated && Array.isArray(order.report_ids) && order.report_ids.length > 0;
    }

    function toDate(dateString) {
        if (!dateString) return null;
        const d = new Date(dateString);
        return isNaN(d.getTime()) ? null : d;
    }

    function formatDate(dateString) {
        if (!dateString) return 'Ikke satt';
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString('no-NO', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            });
        } catch {
            return 'Ugyldig dato';
        }
    }

    function formatAge(dateString) {
        const d = toDate(dateString);
        if (!d) return '';
        const now = new Date();
        const diffMs = now - d;
        const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        if (days <= 0) return 'I dag';
        if (days === 1) return '1 dag siden';
        return `${days} dager siden`;
    }

    window.viewOrderPDFs = function(orderId, reportIds) {
        if (!reportIds || reportIds.length === 0) {
            showToast('❌ Ingen PDF funnet for denne ordren', 'error');
            return;
        }
        const reportId = reportIds[0];
        const pdfUrl = `/api/admin/reports/${reportId}/pdf`;
        window.open(pdfUrl, '_blank');
        console.log(`📄 Opening PDF for report ${reportId} from order ${orderId}`);
    };

    window.sendOrderToCustomer = async function(orderId) {
        try {
            showToast('🔍 Forbereder sending av ordre...', 'info');
            const response = await fetch(`/api/admin/reports/order/${orderId}/send`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' }
            });

            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.details || result.error || 'Kunne ikke sende rapporter');
            }

            showToast(`✅ ${result.message || 'Rapporter sendt til kunde'}`, 'success');
            await loadReports();
        } catch (error) {
            console.error('Error sending order:', error);
            showToast(`❌ ${error.message}`, 'error');
        }
    };

    // Expose for inline handlers
    window.openCustomerForOrder = openCustomerForOrder;

    // --- Edit modal logic: reused from original (kept minimal here) ---
    window.editReport = async function(orderId, reportIds) {
        try {
            showToast('📝 Laster rapport for redigering...', 'info');
            const reportId = Array.isArray(reportIds) ? reportIds[0] : reportIds;
            if (!reportId) throw new Error('Ingen rapport-ID funnet');
            await loadReportForEditing(reportId);
        } catch (error) {
            console.error('Error loading report for editing:', error);
            showToast('Kunne ikke laste rapport: ' + error.message, 'error');
        }
    };

    async function loadReportForEditing(reportId) {
        const response = await fetch(`/api/admin/reports/${reportId}/edit-data`, {
            method: 'GET',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        const data = await response.json();

        state.currentEditReport = data;
        state.currentEditReportId = reportId;

        populateEditModal(data);
        setupAddButtons();
        setupModalSaveHandlers();

        document.getElementById('edit-report-modal').classList.add('show');
    }

    function populateEditModal(data) {
        // This is copied from the original implementation to keep edit parity.
        // Kept as-is to avoid functional drift.
        const modalBody = document.getElementById('edit-modal-body');
        if (!modalBody) return;

        const customerData = data.customer_data || {};
        const checklistItems = data.checklist_items || [];
        const reportDate = data.completedAt || data.createdAt;
        const reportYear = reportDate ? new Date(reportDate).getFullYear() : new Date().getFullYear();
        const formattedReportDate = reportDate ? new Date(reportDate).toLocaleDateString('nb-NO') : 'N/A';

        let parsedAddress = 'Ikke spesifisert';
        let parsedPostalCode = 'Ikke spesifisert';
        const physicalAddress = customerData.physicalAddress || '';
        if (physicalAddress) {
            const parts = physicalAddress.split(',').map((p) => p.trim());
            if (parts.length >= 2) {
                parsedAddress = parts[0];
                parsedPostalCode = parts[parts.length - 1];
            } else {
                parsedAddress = physicalAddress;
            }
        } else if (customerData.post_address) {
            const pa = customerData.post_address;
            parsedAddress = pa.addressLine1 || '';
            parsedPostalCode = pa.postalCode ? `${pa.postalCode} ${pa.city || ''}`.trim() : '';
        }

        let recipient = '';
        const contacts = customerData.contacts || [];
        const servfixMatch = contacts.find((c) => (c.last_name || '').toLowerCase() === 'servfixmail');
        recipient = servfixMatch?.email || customerData.email || '';

        let html = `
            <div class="edit-form">
                <div class="edit-header">
                    <h3>Servicerapport: ${escapeHtml(data.customerName || 'Ukjent kunde')}</h3>
                    <p class="order-info">Ordre ${escapeHtml(data.orderId || 'N/A')} • ${formattedReportDate}</p>
                </div>

                <div class="edit-section">
                    <h4>📋 Rapportinformasjon</h4>
                    <p class="section-description">Grønne felt kan redigeres, grå felt er låst</p>

                    <table class="metadata-table">
                        <tbody>
                            <tr>
                                <td>
                                    <div class="metadata-cell">
                                        <label>AVTALENUMMER</label>
                                        <input type="text" id="edit-agreement-number" class="editable-field" value="${escapeHtml(customerData.agreement_number || '')}" placeholder="N/A">
                                    </div>
                                </td>
                                <td>
                                    <div class="metadata-cell">
                                        <label>BESØK NR</label>
                                        <input type="text" id="edit-visit-number" class="editable-field" value="${escapeHtml(customerData.visit_number || '')}" placeholder="N/A">
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
                                        <div class="readonly-field">${escapeHtml(recipient || 'N/A')}</div>
                                    </div>
                                </td>
                            </tr>
                            <tr>
                                <td colspan="2">
                                    <div class="metadata-cell">
                                        <label>ADRESSE</label>
                                        <div class="readonly-field">${escapeHtml(parsedAddress)}</div>
                                    </div>
                                </td>
                                <td>
                                    <div class="metadata-cell">
                                        <label>POST NR. / POSTSTED</label>
                                        <div class="readonly-field">${escapeHtml(parsedPostalCode)}</div>
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
                                        <input type="text" id="edit-contact-person" class="editable-field" value="${escapeHtml(customerData.contact_person || '')}" placeholder="${escapeHtml(data.technicianName || 'N/A')}">
                                    </div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div class="edit-section">
                    <h4>✅ Sjekkpunkter - ${escapeHtml(data.equipmentName || '')} (${escapeHtml(data.equipmentType || 'Ukjent type')})</h4>
                    <p class="section-description">Viser kun kontrollerte sjekkpunkter. Status er låst, kun kommentarer kan redigeres.</p>
                    <div id="checklist-comments-container">
        `;

        if (checklistItems.length > 0) {
            checklistItems.forEach((item) => {
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
                                <textarea class="checklist-comment-input" data-item-id="${escapeHtml(item.id)}" rows="2" placeholder="Legg til kommentar...">${escapeHtml(item.comment || '')}</textarea>

                                ${item.images && item.images.length > 0 ? `
                                    <div class="item-images">
                                        ${item.images.map((img) => `
                                            <img src="${escapeHtml(img)}" alt="Bilde" class="checklist-image" onclick="window.open('${escapeHtml(img)}', '_blank')">
                                        `).join('')}
                                    </div>
                                ` : ''}
                            </div>
                        ` : `
                            ${item.images && item.images.length > 0 ? `
                                <div class="item-content">
                                    <div class="item-images">
                                        ${item.images.map((img) => `
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

                <div class="edit-section">
                    <h4>📦 Produkter brukt</h4>
                    <div id="products-container">
        `;

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

                <div class="edit-section">
                    <h4>🔧 Tilleggsarbeid</h4>
                    <div id="work-container">
        `;

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

                <div class="edit-section">
                    <h4>📝 Oppsummering og utførte arbeider</h4>
                    <textarea id="overall-comment" rows="4" placeholder="F.eks: Alt fungerer som det skal">${escapeHtml(data.overall_comment || '')}</textarea>
                </div>
            </div>
        `;

        modalBody.innerHTML = html;
    }

    function createProductRowHtml(product, index) {
        return `
            <div class="product-row" data-index="${index}">
                <input type="text" class="product-name" placeholder="Produktnavn" value="${escapeHtml(product.name || product.product || '')}">
                <input type="number" class="quantity-input product-quantity" placeholder="Antall" value="${product.quantity || 1}" min="1">
                <button type="button" class="btn-remove-row" onclick="this.parentElement.remove()">✕</button>
            </div>
        `;
    }

    function createWorkRowHtml(work, index) {
        return `
            <div class="work-row" data-index="${index}">
                <input type="text" class="work-description" placeholder="Beskrivelse av arbeid" value="${escapeHtml(work.description || work.work || '')}">
                <input type="text" class="work-hours" placeholder="Timer" value="${escapeHtml(work.hours || '')}" style="max-width: 80px;">
                <button type="button" class="btn-remove-row" onclick="this.parentElement.remove()">✕</button>
            </div>
        `;
    }

    function addProductRow(name = '', quantity = 1) {
        const container = document.getElementById('products-container');
        if (!container) return;
        const index = container.querySelectorAll('.product-row').length;
        container.insertAdjacentHTML('beforeend', createProductRowHtml({ name, quantity }, index));
    }

    function addWorkRow(description = '', hours = '') {
        const container = document.getElementById('work-container');
        if (!container) return;
        const index = container.querySelectorAll('.work-row').length;
        container.insertAdjacentHTML('beforeend', createWorkRowHtml({ description, hours }, index));
    }

    function setupAddButtons() {
        const addProductBtn = document.getElementById('add-product-btn');
        const addWorkBtn = document.getElementById('add-work-btn');
        if (addProductBtn) addProductBtn.onclick = () => addProductRow();
        if (addWorkBtn) addWorkBtn.onclick = () => addWorkRow();
    }

    function setupModalSaveHandlers() {
        const saveBtn = document.getElementById('save-report-btn');
        if (saveBtn) saveBtn.onclick = () => saveReportChanges();
    }

    function collectFormData() {
        const metadata = {
            agreement_number: document.getElementById('edit-agreement-number')?.value?.trim() || '',
            visit_number: document.getElementById('edit-visit-number')?.value?.trim() || '',
            contact_person: document.getElementById('edit-contact-person')?.value?.trim() || ''
        };

        const checklistComments = {};
        document.querySelectorAll('.checklist-comment-input').forEach((textarea) => {
            const itemId = textarea.dataset.itemId;
            if (itemId) checklistComments[itemId] = textarea.value?.trim() || '';
        });

        const products_used = [];
        document.querySelectorAll('.product-row').forEach((row) => {
            const name = row.querySelector('.product-name')?.value?.trim();
            const quantity = parseInt(row.querySelector('.product-quantity')?.value) || 1;
            if (name) products_used.push({ name, quantity });
        });

        const additional_work = [];
        document.querySelectorAll('.work-row').forEach((row) => {
            const description = row.querySelector('.work-description')?.value?.trim();
            const hours = row.querySelector('.work-hours')?.value?.trim();
            if (description) additional_work.push({ description, hours });
        });

        const overall_comment = document.getElementById('overall-comment')?.value?.trim() || '';
        return { metadata, checklistComments, products_used, additional_work, overall_comment };
    }

    async function saveReportChanges() {
        try {
            if (!state.currentEditReportId) throw new Error('Ingen rapport valgt for redigering');

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

            const response = await fetch(`/api/admin/reports/${state.currentEditReportId}/update-content`, {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });

            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Kunne ikke lagre endringer');

            if (result.pdfRegenerated) {
                showToast('✅ Rapport lagret og PDF oppdatert!', 'success');
            } else {
                showToast('⚠️ Rapport lagret, men PDF-generering feilet', 'warning');
            }

            closeEditModal();
            await loadReports();

            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = originalBtnText || '💾 Lagre og regenerer PDF';
                saveBtn.style.opacity = '1';
                saveBtn.style.cursor = 'pointer';
            }
        } catch (error) {
            console.error('Error saving report:', error);
            showToast('❌ Kunne ikke lagre: ' + error.message, 'error');

            const saveBtn = document.getElementById('save-report-btn');
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '💾 Lagre og regenerer PDF';
                saveBtn.style.opacity = '1';
                saveBtn.style.cursor = 'pointer';
            }
        }
    }

    window.closeEditModal = function() {
        document.getElementById('edit-report-modal')?.classList.remove('show');
        state.currentEditReport = null;
    };

    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function escapeJs(str) {
        return String(str || '')
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r');
    }

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
            padding: 14px 16px;
            border-radius: 10px;
            margin-bottom: 12px;
            box-shadow: 0 10px 24px rgba(0,0,0,0.12);
            border-left: 4px solid ${config.border};
            pointer-events: auto;
            opacity: 0;
            transform: translateX(120%);
            transition: all 0.28s ease;
            font-weight: 700;
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

    window.reloadReports = loadReports;

    console.log('✅ Servicerapporter v2 JS loaded');
});
