document.addEventListener('DOMContentLoaded', () => {
    const techniciansTableBody = document.getElementById('technicians-table-body');
    const addTechnicianForm = document.getElementById('add-technician-form');

    async function fetchTechnicians() {
        try {
            const response = await fetch('/api/technicians');
            const technicians = await response.json();
            renderTechnicians(technicians);
        } catch (error) {
            console.error('Error fetching technicians:', error);
        }
    }

    function renderTechnicians(technicians) {
        techniciansTableBody.innerHTML = '';
        technicians.forEach(technician => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${technician.id}</td>
                <td>${technician.name}</td>
                <td>${technician.initials}</td>
            `;
            techniciansTableBody.appendChild(row);
        });
    }

    addTechnicianForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const nameInput = document.getElementById('technician-name');
        const initialsInput = document.getElementById('technician-initials');

        const newTechnician = {
            name: nameInput.value,
            initials: initialsInput.value
        };

        try {
            const response = await fetch('/api/technicians', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(newTechnician)
            });

            if (response.ok) {
                nameInput.value = '';
                initialsInput.value = '';
                fetchTechnicians();
            } else {
                console.error('Error adding technician:', await response.json());
            }
        } catch (error) {
            console.error('Error adding technician:', error);
        }
    });

    fetchTechnicians();
});