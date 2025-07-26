// air-tech-adminweb/assets/js/tilbud.js - Forbedret versjon med bedre design
document.addEventListener('DOMContentLoaded', async () => {
    const quotesContainer = document.getElementById('quotes-container');
    const statusFilter = document.getElementById('status-filter');
    let allQuotes = [];
    let selectedQuoteId = null;

    await loadData();
    setupEventListeners();

    async function loadData() {
        try {
            const [quotes, customers, orders] = await Promise.all([
                fetch('/api/quotes').then(res => res.json()),
                fetch('/api/customers').then(res => res.json()),
                fetch('/api/orders').then(res => res.json())
            ]);

            allQuotes = quotes.map(quote => {
                const order = orders.find(o => o.id === quote.orderId);
                const customer = order ? customers.find(c => c.id === order.customerId) : null;
                return { ...quote, order, customer };
            });

            renderQuotes(allQuotes);
        } catch (error) {
            console.error('Feil ved lasting av data:', error);
            quotesContainer.innerHTML = '<div class="empty-state"><p style="color: red;">Kunne ikke laste tilbud</p></div>';
        }
    }

    function renderQuotes(quotes) {
        if (quotes.length === 0) {
            quotesContainer.innerHTML = '<div class="empty-state"><p>Ingen tilbud funnet</p></div>';
            return;
        }

        quotesContainer.innerHTML = quotes.map(quote => `
            <div class="quote-item ${selectedQuoteId === quote.id ? 'selected' : ''}" 
                 data-quote-id="${quote.id}">
                <div class="quote-header">
                    <span class="quote-title">${quote.description.substring(0, 40)}${quote.description.length > 40 ? '...' : ''}</span>
                    <span class="quote-status status-${quote.status}">${getStatusText(quote.status)}</span>
                </div>
                <div class="quote-meta">
                    <strong>Kunde:</strong> ${quote.customer?.name || 'Ukjent'} | 
                    <strong>Ordre:</strong> ${quote.order?.orderNumber || quote.orderId}
                </div>
                <div class="quote-description">
                    ${quote.description.length > 80 ? quote.description.substring(0, 80) + '...' : quote.description}
                </div>
                <div class="quote-pricing">
                    <span>Estimat: ${quote.estimatedPrice} kr</span>
                    <span>${quote.estimatedHours} timer</span>
                </div>
            </div>
        `).join('');
    }

    function getStatusText(status) {
        const statusMap = {
            'pending': 'Venter',
            'sent': 'Sendt',
            'rejected': 'Avvist'
        };
        return statusMap[status] || status;
    }

    function displayQuoteDetails(quote) {
        const placeholder = document.getElementById('quote-details-placeholder');
        const content = document.getElementById('quote-details-content');
        
        placeholder.style.display = 'none';
        content.classList.add('active');
        
        content.innerHTML = `
            <div class="detail-section">
                <div class="detail-label">Kunde</div>
                <div class="detail-value">${quote.customer?.name || 'Ukjent kunde'}</div>
            </div>
            
            <div class="detail-section">
                <div class="detail-label">Ordre</div>
                <div class="detail-value">${quote.order?.orderNumber || quote.orderId}</div>
            </div>
            
            <div class="detail-section">
                <div class="detail-label">Beskrivelse</div>
                <div class="detail-value" style="white-space: pre-wrap;">${quote.description}</div>
            </div>
            
            <div class="detail-section">
                <div class="detail-label">Estimat</div>
                <div class="detail-value">
                    <strong>${quote.estimatedPrice} kr</strong> (${quote.estimatedHours} timer)
                </div>
            </div>
            
            ${quote.products && quote.products.length > 0 ? `
                <div class="detail-section">
                    <div class="detail-label">Produkter/Materialer</div>
                    <ul class="products-list">
                        ${quote.products.map(product => `
                            <li class="product-item">
                                <span>${product.name}</span>
                                <span>${product.price} kr</span>
                            </li>
                        `).join('')}
                    </ul>
                </div>
            ` : ''}
            
            <div class="detail-section">
                <div class="detail-label">Status</div>
                <div class="detail-value">
                    <span class="quote-status status-${quote.status}">${getStatusText(quote.status)}</span>
                </div>
            </div>
            
            <div class="detail-section">
                <div class="detail-label">Opprettet</div>
                <div class="detail-value">${new Date(quote.createdAt).toLocaleString('no-NO')}</div>
            </div>
            
            <div class="action-buttons">
                ${quote.status === 'pending' ? `
                    <button class="btn btn-approve" onclick="updateQuoteStatus('${quote.id}', 'sent')">
                        Send til kunde
                    </button>
                    <button class="btn btn-reject" onclick="updateQuoteStatus('${quote.id}', 'rejected')">
                        Avvis
                    </button>
                ` : ''}
                
                <button class="btn btn-edit" onclick="openEditModal('${quote.id}')">
                    Rediger tilbud
                </button>
                
                <button class="btn" onclick="deleteQuote('${quote.id}')" style="background: #6c757d; color: white;">
                    Slett tilbud
                </button>
            </div>
        `;
    }

    // Global funksjoner som kan kalles fra HTML
    window.updateQuoteStatus = async function(quoteId, newStatus) {
        try {
            const response = await fetch(`/api/quotes/${quoteId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus })
            });

            if (!response.ok) throw new Error('Oppdatering feilet');

            const quoteIndex = allQuotes.findIndex(q => q.id === quoteId);
            if (quoteIndex !== -1) {
                allQuotes[quoteIndex].status = newStatus;
                renderQuotes(allQuotes);
                
                if (selectedQuoteId === quoteId) {
                    displayQuoteDetails(allQuotes[quoteIndex]);
                }
            }

            showToast(`Tilbud ${getStatusText(newStatus).toLowerCase()}`, 'success');
        } catch (error) {
            console.error('Feil ved oppdatering:', error);
            showToast('Kunne ikke oppdatere tilbud', 'error');
        }
    };

    window.openEditModal = function(quoteId) {
        const quote = allQuotes.find(q => q.id === quoteId);
        if (!quote) return;

        const products = quote.products || [];
        const productsHTML = products.map((product, index) => `
            <div class="product-row" data-index="${index}">
                <div class="product-inputs">
                    <input type="text" value="${product.name}" placeholder="Produktnavn" class="product-name-input" data-field="name" data-index="${index}">
                    <input type="text" value="${product.price}" placeholder="0" class="product-price-input" data-field="price" data-index="${index}">
                </div>
                <button type="button" class="remove-product-btn" onclick="removeProduct(${index})">
                    <span>×</span>
                </button>
            </div>
        `).join('');

        // Beregn total
        const totalProducts = products.reduce((sum, p) => sum + (parseFloat(p.price) || 0), 0);
        const totalWork = (parseFloat(quote.estimatedPrice) || 0);
        const grandTotal = totalProducts + totalWork;

        const modalHTML = `
            <div class="modal-overlay-custom" id="edit-modal">
                <div class="modal-content-custom">
                    <div class="modal-header-custom">
                        <h3>Rediger tilbud</h3>
                        <button type="button" class="close-btn-custom" onclick="closeEditModal()">×</button>
                    </div>
                    
                    <div class="modal-body-custom">
                        <div class="form-section">
                            <label class="form-label">Beskrivelse av arbeid</label>
                            <textarea id="edit-description" class="form-textarea" placeholder="Beskriv arbeidsoppgaven som trenger tilbud..." rows="4">${quote.description}</textarea>
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label class="form-label">Estimerte timer</label>
                                <input type="text" id="edit-hours" value="${quote.estimatedHours}" class="form-input" placeholder="0">
                            </div>
                            <div class="form-group">
                                <label class="form-label">Arbeidspris (kr)</label>
                                <input type="text" id="edit-price" value="${quote.estimatedPrice}" class="form-input" placeholder="0">
                            </div>
                        </div>
                        
                        <div class="form-section">
                            <div class="products-header">
                                <label class="form-label">Produkter/materialer</label>
                                <button type="button" class="add-product-btn-custom" onclick="addProduct()">
                                    + Legg til produkt
                                </button>
                            </div>
                            <div id="products-container" class="products-container">
                                ${productsHTML}
                            </div>
                        </div>
                        
                        <div class="totals-section">
                            <div class="total-row">
                                <span>Produkter:</span>
                                <span id="products-total">${totalProducts.toLocaleString('no-NO')} kr</span>
                            </div>
                            <div class="total-row">
                                <span>Arbeid:</span>
                                <span id="work-total">${totalWork.toLocaleString('no-NO')} kr</span>
                            </div>
                            <div class="total-row grand-total">
                                <span>Totalt:</span>
                                <span id="grand-total">${grandTotal.toLocaleString('no-NO')} kr</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="modal-footer-custom">
                        <button type="button" class="btn-secondary-custom" onclick="closeEditModal()">Avbryt</button>
                        <button type="button" class="btn-preview-custom" disabled title="Kommer snart">Forhåndsvisning</button>
                        <button type="button" class="btn-primary-custom" onclick="saveQuoteChanges('${quote.id}')">Lagre endringer</button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
        setupModalEventListeners();
    };

    function setupModalEventListeners() {
        // Event listeners for sum-beregning
        document.addEventListener('input', function(e) {
            if (e.target.matches('.product-price-input') || e.target.matches('#edit-price')) {
                updateTotals();
            }
        });
    }

    function updateTotals() {
        const productInputs = document.querySelectorAll('.product-price-input');
        const workPriceInput = document.getElementById('edit-price');
        
        let productsTotal = 0;
        productInputs.forEach(input => {
            const price = parseFloat(input.value) || 0;
            productsTotal += price;
        });
        
        const workTotal = parseFloat(workPriceInput?.value) || 0;
        const grandTotal = productsTotal + workTotal;
        
        // Oppdater visning
        const productsSpan = document.getElementById('products-total');
        const workSpan = document.getElementById('work-total');
        const grandSpan = document.getElementById('grand-total');
        
        if (productsSpan) productsSpan.textContent = `${productsTotal.toLocaleString('no-NO')} kr`;
        if (workSpan) workSpan.textContent = `${workTotal.toLocaleString('no-NO')} kr`;
        if (grandSpan) grandSpan.textContent = `${grandTotal.toLocaleString('no-NO')} kr`;
    }

    window.addProduct = function() {
        const container = document.getElementById('products-container');
        const index = container.children.length;
        const productHTML = `
            <div class="product-row" data-index="${index}">
                <div class="product-inputs">
                    <input type="text" placeholder="Produktnavn" class="product-name-input" data-field="name" data-index="${index}">
                    <input type="text" placeholder="0" class="product-price-input" data-field="price" data-index="${index}">
                </div>
                <button type="button" class="remove-product-btn" onclick="removeProduct(${index})">
                    <span>×</span>
                </button>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', productHTML);
        updateTotals();
    };

    window.removeProduct = function(index) {
        const productRow = document.querySelector(`[data-index="${index}"]`);
        if (productRow) {
            productRow.remove();
            updateTotals();
        }
    };

    window.saveQuoteChanges = async function(quoteId) {
        const description = document.getElementById('edit-description').value;
        const hours = document.getElementById('edit-hours').value;
        const price = document.getElementById('edit-price').value;

        // Samle produkter
        const productInputs = document.querySelectorAll('#products-container .product-row');
        const products = Array.from(productInputs).map(row => {
            const nameInput = row.querySelector('.product-name-input');
            const priceInput = row.querySelector('.product-price-input');
            return {
                name: nameInput ? nameInput.value.trim() : '',
                price: priceInput ? parseFloat(priceInput.value) || 0 : 0
            };
        }).filter(p => p.name !== '');

        try {
            const response = await fetch(`/api/quotes/${quoteId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    description,
                    estimatedHours: parseFloat(hours) || 0,
                    estimatedPrice: parseFloat(price) || 0,
                    products
                })
            });

            if (!response.ok) throw new Error('Lagring feilet');

            // Oppdater lokal data
            const quoteIndex = allQuotes.findIndex(q => q.id === quoteId);
            if (quoteIndex !== -1) {
                allQuotes[quoteIndex] = { 
                    ...allQuotes[quoteIndex], 
                    description, 
                    estimatedHours: parseFloat(hours) || 0, 
                    estimatedPrice: parseFloat(price) || 0, 
                    products 
                };
                
                renderQuotes(allQuotes);
                if (selectedQuoteId === quoteId) {
                    displayQuoteDetails(allQuotes[quoteIndex]);
                }
            }

            closeEditModal();
            showToast('Tilbud oppdatert', 'success');
        } catch (error) {
            console.error('Feil ved lagring:', error);
            showToast('Kunne ikke lagre endringer', 'error');
        }
    };

    window.closeEditModal = function() {
        const modal = document.getElementById('edit-modal');
        if (modal) modal.remove();
    };

    window.deleteQuote = async function(quoteId) {
        if (!confirm('Er du sikker på at du vil slette dette tilbudet?')) return;

        try {
            const response = await fetch(`/api/quotes/${quoteId}`, { method: 'DELETE' });
            if (!response.ok) throw new Error('Sletting feilet');

            allQuotes = allQuotes.filter(q => q.id !== quoteId);
            renderQuotes(allQuotes);
            
            if (selectedQuoteId === quoteId) {
                document.getElementById('quote-details-placeholder').style.display = 'block';
                document.getElementById('quote-details-content').classList.remove('active');
                selectedQuoteId = null;
            }

            showToast('Tilbud slettet', 'success');
        } catch (error) {
            console.error('Feil ved sletting:', error);
            showToast('Kunne ikke slette tilbud', 'error');
        }
    };

    function setupEventListeners() {
        // Quote selection
        quotesContainer.addEventListener('click', (e) => {
            const quoteItem = e.target.closest('.quote-item');
            if (!quoteItem) return;

            document.querySelectorAll('.quote-item').forEach(item => item.classList.remove('selected'));
            quoteItem.classList.add('selected');
            
            const quoteId = quoteItem.dataset.quoteId;
            selectedQuoteId = quoteId;
            
            const quote = allQuotes.find(q => q.id === quoteId);
            if (quote) {
                displayQuoteDetails(quote);
            }
        });

        // Status filter
        statusFilter.addEventListener('change', (e) => {
            const filterValue = e.target.value;
            const filteredQuotes = filterValue 
                ? allQuotes.filter(quote => quote.status === filterValue)
                : allQuotes;
            renderQuotes(filteredQuotes);
        });
    }

    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed; top: 20px; right: 20px; padding: 12px 20px;
            background: ${type === 'error' ? '#dc3545' : '#28a745'};
            color: white; border-radius: 6px; z-index: 1001;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        `;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }
});