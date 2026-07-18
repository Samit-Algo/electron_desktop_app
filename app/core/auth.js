import { navigate } from './router.js';
import { api } from './api.js';
import { toast } from './toast.js';

export async function login(email, password) {
  const response = await api.requestWithoutAuth('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  if (response.access_token) {
    api.token = response.access_token;
    localStorage.setItem('visionai_token', api.token);
    if (response.refresh_token) {
      api.refreshToken = response.refresh_token;
      localStorage.setItem('visionai_refresh_token', api.refreshToken);
    }
    const user = await api.get('/api/v1/auth/me');
    api.user = user;
    localStorage.setItem('visionai_user', JSON.stringify(user));
    window.dispatchEvent(new CustomEvent('authStateChanged', { detail: { loggedIn: true, user } }));
  }

  return response;
}

export async function register(fullName, email, password) {
  return api.requestWithoutAuth('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({ full_name: fullName, email, password }),
  });
}

export async function logout() {
  if (api.refreshToken) {
    try {
      await api.requestWithoutAuth('/api/v1/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: api.refreshToken }),
      });
    } catch (_) {}
  }
  api._clearSession();
}

export async function checkAuth() {
  if (!api.token) return false;
  try {
    const user = await api.get('/api/v1/auth/me');
    api.user = user;
    localStorage.setItem('visionai_user', JSON.stringify(user));
    return true;
  } catch (err) {
    const type = err?.errorType;
    if (type === 'database_error') {
      toast.error('Service temporarily unavailable. Please try again later.');
    } else if (type === 'server_error') {
      toast.error('An unexpected error occurred. Please try again.');
    }
    // auth_error = normal session expiry — redirect silently, no toast
    if (type === 'auth_error' || err?.message?.includes('Session expired')) api._clearSession();
    return false;
  }
}

export function isAuthenticated() {
  return api.isAuthenticated();
}

export function getUser() {
  return api.user;
}

// ── Auth guard UI ──────────────────────────────────────────────────────────

const LOGIN_CONTENT_ID = 'login-page-content';
const PROTECTED_PATHS = ['dashboard', 'camera-detail', 'cameras-list', 'events-board', 'agents-board', 'agent-detail', 'settings'];

function isProtectedPath() {
  const page = sessionStorage.getItem('spa:page') || window.location.pathname;
  return PROTECTED_PATHS.some(p => page.includes(p));
}

function hideAppChrome() {
  document.getElementById('app-root')?.classList.add('visionai-auth-logged-out');
  const topbar = document.getElementById('navbarDefault');
  const sidebar = document.querySelector('.navbar-vertical');
  const chatbot = document.getElementById('chatbot-container');
  if (topbar) topbar.style.display = 'none';
  if (sidebar) sidebar.style.display = 'none';
  if (chatbot) chatbot.style.display = 'none';
}

function showAppChrome() {
  document.getElementById('app-root')?.classList.remove('visionai-auth-logged-out');
  const topbar = document.getElementById('navbarDefault');
  const sidebar = document.querySelector('.navbar-vertical');
  const chatbot = document.getElementById('chatbot-container');
  if (topbar) topbar.style.display = '';
  if (sidebar) sidebar.style.display = '';
  if (chatbot) chatbot.style.display = '';
}

