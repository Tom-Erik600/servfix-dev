// public/admin/assets/js/tilbud.js
document.addEventListener('DOMContentLoaded', function() {
    console.log('🔄 Tilbud.js laster...');
    
    let allQuotes = [];
    let selectedQuoteId = null;
    const statusFilter = document.getElementById('status-filter');

    loadData();
    setupEventListeners();

    async function loadData() {
        try {
            const response = await fetch('/api/quotes', { credentials: 'include' });
            if (!response.ok) throw new Error('Kunne ikke laste tilbud');
            
            allQuotes = await response.json();
            console.log('📋 Tilbud lastet:', allQuotes.length);
            
            renderQuotes(allQuotes);
        } catch (error) {
            console.error('Feil ved lasting av tilbud:', error);
            showToast('Kunne ikke laste tilbud', 'error');
        }
    }

    function renderQuotes(quotes) {
        const quotesListContainer = document.getElementById('quotes-container');
        
        if (!quotesListContainer) {
            console.error('Quotes list container ikke funnet');
            return;
        }

        if (quotes.length === 0) {
            quotesListContainer.innerHTML = '<div class="empty-state">Ingen tilbud funnet</div>';
            return;
        }

        quotesListContainer.innerHTML = quotes.map(quote => `
            <div class="quote-item ${selectedQuoteId === quote.id ? 'selected' : ''}" 
                 data-quote-id="${quote.id}">
                <div class="quote-header">
                    <span class="quote-title">${(quote.description || 'Uten beskrivelse').substring(0, 40)}${(quote.description || '').length > 40 ? '...' : ''}</span>
                    <span class="quote-status status-${quote.status}">${getStatusText(quote.status)}</span>
                </div>
                <div class="quote-meta">
                    <strong>Kunde:</strong> ${quote.customer?.name || 'Ukjent'} | 
                    <strong>Ordre:</strong> ${quote.order?.order_number || quote.order_id}
                </div>
                <div class="quote-description">
                    ${(quote.description || 'Ingen beskrivelse').length > 80 ? (quote.description || '').substring(0, 80) + '...' : (quote.description || 'Ingen beskrivelse')}
                </div>
                <div class="quote-price">
                    <strong>${quote.estimatedHours || 0} timer</strong>
                    ${quote.products && quote.products.length > 0 ? `<span class="materials-indicator">• materialer</span>` : ''}
                    • <strong>${formatCurrency(
        ((parseFloat(quote.total_amount) || 0) + 
        ((quote.products || []).reduce((sum, p) => sum + ((p.quantity || 1) * (p.price || 0)), 0))) * 1.25
    )}</strong>
                </div>
            </div>
        `).join('');

        setupQuoteClickHandlers();
    }

    function setupQuoteClickHandlers() {
        document.querySelectorAll('.quote-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const quoteId = item.dataset.quoteId;
                selectQuote(quoteId);
            });
        });
    }

    function selectQuote(quoteId) {
        selectedQuoteId = quoteId;
        const quote = allQuotes.find(q => q.id === quoteId);
        
        // Update selection styling
        document.querySelectorAll('.quote-item').forEach(item => {
            item.classList.toggle('selected', item.dataset.quoteId === quoteId);
        });

        if (quote) {
            displayQuoteDetails(quote);
        }
    }

    function displayQuoteDetails(quote) {
    const detailsContent = document.getElementById('quote-details-content');
    const detailsPlaceholder = document.getElementById('quote-details-placeholder');
    
    if (!detailsContent || !detailsPlaceholder) return;
    
    detailsPlaceholder.style.display = 'none';
    detailsContent.style.display = 'block';
    
    // Parse items data safely
    let itemsData = {};
    try {
        if (typeof quote.items === 'string') {
            itemsData = JSON.parse(quote.items);
        } else if (quote.items && typeof quote.items === 'object') {
            itemsData = quote.items;
        }
    } catch (e) {
        console.warn('Could not parse quote items:', e);
    }

    const hours = quote.estimatedHours || itemsData.estimatedHours || 0;
    const products = quote.products || itemsData.products || [];

    // KORREKT LOGIKK: total_amount er KUN arbeidskostnaden
    const arbeidsBelop = parseFloat(quote.total_amount) || 0;

    // Beregn materialkostnad separat
    const materialCost = products.reduce((sum, p) => sum + ((p.quantity || 1) * (p.price || 0)), 0);

    // Total eks MVA = arbeid + materialer
    const totalEksMva = arbeidsBelop + materialCost;

    // MVA og totalt inkl MVA
    const mvaAmount = totalEksMva * 0.25;
    const totalInklMva = totalEksMva + mvaAmount;

    console.log('Prisberegning (Frontend):', {
        arbeid: arbeidsBelop,
        materialer: materialCost,
        totalEksMva: totalEksMva,
        mva: mvaAmount,
        totalInklMva: totalInklMva
    });

    detailsContent.innerHTML = `
        <div class="quote-details-header-modern">
            <div class="quote-title-section">
                <h2 class="quote-title-main">Tilbud #${quote.id}</h2>
                ${quote.status === 'sent' && quote.sent_date ? `
                    <div class="sent-status-badge">
                        <span class="sent-icon">✉️</span>
                        <span>Sendt ${new Date(quote.sent_date).toLocaleDateString('no-NO', { 
                            day: 'numeric', month: 'short', year: 'numeric' 
                        })}</span>
                    </div>
                ` : ''}
            </div>
            
            <div class="action-buttons-modern">
                <button class="btn-modern btn-preview" onclick="generateQuotePDF('${quote.id}')">
                    📄 Forhåndsvisning
                </button>
                <button class="btn-modern btn-edit-orange" onclick="editQuote('${quote.id}')">
                    ✏️ Rediger
                </button>
                ${quote.status === 'pending' || quote.status === 'rejected' ? `
                    <button class="btn-modern btn-send" onclick="sendQuoteToCustomer('${quote.id}')">
                        ✉️ Send til kunde
                    </button>
                ` : ''}
                ${quote.status !== 'accepted' && quote.status !== 'rejected_customer' ? `
                    <button class="btn-modern btn-reject" onclick="rejectQuote('${quote.id}')">
                        ❌ Avvis
                    </button>
                ` : ''}
            </div>
        </div>

        <div style="margin-top: 24px;"></div>

        <div class="detail-section customer-section">
            <span class="detail-label">Kunde</span>
            <div class="detail-value customer-info">
                ${quote.customer?.customerNumber ? `<div class="customer-number">Kundenr: ${quote.customer.customerNumber}</div>` : ''}
                <div class="customer-name">${quote.customer?.name || 'Ukjent kunde'}</div>
            </div>
        </div>
        
        <div class="detail-section">
            <span class="detail-label">Ordre</span>
            <div class="detail-value">${quote.order?.order_number || `Ordre #${quote.order_id}`}</div>
        </div>
        
        <div class="detail-section">
            <span class="detail-label">Beskrivelse</span>
            <div class="detail-value">${quote.description || 'Ingen beskrivelse'}</div>
        </div>
        
        <div class="detail-section estimate-summary">
            <span class="detail-label">Estimat</span>
            <div class="estimate-details">
    ${hours > 0 ? `
        <div class="estimate-row">
            <span class="estimate-label">Arbeid (${hours} timer)</span>
            <span class="estimate-value">${formatCurrency(arbeidsBelop)}</span>
        </div>
    ` : ''}
    
    <div class="estimate-row materials-header">
        <span class="estimate-label">Materialer</span>
        <span class="estimate-value">${formatCurrency(materialCost)}</span>
    </div>
    
    ${products.length > 0 ? 
        products.map(product => `
            <div class="estimate-row material-item">
                <span class="material-name">${product.name || 'Ukjent produkt'}</span>
                <span class="material-price">${formatCurrency((product.quantity || 1) * (product.price || 0))}</span>
            </div>
        `).join('')
    : '<div class="estimate-row material-item"><span class="material-name">Ingen materialer</span></div>'}
    
    <div class="estimate-row total-row">
        <span class="estimate-label"><strong>Totalt eks. mva</strong></span>
        <span class="estimate-value"><strong>${formatCurrency(totalEksMva)}</strong></span>
    </div>
    <div class="estimate-row">
        <span class="estimate-label">MVA (25%)</span>
        <span class="estimate-value">${formatCurrency(mvaAmount)}</span>
    </div>
    <div class="estimate-row total-row final">
        <span class="estimate-label"><strong>Totalt ink. mva</strong></span>
        <span class="estimate-value"><strong>${formatCurrency(totalInklMva)}</strong></span>
    </div>
</div>
        </div>
    `;
}

    function setupEventListeners() {
        statusFilter?.addEventListener('change', (e) => {
            const filterValue = e.target.value;
            const filteredQuotes = filterValue === 'all' 
                ? allQuotes 
                : allQuotes.filter(quote => quote.status === filterValue);
            renderQuotes(filteredQuotes);
        });
    }

    function formatCurrency(amount) {
        return new Intl.NumberFormat('no-NO', {
            style: 'currency',
            currency: 'NOK',
            minimumFractionDigits: 0
        }).format(amount || 0);
    }

    function getStatusText(status) {
        const statusMap = {
            'pending': 'Venter',
            'sent': 'Sendt',
            'accepted': 'Godkjent',
            'rejected': 'Avvist',
            'rejected_customer': 'Avvist av kunde',
            'rejected_admin': 'Avvist av admin'
        };
        return statusMap[status] || status;
    }

    // Global quote action functions
    window.generateQuotePDF = async function(quoteId) {
        try {
            console.log('Opening quote preview for:', quoteId);
            const modal = document.getElementById('quote-preview-modal');
            const iframe = document.getElementById('quote-preview-iframe');
            const viewPdfBtn = document.getElementById('view-pdf-btn');

            if (!modal || !iframe || !viewPdfBtn) {
                throw new Error('Modal elements not found');
            }

            // Load HTML preview
            iframe.src = `/api/quotes/${quoteId}/html-preview`;
            
            // Setup PDF download button
            viewPdfBtn.onclick = async () => {
                try {
                    const response = await fetch(`/api/quotes/${quoteId}/pdf`, {
                        credentials: 'include'
                    });
                    
                    if (!response.ok) throw new Error('PDF generation failed');
                    
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `tilbud-${quoteId}.pdf`;
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    document.body.removeChild(a);
                } catch (error) {
                    console.error('PDF download error:', error);
                    showToast('Kunne ikke laste ned PDF', 'error');
                }
            };

            modal.classList.add('show');
        } catch (error) {
            console.error('Error opening quote preview:', error);
            showToast('Kunne ikke åpne forhåndsvisning', 'error');
        }
    };

    window.closeQuotePreview = function() {
        const modal = document.getElementById('quote-preview-modal');
        if (modal) {
            modal.classList.remove('show');
        }
    };

    window.sendQuoteToCustomer = async function(quoteId) {
    const quote = allQuotes.find(q => q.id === quoteId);
    if (!quote) return; 
    
    const confirmMessage = `Send tilbud til ${quote.customer?.name || 'kunde'}?\n\nTilbudet vil bli sendt til kundens registrerte e-postadresse.`;
    
    if (!confirm(confirmMessage)) return; 
    
    try {
        console.log('Sending quote to customer:', quoteId);
        
        const response = await fetch(`/api/quotes/${quoteId}/send-to-customer`, {
            method: 'POST',
            credentials: 'include'
        });
        
        if (response.ok) {
            const result = await response.json();
            showToast(`Tilbud sendt til ${result.sentTo}`, 'success');
            
            // Oppdater lokal status til 'sent' for umiddelbar UI oppdatering
            const quoteIndex = allQuotes.findIndex(q => q.id === quoteId);
            if (quoteIndex !== -1) {
                allQuotes[quoteIndex].status = 'sent';
                allQuotes[quoteIndex].sent_date = new Date().toISOString();
                selectQuote(quoteId); // Refresh display
            }
            
            await loadData(); // Full reload for å få server data
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Kunne ikke sende tilbud');
        }
    } catch (error) {
        console.error('Error sending quote:', error);
        showToast('Feil ved sending: ' + error.message, 'error');
    }
};

    window.rejectQuote = async function(quoteId) {
        const quote = allQuotes.find(q => q.id === quoteId);
        if (!quote) return; 
        
        if (!confirm(`Avvis tilbud for ${quote.customer?.name || 'kunde'}?`)) return; 
        
        try {
            const response = await fetch(`/api/quotes/${quoteId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ status: 'rejected_admin' })
            });

            if (!response.ok) throw new Error('Oppdatering feilet');

            await loadData();
            showToast('Tilbud avvist av admin', 'success');
        } catch (error) {
            console.error('Feil ved oppdatering:', error);
            showToast('Kunne ikke oppdatere tilbud', 'error');
        }
    };

    // Edit Quote Functions
    window.editQuote = function(quoteId) {
        const quote = allQuotes.find(q => q.id === quoteId);
        if (quote) {
            openEditModal(quote);
        } else {
            showToast('Fant ikke tilbudet som skal redigeres.', 'error');
        }
    };

    function openEditModal(quote) {
        const formContainer = document.getElementById('edit-quote-form-container');
        const modal = document.getElementById('edit-quote-modal');
        const saveBtn = document.getElementById('save-quote-btn');

        if (!formContainer || !modal || !saveBtn) {
            showToast('Modal elementer ikke funnet', 'error');
            return;
        }

        // Parse items data safely
        let itemsData = {};
        try {
            itemsData = typeof quote.items === 'string' ? JSON.parse(quote.items) : (quote.items || {});
        } catch (e) {
            console.warn('Could not parse quote items for editing:', e);
        }

        const products = quote.products || [];

        formContainer.innerHTML = `
            <form id="edit-quote-form">
                <div class="form-group">
                    <label for="edit-description">Beskrivelse</label>
                    <textarea id="edit-description" class="form-control" rows="3" required>${quote.description || ''}</textarea>
                </div>
                
                <div class="form-group">
                    <label for="edit-estimated-hours">Estimerte timer</label>
                    <input type="number" id="edit-estimated-hours" class="form-control" min="0" step="0.5" value="${quote.estimatedHours || 0}">
                </div>

                <div class="form-group">
                    <label for="edit-total-amount">Total pris eks. MVA (kr)</label>
                    <input type="number" id="edit-total-amount" class="form-control" min="0" step="0.01" value="${quote.total_amount || 0}">
                    <small style="color: #6b7280;">Dette er total pris eks. MVA (inkluderer både arbeid og materialer)</small>
                </div>
                
                <div class="form-group">
                    <label for="edit-status">Status</label>
                    <select id="edit-status" class="form-control">
                        <option value="pending" ${quote.status === 'pending' ? 'selected' : ''}>Venter</option>
                        <option value="sent" ${quote.status === 'sent' ? 'selected' : ''}>Sendt</option>
                        <option value="accepted" ${quote.status === 'accepted' ? 'selected' : ''}>Godkjent</option>
                        <option value="rejected" ${quote.status === 'rejected' ? 'selected' : ''}>Avvist</option>
                        <option value="rejected_admin" ${quote.status === 'rejected_admin' ? 'selected' : ''}>Avvist av admin</option>
                        <option value="rejected_customer" ${quote.status === 'rejected_customer' ? 'selected' : ''}>Avvist av kunde</option>
                    </select>
                </div>
                
                <div class="form-group">
                    <label>Produkter/Materialer</label>
                    <div id="products-container">
                        ${products.map(product => `
                            <div class="product-item">
                                <input type="text" placeholder="Produktnavn" class="product-name" value="${product.name || ''}">
                                <input type="number" placeholder="Antall" class="product-quantity" min="1" value="${product.quantity || 1}">
                                <input type="number" placeholder="Pris" class="product-price" min="0" step="0.01" value="${product.price || 0}">
                                <button type="button" class="remove-product-btn" onclick="this.parentElement.remove(); calculateTotal()">×</button>
                            </div>
                        `).join('')}
                    </div>
                    <button type="button" class="btn btn-secondary" onclick="addProductLine()">+ Legg til produkt</button>
                </div>
                
                <div class="form-group">
                    <div class="total-display">
                        <strong>Total estimert pris: <span id="total-estimate">kr 0</span></strong>
                    </div>
                </div>
            </form>
        `;

        // Add product line function
        window.addProductLine = function() {
            const container = document.getElementById('products-container');
            const newLine = document.createElement('div');
            newLine.className = 'product-item';
            newLine.innerHTML = `
                <input type="text" placeholder="Produktnavn" class="product-name">
                <input type="number" placeholder="Antall" class="product-quantity" min="1" value="1">
                <input type="number" placeholder="Pris" class="product-price" min="0" step="0.01">
                <button type="button" class="remove-product-btn" onclick="this.parentElement.remove(); calculateTotal()">×</button>
            `;
            container.appendChild(newLine);
            
            // Add event listeners to new inputs
            newLine.querySelectorAll('input').forEach(input => {
                input.addEventListener('input', calculateTotal);
            });
        };

        // Calculate total function
        window.calculateTotal = function() {
            const hours = parseFloat(document.getElementById('edit-estimated-hours')?.value) || 0;
            
            let materialCost = 0;
            document.querySelectorAll('.product-item').forEach(item => {
                const quantity = parseFloat(item.querySelector('.product-quantity')?.value) || 0;
                const price = parseFloat(item.querySelector('.product-price')?.value) || 0;
                materialCost += quantity * price;
            });
            
            // Vis bare materialcost siden total_amount settes manuelt av bruker
            const totalDisplay = document.getElementById('total-estimate');
            if (totalDisplay) {
                totalDisplay.innerHTML = `
                    <div style="margin-bottom: 8px;">
                        <strong>Materialer:</strong> ${formatCurrency(materialCost)}
                    </div>
                    <div style="font-size: 12px; color: #6b7280;">
                        Total pris eks. MVA må oppgis manuelt
                    </div>
                `;
            }
        };

        // Add event listeners
        document.getElementById('edit-estimated-hours')?.addEventListener('input', calculateTotal);
        document.querySelectorAll('.product-item input').forEach(input => {
            input.addEventListener('input', calculateTotal);
        });

        // Initial calculation
        calculateTotal();

        // Add event listener for total amount field
        document.getElementById('edit-total-amount')?.addEventListener('input', function() {
            const totalAmount = parseFloat(this.value) || 0;
            const materialCost = Array.from(document.querySelectorAll('.product-item')).reduce((sum, item) => {
                const quantity = parseFloat(item.querySelector('.product-quantity')?.value) || 0;
                const price = parseFloat(item.querySelector('.product-price')?.value) || 0;
                return sum + (quantity * price);
            }, 0);
            
            const totalDisplay = document.getElementById('total-estimate');
            if (totalDisplay) {
                totalDisplay.innerHTML = `
                    <div style="margin-bottom: 8px;">
                        <strong>Materialer:</strong> ${formatCurrency(materialCost)}
                    </div>
                    <div style="margin-bottom: 8px;">
                        <strong>Total eks. MVA:</strong> ${formatCurrency(totalAmount)}
                    </div>
                    <div style="font-weight: 600; color: #059669;">
                        <strong>Total ink. MVA:</strong> ${formatCurrency(totalAmount * 1.25)}
                    </div>
                `;
            }
        });

        // Save function
        saveBtn.onclick = async function(e) {
            e.preventDefault(); // Forhindre form submission
            
            const originalBtnText = saveBtn.innerHTML;
            saveBtn.innerHTML = '💾 Lagrer...';
            saveBtn.disabled = true;

            try {
                const description = document.getElementById('edit-description')?.value?.trim();
                const estimatedHours = parseFloat(document.getElementById('edit-estimated-hours')?.value) || 0;
                const status = document.getElementById('edit-status')?.value;
                
                const products = [];
                document.querySelectorAll('.product-item').forEach(item => {
                    const name = item.querySelector('.product-name')?.value?.trim();
                    const quantity = parseInt(item.querySelector('.product-quantity')?.value) || 1;
                    const price = parseFloat(item.querySelector('.product-price')?.value) || 0;
                    
                    if (name) {
                        products.push({ name, quantity, price });
                    }
                });

                if (!description) {
                    throw new Error('Beskrivelse er påkrevd');
                }

                // Fjern automatisk beregning av totalAmount
                // const timeCost = estimatedHours * 950;
                // const materialCost = products.reduce((sum, p) => sum + (p.price * p.quantity), 0);
                // const totalAmount = (timeCost + materialCost) * 1.25; // Include MVA

                // Legg til et nytt input felt for total amount eller bruk eksisterende verdi
                const totalAmount = parseFloat(document.getElementById('edit-total-amount')?.value) || quote.total_amount || 0;

                const updateData = {
                    description: description,
                    estimatedHours: estimatedHours,
                    products: products,
                    total_amount: totalAmount, // EKS MVA
                    status: status,
                    items: {
                        description: description,
                        estimatedHours: estimatedHours,
                        products: products
                    }
                };

                console.log('Updating quote with data:', updateData);

                const response = await fetch(`/api/quotes/${quote.id}`, {
                    method: 'PUT',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    credentials: 'include',
                    body: JSON.stringify(updateData)
                });

                if (!response.ok) {
                    let errorMessage = `Serverfeil: ${response.status}`;
                    try {
                        const error = await response.json();
                        errorMessage = error.error || errorMessage;
                    } catch (e) {
                        // Kunne ikke parse JSON error response
                    }
                    throw new Error(errorMessage);
                }

                showToast('Tilbudet ble oppdatert!', 'success');
                closeEditModal();
                await loadData();

            } catch (error) {
                console.error('Feil ved lagring av tilbud:', error);
                showToast(`Lagring feilet: ${error.message}`, 'error');
            } finally {
                saveBtn.innerHTML = originalBtnText;
                saveBtn.disabled = false;
            }
        };

        modal.classList.add('show');
    }

    window.closeEditModal = function() {
        const modal = document.getElementById('edit-quote-modal');
        if (modal) {
            modal.classList.remove('show');
        }
        
        setTimeout(() => {
            const container = document.getElementById('edit-quote-form-container');
            if (container) {
                container.innerHTML = '';
            }
        }, 300);
    };

    // Toast function
    window.showToast = function(message, type = 'info') {
        // Remove existing toasts
        document.querySelectorAll('.toast').forEach(toast => toast.remove());
        
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        
        // Styles for toast
        Object.assign(toast.style, {
            position: 'fixed',
            top: '20px',
            right: '20px',
            padding: '12px 20px',
            borderRadius: '8px',
            color: 'white',
            zIndex: '1001',
            opacity: '0',
            transform: 'translateX(100%)',
            transition: 'all 0.3s ease',
            background: type === 'error' ? '#d9534f' : type === 'success' ? '#5cb85c' : '#5bc0de'
        });
        
        document.body.appendChild(toast);
        
        // Animate in
        setTimeout(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(0)';
        }, 10);
        
        // Remove after 3 seconds
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100%)';
            setTimeout(() => document.body.removeChild(toast), 300);
        }, 3000);
    };

    console.log('✅ Tilbud.js fullstendig lastet');
});