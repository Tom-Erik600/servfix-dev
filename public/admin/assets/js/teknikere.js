document.addEventListener('DOMContentLoaded', () => {
    loadTechnicians();
    
    const form = document.getElementById('add-technician-form');
    if (form) {
        form.addEventListener('submit', handleAddTechnician);
    }
});

async function loadTechnicians() {
    const tableBody = document.getElementById('technicians-table-body');
    if (!tableBody) return;

    try {
        const technicians = await fetch('/api/admin/technicians').then(res => res.json());
        if (technicians.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px;">Ingen teknikere funnet.</td></tr>';
            return;
        }
        tableBody.innerHTML = technicians.map(tech => `
            <tr>
                <td>${tech.id}</td>
                <td>${tech.name}</td>
                <td>${tech.initials}</td>
                <td><button class="delete-btn" data-id="${tech.id}">Slett</button></td>
            </tr>
        `).join('');

        // Add event listeners to delete buttons
        document.querySelectorAll('.delete-btn').forEach(button => {
            button.addEventListener('click', handleDeleteTechnician);
        });

    } catch (error) {
        console.error('Kunne ikke laste teknikere:', error);
        tableBody.innerHTML = '<tr><td colspan="4" style="color: red; text-align: center;">Klarte ikke å hente data.</td></tr>';
    }
}

async function handleAddTechnician(event) {
    event.preventDefault();
    const form = event.target;
    const nameInput = document.getElementById('technician-name');
    const initialsInput = document.getElementById('technician-initials');
    const passwordInput = document.getElementById('technician-password');
    const submitButton = form.querySelector('.submit-btn');

    const technicianData = {
        name: nameInput.value,
        initials: initialsInput.value.toUpperCase(),
        password: passwordInput.value
    };
    
    submitButton.disabled = true;
    submitButton.textContent = 'Lagrer...';

    try {
        const response = await fetch('/api/admin/technicians', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(technicianData)
        });
        if (!response.ok) throw new Error('Lagring feilet på serveren.');

        form.reset();
        loadTechnicians(); // Last listen på nytt for å vise den nye teknikeren
    } catch (error) {
        console.error('Feil ved lagring av tekniker:', error);
        alert('Noe gikk galt. Kunne ikke legge til tekniker.');
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = 'Legg til';
    }
}

async function handleDeleteTechnician(event) {
    const technicianId = event.target.dataset.id;
    if (!confirm(`Er du sikker på at du vil slette tekniker ${technicianId}?`)) {
        return;
    }

    try {
        const response = await fetch(`/api/admin/technicians/${technicianId}`, {
            method: 'DELETE',
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Sletting feilet på serveren.');
        }

        alert('Tekniker slettet!');
        loadTechnicians(); // Last listen på nytt
    } catch (error) {
        console.error('Feil ved sletting av tekniker:', error);
        alert(`Kunne ikke slette tekniker: ${error.message}`);
    }
}