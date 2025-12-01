// air-tech-app/assets/js/login.js

document.addEventListener('DOMContentLoaded', async () => {
    const technicianSelect = document.getElementById('technicianSelect');
    const passwordInput = document.getElementById('passwordInput');
    const loginForm = document.getElementById('loginForm');
    const errorMessageDiv = document.getElementById('errorMessage');

    // Function to show error message
    function showErrorMessage(message) {
        errorMessageDiv.textContent = message;
        errorMessageDiv.classList.add('show');
    }

    // Function to hide error message
    function hideErrorMessage() {
        errorMessageDiv.textContent = '';
        errorMessageDiv.classList.remove('show');
    }

    // Load technicians into the dropdown
    try {
        const response = await fetch('/api/technicians');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const technicians = await response.json();

        technicians.forEach(tech => {
            const option = document.createElement('option');
            option.value = tech.id; // Assuming each technician has a unique ID
            option.textContent = tech.name; // Assuming each technician has a name
            technicianSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Could not load technicians:', error);
        showErrorMessage('Kunne ikke laste teknikere. Prøv igjen senere.');
    }

    // Handle login form submission
    loginForm.addEventListener('submit', async (event) => {
        event.preventDefault(); // Prevent default form submission
        hideErrorMessage(); // Hide any previous error messages

        const selectedTechnicianId = technicianSelect.value;
        const password = passwordInput.value;

        if (!selectedTechnicianId || !password) {
            showErrorMessage('Vennligst fyll ut alle felt.');
            return;
        }

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ technicianId: selectedTechnicianId, password: password }),
            });

            if (response.ok) {
                // Redirect to home.html on success (hovedmeny)
                window.location.href = 'home.html';
            } else {
                const errorData = await response.json();
                showErrorMessage(errorData.message || 'Pålogging feilet. Sjekk brukernavn og passord.');
            }
        } catch (error) {
            console.error('Login request failed:', error);
            showErrorMessage('En feil oppstod under pålogging. Prøv igjen.');
        }
    });
});