function getLoginHTML() {
  return `
    <div class="container-fluid">
      <div class="row flex-center min-vh-100 py-5">
        <div class="col-sm-10 col-md-8 col-lg-5 col-xl-5 col-xxl-3">
          <a class="d-flex flex-center text-decoration-none mb-4" href="#">
            <div class="d-flex align-items-center fw-bolder fs-3 d-inline-block">
              <img src="../assets/img/algo-logo.png" alt="Vision AI" width="58" />
            </div>
          </a>
          <div class="text-center mb-7">
            <h3 class="text-body-highlight">Sign In</h3>
            <p class="text-body-tertiary">Get access to your account</p>
          </div>
          <form id="login-form">
            <div class="mb-3 text-start">
              <label class="form-label" for="login-email">Email address</label>
              <div class="form-icon-container">
                <input class="form-control form-icon-input" id="login-email" type="email" placeholder="name@example.com" required autocomplete="email" />
                <span class="fas fa-user text-body fs-9 form-icon"></span>
              </div>
            </div>
            <div class="mb-3 text-start">
              <label class="form-label" for="login-password">Password</label>
              <div class="form-icon-container" data-password="data-password">
                <input class="form-control form-icon-input pe-6" id="login-password" type="password" placeholder="Password" data-password-input="data-password-input" required autocomplete="current-password" />
                <span class="fas fa-key text-body fs-9 form-icon"></span>
                <button class="btn px-3 py-0 h-100 position-absolute top-0 end-0 fs-7 text-body-tertiary" type="button" data-password-toggle="data-password-toggle">
                  <span class="fa-solid fa-eye show"></span>
                  <span class="fa-solid fa-eye-slash hide"></span>
                </button>
              </div>
            </div>
            <div class="row flex-between-center mb-7">
              <div class="col-auto">
                <div class="form-check mb-0">
                  <input class="form-check-input" id="remember-me" type="checkbox" />
                  <label class="form-check-label mb-0" for="remember-me">Remember me</label>
                </div>
              </div>
              <div class="col-auto">
                <a class="fs-9 fw-semibold" href="#" id="forgot-password-link">Forgot Password?</a>
              </div>
            </div>
            <button class="btn btn-primary w-100 mb-3" type="submit" id="login-submit-btn">
              <span class="spinner-border spinner-border-sm d-none me-2" id="login-spinner"></span>
              Sign In
            </button>
            <div class="text-center">
              <a class="fs-9 fw-bold" href="#" id="show-register-link">Create an account</a>
            </div>
          </form>
        </div>
      </div>
    </div>`;
}

function getRegisterHTML() {
  return `
    <div class="container-fluid">
      <div class="row flex-center min-vh-100 py-5">
        <div class="col-sm-10 col-md-8 col-lg-5 col-xl-5 col-xxl-3">
          <a class="d-flex flex-center text-decoration-none mb-4" href="#">
            <div class="d-flex align-items-center fw-bolder fs-3 d-inline-block">
              <img src="../assets/img/algo-logo.png" alt="Vision AI" width="58" />
            </div>
          </a>
          <div class="text-center mb-7">
            <h3 class="text-body-highlight">Sign Up</h3>
            <p class="text-body-tertiary">Create your account today</p>
          </div>
          <form id="register-form">
            <div class="mb-3 text-start">
              <label class="form-label" for="register-name">Name</label>
              <input class="form-control" id="register-name" type="text" placeholder="Name" required autocomplete="name" />
            </div>
            <div class="mb-3 text-start">
              <label class="form-label" for="register-email">Email address</label>
              <input class="form-control" id="register-email" type="email" placeholder="name@example.com" required autocomplete="email" />
            </div>
            <div class="row g-3 mb-3">
              <div class="col-sm-6">
                <label class="form-label" for="register-password">Password</label>
                <div class="position-relative" data-password="data-password">
                  <input class="form-control form-icon-input pe-6" id="register-password" type="password" placeholder="Password" data-password-input="data-password-input" required autocomplete="new-password" minlength="8" />
                  <button class="btn px-3 py-0 h-100 position-absolute top-0 end-0 fs-7 text-body-tertiary" type="button" data-password-toggle="data-password-toggle">
                    <span class="fa-solid fa-eye show"></span>
                    <span class="fa-solid fa-eye-slash hide"></span>
                  </button>
                </div>
              </div>
              <div class="col-sm-6">
                <label class="form-label" for="register-confirm-password">Confirm Password</label>
                <div class="position-relative" data-password="data-password">
                  <input class="form-control form-icon-input pe-6" id="register-confirm-password" type="password" placeholder="Confirm Password" data-password-input="data-password-input" required autocomplete="new-password" />
                  <button class="btn px-3 py-0 h-100 position-absolute top-0 end-0 fs-7 text-body-tertiary" type="button" data-password-toggle="data-password-toggle">
                    <span class="fa-solid fa-eye show"></span>
                    <span class="fa-solid fa-eye-slash hide"></span>
                  </button>
                </div>
              </div>
            </div>
            <div class="form-check mb-3">
              <input class="form-check-input" id="terms-service" type="checkbox" required />
              <label class="form-label fs-9 text-transform-none" for="terms-service">
                I accept the <a href="#!">terms</a> and <a href="#!">privacy policy</a>
              </label>
            </div>
            <button class="btn btn-primary w-100 mb-3" type="submit" id="register-submit-btn">
              <span class="spinner-border spinner-border-sm d-none me-2" id="register-spinner"></span>
              Sign up
            </button>
            <div class="text-center">
              <a class="fs-9 fw-bold" href="#" id="show-login-link">Sign in to an existing account</a>
            </div>
          </form>
        </div>
      </div>
    </div>`;
}

