// Air-Tech AS - Hasteordre JavaScript
// Håndterer opprettelse av hasteordre for teknikere

(function() {
    'use strict';
    
    // State management
    const state = {
        selectedCustomer: null,
        searchTimeout: null,
        allCustomers: [],
        isLoading: false
    };
    
    // DOM Elements
    let elements = {};
    
    // Initialize when DOM is ready
    document.addEventListener('DOMContentLoaded', async () => {
        // Vent på autentisering først
        if (window.authManager) {
            await window.authManager.waitForInitialization();
        }
        
        // Sjekk om bruker er logget inn
        if (!window.authManager?.isLoggedIn()) {
            console.log('Not authenticated, redirecting...');
            return; // auth-check.js vil håndtere redirect
        }
        
        initialize();
    });
    
    function initialize() {
        console.log('🚀 Initializing Hasteordre page...');
        
        // Cache DOM elements
        elements = {
            searchInput: document.getElementById('customerSearch'),
            searchResults: document.getElementById('searchResults'),
            customerInfo: document.getElementById('customerInfo'),
            createOrderBtn: document.getElementById('createOrderBtn'),
            // Customer info fields
            customerNumber: document.getElementById('customerNumber'),
            customerName: document.getElementById('customerName'),
            customerAddress: document.getElementById('customerAddress'),
            customerPhone: document.getElementById('customerPhone'),
            customerContact: document.getElementById('customerContact'),
            customerEmail: document.getElementById('customerEmail')
        };
        
        // Populate header with user info (like other pages)
        populateHeader();
        
        // Setup event listeners
        setupEventListeners();
        
        // Load initial data
        loadCustomers();
    }
    
    function populateHeader() {
        try {
            // Get current user from authManager
            const currentUser = window.authManager?.getCurrentUser();
            const technician = currentUser?.technician;
            const isAdmin = currentUser?.isAdmin;
            
            // Set user initials (prioritize technician, fallback to admin email)
            const techInitialsEl = document.getElementById('technician-initials');
            if (techInitialsEl) {
                let initials = '??';
                
                if (technician) {
                    initials = technician.initials || 
                              technician.name.split(' ').map(n => n[0]).join('').substring(0, 2);
                } else if (isAdmin && currentUser.adminEmail) {
                    // For admin users, use email initials
                    const emailParts = currentUser.adminEmail.split('@')[0];
                    initials = emailParts.substring(0, 2).toUpperCase();
                }
                
                techInitialsEl.textContent = initials;
            }
            
            // Set current date
            const currentDateEl = document.getElementById('current-date');
            if (currentDateEl) {
                const today = new Date();
                const dateString = `${today.getDate()}. ${today.toLocaleString('no-NO', { month: 'short' })} ${today.getFullYear()}`;
                currentDateEl.textContent = dateString;
            }
        } catch (error) {
            console.error('Error populating header:', error);
        }
    }
    
    function setupEventListeners() {
        // Search input
        elements.searchInput?.addEventListener('input', handleSearchInput);
        
        // Create order button
        elements.createOrderBtn?.addEventListener('click', handleCreateOrder);
        
        // Click outside to close search results
        document.addEventListener('click', handleClickOutside);
    }
    
    // Load all customers
    async function loadCustomers() {
        try {
            console.log('📋 Loading customers from Tripletex...');
            
            // Bruk samme endpoint som search-orders.js
            const response = await fetch('/api/customers', {
                credentials: 'include'
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            state.allCustomers = Array.isArray(data) ? data : (data.customers || []);
            console.log(`✅ Loaded ${state.allCustomers.length} customers from Tripletex`);
            
        } catch (error) {
            console.error('❌ Error loading customers from Tripletex:', error);
            showToast('Kunne ikke laste kunder fra Tripletex', 'error');
        }
    }
    
    // Handle search input
    function handleSearchInput(e) {
        clearTimeout(state.searchTimeout);
        
        const query = e.target.value.trim();
        
        if (query.length < 2) {
            elements.searchResults.classList.remove('active');
            return;
        }
        
        state.searchTimeout = setTimeout(() => {
            searchCustomers(query);
        }, 300);
    }
    
    // Search customers locally
    function searchCustomers(query) {
        const lowerQuery = query.toLowerCase();
        
        const matches = state.allCustomers.filter(customer =>
            customer.name.toLowerCase().includes(lowerQuery) ||
            (customer.customerNumber && customer.customerNumber.toString().includes(query))
        ).slice(0, 10);
        
        displaySearchResults(matches);
    }
    
    // Display search results
    function displaySearchResults(customers) {
        if (customers.length === 0) {
            elements.searchResults.innerHTML = '<div class="no-results">Ingen kunder funnet</div>';
            elements.searchResults.classList.add('active');
            return;
        }
        
        elements.searchResults.innerHTML = customers.map(customer => `
            <div class="search-result-item" data-id="${customer.id}">
                <div>
                    <strong>${escapeHtml(customer.name)}</strong>
                    ${customer.customerNumber ? `<div style="color: #6b7280; font-size: 12px; margin-top: 2px;">Kundenr: ${customer.customerNumber}</div>` : ''}
                </div>
                <div style="color: #ff6b35; font-weight: 600;">→</div>
            </div>
        `).join('');
        
        elements.searchResults.classList.add('active');
        
        // Add click handlers
        elements.searchResults.querySelectorAll('.search-result-item').forEach(item => {
            item.addEventListener('click', () => {
                const customerId = item.dataset.id;
                const customer = state.allCustomers.find(c => c.id == customerId);
                selectCustomer(customer);
            });
        });
    }
    
    // Select customer
    function selectCustomer(customer) {
        console.log('👤 Selected customer:', customer.name);
        
        state.selectedCustomer = customer;
        elements.searchInput.value = customer.name;
        elements.searchResults.classList.remove('active');
        
        // Update customer info display
        elements.customerNumber.textContent = customer.customerNumber || '-';
        elements.customerName.textContent = customer.name;
        elements.customerAddress.textContent = customer.physicalAddress || customer.address || '-';
        elements.customerPhone.textContent = customer.phone || '-';
        elements.customerContact.textContent = customer.contact || customer.contactPerson || '-';
        elements.customerEmail.textContent = customer.email || '-';
        
        elements.customerInfo.classList.add('active');
        elements.createOrderBtn.disabled = false;
    }
    
    // Handle click outside search results
    function handleClickOutside(e) {
        if (!elements.searchInput.contains(e.target) &&
            !elements.searchResults.contains(e.target)) {
            elements.searchResults.classList.remove('active');
        }
    }
    
    // Create emergency order
    // Create emergency order - OPPDATERT for tekniker endpoint
    async function handleCreateOrder() {
        if (!state.selectedCustomer || state.isLoading) return;
        
        console.log('⚡ Creating emergency order...');
        
        state.isLoading = true;
        elements.createOrderBtn.disabled = true;
        elements.createOrderBtn.innerHTML = '<span class="loading"></span> Oppretter ordre...';
        
        try {
            const currentUser = window.authManager?.getCurrentUser();
            
            // Sjekk om brukeren er admin eller tekniker
            const isAdmin = currentUser?.isAdmin || false;
            const technicianId = currentUser?.technician?.id;
            
            console.log('User type:', { isAdmin, technicianId });
            
            const orderData = {
                customerId: state.selectedCustomer.id,
                customerName: state.selectedCustomer.name,
                customerData: state.selectedCustomer, // Send all customer data from Tripletex
                description: 'Hasteordre - Akutt serviceoppdrag',
                serviceType: 'Hasteordre',
                scheduledDate: new Date().toISOString().split('T')[0]
            };
            
            console.log('📤 Sending order data:', orderData);
            
            // Bruk tekniker endpoint (ikke admin)
            const response = await fetch('/api/orders', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify(orderData)
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `Server error: ${response.status}`);
            }
            
            const order = await response.json();
            console.log('✅ Order created:', order);
            
            // Show success message
            showToast('Hasteordre opprettet!', 'success');
            
            // Redirect to order page after short delay
            setTimeout(() => {
                if (isAdmin) {
                    // Admin goes to admin dashboard
                    window.location.href = '/admin/dashboard.html';
                } else {
                    // Technician goes to order details
                    window.location.href = `orders.html?id=${order.id}`;
                }
            }, 1500);
            
        } catch (error) {
            console.error('❌ Error creating order:', error);
            showToast(error.message || 'Kunne ikke opprette hasteordre', 'error');
            
            // Reset button
            elements.createOrderBtn.disabled = false;
            elements.createOrderBtn.innerHTML = '<span class="btn-icon">⚡</span> Opprett hasteordre';
            
        } finally {
            state.isLoading = false;
        }
    }
    
    // Utility functions
    function showToast(message, type = 'info') {
        // Check if toast container exists
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            document.body.appendChild(container);
        }
        
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        
        // Trigger animation
        setTimeout(() => {
            toast.classList.add('show');
        }, 10);
        
        // Remove after delay
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
    
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
})();