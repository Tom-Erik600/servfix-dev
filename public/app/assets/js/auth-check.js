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
                const loginPaths = ['/', '/app/', '/app/login.html'];
                if (!loginPaths.includes(window.location.pathname)) {
                    window.location.href = '/app/login.html';  // ✅ FIKSET
                }
            }
        } catch (error) {
            console.error('Auth check failed', error);
            this.currentUser = null;
            // Sjekk om vi IKKE er på login-siden
            const loginPaths = ['/', '/app/', '/app/login.html'];
            if (!loginPaths.includes(window.location.pathname)) {
                window.location.href = '/app/login.html';  // ✅ FIKSET
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
            window.location.href = '/app/login.html';  // ✅ FIKSET
        } catch (error) {
            console.error('Logout failed', error);
            window.location.href = '/app/login.html';  // ✅ FIKSET
        }
    }
}

window.authManager = new AuthManager();
