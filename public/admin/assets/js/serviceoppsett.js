// ============================================================
// SERVICEOPPSETT.JS v1.1
// - Full CRUD for servicetyper, systemfelter og sjekkpunkter
// - Drag-and-drop for rekkefølge
// - Custom dropdown-alternativer
// - Instruksjoner på sjekkpunkter
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 Serviceoppsett v1.1 initialiserer...');

    // ===== ELEMENT REFERENCES =====
    const equipmentTypeSelect = document.getElementById('equipment-type-select');
    const checklistConfigDiv = document.getElementById('checklist-config');
    const systemFieldsDisplay = document.getElementById('system-fields-display');
    const checklistItemsContainer = document.getElementById('checklist-items-container');
    const allowProductsCheckbox = document.getElementById('allow-products');
    const allowAdditionalWorkCheckbox = document.getElementById('allow-additional-work');
    const allowCommentsCheckbox = document.getElementById('allow-comments');
    const hasDriftScheduleCheckbox = document.getElementById('has-drift-schedule');
    const driftScheduleSection = document.getElementById('drift-schedule-config');
    const saveChecklistBtn = document.getElementById('save-checklist-btn');

    // Hovedknapper
    const addNewFacilityBtn = document.getElementById('add-new-facility-btn');
    const editSystemFieldsBtn = document.getElementById('edit-system-fields-btn');
    const addChecklistItemBtn = document.getElementById('add-checklist-item-btn');

    // Ny type modal
    const newFacilityModal = document.getElementById('new-facility-modal');
    const newFacilityName = document.getElementById('new-facility-name');
    const copyFromSelect = document.getElementById('copy-from-select');
    const newFacilitySystemFieldsContainer = document.getElementById('new-facility-system-fields-container');
    const addNewSystemFieldBtn = document.getElementById('add-new-system-field-btn');
    const saveNewFacilityBtn = document.getElementById('save-new-facility-btn');

    // Systemfelter modal
    const systemFieldsModal = document.getElementById('system-fields-modal');
    const systemFieldsModalBody = document.getElementById('system-fields-modal-body');
    const saveSystemFieldsBtn = document.getElementById('save-system-fields-btn');

    // Sjekkpunkt modal
    const checklistItemModal = document.getElementById('checklist-item-modal');
    const checklistItemLabelInput = document.getElementById('checklist-item-label');
    const checklistItemTypeSelect = document.getElementById('checklist-item-type');
    const dropdownOptionsSection = document.getElementById('dropdown-options-section');
    const dropdownOptionsTextarea = document.getElementById('dropdown-options-textarea');
    const saveChecklistItemBtn = document.getElementById('save-checklist-item-btn');

    // Instruksjons modal
    const instructionModal = document.getElementById('instruction-modal');
    const instructionItemLabel = document.getElementById('instruction-item-label');
    const instructionTextarea = document.getElementById('instruction-text');
    const saveInstructionBtn = document.getElementById('save-instruction-btn');
    const deleteInstructionBtn = document.getElementById('delete-instruction-btn');

    // ===== STATE =====
    let checklistTemplates = { facilityTypes: [] };
    let currentFacilityType = null;
    let currentEditingItem = null;
    let currentInstructionItem = null;
    let draggedItem = null;

    // ===== INPUT TYPES =====
    const DROPDOWN_TYPES = ['dropdown', 'dropdown_ok_avvik', 'dropdown_ok_avvik_comment'];

    // ============================================================
    // DATABASE OPERASJONER
    // ============================================================

    async function fetchChecklistTemplates() {
        console.log('📥 Henter templates fra database...');
        try {
            const response = await fetch('/api/checklist-templates');
            if (!response.ok) throw new Error('Could not fetch checklist templates');

            const data = await response.json();
            checklistTemplates.facilityTypes = data.facilityTypes || [];

            console.log('✅ Templates lastet:', checklistTemplates.facilityTypes.length, 'typer');
            populateEquipmentTypeSelect();
            showFeedback('✅ Templates lastet fra database', 'success');
        } catch (error) {
            console.error('❌ Error loading templates:', error);
            showFeedback('❌ Kunne ikke laste templates', 'error');
        }
    }

    async function saveChecklistTemplates() {
        console.log('💾 Lagrer templates til database...');
        try {
            const response = await fetch('/api/checklist-templates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ facilityTypes: checklistTemplates.facilityTypes })
            });

            if (response.ok) {
                console.log('✅ Templates lagret');
                showFeedback('✅ Sjekkliste lagret i database', 'success');
            } else {
                throw new Error('Failed to save');
            }
        } catch (error) {
            console.error('❌ Error saving:', error);
            showFeedback('❌ Kunne ikke lagre', 'error');
        }
    }

    // ============================================================
    // HJELPEFUNKSJONER
    // ============================================================

    function populateEquipmentTypeSelect() {
        equipmentTypeSelect.innerHTML = '<option value="">-- Velg anleggstype --</option>';
        checklistTemplates.facilityTypes.forEach(type => {
            const option = document.createElement('option');
            option.value = type.id;
            option.textContent = type.name;
            equipmentTypeSelect.appendChild(option);
        });
    }

    function generateId(name) {
        return name.toLowerCase()
            .replace(/[æ]/g, 'ae')
            .replace(/[ø]/g, 'o')
            .replace(/[å]/g, 'a')
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_|_$/g, '');
    }

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

    // ============================================================
    // RENDER HOVEDSIDE
    // ============================================================

    function renderChecklistConfig() {
        if (!currentFacilityType) {
            checklistConfigDiv.style.display = 'none';
            return;
        }

        checklistConfigDiv.style.display = 'block';

        // System fields (read-only visning)
        systemFieldsDisplay.innerHTML = '';
        if (currentFacilityType.systemFields?.length > 0) {
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
            systemFieldsDisplay.innerHTML = '<p style="color: #666;">Ingen systemfelter definert</p>';
        }

        // Checkboxes
        allowProductsCheckbox.checked = currentFacilityType.allowProducts || false;
        allowAdditionalWorkCheckbox.checked = currentFacilityType.allowAdditionalWork || false;
        allowCommentsCheckbox.checked = currentFacilityType.allowComments || false;
        hasDriftScheduleCheckbox.checked = currentFacilityType.hasDriftSchedule || false;

        if (driftScheduleSection) {
            driftScheduleSection.style.display = currentFacilityType.hasDriftSchedule ? 'block' : 'none';
        }

        // Sjekkpunkter
        renderChecklistItems();
    }

    function renderChecklistItems() {
        if (!currentFacilityType?.checklistItems) {
            checklistItemsContainer.innerHTML = '<p style="color: #666;">Ingen sjekkpunkter konfigurert. Klikk "+ Legg til sjekkpunkt" for å starte.</p>';
            return;
        }

        checklistItemsContainer.innerHTML = '';

        currentFacilityType.checklistItems
            .sort((a, b) => (a.order || 0) - (b.order || 0))
            .forEach((item, index) => {
                const div = document.createElement('div');
                div.classList.add('checklist-item');
                div.dataset.itemId = item.id;
                div.dataset.order = item.order || index;
                div.draggable = true;

                div.innerHTML = `
                    <div class="drag-handle" title="Dra for å endre rekkefølge">⋮⋮</div>
                    <span class="item-label-text" style="flex-grow: 1; padding: 8px 12px;">${item.label}</span>
                    <span class="item-type-badge">${item.inputType}</span>
                    <button type="button" class="instruction-btn" data-item-id="${item.id}" title="Instruksjon">
                        <span class="instruction-icon">ℹ️</span>
                    </button>
                    <button type="button" class="edit-item-btn" data-item-id="${item.id}" title="Rediger">✏️</button>
                `;

                // Styling
                div.style.cssText = 'cursor: pointer; display: flex; align-items: center; gap: 8px;';
                div.querySelector('.item-type-badge').style.cssText = 'background: #e5e7eb; padding: 4px 8px; border-radius: 4px; font-size: 11px; color: #666;';
                div.querySelector('.edit-item-btn').style.cssText = 'background: none; border: none; cursor: pointer; font-size: 16px; padding: 4px 8px;';

                // Event: Klikk for å redigere
                div.addEventListener('click', (e) => {
                    if (!e.target.closest('button')) {
                        openChecklistItemModal(item);
                    }
                });

                // Event: Edit-knapp
                div.querySelector('.edit-item-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    openChecklistItemModal(item);
                });

                // Drag events
                div.addEventListener('dragstart', handleDragStart);
                div.addEventListener('dragover', handleDragOver);
                div.addEventListener('drop', handleDrop);
                div.addEventListener('dragend', handleDragEnd);

                checklistItemsContainer.appendChild(div);
            });

        // Instruksjonsknapper og states
        attachInstructionButtonHandlers();
        loadInstructionStates();
    }

    // ============================================================
    // DRAG AND DROP
    // ============================================================

    function handleDragStart(e) {
        draggedItem = e.target.closest('.checklist-item');
        draggedItem.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
    }

    function handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        const target = e.target.closest('.checklist-item');
        if (target && target !== draggedItem) {
            const rect = target.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;

            if (e.clientY < midY) {
                target.parentNode.insertBefore(draggedItem, target);
            } else {
                target.parentNode.insertBefore(draggedItem, target.nextSibling);
            }
        }
    }

    function handleDrop(e) {
        e.preventDefault();
        updateItemOrder();
    }

    function handleDragEnd(e) {
        if (draggedItem) {
            draggedItem.classList.remove('dragging');
            draggedItem = null;
        }
    }

    function updateItemOrder() {
        const items = checklistItemsContainer.querySelectorAll('.checklist-item');
        items.forEach((div, index) => {
            const itemId = div.dataset.itemId;
            const item = currentFacilityType.checklistItems.find(i => i.id === itemId);
            if (item) {
                item.order = index + 1;
            }
        });
        console.log('📋 Rekkefølge oppdatert');
        showFeedback('📋 Rekkefølge endret - husk å lagre!', 'success');
    }

    // ============================================================
    // NY SERVICETYPE
    // ============================================================

    function openNewFacilityModal() {
        newFacilityName.value = '';
        newFacilitySystemFieldsContainer.innerHTML = '';

        // Populate copy-from dropdown
        copyFromSelect.innerHTML = '<option value="">-- Start fra scratch --</option>';
        checklistTemplates.facilityTypes.forEach(type => {
            const option = document.createElement('option');
            option.value = type.id;
            option.textContent = type.name;
            copyFromSelect.appendChild(option);
        });

        newFacilityModal.classList.add('show');
    }

    function closeNewFacilityModal() {
        newFacilityModal.classList.remove('show');
    }

    function addSystemFieldRowToContainer(container, field = null) {
        const row = document.createElement('div');
        row.classList.add('modal-system-field-item');
        row.innerHTML = `
            <span class="drag-handle">⋮⋮</span>
            <input type="text" placeholder="Feltnavn (f.eks. system_nummer)" value="${field?.name || ''}" data-field="name" class="form-control" style="flex: 1;">
            <input type="text" placeholder="Visningsnavn (f.eks. System Nr.)" value="${field?.label || ''}" data-field="label" class="form-control" style="flex: 1;">
            <label style="display: flex; align-items: center; gap: 4px; white-space: nowrap;">
                <input type="checkbox" ${field?.required ? 'checked' : ''} data-field="required">
                Påkrevd
            </label>
            <button type="button" class="remove-field-btn" title="Fjern">🗑️</button>
        `;
        row.style.cssText = 'display: flex; align-items: center; gap: 10px; padding: 10px; border: 1px solid #e5e7eb; border-radius: 6px; margin-bottom: 8px; background: #f9fafb;';
        row.querySelector('.remove-field-btn').style.cssText = 'background: none; border: none; cursor: pointer; font-size: 16px; color: #dc3545;';
        row.querySelector('.remove-field-btn').addEventListener('click', () => row.remove());
        container.appendChild(row);
    }

    function saveNewFacilityType() {
        const name = newFacilityName.value.trim();
        if (!name) {
            alert('Skriv inn navn på servicetype');
            return;
        }

        const id = generateId(name);

        if (checklistTemplates.facilityTypes.some(t => t.id === id)) {
            alert('En type med dette navnet eksisterer allerede');
            return;
        }

        // Collect system fields
        const systemFields = [];
        newFacilitySystemFieldsContainer.querySelectorAll('.modal-system-field-item').forEach((row, index) => {
            const nameVal = row.querySelector('[data-field="name"]').value.trim();
            const labelVal = row.querySelector('[data-field="label"]').value.trim();
            const required = row.querySelector('[data-field="required"]').checked;

            if (nameVal && labelVal) {
                systemFields.push({ name: nameVal, label: labelVal, required, order: index + 1 });
            }
        });

        const newType = {
            id,
            name,
            systemFields,
            checklistItems: [],
            allowProducts: true,
            allowAdditionalWork: true,
            allowComments: true,
            hasDriftSchedule: false
        };

        checklistTemplates.facilityTypes.push(newType);
        populateEquipmentTypeSelect();
        equipmentTypeSelect.value = id;
        currentFacilityType = newType;
        renderChecklistConfig();

        closeNewFacilityModal();
        showFeedback('✅ Ny servicetype opprettet! Husk å lagre.', 'success');
    }

    // ============================================================
    // REDIGER SYSTEMFELTER
    // ============================================================

    function openSystemFieldsModal() {
        if (!currentFacilityType) {
            alert('Velg først en anleggstype');
            return;
        }

        systemFieldsModalBody.innerHTML = '';

        (currentFacilityType.systemFields || []).forEach(field => {
            addSystemFieldRowToContainer(systemFieldsModalBody, field);
        });

        // Legg til-knapp
        const addBtn = document.createElement('button');
        addBtn.className = 'add-field-btn';
        addBtn.textContent = '+ Legg til felt';
        addBtn.style.cssText = 'background: #28a745; color: white; padding: 8px 16px; border: none; border-radius: 6px; cursor: pointer; margin-top: 10px;';
        addBtn.addEventListener('click', () => {
            addSystemFieldRowToContainer(systemFieldsModalBody);
            systemFieldsModalBody.appendChild(addBtn);
        });
        systemFieldsModalBody.appendChild(addBtn);

        systemFieldsModal.classList.add('show');
    }

    function closeSystemFieldsModal() {
        systemFieldsModal.classList.remove('show');
    }

    function saveSystemFields() {
        if (!currentFacilityType) return;

        const systemFields = [];
        systemFieldsModalBody.querySelectorAll('.modal-system-field-item').forEach((row, index) => {
            const nameVal = row.querySelector('[data-field="name"]')?.value.trim();
            const labelVal = row.querySelector('[data-field="label"]')?.value.trim();
            const required = row.querySelector('[data-field="required"]')?.checked || false;

            if (nameVal && labelVal) {
                systemFields.push({ name: nameVal, label: labelVal, required, order: index + 1 });
            }
        });

        currentFacilityType.systemFields = systemFields;
        renderChecklistConfig();
        closeSystemFieldsModal();
        showFeedback('✅ Systemfelter oppdatert! Husk å lagre.', 'success');
    }

    // ============================================================
    // SJEKKPUNKT CRUD
    // ============================================================

    function openChecklistItemModal(item = null) {
        currentEditingItem = item;

        // Reset form
        checklistItemLabelInput.value = item?.label || '';
        checklistItemTypeSelect.value = item?.inputType || 'ok_avvik';
        dropdownOptionsTextarea.value = (item?.dropdownOptions || []).join('\n');

        // Vis/skjul dropdown-options
        const needsOptions = DROPDOWN_TYPES.includes(checklistItemTypeSelect.value);
        dropdownOptionsSection.style.display = needsOptions ? 'block' : 'none';

        // Modal tittel
        const modalTitle = checklistItemModal.querySelector('.modal-header h3');
        modalTitle.textContent = item ? 'Rediger sjekkpunkt' : 'Legg til sjekkpunkt';

        // Vis/skjul slett-knapp
        let deleteBtn = checklistItemModal.querySelector('.delete-item-btn');
        if (item) {
            if (!deleteBtn) {
                deleteBtn = document.createElement('button');
                deleteBtn.className = 'delete-item-btn';
                deleteBtn.textContent = '🗑️ Slett sjekkpunkt';
                deleteBtn.style.cssText = 'background: #dc3545; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; margin-right: auto;';
                deleteBtn.addEventListener('click', deleteChecklistItem);
                checklistItemModal.querySelector('.modal-footer').prepend(deleteBtn);
            }
            deleteBtn.style.display = 'inline-block';
        } else if (deleteBtn) {
            deleteBtn.style.display = 'none';
        }

        checklistItemModal.classList.add('show');
    }

    function closeChecklistItemModal() {
        checklistItemModal.classList.remove('show');
        currentEditingItem = null;
    }

    function saveChecklistItem() {
        if (!currentFacilityType) return;

        const label = checklistItemLabelInput.value.trim();
        const inputType = checklistItemTypeSelect.value;

        if (!label) {
            alert('Skriv inn navn på sjekkpunkt');
            return;
        }

        // Hent dropdown-options hvis relevant
        let dropdownOptions = null;
        if (DROPDOWN_TYPES.includes(inputType)) {
            const options = dropdownOptionsTextarea.value
                .split('\n')
                .map(o => o.trim())
                .filter(o => o);
            if (options.length > 0) {
                dropdownOptions = options;
            }
        }

        if (!currentFacilityType.checklistItems) {
            currentFacilityType.checklistItems = [];
        }

        if (currentEditingItem) {
            // Oppdater eksisterende
            const item = currentFacilityType.checklistItems.find(i => i.id === currentEditingItem.id);
            if (item) {
                item.label = label;
                item.inputType = inputType;
                if (dropdownOptions) {
                    item.dropdownOptions = dropdownOptions;
                } else {
                    delete item.dropdownOptions;
                }
            }
            showFeedback('✅ Sjekkpunkt oppdatert!', 'success');
        } else {
            // Opprett ny
            const maxOrder = Math.max(0, ...currentFacilityType.checklistItems.map(i => i.order || 0));
            const newItem = {
                id: `item_${Date.now()}`,
                label,
                inputType,
                order: maxOrder + 1
            };
            if (dropdownOptions) {
                newItem.dropdownOptions = dropdownOptions;
            }
            currentFacilityType.checklistItems.push(newItem);
            showFeedback('✅ Sjekkpunkt lagt til!', 'success');
        }

        renderChecklistItems();
        closeChecklistItemModal();
    }

    function deleteChecklistItem() {
        if (!currentEditingItem || !currentFacilityType) return;

        if (!confirm(`Er du sikker på at du vil slette "${currentEditingItem.label}"?`)) return;

        currentFacilityType.checklistItems = currentFacilityType.checklistItems.filter(
            i => i.id !== currentEditingItem.id
        );

        renderChecklistItems();
        closeChecklistItemModal();
        showFeedback('✅ Sjekkpunkt slettet!', 'success');
    }

    // ============================================================
    // INSTRUKSJONER
    // ============================================================

    function attachInstructionButtonHandlers() {
        document.querySelectorAll('.instruction-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const itemId = btn.dataset.itemId;
                const item = currentFacilityType.checklistItems.find(i => i.id === itemId);
                if (item) openInstructionModal(item);
            });
        });
    }

    async function loadInstructionStates() {
        if (!currentFacilityType) return;

        try {
            const response = await fetch(`/api/checklist-instructions/${currentFacilityType.name}`);
            if (response.ok) {
                const data = await response.json();
                (data.instructions || []).forEach(instruction => {
                    const btn = document.querySelector(`.instruction-btn[data-item-id="${instruction.checklist_item_id}"]`);
                    if (btn) btn.classList.add('has-instruction');
                });
            }
        } catch (error) {
            console.error('Error loading instruction states:', error);
        }
    }

    async function openInstructionModal(item) {
        currentInstructionItem = item;
        instructionItemLabel.value = item.label;
        instructionTextarea.value = '';
        deleteInstructionBtn.style.display = 'none';

        try {
            const response = await fetch(`/api/checklist-instructions/${currentFacilityType.name}/${item.id}`);
            if (response.ok) {
                const data = await response.json();
                instructionTextarea.value = data.instruction || '';
                deleteInstructionBtn.style.display = 'inline-block';
            }
        } catch (error) {
            console.log('No existing instruction');
        }

        instructionModal.classList.add('show');
    }

    function closeInstructionModal() {
        instructionModal.classList.remove('show');
        currentInstructionItem = null;
    }

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
                const btn = document.querySelector(`.instruction-btn[data-item-id="${currentInstructionItem.id}"]`);
                if (btn) btn.classList.add('has-instruction');
                closeInstructionModal();
            } else {
                throw new Error('Failed to save');
            }
        } catch (error) {
            console.error('Error saving instruction:', error);
            showFeedback('❌ Kunne ikke lagre instruksjon', 'error');
        }
    }

    async function deleteInstruction() {
        if (!currentInstructionItem) return;
        if (!confirm('Er du sikker på at du vil slette denne instruksjonen?')) return;

        try {
            const response = await fetch(`/api/checklist-instructions/${currentFacilityType.name}/${currentInstructionItem.id}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                showFeedback('✅ Instruksjon slettet', 'success');
                const btn = document.querySelector(`.instruction-btn[data-item-id="${currentInstructionItem.id}"]`);
                if (btn) btn.classList.remove('has-instruction');
                closeInstructionModal();
            } else {
                throw new Error('Failed to delete');
            }
        } catch (error) {
            console.error('Error deleting instruction:', error);
            showFeedback('❌ Kunne ikke slette instruksjon', 'error');
        }
    }

    // ============================================================
    // EVENT LISTENERS
    // ============================================================

    // Velg anleggstype
    equipmentTypeSelect.addEventListener('change', (e) => {
        currentFacilityType = checklistTemplates.facilityTypes.find(t => t.id === e.target.value);
        console.log('📋 Valgt type:', currentFacilityType?.name);
        renderChecklistConfig();
    });

    // Toggles
    allowProductsCheckbox.addEventListener('change', (e) => {
        if (currentFacilityType) currentFacilityType.allowProducts = e.target.checked;
    });
    allowAdditionalWorkCheckbox.addEventListener('change', (e) => {
        if (currentFacilityType) currentFacilityType.allowAdditionalWork = e.target.checked;
    });
    allowCommentsCheckbox.addEventListener('change', (e) => {
        if (currentFacilityType) currentFacilityType.allowComments = e.target.checked;
    });
    hasDriftScheduleCheckbox.addEventListener('change', (e) => {
        if (currentFacilityType) {
            currentFacilityType.hasDriftSchedule = e.target.checked;
            if (driftScheduleSection) {
                driftScheduleSection.style.display = e.target.checked ? 'block' : 'none';
            }
        }
    });

    // Lagre
    saveChecklistBtn.addEventListener('click', (e) => {
        e.preventDefault();
        saveChecklistTemplates();
    });

    // Ny type modal
    addNewFacilityBtn.addEventListener('click', openNewFacilityModal);
    addNewSystemFieldBtn.addEventListener('click', () => addSystemFieldRowToContainer(newFacilitySystemFieldsContainer));
    saveNewFacilityBtn.addEventListener('click', saveNewFacilityType);
    copyFromSelect.addEventListener('change', (e) => {
        newFacilitySystemFieldsContainer.innerHTML = '';
        if (e.target.value) {
            const sourceType = checklistTemplates.facilityTypes.find(t => t.id === e.target.value);
            (sourceType?.systemFields || []).forEach(field => {
                addSystemFieldRowToContainer(newFacilitySystemFieldsContainer, field);
            });
        }
    });
    newFacilityModal.querySelectorAll('.cancel-btn, .modal-close-btn').forEach(btn => {
        btn.addEventListener('click', closeNewFacilityModal);
    });
    newFacilityModal.addEventListener('click', (e) => {
        if (e.target === newFacilityModal) closeNewFacilityModal();
    });

    // Systemfelter modal
    editSystemFieldsBtn.addEventListener('click', openSystemFieldsModal);
    saveSystemFieldsBtn.addEventListener('click', saveSystemFields);
    systemFieldsModal.querySelectorAll('.cancel-btn, .modal-close-btn').forEach(btn => {
        btn.addEventListener('click', closeSystemFieldsModal);
    });
    systemFieldsModal.addEventListener('click', (e) => {
        if (e.target === systemFieldsModal) closeSystemFieldsModal();
    });

    // Sjekkpunkt modal
    addChecklistItemBtn.addEventListener('click', () => openChecklistItemModal(null));
    saveChecklistItemBtn.addEventListener('click', saveChecklistItem);
    checklistItemTypeSelect.addEventListener('change', (e) => {
        dropdownOptionsSection.style.display = DROPDOWN_TYPES.includes(e.target.value) ? 'block' : 'none';
    });
    checklistItemModal.querySelectorAll('.cancel-btn, .modal-close-btn').forEach(btn => {
        btn.addEventListener('click', closeChecklistItemModal);
    });
    checklistItemModal.addEventListener('click', (e) => {
        if (e.target === checklistItemModal) closeChecklistItemModal();
    });

    // Instruksjon modal
    saveInstructionBtn.addEventListener('click', saveInstruction);
    deleteInstructionBtn.addEventListener('click', deleteInstruction);
    instructionModal.querySelectorAll('.cancel-btn, .modal-close-btn').forEach(btn => {
        btn.addEventListener('click', closeInstructionModal);
    });
    instructionModal.addEventListener('click', (e) => {
        if (e.target === instructionModal) closeInstructionModal();
    });

    // ============================================================
    // INITIALIZE
    // ============================================================

    console.log('🔄 Laster templates fra database...');
    await fetchChecklistTemplates();
    console.log('✅ Serviceoppsett v1.1 klar!');
});

// ===== CSS ANIMATIONS =====
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(400px); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(400px); opacity: 0; }
    }
    .checklist-item.dragging {
        opacity: 0.5;
        border: 2px dashed #3b82f6 !important;
    }
`;
document.head.appendChild(style);
