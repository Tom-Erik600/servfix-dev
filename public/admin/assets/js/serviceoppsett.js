// ============================================================
// KOMPLETT SERVICEOPPSETT.JS 
// - Leser fra database FØRST
// - Håndterer instruksjoner (ℹ️ knapper + modal)
// - Lagrer endringer tilbake til database
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 Serviceoppsett initialiserer...');
    
    // ===== ELEMENT REFERENCES =====
    const equipmentTypeSelect = document.getElementById('equipment-type-select');
    const checklistConfigDiv = document.getElementById('checklist-config');
    const systemFieldsDisplay = document.getElementById('system-fields-display');
    const checklistItemsContainer = document.getElementById('checklist-items-container');
    const allowProductsCheckbox = document.getElementById('allow-products');
    const allowAdditionalWorkCheckbox = document.getElementById('allow-additional-work');
    const allowCommentsCheckbox = document.getElementById('allow-comments');
    const addChecklistItemBtn = document.getElementById('add-checklist-item-btn');
    const saveChecklistBtn = document.getElementById('save-checklist-btn');
    const hasDriftScheduleCheckbox = document.getElementById('has-drift-schedule');
    const driftScheduleSection = document.getElementById('drift-schedule-config');

    // ===== MODALS =====
    const instructionModal = document.getElementById('instruction-modal');
    const instructionItemLabel = document.getElementById('instruction-item-label');
    const instructionTextarea = document.getElementById('instruction-text');
    const saveInstructionBtn = document.getElementById('save-instruction-btn');
    const deleteInstructionBtn = document.getElementById('delete-instruction-btn');

    // ===== STATE =====
    let checklistTemplates = { facilityTypes: [] };
    let currentFacilityType = null;
    let currentInstructionItem = null; // For instruction modal

    // ===== FETCH TEMPLATES FROM DATABASE =====
    async function fetchChecklistTemplates() {
        console.log('📥 Henter templates fra database...');
        try {
            const response = await fetch('/api/checklist-templates');
            if (!response.ok) {
                throw new Error('Could not fetch checklist templates');
            }
            const data = await response.json();
            checklistTemplates.facilityTypes = data.facilityTypes || [];
            
            console.log('✅ Templates lastet fra database:', {
                count: checklistTemplates.facilityTypes.length,
                types: checklistTemplates.facilityTypes.map(t => ({
                    name: t.name,
                    systemFieldsCount: t.systemFields?.length || 0,
                    checklistItemsCount: t.checklistItems?.length || 0,
                    allowProducts: t.allowProducts,
                    allowAdditionalWork: t.allowAdditionalWork,
                    hasDriftSchedule: t.hasDriftSchedule
                }))
            });
            
            populateEquipmentTypeSelect();
            showFeedback('✅ Templates lastet fra database', 'success');
            
        } catch (error) {
            console.error('❌ Error loading templates:', error);
            showFeedback('❌ Kunne ikke laste templates fra database', 'error');
        }
    }

    // ===== POPULATE DROPDOWN =====
    function populateEquipmentTypeSelect() {
        equipmentTypeSelect.innerHTML = '<option value="">-- Velg anleggstype --</option>';
        checklistTemplates.facilityTypes.forEach(type => {
            const option = document.createElement('option');
            option.value = type.id;
            option.textContent = type.name;
            equipmentTypeSelect.appendChild(option);
        });
    }

    // ===== RENDER CONFIG =====
    function renderChecklistConfig() {
        if (!currentFacilityType) {
            checklistConfigDiv.style.display = 'none';
            return;
        }

        checklistConfigDiv.style.display = 'block';

        // System fields (read-only)
        systemFieldsDisplay.innerHTML = '';
        if (currentFacilityType.systemFields && currentFacilityType.systemFields.length > 0) {
            currentFacilityType.systemFields.forEach(field => {
                const div = document.createElement('div');
                div.classList.add('form-group');
                div.innerHTML = `
                    <label>${field.label}${field.required ? ' *' : ''}</label>
                    <input type="text" value="${field.name}" readonly class="form-control" style="background: #f0f0f0;">
                    <small style="color: #666;">Systemfelter håndteres i anleggs-tabellen</small>
                `;
                systemFieldsDisplay.appendChild(div);
            });
        } else {
            systemFieldsDisplay.innerHTML = '<p style="color: #666;">Ingen systemfelter (håndteres i anleggs-tabellen)</p>';
        }

        // Checklist items
        renderChecklistItems();

        // Checkboxes
        allowProductsCheckbox.checked = currentFacilityType.allowProducts || false;
        allowAdditionalWorkCheckbox.checked = currentFacilityType.allowAdditionalWork || false;
        allowCommentsCheckbox.checked = currentFacilityType.allowComments || false;
        hasDriftScheduleCheckbox.checked = currentFacilityType.hasDriftSchedule || false;
        
        // Show/hide drift schedule
        if (driftScheduleSection) {
            driftScheduleSection.style.display = currentFacilityType.hasDriftSchedule ? 'block' : 'none';
        }
    }

    // ===== RENDER CHECKLIST ITEMS WITH INSTRUCTION BUTTONS =====
    function renderChecklistItems() {
        if (!currentFacilityType || !currentFacilityType.checklistItems) {
            checklistItemsContainer.innerHTML = '<p>Ingen sjekkpunkter konfigurert.</p>';
            return;
        }

        checklistItemsContainer.innerHTML = '';
        currentFacilityType.checklistItems.sort((a, b) => a.order - b.order).forEach(item => {
            const div = document.createElement('div');
            div.classList.add('checklist-item');
            div.dataset.itemId = item.id;
            
            div.innerHTML = `
                <div class="drag-handle">⋮⋮</div>
                <input type="text" value="${item.label}" data-field="label" class="form-control" readonly style="background: #f9f9f9;">
                <select data-field="inputType" class="form-control" disabled style="background: #f9f9f9;">
                    <option value="${item.inputType}" selected>${item.inputType}</option>
                </select>
                <button type="button" class="instruction-btn" data-item-id="${item.id}" title="Rediger instruksjon">
                    <span class="instruction-icon">ℹ️</span>
                </button>
                <span style="color: #666; font-size: 12px;">(Read-only)</span>
            `;
            
            checklistItemsContainer.appendChild(div);
        });

        // Attach instruction button handlers
        attachInstructionButtonHandlers();
        
        // Load instruction states (check which items have instructions)
        loadInstructionStates();
    }

    // ===== ATTACH INSTRUCTION BUTTON HANDLERS =====
    function attachInstructionButtonHandlers() {
        const instructionBtns = document.querySelectorAll('.instruction-btn');
        instructionBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const itemId = btn.dataset.itemId;
                const item = currentFacilityType.checklistItems.find(i => i.id === itemId);
                if (item) {
                    openInstructionModal(item);
                }
            });
        });
    }

    // ===== LOAD INSTRUCTION STATES (SHOW BLUE IF HAS INSTRUCTION) =====
    async function loadInstructionStates() {
        if (!currentFacilityType) return;

        try {
            const response = await fetch(`/api/checklist-instructions/${currentFacilityType.name}`);
            if (response.ok) {
                const data = await response.json();
                const instructions = data.instructions || [];
                
                instructions.forEach(instruction => {
                    const btn = document.querySelector(`.instruction-btn[data-item-id="${instruction.checklist_item_id}"]`);
                    if (btn) {
                        btn.classList.add('has-instruction');
                    }
                });
            }
        } catch (error) {
            console.error('Error loading instruction states:', error);
        }
    }

    // ===== OPEN INSTRUCTION MODAL =====
    async function openInstructionModal(item) {
        currentInstructionItem = item;
        instructionItemLabel.value = item.label;
        instructionTextarea.value = '';
        deleteInstructionBtn.style.display = 'none';

        // Try to load existing instruction
        try {
            const response = await fetch(`/api/checklist-instructions/${currentFacilityType.name}/${item.id}`);
            if (response.ok) {
                const data = await response.json();
                instructionTextarea.value = data.instruction || '';
                deleteInstructionBtn.style.display = 'inline-block';
            }
        } catch (error) {
            console.log('No existing instruction found');
        }

        instructionModal.classList.add('show');
    }

    // ===== CLOSE INSTRUCTION MODAL =====
    function closeInstructionModal() {
        instructionModal.classList.remove('show');
        currentInstructionItem = null;
    }

    // ===== SAVE INSTRUCTION =====
    async function saveInstruction() {
        if (!currentInstructionItem) return;

        const instructionText = instructionTextarea.value.trim();
        if (!instructionText) {
            alert('Skriv inn en instruksjon');
            return;
        }

        try {
            const response = await fetch(`/api/checklist-instructions/${currentFacilityType.name}/${currentInstructionItem.id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ instructionText })
            });

            if (response.ok) {
                showFeedback('✅ Instruksjon lagret', 'success');
                
                // Mark button as having instruction
                const btn = document.querySelector(`.instruction-btn[data-item-id="${currentInstructionItem.id}"]`);
                if (btn) {
                    btn.classList.add('has-instruction');
                }
                
                closeInstructionModal();
            } else {
                throw new Error('Failed to save instruction');
            }
        } catch (error) {
            console.error('Error saving instruction:', error);
            showFeedback('❌ Kunne ikke lagre instruksjon', 'error');
        }
    }

    // ===== DELETE INSTRUCTION =====
    async function deleteInstruction() {
        if (!currentInstructionItem) return;

        if (!confirm('Er du sikker på at du vil slette denne instruksjonen?')) {
            return;
        }

        try {
            const response = await fetch(`/api/checklist-instructions/${currentFacilityType.name}/${currentInstructionItem.id}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                showFeedback('✅ Instruksjon slettet', 'success');
                
                // Remove blue marking
                const btn = document.querySelector(`.instruction-btn[data-item-id="${currentInstructionItem.id}"]`);
                if (btn) {
                    btn.classList.remove('has-instruction');
                }
                
                closeInstructionModal();
            } else {
                throw new Error('Failed to delete instruction');
            }
        } catch (error) {
            console.error('Error deleting instruction:', error);
            showFeedback('❌ Kunne ikke slette instruksjon', 'error');
        }
    }

    // ===== SAVE TEMPLATES TO DATABASE =====
    async function saveChecklistTemplates() {
        console.log('💾 Lagrer templates til database...');
        
        try {
            const response = await fetch('/api/checklist-templates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ facilityTypes: checklistTemplates.facilityTypes })
            });

            if (response.ok) {
                console.log('✅ Templates lagret til database');
                showFeedback('✅ Sjekkliste lagret i database', 'success');
            } else {
                throw new Error('Failed to save templates');
            }
        } catch (error) {
            console.error('❌ Error saving templates:', error);
            showFeedback('❌ Kunne ikke lagre til database', 'error');
        }
    }

    // ===== FEEDBACK TOAST =====
    function showFeedback(message, type) {
        const existing = document.getElementById('feedback-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.id = 'feedback-toast';
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 16px 24px;
            background: ${type === 'success' ? '#10b981' : '#ef4444'};
            color: white;
            border-radius: 8px;
            font-weight: 600;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 10000;
            animation: slideIn 0.3s ease;
        `;

        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // ===== EVENT LISTENERS =====
    equipmentTypeSelect.addEventListener('change', (e) => {
        const selectedId = e.target.value;
        currentFacilityType = checklistTemplates.facilityTypes.find(t => t.id === selectedId);
        
        console.log('📋 Valgt type:', currentFacilityType?.name);
        console.log('Data fra database:', {
            systemFields: currentFacilityType?.systemFields?.length || 0,
            checklistItems: currentFacilityType?.checklistItems?.length || 0,
            allowProducts: currentFacilityType?.allowProducts,
            allowAdditionalWork: currentFacilityType?.allowAdditionalWork
        });
        
        renderChecklistConfig();
    });

    allowProductsCheckbox.addEventListener('change', (e) => {
        if (currentFacilityType) {
            currentFacilityType.allowProducts = e.target.checked;
            console.log('✏️ allowProducts endret til:', e.target.checked);
        }
    });

    allowAdditionalWorkCheckbox.addEventListener('change', (e) => {
        if (currentFacilityType) {
            currentFacilityType.allowAdditionalWork = e.target.checked;
            console.log('✏️ allowAdditionalWork endret til:', e.target.checked);
        }
    });

    allowCommentsCheckbox.addEventListener('change', (e) => {
        if (currentFacilityType) {
            currentFacilityType.allowComments = e.target.checked;
            console.log('✏️ allowComments endret til:', e.target.checked);
        }
    });

    hasDriftScheduleCheckbox.addEventListener('change', (e) => {
        if (currentFacilityType) {
            currentFacilityType.hasDriftSchedule = e.target.checked;
            console.log('✏️ hasDriftSchedule endret til:', e.target.checked);
            
            if (driftScheduleSection) {
                driftScheduleSection.style.display = e.target.checked ? 'block' : 'none';
            }
        }
    });

    saveChecklistBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        await saveChecklistTemplates();
    });

    // Instruction modal handlers
    saveInstructionBtn.addEventListener('click', saveInstruction);
    deleteInstructionBtn.addEventListener('click', deleteInstruction);

    // Close modal handlers
    instructionModal.querySelectorAll('.cancel-btn, .modal-close-btn').forEach(btn => {
        btn.addEventListener('click', closeInstructionModal);
    });

    instructionModal.addEventListener('click', (e) => {
        if (e.target === instructionModal) {
            closeInstructionModal();
        }
    });

    // ===== INITIALIZE =====
    console.log('🔄 Starter innlasting av templates fra database...');
    await fetchChecklistTemplates();
    console.log('✅ Serviceoppsett klar!');
});

// ===== CSS ANIMATIONS =====
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);
