// air-tech-adminweb/assets/js/rapporter.js - Håndtering av servicerapporter

document.addEventListener('DOMContentLoaded', async () => {
    // State
    let allReports = [];
    let filteredReports = [];
    let currentPage = 1;
    const reportsPerPage = 25;
    let customers = [];
    let technicians = [];
    let orders = [];
    let equipment = [];
    
    // DOM elementer
    const autoSendToggle = document.getElementById('auto-send-toggle');
    const periodFilter = document.getElementById('period-filter');
    const customerFilter = document.getElementById('customer-filter');
    const statusFilter = document.getElementById('status-filter');
    const searchInput = document.getElementById('search-input');
    const customDateGroup = document.getElementById('custom-date-group');
    const dateFrom = document.getElementById('date-from');
    const dateTo = document.getElementById('date-to');
    const reportModal = document.getElementById('report-modal');
    
    // Initialiser
    await loadAllData();
    setupEventListeners();
    
    // Les innstillinger fra localStorage
    const autoSendSetting = localStorage.getItem('autoSendReports');
    autoSendToggle.checked = autoSendSetting !== 'false';
    
    async function loadAllData() {
        try {
            // Hent all data parallelt
            const [reportsData, customersData, techniciansData, ordersData, equipmentData] = await Promise.all([
                fetch('/api/reports/service').then(res => res.json()),
                fetch('/api/customers').then(res => res.json()),
                fetch('/api/technicians').then(res => res.json()),
                fetch('/api/orders').then(res => res.json()),
                fetch('/api/equipment').then(res => res.json())
            ]);
            
            customers = customersData;
            technicians = techniciansData;
            orders = ordersData;
            equipment = equipmentData;
            allReports = reportsData;
            
            // Populer kunde-filter
            populateCustomerFilter();
            
            // Sett default periode (siste 3 måneder)
            const threeMonthsAgo = new Date();
            threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
            dateFrom.value = threeMonthsAgo.toISOString().split('T')[0];
            dateTo.value = new Date().toISOString().split('T')[0];
            
            // Initial filtrering
            filterReports();
            
        } catch (error) {
            console.error('Feil ved lasting av data:', error);
            showToast('Kunne ikke laste rapporter', 'error');
        }
    }
    
    function populateCustomerFilter() {
        customerFilter.innerHTML = '<option value="">Alle kunder</option>';
        customers.forEach(customer => {
            const option = document.createElement('option');
            option.value = customer.id;
            option.textContent = customer.name;
            customerFilter.appendChild(option);
        });
    }
    
    function setupEventListeners() {
        // Auto-send toggle
        autoSendToggle.addEventListener('change', (e) => {
            localStorage.setItem('autoSendReports', e.target.checked);
            showToast(`Automatisk sending ${e.target.checked ? 'aktivert' : 'deaktivert'}`);
        });
        
        // Filtre
        periodFilter.addEventListener('change', handlePeriodChange);
        customerFilter.addEventListener('change', filterReports);
        statusFilter.addEventListener('change', filterReports);
        searchInput.addEventListener('input', debounce(filterReports, 300));
        dateFrom.addEventListener('change', filterReports);
        dateTo.addEventListener('change', filterReports);
        
        // Modal
        reportModal.addEventListener('click', (e) => {
            if (e.target === reportModal) closeReportModal();
        });
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && reportModal.classList.contains('show')) {
                closeReportModal();
            }
        });
    }
    
    function handlePeriodChange() {
        const value = periodFilter.value;
        const today = new Date();
        
        switch(value) {
            case '3months':
                const threeMonthsAgo = new Date();
                threeMonthsAgo.setMonth(today.getMonth() - 3);
                dateFrom.value = threeMonthsAgo.toISOString().split('T')[0];
                dateTo.value = today.toISOString().split('T')[0];
                customDateGroup.style.display = 'none';
                break;
                
            case 'year':
                const yearStart = new Date(today.getFullYear(), 0, 1);
                dateFrom.value = yearStart.toISOString().split('T')[0];
                dateTo.value = today.toISOString().split('T')[0];
                customDateGroup.style.display = 'none';
                break;
                
            case 'lastYear':
                const lastYearStart = new Date(today.getFullYear() - 1, 0, 1);
                const lastYearEnd = new Date(today.getFullYear() - 1, 11, 31);
                dateFrom.value = lastYearStart.toISOString().split('T')[0];
                dateTo.value = lastYearEnd.toISOString().split('T')[0];
                customDateGroup.style.display = 'none';
                break;
                
            case 'all':
                dateFrom.value = '';
                dateTo.value = '';
                customDateGroup.style.display = 'none';
                break;
                
            case 'custom':
                customDateGroup.style.display = 'flex';
                break;
        }
        
        filterReports();
    }
    
    function filterReports() {
        filteredReports = allReports.filter(report => {
            // Periode filter
            if (dateFrom.value && new Date(report.createdAt) < new Date(dateFrom.value)) return false;
            if (dateTo.value && new Date(report.createdAt) > new Date(dateTo.value + 'T23:59:59')) return false;
            
            // Kunde filter
            const order = orders.find(o => o.id === report.orderId);
            if (customerFilter.value && order?.customerId !== customerFilter.value) return false;
            
            // Status filter
            const reportStatus = getReportStatus(report);
            if (statusFilter.value && reportStatus !== statusFilter.value) return false;
            
            // Søk
            if (searchInput.value) {
                const searchTerm = searchInput.value.toLowerCase();
                const customer = customers.find(c => c.id === order?.customerId);
                const technician = technicians.find(t => t.id === order?.technicianId);
                
                const searchableText = [
                    order?.orderNumber,
                    customer?.name,
                    technician?.name,
                    report.reportId
                ].filter(Boolean).join(' ').toLowerCase();
                
                if (!searchableText.includes(searchTerm)) return false;
            }
            
            return true;
        });
        
        // Sorter etter dato (nyeste først)
        filteredReports.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        
        // Reset til første side
        currentPage = 1;
        
        updateStats();
        renderReports();
    }
    
    function getReportStatus(report) {
        if (report.sentToCustomer) return 'sent';
        if (report.status === 'completed') return 'completed';
        return 'draft';
    }
    
    function updateStats() {
        const stats = {
            total: filteredReports.length,
            sent: filteredReports.filter(r => r.sentToCustomer).length,
            pending: filteredReports.filter(r => r.status === 'completed' && !r.sentToCustomer).length,
            draft: filteredReports.filter(r => r.status === 'draft').length
        };
        
        document.getElementById('total-reports').textContent = stats.total;
        document.getElementById('sent-reports').textContent = stats.sent;
        document.getElementById('pending-reports').textContent = stats.pending;
        document.getElementById('draft-reports').textContent = stats.draft;
    }
    
    function renderReports() {
        const tbody = document.getElementById('reports-table-body');
        const startIndex = (currentPage - 1) * reportsPerPage;
        const endIndex = startIndex + reportsPerPage;
        const pageReports = filteredReports.slice(startIndex, endIndex);
        
        if (pageReports.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="loading-cell">Ingen rapporter funnet</td></tr>';
            renderPagination();
            return;
        }
        
        tbody.innerHTML = pageReports.map(report => {
            const order = orders.find(o => o.id === report.orderId);
            const customer = customers.find(c => c.id === order?.customerId);
            const technician = technicians.find(t => t.id === order?.technicianId);
            const reportEquipment = equipment.filter(e => e.id === report.equipmentId);
            const status = getReportStatus(report);
            
            return `
                <tr>
                    <td>${formatDate(report.createdAt)}</td>
                    <td>${order?.orderNumber || report.orderId}</td>
                    <td>${customer?.name || 'Ukjent'}</td>
                    <td>${technician?.name || 'Ukjent'}</td>
                    <td>${reportEquipment.length} anlegg</td>
                    <td><span class="status-badge ${status}">${getStatusText(status)}</span></td>
                    <td>
                        <div class="action-buttons">
                            <button class="btn-icon-only" onclick="viewReport('${report.reportId}')" title="Vis detaljer">
                                👁️
                            </button>
                            <button class="btn-icon-only" onclick="generatePDF('${report.reportId}')" title="Generer PDF">
                                📄
                            </button>
                            ${status !== 'sent' ? `
                                <button class="btn-icon-only" onclick="sendReport('${report.reportId}')" title="Send til kunde">
                                    ✉️
                                </button>
                            ` : ''}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
        
        renderPagination();
    }
    
    function renderPagination() {
        const container = document.getElementById('pagination-container');
        const totalPages = Math.ceil(filteredReports.length / reportsPerPage);
        
        if (totalPages <= 1) {
            container.innerHTML = '';
            return;
        }
        
        let html = `
            <button ${currentPage === 1 ? 'disabled' : ''} onclick="changePage(${currentPage - 1})">‹</button>
        `;
        
        // Vis max 5 sider
        const startPage = Math.max(1, currentPage - 2);
        const endPage = Math.min(totalPages, startPage + 4);
        
        for (let i = startPage; i <= endPage; i++) {
            html += `<button class="${i === currentPage ? 'active' : ''}" onclick="changePage(${i})">${i}</button>`;
        }
        
        html += `
            <button ${currentPage === totalPages ? 'disabled' : ''} onclick="changePage(${currentPage + 1})">›</button>
            <span class="page-info">Side ${currentPage} av ${totalPages}</span>
        `;
        
        container.innerHTML = html;
    }
    
    window.changePage = function(page) {
        currentPage = page;
        renderReports();
        window.scrollTo(0, 0);
    };
    
    window.viewReport = async function(reportId) {
        const report = allReports.find(r => r.reportId === reportId);
        if (!report) return;

        const order = orders.find(o => o.id === report.orderId);
        const customer = customers.find(c => c.id === order?.customerId);
        const technician = technicians.find(t => t.id === order?.technicianId);

        const modalBody = document.getElementById('report-modal-body');
        modalBody.innerHTML = `
            <div class="report-preview-container">
                <div class="report-header">
                    <img src="/assets/images/air-techlogo.svg" alt="Air-Tech Logo" class="report-logo">
                    <h2>Servicerapport</h2>
                </div>

                <div class="report-meta-grid">
                    <div class="meta-item">
                        <span class="meta-label">Kunde</span>
                        <span class="meta-value">${customer?.name || 'Ukjent'}</span>
                    </div>
                    <div class="meta-item">
                        <span class="meta-label">Ordrenummer</span>
                        <span class="meta-value">${order?.orderNumber || report.orderId}</span>
                    </div>
                    <div class="meta-item">
                        <span class="meta-label">Dato</span>
                        <span class="meta-value">${formatDate(report.createdAt)}</span>
                    </div>
                    <div class="meta-item">
                        <span class="meta-label">Tekniker</span>
                        <span class="meta-value">${technician?.name || 'Ukjent'}</span>
                    </div>
                </div>

                <div class="report-section-preview">
                    <h4>Anlegg og utført service</h4>
                    ${report.reportData?.components?.map((comp, index) => `
                        <div class="equipment-item-preview">
                            <div class="equipment-header-preview">
                                <span class="equipment-name-preview">${comp.details?.systemnummer || ''} - ${comp.details?.plassering || 'Sjekkliste ' + (index + 1)}</span>
                            </div>
                            <table class="checklist-table">
                                ${Object.entries(comp.checklist || {}).map(([key, value]) => {
                                    if (typeof value === 'object' && value.status) {
                                        return `<tr>
                                            <td>${key}</td>
                                            <td class="status-cell ${value.status === 'ok' ? 'status-ok' : 'status-nok'}">${value.status.toUpperCase()}</td>
                                        </tr>`;
                                    }
                                    return '';
                                }).join('')}
                            </table>
                            ${comp.products?.length > 0 ? `
                                <div class="products-section">
                                    <strong>Brukte produkter:</strong>
                                    <ul>
                                        ${comp.products.map(p => `<li>${p.name} (${p.price} kr)</li>`).join('')}
                                    </ul>
                                </div>
                            ` : ''}
                        </div>
                    `).join('') || '<p>Ingen sjekklister funnet.</p>'}
                </div>

                ${report.reportData?.overallComment ? `
                    <div class="report-section-preview">
                        <h4>Avsluttende kommentar</h4>
                        <p class="comment-box">${report.reportData.overallComment}</p>
                    </div>
                ` : ''}
            </div>
        `;

        // Oppdater knapper
        document.getElementById('generate-pdf-btn').onclick = () => generatePDF(report.reportId);
        document.getElementById('send-report-btn').onclick = () => sendReport(report.reportId);
        document.getElementById('send-report-btn').style.display = report.sentToCustomer ? 'none' : 'inline-flex';

        reportModal.classList.add('show');
    };
    
    window.closeReportModal = function() {
        reportModal.classList.remove('show');
    };
    
    window.generatePDF = async function(reportId) {
        showToast('Genererer PDF...', 'info');
        
        try {
            // Her ville vi kalle en API endpoint for å generere PDF
            // For nå simulerer vi dette
            setTimeout(() => {
                showToast('PDF generert og lastet ned', 'success');
                // window.open(`/api/reports/${reportId}/pdf`, '_blank');
            }, 1500);
        } catch (error) {
            showToast('Kunne ikke generere PDF', 'error');
        }
    };
    
    window.sendReport = async function(reportId) {
        if (!confirm('Er du sikker på at du vil sende rapporten til kunden?')) return;
        
        showToast('Sender rapport...', 'info');
        
        try {
            // Oppdater rapport som sendt
            const report = allReports.find(r => r.reportId === reportId);
            if (report) {
                report.sentToCustomer = true;
                report.sentDate = new Date().toISOString();
            }
            
            // Her ville vi kalle API for å sende e-post
            setTimeout(() => {
                showToast('Rapport sendt til kunde', 'success');
                filterReports(); // Oppdater visning
                closeReportModal();
            }, 1500);
        } catch (error) {
            showToast('Kunne ikke sende rapport', 'error');
        }
    };
    
    function formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString('no-NO', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    }
    
    function getStatusText(status) {
        const statusMap = {
            'draft': 'Kladd',
            'completed': 'Fullført',
            'sent': 'Sendt'
        };
        return statusMap[status] || status;
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
    
    function showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            background: ${type === 'error' ? '#ef4444' : type === 'info' ? '#3b82f6' : '#10b981'};
            color: white;
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 1001;
            animation: slideInRight 0.3s ease-out;
        `;
        
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }
});