function initPasswordToggle() {
  setTimeout(() => {
    document.querySelectorAll('[data-password-toggle]').forEach(btn => {
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
      newBtn.addEventListener('click', function (e) {
        e.preventDefault();
        const container = this.closest('[data-password]');
        if (!container) return;
        const input = container.querySelector('[data-password-input]');
        if (!input) return;
        const showIcon = this.querySelector('.show');
        const hideIcon = this.querySelector('.hide');
        if (input.type === 'password') {
          input.type = 'text';
          if (showIcon) showIcon.style.display = 'none';
          if (hideIcon) hideIcon.style.display = 'inline';
        } else {
          input.type = 'password';
          if (showIcon) showIcon.style.display = 'inline';
          if (hideIcon) hideIcon.style.display = 'none';
        }
      });
    });
  }, 100);
}

function showLoginPage() {
  hideAppChrome();
  const viewport = document.querySelector('.viewport-scrolls');
  if (!viewport) { setTimeout(showLoginPage, 100); return; }

  const existing = viewport.querySelector('.content');
  if (existing && existing.id !== LOGIN_CONTENT_ID) existing.style.display = 'none';

  let loginContainer = document.getElementById(LOGIN_CONTENT_ID);
  if (loginContainer) { loginContainer.style.display = 'block'; return; }

  loginContainer = document.createElement('div');
  loginContainer.id = LOGIN_CONTENT_ID;
  loginContainer.className = 'content';
  loginContainer.innerHTML = getLoginHTML();
  viewport.appendChild(loginContainer);
  initLoginForm();
  initPasswordToggle();
}

function showRegisterPage() {
  const loginContainer = document.getElementById(LOGIN_CONTENT_ID);
  if (loginContainer) {
    loginContainer.innerHTML = getRegisterHTML();
    initRegisterForm();
    initPasswordToggle();
  }
}

function hideLoginPage() {
  showAppChrome();
  const loginContainer = document.getElementById(LOGIN_CONTENT_ID);
  if (loginContainer) loginContainer.style.display = 'none';
  const existing = document.querySelector('.viewport-scrolls .content');
  if (existing && existing.id !== LOGIN_CONTENT_ID) existing.style.display = 'block';
}

function initLoginForm() {
  setTimeout(() => {
    const loginForm = document.getElementById('login-form');
    const showRegisterLink = document.getElementById('show-register-link');
    const forgotPasswordLink = document.getElementById('forgot-password-link');

    showRegisterLink?.addEventListener('click', e => { e.preventDefault(); showRegisterPage(); });
    forgotPasswordLink?.addEventListener('click', e => { e.preventDefault(); toast.info('Forgot password feature coming soon!'); });

    loginForm?.addEventListener('submit', async e => {
      e.preventDefault();
      const email = document.getElementById('login-email').value;
      const password = document.getElementById('login-password').value;
      const submitBtn = document.getElementById('login-submit-btn');
      const spinner = document.getElementById('login-spinner');
      submitBtn.disabled = true;
      spinner?.classList.remove('d-none');
      try {
        await login(email, password);
      } catch (error) {
        const type = error?.errorType;
        if (type === 'auth_error') toast.error('Invalid email or password.');
        else if (type === 'validation_error') toast.error(error.message || 'Please check your input.');
        else if (type === 'database_error') toast.error('Service temporarily unavailable. Please try again later.');
        else toast.error(error.message || 'Login failed. Please check your credentials.');
      } finally {
        submitBtn.disabled = false;
        spinner?.classList.add('d-none');
      }
    });
  }, 100);
}

