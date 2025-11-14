// Admin Login JavaScript

document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('login-form');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const errorMessage = document.getElementById('error-message');
    const submitButton = form.querySelector('button[type="submit"]');

    // Clear error message when user starts typing
    [usernameInput, passwordInput].forEach(input => {
        input.addEventListener('input', () => {
            errorMessage.textContent = '';
            errorMessage.style.display = 'none';
        });
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const username = usernameInput.value.trim();
        const password = passwordInput.value;

        if (!username || !password) {
            showError('Vennligst fyll ut alle felt');
            return;
        }

        // Disable form during login
        setFormState(false);

        try {
            const response = await fetch('/api/admin/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (response.ok) {
                // Successful login
                window.location.href = '/admin/dashboard.html';
            } else {
                // Show error message
                showError(data.error || 'Ugyldig brukernavn eller passord');
                setFormState(true);
            }
        } catch (error) {
            console.error('Login error:', error);
            showError('Kunne ikke koble til serveren. Prøv igjen senere.');
            setFormState(true);
        }
    });

    function showError(message) {
        errorMessage.textContent = message;
        errorMessage.style.display = 'block';
    }

    function setFormState(enabled) {
        usernameInput.disabled = !enabled;
        passwordInput.disabled = !enabled;
        submitButton.disabled = !enabled;
        submitButton.textContent = enabled ? 'Logg inn' : 'Logger inn...';
    }

    // Check if already logged in
    checkAuthStatus();

    async function checkAuthStatus() {
        try {
            const response = await fetch('/api/admin/auth/me');
            if (response.ok) {
                // Already logged in, redirect to dashboard
                window.location.href = '/admin/dashboard.html';
            }
        } catch (error) {
            // Not logged in, stay on login page
            console.log('Not logged in');
        }
    }
});