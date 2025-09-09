document.addEventListener('DOMContentLoaded', async () => {
    const equipmentTypeSelect = document.getElementById('equipment-type-select');
    const checklistConfigDiv = document.getElementById('checklist-config');
    const systemFieldsDisplay = document.getElementById('system-fields-display');
    const checklistItemsContainer = document.getElementById('checklist-items-container');
    const allowProductsCheckbox = document.getElementById('allow-products');
    const allowAdditionalWorkCheckbox = document.getElementById('allow-additional-work');
    const allowCommentsCheckbox = document.getElementById('allow-comments');
    const addChecklistItemBtn = document.getElementById('add-checklist-item-btn');
    const saveChecklistBtn = document.getElementById('save-checklist-btn');
    const editSystemFieldsBtn = document.getElementById('edit-system-fields-btn');

    const systemFieldsModal = document.getElementById('system-fields-modal');
    const systemFieldsModalBody = document.getElementById('system-fields-modal-body');
    const saveSystemFieldsBtn = document.getElementById('save-system-fields-btn');
    const modalCloseBtns = document.querySelectorAll('.modal-close-btn, .cancel-btn');

    const addNewFacilityBtn = document.getElementById('add-new-facility-btn');
    const newFacilityModal = document.getElementById('new-facility-modal');
    const newFacilityNameInput = document.getElementById('new-facility-name');
    const copyFromSelect = document.getElementById('copy-from-select');
    const newFacilitySystemFieldsContainer = document.getElementById('new-facility-system-fields-container');
    const addNewSystemFieldBtn = document.getElementById('add-new-system-field-btn');
    const saveNewFacilityBtn = document.getElementById('save-new-facility-btn');

    // Drift Schedule elements
    const hasDriftScheduleCheckbox = document.getElementById('has-drift-schedule');
    const driftScheduleConfigDiv = document.getElementById('drift-schedule-config');
    const driftScheduleHeader = document.getElementById('drift-schedule-header');
    const driftScheduleBody = document.getElementById('drift-schedule-body');

    // Checklist Item Modal elements
    const checklistItemModal = document.getElementById('checklist-item-modal');
    const checklistItemLabelInput = document.getElementById('checklist-item-label');
    const checklistItemInputTypeSelect = document.getElementById('checklist-item-input-type');
    const dropdownOptionsSection = document.getElementById('dropdown-options-section');
    const dropdownOptionsTextarea = document.getElementById('dropdown-options-textarea');
    const hasSubpointsCheckbox = document.getElementById('has-subpoints-checkbox');
    const subpointsSection = document.getElementById('subpoints-section');
    const subpointsContainer = document.getElementById('subpoints-container');
    const addSubpointBtn = document.getElementById('add-subpoint-btn');
    const saveChecklistItemModalBtn = document.getElementById('save-checklist-item-btn'); // Renamed to avoid conflict

    // Instruction modal elements (legg til etter eksisterende variabler)
    const instructionModal = document.getElementById('instruction-modal');
    const instructionItemLabel = document.getElementById('instruction-item-label');
    const instructionTextArea = document.getElementById('instruction-text');
    const saveInstructionBtn = document.getElementById('save-instruction-btn');
    const deleteInstructionBtn = document.getElementById('delete-instruction-btn');

    let currentInstructionItemId = null;

    let checklistTemplates = { facilityTypes: [] }; // Initialize with the new structure
    let currentFacilityType = null; // Store the entire object, not just the ID
    let editingChecklistItem = null; // To store the item being edited

    // Fetch checklist templates from the backend
    async function fetchChecklistTemplates() {
        try {
            const response = await fetch('/api/checklist-templates');
            if (!response.ok) {
                throw new Error('Could not fetch checklist templates');
            }
            const data = await response.json();
            // Ensure facilityTypes is always an array
            checklistTemplates.facilityTypes = data.facilityTypes || [];
            console.log('Checklist templates loaded:', checklistTemplates);
            populateEquipmentTypeSelect();
        } catch (error) {
            console.error('Error loading checklist templates:', error);
            alert('Failed to load checklist templates.');
        }
    }

    // Save checklist templates to the backend
    async function saveChecklistTemplates() {
        // Update currentFacilityType with latest UI values before saving
        if (currentFacilityType) {
            currentFacilityType.allowProducts = allowProductsCheckbox.checked;
            currentFacilityType.allowAdditionalWork = allowAdditionalWorkCheckbox.checked;
            currentFacilityType.allowComments = allowCommentsCheckbox.checked;
            currentFacilityType.hasDriftSchedule = hasDriftScheduleCheckbox.checked;

            if (currentFacilityType.hasDriftSchedule) {
                const updatedDriftSchedule = { ...currentFacilityType.driftScheduleConfig };
                updatedDriftSchedule.data = {};
                Array.from(driftScheduleBody.children).forEach(row => {
                    const day = row.dataset.day;
                    const startInput = row.querySelector('input[data-field="Start"]');
                    const stopInput = row.querySelector('input[data-field="Stopp"]');
                    updatedDriftSchedule.data[day] = {
                        Start: startInput ? startInput.value : '',
                        Stopp: stopInput ? stopInput.value : ''
                    };
                });
                currentFacilityType.driftScheduleConfig = updatedDriftSchedule;
            }
        }

        try {
            const response = await fetch('/api/checklist-templates', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(checklistTemplates, null, 2) // Pretty print JSON
            });
            if (!response.ok) {
                throw new Error('Could not save checklist templates');
            }
            
        } catch (error) {
            console.error('Error saving checklist templates:', error);
            alert('Failed to save checklist templates.');
        }
    }

    function populateEquipmentTypeSelect() {
        equipmentTypeSelect.innerHTML = '<option value="">-- Velg --</option>';
        copyFromSelect.innerHTML = '<option value="">-- Ingen --</option>';

        checklistTemplates.facilityTypes.forEach(type => {
            const option = document.createElement('option');
            option.value = type.id;
            option.textContent = type.name;
            equipmentTypeSelect.appendChild(option);

            const copyOption = document.createElement('option');
            copyOption.value = type.id;
            copyOption.textContent = type.name;
            copyFromSelect.appendChild(copyOption);
        });
    }

    function renderChecklistConfig() {
        if (!currentFacilityType) {
            checklistConfigDiv.style.display = 'none';
            return;
        }

        checklistConfigDiv.style.display = 'block';

        // Render System Fields (eksisterende kode)
        systemFieldsDisplay.innerHTML = '';
        currentFacilityType.systemFields.sort((a, b) => a.order - b.order).forEach(field => {
            const div = document.createElement('div');
            div.classList.add('form-group');
            div.innerHTML = `
                <label>${field.label}${field.required ? ' *' : ''}</label>
                <input type="text" value="${field.name}" readonly class="form-control">
            `;
            systemFieldsDisplay.appendChild(div);
        });

        // Render Checklist Items med instruksjons-knapper
        renderChecklistItems();

        // Render andre seksjoner (eksisterende kode)
        allowProductsCheckbox.checked = currentFacilityType.allowProducts || false;
        allowAdditionalWorkCheckbox.checked = currentFacilityType.allowAdditionalWork || false;
        allowCommentsCheckbox.checked = currentFacilityType.allowComments || false;
        
        if (typeof renderDriftScheduleConfig === 'function') {
            renderDriftScheduleConfig();
        }
    }

    function renderChecklistItems() {
        if (!currentFacilityType || !currentFacilityType.checklistItems) {
            checklistItemsContainer.innerHTML = '<p>Ingen sjekkpunkter konfigurert.</p>';
            return;
        }

        checklistItemsContainer.innerHTML = '';
        currentFacilityType.checklistItems.sort((a, b) => a.order - b.order).forEach(item => {
            renderSingleChecklistItem(item, checklistItemsContainer, 0);
        });
    }

    function renderSingleChecklistItem(item, container, nestLevel) {
        const div = document.createElement('div');
        div.classList.add('checklist-item');
        if (nestLevel > 0) {
            div.classList.add(`nested-${Math.min(nestLevel, 2)}`);
        }
        div.dataset.itemId = item.id;

        // Sjekk om instruksjon eksisterer
        const hasInstruction = item.hasInstructions || false;

        div.innerHTML = `
            <div class="drag-handle">⋮⋮</div>
            <input type="text" value="${item.label}" data-field="label" class="form-control">
            <select data-field="inputType" class="form-control">
                <option value="ok_avvik" ${item.inputType === 'ok_avvik' ? 'selected' : ''}>OK/Avvik</option>
                <option value="checkbox" ${item.inputType === 'checkbox' ? 'selected' : ''}>Avkrysning</option>
                <option value="number" ${item.inputType === 'number' ? 'selected' : ''}>Tall</option>
                <option value="text" ${item.inputType === 'text' ? 'selected' : ''}>Tekst</option>
                <option value="textarea" ${item.inputType === 'textarea' ? 'selected' : ''}>Tekstområde</option>
                <option value="dropdown" ${item.inputType === 'dropdown' ? 'selected' : ''}>Dropdown</option>
            </select>
            <button class="instruction-btn ${hasInstruction ? 'has-instruction' : ''}" 
                    data-item-id="${item.id}" 
                    title="Rediger instruksjon">
                <i class="instruction-icon">ⓘ</i>
            </button>
            <div class="checklist-item-actions">
                <button class="edit-item-btn" data-item-id="${item.id}" title="Rediger">✏️</button>
                <button class="delete-item-btn" data-item-id="${item.id}" title="Slett">🗑️</button>
            </div>
        `;

        container.appendChild(div);

        // Render subpoints hvis de finnes
        if (item.subpoints && item.subpoints.length > 0) {
            item.subpoints.forEach(subpoint => {
                renderSingleChecklistItem(subpoint, container, nestLevel + 1);
            });
        }
    }

    function addSubpointToggleListeners() {
        checklistItemsContainer.querySelectorAll('.subpoint-toggle').forEach(toggle => {
            toggle.addEventListener('click', (e) => {
                const parentItemDiv = e.target.closest('.checklist-item');
                const subpointsList = parentItemDiv.nextElementSibling; // Assuming subpoints-list is the next sibling
                if (subpointsList && subpointsList.classList.contains('subpoints-list')) {
                    if (subpointsList.style.display === 'none') {
                        subpointsList.style.display = 'block';
                        e.target.textContent = '▼'; // Change arrow to point down
                    } else {
                        subpointsList.style.display = 'none';
                        e.target.textContent = '▶'; // Change arrow to point right
                    }
                }
            });
        });
    }

    function renderDriftScheduleTable() {
        if (currentFacilityType.hasDriftSchedule) {
            driftScheduleConfigDiv.style.display = 'block';
            const config = currentFacilityType.driftScheduleConfig || { days: [], fields: [] };

            // Render header
            driftScheduleHeader.innerHTML = '<th>Dag</th>' + config.fields.map(field => `<th>${field}</th>`).join('');

            // Render body
            driftScheduleBody.innerHTML = '';
            config.days.forEach(day => {
                const row = document.createElement('tr');
                row.dataset.day = day;
                row.innerHTML = `
                    <td>${day}</td>
                    ${config.fields.map(field => `
                        <td><input type="time" data-field="${field}" value="${(config.data && config.data[day] && config.data[day][field]) ? config.data[day][field] : ''}"></td>
                    `).join('')}
                `;
                driftScheduleBody.appendChild(row);
            });
        } else {
            driftScheduleConfigDiv.style.display = 'none';
        }
    }

    function addDragDropListeners() {
        const items = checklistItemsContainer.querySelectorAll('.checklist-item');
        items.forEach(item => {
            item.addEventListener('dragstart', handleDragStart);
            item.addEventListener('dragover', handleDragOver);
            item.addEventListener('drop', handleDrop);
            item.addEventListener('dragend', handleDragEnd);
        });
    }

    let draggedItem = null;

    function handleDragStart(e) {
        draggedItem = this;
        setTimeout(() => this.classList.add('dragging'), 0);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/html', this.innerHTML);
    }

    function handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const target = e.target.closest('.checklist-item');
        if (target && target !== draggedItem) {
            const rect = target.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            if (e.clientY < midY) {
                checklistItemsContainer.insertBefore(draggedItem, target);
            } else {
                checklistItemsContainer.insertBefore(draggedItem, target.nextSibling);
            }
        }
    }

    function handleDrop(e) {
        e.stopPropagation();
    }

    function handleDragEnd(e) {
        this.classList.remove('dragging');
        draggedItem = null;
        updateChecklistItemOrder();
    }

    function updateChecklistItemOrder() {
        // This function needs significant refactoring to handle nested items.
        // For now, it will only reorder top-level items.
        const items = Array.from(checklistItemsContainer.children).filter(el => el.classList.contains('checklist-item') && el.dataset.level === '0');
        currentFacilityType.checklistItems = items.map((item, index) => {
            const itemId = item.dataset.itemId;
            const originalItem = currentFacilityType.checklistItems.find(i => i.id === itemId);
            return { ...originalItem, order: index + 1 };
        });
    }

    function addDeleteListeners() {
        checklistItemsContainer.querySelectorAll('.delete-item-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const itemIdToDelete = e.target.dataset.id;
                // This needs to be updated to handle nested items correctly
                currentFacilityType.checklistItems = 
                    currentFacilityType.checklistItems.filter(item => item.id !== itemIdToDelete);
                renderChecklistConfig(); // Re-render to update the list
            });
        });
    }

    function addInputListeners() {
        checklistItemsContainer.querySelectorAll('input[type="text"], select, textarea').forEach(input => {
            input.addEventListener('change', (e) => {
                const itemId = e.target.dataset.id;
                const field = e.target.dataset.field;
                const value = e.target.value;
                // This needs to be updated to handle nested items correctly
                const item = findChecklistItemById(currentFacilityType.checklistItems, itemId);
                if (item) {
                    if (field === 'dropdownOptions') {
                        const options = value.split('\n').filter(opt => opt.trim());
                        item.dropdownOptions = options;
                    } else {
                        item[field] = value;
                    }
                }
            });
        });
    }

    function addEditChecklistItemListeners() {
        checklistItemsContainer.querySelectorAll('.edit-item-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const itemIdToEdit = e.target.dataset.id;
                editingChecklistItem = findChecklistItemById(currentFacilityType.checklistItems, itemIdToEdit);

                if (editingChecklistItem) {
                    checklistItemLabelInput.value = editingChecklistItem.label;
                    checklistItemInputTypeSelect.value = editingChecklistItem.inputType;

                    // Handle dropdown options visibility
                    const isDropdown = ['dropdown_ok_avvik', 'dropdown_ok_avvik_comment', 'dropdown'].includes(editingChecklistItem.inputType);
                    dropdownOptionsSection.style.display = isDropdown ? 'block' : 'none';
                    dropdownOptionsTextarea.value = isDropdown ? (editingChecklistItem.dropdownOptions || []).join('\n') : '';

                    hasSubpointsCheckbox.checked = editingChecklistItem.subpoints && editingChecklistItem.subpoints.length > 0;
                    subpointsSection.style.display = hasSubpointsCheckbox.checked ? 'block' : 'none';
                    subpointsContainer.innerHTML = '';
                    if (editingChecklistItem.subpoints) {
                        editingChecklistItem.subpoints.forEach(subpoint => {
                            addSubpointToModal(subpoint.label, subpoint.inputType, subpoint.showWhen, subpoint.exclusiveGroup);
                        });
                    }
                    checklistItemModal.classList.add('show');
                }
            });
        });
    }

    function findChecklistItemById(items, id) {
        for (const item of items) {
            if (item.id === id) {
                return item;
            }
            if (item.subpoints && item.subpoints.length > 0) {
                const found = findChecklistItemById(item.subpoints, id);
                if (found) {
                    return found;
                }
            }
        }
        return null;
    }

    addChecklistItemBtn.addEventListener('click', () => {
        editingChecklistItem = null; // Clear any previous editing state
        checklistItemLabelInput.value = '';
        checklistItemInputTypeSelect.value = 'ok_avvik';
        hasSubpointsCheckbox.checked = false;
        subpointsSection.style.display = 'none';
        subpointsContainer.innerHTML = '';
        checklistItemModal.classList.add('show');
    });

    saveChecklistItemModalBtn.addEventListener('click', () => {
        const label = checklistItemLabelInput.value.trim();
        const inputType = checklistItemInputTypeSelect.value;
        const hasSubpoints = hasSubpointsCheckbox.checked;

        if (!label) {
            alert('Sjekkpunkt navn er påkrevd.');
            return;
        }

        const newChecklistItem = {
            id: editingChecklistItem ? editingChecklistItem.id : `item_${Date.now()}`,
            label: label,
            inputType: inputType,
            order: editingChecklistItem ? editingChecklistItem.order : currentFacilityType.checklistItems.length + 1,
            hasSubpoints: hasSubpoints
        };

        if (hasSubpoints) {
            newChecklistItem.subpoints = [];
            Array.from(subpointsContainer.children).forEach((subpointDiv, index) => {
                const subpointLabel = subpointDiv.querySelector('input[data-field-prop="label"]').value.trim();
                const subpointInputType = subpointDiv.querySelector('select[data-field-prop="inputType"]').value;
                const showWhenParentId = subpointDiv.querySelector('input[data-field-prop="showWhenParentId"]').value.trim();
                const showWhenParentValue = subpointDiv.querySelector('input[data-field-prop="showWhenParentValue"]').value.trim();
                const exclusiveGroup = subpointDiv.querySelector('input[data-field-prop="exclusiveGroup"]').value.trim();

                const subpoint = {
                    id: `subitem_${Date.now()}_${index}`,
                    label: subpointLabel,
                    inputType: subpointInputType,
                    order: index + 1
                };

                if (showWhenParentId && showWhenParentValue) {
                    subpoint.showWhen = { parentId: showWhenParentId, parentValue: showWhenParentValue };
                }
                if (exclusiveGroup) {
                    subpoint.exclusiveGroup = exclusiveGroup;
                }

                if (subpointLabel) {
                    newChecklistItem.subpoints.push(subpoint);
                }
            });
        }

        if (editingChecklistItem) {
            // Find and replace the existing item
            // This needs to be recursive to find the item at any level
            replaceChecklistItem(currentFacilityType.checklistItems, newChecklistItem);
        } else {
            currentFacilityType.checklistItems.push(newChecklistItem);
        }

        renderChecklistConfig();
        checklistItemModal.classList.remove('show');
        saveChecklistTemplates();
    });

    function replaceChecklistItem(items, newItem) {
        for (let i = 0; i < items.length; i++) {
            if (items[i].id === newItem.id) {
                items[i] = newItem;
                return true;
            }
            if (items[i].subpoints && items[i].subpoints.length > 0) {
                if (replaceChecklistItem(items[i].subpoints, newItem)) {
                    return true;
                }
            }
        }
        return false;
    }

    hasSubpointsCheckbox.addEventListener('change', (e) => {
        subpointsSection.style.display = e.target.checked ? 'block' : 'none';
    });

    addSubpointBtn.addEventListener('click', () => {
        addSubpointToModal();
    });

    function addSubpointToModal(label = '', inputType = 'ok_avvik', showWhen = null, exclusiveGroup = null) {
        const subpointDiv = document.createElement('div');
        subpointDiv.classList.add('subpoint-item');
        subpointDiv.setAttribute('draggable', 'true');
        subpointDiv.innerHTML = `
            <span class="drag-handle">☰</span>
            <input type="text" value="${label}" data-field-prop="label" placeholder="Underpunkt navn">
            <select data-field-prop="inputType">
                <option value="checkbox" ${inputType === 'checkbox' ? 'selected' : ''}>Checkbox</option>
                <option value="ok_avvik" ${inputType === 'ok_avvik' ? 'selected' : ''}>OK / Avvik</option>
                <option value="ok_byttet_avvik" ${inputType === 'ok_byttet_avvik' ? 'selected' : ''}>OK / Byttet / Avvik</option>
                <option value="numeric" ${inputType === 'numeric' ? 'selected' : ''}>Numerisk</option>
                <option value="text" ${inputType === 'text' ? 'selected' : ''}>Tekst</option>
                <option value="textarea" ${inputType === 'textarea' ? 'selected' : ''}>Langt tekstfelt</option>
                <option value="comment" ${inputType === 'comment' ? 'selected' : ''}>Kommentar</option>
                <option value="group_selection" ${inputType === 'group_selection' ? 'selected' : ''}>Gruppevalg</option>
                <option value="switch_select" ${inputType === 'switch_select' ? 'selected' : ''}>Bryter/Status</option>
                <option value="dropdown_ok_avvik" ${inputType === 'dropdown_ok_avvik' ? 'selected' : ''}>Dropdown + OK/Avvik</option>
                <option value="dropdown_ok_avvik_comment" ${inputType === 'dropdown_ok_avvik_comment' ? 'selected' : ''}>Dropdown + OK/Avvik + Kommentar</option>
                <option value="temperature" ${inputType === 'temperature' ? 'selected' : ''}>Temperatur (°C + OK/Avvik)</option>
                <option value="virkningsgrad" ${inputType === 'virkningsgrad' ? 'selected' : ''}>Virkningsgrad (%)</option>
                <option value="tilstandsgrad_dropdown" ${inputType === 'tilstandsgrad_dropdown' ? 'selected' : ''}>Tilstandsgrad (TG)</option>
                <option value="konsekvensgrad_dropdown" ${inputType === 'konsekvensgrad_dropdown' ? 'selected' : ''}>Konsekvensgrad (KG)</option>
                <option value="multi_checkbox">Multi Checkbox</option>
                <option value="timer">Timer</option>
                <option value="rengjort_ikke_rengjort">Rengjort / Ikke Rengjort</option>
                <option value="image_only">Kun Bilde</option>
                <option value="dropdown">Dropdown</option>
            </select>
            <input type="text" value="${showWhen ? showWhen.parentId : ''}" data-field-prop="showWhenParentId" placeholder="Vis når (Parent ID)">
            <input type="text" value="${showWhen ? showWhen.parentValue : ''}" data-field-prop="showWhenParentValue" placeholder="Vis når (Parent Value)">
            <input type="text" value="${exclusiveGroup || ''}" data-field-prop="exclusiveGroup" placeholder="Eksklusiv gruppe">
            <button class="remove-subpoint-btn">&times;</button>
        `;
        subpointsContainer.appendChild(div);

        subpointDiv.querySelector('.remove-subpoint-btn').addEventListener('click', () => {
            subpointDiv.remove();
        });

        // Add drag and drop listeners for subpoints
        subpointDiv.addEventListener('dragstart', handleSubpointDragStart);
        subpointDiv.addEventListener('dragover', handleSubpointDragOver);
        subpointDiv.addEventListener('drop', handleSubpointDrop);
        subpointDiv.addEventListener('dragend', handleSubpointDragEnd);
    }

    let draggedSubpoint = null;

    function handleSubpointDragStart(e) {
        draggedSubpoint = this;
        setTimeout(() => this.classList.add('dragging'), 0);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/html', this.innerHTML);
    }

    function handleSubpointDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const target = e.target.closest('.subpoint-item');
        if (target && target !== draggedSubpoint) {
            const rect = target.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            if (e.clientY < midY) {
                subpointsContainer.insertBefore(draggedSubpoint, target);
            } else {
                subpointsContainer.insertBefore(draggedSubpoint, target.nextSibling);
            }
        }
    }

    function handleSubpointDrop(e) {
        e.stopPropagation();
    }

    function handleSubpointDragEnd(e) {
        this.classList.remove('dragging');
        draggedSubpoint = null;
        // Order is updated on save, no need to update here
    }

    equipmentTypeSelect.addEventListener('change', (e) => {
        const selectedId = e.target.value;
        currentFacilityType = checklistTemplates.facilityTypes.find(type => type.id === selectedId);
        renderChecklistConfig();
    });

    hasDriftScheduleCheckbox.addEventListener('change', (e) => {
        if (currentFacilityType) {
            currentFacilityType.hasDriftSchedule = e.target.checked;
            // Initialize driftScheduleConfig if enabling for the first time
            if (e.target.checked && !currentFacilityType.driftScheduleConfig) {
                currentFacilityType.driftScheduleConfig = {
                    title: "Driftstider",
                    days: ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag", "Søndag"],
                    fields: ["Start", "Stopp"],
                    data: {} // To store actual time values
                };
            }
            renderDriftScheduleTable();
        }
    });

    allowProductsCheckbox.addEventListener('change', (e) => {
        if (currentFacilityType) {
            currentFacilityType.allowProducts = e.target.checked;
        }
    });

    allowAdditionalWorkCheckbox.addEventListener('change', (e) => {
        if (currentFacilityType) {
            currentFacilityType.allowAdditionalWork = e.target.checked;
        }
    });

    allowCommentsCheckbox.addEventListener('change', (e) => {
        if (currentFacilityType) {
            currentFacilityType.allowComments = e.target.checked;
        }
    });

    saveChecklistBtn.addEventListener('click', saveChecklistTemplates);

    // System Fields Modal Logic
    editSystemFieldsBtn.addEventListener('click', () => {
        if (!currentFacilityType) return;

        systemFieldsModalBody.innerHTML = '';
        currentFacilityType.systemFields.sort((a, b) => a.order - b.order).forEach(field => {
            addSystemFieldToSystemFieldsModal(field.name, field.label, field.required);
        });
        systemFieldsModal.classList.add('show');
    });

    function addSystemFieldToSystemFieldsModal(name = '', label = '', required = false) {
        const fieldId = `sys_field_${Date.now()}`;
        const div = document.createElement('div');
        div.classList.add('modal-system-field-item'); // Use new class
        div.setAttribute('draggable', 'true');
        div.dataset.fieldId = fieldId;
        div.innerHTML = `
            <span class="drag-handle">☰</span>
            <div class="form-group">
                <label>Teknisk navn</label>
                <input type="text" value="${name}" data-field-prop="name" placeholder="f.eks. system_number">
            </div>
            <div class="form-group">
                <label>Visningsnavn</label>
                <input type="text" value="${label}" data-field-prop="label" placeholder="f.eks. System nummer">
            </div>
            <div class="form-group">
                <label>Påkrevd</label>
                <input type="checkbox" ${required ? 'checked' : ''} data-field-prop="required">
            </div>
            <button class="remove-field-btn">&times;</button>
        `;
        systemFieldsModalBody.appendChild(div);

        div.querySelector('.remove-field-btn').addEventListener('click', () => {
            div.remove();
        });

        // Add drag and drop listeners for the new field
        div.addEventListener('dragstart', handleSystemFieldDragStart);
        div.addEventListener('dragover', handleSystemFieldDragOver);
        div.addEventListener('drop', handleSystemFieldDrop);
        div.addEventListener('dragend', handleSystemFieldDragEnd);
    }

    let draggedSystemField = null;

    function handleSystemFieldDragStart(e) {
        draggedSystemField = this;
        setTimeout(() => this.classList.add('dragging'), 0);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/html', this.innerHTML);
    }

    function handleSystemFieldDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const target = e.target.closest('.modal-system-field-item'); // Use new class
        if (target && target !== draggedSystemField) {
            const rect = target.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            if (e.clientY < midY) {
                systemFieldsModalBody.insertBefore(draggedSystemField, target);
            } else {
                systemFieldsModalBody.insertBefore(draggedSystemField, target.nextSibling);
            }
        }
    }

    function handleSystemFieldDrop(e) {
        e.stopPropagation();
    }

    function handleSystemFieldDragEnd(e) {
        this.classList.remove('dragging');
        draggedSystemField = null;
        // Order is updated on save, no need to update here
    }

    saveSystemFieldsBtn.addEventListener('click', () => {
        const updatedSystemFields = [];
        Array.from(systemFieldsModalBody.children).forEach((fieldDiv, index) => {
            const nameInput = fieldDiv.querySelector('input[data-field-prop="name"]');
            const labelInput = fieldDiv.querySelector('input[data-field-prop="label"]');
            const requiredCheckbox = fieldDiv.querySelector('input[data-field-prop="required"]');
            
            const name = nameInput.value.trim();
            const label = labelInput.value.trim();
            const required = requiredCheckbox.checked;

            if (name && label) {
                updatedSystemFields.push({
                    name: name,
                    label: label,
                    required: required,
                    order: index + 1 // Assign new order based on current position
                });
            }
        });
        currentFacilityType.systemFields = updatedSystemFields;
        renderChecklistConfig();
        systemFieldsModal.classList.remove('show');
        saveChecklistTemplates(); // Save changes to JSON
    });

    // Add new system field button inside the modal
    const addSystemFieldToModalBtn = document.createElement('button');
    addSystemFieldToModalBtn.textContent = '+ Legg til felt';
    addSystemFieldToModalBtn.classList.add('add-item-btn');
    addSystemFieldToModalBtn.style.marginTop = '15px';
    addSystemFieldToModalBtn.addEventListener('click', () => {
        addSystemFieldToSystemFieldsModal();
    });
    systemFieldsModalBody.parentNode.insertBefore(addSystemFieldToModalBtn, systemFieldsModalBody.nextSibling);

    modalCloseBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            systemFieldsModal.classList.remove('show');
            newFacilityModal.classList.remove('show');
            checklistItemModal.classList.remove('show');
        });
    });

    // New Facility Type Modal Logic
    addNewFacilityBtn.addEventListener('click', () => {
        newFacilityNameInput.value = '';
        copyFromSelect.value = '';
        newFacilitySystemFieldsContainer.innerHTML = '';
        newFacilityModal.classList.add('show');
    });

    copyFromSelect.addEventListener('change', (e) => {
        const selectedId = e.target.value;
        const sourceType = checklistTemplates.facilityTypes.find(type => type.id === selectedId);
        newFacilitySystemFieldsContainer.innerHTML = '';
        if (sourceType) {
            sourceType.systemFields.forEach(field => {
                addSystemFieldToNewFacilityModal(field.name, field.label, field.required);
            });
        }
    });

    addNewSystemFieldBtn.addEventListener('click', () => {
        addSystemFieldToNewFacilityModal();
    });

    function addSystemFieldToNewFacilityModal(name = '', label = '', required = false) {
        const fieldId = `new_sys_field_${Date.now()}`;
        const div = document.createElement('div');
        div.classList.add('modal-system-field-item'); // Use new class for consistency
        div.innerHTML = `
            <span class="drag-handle">☰</span>
            <div class="form-group">
                <label>Teknisk navn</label>
                <input type="text" value="${name}" data-field-prop="name" placeholder="f.eks. system_number">
            </div>
            <div class="form-group">
                <label>Visningsnavn</label>
                <input type="text" value="${label}" data-field-prop="label" placeholder="f.eks. System nummer">
            </div>
            <div class="form-group">
                <label>Påkrevd</label>
                <input type="checkbox" ${required ? 'checked' : ''} data-field-prop="required">
            </div>
            <button class="remove-field-btn">&times;</button>
        `;
        newFacilitySystemFieldsContainer.appendChild(div);

        div.querySelector('.remove-field-btn').addEventListener('click', () => {
            div.remove();
        });
    }

    saveNewFacilityBtn.addEventListener('click', () => {
        const newTypeName = newFacilityNameInput.value.trim();
        if (!newTypeName) {
            alert('Vennligst oppgi et navn for den nye servicetypen.');
            return;
        }

        const newTypeId = newTypeName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '');
        if (checklistTemplates.facilityTypes.some(type => type.id === newTypeId)) {
            alert('En servicetype med dette navnet eksisterer allerede. Vennligst velg et annet navn.');
            return;
        }

        const newSystemFields = [];
        Array.from(newFacilitySystemFieldsContainer.children).forEach((fieldDiv, index) => {
            const nameInput = fieldDiv.querySelector('input[data-field-prop="name"]');
            const labelInput = fieldDiv.querySelector('input[data-field-prop="label"]');
            const requiredCheckbox = fieldDiv.querySelector('input[data-field-prop="required"]');
            
            const name = nameInput.value.trim();
            const label = labelInput.value.trim();
            const required = requiredCheckbox.checked;

            if (name && label) {
                newSystemFields.push({ name, label, required, order: index + 1 });
            }
        });

        const newFacilityType = {
            id: newTypeId,
            name: newTypeName,
            systemFields: newSystemFields,
            checklistItems: [],
            allowProducts: false,
            allowAdditionalWork: false,
            allowComments: false,
            hasDriftSchedule: false // Default to false for new types
        };

        checklistTemplates.facilityTypes.push(newFacilityType);
        populateEquipmentTypeSelect();
        equipmentTypeSelect.value = newTypeId; // Select the newly created type
        currentFacilityType = newFacilityType;
        renderChecklistConfig();
        newFacilityModal.classList.remove('show');
        saveChecklistTemplates(); // Save changes to JSON
    });

    // Initial load
    await fetchChecklistTemplates();

    // Event listener for instruksjons-knapper
    checklistItemsContainer.addEventListener('click', async (e) => {
        if (e.target.closest('.instruction-btn')) {
            const btn = e.target.closest('.instruction-btn');
            const itemId = btn.dataset.itemId;
            const item = findChecklistItemById(currentFacilityType.checklistItems, itemId);
            
            if (item) {
                currentInstructionItemId = itemId;
                instructionItemLabel.value = item.label;
                
                // Last eksisterende instruksjon
                try {
                    const response = await fetch(`/api/checklist-instructions/${currentFacilityType.name}/${currentInstructionItemId}`);
                    if (response.ok) {
                        const data = await response.json();
                        instructionTextArea.value = data.instruction;
                        deleteInstructionBtn.style.display = 'block';
                    } else {
                        instructionTextArea.value = '';
                        deleteInstructionBtn.style.display = 'none';
                    }
                } catch (error) {
                    console.error('Error loading instruction:', error);
                    instructionTextArea.value = '';
                    deleteInstructionBtn.style.display = 'none';
                }
                
                instructionModal.classList.add('show');
            }
        }
    });

    // Lagre instruksjon
    saveInstructionBtn.addEventListener('click', async () => {
        const instructionText = instructionTextArea.value.trim();
        
        if (!instructionText) {
            alert('Instruksjonstekst kan ikke være tom');
            return;
        }
        
        try {
            const response = await fetch(`/api/checklist-instructions/${currentFacilityType.name}/${currentInstructionItemId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ instructionText })
            });
            
            if (response.ok) {
                // Oppdater hasInstructions på item
                const item = findChecklistItemById(currentFacilityType.checklistItems, currentInstructionItemId);
                if (item) {
                    item.hasInstructions = true;
                }
                
                renderChecklistItems();
                saveChecklistTemplates(); // Lagre oppdatert mal
                instructionModal.classList.remove('show');
                
                showToast('Instruksjon lagret', 'success');
            } else {
                throw new Error('Failed to save instruction');
            }
        } catch (error) {
            console.error('Error saving instruction:', error);
            alert('Kunne ikke lagre instruksjon');
        }
    });

    // Slett instruksjon
    deleteInstructionBtn.addEventListener('click', async () => {
        if (!confirm('Er du sikker på at du vil slette denne instruksjonen?')) {
            return;
        }
        
        try {
            const response = await fetch(`/api/checklist-instructions/${currentFacilityType.name}/${currentInstructionItemId}`, {
                method: 'DELETE'
            });
            
            if (response.ok) {
                // Oppdater hasInstructions på item
                const item = findChecklistItemById(currentFacilityType.checklistItems, currentInstructionItemId);
                if (item) {
                    item.hasInstructions = false;
                }
                
                renderChecklistItems();
                saveChecklistTemplates(); // Lagre oppdatert mal
                instructionModal.classList.remove('show');
                
                showToast('Instruksjon slettet', 'success');
            } else {
                throw new Error('Failed to delete instruction');
            }
        } catch (error) {
            console.error('Error deleting instruction:', error);
            alert('Kunne ikke slette instruksjon');
        }
    });

    // Modal close events for instruction modal
    modalCloseBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (e.target.closest('#instruction-modal')) {
                instructionModal.classList.remove('show');
            }
        });
    });

    // Toast-funksjon (legg til hvis den ikke finnes)
    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
            color: white;
            border-radius: 6px;
            z-index: 10000;
            transition: all 0.3s ease;
        `;
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
});