function initRegisterForm() {
  setTimeout(() => {
    const registerForm = document.getElementById('register-form');
    const showLoginLink = document.getElementById('show-login-link');

    showLoginLink?.addEventListener('click', e => { e.preventDefault(); showLoginPage(); });

    registerForm?.addEventListener('submit', async e => {
      e.preventDefault();
      const fullName = document.getElementById('register-name').value;
      const email = document.getElementById('register-email').value;
      const password = document.getElementById('register-password').value;
      const confirmPassword = document.getElementById('register-confirm-password').value;
      const submitBtn = document.getElementById('register-submit-btn');
      const spinner = document.getElementById('register-spinner');

      if (password !== confirmPassword) {
        toast.error('Passwords do not match. Please try again.');
        return;
      }

      submitBtn.disabled = true;
      spinner?.classList.remove('d-none');
      try {
        await register(fullName, email, password);
        toast.success('Account created successfully! Logging you in...');
        await login(email, password);
      } catch (error) {
        const type = error?.errorType;
        if (type === 'validation_error') toast.error(error.message || 'Please check your input.');
        else if (type === 'database_error') toast.error('Service temporarily unavailable. Please try again later.');
        else toast.error(error.message || 'Registration failed. Please try again.');
      } finally {
        submitBtn.disabled = false;
        spinner?.classList.add('d-none');
      }
    });
  }, 100);
}

function showLoginRequiredMessage() {
  hideAppChrome();
  const viewport = document.querySelector('.viewport-scrolls');
  if (!viewport) { setTimeout(showLoginRequiredMessage, 100); return; }
  const existing = viewport.querySelector('.content');
  if (existing) {
    existing.innerHTML = `
      <div class="container-fluid py-5">
        <div class="row justify-content-center">
          <div class="col-md-6 col-lg-5">
            <div class="card shadow-sm text-center">
              <div class="card-body p-5">
                <div class="mb-4"><span class="fa-solid fa-lock fa-3x text-body-tertiary"></span></div>
                <h4 class="mb-3 text-body-emphasis">Authentication Required</h4>
                <p class="text-body-tertiary mb-4">Please login or register to access this page.</p>
                <button class="btn btn-primary" id="go-to-login-btn">Go to Login</button>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    document.getElementById('go-to-login-btn')?.addEventListener('click', () => showLoginPage());
  }
}

function updateUserProfile(user) {
  if (!user) return;
  const userName = document.getElementById('user-name');
  const userEmail = document.getElementById('user-email');
  if (userName) userName.textContent = user.full_name || user.email || 'User';
  if (userEmail) userEmail.textContent = user.email || 'Not logged in';

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    const newBtn = logoutBtn.cloneNode(true);
    logoutBtn.parentNode.replaceChild(newBtn, logoutBtn);
    newBtn.addEventListener('click', async e => {
      e.preventDefault();
      await logout();
      toast.info('You have been logged out successfully.');
    });
  }
}

function protectMenuItems() {
  document.querySelectorAll('.navbar-vertical a.nav-link[href*=".html"]').forEach(link => {
    link.addEventListener('click', e => {
      if (!isAuthenticated()) {
        e.preventDefault();
        showLoginPage();
        toast.warning('Please login or register to access this feature.');
      }
    });
  });
}

export async function initAuthGuard() {
  const authenticated = await checkAuth();

  if (!authenticated) {
    if (isProtectedPath()) showLoginRequiredMessage();
    else showLoginPage();
  } else {
    hideLoginPage();
    updateUserProfile(api.user);
  }

  protectMenuItems();

  window.addEventListener('authStateChanged', event => {
    if (event.detail.loggedIn) {
      hideLoginPage();
      updateUserProfile(event.detail.user);
      if (event.detail.user) {
        toast.success(`Welcome, ${event.detail.user.full_name || event.detail.user.email || 'User'}!`);
      }
      setTimeout(() => {
        const dashboardPath = '/app/pages/dashboard/dashboard.html';
        navigate(dashboardPath).catch(() => { window.location.href = dashboardPath; });
      }, 300);
    } else {
      showLoginPage();
    }
  });
}
