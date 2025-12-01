class AuthManager {
    constructor() {
        this.currentUser = null;
        this.initialized = false;
        this.initializationPromise = this.checkAuth();
    }

    async checkAuth() {
        try {
            const response = await fetch('/api/auth/me');
            if (response.ok) {
                this.currentUser = await response.json();
            } else {
                this.currentUser = null;
                // Sjekk om vi IKKE er på login-siden
                const loginPaths = ['/', '/login.html'];
                if (!loginPaths.includes(window.location.pathname)) {
                    window.location.href = '/login.html';
                }
            }
        } catch (error) {
            console.error('Auth check failed', error);
            this.currentUser = null;
            // Sjekk om vi IKKE er på login-siden
            const loginPaths = ['/', '/login.html'];
            if (!loginPaths.includes(window.location.pathname)) {
                window.location.href = '/login.html';
            }
        } finally {
            this.initialized = true;
        }
    }

    async waitForInitialization() {
        if (!this.initialized) {
            await this.initializationPromise;
        }
    }

    isLoggedIn() {
        return !!this.currentUser;
    }

    getCurrentUser() {
        return this.currentUser;
    }

    async logout() {
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
            this.currentUser = null;
            window.location.href = '/login.html';
        } catch (error) {
            console.error('Logout failed', error);
            // Redirect uansett ved logout-feil
            window.location.href = '/login.html';
        }
    }
}

window.authManager = new AuthManager();