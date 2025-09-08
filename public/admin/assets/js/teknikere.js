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
           <td>${tech.stilling || 'Ikke oppgitt'}</td>
           <td>
               <button class="edit-btn" data-id="${tech.id}">Rediger</button>
               <button class="delete-btn" data-id="${tech.id}">Slett</button>
           </td>
       </tr>
   `).join('');

        // Add event listeners to delete buttons
        document.querySelectorAll('.delete-btn').forEach(button => {
            button.addEventListener('click', handleDeleteTechnician);
        });

        // Add event listeners to edit buttons
        document.querySelectorAll('.edit-btn').forEach(button => {
            button.addEventListener('click', handleEditTechnician);
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
    const stillingInput = document.getElementById('technician-stilling');
    const submitButton = form.querySelector('.submit-btn');

    const technicianData = {
        name: nameInput.value,
        initials: initialsInput.value.toUpperCase(),
        password: passwordInput.value,
        stilling: stillingInput.value
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

async function handleEditTechnician(event) {
    const technicianId = event.target.dataset.id;
    
    // Få eksisterende tekniker data
    try {
        const response = await fetch('/api/admin/technicians');
        const technicians = await response.json();
        const technician = technicians.find(t => t.id === technicianId);
        
        if (!technician) {
            alert('Tekniker ikke funnet');
            return;
        }
        
        // Populer skjemaet med eksisterende data
        document.getElementById('technician-name').value = technician.name;
        document.getElementById('technician-initials').value = technician.initials;
        document.getElementById('technician-stilling').value = technician.stilling || '';
        document.getElementById('technician-password').value = '';
        
        // Endre skjema til redigeringsmodus
        const form = document.getElementById('add-technician-form');
        const submitButton = form.querySelector('.submit-btn');
        
        // Fjern eksisterende event listener
        form.removeEventListener('submit', handleAddTechnician);
        
        // Legg til update event listener
        const handleUpdate = async (event) => {
            event.preventDefault();
            
            const nameInput = document.getElementById('technician-name');
            const initialsInput = document.getElementById('technician-initials');
            const passwordInput = document.getElementById('technician-password');
            const stillingInput = document.getElementById('technician-stilling');
            
            const updateData = {
                name: nameInput.value,
                initials: initialsInput.value.toUpperCase(),
                stilling: stillingInput.value,
                password: passwordInput.value // Kan være tom
            };
            
            submitButton.disabled = true;
            submitButton.textContent = 'Oppdaterer...';
            
            try {
                const response = await fetch(`/api/admin/technicians/${technicianId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updateData)
                });
                
                if (!response.ok) throw new Error('Oppdatering feilet');
                
                // Tilbakestill skjema til add-modus
                form.reset();
                form.removeEventListener('submit', handleUpdate);
                form.addEventListener('submit', handleAddTechnician);
                submitButton.textContent = 'Legg til';
                
                loadTechnicians();
                alert('Tekniker oppdatert!');
                
            } catch (error) {
                console.error('Feil ved oppdatering:', error);
                alert('Kunne ikke oppdatere tekniker');
            } finally {
                submitButton.disabled = false;
            }
        };
        
        form.addEventListener('submit', handleUpdate);
        submitButton.textContent = 'Oppdater Tekniker';
        
    } catch (error) {
        console.error('Feil ved lasting av tekniker:', error);
        alert('Kunne ikke laste tekniker-data');
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