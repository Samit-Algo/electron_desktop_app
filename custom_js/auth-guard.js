/**
 * Authentication Guard - Protects routes and shows login page
 * Uses Phoenix UI sign-in/sign-up components
 */
(function() {
  'use strict';

  const LOGIN_CONTENT_ID = 'login-page-content';
  const PROTECTED_PATHS = ['dashboard', 'camera-detail', 'events-board', 'settings'];

  /**
   * Check if current path is protected
   */
  function isProtectedPath() {
    const path = window.location.pathname;
    return PROTECTED_PATHS.some(protectedPath => path.includes(protectedPath));
  }

  /**
   * Show login page in content area
   */
  function showLoginPage() {
    const viewport = document.querySelector('.viewport-scrolls');
    if (!viewport) {
      setTimeout(showLoginPage, 100);
      return;
    }

    // Hide any existing content
    const existingContent = viewport.querySelector('.content');
    if (existingContent && existingContent.id !== LOGIN_CONTENT_ID) {
      existingContent.style.display = 'none';
    }

    // Check if login page already exists
    let loginContainer = document.getElementById(LOGIN_CONTENT_ID);
    if (loginContainer) {
      loginContainer.style.display = 'block';
      return;
    }

    // Create login container
    loginContainer = document.createElement('div');
    loginContainer.id = LOGIN_CONTENT_ID;
    loginContainer.className = 'content';
    loginContainer.innerHTML = getLoginHTML();
    
    viewport.appendChild(loginContainer);

    // Initialize login form and password toggle
    initLoginForm();
    initPasswordToggle();
  }

  /**
   * Show register page
   */
  function showRegisterPage() {
    const loginContainer = document.getElementById(LOGIN_CONTENT_ID);
    if (loginContainer) {
      loginContainer.innerHTML = getRegisterHTML();
      initRegisterForm();
      initPasswordToggle();
    }
  }

  /**
   * Hide login page and show normal content
   */
  function hideLoginPage() {
    const loginContainer = document.getElementById(LOGIN_CONTENT_ID);
    if (loginContainer) {
      loginContainer.style.display = 'none';
    }

    const existingContent = document.querySelector('.viewport-scrolls .content');
    if (existingContent && existingContent.id !== LOGIN_CONTENT_ID) {
      existingContent.style.display = 'block';
    }
  }

  /**
   * Get login page HTML (Phoenix UI sign-in style)
   */
  function getLoginHTML() {
    return `
      <div class="container-fluid">
        <div class="row flex-center min-vh-100 py-5">
          <div class="col-sm-10 col-md-8 col-lg-5 col-xl-5 col-xxl-3">
            <a class="d-flex flex-center text-decoration-none mb-4" href="#">
              <div class="d-flex align-items-center fw-bolder fs-3 d-inline-block">
                <img src="../assets/img/icons/logo.png" alt="Vision AI" width="58" />
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
                    <span class="uil uil-eye show"></span>
                    <span class="uil uil-eye-slash hide"></span>
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
      </div>
    `;
  }

  /**
   * Get register page HTML (Phoenix UI sign-up style)
   */
  function getRegisterHTML() {
    return `
      <div class="container-fluid">
        <div class="row flex-center min-vh-100 py-5">
          <div class="col-sm-10 col-md-8 col-lg-5 col-xl-5 col-xxl-3">
            <a class="d-flex flex-center text-decoration-none mb-4" href="#">
              <div class="d-flex align-items-center fw-bolder fs-3 d-inline-block">
                <img src="../assets/img/icons/logo.png" alt="Vision AI" width="58" />
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
                      <span class="uil uil-eye show"></span>
                      <span class="uil uil-eye-slash hide"></span>
                    </button>
                  </div>
                </div>
                
                <div class="col-sm-6">
                  <label class="form-label" for="register-confirm-password">Confirm Password</label>
                  <div class="position-relative" data-password="data-password">
                    <input class="form-control form-icon-input pe-6" id="register-confirm-password" type="password" placeholder="Confirm Password" data-password-input="data-password-input" required autocomplete="new-password" />
                    <button class="btn px-3 py-0 h-100 position-absolute top-0 end-0 fs-7 text-body-tertiary" type="button" data-password-toggle="data-password-toggle">
                      <span class="uil uil-eye show"></span>
                      <span class="uil uil-eye-slash hide"></span>
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
      </div>
    `;
  }

  /**
   * Initialize password toggle functionality (Phoenix UI feature)
   */
  function initPasswordToggle() {
    // Use setTimeout to ensure DOM is ready
    setTimeout(() => {
      document.querySelectorAll('[data-password-toggle]').forEach(toggleBtn => {
        // Remove existing listeners to avoid duplicates
        const newToggleBtn = toggleBtn.cloneNode(true);
        toggleBtn.parentNode.replaceChild(newToggleBtn, toggleBtn);
        
        newToggleBtn.addEventListener('click', function(e) {
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

  /**
   * Initialize login form handlers
   */
  function initLoginForm() {
    // Use setTimeout to ensure DOM is ready
    setTimeout(() => {
      const loginForm = document.getElementById('login-form');
      const showRegisterLink = document.getElementById('show-register-link');
      const forgotPasswordLink = document.getElementById('forgot-password-link');

      // Toggle to register
      if (showRegisterLink) {
        showRegisterLink.addEventListener('click', (e) => {
          e.preventDefault();
          showRegisterPage();
        });
      }

      // Forgot password link (placeholder for now)
      if (forgotPasswordLink) {
        forgotPasswordLink.addEventListener('click', (e) => {
          e.preventDefault();
          if (window.VisionToast) {
            window.VisionToast.info('Forgot password feature coming soon!');
          }
        });
      }

      // Login form submission
      if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          
          if (!window.visionAPI) {
            console.error('API service not loaded');
            return;
          }
          
          const email = document.getElementById('login-email').value;
          const password = document.getElementById('login-password').value;
          const submitBtn = document.getElementById('login-submit-btn');
          const spinner = document.getElementById('login-spinner');
          
          submitBtn.disabled = true;
          if (spinner) spinner.classList.remove('d-none');
          
          try {
            await window.visionAPI.login(email, password);
            // Auth state change event will handle hiding login page and navigation
            // Toast will be shown by authStateChanged handler
          } catch (error) {
            if (window.VisionToast) {
              window.VisionToast.error(error.message || 'Login failed. Please check your credentials.');
            } else {
              alert(error.message || 'Login failed');
            }
          } finally {
            submitBtn.disabled = false;
            if (spinner) spinner.classList.add('d-none');
          }
        });
      }
    }, 100);
  }

  /**
   * Initialize register form handlers
   */
  function initRegisterForm() {
    // Use setTimeout to ensure DOM is ready
    setTimeout(() => {
      const registerForm = document.getElementById('register-form');
      const showLoginLink = document.getElementById('show-login-link');

      // Toggle to login
      if (showLoginLink) {
        showLoginLink.addEventListener('click', (e) => {
          e.preventDefault();
          showLoginPage();
        });
      }

      // Register form submission
      if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          
          if (!window.visionAPI) {
            console.error('API service not loaded');
            return;
          }
          
          const fullName = document.getElementById('register-name').value;
          const email = document.getElementById('register-email').value;
          const password = document.getElementById('register-password').value;
          const confirmPassword = document.getElementById('register-confirm-password').value;
          const submitBtn = document.getElementById('register-submit-btn');
          const spinner = document.getElementById('register-spinner');
          
          // Validate passwords match
          if (password !== confirmPassword) {
            if (window.VisionToast) {
              window.VisionToast.error('Passwords do not match. Please try again.');
            } else {
              alert('Passwords do not match');
            }
            return;
          }
          
          submitBtn.disabled = true;
          if (spinner) spinner.classList.remove('d-none');
          
          try {
            await window.visionAPI.register(fullName, email, password);
            if (window.VisionToast) {
              window.VisionToast.success('Account created successfully! Logging you in...');
            }
            // Auto login after registration
            await window.visionAPI.login(email, password);
          } catch (error) {
            if (window.VisionToast) {
              window.VisionToast.error(error.message || 'Registration failed. Please try again.');
            } else {
              alert(error.message || 'Registration failed');
            }
          } finally {
            submitBtn.disabled = false;
            if (spinner) spinner.classList.add('d-none');
          }
        });
      }
    }, 100);
  }

  /**
   * Show "Please login" message for protected pages
   */
  function showLoginRequiredMessage() {
    const viewport = document.querySelector('.viewport-scrolls');
    if (!viewport) {
      setTimeout(showLoginRequiredMessage, 100);
      return;
    }

    const existingContent = viewport.querySelector('.content');
    if (existingContent) {
      existingContent.innerHTML = `
        <div class="container-fluid py-5">
          <div class="row justify-content-center">
            <div class="col-md-6 col-lg-5">
              <div class="card shadow-sm text-center">
                <div class="card-body p-5">
                  <div class="mb-4">
                    <span class="fa-solid fa-lock fa-3x text-body-tertiary"></span>
                  </div>
                  <h4 class="mb-3 text-body-emphasis">Authentication Required</h4>
                  <p class="text-body-tertiary mb-4">Please login or register to access this page.</p>
                  <button class="btn btn-primary" id="go-to-login-btn">
                    Go to Login
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
      
      // Add event listener to the button
      const goToLoginBtn = document.getElementById('go-to-login-btn');
      if (goToLoginBtn) {
        goToLoginBtn.addEventListener('click', () => {
          showLoginPage();
        });
      }
    }
  }

  /**
   * Navigate to dashboard page
   */
  function navigateToDashboard() {
    // Use absolute path to avoid double 'pages/pages' issue
    // In Electron, we're on localhost, so use absolute path from root
    const isElectron = window.location.protocol === 'http:' && window.location.hostname === '127.0.0.1';
    const dashboardPath = isElectron ? '/pages/dashboard.html' : 'pages/dashboard.html';
    
    // Use SPA navigation if available (from layout-loader.js)
    if (window.visionaiSpa && typeof window.visionaiSpa.navigate === 'function') {
      window.visionaiSpa.navigate(dashboardPath).catch(() => {
        // Fallback to regular navigation if SPA navigation fails
        window.location.href = dashboardPath;
      });
    } else {
      // Fallback to regular navigation
      window.location.href = dashboardPath;
    }
  }

  /**
   * Protect sidebar menu items
   */
  function protectMenuItems() {
    const menuLinks = document.querySelectorAll('.navbar-vertical a.nav-link[href*=".html"]');
    menuLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        if (!window.visionAPI || !window.visionAPI.isAuthenticated()) {
          e.preventDefault();
          // Show login page directly instead of just a message
          showLoginPage();
          if (window.VisionToast) {
            window.VisionToast.warning('Please login or register to access this feature.');
          }
        }
      });
    });
  }

  /**
   * Initialize authentication guard
   */
  async function initAuthGuard() {
    // Wait for API service and toast service to load
    if (!window.visionAPI) {
      setTimeout(initAuthGuard, 100);
      return;
    }

    // Check authentication status
    const isAuthenticated = await window.visionAPI.checkAuth();
    
    if (!isAuthenticated) {
      if (isProtectedPath()) {
        showLoginRequiredMessage();
      } else {
        showLoginPage();
      }
    } else {
      hideLoginPage();
      updateUserProfile(window.visionAPI.user);
    }

    // Protect menu items
    protectMenuItems();

    // Listen for auth state changes
    window.addEventListener('authStateChanged', (event) => {
      if (event.detail.loggedIn) {
        hideLoginPage();
        updateUserProfile(event.detail.user);
        
        // Show welcome message
        if (window.VisionToast && event.detail.user) {
          window.VisionToast.success(`Welcome, ${event.detail.user.full_name || event.detail.user.email || 'User'}!`);
        }
        
        // Navigate to dashboard after successful login (with small delay to ensure UI updates)
        setTimeout(() => {
          navigateToDashboard();
        }, 300);
      } else {
        showLoginPage();
      }
    });
  }

  /**
   * Update user profile in top bar
   */
  function updateUserProfile(user) {
    if (!user) return;

    const avatarSmall = document.getElementById('user-avatar-small');
    const avatarLarge = document.getElementById('user-avatar-large');
    const userName = document.getElementById('user-name');
    const userEmail = document.getElementById('user-email');
    
    if (userName) {
      userName.textContent = user.full_name || user.email || 'User';
    }
    
    if (userEmail) {
      userEmail.textContent = user.email || 'Not logged in';
    }

    // Update logout button
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      // Remove existing listeners by cloning
      const newLogoutBtn = logoutBtn.cloneNode(true);
      logoutBtn.parentNode.replaceChild(newLogoutBtn, logoutBtn);
      
      newLogoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (window.visionAPI) {
          window.visionAPI.logout();
          if (window.VisionToast) {
            window.VisionToast.info('You have been logged out successfully.');
          }
        }
      });
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAuthGuard);
  } else {
    initAuthGuard();
  }
})();

