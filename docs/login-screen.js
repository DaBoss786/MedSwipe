import { logAnalyticsEvent } from './analytics.js';

// Login Screen Functionality
document.addEventListener('DOMContentLoaded', function() {
  // Elements
  const loginScreen = document.getElementById('loginScreen');
  const loginForm = document.getElementById('loginScreenForm');
  const emailInput = document.getElementById('loginScreenEmail');
  const passwordInput = document.getElementById('loginScreenPassword');
  const submitButton = document.getElementById('loginScreenSubmit');
  const emailError = document.getElementById('emailError');
  const passwordError = document.getElementById('passwordError');
  const loginError = document.getElementById('loginScreenError');
  const passwordToggle = document.getElementById('passwordToggle');
  const loginLoader = document.getElementById('loginLoader');
  const forgotPasswordLink = document.getElementById('forgotPasswordLink');
  const createAccountBtn = document.getElementById('createAccountBtn');
  const continueAsGuestBtn = document.getElementById('continueAsGuestBtn');
  const oauthButtons = Array.from(document.querySelectorAll('[data-oauth-context="login-screen"]'));

  if (window.__medswipeOAuthRedirectOutcome && window.__medswipeOAuthRedirectOutcome.status === 'error' && (!window.__medswipeOAuthRedirectOutcome.flow || window.__medswipeOAuthRedirectOutcome.flow === 'login')) {
    if (loginError) {
      loginError.textContent = getAuthErrorMessage(window.__medswipeOAuthRedirectOutcome.error || { message: 'Authentication did not complete. Please try again.' });
    }
    window.__medswipeOAuthRedirectOutcome = null;
  }
  
  // Form validation flags
  let isEmailValid = false;
  let isPasswordValid = false;
  
  // Email validation function
  function validateEmail() {
    const email = emailInput.value.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    
    if (email === '') {
      emailError.textContent = 'Email is required';
      emailInput.parentElement.classList.add('error');
      emailInput.parentElement.classList.remove('success');
      isEmailValid = false;
    } else if (!emailRegex.test(email)) {
      emailError.textContent = 'Please enter a valid email address';
      emailInput.parentElement.classList.add('error');
      emailInput.parentElement.classList.remove('success');
      isEmailValid = false;
    } else {
      emailError.textContent = '';
      emailInput.parentElement.classList.remove('error');
      emailInput.parentElement.classList.add('success');
      isEmailValid = true;
    }
    
    updateSubmitButtonState();
  }
  
  // Password validation function
  function validatePassword() {
    const password = passwordInput.value;
    
    if (password === '') {
      passwordError.textContent = 'Password is required';
      passwordInput.closest('.form-group').classList.add('error');
      passwordInput.closest('.form-group').classList.remove('success');
      isPasswordValid = false;
    } else if (password.length < 6) {
      passwordError.textContent = 'Password must be at least 6 characters';
      passwordInput.closest('.form-group').classList.add('error');
      passwordInput.closest('.form-group').classList.remove('success');
      isPasswordValid = false;
    } else {
      passwordError.textContent = '';
      passwordInput.closest('.form-group').classList.remove('error');
      passwordInput.closest('.form-group').classList.add('success');
      isPasswordValid = true;
    }
    
    updateSubmitButtonState();
  }
  
  // Update submit button state based on validation
  function updateSubmitButtonState() {
    submitButton.disabled = !(isEmailValid && isPasswordValid);
  }

  function toggleOauthButtonState(buttons, isLoading) {
    buttons.forEach((btn) => {
      btn.disabled = isLoading;
      btn.setAttribute('aria-busy', isLoading ? 'true' : 'false');
      if (isLoading) {
        btn.classList.add('oauth-button--loading');
      } else {
        btn.classList.remove('oauth-button--loading');
      }
    });
  }
  
  // Toggle password visibility
  function togglePasswordVisibility() {
    if (passwordInput.type === 'password') {
      passwordInput.type = 'text';
      passwordToggle.innerHTML = '<i class="eye-icon">👁️‍🗨️</i>';
      passwordToggle.setAttribute('aria-label', 'Hide password');
    } else {
      passwordInput.type = 'password';
      passwordToggle.innerHTML = '<i class="eye-icon">👁️</i>';
      passwordToggle.setAttribute('aria-label', 'Show password');
    }
  }
  
  // Show login screen
  window.showLoginScreen = function() {
    // Reset form
    loginForm.reset();
    emailError.textContent = '';
    passwordError.textContent = '';
    loginError.textContent = '';
    emailInput.parentElement.classList.remove('error', 'success');
    passwordInput.closest('.form-group').classList.remove('error', 'success');
    submitButton.disabled = true;
    isEmailValid = false;
    isPasswordValid = false;
    
    // Show login screen
    if (loginScreen) {
      loginScreen.classList.add('show');
    }
  };
  
  // Hide login screen
  window.hideLoginScreen = function() {
    if (loginScreen) {
      loginScreen.classList.remove('show');
      
      // Hide with delay to allow for transition
      setTimeout(() => {
        loginScreen.style.display = 'none';
      }, 500);
    }
  };
  
  // Handle form submission
  async function handleLogin(e) {
    e.preventDefault();
    
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    
    // Show loader
    loginLoader.classList.add('show');
    loginError.textContent = '';
    
    try {
      // Attempt login
      await window.authFunctions.loginUser(email, password);
      
      // Successful login
      loginLoader.classList.remove('show');
      
      // Hide login screen and show main options/dashboard
      hideLoginScreen();
      document.getElementById('mainOptions').style.display = 'flex';
      
    } catch (error) {
      // Failed login
      loginLoader.classList.remove('show');
      loginError.textContent = getAuthErrorMessage(error);
      
      // Shake animation for error
      loginForm.classList.add('shake');
      setTimeout(() => {
        loginForm.classList.remove('shake');
      }, 500);
    }
  }

  // Handle OAuth login
  async function handleOAuthLogin(providerKey) {
    if (!window.authFunctions?.oauthSignIn) {
      console.error('OAuth sign-in function unavailable.');
      if (loginError) {
        loginError.textContent = 'Single sign-on is temporarily unavailable. Please use email and password.';
      }
      return;
    }

    if (loginError) {
      loginError.textContent = '';
    }

    toggleOauthButtonState(oauthButtons, true);
    loginLoader.classList.add('show');
    const method = providerKey === 'google' ? 'google_oauth' : 'apple_oauth';
    let keepLoaderVisible = false;

    try {
      const result = await window.authFunctions.oauthSignIn(providerKey, { flow: 'login' });
      if (!result) {
        throw new Error('OAuth sign-in did not return a result.');
      }

      if (result.status === 'redirect') {
        keepLoaderVisible = true;
        return;
      }

      if (result.status !== 'success') {
        throw new Error('OAuth sign-in failed.');
      }

      if (result.isNewUser && result.flow === 'register') {
        loginLoader.classList.remove('show');
        if (typeof window.handleRegistrationSuccessFlow === 'function') {
          hideLoginScreen();
          try {
            await window.handleRegistrationSuccessFlow({ finalizeResult: result.finalizeResult, method });
          } catch (registrationError) {
            console.error('OAuth registration completion error:', registrationError);
            if (loginError) {
              loginError.textContent = getAuthErrorMessage(registrationError);
            }
            if (typeof window.showLoginScreen === 'function') {
              window.showLoginScreen();
            }
          }
        } else {
          hideLoginScreen();
          const mainOptionsFallback = document.getElementById('mainOptions');
          if (mainOptionsFallback) {
            mainOptionsFallback.style.display = 'flex';
          }
        }
        return;
      }

      hideLoginScreen();
      sessionStorage.removeItem('pendingRedirectAfterRegistration');
      const mainOptions = document.getElementById('mainOptions');
      if (mainOptions) {
        mainOptions.style.display = 'flex';
      }
      if (typeof ensureEventListenersAttached === 'function') {
        ensureEventListenersAttached();
      }
      logAnalyticsEvent('login', { method });
    } catch (oauthError) {
      console.error(providerKey + ' OAuth login error:', oauthError);
      if (loginError) {
        loginError.textContent = getAuthErrorMessage(oauthError);
      }
    } finally {
      if (!keepLoaderVisible) {
        loginLoader.classList.remove('show');
      }
      toggleOauthButtonState(oauthButtons, false);
    }
  }

  if (oauthButtons.length) {
    oauthButtons.forEach((btn) => {
      btn.addEventListener('click', () => handleOAuthLogin(btn.getAttribute('data-oauth-provider')));
    });
  }

  // Get user-friendly error message
  function getAuthErrorMessage(error) {
    const errorCode = error.code;
    
    switch (errorCode) {
      case 'auth/invalid-email':
        return 'Invalid email address format';
      case 'auth/user-disabled':
        return 'This account has been disabled';
      case 'auth/user-not-found':
        return 'No account found with this email';
      case 'auth/wrong-password':
        return 'Incorrect password';
      case 'auth/too-many-requests':
        return 'Too many login attempts. Please try again later.';
      case 'auth/popup-closed-by-user':
        return 'The sign-in window was closed before completion.';
      case 'auth/cancelled-popup-request':
        return 'Another sign-in attempt is already in progress. Please wait and try again.';
      case 'auth/popup-blocked':
        return 'Your browser blocked the sign-in popup. Please enable pop-ups or try again.';
      case 'auth/operation-not-supported-in-this-environment':
        return 'This sign-in method is not supported in your current browser. Please try a different browser.';
      case 'auth/account-exists-with-different-credential':
        return 'An account already exists with the same email but a different sign-in method. Try signing in using your original method.';
      case 'auth/credential-already-in-use':
        return 'This sign-in credential is already in use. Try logging in instead.';
      case 'auth/unauthorized-domain':
        return 'This domain is not authorized for sign-in. Please contact support.';
      case 'auth/network-request-failed':
        return 'Network error. Please check your connection.';
      default:
        return error.message || 'An unknown error occurred';
    }
  }
  
  // Handle forgot password
  function handleForgotPassword(e) {
  e.preventDefault();
  
  // Use the existing password reset functionality
  if (typeof showForgotPasswordModal === 'function') {
    showForgotPasswordModal();
  } else {
    // Fallback if function not available yet
    console.error("showForgotPasswordModal function not found");
    alert('Error accessing password reset. Please try again later.');
  }
}
  
  // Handle create account
  function handleCreateAccount() {
    hideLoginScreen();
    window.showRegisterForm(); // Access the function through the window object
  }
  
  // Handle continue as guest
  function handleContinueAsGuest() {
    hideLoginScreen();
    document.getElementById('mainOptions').style.display = 'flex';
  }
  
  // Add event listeners
  if (emailInput) {
    emailInput.addEventListener('input', validateEmail);
    emailInput.addEventListener('blur', validateEmail);
  }
  
  if (passwordInput) {
    passwordInput.addEventListener('input', validatePassword);
    passwordInput.addEventListener('blur', validatePassword);
  }
  
  if (loginForm) {
    loginForm.addEventListener('submit', handleLogin);
  }
  
  if (passwordToggle) {
    passwordToggle.addEventListener('click', togglePasswordVisibility);
  }
  
  if (forgotPasswordLink) {
    forgotPasswordLink.addEventListener('click', handleForgotPassword);
  }
  
  if (createAccountBtn) {
    createAccountBtn.addEventListener('click', handleCreateAccount);
  }
  
  if (continueAsGuestBtn) {
    continueAsGuestBtn.addEventListener('click', handleContinueAsGuest);
  }
  
  // Add shake animation for form errors
  const style = document.createElement('style');
  style.textContent = `
    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
      20%, 40%, 60%, 80% { transform: translateX(5px); }
    }
    
    .shake {
      animation: shake 0.5s cubic-bezier(.36,.07,.19,.97) both;
    }
  `;
  document.head.appendChild(style);
});
